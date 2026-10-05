"""Scheduled monitor: deterministic checks + encrypted durable outbox.

No payout/refund/dispute mutations; merchant communication is a review queue.
The legacy chat monitor remains active during the explicitly marked shadow phase.
"""
import base64
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import datetime, timezone
import csv
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import time
from zoneinfo import ZoneInfo

from adapters import (GitStore, Gmail, Stripe, SafeError, canonical, load_module, http,
                      verified_transport, SENDER, RECIPIENTS)
from engine import Attempt, Finding, LEVELS, PREFIX, epoch, evaluate, object_event, source_health, country_bucket

def config():
    value = json.loads(Path('risk-monitor/config.json').read_text())
    if value['recipients'] != RECIPIENTS or value['sender'] != SENDER:
        raise SafeError('fixed_recipient_config_changed')
    return value

def health(state, now, completed=False):
    # Public heartbeat deliberately contains no account, card, merchant or email data.
    return {'schema_version': 1, 'started_at': state['run_started'],
            'checkpoint_at': now, 'last_completed_at': state.get('last_completed'),
            'last_evaluated_at': state.get('last_evaluated'),
            'status': 'degraded' if state.get('gaps') else 'healthy' if completed else 'running',
            'mode': state['mode'], 'gap_codes': sorted(set(state.get('gaps', []))),
            'pending_alert_count': sum(x.get('email', {}).get('status') != 'sent' or
                                      x.get('telegram', {}).get('status') != 'sent'
                                      for x in state.get('alerts', {}).values()),
            'full_processor_completed_at': state.get('full_completed'),
            'global_sweep_completed_at': state.get('global', {}).get('completed_at'),
            'country_counts': state.get('global', {}).get('counts'),
            'processor_progress_checked': sum(p.get('checked', 0) for p in state.get('full', {}).get('partitions', [])),
            'global_progress_accounts': len(state.get('global', {}).get('records', {})),
            'gmail_completed_at': state.get('gmail_watermark'),
            'run_id': os.environ.get('GITHUB_RUN_ID')}

class Monitor:
    def __init__(self, state, store, settings, now=None):
        self.s = state
        self.store = store
        self.c = settings
        self.now = int(time.time()) if now is None else now
        self.deadline = time.monotonic()+settings.get('run_budget_seconds', 1000)
        self.gmail = None
        self.stripe = None
        self.new = []
        self._history_by_account = None
    def checkpoint(self, event, completed=False):
        return self.store.checkpoint(self.s, event, health(self.s, int(time.time()), completed))
    def gap(self, code):
        if code not in self.s['gaps']:
            self.s['gaps'].append(code)
    def budget(self):
        if time.monotonic() > self.deadline:
            raise SafeError('run_budget_checkpointed')
    def add(self, finding):
        if finding.alert_id in self.s['events']:
            return
        previous = self.s.setdefault('behaviour', {}).get(finding.account+'|'+finding.kind)
        repeatable = finding.kind not in ('amount', 'refund', 'dispute', 'refund-request', 'linkage')
        exposure = finding.evidence.get('total', finding.evidence.get('amount', 0))
        if repeatable and previous and self.now-previous['at'] < 86400 and \
                LEVELS[finding.level] <= LEVELS[previous['level']] and exposure <= previous.get('exposure', 0):
            # Retain evidence even when a same-severity repetition is suppressed.
            self.s['events'][finding.alert_id] = {'suppressed': True, 'finding': asdict(finding), 'at': self.now}
            return
        self.s.setdefault('behaviour', {})[finding.account+'|'+finding.kind] = {
            'at': self.now, 'level': finding.level, 'exposure': exposure}
        self.s['events'][finding.alert_id] = {'finding': asdict(finding), 'at': self.now, 'alert_id': None}
        self.new.append(finding.alert_id)
    def export(self):
        raw = Path('payments-automation/data/transactions.csv').read_bytes()
        rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
        status = json.loads(Path('payments-automation/data/pull_status.json').read_text())
        fresh = source_health(status, raw, len(rows), self.now, 8*3600)
        self.s['source_asof'] = status['completed_at_utc']
        self.s['transaction_source_fresh']=fresh
        if not fresh:
            self.gap('transaction_source_stale')
        attempts = []
        seen = set()
        for r in rows:
            try:
                amount = int(r['AMOUNT'])
                a = Attempt(r['CHARGE_ACCOUNT_ID'], r['CHARGE_ID'], epoch(r['CREATED_AT']),
                            amount, r['CURRENCY'].lower(), r['STATUS'].lower(), r.get('MERCHANT_COUNTRY') or None)
            except (ValueError, KeyError, TypeError):
                raise SafeError('invalid_export_row') from None
            if not a.account.startswith('acct_') or not a.id.startswith('ch_') or a.key in seen:
                raise SafeError('invalid_or_duplicate_export_charge')
            seen.add(a.key)
            prior = self.s.get('charges', {}).get(a.key, {})
            a = Attempt(**(asdict(a) | {'fingerprint': prior.get('fingerprint')}))
            attempts.append(a)
            self.s.setdefault('names', {})[a.account] = r.get('MERCHANT_NAME') or a.account
        groups = defaultdict(list)
        for a in attempts:
            groups[a.account].append(a)
        self.s['attempts'] = {a.key: asdict(a) for a in attempts}
        self._history_by_account = None
        for a in sorted(attempts, key=lambda x: (x.created, x.id)):
            # Each charge/status is distinct. Failed->succeeded is a new success.
            event_key = a.key+'|'+a.status
            if event_key in self.s['seen_attempts']:
                continue
            if not a.country:
                self.gap('merchant_country_unknown')
                continue
            account = self.s.get('accounts', {}).get(a.account, {})
            findings = evaluate(a, groups[a.account] if fresh else [a],
                                account.get('created'), self.pos_age(a.account, a.created))
            for finding in findings:
                self.add(finding)
            self.s['seen_attempts'][event_key] = self.now
        self.s['last_evaluated'] = self.now
        self.checkpoint({'type': 'export_evaluated', 'rows': len(rows), 'new_findings': len(self.new)})
    def profiles(self):
        path = Path('merchant-base-automation/data/q1_export.csv.gz')
        status_path = path.with_name('pull_status.json')
        status = json.loads(status_path.read_text())
        raw = path.read_bytes()
        if not status.get('pull_succeeded') or hashlib.sha256(raw).hexdigest() != status.get('sha256', {}).get(path.name):
            self.gap('merchant_source_unverified')
            return
        if self.now-epoch(status['completed_at_utc']) > 36*3600:
            self.gap('merchant_source_stale')
        rows = list(csv.DictReader(io.StringIO(gzip.decompress(raw).decode('utf-8-sig'))))
        if len(rows) != status['row_count']:
            raise SafeError('merchant_count_mismatch')
        profiles = defaultdict(list)
        for row in rows:
            if row.get('STRIPE_ACCOUNT_ID'):
                profiles[row['STRIPE_ACCOUNT_ID']].append(row)
        # Unambiguous exact account link, or authoritative owner_id; never names.
        self.s['profiles'] = {}
        for account, matches in profiles.items():
            owner = self.s.get('accounts', {}).get(account, {}).get('owner_id')
            linked = [r for r in matches if owner and r['MERCHANT_ID'] == owner]
            if len(linked) == 1:
                row, provenance = linked[0], 'live_metadata.owner_id'
            elif len(matches) == 1:
                row, provenance = matches[0], 'unique_STRIPE_ACCOUNT_ID'
            else:
                continue
            keys = ['MERCHANT_ID', 'JOINED_LOYVERSE', 'PULLED_AT', 'POS_GTV_12M_USD',
                    'POS_GTV_L30D_USD', 'POS_RECEIPTS_12M', 'POS_RECEIPTS_L30D']
            self.s['profiles'][account] = {k: row.get(k) for k in keys} | {'link_provenance': provenance}
        self.s['merchant_asof'] = status['completed_at_utc']
    def pos_age(self, account, timestamp):
        p = self.s.get('profiles', {}).get(account)
        if not p or not p.get('JOINED_LOYVERSE'):
            return None
        try:
            return (datetime.fromtimestamp(timestamp, timezone.utc).date()-
                    datetime.fromisoformat(p['JOINED_LOYVERSE'].replace('Z','+00:00')).date()).days
        except ValueError:
            return None
    def account(self, id):
        # Refresh every run; pause cause/start is never inferred.
        cached = self.s.setdefault('accounts', {}).get(id)
        if cached and cached.get('checked_at') == self.now:
            return cached
        a = self.stripe.get('accounts/'+id)
        if a.get('id') != id:
            raise SafeError('account_identity_mismatch')
        address = (a.get('company') or {}).get('address') or (a.get('individual') or {}).get('address') or {}
        verified = {'id': id, 'country': a.get('country'), 'bucket': country_bucket(a),
                    'created': a.get('created'), 'owner_id': (a.get('metadata') or {}).get('owner_id'),
                    'email': a.get('email'), 'charges_enabled': a.get('charges_enabled'),
                    'payouts_enabled': a.get('payouts_enabled'),
                    'disabled_reason': (a.get('requirements') or {}).get('disabled_reason'),
                    'tos_ip': (a.get('tos_acceptance') or {}).get('ip'), 'checked_at': self.now}
        self.s['accounts'][id] = verified
        return verified
    def fee(self, fee):
        if fee.get('livemode') is not True or not fee.get('account', '').startswith('acct_'):
            raise SafeError('fee_live_account_unknown')
        account_id = fee['account']
        a = self.account(account_id)
        charge = fee.get('charge')
        if not isinstance(charge, dict) or charge.get('object') != 'charge' or charge.get('livemode') is not True:
            raise SafeError('expanded_charge_unknown')
        key = account_id+'|'+charge['id']
        details = (charge.get('payment_method_details') or {})
        card = details.get('card_present') or details.get('card') or {}
        fp = card.get('fingerprint')
        # Hash verified fingerprints before keeping them; no last4/PAN/expiry.
        fingerprint = hashlib.sha256((details.get('type', '')+'|'+fp).encode()).hexdigest() if fp else None
        row = {'account': account_id, 'id': charge['id'], 'created': charge['created'],
               'amount': charge['amount'], 'currency': charge['currency'], 'status': charge['status'],
               'country': a['country'], 'fingerprint': fingerprint}
        self.s.setdefault('charges', {})[key] = row | {'checked_at': self.now}
        current = Attempt(**row)
        if self._history_by_account is not None:
            self._history_by_account.setdefault(account_id, {})[key] = row
        status_key = key+'|'+current.status
        if status_key not in self.s['seen_attempts'] or self.s['seen_attempts'][status_key] == self.now:
            history = self.history_for(current)
            for finding in evaluate(current, history, a.get('created'), self.pos_age(account_id, current.created)):
                self.add(finding)
            self.s['seen_attempts'][status_key] = self.now
        elif fingerprint and self.now-current.created <= 86400 and self.s['seen_attempts'].get(status_key)!=1:
            # New authoritative fingerprint can complete a recent pattern.
            history = self.history_for(current)
            for finding in evaluate(current, history):
                if finding.kind == 'same-credential':
                    self.add(finding)
        if not a.get('country'):
            self.gap('live_merchant_country_unknown')
            return
        if a['country'] != 'US':
            return
        refunds = charge.get('refunds')
        if not isinstance(refunds, dict) or not isinstance(refunds.get('data'), list):
            raise SafeError('refund_list_unknown')
        objects = list(refunds['data'])
        cursor = objects[-1]['id'] if objects else None
        more = refunds.get('has_more')
        if more is None:
            raise SafeError('refund_coverage_unknown')
        while more:
            self.budget()
            params = {'charge': charge['id'], 'limit': 100}
            if cursor:
                params['starting_after'] = cursor
            page = self.stripe.get('refunds', params, account=account_id)
            if not page.get('data') and page.get('has_more'):
                raise SafeError('refund_pagination_invalid')
            objects.extend(page['data'])
            more = page['has_more']
            cursor = objects[-1]['id'] if objects else None
        for obj in objects:
            if obj.get('object') != 'refund' or obj.get('charge') != charge['id']:
                raise SafeError('refund_charge_identity_unknown')
            self.observe_object(account_id, obj, 'refund')
        if 'dispute' not in charge:
            raise SafeError('dispute_field_unknown')
        if charge['dispute'] is not None:
            obj = charge['dispute']
            if not isinstance(obj, dict) or obj.get('object') != 'dispute' or obj.get('charge') != charge['id']:
                raise SafeError('dispute_charge_identity_unknown')
            self.observe_object(account_id, obj, 'dispute')
    def history_for(self, current):
        if not self.s.get('transaction_source_fresh', False):
            return [current]
        if self._history_by_account is None:
            self._history_by_account = defaultdict(dict)
            for key, value in self.s.get('attempts', {}).items():
                self._history_by_account[value['account']][key] = value
            for key, value in self.s.get('charges', {}).items():
                self._history_by_account[value['account']][key] = value
        fields = ('account', 'id', 'created', 'amount', 'currency', 'status', 'country', 'fingerprint')
        return [Attempt(**{key: value.get(key) for key in fields})
                for value in self._history_by_account.get(current.account, {}).values()]
    def observe_object(self, account, obj, kind):
        key = account+'|'+obj['id']
        old = self.s.setdefault(kind+'s', {}).get(key)
        finding, record = object_event(account, obj, old, self.now, kind, self.c['activation_epoch'])
        record['charge_id'] = obj.get('charge')
        self.s[kind+'s'][key] = record
        if finding:
            self.add(finding)
    def fee_pass(self, progress, params):
        last_checkpoint = time.monotonic()
        while not progress.get('complete'):
            self.budget()
            page = self.stripe.page('application_fees', params, progress.get('cursor'))
            for fee in page['data']:
                self.fee(fee)
            if page['data']:
                cursor = page['data'][-1]['id']
                if cursor == progress.get('cursor'):
                    raise SafeError('fee_cursor_not_advancing')
                progress['cursor'] = cursor
            progress['complete'] = not page['has_more']
            progress['checked'] = progress.get('checked', 0)+len(page['data'])
            findings_ready = bool(self.new)
            self.group_alerts()
            # Old backfill pages do not require one Git commit per 100 fees.
            # Save at least once per minute, at completion, or before a new alert
            # can be delivered. Failure/budget handling also saves the cursor.
            if progress['complete'] or findings_ready or time.monotonic()-last_checkpoint >= 60:
                self.checkpoint({'type': 'fee_page', 'checked': progress['checked'], 'complete': progress['complete']})
                self.deliver()
                last_checkpoint = time.monotonic()
    def live(self):
        self.stripe = Stripe()
        self.stripe.preflight()
        incremental = self.s.get('incremental')
        if not incremental or incremental.get('complete'):
            incremental = {'from': (self.s.get('last_incremental') or self.c['legacy_last_completed'])-86400,
                           'to': self.now, 'complete': False}
            self.s['incremental'] = incremental
        params = {'limit': 100, 'expand[]': ['data.charge.refunds', 'data.charge.dispute'],
                  'created[gte]': incremental['from'], 'created[lt]': incremental['to']}
        self.fee_pass(incremental, params)
        self.s['last_incremental'] = incremental['to']
        watched = {x.get('charge_id') for objects in ('refunds','disputes')
                   for x in self.s.get(objects, {}).values() if x.get('charge_id')}
        watched |= set(self.s.get('watched_charge_ids', []))
        for charge in sorted(watched):
            self.budget()
            page = self.stripe.page('application_fees', {'limit': 100, 'charge': charge,
                                      'expand[]': ['data.charge.refunds','data.charge.dispute']})
            for fee in page['data']:
                self.fee(fee)
            if page['has_more']:
                self.gap('watched_fee_pagination_incomplete')
        # Give account enumeration its own bounded share of each run. Historical
        # charge backfills must not starve the independent daily account sweep.
        overall_deadline = self.deadline
        self.deadline = min(overall_deadline, time.monotonic() + 180)
        try:
            self.global_sweep()
        except SafeError as exc:
            if str(exc) != 'run_budget_checkpointed':
                raise
            self.gap('global_sweep_in_progress')
        finally:
            self.deadline = overall_deadline
        missing_cache=any(x['status']=='succeeded' and k not in self.s.get('charges',{})
                          for k,x in self.s.get('attempts',{}).items())
        if missing_cache or not self.s.get('full_completed') or self.now-self.s['full_completed'] >= 86400 or self.s.get('full', {}).get('status') == 'in_progress':
            full = self.s.setdefault('full', {'status': 'in_progress', 'started': self.now,
                                              'partitions': [{'from':0,'to':self.now}]})
            if full.get('status') != 'in_progress':
                full = {'status':'in_progress','started':self.now,'partitions':[{'from':0,'to':self.now}]}
                self.s['full'] = full
            for p in full['partitions']:
                if p.get('complete'):
                    continue
                self.fee_pass(p, {'limit':100,'created[gte]':p['from'],'created[lt]':p['to'],
                                 'expand[]':['data.charge.refunds','data.charge.dispute']})
            full['status'] = 'complete'
            self.s['full_completed'] = self.now
        if self.s.get('global', {}).get('complete'):
            # Refresh fingerprint linkage and coverage after the charge sweep.
            self.global_sweep()
        self.aggregate_refunds()
        # Fee-linked access must reconcile against all succeeded export keys.
        missing = [k for k,x in self.s.get('attempts', {}).items()
                   if x['status']=='succeeded' and x['country']=='US' and k not in self.s['charges']]
        if missing:
            self.gap('fee_linked_export_reconciliation_incomplete')
        self.checkpoint({'type':'live_complete','missing_fee_charge_count':len(missing)})
    def aggregate_refunds(self):
        if not self.s.get('full_completed') or self.now-self.s['full_completed']>86400:
            self.gap('aggregate_refund_comparison_unavailable')
            return
        if any(x['status']=='succeeded' and x['country']=='US' and k not in self.s.get('charges',{})
               for k,x in self.s.get('attempts',{}).items()):
            self.gap('aggregate_refund_scope_incomparable')
            return
        gross=defaultdict(int); refunds=defaultdict(int)
        for charge in self.s.get('charges',{}).values():
            if charge['status']=='succeeded' and charge['country']=='US':
                gross[charge['account']+'|'+charge['currency']]+=charge['amount']
        for key,obj in self.s.get('refunds',{}).items():
            if obj.get('status')=='succeeded':
                refunds[key.split('|')[0]+'|'+obj['currency']]+=obj['amount']
        for key,amount in refunds.items():
            volume=gross.get(key,0)
            if amount<100000 or volume<=0 or amount*5<volume:
                continue
            account,currency=key.split('|')
            tier='Urgent' if amount*2>=volume else 'Elevated'
            old=self.s.setdefault('refund_tiers',{}).get(key,{})
            if old.get('level')==tier and amount-old.get('amount',0)<100000:
                continue
            self.add(Finding(account,'aggregate-refund',tier,[currency+':'+str(amount)],
                             {'refund_minor':amount,'gross_minor':volume,'currency':currency,
                              'coverage_asof':self.s['full_completed']}))
            self.s['refund_tiers'][key]={'level':tier,'amount':amount}
    def global_sweep(self):
        last_checkpoint = time.monotonic()
        day = datetime.fromtimestamp(self.now, ZoneInfo('Europe/London')).strftime('%Y%m%d')
        g = self.s.get('global', {})
        if g.get('day') != day:
            # Retain partial previous coverage until completed; do not reset it.
            if g and not g.get('complete'):
                self.gap('global_previous_day_incomplete')
            else:
                g = {'day':day,'records':{},'complete':False}
                self.s['global'] = g
        while not g.get('complete'):
            self.budget()
            page = self.stripe.page('accounts', {'limit':25}, g.get('cursor'))
            for a in page['data']:
                # Account list can omit detail. Fetch the authoritative object.
                verified = self.account(a['id'])
                if a['id'] in g['records']:
                    raise SafeError('global_duplicate_account')
                g['records'][a['id']] = verified
            if page['data']:
                g['cursor'] = page['data'][-1]['id']
            g['complete'] = not page['has_more']
            if g['complete'] or time.monotonic()-last_checkpoint >= 60:
                self.checkpoint({'type':'global_page','total':len(g['records']),'complete':g['complete']})
                last_checkpoint = time.monotonic()
        # A resumed prior-day cursor completes today's sweep. Refresh retained
        # records before publishing completion, without starting enumeration over.
        g['day'] = day
        for account_id, record in list(g['records'].items()):
            if record.get('checked_at') != self.now:
                self.budget()
                g['records'][account_id] = self.account(account_id)
        g['completed_at'] = self.now
        self.s['gaps'] = [code for code in self.s['gaps'] if code not in ('global_sweep_in_progress','global_previous_day_incomplete')]
        buckets = Counter(a['bucket'] for a in g['records'].values())
        buckets.setdefault('GB',0); buckets.setdefault('PR',0); buckets.setdefault('Unknown',0)
        g['counts'] = dict(sorted(buckets.items()))
        if any(not a.get('tos_ip') for a in g['records'].values()):self.gap('onboarding_ip_coverage_incomplete')
        ips = defaultdict(set)
        for a in g['records'].values():
            if a.get('tos_ip'):
                import ipaddress
                try:
                    ip = ipaddress.ip_address(a['tos_ip'])
                    if ip.is_global:
                        ips[str(ip)].add(a['id'])
                except ValueError:
                    self.gap('onboarding_ip_invalid')
        fingerprints = defaultdict(set)
        for ch in self.s.get('charges', {}).values():
            if ch['status']=='succeeded' and ch.get('fingerprint'):
                fingerprints[ch['fingerprint']+'|'+ch['currency']].add(ch['account'])
        clusters = [(kind,evidence,accounts) for kind,groups in [('IP',ips),('fingerprint',fingerprints)]
                    for evidence,accounts in groups.items() if len(accounts)>=2]
        for kind,evidence,accounts in clusters:
            # Persist hashed linkage identity; message never exposes credentials/IP.
            id = hashlib.sha256((kind+'|'+evidence+'|'+ '|'.join(sorted(accounts))).encode()).hexdigest()
            self.add(Finding('cross-account','linkage','Elevated',[id],
                             {'kind':kind,'accounts':sorted(accounts),'lead_only':True}))
        g['clusters_reviewed'] = len(clusters)
        # Complete account enumeration is not complete payment fingerprint coverage.
        fingerprint_incomplete = not self.s.get('full_completed') or self.now-self.s['full_completed']>86400 or any(
            x['status']=='succeeded' and (k not in self.s.get('charges',{}) or not self.s['charges'][k].get('fingerprint')) for k,x in self.s.get('attempts',{}).items())
        if fingerprint_incomplete:
            self.gap('global_fingerprint_coverage_incomplete')
        else:
            self.s['gaps'] = [code for code in self.s['gaps'] if code != 'global_fingerprint_coverage_incomplete']
        self.checkpoint({'type':'global_complete','counts':g['counts'],'clusters':len(clusters)})
        # Status/recovery transport is enabled only after production cutover.
        if self.s['mode']=='active' and not any(x in self.s['gaps'] for x in ('global_fingerprint_coverage_incomplete','onboarding_ip_coverage_incomplete')):
            id=PREFIX+'sweep-status:'+g['day']
            if id not in self.s.setdefault('sweep_notices',{}):
                notice={'alert_id':id}
                self.s['sweep_notices'][id]=notice
                text=('Sweep: Completed '+g['day']+'\nCoverage: '+json.dumps(g['counts'],sort_keys=True)+
                      '\nResult: '+str(len(clusters))+' IP/fingerprint clusters reviewed; new/material links queued.'+
                      '\nRecommendation: '+('Review new linkage leads.' if clusters else 'Monitoring continues.'))
                self.enqueue_telegram(notice,text)
    def gmail_requests(self):
        if not self.gmail:
            self.gmail = Gmail()
        start = self.s.get('gmail_watermark', self.c['activation_epoch'])-86400
        items = self.gmail.search('{refund reimbursement chargeback dispute} -in:sent -in:drafts after:'+str(start))
        complete=True
        for item in items:
            if item['id'] in self.s.setdefault('gmail_seen', {}):
                continue
            self.budget()
            m = self.gmail.api('messages/'+item['id']+'?format=full')
            def text_parts(p):
                out = []
                if p.get('mimeType') == 'text/plain' and p.get('body', {}).get('data'):
                    data = p['body']['data']; out.append(base64.urlsafe_b64decode(data+'='*(-len(data)%4)).decode('utf-8','replace'))
                for child in p.get('parts',[]):
                    out.extend(text_parts(child))
                return out
            body = '\n'.join(text_parts(m.get('payload',{})))
            # Do not classify snippets, HTML-only bodies, or quoted history.
            if not body:
                self.gap('gmail_original_body_unknown')
                complete=False
                continue
            body = re.split(r'(?m)^On .+wrote:|^>.*|^-{2,}\s*Original Message', body)[0]
            lower = body.lower()
            ids = re.findall(r'(?:acct_|ch_|re_|dp_)[A-Za-z0-9]+', body)
            relevant = ('loyverse payments' in lower or ids) and bool(re.search(r'refund|reimbursement|chargeback|dispute',lower))
            feature = bool(re.search(r'how (?:do|can|to).{0,30}refund|refund feature|return.{0,20}terminal|hardware return',lower))
            if relevant and not feature:
                account_ids = {x for x in ids if x.startswith('acct_') and x in self.s.get('accounts',{})}
                charge_ids = {x for x in ids if x.startswith('ch_')}
                account_ids |= {v['account'] for v in self.s.get('charges',{}).values() if v['id'] in charge_ids}
                account = next(iter(account_ids)) if len(account_ids)==1 else 'unresolved-request'
                self.add(Finding(account,'refund-request','Elevated',[item['id']],
                                 {'message_id':item['id'],'matched_ids':ids,'match_verified':len(account_ids)==1,
                                  'status':'requested','requires_human_body_review':True}))
            self.s['gmail_seen'][item['id']] = self.now
        if complete:
            self.s['gmail_watermark'] = self.now
        self.checkpoint({'type':'gmail_scan_complete','messages':len(items)})
    def group_alerts(self):
        groups = defaultdict(list)
        for id in self.new:
            event = self.s['events'][id]
            if not event.get('alert_id') and not event.get('suppressed'):
                groups[event['finding']['account']].append(id)
        for account, ids in groups.items():
            # One merchant/run aggregation, append new evidence to pending alert.
            pending = next((a for a in self.s['alerts'].values() if a.get('account')==account
                            and not a.get('email') and not a.get('telegram')),None)
            if pending:
                pending['events'] = sorted(set(pending['events']+ids))
                alert_id = pending['alert_id']
            else:
                digest = hashlib.sha256('|'.join(sorted(ids)).encode()).hexdigest()[:24]
                alert_id = PREFIX+account+':events:'+digest
                self.s['alerts'][alert_id] = {'alert_id':alert_id,'account':account,'events':sorted(ids),
                                             'created_at':self.now,'run_id':self.store.run_id}
            for id in ids:
                self.s['events'][id]['alert_id'] = alert_id
        self.new.clear()
    def content(self, alert):
        findings = [self.s['events'][id]['finding'] for id in alert['events']]
        level = max((x['level'] for x in findings),key=lambda x:LEVELS[x])
        account = alert['account']; live = self.s.get('accounts',{}).get(account,{})
        pause = live.get('payouts_enabled') is False and live.get('disabled_reason') == 'platform_paused'
        recommendation = 'Keep the existing payout pause pending human investigation' if pause else 'Investigate; human action required'
        name = self.s.get('names',{}).get(account,account)
        history = [x for x in self.s.get('attempts',{}).values() if x['account']==account]
        metrics = {}
        for label, seconds in [('24h',86400),('7d',7*86400),('30d',30*86400),('cumulative',None)]:
            rows=[x for x in history if x['status']=='succeeded' and (seconds is None or x['created']>=self.now-seconds)]
            totals=defaultdict(int)
            for row in rows: totals[row['currency']]+=row['amount']
            metrics[label]={'counts':len(rows),'minor_units_by_currency':dict(totals)}
        body=(f'Level: {level}\nRecommendation: {recommendation}\nReason/evidence:\n'+
              '\n'.join(json.dumps(x,sort_keys=True) for x in findings)+
              '\nGaps: '+(', '.join(self.s['gaps']) or 'Public legitimacy and document review remain human tasks')+
              '\nNext steps: Review the evidence and supporting documents. No account action was executed.'+
              '\nAccount: '+account+'\nLive status / owner linkage: '+json.dumps(live,sort_keys=True)+
              '\nPayments volumes / counts: '+json.dumps(metrics,sort_keys=True)+
              '\nPOS profile / exact linkage: '+json.dumps(self.s.get('profiles',{}).get(account,{}),sort_keys=True)+
              '\nTransaction source as-of: '+str(self.s.get('source_asof'))+
              '\nHistorical processor coverage as-of: '+str(self.s.get('full_completed'))+
              '\nMissing fields are unknown. Fingerprints are not unique people or physical cards.'+
              '\n\n'+alert['alert_id']+'\n'+'\n'.join(alert['events']))
        # Exclude emails/owner/card attributes from Telegram text.
        text=(f'Account: {account}\nBehaviour: '+', '.join(x['kind'] for x in findings)+
              f'. Level {level}. Source as-of {self.s.get("source_asof")}. Delayed evidence where applicable.'+
              f'\nRecommendation: {recommendation}.')[:3500]
        return f'[Loyverse Payments][{level}] {name} – investigate',body,text
    def deliver(self):
        if self.s['mode'] != 'active':
            return
        for alert in self.s['alerts'].values():
            self.budget()
            if alert.get('email',{}).get('status')!='sent' and any(
                a.get('account')==alert['account'] and a.get('delivered_run_id')==self.store.run_id
                for a in self.s['alerts'].values() if a is not alert):
                continue
            subject,body,text = self.content(alert)
            if self.gmail and alert.get('email',{}).get('status') != 'sent':
                sent,drafts = self.gmail.reconcile(alert['alert_id'])
                if sent:
                    alert['email']={'status':'sent','message_id':sent[0]['id'],'reconciled':True}
                    self.checkpoint({'type':'email_reconciled','alert_id':alert['alert_id']})
                elif alert.get('email',{}).get('status') in ('send_intent','uncertain'):
                    self.gap('email_delivery_uncertain')
                elif drafts:
                    self.gap('existing_internal_draft_requires_review')
                else:
                    alert['email']={'status':'send_intent','at':self.now}
                    self.checkpoint({'type':'email_intent','alert_id':alert['alert_id']})
                    try:
                        result=self.gmail.send_internal(subject,body)
                        if not result.get('id') or 'SENT' not in result.get('labelIds',[]):
                            raise SafeError('email_send_unconfirmed')
                        alert['email']={'status':'sent','message_id':result['id'],'at':int(time.time())}
                        alert['delivered_run_id']=self.store.run_id
                        self.checkpoint({'type':'email_confirmed','alert_id':alert['alert_id']})
                    except Exception:
                        # Intent already persisted; never blindly retry.
                        self.gap('email_delivery_uncertain')
                        raise SafeError('email_delivery_uncertain') from None
            if not self.gmail:
                self.gap('gmail_oauth_missing')
            self.enqueue_telegram(alert,text)

    def enqueue_telegram(self, alert, text):
        relay, transport, private, sha = verified_transport(self.c)
        digest=hashlib.sha256(alert['alert_id'].encode()).hexdigest()
        receipt=transport.get('receipts',{}).get(digest)
        if receipt:
            if receipt.get('status')!='sent':self.gap('telegram_delivery_unconfirmed')
            alert['telegram']=receipt
            self.checkpoint({'type':'telegram_receipt','alert_id':alert['alert_id'],'status':receipt['status']})
            return
        path='risk-telegram/outbox/'+digest+'.json'
        existing,_=self.store.file(path)
        if existing:
            self.gap('telegram_delivery_unconfirmed')
            alert['telegram']={'status':'enqueued','receipt_key':digest}
            return
        if alert.get('telegram',{}).get('status') in ('send_intent','uncertain'):
            self.gap('telegram_enqueue_uncertain')
            return
        alert['telegram']={'status':'send_intent','receipt_key':digest}
        self.checkpoint({'type':'telegram_enqueue_intent','alert_id':alert['alert_id']})
        encrypt=load_module('risk-telegram/encrypt_alert.py','risk_encrypt')
        envelope=encrypt.encrypt({'alert_id':alert['alert_id'],'text':text,'expires_at_epoch':self.now+86400},
                                 transport['public_key_pem'])
        # Ciphertext only on master, existing path checked above, no side-effect retry.
        self.store.api('contents/'+path,'PUT',{'message':'chore(risk): enqueue encrypted alert','branch':'master',
                                             'content':base64.b64encode(canonical(envelope)).decode()})
        self.gap('telegram_delivery_unconfirmed')
        alert['telegram']={'status':'enqueued','receipt_key':digest,'at':self.now}
        self.checkpoint({'type':'telegram_enqueued','alert_id':alert['alert_id']})

def external_heartbeat(ok):
    """Dead-man check hosted outside GitHub, configured for approved recipients.

    Only a health ping is transmitted. No accounts, cards, bodies or secrets are logged.
    """
    import urllib.parse
    url=os.environ.get('RISK_HEARTBEAT_URL')
    if not url:
        raise SafeError('external_deadman_alarm_not_configured')
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!='https' or parsed.hostname not in ('hc-ping.com','healthchecks.io') or parsed.username:
        raise SafeError('external_deadman_endpoint_unverified')
    # Ping endpoints return text, so use a narrow direct request and never print URL.
    import urllib.request
    try:
        with urllib.request.urlopen(url if ok else url.rstrip('/')+'/fail',timeout=15) as response:
            if response.status!=200:raise SafeError('external_deadman_ping_failed')
    except Exception:
        raise SafeError('external_deadman_ping_failed') from None

def main():
    if os.environ.get('GITHUB_REPOSITORY') != 'felipekrugel-eng/tars-overview' or os.environ.get('GITHUB_REF') != 'refs/heads/master':
        raise SafeError('repository_or_branch_mismatch')
    settings=config(); store=GitStore(); state=store.load()
    if state is None:
        existing_health,_=store.file('risk-monitor/health.json')
        if existing_health:
            raise SafeError('durable_state_missing_do_not_rebootstrap')
        relay,transport,private,sha=verified_transport(settings)
        bootstrap=json.loads(Path('risk-monitor/bootstrap.enc.json').read_text())
        package=relay.decrypt_alert(bootstrap,private)
        raw=gzip.decompress(base64.b64decode(package['payload_gzip_base64'],validate=True))
        if hashlib.sha256(raw).hexdigest()!=settings['bootstrap_raw_sha256']:
            raise SafeError('bootstrap_checksum_mismatch')
        state=json.loads(raw)
        if state.get('schema_version') != 1 or state.get('legacy_sha256') != settings['legacy_sha256']:
            raise SafeError('bootstrap_identity_mismatch')
    state.update(run_started=int(time.time()),gaps=[],mode=settings['mode'])
    monitor=Monitor(state,store,settings)
    monitor.checkpoint({'type':'run_started','code_sha':os.environ.get('GITHUB_SHA'),'mode':settings['mode']})
    try:
        if not os.environ.get('RISK_HEARTBEAT_URL'):
            monitor.gap('external_deadman_alarm_not_configured')
        try: monitor.gmail=Gmail()
        except SafeError as exc: monitor.gap(str(exc))
        try: monitor.profiles()
        except Exception: monitor.gap('merchant_source_unverified')
        monitor.export()
        monitor.group_alerts(); monitor.checkpoint({'type':'export_outbox_ready'}); monitor.deliver()
        try: monitor.gmail_requests()
        except SafeError as exc: monitor.gap(str(exc))
        try: monitor.live()
        except (SafeError,ValueError) as exc: monitor.gap(str(exc) if isinstance(exc,SafeError) else 'processor_data_unknown')
        monitor.group_alerts(); monitor.checkpoint({'type':'outbox_ready'}); monitor.deliver()
        # Never advance the comprehensive completion watermark for incomplete scope.
        if not state['gaps']:
            state['last_completed']=monitor.now
        state['last_run_finished']=int(time.time())
        monitor.checkpoint({'type':'run_finished','gaps':sorted(state['gaps'])},completed=True)
        if os.environ.get('RISK_HEARTBEAT_URL'):
            external_heartbeat(not state['gaps'] and state['mode']=='active')
        print('Risk checks checkpointed; status '+('degraded' if state['gaps'] else 'healthy')+'.')
        if state['gaps']: return 2
        return 0
    except Exception as exc:
        monitor.gap(str(exc) if isinstance(exc,SafeError) else 'runtime_failure')
        monitor.group_alerts()
        monitor.checkpoint({'type':'run_failed','gaps':sorted(state['gaps'])},completed=True)
        print('Risk check incomplete; durable progress retained.')
        return 2

if __name__=='__main__':
    try: sys.exit(main())
    except SafeError as exc:
        print('Risk monitor stopped: '+str(exc)); sys.exit(2)
