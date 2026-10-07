"""Separate scheduler and state: detects silent monitor failure, never disables it.

Issues are tracked as one incident per code (risk-monitor/throttle.py). The
earlier build keyed notices on a hash of the whole issue set, so a set of n
fluctuating codes could produce up to 2**n notices for a single ongoing
problem. Confirmation, tiering and a daily cap decide when a tracked issue is
worth an email; everything observed is recorded either way.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from adapters import GitStore, Gmail, SafeError, canonical, load_module, verified_transport
import notify
import throttle

def close_recovery(state, notice):
    """Close the covered incidents only after both channel receipts are saved.

    Until both are confirmed the codes stay in `pending_recovery`, so a failed
    recovery send is retried on the next check instead of being lost.
    """
    if notice.get('email', {}).get('status') != 'sent' or notice.get('telegram', {}).get('status') != 'sent':
        return
    recovered = notice.get('recovers', [])
    if isinstance(recovered, str):
        recovered = [recovered]
    pending = state.setdefault('pending_recovery', {})
    failures_open = state.setdefault('open_failures', {})
    for key in recovered:
        pending.pop(key, None)
        failures_open.pop(key, None)
    state['current_failure'] = next(iter(failures_open), None)

def failures(health, now, workflow_active=True):
    result=[]
    if not workflow_active: result.append('monitor_workflow_disabled')
    if not health: return result+['monitor_heartbeat_missing']
    if now-(health.get('last_evaluated_at') or 0)>5400: result.append('charge_evaluation_overdue')
    if now-(health.get('checkpoint_at') or 0)>5400: result.append('monitor_heartbeat_overdue')
    if health.get('mode')!='active': result.append('migration_shadow_mode')
    result.extend(health.get('gap_codes',[]))
    if health.get('pending_alert_count',0) and now-(health.get('started_at') or 0)>3600:
        result.append('alert_delivery_overdue')
    return sorted(set(result))

def main():
    if os.environ.get('GITHUB_REPOSITORY')!='felipekrugel-eng/tars-overview' or os.environ.get('GITHUB_REF')!='refs/heads/master':
        raise SafeError('repository_or_branch_mismatch')
    config=json.loads(Path('risk-monitor/config.json').read_text())
    rules=throttle.policy(config)
    store=GitStore('risk-monitor/watchdog.enc.json')
    state=store.load() or {'schema_version':1,'notices':{},'current_failure':None}
    now=int(time.time())
    raw,_=store.file('risk-monitor/health.json'); heartbeat=json.loads(raw) if raw else None
    workflow=store.api('actions/workflows/loyverse-risk-monitor.yml')
    issues=failures(heartbeat,now,workflow.get('state')=='active')
    throttle.adopt_open_issues(state,issues,now)
    # One incident per issue code. A changing combination of codes can no longer
    # invent a new notice for a problem that is already reported.
    candidates,recovered=throttle.observe_health(state,issues,now,rules)
    report=throttle.health_due(candidates,state,now,rules)
    if report and not throttle.health_budget_ok(state,now,rules):
        report=[]
        state['health_capped_at']=now
    if not report and not recovered:
        state['checked_at']=now
        state['open_issue_codes']=sorted(issues)
        store.checkpoint(state,{'type':'watchdog_checked','issues':sorted(issues),
                                'result':'healthy' if not issues else 'tracked'})
        print('Watchdog checked; %d issue(s) tracked, nothing due to send.'%len(issues))
        return 0
    alert_id=('loyverse_payments_risk_v1:monitoring:'+throttle.incident_key(report) if report
              else 'loyverse_payments_risk_v1:monitoring-recovered:'+throttle.incident_key(recovered,'recovered'))
    relay,transport,private,sha=verified_transport(config)
    digest=hashlib.sha256(alert_id.encode()).hexdigest()
    receipt=transport.get('receipts',{}).get(digest)
    notice=state['notices'].setdefault(alert_id,{})
    if receipt:
        notice['telegram']=receipt
    if recovered:
        existing=notice.get('recovers',[])
        if isinstance(existing,str): existing=[existing]
        notice['recovers']=sorted(set(existing)|set(recovered))
    groups=throttle.classify(report)
    coverage=(heartbeat or {}).get('country_counts') or {}
    subject,body,text=notify.render_health(report,recovered,{
        'now':now,'alert_id':alert_id,'coverage':coverage,
        'tier':'critical' if groups['critical'] else 'operational',
        'action':('Check the monitor workflow run, then the credential and state diagnostics.'
                  if groups['critical'] else
                  'Review the monitor health snapshot; no immediate action may be needed.')})
    # Persist each channel's intent independently; Gmail failures do not block Telegram.
    if notice.get('email',{}).get('status')!='sent':
        try:
            gmail=Gmail(); sent,drafts=gmail.reconcile(alert_id)
            if sent: notice['email']={'status':'sent','id':sent[0]['id']}
            elif notice.get('email',{}).get('status') not in ('send_intent','uncertain') and not drafts:
                notice['email']={'status':'send_intent','at':now}
                store.checkpoint(state,{'type':'watchdog_email_intent','alert_id':alert_id})
                r=gmail.send_internal(subject,body)
                if not r.get('id') or 'SENT' not in r.get('labelIds',[]): raise SafeError('watchdog_email_uncertain')
                notice['email']={'status':'sent','id':r['id'],'at':int(time.time())}
                store.checkpoint(state,{'type':'watchdog_email_confirmed','alert_id':alert_id})
        except SafeError as exc:
            notice['email_gap']=str(exc)
    outbox='risk-telegram/outbox/'+digest+'.json'
    existing,_=store.file(outbox)
    if not receipt and not existing and notice.get('telegram',{}).get('status') not in ('send_intent','uncertain'):
        notice['telegram']={'status':'send_intent','at':now}
        store.checkpoint(state,{'type':'watchdog_telegram_intent','alert_id':alert_id})
        encrypt=load_module('risk-telegram/encrypt_alert.py','watchdog_encrypt')
        payload=encrypt.encrypt({'alert_id':alert_id,'text':text,'expires_at_epoch':now+86400},transport['public_key_pem'])
        store.api('contents/'+outbox,'PUT',{'message':'chore(risk): watchdog alarm','branch':'master',
                                           'content':base64.b64encode(canonical(payload)).decode()})
        notice['telegram']={'status':'enqueued','at':now}
    if report:
        throttle.record_health_notice(state,now,report)
    if recovered:
        close_recovery(state,notice)
    state['checked_at']=now
    state['open_issue_codes']=sorted(issues)
    store.checkpoint(state,{'type':'watchdog_checked','issues':sorted(issues),'alert_id':alert_id})
    print('Watchdog sent '+('failure alarm' if report else 'recovery')+' for %d code(s).'%len(report or recovered))
    return 0

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as exc:
        print('Watchdog failure: '+(str(exc) if isinstance(exc,SafeError) else 'runtime_failure'))
        sys.exit(2)
