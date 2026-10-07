"""Quantify why onboarding IP coverage is incomplete. Read-only.

The monitor records `tos_acceptance.ip` for each connected account and raises
`onboarding_ip_coverage_incomplete` when **any** account lacks it. That flag is
currently permanent, which is why no run has ever reached a gap-free
completion.

Stripe only populates `tos_acceptance.ip` when the *platform* collected terms
acceptance itself. Where Stripe collected it — Standard accounts, and anything
onboarded through a Stripe-hosted flow — the platform never sees an IP, and no
amount of rescanning will produce one. This script separates accounts whose IP
is genuinely absent-and-unobtainable from accounts that should have one, so the
coverage contract can be set from measurement rather than assumption.

It changes nothing and sends nothing. It does not decide the contract.
"""
import argparse
import ipaddress
import json
import sys
import time
from collections import Counter, defaultdict

from adapters import Stripe, SafeError

# Every Nth listed account is re-read from its authoritative endpoint to prove
# the list projection carries the same tos_acceptance the monitor would see.
VERIFY_EVERY = 25


def classify(account):
    """Why this account does or does not expose an onboarding IP."""
    tos = account.get('tos_acceptance') or {}
    controller = account.get('controller') or {}
    kind = (account.get('type')
            or controller.get('type')
            or ('stripe' if controller.get('is_controller') else None)
            or 'unknown')
    if tos.get('ip'):
        return 'present', kind
    if tos.get('date') or tos.get('service_agreement'):
        # Terms were accepted, but not through a platform-collected flow.
        return 'accepted_elsewhere', kind
    return 'no_tos_record', kind


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--budget-seconds', type=int, default=540)
    parser.add_argument('--json', action='store_true', help='machine-readable summary only')
    args = parser.parse_args(argv)

    stripe = Stripe()
    stripe.preflight()
    deadline = time.monotonic() + args.budget_seconds

    cursor, total, truncated = None, 0, False
    states = Counter()
    by_kind = defaultdict(Counter)
    ips = defaultdict(set)
    unexpected, mismatches, private = [], [], 0

    while True:
        if time.monotonic() > deadline:
            truncated = True
            break
        page = stripe.page('accounts', {'limit': 100}, cursor)
        for account in page['data']:
            total += 1
            state, kind = classify(account)
            states[state] += 1
            by_kind[kind][state] += 1
            if total % VERIFY_EVERY == 0:
                authoritative = stripe.get('accounts/' + account['id'])
                if classify(authoritative)[0] != state:
                    mismatches.append(account['id'])
            tos_ip = (account.get('tos_acceptance') or {}).get('ip')
            if tos_ip:
                try:
                    parsed = ipaddress.ip_address(tos_ip)
                except ValueError:
                    unexpected.append({'id': account['id'], 'why': 'unparseable_ip'})
                    continue
                if parsed.is_global:
                    ips[str(parsed)].add(account['id'])
                else:
                    private += 1
            elif state == 'no_tos_record' and account.get('charges_enabled'):
                # Taking payments with no terms record at all is worth a look.
                unexpected.append({'id': account['id'], 'why': 'charges_enabled_without_tos'})
        if page['data']:
            cursor = page['data'][-1]['id']
        if not page['has_more']:
            break

    clusters = {ip: sorted(a) for ip, a in ips.items() if len(a) >= 2}
    covered = states['present']
    summary = {
        'accounts_examined': total,
        'coverage_truncated_by_budget': truncated,
        'with_onboarding_ip': covered,
        'coverage_pct': round(100 * covered / total, 1) if total else 0,
        'accepted_elsewhere_no_platform_ip': states['accepted_elsewhere'],
        'no_terms_record_at_all': states['no_tos_record'],
        'by_account_kind': {k: dict(v) for k, v in sorted(by_kind.items())},
        'private_or_reserved_ips': private,
        'linkage_clusters_found': len(clusters),
        'accounts_in_clusters': sum(len(v) for v in clusters.values()),
        'list_vs_authoritative_mismatches': mismatches,
        'needs_attention': unexpected,
    }

    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True), flush=True)
        return 0

    print('Onboarding IP coverage\n', flush=True)
    print('  examined                  %d accounts%s'
          % (total, ' (BUDGET TRUNCATED — rerun with a larger --budget-seconds)'
             if truncated else ''))
    print('  with a platform-collected IP   %d (%.1f%%)' % (covered, summary['coverage_pct']))
    print('  terms accepted, no platform IP %d' % states['accepted_elsewhere'])
    print('  no terms record at all         %d' % states['no_tos_record'])
    print('\n  by account kind:')
    for kind, counts in sorted(by_kind.items()):
        print('    %-12s %s' % (kind, ', '.join('%s=%d' % kv for kv in sorted(counts.items()))))
    print('\n  linkage: %d shared-IP cluster(s) covering %d account(s)'
          % (len(clusters), summary['accounts_in_clusters']))
    print('  %d account(s) carry a private or reserved IP and are excluded from clustering'
          % private)

    if mismatches:
        print('\n  WARNING: %d sampled account(s) disagree between the list projection and '
              'the authoritative read. Treat these numbers as unreliable:' % len(mismatches))
        for account_id in mismatches[:10]:
            print('    %s' % account_id)
    if unexpected:
        print('\n  %d account(s) need attention:' % len(unexpected))
        for row in unexpected[:20]:
            print('    %-24s %s' % (row['id'], row['why']))
        if len(unexpected) > 20:
            print('    …and %d more' % (len(unexpected) - 20))

    print('\nWhat this means', flush=True)
    if states['accepted_elsewhere'] and not unexpected:
        print('  The missing IPs are structural: those accounts accepted terms through a')
        print('  flow the platform did not collect, so Stripe never exposes an IP for them.')
        print('  Rescanning cannot fill this in. The coverage contract has to either accept')
        print('  them as permanently unmeasurable or obtain the evidence from another')
        print('  verified source.')
    elif unexpected:
        print('  Some accounts lack any terms record while charges are enabled. Resolve')
        print('  those before deciding the contract — they are not a measurement artefact.')
    else:
        print('  Every examined account exposes an onboarding IP. If the monitor still')
        print('  reports the gap, the sweep it is judging is older than this read.')
    print('\n  IP evidence feeds only cross-account linkage leads. No payment risk rule')
    print('  depends on it, so a documented partial contract does not weaken amount,')
    print('  burst, failure, refund or dispute detection.')
    print('\nThis check read Stripe only. Nothing was changed or sent.', flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SafeError as exc:
        print('IP coverage inspection stopped: ' + str(exc), flush=True)
        sys.exit(2)
