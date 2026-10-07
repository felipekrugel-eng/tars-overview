# Alert volume and readability

This document covers the two problems reported against the original build:
hundreds of messages, and messages that were hard to read. It describes what
changed, why, and which knobs to turn. The detection rules are unchanged — the
monitor still finds exactly what it found before.

## Measured baseline, 7 October 2026

The state diagnostic on `master` reported the watchdog had sent **11 emails in
total** (3 notices still undelivered), and the Telegram relay held 10 sent and
4 enqueued. So this repository's watchdog was never the source of a large
mailbox volume, and the dominant sender was the ChatGPT scheduled task, which
alerts per merchant per hour and sends its own monitoring-degraded notices.
Retiring its alerting (see `CUTOVER.md`) is what reduces that volume.

The changes below still matter: they bound what this monitor can send once it
becomes the alert owner, and they remove a dedupe design that would have
scaled badly under active mode.

## Why the volume could grow unbounded

Four independent multipliers, none of which were bounded:

1. **Watchdog notice keys were a hash of the whole issue set.** `notice_key()`
   built an identity from `sha256` of every operational code that was open.
   Codes like `charge_evaluation_overdue`, `alert_delivery_overdue` and
   `telegram_delivery_unconfirmed` come and go between runs, so one ongoing
   problem produced a new "incident" every time an unrelated code appeared or
   cleared — up to `2**n` distinct notices for `n` fluctuating codes.
2. **One email per merchant per run.** With the monitor on an hourly cron and
   15 pending candidates, a single active-mode day could send several hundred
   emails before any of them was read.
3. **No confirmation delay.** A gap that existed for one run and cleared on the
   next still sent, and then sent a recovery.
4. **GitHub's own workflow-failure emails are a second channel.** A non-zero
   exit emails everyone watching the repository, on top of whatever the
   watchdog sent about the same condition.

## What changed

### One incident per issue code

`risk-monitor/throttle.py` tracks `state['incidents']` keyed by the issue code
itself. A code is opened when first seen, **confirmed** after
`health_confirm_checks` consecutive observations, notified at most once, and
closed when it is absent. A closed code that was notified moves to
`pending_recovery` and stays there until the recovery notice has confirmed
receipts on **both** channels, so a failed recovery send is retried rather than
lost; a code that returns in the meantime is open again, not recovered. A changing combination of codes can no longer reopen
a problem that is already reported. `adopt_open_issues()` seeds incidents from
a legacy watchdog state once, so the first run after deployment does not
re-announce everything that was already known.

### Three cadences instead of one

| Tier | Examples | Cadence |
| --- | --- | --- |
| `critical` | credentials rejected, monitor dead, workflow disabled, uncertain send | immediately, with every other open issue listed alongside |
| `operational` | stale export, unverified merchant source | at most one summary per London day, at `health_digest_hour_london` |
| `quiet` | shadow mode, sweep in progress, backfill partitions | once every `health_quiet_reminder_days` (default 7) |

Shadow-mode progress therefore generates no routine email at all. It stays
visible in `health.json`, in the watchdog state and on the dashboard, and is
re-raised weekly so it cannot be forgotten.

### Risk alerts are budgeted and batched

`Monitor.deliver()` routes by severity:

- **Urgent** findings are sent immediately, one email per merchant, as before.
- Everything else batches into **one digest email per run** covering all
  flagged merchants.
- A digest of a single merchant is sent as that merchant's own alert, so a lone
  finding is never hidden behind a summary.

Three limits apply, all in `config.json` under `notifications`:

- `max_emails_per_run` / `max_emails_per_day` — hard ceilings.
- `max_digest_entries` — how many merchants one digest email may list. A digest
  is a single email, so this is separate from the email ceilings.
- `account_cooldown_seconds` — the same merchant is not re-emailed at the same
  or lower severity inside the window. An escalation always gets through.

**Nothing is dropped.** An alert held by a cooldown or a budget keeps its
evidence in durable state, keeps its `alert_id`, and is delivered by a later
run. The count is reported as `alerts_held_by_budget` in `health.json`, and the
watchdog's existing `alert_delivery_overdue` still fires if a hold persists.

### Fewer duplicate channels

The watchdog no longer triggers on `cusum-pull` completions, which are
unrelated to the risk monitor and roughly tripled its run count.

`warn_only_gap_codes` lets you delegate specific gap codes to the watchdog's
own channel so they do not *also* fail the GitHub job. It is empty by default.
Codes in `throttle.CRITICAL` — credentials, integrity, unexpected runtime
failures — are never delegated, in shadow mode or active mode.

To stop GitHub's own failure emails entirely, change it at the account level:
GitHub → Settings → Notifications → Actions.

## Why the messages were hard to read

`Monitor.content()` built the body by `json.dumps`-ing each finding, the whole
live Stripe account object, a metrics dictionary and the full POS profile, then
appended every event ID. Amounts were raw minor units, so a $750 payment read
as `75000`, and timestamps were epochs.

`risk-monitor/notify.py` replaces that with a fixed structure:

```
WHAT FIRED          one plain sentence per finding, with the measurement
                    that crossed the threshold
WHAT TO DO          the action for that severity
MERCHANT CONTEXT    24h / 7d / 30d volume, account age, live status
KNOWN GAPS          plain-language caveats, if any
-------             account, data-as-of, generated-at, alert markers
```

Every amount is formatted in the currency's own units (`$4,825.00`), including
zero-decimal currencies. Every timestamp is London wall-clock. Supporting
objects stay in durable state, where the diagnostics can read them, rather than
in the body. `notify.headline()` degrades unknown rule kinds to a readable name
instead of raising, so adding a rule can never block delivery.

Telegram is capped at 700 characters and carries no account identifier, owner
email or card attribute.

## Tuning

All knobs live in `risk-monitor/config.json` under `notifications`; defaults are
in `throttle.DEFAULTS` and unknown keys are ignored.

| Key | Default | Effect |
| --- | --- | --- |
| `immediate_levels` | `["Urgent"]` | severities that bypass the digest |
| `max_emails_per_run` | `4` | ceiling per monitor run |
| `max_emails_per_day` | `20` | ceiling per London day |
| `max_digest_entries` | `25` | merchants listed in one digest email |
| `account_cooldown_seconds` | `21600` | per-merchant quiet window (6h) |
| `health_confirm_checks` | `2` | consecutive checks before a health issue alerts |
| `health_max_notices_per_day` | `4` | watchdog ceiling per London day |
| `health_digest_hour_london` | `9` | hour the daily health summary is sent |
| `health_quiet_reminder_days` | `7` | reminder cadence for deliberate states |
| `warn_only_gap_codes` | `[]` | gap codes that warn instead of failing the job |

Quieter still: raise `account_cooldown_seconds`, lower `max_emails_per_day`, or
move `Amount alert` out of delivery entirely by setting `immediate_levels` to
`["Urgent"]` and relying on the daily digest.

## Before cutover

These changes are inert while `mode` is `shadow`: `deliver()` returns early, so
only the watchdog's own volume drops. Before setting `mode: active`, confirm on
one run that the digest subject and body render as expected and that
`emails_sent_today` in `health.json` tracks what landed in the mailbox.
