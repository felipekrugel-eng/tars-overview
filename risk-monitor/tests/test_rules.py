import hashlib
import json
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import Attempt, evaluate, epoch, source_health, country_bucket, object_event
from watchdog import failures

NOW=epoch('2026-10-05T01:21:56Z')
def charge(id='new',amount=150000,created=NOW,status='succeeded',country='US',currency='usd',fp=None,account='acct_a'):
    return Attempt(account,id,created,amount,currency,status,country,fp)
def kinds(rows): return {x.kind:x for x in rows}

class Rules(unittest.TestCase):
    def test_missed_1500_regression(self):
        f=kinds(evaluate(charge(),[]))
        self.assertEqual(f['amount'].level,'Amount alert')
        self.assertEqual(f['amount'].evidence['amount'],150000)
    def test_strict_750_boundary(self):
        self.assertNotIn('amount',kinds(evaluate(charge(amount=75000),[])))
        self.assertIn('amount',kinds(evaluate(charge(amount=75001),[])))
    def test_card_country_not_merchant(self):
        self.assertEqual(evaluate(charge(country='GB'),[]),[])
        self.assertEqual(evaluate(charge(country=None),[]),[])
    def test_native_currency_not_amount_rule(self):
        self.assertNotIn('amount',kinds(evaluate(charge(currency='gbp'),[])))
    def test_new_merchant_700_boundary_and_grade(self):
        self.assertNotIn('legitimacy-review',kinds(evaluate(charge(amount=70000),[],NOW-86400)))
        self.assertIn('legitimacy-review',kinds(evaluate(charge(amount=70001),[],NOW-86400)))
        self.assertNotIn('legitimacy-review',kinds(evaluate(charge(amount=72500),[],NOW-86400,legitimacy_grade='Strong')))
    def test_merchant_age_calendar_days(self):
        self.assertNotIn('legitimacy-review',kinds(evaluate(charge(),[],NOW-31*86400)))
    def test_pos_age_elevates_amount(self):
        self.assertEqual(kinds(evaluate(charge(),[],pos_age_days=29))['amount'].level,'Elevated')
    def test_ticket_sample_and_strict_earlier(self):
        prior=[charge(str(i),amount=10000,created=NOW-100-i) for i in range(20)]
        self.assertIn('ticket-outlier',kinds(evaluate(charge(),prior)))
        self.assertNotIn('ticket-outlier',kinds(evaluate(charge(),prior[:19])))
        simultaneous=[charge(str(i),amount=10000) for i in range(20)]
        self.assertNotIn('ticket-outlier',kinds(evaluate(charge(),simultaneous)))
    def test_high_value_burst_boundaries(self):
        prior=[charge('a',100000,NOW-3599),charge('b',80000,NOW-200)]
        self.assertIn('high-value-burst',kinds(evaluate(charge(amount=80000),prior)))
        self.assertNotIn('high-value-burst',kinds(evaluate(charge(amount=80000),[charge('a',100000,NOW-3601),prior[1]])))
        self.assertNotIn('high-value-burst',kinds(evaluate(charge(amount=80000),[charge('a',80000,NOW-100),prior[1]])))
    def test_duplicate_ids_never_count_twice(self):
        a=charge('same',100000,NOW-100)
        self.assertNotIn('high-value-burst',kinds(evaluate(charge(),[a,a])))
    def test_day_surge_complete_active_days_only(self):
        midnight=NOW//86400*86400
        prior=[charge('old'+str(d)+'-'+str(i),amount=10000,created=midnight-d*86400+i) for d in range(1,8) for i in range(3)]
        today=[charge('today',300000,NOW-100)]
        self.assertIn('day-surge',kinds(evaluate(charge(amount=200000),prior+today)))
        self.assertNotIn('day-surge',kinds(evaluate(charge(amount=200000),prior[:18]+today)))
    def test_failures_all_amounts(self):
        prior=[charge('f1',100,NOW-100,'failed'),charge('f2',200,NOW-200,'failed')]
        self.assertIn('failed-burst',kinds(evaluate(charge(status='failed',amount=50),prior)))
    def test_failure_rate_includes_successes(self):
        prior=[charge('f1',100,NOW-100,'failed'),charge('f2',200,NOW-200,'failed')]+[charge('s'+str(i),100,NOW-50-i) for i in range(4)]
        self.assertNotIn('failed-burst',kinds(evaluate(charge(status='failed'),prior)))
    def test_sustained_failures(self):
        prior=[charge(str(i),100,NOW-i-1,'failed' if i<9 else 'succeeded') for i in range(19)]
        self.assertIn('sustained-failures',kinds(evaluate(charge(status='failed'),prior)))
    def test_verified_credential_any_amount(self):
        prior=[charge('a',100,NOW-599,fp='verified'),charge('b',100,NOW-1,fp='verified')]
        self.assertIn('same-credential',kinds(evaluate(charge(amount=100,fp='verified'),prior)))
        self.assertNotIn('same-credential',kinds(evaluate(charge(amount=100),prior)))
    def test_credential_is_account_and_currency_scoped(self):
        prior=[charge('a',100,NOW-10,fp='fp',account='acct_b'),charge('b',100,NOW-1,fp='fp',currency='gbp')]
        self.assertNotIn('same-credential',kinds(evaluate(charge(amount=100,fp='fp'),prior)))
    def test_credential_urgent_from_merchant_failure_history(self):
        prior=[charge('a',100,NOW-10,fp='fp'),charge('b',100,NOW-1,fp='fp')]+[charge('f'+str(i),100,NOW-1000-i,'failed') for i in range(5)]
        f=kinds(evaluate(charge(amount=100,fp='fp'),prior))['same-credential']
        self.assertEqual(f.level,'Urgent')
        self.assertEqual(f.evidence['preceding_merchant_failures'],5)
    def test_downward_retries_require_fingerprint(self):
        prior=[charge('f1',300,NOW-100,'failed',fp='fp'),charge('f2',200,NOW-50,'failed',fp='fp')]
        self.assertIn('downward-retries',kinds(evaluate(charge(amount=100,status='failed',fp='fp'),prior)))
        self.assertNotIn('downward-retries',kinds(evaluate(charge(amount=100,status='failed'),prior)))
    def test_correlated_failure_rules_not_independent_urgent(self):
        prior=[charge('f1',300,NOW-100,'failed',fp='fp'),charge('f2',200,NOW-50,'failed',fp='fp')]
        self.assertTrue(all(x.level=='Elevated' for x in evaluate(charge(amount=100,status='failed',fp='fp'),prior)))
    def test_two_independent_signals_urgent(self):
        prior=[charge('old'+str(i),10000,NOW-10000-i) for i in range(20)]+[charge('a',100000,NOW-100),charge('b',100000,NOW-50)]
        f=kinds(evaluate(charge(),prior))
        self.assertEqual(f['ticket-outlier'].level,'Urgent')
        self.assertEqual(f['high-value-burst'].level,'Urgent')

class Objects(unittest.TestCase):
    def refund(self,status='succeeded',created=NOW):
        return {'id':'re_test','status':status,'created':created,'amount':1,'currency':'jpy'}
    def dispute(self,status='needs_response',due=None):
        return {'id':'dp_test','status':status,'created':NOW,'amount':1,'currency':'usd','evidence_details':{'due_by':due}}
    def test_small_native_refund_alert(self):
        f,r=object_event('acct_a',self.refund(),None,NOW,'refund',NOW-10)
        self.assertEqual(f.level,'Elevated')
        self.assertEqual(r['currency'],'jpy')
    def test_pre_activation_terminal_refund_bootstrap(self):
        f,_=object_event('acct_a',self.refund(created=NOW-100),None,NOW,'refund',NOW-10)
        self.assertIsNone(f)
    def test_pre_activation_pending_refund_alert(self):
        f,_=object_event('acct_a',self.refund('pending',NOW-100),None,NOW,'refund',NOW-10)
        self.assertIsNotNone(f)
    def test_refund_material_status_transition(self):
        _,r=object_event('acct_a',self.refund('pending'),None,NOW,'refund',0)
        f,r=object_event('acct_a',self.refund(),r,NOW+1,'refund',0)
        self.assertIsNotNone(f)
        f,_=object_event('acct_a',self.refund(),r,NOW+2,'refund',0)
        self.assertIsNone(f)
    def test_formal_dispute_urgent(self):
        f,_=object_event('acct_a',self.dispute(),None,NOW,'dispute',0)
        self.assertEqual(f.level,'Urgent')
    def test_inquiry_72h_24h_overdue_once_each(self):
        obj=self.dispute('warning_needs_response',NOW+4*86400)
        f,r=object_event('acct_a',obj,None,NOW,'dispute',0)
        self.assertEqual(f.level,'Elevated')
        for at,threshold in [(NOW+86400,'72h'),(NOW+3*86400,'24h'),(NOW+4*86400,'overdue')]:
            f,r=object_event('acct_a',obj,r,at,'dispute',0)
            self.assertEqual(f.level,'Urgent'); self.assertIn(threshold,r['notices'])
            f,_=object_event('acct_a',obj,r,at+1,'dispute',0); self.assertIsNone(f)
    def test_unexpanded_dispute_unknown(self):
        with self.assertRaises(ValueError): object_event('acct_a','dp_test',None,NOW,'dispute',0)

class Coverage(unittest.TestCase):
    def test_offset_timestamp(self):
        self.assertEqual(epoch('2026-10-05T03:44:20-07:00'),epoch('2026-10-05T10:44:20Z'))
    def test_source_hash_count_and_freshness(self):
        raw=b'fixture'; s={'pull_succeeded':True,'sha256':{'transactions.csv':hashlib.sha256(raw).hexdigest()},
                         'rows':{'transactions':1},'completed_at_utc':'2026-10-05T00:00:00Z'}
        self.assertTrue(source_health(s,raw,1,NOW,28800))
        self.assertFalse(source_health(s,raw,1,NOW+28800,28800))
        with self.assertRaises(ValueError): source_health(s,b'wrong',1,NOW,28800)
        with self.assertRaises(ValueError): source_health(s,raw,2,NOW,28800)
    def test_puerto_rico_mutually_exclusive(self):
        self.assertEqual(country_bucket({'country':'US','company':{'address':{'country':'US','state':'PR'}}}),'PR')
        self.assertEqual(country_bucket({'country':'US','company':{'address':{'country':'US','state':'NY'}}}),'US')
        self.assertEqual(country_bucket({'country':'GB'}),'GB')
        self.assertEqual(country_bucket({}),'Unknown')
    def test_watchdog_independent_failure_detection(self):
        self.assertIn('monitor_heartbeat_missing',failures(None,NOW))
        h={'checkpoint_at':NOW,'last_evaluated_at':NOW,'mode':'active','gap_codes':[]}
        self.assertEqual(failures(h,NOW),[])
        self.assertIn('monitor_workflow_disabled',failures(h,NOW,False))
        self.assertIn('charge_evaluation_overdue',failures(h,NOW+5401))
        h['gap_codes']=['stripe_read_key_missing']; self.assertIn('stripe_read_key_missing',failures(h,NOW))
        h['mode']='shadow'; self.assertIn('migration_shadow_mode',failures(h,NOW))

if __name__=='__main__': unittest.main()


class OnboardingEvidence(unittest.TestCase):
    """The coverage contract: unobtainable evidence is not a coverage failure."""

    def test_platform_collected_ip_counts_as_covered(self):
        from engine import ip_evidence
        self.assertEqual(ip_evidence({'tos_acceptance': {'ip': '1.2.3.4', 'date': 1}}), 'present')

    def test_terms_without_an_ip_are_unobtainable_not_missing(self):
        from engine import ip_evidence
        self.assertEqual(ip_evidence({'tos_acceptance': {'date': 1700000000}}), 'terms_without_ip')
        self.assertEqual(ip_evidence({'tos_acceptance': {'service_agreement': 'full'}}),
                         'terms_without_ip')

    def test_live_account_without_terms_is_the_only_blocking_state(self):
        from engine import ip_evidence, IP_BLOCKING
        self.assertEqual(ip_evidence({'charges_enabled': True}), 'no_terms_charges_enabled')
        self.assertEqual(ip_evidence({'charges_enabled': False}), 'no_terms_not_onboarded')
        self.assertEqual(IP_BLOCKING, {'no_terms_charges_enabled'})

    def test_unknown_account_shape_degrades_to_blocking_not_covered(self):
        from engine import ip_evidence, IP_BLOCKING
        self.assertIn(ip_evidence({}), IP_BLOCKING | {'no_terms_not_onboarded'})
        self.assertNotEqual(ip_evidence({}), 'present')


class CoverageContract(unittest.TestCase):
    def monitor(self):
        import sys
        from pathlib import Path as _P
        sys.path.insert(0, str(_P(__file__).resolve().parents[1]))
        from monitor import Monitor
        store = type('S', (), {'run_id': 'r', 'checkpoint': lambda *a, **k: None,
                               'file': lambda self, p: (None, None)})()
        return Monitor({'gaps': [], 'mode': 'shadow'}, store, {'run_budget_seconds': 1000},
                       now=NOW)

    def test_unobtainable_evidence_alone_leaves_the_run_clean(self):
        m = self.monitor()
        counts = m.ip_coverage({'a': {'ip_evidence': 'present'},
                                'b': {'ip_evidence': 'terms_without_ip'},
                                'c': {'ip_evidence': 'no_terms_not_onboarded'}})
        self.assertEqual(m.s['gaps'], [])
        self.assertEqual(counts, {'no_terms_not_onboarded': 1, 'present': 1,
                                  'terms_without_ip': 1})

    def test_one_live_account_without_terms_blocks_the_run(self):
        m = self.monitor()
        m.ip_coverage({'a': {'ip_evidence': 'present'},
                       'b': {'ip_evidence': 'no_terms_charges_enabled'}})
        self.assertEqual(m.s['gaps'], ['onboarding_terms_evidence_missing'])

    def test_records_predating_the_contract_degrade_without_claiming_coverage(self):
        m = self.monitor()
        counts = m.ip_coverage({'a': {'tos_ip': '1.2.3.4'}, 'b': {'ip_evidence': 'present'}})
        self.assertEqual(m.s['gaps'], ['onboarding_ip_evidence_unclassified'])
        self.assertEqual(counts['unclassified'], 1)

    def test_account_record_carries_the_classification_for_the_sweep(self):
        from unittest.mock import patch
        m = self.monitor()
        m.stripe = type('S', (), {'get': lambda self, p: {
            'id': 'acct_x', 'country': 'US', 'charges_enabled': True,
            'tos_acceptance': {'date': 1700000000}}})()
        record = m.account('acct_x')
        self.assertEqual(record['ip_evidence'], 'terms_without_ip')
        self.assertIsNone(record['tos_ip'])


class FailuresThenSuccess(unittest.TestCase):
    """Declines at one merchant that end in a charge going through."""

    def run_then_success(self, failures, amount=10000, gap=60, status='succeeded'):
        from engine import Attempt, evaluate
        history = [Attempt('acct_a', 'f%d' % i, NOW - 1500 + i * gap, 5000, 'usd', 'failed', 'US')
                   for i in range(failures)]
        current = Attempt('acct_a', 'ch_ok', NOW, amount, 'usd', status, 'US')
        return [f for f in evaluate(current, history) if f.kind == 'failures-then-success']

    def test_five_declines_then_a_success_alerts(self):
        found = self.run_then_success(5)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].level, 'Elevated')
        self.assertEqual(found[0].evidence['failures'], 5)

    def test_four_declines_is_below_the_threshold(self):
        self.assertEqual(self.run_then_success(4), [])

    def test_declines_with_no_success_do_not_fire_this_rule(self):
        self.assertEqual(self.run_then_success(8, status='failed'), [])

    def test_ten_declines_or_a_large_success_escalate_to_urgent(self):
        self.assertEqual(self.run_then_success(10)[0].level, 'Urgent')
        self.assertEqual(self.run_then_success(5, amount=80000)[0].level, 'Urgent')

    def test_declines_outside_the_window_do_not_count(self):
        from engine import Attempt, evaluate
        old = [Attempt('acct_a', 'f%d' % i, NOW - 7200 + i, 5000, 'usd', 'failed', 'US')
               for i in range(8)]
        current = Attempt('acct_a', 'ch_ok', NOW, 10000, 'usd', 'succeeded', 'US')
        self.assertEqual([f for f in evaluate(current, old)
                          if f.kind == 'failures-then-success'], [])

    def test_the_success_and_every_decline_are_recorded_as_evidence(self):
        found = self.run_then_success(6)[0]
        self.assertIn('ch_ok', found.ids)
        self.assertEqual(len(found.ids), 7)

    def test_it_renders_as_a_plain_sentence(self):
        import sys
        from pathlib import Path as _P
        sys.path.insert(0, str(_P(__file__).resolve().parents[1]))
        import notify
        found = self.run_then_success(6, amount=120000)[0]
        sentence = notify.headline(found.kind, found.evidence)
        self.assertEqual(sentence,
                         '6 declined attempts in the 30 minutes before a payment '
                         'of $1,200.00 succeeded.')
        self.assertEqual(notify.headline('failures-then-success', {'failures': 6}),
                         '6 declined attempts in 30 minutes, then a payment succeeded.')
