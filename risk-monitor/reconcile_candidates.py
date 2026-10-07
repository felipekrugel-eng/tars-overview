"""Report accumulated shadow candidates and record a decision for each.

Shadow mode has been recording merchant risk candidates without sending them.
Activating the monitor without deciding what to do with that backlog would
deliver findings the ChatGPT task has very likely already alerted on.

The default run is read-only: it prints each pending candidate alongside the
evidence that something already covered it — a message in the authorised
mailbox's Sent folder naming the same account or charge, or a confirmed
Telegram receipt. Judgement stays with the operator; a Sent match is a strong
hint, not proof that the same finding was communicated.

`--decide` records a decision durably. `baseline` means the candidate is
accepted as already handled and will never send; `send` releases it to deliver
on the next active run. Both are recorded in the audit chain with the actor.
"""
import argparse
import json
import os
import sys
import time

from adapters import Gmail, SafeError
from diagnose_state import inspect
from engine import LEVELS
import notify

STATE = 'risk-monitor/state.enc.json'


def pending(state):
    """Alerts with an outstanding channel and no recorded decision."""
    out = []
    for alert in state.get('alerts', {}).values():
        if alert.get('email', {}).get('status') == 'sent' and \
                alert.get('telegram', {}).get('status') == 'sent':
            continue
        out.append(alert)
    return sorted(out, key=lambda a: (a.get('created_at', 0), a.get('alert_id', '')))


def describe(state, alert):
    findings = [state['events'][i]['finding'] for i in alert.get('events', [])
                if i in state.get('events', {})]
    level = max((f['level'] for f in findings), key=lambda x: LEVELS[x]) if findings else 'Elevated'
    ids = []
    for finding in findings:
        for value in finding.get('ids', []):
            head = str(value).split(':')[0]
            if head.startswith(('ch_', 're_', 'dp_')) and head not in ids:
                ids.append(head)
    return {'alert_id': alert['alert_id'], 'account': alert['account'],
            'name': state.get('names', {}).get(alert['account'], alert['account']),
            'level': level, 'created_at': alert.get('created_at'),
            'kinds': sorted({f['kind'] for f in findings}),
            'object_ids': ids, 'findings': findings,
            'decision': (alert.get('reconciled') or {}).get('decision')}


def coverage(gmail, entry):
    """Look for prior communication about this account or its charges.

    Searches the authorised mailbox only. A hit means some message in Sent
    mentions the identifier; it does not prove the same finding was raised.
    """
    if not gmail:
        return {'checked': False}
    found = {}
    terms = [entry['account']] + entry['object_ids'][:4]
    for term in terms:
        try:
            hits = gmail.search('in:sent "' + term + '"')
        except SafeError as exc:
            return {'checked': False, 'error': str(exc)}
        if hits:
            found[term] = len(hits)
    return {'checked': True, 'matches': found}


def render(entries, gmail):
    print('%d candidate(s) pending a decision.\n' % len(entries), flush=True)
    for entry in entries:
        hit = coverage(gmail, entry)
        print('%s  %s' % (entry['level'], entry['name']))
        print('  account   %s' % entry['account'])
        print('  first saw %s' % notify.when(entry['created_at']))
        for finding in entry['findings'][:4]:
            print('  • ' + notify.headline(finding['kind'], finding.get('evidence')))
        if not hit.get('checked'):
            print('  sent check  UNAVAILABLE (%s)' % hit.get('error', 'gmail not configured'))
        elif hit['matches']:
            print('  sent check  prior mail mentions %s' %
                  ', '.join('%s (%d)' % (k, v) for k, v in sorted(hit['matches'].items())))
            print('              → likely already raised; review before baselining')
        else:
            print('  sent check  no prior mail mentions this account or its charges')
            print('              → probably genuinely unsent; consider "send"')
        if entry['decision']:
            print('  decision  ALREADY RECORDED: %s' % entry['decision'])
        print('  %s\n' % entry['alert_id'], flush=True)
    print('Record decisions with:\n'
          '  python risk-monitor/reconcile_candidates.py --decide <alert_id>=baseline|send ...\n'
          '  python risk-monitor/reconcile_candidates.py --decide-all baseline --confirm %d'
          % len(entries), flush=True)


def apply_decisions(store, state, decisions):
    unknown = [k for k in decisions if k not in state.get('alerts', {})]
    if unknown:
        raise SafeError('unknown_alert_id')
    actor = os.environ.get('GITHUB_ACTOR', 'local')
    now = int(time.time())
    for alert_id, decision in sorted(decisions.items()):
        alert = state['alerts'][alert_id]
        previous = (alert.get('reconciled') or {}).get('decision')
        if previous and previous != decision:
            raise SafeError('decision_already_recorded_change_requires_review')
        alert['reconciled'] = {'decision': decision, 'at': now, 'by': actor}
    store.checkpoint(state, {'type': 'candidates_reconciled', 'actor': actor,
                             'baselined': sorted(k for k, v in decisions.items() if v == 'baseline'),
                             'released': sorted(k for k, v in decisions.items() if v == 'send')})
    print('Recorded %d decision(s).' % len(decisions), flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--decide', nargs='*', default=[], metavar='ALERT_ID=baseline|send')
    parser.add_argument('--decide-all', choices=('baseline', 'send'))
    parser.add_argument('--confirm', type=int,
                        help='exact candidate count, required with --decide-all')
    args = parser.parse_args(argv)

    store, state, _ = inspect(STATE)
    entries = [describe(state, a) for a in pending(state)]
    undecided = [e for e in entries if not e['decision']]

    if args.decide_all:
        if args.confirm != len(undecided):
            raise SafeError('confirm_count_mismatch_expected_%d' % len(undecided))
        decisions = {e['alert_id']: args.decide_all for e in undecided}
    else:
        decisions = {}
        for item in args.decide:
            alert_id, _, decision = item.partition('=')
            if decision not in ('baseline', 'send'):
                raise SafeError('decision_must_be_baseline_or_send')
            decisions[alert_id] = decision

    if decisions:
        apply_decisions(store, state, decisions)
        return 0

    gmail = None
    try:
        gmail = Gmail()
    except SafeError as exc:
        print('Gmail unavailable (%s); reporting without Sent evidence.\n' % exc, flush=True)
    render(entries, gmail)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SafeError as exc:
        print('Reconciliation stopped: ' + str(exc), flush=True)
        sys.exit(2)
