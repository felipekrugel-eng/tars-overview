"""Alert readability and delivery-volume control."""
import re
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import notify
import throttle
from adapters import Gmail, canonical
from engine import Finding
from monitor import Monitor

NOW = 1791367225


class FakeStore:
    run_id = 'run-test'
    def __init__(self): self.writes = []
    def checkpoint(self, state, event, health=None):
        import json
        self.writes.append((json.loads(canonical(state)), event))
    def file(self, path): return None, None


def monitor(**settings):
    state = {'run_started': NOW, 'mode': 'active', 'gaps': [], 'events': {}, 'alerts': {},
             'seen_attempts': {}, 'attempts': {}}
    base = {'run_budget_seconds': 1000}
    base.update(settings)
    return Monitor(state, FakeStore(), base, now=NOW)


class Readability(unittest.TestCase):
    def test_amounts_render_as_currency_not_minor_units(self):
        self.assertEqual(notify.money(75001), '$750.01')
        self.assertEqual(notify.money(2500000), '$25,000.00')
        self.assertEqual(notify.money(1234, 'eur'), '12.34 EUR')
        self.assertEqual(notify.money(5000, 'jpy'), '5,000 JPY')
        self.assertEqual(notify.money(None), 'unknown')

    def test_every_rule_kind_has_a_plain_sentence(self):
        kinds = ['amount', 'legitimacy-review', 'ticket-outlier', 'high-value-burst',
                 'day-surge', 'failed-burst', 'sustained-failures', 'same-credential',
                 'downward-retries', 'refund', 'dispute', 'refund-request', 'linkage']
        evidence = {'amount': 150000, 'median': 50000, 'sample': 25, 'total': 300000,
                    'median_day': 100000, 'active_days': 12, 'attempts': 10, 'failures': 6,
                    'first': 90000, 'final': 20000, 'id': 'dp_1', 'status': 'needs_response',
                    'payments_age_days': 4, 'grade': 'Weak', 'accounts': 3}
        for kind in kinds:
            sentence = notify.headline(kind, evidence)
            self.assertTrue(sentence.endswith('.'), kind)
            self.assertNotIn('{', sentence)
            self.assertNotIn('None', sentence)

    def test_unknown_rule_kind_degrades_instead_of_raising(self):
        self.assertEqual(notify.headline('brand-new-rule', {}), 'Brand new rule.')

    def test_alert_body_is_prose_and_carries_no_raw_json(self):
        findings = [{'kind': 'ticket-outlier', 'level': 'Elevated', 'account': 'acct_a',
                     'ids': ['ch_1'], 'evidence': {'amount': 300000, 'median': 50000, 'sample': 40}}]
        subject, body, text = notify.render_alert(
            {'alert_id': 'marker-1'}, findings,
            {'account': 'acct_a', 'name': 'Acme Coffee', 'now': NOW,
             'volumes': {'24h': {'count': 3, 'amount': 450000}},
             'account_age_days': 400, 'live_status': 'active'})
        self.assertTrue(subject.startswith('[Loyverse Payments] '))
        self.assertIn('Acme Coffee', subject)
        for noise in ('{"', '":', 'evidence_details', "'kind'"):
            self.assertNotIn(noise, body)
        self.assertIn('$3,000.00', body)
        self.assertIn('6.0x', body)
        self.assertIn('WHAT TO DO', body)
        self.assertIn('marker-1', body)

    def test_telegram_is_short_and_omits_account_identifiers(self):
        findings = [{'kind': 'amount', 'level': 'Urgent', 'evidence': {'amount': 900000}}]
        _, _, text = notify.render_alert(
            {'alert_id': 'marker-2'}, findings,
            {'account': 'acct_secret', 'name': 'Acme Coffee', 'now': NOW})
        self.assertLessEqual(len(text), notify.TELEGRAM_LIMIT)
        self.assertNotIn('acct_secret', text)
        self.assertIn('$9,000.00', text)

    def test_digest_lists_every_member_marker_for_reconciliation(self):
        entries = [{'level': 'Elevated', 'name': 'A', 'account': 'acct_a', 'alert_id': 'm-a',
                    'findings': [{'kind': 'amount', 'evidence': {'amount': 100000}}]},
                   {'level': 'Amount alert', 'name': 'B', 'account': 'acct_b', 'alert_id': 'm-b',
                    'findings': [{'kind': 'amount', 'evidence': {'amount': 80000}}]}]
        subject, body, text = notify.render_digest(entries, {'now': NOW, 'digest_id': 'd-1'})
        self.assertIn('2 merchants', subject)
        self.assertIn('m-a', body)
        self.assertIn('m-b', body)
        self.assertLess(body.index('Elevated — A'), body.index('Amount alert — B'))
        self.assertLessEqual(len(text), notify.TELEGRAM_LIMIT)

    def test_health_notice_explains_codes_in_plain_language(self):
        subject, body, text = notify.render_health(
            ['gmail_oauth_missing'], [], {'now': NOW, 'alert_id': 'h-1', 'tier': 'critical'})
        self.assertIn('action needed', subject)
        self.assertIn('Gmail credentials are missing', body)
        self.assertNotIn('gmail_oauth_missing.', body.split('h-1')[0].replace(
            'Gmail credentials are missing or rejected.', ''))


class Volume(unittest.TestCase):
    def deliverable(self, m, accounts, level='Elevated'):
        for account in accounts:
            m.add(Finding(account, 'amount', level, ['ch_' + account], {'amount': 100000}))
        m.group_alerts()

    def test_many_merchants_become_one_digest_email(self):
        m = monitor()
        self.deliverable(m, ['acct_a', 'acct_b', 'acct_c', 'acct_d'])
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'reconcile', return_value=([], [])), \
             patch.object(gmail, 'send_internal', return_value={'id': 'msg1', 'labelIds': ['SENT']}) as send, \
             patch.object(m, 'enqueue_telegram'):
            m.deliver()
        self.assertEqual(send.call_count, 1)
        self.assertIn('Risk digest', send.call_args[0][0])
        self.assertTrue(all(a['email']['status'] == 'sent' for a in m.s['alerts'].values()))

    def test_urgent_is_sent_immediately_and_separately(self):
        m = monitor()
        self.deliverable(m, ['acct_a', 'acct_b'])
        m.add(Finding('acct_u', 'same-credential', 'Urgent', ['x', 'y', 'z'], {'amount': 500000}))
        m.group_alerts()
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'reconcile', return_value=([], [])), \
             patch.object(gmail, 'send_internal', return_value={'id': 'm', 'labelIds': ['SENT']}) as send, \
             patch.object(m, 'enqueue_telegram'):
            m.deliver()
        subjects = [call[0][0] for call in send.call_args_list]
        self.assertEqual(len(subjects), 2)
        self.assertTrue(any(s.startswith('[Loyverse Payments] Urgent') for s in subjects))
        self.assertTrue(any('Risk digest' in s for s in subjects))

    def test_single_batched_alert_is_not_hidden_behind_a_digest(self):
        m = monitor()
        self.deliverable(m, ['acct_a'])
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'reconcile', return_value=([], [])), \
             patch.object(gmail, 'send_internal', return_value={'id': 'm', 'labelIds': ['SENT']}) as send, \
             patch.object(m, 'enqueue_telegram'):
            m.deliver()
        self.assertNotIn('Risk digest', send.call_args[0][0])

    def test_send_budget_holds_alerts_without_dropping_them(self):
        m = monitor(notifications={'max_emails_per_run': 1, 'immediate_levels': ['Urgent']})
        for account in ('acct_a', 'acct_b', 'acct_c'):
            m.add(Finding(account, 'same-credential', 'Urgent', ['x' + account], {'amount': 100000}))
        m.group_alerts()
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'reconcile', return_value=([], [])), \
             patch.object(gmail, 'send_internal', return_value={'id': 'm', 'labelIds': ['SENT']}) as send, \
             patch.object(m, 'enqueue_telegram'):
            m.deliver()
        self.assertEqual(send.call_count, 1)
        self.assertEqual(m.s['alerts_held'], 2)
        self.assertEqual(m.s['gaps'], [])
        undelivered = [a for a in m.s['alerts'].values() if a.get('email', {}).get('status') != 'sent']
        self.assertEqual(len(undelivered), 2)
        self.assertTrue(all(a['events'] for a in undelivered))

    def test_cooldown_suppresses_a_repeat_but_never_an_escalation(self):
        rules = throttle.policy({})
        state = {}
        throttle.record_delivery(state, 'acct_a', 'Elevated', NOW)
        self.assertTrue(throttle.cooldown_blocked(state, 'acct_a', 'Elevated', NOW + 60, rules))
        self.assertFalse(throttle.cooldown_blocked(state, 'acct_a', 'Urgent', NOW + 60, rules))
        self.assertFalse(throttle.cooldown_blocked(state, 'acct_a', 'Elevated', NOW + 99999, rules))

    def test_daily_budget_survives_across_runs_and_resets_on_a_new_london_day(self):
        state = {}
        rules = throttle.policy({'notifications': {'max_emails_per_day': 2}})
        for _ in range(2):
            budget = throttle.Budget(state, NOW, rules)
            self.assertTrue(budget.allows()); budget.spend()
        self.assertFalse(throttle.Budget(state, NOW, rules).allows())
        self.assertTrue(throttle.Budget(state, NOW + 2 * 86400, rules).allows())

    def test_digest_respects_the_per_merchant_cooldown(self):
        m = monitor()
        self.deliverable(m, ['acct_a', 'acct_b', 'acct_c'])
        throttle.record_delivery(m.s, 'acct_b', 'Elevated', NOW - 60)
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'reconcile', return_value=([], [])), \
             patch.object(gmail, 'send_internal', return_value={'id': 'm', 'labelIds': ['SENT']}) as send, \
             patch.object(m, 'enqueue_telegram'):
            m.deliver()
        body = send.call_args[0][1]
        self.assertIn('acct_a', body)
        self.assertNotIn('acct_b', body)
        self.assertEqual(m.s['alerts_held'], 1)

    def test_digest_member_count_is_capped_independently_of_email_budget(self):
        m = monitor(notifications={'max_digest_entries': 2})
        self.deliverable(m, ['acct_a', 'acct_b', 'acct_c', 'acct_d'])
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'reconcile', return_value=([], [])), \
             patch.object(gmail, 'send_internal', return_value={'id': 'm', 'labelIds': ['SENT']}) as send, \
             patch.object(m, 'enqueue_telegram'):
            m.deliver()
        self.assertEqual(send.call_count, 1)
        self.assertIn('2 merchants', send.call_args[0][0])
        self.assertEqual(m.s['alerts_held'], 2)

    def test_recovery_is_retried_until_both_receipts_confirm(self):
        rules = throttle.policy({'notifications': {'health_confirm_checks': 1}})
        state = {'incidents': {'gmail_oauth_missing': {'observations': 2, 'notified_at': 50}}}
        self.assertEqual(throttle.observe_health(state, [], 100, rules)[1], ['gmail_oauth_missing'])
        # Nothing confirmed the send, so the next check still owes a recovery.
        self.assertEqual(throttle.observe_health(state, [], 200, rules)[1], ['gmail_oauth_missing'])
        from watchdog import close_recovery
        close_recovery(state, {'email': {'status': 'sent'}, 'telegram': {'status': 'sent'},
                               'recovers': ['gmail_oauth_missing']})
        self.assertEqual(throttle.observe_health(state, [], 300, rules)[1], [])

    def test_issue_returning_before_its_recovery_is_delivered_stays_open(self):
        rules = throttle.policy({'notifications': {'health_confirm_checks': 1}})
        state = {'incidents': {'transaction_source_stale': {'observations': 2, 'notified_at': 50}}}
        throttle.observe_health(state, [], 100, rules)
        candidates, recovered = throttle.observe_health(state, ['transaction_source_stale'], 200, rules)
        self.assertEqual(recovered, [])
        self.assertEqual(state['pending_recovery'], {})

    def test_activation_boundary_holds_the_shadow_backlog(self):
        from monitor import releasable
        boundary = NOW
        old = {'created_at': NOW - 86400}
        new = {'created_at': NOW + 60}
        self.assertEqual(releasable(old, boundary), (False, 'pre_activation_unreconciled'))
        self.assertEqual(releasable(new, boundary), (True, 'new'))
        self.assertEqual(releasable(dict(old, reconciled={'decision': 'send'}), boundary),
                         (True, 'released'))
        self.assertEqual(releasable(dict(new, reconciled={'decision': 'baseline'}), boundary),
                         (False, 'baselined'))
        self.assertEqual(releasable(old, None), (True, 'new'))

    def test_unreconciled_backlog_is_held_and_flagged_not_dropped(self):
        m = monitor(activation={'boundary_epoch': NOW, 'legacy_alerting_retired': True})
        m.add(Finding('acct_old', 'amount', 'Urgent', ['ch_old'], {'amount': 900000}))
        m.group_alerts()
        for alert in m.s['alerts'].values():
            alert['created_at'] = NOW - 86400
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'send_internal') as send, patch.object(m, 'enqueue_telegram'):
            m.deliver()
        send.assert_not_called()
        self.assertIn('pre_activation_candidates_unreconciled', m.s['gaps'])
        self.assertTrue(all(a['events'] for a in m.s['alerts'].values()))

    def test_baselined_candidate_never_sends_and_leaves_health_clean(self):
        from monitor import health
        m = monitor(activation={'boundary_epoch': NOW, 'legacy_alerting_retired': True})
        m.add(Finding('acct_old', 'amount', 'Urgent', ['ch_old'], {'amount': 900000}))
        m.group_alerts()
        for alert in m.s['alerts'].values():
            alert['created_at'] = NOW - 86400
            alert['reconciled'] = {'decision': 'baseline', 'at': NOW, 'by': 'felipe'}
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'send_internal') as send, patch.object(m, 'enqueue_telegram'):
            m.deliver()
        send.assert_not_called()
        self.assertNotIn('pre_activation_candidates_unreconciled', m.s['gaps'])
        self.assertEqual(health(m.s, NOW)['pending_alert_count'], 0)

    def test_active_mode_requires_an_activation_block(self):
        import json, monitor as monitor_module
        from adapters import SafeError, RECIPIENTS, SENDER
        base = {'schema_version': 1, 'sender': SENDER, 'recipients': list(RECIPIENTS)}
        for broken in ({'mode': 'active'},
                       {'mode': 'active', 'activation': {'boundary_epoch': NOW}},
                       {'mode': 'active', 'activation': {'boundary_epoch': NOW,
                                                         'legacy_alerting_retired': False}}):
            cfg = dict(base); cfg.update(broken)
            with patch.object(monitor_module.Path, 'read_text', return_value=json.dumps(cfg)):
                with self.assertRaises(SafeError):
                    monitor_module.config()
        cfg = dict(base); cfg.update({'mode': 'active',
                                      'activation': {'boundary_epoch': NOW,
                                                     'legacy_alerting_retired': True}})
        with patch.object(monitor_module.Path, 'read_text', return_value=json.dumps(cfg)):
            self.assertEqual(monitor_module.config()['mode'], 'active')

    def test_shadow_mode_still_sends_nothing(self):
        m = monitor()
        m.s['mode'] = 'shadow'
        self.deliverable(m, ['acct_a', 'acct_b'])
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch.object(gmail, 'send_internal') as send:
            m.deliver()
        send.assert_not_called()


if __name__ == '__main__':
    unittest.main()


class WakeCadence(unittest.TestCase):
    """A wake-up with nothing new to do must cost nothing."""

    def setUp(self):
        import monitor as monitor_module
        self.mod = monitor_module
        self.settings = {'min_run_interval_seconds': 3000}
        self.state = {'last_run_finished': NOW - 600, 'source_asof': '2026-10-07T10:00:00Z',
                      'full': {'status': 'complete'}, 'global': {'complete': True}, 'alerts': {}}
        self.status = {'completed_at_utc': '2026-10-07T10:00:00Z'}

    def check(self):
        import json
        with patch.object(self.mod.Path, 'read_text', return_value=json.dumps(self.status)):
            return self.mod.redundant_wake(self.state, self.settings, NOW)

    def test_wake_with_no_new_extraction_is_skipped(self):
        self.assertIsNotNone(self.check())

    def test_a_new_extraction_always_runs(self):
        self.status['completed_at_utc'] = '2026-10-07T13:00:00Z'
        self.assertIsNone(self.check())

    def test_the_scheduled_interval_always_runs(self):
        self.state['last_run_finished'] = NOW - 4000
        self.assertIsNone(self.check())

    def test_unfinished_work_always_runs(self):
        for key, value in (('full', {'status': 'in_progress'}), ('global', {'complete': False})):
            with self.subTest(key=key):
                state = dict(self.state); state[key] = value
                self.state = state
                self.assertIsNone(self.check())

    def test_shadow_mode_pending_alerts_do_not_disable_the_guard(self):
        # deliver() never runs in shadow mode, so these stay pending forever.
        self.settings['mode'] = 'shadow'
        self.state['alerts'] = {'a': {'email': {}, 'telegram': {}, 'created_at': NOW}}
        self.assertIsNotNone(self.check())

    def test_active_mode_deliverable_alert_always_runs(self):
        self.settings['mode'] = 'active'
        self.state['alerts'] = {'a': {'email': {'status': 'sent'}, 'telegram': {},
                                      'created_at': NOW}}
        self.assertIsNone(self.check())

    def test_active_mode_held_or_baselined_alerts_do_not_force_a_run(self):
        self.settings['mode'] = 'active'
        self.settings['activation'] = {'boundary_epoch': NOW}
        self.state['alerts'] = {
            'baselined': {'email': {}, 'telegram': {}, 'created_at': NOW + 60,
                          'reconciled': {'decision': 'baseline'}},
            'pre_boundary': {'email': {}, 'telegram': {}, 'created_at': NOW - 86400},
        }
        self.assertIsNotNone(self.check())

    def test_unreadable_pull_status_runs_rather_than_skipping(self):
        with patch.object(self.mod.Path, 'read_text', side_effect=OSError):
            self.assertIsNone(self.mod.redundant_wake(self.state, self.settings, NOW))

    def test_clock_skew_never_causes_an_indefinite_skip(self):
        self.state['last_run_finished'] = NOW + 99999
        self.assertIsNone(self.check())

    def test_skip_interval_stays_under_the_watchdog_heartbeat_threshold(self):
        import json as _json
        from watchdog import failures
        configured = _json.loads(Path('risk-monitor/config.json').read_text())['min_run_interval_seconds']
        # A skipped wake writes no heartbeat, so the interval must not by itself
        # age the heartbeat past the watchdog's overdue threshold.
        self.assertLess(configured, 5400)
        self.assertEqual(failures({'mode': 'active', 'last_evaluated_at': NOW,
                                   'checkpoint_at': NOW}, NOW + configured), [])


class RenderedEngineOutput(unittest.TestCase):
    """Render what the engine actually produces, not a hand-written evidence dict.

    The earlier tests fed `headline()` a dict containing every key it might
    read, so a rule that never recorded `amount` still rendered cleanly in the
    test and produced "unknown is 0.0x ..." against live data.
    """

    def engine_findings(self):
        from engine import Attempt, evaluate
        history = [Attempt('acct_a', 'ch_%d' % i, NOW - 10 * 86400 + i, 10000, 'usd',
                           'succeeded', 'US') for i in range(25)]
        current = Attempt('acct_a', 'ch_now', NOW, 100000, 'usd', 'succeeded', 'US')
        findings = evaluate(current, history, account_created=NOW - 5 * 86400,
                            legitimacy_grade='Unverified')
        self.assertTrue({'amount', 'ticket-outlier', 'legitimacy-review'}
                        <= {f.kind for f in findings})
        return findings

    def test_no_rule_renders_a_missing_value(self):
        for finding in self.engine_findings():
            sentence = notify.headline(finding.kind, finding.evidence)
            with self.subTest(kind=finding.kind):
                self.assertNotIn('unknown', sentence)
                # A leading-zero multiple means the amount was missing; "10.0x"
                # must not trip this.
                self.assertIsNone(re.search(r'(?<![\d.])0\.0x', sentence))
                self.assertNotIn('None', sentence)
                self.assertTrue(sentence.endswith('.'))

    def test_ticket_outlier_states_the_amount_and_a_real_multiple(self):
        finding = next(f for f in self.engine_findings() if f.kind == 'ticket-outlier')
        sentence = notify.headline(finding.kind, finding.evidence)
        self.assertIn('$1,000.00', sentence)
        self.assertIn('10.0x', sentence)

    def test_legitimacy_review_states_the_amount(self):
        finding = next(f for f in self.engine_findings() if f.kind == 'legitimacy-review')
        self.assertIn('$1,000.00', notify.headline(finding.kind, finding.evidence))

    def test_linkage_reports_a_count_not_the_account_ids(self):
        evidence = {'kind': 'IP', 'accounts': ['acct_1TWOQY8lEmH1iqQS', 'acct_1U9TAR4qfJZZfKex'],
                    'lead_only': True}
        sentence = notify.headline('linkage', evidence)
        self.assertEqual(sentence, 'Shared onboarding IP across 2 accounts.')
        self.assertNotIn('acct_', sentence)
        self.assertEqual(notify.headline('linkage', {'kind': 'fingerprint', 'accounts': ['a', 'b', 'c']}),
                         'Shared card fingerprint across 3 accounts.')

    def test_telegram_text_never_carries_account_ids(self):
        findings = [{'kind': 'linkage', 'level': 'Elevated',
                     'evidence': {'kind': 'IP', 'accounts': ['acct_secret1', 'acct_secret2']}}]
        _, _, text = notify.render_alert({'alert_id': 'm'}, findings,
                                         {'account': 'cross-account', 'name': 'cross-account',
                                          'now': NOW})
        self.assertNotIn('acct_', text)

    def test_every_renderable_kind_degrades_when_evidence_is_empty(self):
        for kind in ('amount', 'legitimacy-review', 'ticket-outlier', 'high-value-burst',
                     'day-surge', 'failed-burst', 'sustained-failures', 'same-credential',
                     'downward-retries', 'refund', 'dispute', 'refund-request', 'linkage'):
            with self.subTest(kind=kind):
                sentence = notify.headline(kind, {})
                self.assertTrue(sentence.endswith('.'))
                self.assertNotIn('None', sentence)


class ReceiptReconciliation(unittest.TestCase):
    """A confirmed receipt must be read back regardless of cooldown or budget.

    The first digest records a cooldown for every merchant it covered. If
    reading the receipt back sits behind that cooldown, nothing ever reconciles
    it: health stays degraded, pending_alert_count never falls, and the wake
    guard sees permanently deliverable work.
    """

    def monitor_with_enqueued_digest(self, receipt_status='sent'):
        m = monitor(activation={'boundary_epoch': NOW - 10, 'legacy_alerting_retired': True})
        m.add(Finding('acct_a', 'amount', 'Elevated', ['ch_a'], {'amount': 100000}))
        m.add(Finding('acct_b', 'amount', 'Elevated', ['ch_b'], {'amount': 100000}))
        m.group_alerts()
        key = 'digestkey123'
        for alert in m.s['alerts'].values():
            alert['created_at'] = NOW
            alert['email'] = {'status': 'sent', 'message_id': 'm1', 'via': 'digest'}
            alert['telegram'] = {'status': 'enqueued', 'receipt_key': key}
            # Both merchants are inside the cooldown the digest recorded.
            throttle.record_delivery(m.s, alert['account'], 'Elevated', NOW)
        transport = {'receipts': {key: {'status': receipt_status, 'message_id': 168,
                                        'sent_epoch': NOW}}}
        return m, transport

    def test_receipt_is_read_back_despite_the_cooldown(self):
        from monitor import health
        m, transport = self.monitor_with_enqueued_digest()
        with patch('monitor.verified_transport', return_value=(None, transport, None, None)):
            m.deliver()
        for alert in m.s['alerts'].values():
            self.assertEqual(alert['telegram']['status'], 'sent')
            self.assertEqual(alert['telegram']['message_id'], 168)
        self.assertNotIn('telegram_delivery_unconfirmed', m.s['gaps'])
        self.assertEqual(health(m.s, NOW)['pending_alert_count'], 0)

    def test_an_unconfirmed_receipt_stays_a_gap_and_never_resends(self):
        m, transport = self.monitor_with_enqueued_digest(receipt_status='enqueued')
        gmail = object.__new__(Gmail); m.gmail = gmail
        with patch('monitor.verified_transport', return_value=(None, transport, None, None)), \
             patch.object(gmail, 'send_internal') as send:
            m.deliver()
        send.assert_not_called()
        self.assertIn('telegram_delivery_unconfirmed', m.s['gaps'])

    def test_a_digest_member_resolves_by_the_digest_key_not_its_own_id(self):
        m, transport = self.monitor_with_enqueued_digest()
        alert = next(iter(m.s['alerts'].values()))
        self.assertEqual(m.receipt_key(alert), 'digestkey123')
        alert['telegram'] = {}
        import hashlib
        self.assertEqual(m.receipt_key(alert),
                         hashlib.sha256(alert['alert_id'].encode()).hexdigest())

    def test_reconciled_alerts_let_the_wake_guard_fire_again(self):
        from monitor import redundant_wake
        m, transport = self.monitor_with_enqueued_digest()
        with patch('monitor.verified_transport', return_value=(None, transport, None, None)):
            m.deliver()
        state = dict(m.s, last_run_finished=NOW - 600, source_asof='2026-10-08T09:00:00Z',
                     full={'status': 'complete'}, global_={'complete': True})
        state['global'] = {'complete': True}
        settings = {'mode': 'active', 'min_run_interval_seconds': 3000,
                    'activation': {'boundary_epoch': NOW - 10}}
        import json as _json
        with patch.object(Path, 'read_text',
                          return_value=_json.dumps({'completed_at_utc': '2026-10-08T09:00:00Z'})):
            self.assertIsNotNone(redundant_wake(state, settings, NOW))
