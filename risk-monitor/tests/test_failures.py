import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from adapters import seal,unseal,SafeError,Stripe,Gmail,GitStore,canonical
from monitor import Monitor
from engine import Finding

class FakeStore:
    run_id='run-test'
    def __init__(self): self.writes=[]
    def checkpoint(self,state,event,health=None):
        import json
        self.writes.append((json.loads(canonical(state)),event))
    def file(self,path): return None,None

def state():
    return {'run_started':100000,'mode':'active','gaps':[],'events':{},'alerts':{},'seen_attempts':{},'attempts':{}}

class Failures(unittest.TestCase):
    def test_durable_state_authenticated_encryption(self):
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake-test-key'}):
            s={'sensitive':'not-public'}; e=seal(s)
            self.assertNotIn('not-public',str(e)); self.assertEqual(unseal(e),s)
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'different-key'}):
            with self.assertRaises(SafeError): unseal(e)
    def test_state_nonce_unique(self):
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake-test-key'}):
            self.assertNotEqual(seal({})['nonce'],seal({})['nonce'])
    def test_missing_stripe_key_fails_closed(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaisesRegex(SafeError,'stripe_read_key_missing'): Stripe()
    def test_stripe_adapter_cannot_mutate(self):
        with patch.dict(os.environ,{'STRIPE_RISK_READ_KEY':'fake'}):
            s=Stripe()
            with self.assertRaises(SafeError): s.get('payouts')
            with self.assertRaises(SafeError): s.get('disputes/dp_1/close')
    def test_stripe_full_pagination_validation(self):
        with patch.dict(os.environ,{'STRIPE_RISK_READ_KEY':'fake'}):
            s=Stripe()
        with patch.object(s,'get',return_value={'data':[],'has_more':True}):
            with self.assertRaises(SafeError): s.page('accounts',{'limit':25})
        with patch.object(s,'get',return_value={'data':[]}):
            with self.assertRaises(SafeError): s.page('accounts',{'limit':25})
    def test_gmail_fixed_envelope(self):
        import base64,email
        gmail=object.__new__(Gmail)
        with patch.object(gmail,'api',return_value={'id':'id','labelIds':['SENT']}) as api:
            gmail.send_internal('[Loyverse Payments][Elevated] Test','Internal')
            raw=api.call_args.args[1]['raw']; msg=email.message_from_bytes(base64.urlsafe_b64decode(raw))
            self.assertEqual(msg['From'],'felipe.krugel@loyverse.com')
            self.assertEqual(msg['To'],'felipe.krugel@loyverse.com, caio.fiuza@loyverse.com, alex@loyverse.com')
            self.assertIsNone(msg['Cc']); self.assertIsNone(msg['Bcc'])
    def test_gmail_search_paginated(self):
        gmail=object.__new__(Gmail)
        with patch.object(gmail,'api',side_effect=[{'messages':[{'id':'1'}],'nextPageToken':'next'}, {'messages':[{'id':'2'}]}]):
            self.assertEqual(gmail.search('in:sent'),[{'id':'1'},{'id':'2'}])
    def monitor(self):
        st=state(); store=FakeStore(); return Monitor(st,store,{'run_budget_seconds':1000},now=100000)
    def test_failure_after_send_intent_never_resends(self):
        m=self.monitor(); m.add(Finding('acct_a','amount','Amount alert',['ch_test'],{'amount':150000})); m.group_alerts()
        gmail=object.__new__(Gmail); m.gmail=gmail
        with patch.object(gmail,'reconcile',return_value=([],[])), patch.object(gmail,'send_internal',side_effect=SafeError('network_or_response_error')) as send:
            with self.assertRaises(SafeError): m.deliver()
            self.assertEqual(send.call_count,1)
            self.assertEqual(m.store.writes[-1][1]['type'],'email_intent')
        with patch.object(gmail,'reconcile',return_value=([],[])),patch.object(gmail,'send_internal') as send,patch.object(m,'enqueue_telegram'):
            m.deliver(); send.assert_not_called()
    def test_sent_receipt_reconciles_uncertain_intent(self):
        m=self.monitor();m.add(Finding('acct_a','amount','Amount alert',['ch_test']));m.group_alerts()
        alert=next(iter(m.s['alerts'].values()));alert['email']={'status':'send_intent'}
        gmail=object.__new__(Gmail); m.gmail=gmail
        with patch.object(gmail,'reconcile',return_value=([{'id':'confirmed'}],[])),patch.object(gmail,'send_internal') as send,patch.object(m,'enqueue_telegram'):
            m.deliver();send.assert_not_called();self.assertEqual(alert['email']['status'],'sent')
    def test_existing_draft_held_not_sent(self):
        m=self.monitor();m.add(Finding('acct_a','amount','Amount alert',['ch_test']));m.group_alerts()
        gmail=object.__new__(Gmail);m.gmail=gmail
        with patch.object(gmail,'reconcile',return_value=([],[{'id':'draft'}])),patch.object(gmail,'send_internal') as send,patch.object(m,'enqueue_telegram'):
            m.deliver();send.assert_not_called();self.assertIn('existing_internal_draft_requires_review',m.s['gaps'])
    def test_refund_not_suppressed_by_success_baseline(self):
        m=self.monitor();m.s['seen_attempts']['acct_a|ch_old|succeeded']=1
        m.c['activation_epoch']=0
        m.observe_object('acct_a',{'id':'re_new','status':'pending','created':100000,'amount':1,'currency':'usd','charge':'ch_old'},'refund')
        self.assertEqual(len(m.new),1)
    def test_behaviour_repetition_suppressed_but_severity_increase_kept(self):
        m=self.monitor();m.add(Finding('acct_a','same-credential','Elevated',['a','b','c']))
        m.add(Finding('acct_a','same-credential','Elevated',['d','e','f']))
        self.assertEqual(len(m.new),1)
        m.add(Finding('acct_a','same-credential','Urgent',['g','h','i']))
        self.assertEqual(len(m.new),2)
    def test_refund_repetition_is_not_behaviour_suppression(self):
        m=self.monitor();m.add(Finding('acct_a','refund','Elevated',['re_a']))
        m.add(Finding('acct_a','refund','Elevated',['re_b']))
        self.assertEqual(len(m.new),2)
    def test_partial_processor_resume_skips_completed_partition(self):
        m=self.monitor();m.s['full']={'status':'in_progress','partitions':[{'from':0,'to':100,'complete':True},{'from':100,'to':200,'cursor':'fee_saved'}]}
        # The existing cursor is passed to Stripe; no reset to first page.
        stripe=object.__new__(Stripe);m.stripe=stripe
        p=m.s['full']['partitions'][1]
        with patch.object(stripe,'page',return_value={'data':[],'has_more':False}) as page,patch.object(m,'deliver'):
            m.fee_pass(p,{'limit':100});self.assertEqual(page.call_args.args[2],'fee_saved')
        self.assertTrue(p['complete'])
    def test_checkpoint_failure_prevents_email_side_effect(self):
        m=self.monitor();m.add(Finding('acct_a','amount','Amount alert',['ch_test']));m.group_alerts()
        gmail=object.__new__(Gmail);m.gmail=gmail
        with patch.object(gmail,'reconcile',return_value=([],[])),patch.object(m.store,'checkpoint',side_effect=SafeError('state_compare_and_swap_conflict')),patch.object(gmail,'send_internal') as send:
            with self.assertRaises(SafeError):m.deliver()
            send.assert_not_called()
    def test_cas_conflict_never_writes_new_commit(self):
        store=GitStore();store.sha='old'
        with patch.object(store,'file',return_value=(b'new','new')),patch.object(store,'api',side_effect=[{'object':{'sha':'head'}},{'tree':{'sha':'tree'}}]) as api,patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake'}):
            with self.assertRaises(SafeError):store.checkpoint({}, {'type':'test'})
            self.assertEqual(api.call_count,2)

class JournalTests(unittest.TestCase):
    def test_failed_checkpoint_does_not_advance_in_memory_audit_head(self):
        store=GitStore(); store.sha='committed'
        store.manifest={'format':'journal-v1','snapshot':{},'journals':[]}
        store.previous={'audit_head':'saved-head','alerts':{'existing':{'email':{'status':'sent'}}}}
        import copy
        current=copy.deepcopy(store.previous)
        def api(path,method='GET',data=None):
            if path=='git/ref/heads/master':return {'object':{'sha':'head'}}
            if path=='git/commits/head':return {'tree':{'sha':'base'}}
            if path=='git/trees':return {'sha':'tree'}
            if path=='git/commits':return {'sha':'orphan'}
            if path=='git/refs/heads/master':raise SafeError('github_git_refs_http_422')
            raise AssertionError(path)
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake'}),patch.object(store,'file',return_value=(b'existing','committed')),patch.object(store,'api',side_effect=api):
            with self.assertRaises(SafeError):store.checkpoint(current,{'type':'failed'})
        self.assertEqual(current['audit_head'],'saved-head')
        self.assertEqual(store.previous['audit_head'],'saved-head')
        self.assertEqual(store.manifest['journals'],[])
        self.assertEqual(current['alerts']['existing']['email']['status'],'sent')

    def test_checkpoint_after_failed_write_chains_to_last_committed_head(self):
        store=GitStore(); store.sha='committed'
        store.manifest={'format':'journal-v1','snapshot':{},'journals':[]}
        store.previous={'audit_head':'saved-head','events':{}}
        current={'audit_head':'saved-head','events':{}}
        calls=[];fail=True
        def api(path,method='GET',data=None):
            calls.append((path,method,data))
            if path=='git/ref/heads/master':return {'object':{'sha':'head'}}
            if path=='git/commits/head':return {'tree':{'sha':'base'}}
            if path=='git/trees':return {'sha':'tree'}
            if path=='git/commits':return {'sha':'new'}
            if path=='git/refs/heads/master':
                if fail:raise SafeError('github_git_refs_http_422')
                return {}
            raise AssertionError(path)
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake'}),patch.object(store,'file',return_value=(b'existing','committed')),patch.object(store,'api',side_effect=api):
            with self.assertRaises(SafeError):store.checkpoint(current,{'type':'failed'})
            fail=False
            current['events']['new']={'seen':True}
            store.checkpoint(current,{'type':'recovered'})
            tree=next(data for path,method,data in reversed(calls) if path=='git/trees')
            import json
            journal=next(e for e in tree['tree'] if e['path'].startswith('risk-monitor/audit/'))
            record=unseal(json.loads(journal['content']))
            self.assertEqual(record['audit']['previous_hash'],'saved-head')
            self.assertEqual(current['audit_head'],record['audit']['hash'])

    def test_large_snapshot_uses_blobs_and_one_atomic_ref_update(self):
        store=GitStore();calls=[]
        def api(path,method='GET',data=None):
            calls.append((path,method,data))
            if path=='git/blobs':return {'sha':'blob'}
            if path=='git/ref/heads/master':return {'object':{'sha':'head'}}
            if path=='git/commits/head':return {'tree':{'sha':'base'}}
            if path=='git/trees':return {'sha':'tree'}
            if path=='git/commits':return {'sha':'new'}
            if path=='git/refs/heads/master':return {}
            raise AssertionError(path)
        with patch('adapters.seal',return_value={'data':'x'*500001}),patch.object(store,'file',return_value=(None,None)),patch.object(store,'api',side_effect=api):
            store.checkpoint({'events':{}},{'type':'test'})
        entries=next(x[2]['tree'] for x in calls if x[0]=='git/trees')
        self.assertTrue(all('sha' in e and 'content' not in e for e in entries))
        self.assertEqual(sum(x[0]=='git/refs/heads/master' for x in calls),1)
        self.assertEqual(store.manifest['journals'],[])
    def test_missing_evaluation_timestamp_is_alarm_not_watchdog_crash(self):
        from watchdog import failures
        self.assertIn('charge_evaluation_overdue',failures({'mode':'active','last_evaluated_at':None,'checkpoint_at':None},100000))
    def replay(self, tamper=False, missing=False):
        import hashlib
        from adapters import canonical, seal
        initial={'nested':{'keep':1,'remove':2},'list':[1], 'audit_head':'before'}
        latest={'nested':{'keep':3,'new':4},'list':[1,2]}
        audit={'previous_hash':'before','event':{'type':'test'}}
        audit['hash']=hashlib.sha256(canonical(audit)).hexdigest()
        latest['audit_head']=audit['hash']
        store=GitStore()
        journal={'audit':audit,'patch':store.diff(initial,latest)}
        refs=[{'path':'snapshot','sha256':hashlib.sha256(canonical(initial)).hexdigest()},
              {'path':'journal','sha256':hashlib.sha256(canonical(journal)).hexdigest()}]
        manifest={'format':'journal-v1','snapshot':refs[0],'journals':[refs[1]]}
        if tamper:journal['patch']['set'].append((['corrupted'],True))
        files={'state':canonical(seal(manifest)),'snapshot':canonical(seal(initial)),
               'journal':None if missing else canonical(seal(journal))}
        store.path='state'
        with patch.object(store,'file',side_effect=lambda path:(files[path],'sha')):
            return store.load(),latest
    def test_replay_nested_changes_lists_and_deletions(self):
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake'}):
            actual,expected=self.replay();self.assertEqual(actual,expected)
    def test_tampered_journal_stops_recovery(self):
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake'}):
            with self.assertRaisesRegex(SafeError,'checksum_mismatch'):self.replay(tamper=True)
    def test_missing_journal_never_resets_history(self):
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fake'}):
            with self.assertRaisesRegex(SafeError,'missing_do_not_reset'):self.replay(missing=True)

if __name__=='__main__':unittest.main()
