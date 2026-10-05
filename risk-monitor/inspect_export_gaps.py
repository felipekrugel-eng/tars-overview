"""Read-only native verification of a small unmatched export sample."""
import json
import sys
from adapters import GitStore, Stripe, SafeError


def main():
    state = GitStore().load()
    missing = [row for key, row in state.get('attempts', {}).items()
               if row.get('status') == 'succeeded' and row.get('country') == 'US'
               and key not in state.get('charges', {})]
    missing.sort(key=lambda row: (row['created'], row['id']))
    sample = {row['account'] + '|' + row['id']: row for row in missing[:5] + missing[-5:]}
    stripe = Stripe()
    stripe.preflight()
    counts = {'unmatched_us_total': len(missing), 'sample_size': len(sample),
              'native_matching_succeeded': 0, 'native_without_application_fee': 0,
              'native_with_application_fee': 0, 'native_mismatch': 0}
    for row in sample.values():
        try:
            charge = stripe.get('charges/' + row['id'], {'expand[]': ['application_fee', 'refunds', 'dispute']}, account=row['account'])
        except SafeError as error:
            code = str(error)
            if code not in ('http_403', 'http_404', 'http_429', 'network_or_response_error'):
                raise
            counts[code] = counts.get(code, 0) + 1
            continue
        matches = (charge.get('id') == row['id'] and charge.get('livemode') is True
                   and charge.get('status') == 'succeeded' and charge.get('amount') == row['amount']
                   and charge.get('currency') == row['currency'])
        if not matches:
            counts['native_mismatch'] += 1
            continue
        counts['native_matching_succeeded'] += 1
        field = 'native_with_application_fee' if charge.get('application_fee') else 'native_without_application_fee'
        counts[field] += 1
    print(json.dumps(counts, sort_keys=True), flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('Export gap inspection stopped: ' + (str(exc) if isinstance(exc, SafeError) else 'runtime_failure'), flush=True)
        sys.exit(2)
