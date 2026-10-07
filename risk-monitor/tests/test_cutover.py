"""Cutover tooling: readiness reporting and candidate reconciliation."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adapters import SafeError
import cutover_check
import reconcile_candidates

NOW = 1791367225


def state_with_candidates():
    return {
        'names': {'acct_a': 'Acme Coffee'},
        'events': {
            'e1': {'finding': {'account': 'acct_a', 'kind': 'amount', 'level': 'Urgent',
                               'ids': ['ch_1'], 'evidence': {'amount': 900000}}},
            'e2': {'finding': {'account': 'acct_a', 'kind': 'dispute', 'level': 'Urgent',
                               'ids': ['dp_9:needs_response:None:None'],
                               'evidence': {'id': 'dp_9', 'status': 'needs_response'}}},
        },
        'alerts': {
            'lp:acct_a:events:1': {'alert_id': 'lp:acct_a:events:1', 'account': 'acct_a',
                                   'events': ['e1', 'e2'], 'created_at': NOW - 86400},
            'lp:acct_b:events:2': {'alert_id': 'lp:acct_b:events:2', 'account': 'acct_b',
                                   'events': [], 'created_at': NOW,
                                   'email': {'status': 'sent'}, 'telegram': {'status': 'sent'}},
        },
    }


class Candidates(unittest.TestCase):
    def test_only_undelivered_alerts_are_pending(self):
        ids = [a['alert_id'] for a in reconcile_candidates.pending(state_with_candidates())]
        self.assertEqual(ids, ['lp:acct_a:events:1'])

    def test_describe_summarises_without_raw_evidence_dumps(self):
        s = state_with_candidates()
        entry = reconcile_candidates.describe(s, s['alerts']['lp:acct_a:events:1'])
        self.assertEqual(entry['level'], 'Urgent')
        self.assertEqual(entry['name'], 'Acme Coffee')
        self.assertEqual(entry['kinds'], ['amount', 'dispute'])
        # Composite event keys are reduced to the object id a person can search.
        self.assertEqual(entry['object_ids'], ['ch_1', 'dp_9'])

    def test_decisions_are_recorded_with_actor_and_checkpointed(self):
        s = state_with_candidates()
        writes = []
        store = type('S', (), {'checkpoint': lambda self, st, ev: writes.append(ev)})()
        reconcile_candidates.apply_decisions(store, s, {'lp:acct_a:events:1': 'baseline'})
        self.assertEqual(s['alerts']['lp:acct_a:events:1']['reconciled']['decision'], 'baseline')
        self.assertEqual(writes[0]['type'], 'candidates_reconciled')
        self.assertEqual(writes[0]['baselined'], ['lp:acct_a:events:1'])

    def test_unknown_alert_id_is_refused(self):
        store = type('S', (), {'checkpoint': lambda *a: None})()
        with self.assertRaises(SafeError):
            reconcile_candidates.apply_decisions(store, state_with_candidates(), {'nope': 'send'})

    def test_changing_a_recorded_decision_is_refused(self):
        s = state_with_candidates()
        s['alerts']['lp:acct_a:events:1']['reconciled'] = {'decision': 'baseline'}
        store = type('S', (), {'checkpoint': lambda *a: None})()
        with self.assertRaises(SafeError):
            reconcile_candidates.apply_decisions(store, s, {'lp:acct_a:events:1': 'send'})

    def test_decide_all_requires_the_exact_undecided_count(self):
        with patch.object(reconcile_candidates, 'inspect',
                          return_value=(None, state_with_candidates(), {})):
            with self.assertRaises(SafeError):
                reconcile_candidates.main(['--decide-all', 'baseline', '--confirm', '7'])

    def test_decide_rejects_an_unknown_decision_word(self):
        with patch.object(reconcile_candidates, 'inspect',
                          return_value=(None, state_with_candidates(), {})):
            with self.assertRaises(SafeError):
                reconcile_candidates.main(['--decide', 'lp:acct_a:events:1=ignore'])


class Readiness(unittest.TestCase):
    def test_blocking_failure_is_a_no_go_and_advisory_is_not(self):
        report = cutover_check.Report()
        report.check('fine')(lambda: 'ok')
        report.check('soft', blocking=False)(lambda: (_ for _ in ()).throw(SafeError('meh')))
        self.assertEqual(report.render(), 0)
        report.check('hard')(lambda: (_ for _ in ()).throw(SafeError('broken')))
        self.assertEqual(report.render(), 1)

    def test_a_check_raising_an_unexpected_error_fails_rather_than_crashing(self):
        report = cutover_check.Report()
        report.check('boom')(lambda: (_ for _ in ()).throw(RuntimeError('x')))
        self.assertEqual(report.rows[0][1], 'FAIL')
        self.assertEqual(report.rows[0][2], 'RuntimeError')

    def test_stale_pull_status_is_reported_with_its_age(self):
        import json, tempfile, os
        payload = {'pull_succeeded': True, 'completed_at_utc': '2026-10-01T00:00:00Z'}
        handle = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False)
        json.dump(payload, handle); handle.close()
        try:
            with self.assertRaises(SafeError) as caught:
                cutover_check.pull_fresh(handle.name, 8 * 3600, 1791367225)
            self.assertIn('stale_by_', str(caught.exception))
        finally:
            os.unlink(handle.name)


if __name__ == '__main__':
    unittest.main()
