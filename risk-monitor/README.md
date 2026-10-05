# Loyverse deterministic risk monitor

This migration moves risk decisions out of a conversational scheduled task into
versioned, tested code. It starts in **shadow mode**. The existing chat monitor
remains enabled until the code monitor's authenticated sources and delivery have
been verified. Shadow findings are encrypted and retained; they are not sent as
merchant risk alerts. The watchdog does send internal monitoring-failure alerts.

## What is implemented

- Exact US/USD `amount > 75000` rule, ticket outlier, high-value burst, active-day
  surge, failed burst, sustained failures, verified same-credential patterns and
  downward retries. Successful and failed events are distinct; late arrivals and
  failed-to-succeeded transitions are evaluated. No brand/last4 identity inference.
- New-account reviews become an Elevated human investigation queue when public
  corroboration is unavailable; there is no invented fraud probability. Independent
  public legitimacy research and merchant document correspondence remain human/agent
  tasks. They are not silently reported as completed by this monitor.
- Live fee-linked charges, all refund amounts/native currencies, material refund
  status changes, dispute state/deadline thresholds, and comparable aggregate
  refund escalation. Fee refunds are never mistaken for payment refunds.
- Complete pagination using native Stripe REST, including connected-account refund
  pagination. Incremental fee checks run first. Incomplete historical partitions
  and daily global account cursors are retained across interruptions.
- Exact public ToS IP and verified fingerprint linkage leads, global country counts,
  separate United Kingdom (`GB`), Puerto Rico (`PR`, excluded from other US) and Unknown.
  Missing IP evidence and incomplete fingerprints never qualify as all-clear.
- Checksummed transaction/merchant extraction evidence. Commit time and latest charge
  time never substitute for extraction success. Stale data remains explicitly degraded.
- Gmail refund/dispute keyword scan, completed watermark with overlap, MIME original
  body retrieval and unresolved matching queue. HTML-only/ambiguous bodies require
  human review and stop the completion watermark. This is deliberately conservative:
  request intent cannot be exhaustively understood by keyword rules.
- One internal email per merchant/run where possible; later events are checkpointed
  for the next run. Internal recipients are fixed in code. There is no merchant send,
  payout mutation, refund mutation or dispute mutation adapter.
- Persistent send intents, Gmail Sent/Drafts reconciliation, encrypted Telegram
  outbox reconciliation and pinned destination checks. Uncertain sends are held.

## Durable state and audit

`state.enc.json` is an encrypted manifest pointing to an authenticated snapshot
and up to 64 encrypted change journals. Recovery verifies checksums and the audit
chain, then replays changes to dedupe history, attempts, object state, cursors and
delivery intents. Periodic snapshots bound replay work; immutable audit files remain. It is compressed and AES-GCM encrypted with a purpose-specific HKDF key
derived **inside the GitHub runner** from the existing Telegram secret. The Telegram
token is never retrieved into a local tool, printed, or moved to another host.
`bootstrap.enc.json` is encrypted to the already pinned relay public key.

State, the public health timestamp, and an encrypted audit record are committed in
one non-force Git ref update. Every checkpoint validates the current state blob
SHA; concurrent writers cannot overwrite newer state. Unrelated master changes can
be rebased only while the expected state SHA still matches. Delivery only begins
after this commit succeeds. Audit records have unique run/attempt identifiers and
a hash chain, and include actor, code revision and decision/delivery stage.
Runner audit revisions are taken from the checked-out commit, including when a
workflow completion or rerun originally referenced an older triggering commit.

The bootstrap verifies every immutable legacy shard's checksum/count/unique keys
and imports historical success/failure and processed-success dedupe. It preserves
the complete original case/draft/sent/refund/dispute records, including watched
cases and the 75-account verified partial global sweep. It does not write or delete
the active or frozen legacy files.

If durable state disappears after the first heartbeat exists, the runner refuses
to re-bootstrap. Missing state is an alarm, never permission to replay alerts.
Do not rotate `TELEGRAM_BOT_TOKEN` without re-encrypting both relay and monitor state
with the old key first. Do not delete ciphertext/audit files during migration.

## Alarms

`loyverse-risk-watchdog.yml` has a separate scheduler, concurrency group and durable
state. It checks the monitor workflow's enabled status, heartbeat age, charge
evaluation age, coverage gaps, shadow mode and pending delivery. It runs on the
existing externally-woken cusum workflow completion as well as its own cron.
Failure alerts are deduped by failure/day; recovery requires healthy coverage.
The Telegram relay runs on monitor/watchdog completion, because commits made with
GitHub's built-in token do not trigger ordinary push workflows.

**The GitHub watchdog cannot detect a complete GitHub outage while GitHub itself
cannot run it.** `RISK_HEARTBEAT_URL` connects an external dead-man alarm. A healthy
complete production run pings it; a degraded run sends `/fail`; a killed/disabled
runner sends no ping. Configure that external alarm's notifications to exactly
Felipe, Caio and Alex and test receipt before cutover. No transaction data is sent
to the heartbeat service. Missing external alarm configuration is degraded.

## Required secure setup

Existing `TELEGRAM_BOT_TOKEN` is reused only on GitHub Actions. Add these repository
Actions secrets through GitHub Settings → Secrets and variables → Actions:

1. **`STRIPE_RISK_READ_KEY`** — live platform read-only/restricted Stripe key for
   `acct_1SSKsA7e4AMQfKY3`. Permit account, connected-account, application-fee, charge,
   refund and dispute reads. No write permissions. Verify connected-account direct
   charge access with expanded application fees; key presence alone is insufficient.
2. **`GMAIL_RISK_OAUTH_JSON`** — OAuth credentials for
   `felipe.krugel@loyverse.com`, JSON with `client_id`, `client_secret`, `refresh_token`.
   Gmail read/search and internal send scopes are needed (read-only + send is enough
   for this adapter; it does not create merchant drafts). An existing ChatGPT Gmail
   connection does not provide a runner OAuth refresh token. The adapter verifies
   the mailbox profile and hard-codes all recipients.
3. **`RISK_HEARTBEAT_URL`** — secret ping URL from an external Healthchecks-compatible
   check (`https://hc-ping.com/...` or `https://healthchecks.io/...`). Configure an
   hourly interval plus 30-minute grace, verified internal recipients, and a failure
   notification test. Do not paste any secret into chat or commit it.

The runner reports missing/invalid credentials; it never silently falls back to
samples, cached processor data or a different mailbox/platform.

## Cutover checklist

1. Keep `config.json: mode=shadow`. Run **Loyverse deterministic risk monitor** and
   inspect `health.json` and Actions logs. Logs never contain account/card/body details.
2. Add the three secrets above. Complete processor and global sweeps; ensure every
   succeeded export charge is reconciled to live fee-linked access or explicitly
   investigated. Migrated completed partitions do not contain reproducible fingerprint
   cache, so a fresh complete sweep is needed before claiming fingerprint coverage.
3. Reconcile shadow events against the latest legacy Sent/Drafts and Telegram receipts.
   Do not blindly release accumulated candidate alerts; legacy monitoring may have
   delivered them after the bootstrap snapshot. Retain new refund/dispute transitions.
4. Run regression tests and a controlled internal delivery test. Verify Gmail's sent
   message, encrypted Telegram outbox, receipt message ID, and audit checkpoints.
   Verify a deliberately missing heartbeat causes the external alarm and then a recovery.
5. Change mode to `active` only after these checks pass. Retire the legacy chat scheduler
   only with Felipe's explicit instruction. Keep its files for recovery and audit.

## Operations

Checkpoint retries tolerate unrelated branch updates only while the expected
encrypted state blob is unchanged. An unsuccessful checkpoint leaves the in-memory
audit head at the last committed record. Telegram receipt writes use the same
rule: retry a branch conflict only after verifying the delivery state blob has not
changed, and never retry a Telegram send.

The read-only **Loyverse risk state integrity diagnostic** workflow verifies every
snapshot/journal checksum and reports chain gaps and aggregate progress counts. It
does not send alerts or change state. **Loyverse risk verified state recovery** is
pinned to the diagnosed 5 October 2026 manifest and reconstructed state digest. Its
authenticated recovery snapshot preserves business state and delivery records;
subsequent runs verify strict replay without rewriting recovered state. Future
integrity failures require their own diagnosis, never resetting dedupe or relaxing
normal replay checks.

`health.json` reports processor items checked, accounts enumerated, and Gmail's
completed watermark. Historical backfill cursors survive the run budget. Each run
gives account enumeration a bounded share before continuing processor backfill,
uses remaining runtime for accounts once that backfill finishes, and scans Gmail
before the backfill. Null completion timestamps and in-progress
gap codes mean coverage is still incomplete, even while progress is increasing.
Historical pages without new findings are checkpointed once a minute and on
completion. New findings are checkpointed immediately before delivery; the run's
failure/budget checkpoint retains any remaining cursor progress.
Unmatched export charges remain an explicit coverage gap. They do not cause an
already completed, current full fee sweep to restart; interrupted sweeps still
resume and complete, and the daily sweep schedule remains in force.

Run tests: `python -m unittest discover -s risk-monitor/tests -v`.

Green tests prove rule/failure behavior against fixtures; they do not prove live
permissions or delivery. A finished workflow with gap codes is **degraded**, not
complete monitoring. To resolve uncertain delivery, verify Sent/receipts and record
the receipt; do not clear the intent or rerun the side effect.

During shadow migration, safely checkpointed backfill/account scans with only
known in-progress gap codes finish with a GitHub warning instead of a failed job.
This avoids repeated GitHub failure emails for expected resumable work. Health
remains degraded, the independent watchdog continues, and the external alarm
remains down. Credential, integrity, runtime and unexpected source errors still
fail, as does incomplete active-mode coverage or unmatched exports after backfill.

Rule changes require a regression fixture and a reviewed commit. Changes to schedule,
mode or recipients are visible in Git history; encrypted checkpoints record run actors.
The current API adapter has no operation that can disable its own scheduler.
