"""Delivery budgets, cooldowns and health-incident tracking. Pure functions.

The original build decided *what* was true and then sent one message per
merchant per run, and one health notice per distinct combination of issue
codes. Both scale badly: hourly runs multiply the first, and a set of n
fluctuating codes produces up to 2**n distinct notices for one ongoing
problem. This module decides *whether and when* to send, so the engine can
keep recording everything it finds.

Nothing here suppresses a finding. Held alerts stay in durable state with
their evidence and are delivered by a later run or digest.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

LONDON = ZoneInfo('Europe/London')

LEVEL_ORDER = {'Amount alert': 1, 'Elevated': 2, 'Urgent': 3}

DEFAULTS = {
    # Severities that interrupt immediately; everything else is batched.
    'immediate_levels': ['Urgent'],
    # Hard ceilings. Reaching one holds alerts, it never drops them.
    'max_emails_per_run': 4,
    'max_emails_per_day': 20,
    # A digest is one email; this bounds how long that one email gets.
    'max_digest_entries': 25,
    # Do not re-email the same merchant inside this window unless severity rises.
    'account_cooldown_seconds': 21600,
    # Batched alerts wait for this many seconds before a digest is worth sending.
    'digest_min_age_seconds': 0,
    # A health issue must be seen this many consecutive checks before it alerts.
    # One transient gap in a single run is not an incident.
    'health_confirm_checks': 2,
    'health_max_notices_per_day': 4,
    # Non-critical health issues are held for one daily summary at this hour.
    'health_digest_hour_london': 9,
    # Deliberate, ongoing states (shadow mode, a backfill in progress) are not
    # incidents. They are reported this rarely so they cannot be forgotten.
    'health_quiet_reminder_days': 7,
    # Gap codes that are reported by the watchdog and must not ALSO fail the
    # GitHub job; a failing job is a second, unfiltered notification channel.
    'warn_only_gap_codes': [],
}

# Issues that mean the monitor is not doing its job, or cannot be trusted.
# These page immediately; everything else is a daily summary.
CRITICAL = {
    'monitor_workflow_disabled',
    'monitor_heartbeat_missing',
    'monitor_heartbeat_overdue',
    'charge_evaluation_overdue',
    'gmail_oauth_missing',
    'gmail_sender_mismatch',
    'stripe_read_key_missing',
    'stripe_platform_mismatch',
    'email_delivery_uncertain',
    'durable_state_missing_do_not_rebootstrap',
    'state_integrity_failure',
    'runtime_failure',
}


# Deliberate or self-clearing states. Real, worth recording, not worth an email
# every time a check runs: they are visible in health.json and the dashboard.
QUIET = {
    'migration_shadow_mode',
    'run_budget_checkpointed',
    'global_sweep_in_progress',
    'global_previous_day_incomplete',
    'export_charge_cache_incomplete',
    'global_fingerprint_coverage_incomplete',
    'fee_linked_export_reconciliation_incomplete',
    'aggregate_refund_scope_incomparable',
    'aggregate_refund_comparison_unavailable',
    'onboarding_ip_coverage_incomplete',
    'alert_delivery_budget_held',
}


def classify(codes):
    """Split issue codes into the three cadences they deserve."""
    codes = set(codes)
    critical = sorted(codes & CRITICAL)
    quiet = sorted(codes & QUIET - CRITICAL)
    return {'critical': critical,
            'operational': sorted(codes - CRITICAL - QUIET),
            'quiet': quiet}


def policy(settings):
    """Config overrides on top of the defaults, ignoring unknown keys."""
    merged = dict(DEFAULTS)
    for key, value in (settings or {}).get('notifications', {}).items():
        if key in merged:
            merged[key] = value
    return merged


def day_key(now, hour_offset=0):
    """London day; grouping must match how the operator reads their inbox."""
    stamp = datetime.fromtimestamp(int(now), LONDON)
    return stamp.strftime('%Y%m%d'), stamp.hour + hour_offset


def route(level, rules):
    return 'immediate' if level in rules['immediate_levels'] else 'digest'


def severity(issues):
    return 'critical' if set(issues) & CRITICAL else 'operational'


class Budget:
    """Per-run and per-London-day email ceilings held in durable state."""

    def __init__(self, state, now, rules):
        self.rules = rules
        self.now = now
        self.day = day_key(now)[0]
        counters = state.setdefault('send_counters', {})
        if counters.get('day') != self.day:
            counters.clear()
            counters['day'] = self.day
        self.counters = counters
        self.in_run = 0
        self.held = 0

    @property
    def sent_today(self):
        return self.counters.get('emails', 0)

    def allows(self):
        return (self.in_run < self.rules['max_emails_per_run']
                and self.sent_today < self.rules['max_emails_per_day'])

    def spend(self):
        self.in_run += 1
        self.counters['emails'] = self.sent_today + 1

    def hold(self):
        self.held += 1


def cooldown_blocked(state, account, level, now, rules):
    """True when this merchant was emailed recently at the same or higher severity.

    A genuine escalation always gets through; a repeat of the same story does
    not. Dispute and refund events carry their own identity and are routed by
    the caller, so they are never silenced here.
    """
    last = (state.get('account_cooldown') or {}).get(account)
    if not last:
        return False
    if now - last.get('at', 0) >= rules['account_cooldown_seconds']:
        return False
    return LEVEL_ORDER.get(level, 2) <= LEVEL_ORDER.get(last.get('level', 'Elevated'), 2)


def record_delivery(state, account, level, now):
    state.setdefault('account_cooldown', {})[account] = {'at': now, 'level': level}


def prune_cooldowns(state, now, rules):
    """Keep durable state bounded; an expired cooldown carries no information."""
    window = max(rules['account_cooldown_seconds'] * 2, 86400)
    cooldowns = state.get('account_cooldown') or {}
    for account in [a for a, v in cooldowns.items() if now - v.get('at', 0) > window]:
        cooldowns.pop(account, None)


def observe_health(state, issues, now, rules):
    """Track one incident per issue code and decide what is worth sending.

    Returns (notify_codes, recovered_codes). An incident is opened the first
    time a code is seen, confirmed once it has survived `health_confirm_checks`
    consecutive checks, and closed as soon as it is absent. Notices are keyed
    by code, so a changing *combination* of codes never reopens an issue that
    is already reported.
    """
    incidents = state.setdefault('incidents', {})
    issues = set(issues)
    confirm = max(int(rules['health_confirm_checks']), 1)

    pending = state.setdefault('pending_recovery', {})
    # A code that returns before its recovery was delivered is open again, not
    # recovered. Its incident was already dropped, so clear the owed recovery
    # by issue code rather than by what is still tracked.
    for code in issues:
        pending.pop(code, None)
    for code in list(incidents):
        if code in issues:
            continue
        if incidents[code].get('notified_at'):
            pending.setdefault(code, now)
        incidents.pop(code, None)
    recovered = sorted(pending)

    candidates = []
    for code in sorted(issues):
        record = incidents.setdefault(code, {'first_seen': now, 'observations': 0,
                                             'notified_at': None})
        record['observations'] = record.get('observations', 0) + 1
        record['last_seen'] = now
        if record.get('notified_at'):
            continue
        if record['observations'] >= confirm:
            candidates.append(code)

    return candidates, recovered


def health_due(candidates, state, now, rules):
    """Decide whether confirmed candidates go out now, later, or not at all.

    Critical issues send immediately. Operational issues wait for the daily
    summary hour, so an ongoing degradation is one email a day rather than one
    per check. Issues that are only deliberate ongoing states are reported on a
    slow reminder cadence. Returns the codes to report, which may be empty.
    """
    if not candidates:
        return []
    groups = classify(candidates)
    if groups['critical']:
        # Report everything open alongside the critical issue: one full picture.
        return sorted(candidates)
    day, hour = day_key(now)
    if groups['operational']:
        if state.setdefault('health_digest_days', {}).get('last') == day:
            return []
        return sorted(candidates) if hour >= int(rules['health_digest_hour_london']) else []
    last = state.setdefault('health_digest_days', {}).get('quiet')
    gap_days = int(rules['health_quiet_reminder_days'])
    if last and (now - last) < gap_days * 86400:
        return []
    return sorted(groups['quiet']) if hour >= int(rules['health_digest_hour_london']) else []


def health_budget_ok(state, now, rules):
    day = day_key(now)[0]
    counters = state.setdefault('health_counters', {})
    if counters.get('day') != day:
        counters.clear()
        counters['day'] = day
    return counters.get('notices', 0) < int(rules['health_max_notices_per_day'])


def adopt_open_issues(state, issues, now):
    """Seed incidents from a legacy watchdog state exactly once.

    The previous build tracked open failures as hashed combinations. Without
    this, the first run under the incident model would treat every already
    reported issue as new and send about all of them again.
    """
    if state.get('incidents') is not None or not state.get('open_failures'):
        return
    state['incidents'] = {code: {'first_seen': now, 'observations': 1, 'notified_at': now,
                                 'last_seen': now, 'adopted': True}
                          for code in sorted(set(issues))}


def record_health_notice(state, now, codes):
    day = day_key(now)[0]
    counters = state.setdefault('health_counters', {})
    if counters.get('day') != day:
        counters.clear()
        counters['day'] = day
    counters['notices'] = counters.get('notices', 0) + 1
    history = state.setdefault('health_digest_days', {})
    history['last'] = day
    if set(codes) <= QUIET:
        history['quiet'] = now
    for code in codes:
        incident = state.setdefault('incidents', {}).get(code)
        if incident is not None:
            incident['notified_at'] = now


def incident_key(codes, prefix='health'):
    """Stable identity for a notice: the codes it reports, in order.

    Unlike hashing the full issue set, adding an unrelated progress code later
    does not invent a new incident for an already-reported problem.
    """
    return prefix + ':' + ','.join(sorted(codes))
