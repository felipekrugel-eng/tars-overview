"""Deterministic risk rules. Amounts are integer minor units; timestamps are UTC.

No network calls or account mutations live in this module. Missing evidence never
becomes a negative finding. Card fingerprints must come from authoritative data.
"""
from dataclasses import dataclass, field
from collections import defaultdict
from datetime import datetime, timezone
from statistics import median
import hashlib

PREFIX = 'loyverse_payments_risk_v1:'
LEVELS = {'Amount alert': 1, 'Elevated': 2, 'Urgent': 3}

def epoch(value):
    if isinstance(value, (int, float)):
        return int(value)
    dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    # Snowflake CREATED_AT is a documented UTC column, unlike POS dates.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())

@dataclass(frozen=True)
class Attempt:
    account: str
    id: str
    created: int
    amount: int
    currency: str
    status: str
    country: str | None
    fingerprint: str | None = None

    @property
    def key(self):
        return self.account + '|' + self.id

@dataclass
class Finding:
    account: str
    kind: str
    level: str
    ids: list
    evidence: dict = field(default_factory=dict)
    @property
    def alert_id(self):
        if self.kind == 'amount':
            return PREFIX + self.account + ':amount:' + self.ids[0]
        digest = hashlib.sha256('|'.join(sorted(self.ids)).encode()).hexdigest()[:24]
        return PREFIX + self.account + ':' + self.kind + ':' + digest

def evaluate(current, history, account_created=None, pos_age_days=None, legitimacy_grade='Unverified'):
    """Evaluate only new/status-changed attempts against strictly earlier history."""
    if current.country != 'US':
        return []
    same = sorted({x.id: x for x in history + [current]
                   if x.account == current.account and x.currency == current.currency
                   and x.created <= current.created}.values(), key=lambda x: (x.created, x.id))
    success = [x for x in same if x.status == 'succeeded']
    failed = [x for x in same if x.status == 'failed']
    findings = []
    def add(kind, level, rows, **evidence):
        findings.append(Finding(current.account, kind, level, [x.id for x in rows], evidence))
    if current.status == 'succeeded' and current.currency == 'usd':
        if current.amount > 75000:
            add('amount', 'Elevated' if pos_age_days is not None and pos_age_days < 30
                else 'Amount alert', [current], amount=current.amount)
        if account_created is not None and current.amount > 70000:
            # Calendar-day age, never an approximation from POS creation.
            days = (datetime.fromtimestamp(current.created, timezone.utc).date() -
                    datetime.fromtimestamp(account_created, timezone.utc).date()).days
            if 0 <= days < 30 and legitimacy_grade in ('Weak','Unverified','Conflicting'):
                add('legitimacy-review', 'Elevated', [current], payments_age_days=days,
                    grade=legitimacy_grade, reason='Public legitimacy review required')
        prior = [x for x in success if current.created - 90*86400 <= x.created < current.created]
        if current.amount > 75000 and len(prior) >= 20:
            typical = median(x.amount for x in prior)
            if typical > 0 and current.amount >= 3*typical:
                add('ticket-outlier', 'Elevated', [current], median=typical, sample=len(prior))
        burst = [x for x in success if x.amount > 75000 and x.created >= current.created-3600]
        if len(burst) >= 3 and sum(x.amount for x in burst) >= 250000:
            add('high-value-burst', 'Elevated', burst, total=sum(x.amount for x in burst))
        day = current.created // 86400
        today = [x for x in success if x.created // 86400 == day]
        prior_days = defaultdict(list)
        for x in success:
            if day-30 <= x.created // 86400 < day:
                prior_days[x.created // 86400].append(x)
        total = sum(x.amount for x in today)
        if total >= 500000 and len(prior_days) >= 7 and sum(map(len, prior_days.values())) >= 20:
            typical = median(sum(x.amount for x in rows) for rows in prior_days.values())
            if typical > 0 and total >= 3*typical:
                add('day-surge', 'Elevated', today, total=total, median_day=typical,
                    active_days=len(prior_days))
    window = [x for x in same if x.created >= current.created-900
              and x.status in ('failed', 'succeeded')]
    failures = [x for x in window if x.status == 'failed']
    if current.status == 'failed' and len(failures) >= 3 and len(failures)*2 >= len(window):
        add('failed-burst', 'Elevated', failures, attempts=len(window), failures=len(failures))
    window30 = [x for x in same if x.created >= current.created-30*86400
                and x.status in ('failed', 'succeeded')]
    failures30 = [x for x in window30 if x.status == 'failed']
    if len(window30) >= 20 and len(failures30) >= 10 and len(failures30)*2 >= len(window30):
        add('sustained-failures', 'Elevated', [current], attempts=len(window30), failures=len(failures30))
    if current.fingerprint and current.amount > 0:
        if current.status == 'succeeded':
            repeated = [x for x in success if x.created >= current.created-600
                        and x.fingerprint == current.fingerprint and x.amount == current.amount]
            if len(repeated) >= 3:
                failed7 = [x for x in failed if current.created-7*86400 <= x.created < current.created]
                add('same-credential', 'Urgent' if len(failed7) >= 5 else 'Elevated', repeated,
                    amount=current.amount, preceding_merchant_failures=len(failed7))
        if current.status == 'failed':
            retry = [x for x in failed if x.created >= current.created-3600
                     and x.fingerprint == current.fingerprint]
            if len(retry) >= 3 and len({x.amount for x in retry}) >= 2 and retry[-1].amount < retry[0].amount:
                add('downward-retries', 'Elevated', retry, first=retry[0].amount, final=retry[-1].amount)
    # Correlated failure/retry/credential manifestations count as one family.
    independent = {x.kind for x in findings} & {'ticket-outlier', 'high-value-burst', 'day-surge'}
    if len(independent) >= 2:
        for x in findings:
            if x.kind in independent:
                x.level = 'Urgent'
    return findings

def object_event(account, obj, old, now, kind, activation):
    if not obj or not isinstance(obj, dict) or not obj.get('id'):
        raise ValueError('expanded_' + kind + '_unknown')
    status = obj.get('status')
    if not status:
        raise ValueError(kind + '_status_unknown')
    due = obj.get('evidence_details', {}).get('due_by') if kind == 'dispute' else None
    notices = set((old or {}).get('notices', []))
    threshold = ('overdue' if due and due <= now else '24h' if due and due-now <= 86400
                 else '72h' if due and due-now <= 259200 else None)
    open_dispute = status in ('needs_response', 'under_review', 'warning_needs_response', 'warning_under_review')
    if not open_dispute:
        threshold = None
    changed = not old or old.get('status') != status or old.get('due_by') != due
    baseline_terminal = (not old and obj.get('created', 0) < activation and
                         (status in ('succeeded', 'failed', 'canceled') if kind == 'refund'
                          else status in ('won', 'lost', 'warning_closed')))
    notify = (changed or threshold and threshold not in notices) and not baseline_terminal
    if threshold:
        notices.add(threshold)
    record = {k: obj.get(k) for k in ('id', 'status', 'created', 'amount', 'currency', 'reason',
                                     'failure_reason', 'pending_reason')}
    record.update(due_by=due, notices=sorted(notices), checked_at=now)
    if not notify:
        return None, record
    level = ('Elevated' if kind == 'refund' or status.startswith('warning_') and
             (not due or due-now > 259200) else 'Urgent')
    event = obj['id'] + ':' + status + ':' + str(due) + ':' + str(threshold)
    return Finding(account, kind, level, [event], record), record

# Onboarding IP evidence states. Stripe exposes tos_acceptance.ip only where
# the platform collected terms acceptance itself; where Stripe collected them
# no IP exists for the platform to read, so rescanning cannot produce one.
# Treating that as a coverage failure made the gap permanent, which is why no
# run reached a gap-free completion. The states below separate evidence that is
# genuinely missing from evidence that is structurally unobtainable.
IP_PRESENT = 'present'
IP_TERMS_WITHOUT_IP = 'terms_without_ip'
IP_MISSING_WHILE_LIVE = 'no_terms_charges_enabled'
IP_NOT_ONBOARDED = 'no_terms_not_onboarded'

# Only this state is a coverage failure: an account taking payments with no
# record of terms acceptance at all.
IP_BLOCKING = {IP_MISSING_WHILE_LIVE}


def ip_evidence(account):
    """Classify an authoritative Stripe account's onboarding IP evidence.

    Pure and total: an account shape this does not recognise degrades to the
    blocking state rather than silently counting as covered.
    """
    tos = account.get('tos_acceptance') or {}
    if tos.get('ip'):
        return IP_PRESENT
    if tos.get('date') or tos.get('service_agreement'):
        return IP_TERMS_WITHOUT_IP
    if account.get('charges_enabled'):
        return IP_MISSING_WHILE_LIVE
    return IP_NOT_ONBOARDED


def country_bucket(account):
    country = account.get('country')
    address = (account.get('company') or {}).get('address') or (account.get('individual') or {}).get('address') or {}
    if country == 'US' and address.get('country') == 'US' and address.get('state') == 'PR':
        return 'PR'
    return country if isinstance(country, str) and len(country) == 2 else 'Unknown'

def source_health(status, raw, count, now, max_age):
    if not status.get('pull_succeeded') or status.get('sha256', {}).get('transactions.csv') != hashlib.sha256(raw).hexdigest():
        raise ValueError('transaction_pull_unverified')
    if status.get('rows', {}).get('transactions') != count:
        raise ValueError('transaction_count_mismatch')
    age = now-epoch(status['completed_at_utc'])
    if age < -300:
        raise ValueError('transaction_pull_future_timestamp')
    return age <= max_age
