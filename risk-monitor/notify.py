"""Human-readable alert text. Pure formatting: no network, no state mutation.

The monitor's evidence is machine-shaped (minor units, epochs, rule kinds, raw
Stripe objects). Reading that in a mailbox is what made earlier alerts
unusable, so every number is rendered in the unit a person reads, and anything
that does not change the decision is left out or pushed to a reference footer.

Omission is deliberate: an alert states what fired, the measurement that
crossed the threshold, and what the reader should do. Supporting objects stay
in durable state and in the dashboards, not in the message body.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

LONDON = ZoneInfo('Europe/London')
RULE = 1
# Longest a Telegram line may run before it stops being glanceable on a phone.
TELEGRAM_LIMIT = 700

LEVEL_ORDER = {'Amount alert': 1, 'Elevated': 2, 'Urgent': 3}

ZERO_DECIMAL = {'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg',
                'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'}


def money(minor, currency='usd'):
    """Format integer minor units the way the reader's statement shows them."""
    if minor is None:
        return 'unknown'
    code = (currency or 'usd').lower()
    try:
        minor = int(minor)
    except (TypeError, ValueError):
        return 'unknown'
    if code in ZERO_DECIMAL:
        return f'{minor:,} {code.upper()}'
    prefix = '$' if code == 'usd' else ''
    suffix = '' if code == 'usd' else ' ' + code.upper()
    return f'{prefix}{minor / 100:,.2f}{suffix}'


def when(epoch_seconds, relative_to=None):
    """London wall-clock plus a relative hint; operators think in both."""
    if not epoch_seconds:
        return 'unknown'
    stamp = datetime.fromtimestamp(int(epoch_seconds), LONDON).strftime('%d %b %H:%M')
    if relative_to is None:
        return stamp + ' London'
    return f'{stamp} London ({ago(relative_to - int(epoch_seconds))})'


def ago(seconds):
    seconds = max(int(seconds), 0)
    if seconds < 90:
        return 'just now'
    if seconds < 5400:
        return f'{seconds // 60}m ago'
    if seconds < 172800:
        return f'{seconds // 3600}h ago'
    return f'{seconds // 86400}d ago'


def ratio(value, baseline):
    if not baseline:
        return 'unknown'
    return f'{value / baseline:.1f}x'


def _pct(part, whole):
    return f'{round(100 * part / whole)}%' if whole else 'unknown'


def headline(kind, evidence, currency='usd'):
    """One sentence stating the measurement that crossed the threshold.

    Unknown rule kinds degrade to the kind name rather than raising: a new rule
    must never be able to block an alert from being delivered.
    """
    e = evidence or {}
    if kind == 'amount':
        return f"Single payment of {money(e.get('amount'), currency)} (review threshold $750)."
    if kind == 'legitimacy-review':
        return (f"Merchant is {e.get('payments_age_days', '?')} days old and took "
                f"{money(e.get('amount'), currency)}. Legitimacy evidence: {e.get('grade', 'Unverified')}.")
    if kind == 'ticket-outlier':
        return (f"{money(e.get('amount'), currency)} is {ratio(e.get('amount', 0), e.get('median'))} this "
                f"merchant's median ticket ({money(e.get('median'), currency)} over "
                f"{e.get('sample', '?')} payments in 90 days).")
    if kind == 'high-value-burst':
        return (f"{money(e.get('total'), currency)} across several payments over $750 "
                f"within 60 minutes.")
    if kind == 'day-surge':
        return (f"Today's total {money(e.get('total'), currency)} is "
                f"{ratio(e.get('total', 0), e.get('median_day'))} the merchant's typical day "
                f"({money(e.get('median_day'), currency)} across {e.get('active_days', '?')} active days).")
    if kind == 'failed-burst':
        return (f"{e.get('failures', '?')} of {e.get('attempts', '?')} attempts failed in 15 minutes "
                f"({_pct(e.get('failures', 0), e.get('attempts', 0))} failure rate).")
    if kind == 'sustained-failures':
        return (f"{e.get('failures', '?')} of {e.get('attempts', '?')} attempts failed over 30 days "
                f"({_pct(e.get('failures', 0), e.get('attempts', 0))} failure rate).")
    if kind == 'same-credential':
        extra = e.get('preceding_merchant_failures') or 0
        tail = f' Preceded by {extra} failures at this merchant in 7 days.' if extra else ''
        return (f"Repeated identical {money(e.get('amount'), currency)} charges on one card "
                f"fingerprint within 10 minutes.{tail}")
    if kind == 'downward-retries':
        return (f"Declining retries on one card fingerprint within 60 minutes: "
                f"{money(e.get('first'), currency)} down to {money(e.get('final'), currency)}.")
    if kind == 'refund':
        return (f"Refund {e.get('id', 'unknown')} is {e.get('status', 'unknown')}"
                + (f" ({money(e.get('amount'), e.get('currency') or currency)})" if e.get('amount') else '') + '.')
    if kind == 'dispute':
        due = e.get('due_by')
        tail = f" Evidence due {when(due)}." if due else ''
        return (f"Dispute {e.get('id', 'unknown')} is {e.get('status', 'unknown')}"
                + (f" ({money(e.get('amount'), e.get('currency') or currency)})" if e.get('amount') else '')
                + '.' + tail)
    if kind == 'refund-request':
        verified = e.get('match_verified')
        return ('Customer email reads as a refund or chargeback request'
                + ('.' if verified else ' but could not be matched to one account.'))
    if kind == 'linkage':
        return (f"Shared onboarding IP or card fingerprint across "
                f"{e.get('accounts', 'several')} accounts.")
    return kind.replace('-', ' ').capitalize() + '.'


ACTION = {
    'Urgent': 'Review today. This pattern needs a decision, not just a look.',
    'Elevated': "Add to today's review queue.",
    'Amount alert': 'For awareness. No action unless the context looks wrong.',
}


def _wrap(label, value, width=None):
    return f'{label:<16}{value}'


def render_alert(alert, findings, context):
    """Build (subject, email_text, telegram_text) for one merchant's alert.

    `findings` are engine Finding dicts; `context` carries display-only data the
    monitor already holds. Both are read-only here.
    """
    level = max((f.get('level', 'Elevated') for f in findings),
                key=lambda x: LEVEL_ORDER.get(x, 2)) if findings else 'Elevated'
    name = context.get('name') or context.get('account') or 'Unknown merchant'
    account = context.get('account', 'unknown')
    now = context.get('now') or 0
    currency = context.get('currency', 'usd')
    kinds = []
    for f in findings:
        if f.get('kind') not in kinds:
            kinds.append(f.get('kind'))
    topic = ', '.join(k.replace('-', ' ') for k in kinds[:2]) or 'risk review'
    if len(kinds) > 2:
        topic += f' +{len(kinds) - 2} more'

    subject = f'[Loyverse Payments] {level} · {name} · {topic}'

    lines = [f'{level} — {name}', '']
    lines.append('WHAT FIRED')
    for f in findings[:6]:
        lines.append('  • ' + headline(f.get('kind', ''), f.get('evidence'), currency))
    if len(findings) > 6:
        lines.append(f'  • …and {len(findings) - 6} further findings for this merchant.')
    lines.append('')

    lines.append('WHAT TO DO')
    lines.append('  ' + ACTION.get(level, ACTION['Elevated']))
    recommendation = context.get('recommendation')
    if recommendation:
        lines.append('  ' + recommendation)
    lines.append('  No account action has been taken by this monitor.')
    lines.append('')

    volumes = context.get('volumes') or {}
    if volumes:
        lines.append('MERCHANT CONTEXT')
        for label in ('24h', '7d', '30d'):
            row = volumes.get(label)
            if row:
                lines.append('  ' + _wrap(label,
                             f"{money(row.get('amount'), currency)} over {row.get('count', 0)} payments"))
        if context.get('account_age_days') is not None:
            lines.append('  ' + _wrap('Account age', f"{context['account_age_days']} days"))
        if context.get('live_status'):
            lines.append('  ' + _wrap('Live status', context['live_status']))
        lines.append('')

    gaps = context.get('gaps') or []
    if gaps:
        lines.append('KNOWN GAPS IN THIS RUN')
        for code in sorted(gaps)[:4]:
            lines.append('  • ' + explain(code))
        lines.append('  Incomplete coverage is not an all-clear.')
        lines.append('')

    lines.append('-' * 60)
    lines.append(_wrap('Account', account))
    if context.get('source_asof'):
        lines.append(_wrap('Data as of', str(context['source_asof'])))
    lines.append(_wrap('Generated', when(now)))
    lines.append(alert.get('alert_id', ''))

    telegram = _telegram(level, name, kinds, findings, currency, context)
    return subject, '\n'.join(lines), telegram


def _telegram(level, name, kinds, findings, currency, context):
    """Phone-sized. No owner email, card data or raw identifiers."""
    lead = findings[0] if findings else {}
    parts = [f'{level} · {name}',
             headline(lead.get('kind', ''), lead.get('evidence'), currency)]
    if len(findings) > 1:
        parts.append(f'+{len(findings) - 1} more finding(s): '
                     + ', '.join(k.replace('-', ' ') for k in kinds[1:4]))
    parts.append(ACTION.get(level, ACTION['Elevated']))
    return '\n'.join(parts)[:TELEGRAM_LIMIT]


def render_digest(entries, context):
    """One message for a batch of lower-severity alerts.

    `entries` are dicts with level, name, account, alert_id and findings. A
    digest replaces the one-email-per-merchant-per-run behaviour that produced
    the mailbox flood. Every member alert_id is printed in the reference block
    so Gmail Sent/Drafts reconciliation still finds a delivered alert by its
    own marker and never sends it twice.
    """
    now = context.get('now') or 0
    currency = context.get('currency', 'usd')
    entries = sorted(entries, key=lambda e: -LEVEL_ORDER.get(e.get('level'), 2))
    counts = {}
    for entry in entries:
        level = entry.get('level', 'Elevated')
        counts[level] = counts.get(level, 0) + 1
    tally = ', '.join(f'{counts[k]} {k}' for k in
                      sorted(counts, key=lambda x: -LEVEL_ORDER.get(x, 2)))
    subject = f'[Loyverse Payments] Risk digest · {len(entries)} merchants · {tally}'

    lines = [f'{len(entries)} merchants flagged since the last digest ({tally}).',
             'Urgent findings are sent separately and immediately.', '']
    for entry in entries:
        findings = entry.get('findings') or []
        lines.append(f"{entry.get('level', 'Elevated')} — {entry.get('name') or entry.get('account')}")
        for f in findings[:3]:
            lines.append('  • ' + headline(f.get('kind', ''), f.get('evidence'), currency))
        if len(findings) > 3:
            lines.append(f'  • …and {len(findings) - 3} more for this merchant.')
        lines.append('  ' + str(entry.get('account', '')))
        lines.append('')

    lines.append('WHAT TO DO')
    lines.append("  Work this list in today's review queue. No account action has been taken.")
    lines.append('')

    suppressed = context.get('suppressed') or 0
    if suppressed:
        lines.append(f'{suppressed} further alert(s) were held by the send budget and '
                     'remain in durable state for the next digest.')
        lines.append('')
    gaps = context.get('gaps') or []
    if gaps:
        lines.append('KNOWN GAPS IN THIS RUN')
        for code in sorted(gaps)[:4]:
            lines.append('  • ' + explain(code))
        lines.append('Incomplete coverage is not an all-clear.')
        lines.append('')
    lines.append('-' * 60)
    lines.append(_wrap('Generated', when(now)))
    lines.append(context.get('digest_id', ''))
    for entry in entries:
        lines.append(str(entry.get('alert_id', '')))

    telegram = (f'Risk digest · {len(entries)} merchants ({tally})\n'
                + '\n'.join(f"• {e.get('level')} {e.get('name') or e.get('account')}"
                            for e in entries[:6]))
    if len(entries) > 6:
        telegram += f'\n+{len(entries) - 6} more in the email.'
    return subject, '\n'.join(lines), telegram[:TELEGRAM_LIMIT]


HEALTH_PLAIN = {
    'monitor_workflow_disabled': 'The monitor workflow is disabled in GitHub Actions.',
    'monitor_heartbeat_missing': 'The monitor has never written a heartbeat.',
    'monitor_heartbeat_overdue': 'The monitor has not checkpointed in over 90 minutes.',
    'charge_evaluation_overdue': 'No payment has been evaluated in over 90 minutes.',
    'migration_shadow_mode': 'The monitor is in shadow mode; merchant alerts are suppressed.',
    'alert_delivery_overdue': 'Alerts have been pending delivery for over an hour.',
    'gmail_oauth_missing': 'Gmail credentials are missing or rejected.',
    'gmail_sender_mismatch': 'The Gmail token does not belong to the configured sender.',
    'stripe_read_key_missing': 'The Stripe read key is missing.',
    'transaction_source_stale': 'The transaction export is older than its freshness limit.',
    'merchant_source_unverified': 'The merchant profile export could not be verified.',
    'external_deadman_alarm_not_configured': 'The external heartbeat URL is not configured.',
    'telegram_delivery_unconfirmed': 'A Telegram message has no delivery receipt yet.',
    'email_delivery_uncertain': 'An email send is unconfirmed and needs manual reconciliation.',
    'onboarding_ip_coverage_incomplete': 'Some accounts have no onboarding IP evidence.',
    'onboarding_terms_evidence_missing': ('Some accounts are taking payments with no record '
                                          'of terms acceptance.'),
    'onboarding_ip_evidence_unclassified': ('Some account records predate the onboarding '
                                            'evidence contract and refresh on the next sweep.'),
    'run_budget_checkpointed': 'The run hit its time budget and checkpointed progress.',
    'global_sweep_in_progress': 'The daily account sweep is still running.',
}


def explain(code):
    return HEALTH_PLAIN.get(code, code.replace('_', ' ').capitalize() + '.')


def render_health(issues, recovered, context):
    """Operator-facing health notice. Separate voice from merchant risk alerts."""
    now = context.get('now') or 0
    state = 'recovered' if recovered and not issues else 'degraded'
    tier = context.get('tier', 'operational')
    subject = f'[Loyverse Payments] Monitoring {state}' + (' · action needed' if tier == 'critical' else '')
    lines = [f'Monitoring {state}.', '']
    if issues:
        lines.append('OPEN ISSUES')
        for code in issues:
            lines.append('  • ' + explain(code))
        lines.append('')
        lines.append('WHAT TO DO')
        lines.append('  ' + (context.get('action')
                             or 'Check the monitor workflow run and the health snapshot.'))
        lines.append('  Incomplete coverage is not an all-clear.')
        lines.append('')
    if recovered:
        lines.append('CLOSED')
        for code in recovered:
            lines.append('  • ' + explain(code))
        lines.append('')
    coverage = context.get('coverage')
    if coverage:
        lines.append('COVERAGE')
        lines.append('  ' + ', '.join(f'{k} {v}' for k, v in sorted(coverage.items())))
        lines.append('')
    lines.append('-' * 60)
    lines.append(_wrap('Checked', when(now)))
    lines.append(context.get('alert_id', ''))

    head = f'Monitoring {state}'
    detail = '; '.join(explain(c) for c in (issues or recovered)[:3])
    return subject, '\n'.join(lines), (head + '\n' + detail)[:TELEGRAM_LIMIT]
