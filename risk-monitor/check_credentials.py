"""Read-only checks of runner credentials; never print response data or secrets."""
import sys
from adapters import Gmail, Stripe, SafeError, http


def stripe_check():
    stripe = Stripe()
    stripe.preflight()
    stripe.get('accounts', {'limit': 1})
    fees = stripe.get('application_fees', {'limit': 1})
    samples = fees.get('data', [])
    if not samples:
        raise SafeError('connected_charge_access_not_verified_no_fee_sample')
    fee = samples[0]
    account = fee.get('account')
    charge = fee.get('charge')
    if not isinstance(account, str) or not isinstance(charge, str):
        raise SafeError('connected_charge_access_not_verified_sample_shape')
    stripe.get('accounts/' + account)
    stripe.get('charges/' + charge, account=account)
    stripe.get('refunds', {'limit': 1, 'charge': charge}, account=account)
    http('https://api.stripe.com/v1/disputes?limit=1', headers={
        'Authorization': 'Bearer ' + stripe.key, 'Stripe-Account': account})


def gmail_check():
    gmail = Gmail()  # Refresh token exchange and pinned mailbox profile check.
    result = gmail.api('messages?maxResults=1&q=in%3Ainbox')
    if result.get('messages'):
        gmail.api('messages/' + result['messages'][0]['id'] + '?format=metadata')


def main():
    failed = False
    checks = [('Stripe live read permissions', stripe_check),
              ('Gmail refresh token, mailbox identity and message reads', gmail_check)]
    for name, check in checks:
        try:
            check()
            print(name + ': PASS', flush=True)
        except SafeError as exc:
            print(name + ': FAIL (' + str(exc) + ')', flush=True)
            failed = True
        except (ValueError, KeyError, TypeError):
            print(name + ': FAIL (credential_json_or_response_invalid)', flush=True)
            failed = True
        except Exception:
            print(name + ': FAIL (unexpected_check_error)', flush=True)
            failed = True
    print('No emails sent. No Stripe changes. Sending permission and delivery remain untested.', flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
