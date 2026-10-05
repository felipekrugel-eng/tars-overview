"""Check the configured alarm without printing its secret URL."""
import json
from pathlib import Path
import sys
import time
from adapters import Gmail, SafeError
from monitor import external_heartbeat


def main():
    gmail = Gmail()
    query = 'from:healthchecks.io newer_than:1d'
    baseline = {row['id'] for row in gmail.search(query)}
    try:
        external_heartbeat(False)
        print('Alarm failure signal accepted.', flush=True)
        time.sleep(15)
        external_heartbeat(True)
        print('Alarm recovery signal accepted.', flush=True)
        kinds = set()
        for attempt in range(4):
            time.sleep(15)
            for row in gmail.search(query):
                if row['id'] in baseline:
                    continue
                message = gmail.api('messages/' + row['id'] + '?format=metadata&metadataHeaders=Subject')
                headers = message.get('payload', {}).get('headers', [])
                subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), '').lower()
                if 'loyverse payments monitor' not in subject:
                    continue
                if 'down' in subject:
                    kinds.add('failure')
                if 'up' in subject or 'recovered' in subject:
                    kinds.add('recovery')
            if kinds == {'failure', 'recovery'}:
                break
        print('Notification receipt verification: ' + json.dumps(sorted(kinds)), flush=True)
        if kinds != {'failure', 'recovery'}:
            raise SafeError('alarm_notification_receipt_incomplete')
        print('Alarm endpoint and both notifications verified in the pinned mailbox.', flush=True)
        return 0
    finally:
        # Restore actual monitor status after the test, so a test success never
        # leaves an incomplete shadow migration showing healthy production.
        health = json.loads(Path('risk-monitor/health.json').read_text())
        healthy = health.get('mode') == 'active' and health.get('status') == 'healthy' and not health.get('gap_codes')
        external_heartbeat(healthy)
        print('Alarm restored to actual monitor status: ' + ('healthy' if healthy else 'degraded') + '.', flush=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('Alarm check stopped: ' + (str(exc) if isinstance(exc, SafeError) else 'runtime_failure'), flush=True)
        sys.exit(2)
