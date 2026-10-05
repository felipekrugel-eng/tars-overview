"""Separate scheduler and state: detects silent monitor failure, never disables it."""
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

MIGRATION_PROGRESS = {
    'migration_shadow_mode', 'run_budget_checkpointed', 'global_sweep_in_progress',
    'global_previous_day_incomplete', 'export_charge_cache_incomplete',
    'global_fingerprint_coverage_incomplete', 'fee_linked_export_reconciliation_incomplete',
    'aggregate_refund_scope_incomparable', 'aggregate_refund_comparison_unavailable',
    'onboarding_ip_coverage_incomplete',
}

def notice_key(state, issues, day):
    """Deduplicate shadow progress independently of its changing coverage flags."""
    migration = 'migration_shadow_mode' in issues
    operational = sorted(set(issues) - MIGRATION_PROGRESS) if migration else sorted(set(issues))
    prefix = 'code-monitor:' + day + ':'
    if migration and not operational:
        keys = state.setdefault('migration_notice_keys', {})
        if day not in keys:
            # Adopt today's already-sent legacy notice rather than emailing again
            # just because the dedupe format changed during this repair.
            previous = state.get('current_failure') or ''
            notice = state.get('notices', {}).get('loyverse_payments_risk_v1:monitoring:' + previous, {})
            has_delivery = (notice.get('email', {}).get('status') in ('sent', 'send_intent', 'uncertain')
                            or notice.get('telegram', {}).get('status') in ('sent', 'send_intent', 'uncertain', 'enqueued'))
            keys[day] = previous if previous.startswith(prefix) and has_delivery else prefix + 'migration-progress'
        return keys[day]
    return prefix + hashlib.sha256('|'.join(operational).encode()).hexdigest()[:16]

def close_recovery(state, notice):
    """Close the covered incidents only after both channel receipts are saved."""
    if notice.get('email', {}).get('status') != 'sent' or notice.get('telegram', {}).get('status') != 'sent':
        return
    recovered = notice.get('recovers', [])
    if isinstance(recovered, str):
        recovered = [recovered]
    for key in recovered:
        state['open_failures'].pop(key, None)
    state['current_failure'] = next(iter(state['open_failures']), None)

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
    store=GitStore('risk-monitor/watchdog.enc.json')
    state=store.load() or {'schema_version':1,'notices':{},'current_failure':None}
    now=int(time.time())
    raw,_=store.file('risk-monitor/health.json'); heartbeat=json.loads(raw) if raw else None
    workflow=store.api('actions/workflows/loyverse-risk-monitor.yml')
    issues=failures(heartbeat,now,workflow.get('state')=='active')
    day=datetime.fromtimestamp(now,ZoneInfo('Europe/London')).strftime('%Y%m%d')
    key=notice_key(state,issues,day) if issues else None
    open_failures=state.setdefault('open_failures',{})
    if state.get('current_failure'):open_failures.setdefault(state['current_failure'],{'at':now})
    recovery=not issues and bool(open_failures)
    recovery_key=next(iter(open_failures),None)
    if issues: alert_id='loyverse_payments_risk_v1:monitoring:'+key
    elif recovery: alert_id='loyverse_payments_risk_v1:monitoring-recovered:'+recovery_key
    else:
        state['checked_at']=now
        store.checkpoint(state,{'type':'watchdog_checked','result':'healthy'})
        print('Watchdog healthy; no alert.'); return 0
    relay,transport,private,sha=verified_transport(config)
    digest=hashlib.sha256(alert_id.encode()).hexdigest()
    receipt=transport.get('receipts',{}).get(digest)
    notice=state['notices'].setdefault(alert_id,{})
    if receipt:
        notice['telegram']=receipt
    if issues:
        state['current_failure']=key
        open_failures.setdefault(key,{'at':now})
    elif recovery:
        # Old issue combinations describe the same ongoing degraded episode.
        # One confirmed recovery closes them together, preserving their history.
        existing = notice.get('recovers', [])
        if isinstance(existing, str): existing = [existing]
        notice['recovers'] = sorted(set(existing) | set(open_failures))
    coverage=(heartbeat or {}).get('country_counts') or {'GB':'Unknown','PR':'Unknown','Unknown':'Unknown'}
    text=('Sweep: Monitoring '+('degraded' if issues else 'recovered')+
          '\nCoverage: '+json.dumps(coverage,sort_keys=True)+
          '; complete processor as-of '+str((heartbeat or {}).get('full_processor_completed_at'))+
          '\nResult: '+(', '.join(issues) if issues else 'Charge checks and required coverage recovered')+
          '\nRecommendation: '+('Investigate the monitor; incomplete coverage is not an all-clear.' if issues else 'Monitoring continues.'))[:3500]
    # Persist each channel's intent independently; Gmail failures do not block Telegram.
    if notice.get('email',{}).get('status')!='sent':
        try:
            gmail=Gmail(); sent,drafts=gmail.reconcile(alert_id)
            if sent: notice['email']={'status':'sent','id':sent[0]['id']}
            elif notice.get('email',{}).get('status') not in ('send_intent','uncertain') and not drafts:
                notice['email']={'status':'send_intent','at':now}
                store.checkpoint(state,{'type':'watchdog_email_intent','alert_id':alert_id})
                r=gmail.send_internal('[Loyverse Payments][Elevated] Monitoring '+('degraded' if issues else 'recovered'),text+'\n\n'+alert_id)
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
    if recovery:
        close_recovery(state, notice)
    state['checked_at']=now
    store.checkpoint(state,{'type':'watchdog_checked','issues':issues,'alert_id':alert_id})
    print('Watchdog checkpointed '+('failure alarm' if issues else 'recovery')+'.')
    return 0

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as exc:
        print('Watchdog failure: '+(str(exc) if isinstance(exc,SafeError) else 'runtime_failure'))
        sys.exit(2)
