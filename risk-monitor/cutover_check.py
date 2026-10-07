"""Read-only go/no-go for moving the monitor from shadow to active.

Each check restates one acceptance criterion from the build documentation. The
script changes nothing: it reads the public health snapshot, the encrypted
state, the pull evidence and the live credentials, and reports whether the
monitor is ready to own alerting.

A PASS here is not a promise that the next run is perfect. It means the
documented preconditions are met, so the remaining risk is the ordinary risk of
running the thing.
"""
import json
import os
import sys
import time
from pathlib import Path

from adapters import Gmail, Stripe, SafeError, verified_transport, RECIPIENTS, SENDER
from diagnose_state import inspect
from engine import epoch
import throttle

STATE = 'risk-monitor/state.enc.json'
TRANSACTIONS = 'payments-automation/data/pull_status.json'
MERCHANTS = 'merchant-base-automation/data/pull_status.json'


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, blocking=True):
        def wrap(fn):
            try:
                detail = fn()
                self.rows.append((name, 'PASS', detail or '', blocking))
            except SafeError as exc:
                self.rows.append((name, 'FAIL', str(exc), blocking))
            except Exception as exc:
                self.rows.append((name, 'FAIL', type(exc).__name__, blocking))
            return fn
        return wrap

    def render(self):
        width = max(len(r[0]) for r in self.rows)
        blocking = 0
        for name, status, detail, is_blocking in self.rows:
            flag = '' if status == 'PASS' else (' [BLOCKING]' if is_blocking else ' [advisory]')
            print('%-*s  %-4s  %s%s' % (width, name, status, detail, flag), flush=True)
            if status != 'PASS' and is_blocking:
                blocking += 1
        print('', flush=True)
        if blocking:
            print('NO-GO: %d blocking check(s) failed. Do not set mode to active.' % blocking,
                  flush=True)
        else:
            print('GO: documented preconditions are met. Follow risk-monitor/CUTOVER.md '
                  'from the activation step.', flush=True)
        return 1 if blocking else 0


def pull_fresh(path, limit_seconds, now):
    status = json.loads(Path(path).read_text())
    if not status.get('pull_succeeded'):
        raise SafeError('pull_not_succeeded')
    age = now - epoch(status['completed_at_utc'])
    if age > limit_seconds:
        raise SafeError('stale_by_%dh' % (age // 3600))
    return 'extracted %dh ago' % (age // 3600)


def main():
    now = int(time.time())
    print('Loyverse risk monitor — cutover readiness\n', flush=True)
    settings = json.loads(Path('risk-monitor/config.json').read_text())
    report = Report()

    health = json.loads(Path('risk-monitor/health.json').read_text())

    @report.check('Gap-free completed run')
    def _completed():
        if not health.get('last_completed_at'):
            raise SafeError('never_completed_a_gap_free_run')
        age = now - health['last_completed_at']
        if age > 86400:
            raise SafeError('last_completion_%dh_old' % (age // 3600))
        return 'completed %dh ago' % (age // 3600)

    @report.check('No open coverage gaps')
    def _gaps():
        gaps = health.get('gap_codes') or []
        if gaps:
            raise SafeError(','.join(sorted(gaps)))
        return 'none'

    @report.check('Monitor heartbeat current')
    def _heartbeat():
        age = now - (health.get('checkpoint_at') or 0)
        if age > 5400:
            raise SafeError('checkpoint_%dm_old' % (age // 60))
        return '%dm old' % (age // 60)

    @report.check('Transaction export fresh')
    def _transactions():
        return pull_fresh(TRANSACTIONS, 8 * 3600, now)

    @report.check('Merchant profile export fresh')
    def _merchants():
        return pull_fresh(MERCHANTS, 36 * 3600, now)

    @report.check('Account sweep complete')
    def _sweep():
        counts = health.get('country_counts') or {}
        if not counts:
            raise SafeError('no_country_counts')
        if not health.get('global_sweep_completed_at'):
            raise SafeError('sweep_never_completed')
        return '%d accounts across %d territories' % (
            health.get('global_progress_accounts', 0), len(counts))

    store, state, metadata = inspect(STATE)

    @report.check('State integrity and audit chain')
    def _integrity():
        if metadata['chain_gaps']:
            raise SafeError('%d_audit_chain_gap(s)' % len(metadata['chain_gaps']))
        return '%d journals, chain intact' % metadata['journal_count']

    @report.check('Shadow candidates reconciled')
    def _candidates():
        undecided = [a for a in state.get('alerts', {}).values()
                     if not (a.get('reconciled') or {}).get('decision')
                     and (a.get('email', {}).get('status') != 'sent'
                          or a.get('telegram', {}).get('status') != 'sent')]
        if undecided:
            raise SafeError('%d_candidate(s)_need_a_decision' % len(undecided))
        return 'all decided'

    @report.check('Uncertain deliveries resolved')
    def _uncertain():
        counts = metadata['delivery_status_counts']
        stuck = sum(counts[c].get(s, 0) for c in ('email', 'telegram')
                    for s in ('send_intent', 'uncertain'))
        if stuck:
            raise SafeError('%d_unreconciled_send(s)' % stuck)
        return 'none outstanding'

    @report.check('Activation boundary configured', blocking=False)
    def _activation():
        block = settings.get('activation') or {}
        missing = [k for k in ('boundary_epoch', 'legacy_alerting_retired') if k not in block]
        if missing:
            raise SafeError('set at step 4: config.activation.' + ', '.join(missing))
        if not block['legacy_alerting_retired']:
            raise SafeError('complete step 3, then set legacy_alerting_retired')
        if block['boundary_epoch'] > now:
            raise SafeError('boundary_epoch is in the future')
        return 'boundary set, legacy alerting retired'

    @report.check('Recipients and sender pinned')
    def _recipients():
        if settings['recipients'] != RECIPIENTS or settings['sender'] != SENDER:
            raise SafeError('config_diverges_from_code_constants')
        return '%s to %d recipients' % (SENDER, len(RECIPIENTS))

    @report.check('Telegram transport verified')
    def _telegram():
        verified_transport(settings)
        return 'destination and public key pinned'

    @report.check('Stripe live read access')
    def _stripe():
        stripe = Stripe()
        stripe.preflight()
        stripe.get('accounts', {'limit': 1})
        return 'platform pin verified'

    @report.check('Gmail sender identity')
    def _gmail():
        Gmail()
        return 'refresh token and mailbox confirmed'

    @report.check('External heartbeat configured')
    def _alarm():
        if not os.environ.get('RISK_HEARTBEAT_URL'):
            raise SafeError('RISK_HEARTBEAT_URL_not_set')
        return 'set'

    @report.check('Delivery budget sane', blocking=False)
    def _budget():
        rules = throttle.policy(settings)
        return ('%d/run, %d/day, %dh merchant cooldown'
                % (rules['max_emails_per_run'], rules['max_emails_per_day'],
                   rules['account_cooldown_seconds'] // 3600))

    print('', flush=True)
    code = report.render()
    print('\nThis check sent nothing and changed nothing.', flush=True)
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SafeError as exc:
        print('Cutover check stopped: ' + str(exc), flush=True)
        sys.exit(2)
