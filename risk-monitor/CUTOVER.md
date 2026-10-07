# Cutover: moving alert ownership from the ChatGPT task to this monitor

The goal is one alert owner. After cutover the Python monitor detects and sends
every internal risk alert, and the ChatGPT task keeps **only** merchant-draft
preparation — a capability this repository does not implement.

Nothing here is reversible by accident: active mode now requires an explicit
`activation` block in `config.json`, and the accumulated shadow backlog cannot
be released by a mode flip alone.

## Current blockers

As of the last snapshot on `master`:

- `last_completed_at` is **null**. The monitor has never finished a gap-free
  comprehensive run, which is the documentation's own cutover criterion.
- `pending_alert_count` is **15**. Those candidates predate cutover and the
  ChatGPT task has probably already alerted on most of them.

Both are checked by `cutover_check.py`. Do not set `mode: active` until it
prints GO.

## Division of responsibility after cutover

| Capability | Owner |
| --- | --- |
| Deterministic rule evaluation | Python monitor |
| Internal risk alerts (email + Telegram) | Python monitor |
| Monitoring-failure alerts | Python watchdog |
| Daily global account sweep | Python monitor |
| Unsent payout-blocked merchant drafts | ChatGPT task (drafts only) |
| Public legitimacy research, document review | human |

The Python monitor never creates merchant drafts and never messages a merchant.
That is why the ChatGPT task is reduced rather than deleted.

## Step 1 — Reach a clean run

Run **Loyverse risk cutover** → `readiness`. It prints one line per acceptance
criterion and a GO/NO-GO. It sends nothing and changes nothing.

*Activation boundary configured* is advisory and stays failing until step 4 —
that is expected, since the block is written as part of activating. The monitor
itself still refuses to start in active mode without it.

Work the blocking failures until it reports GO. The two expected ones:

- *Gap-free completed run* — the monitor must finish a run with no gap codes.
  Inspect `health.json` after each hourly run; `gap_codes` names what is still
  incomplete. `onboarding_ip_coverage_incomplete` is the known one: either
  obtain the missing onboarding IP evidence, or make a deliberate, recorded
  decision to narrow the coverage contract. Do not remove the flag without one.
- *Shadow candidates reconciled* — step 2.

## Step 2 — Decide the 15 candidates

Run **Loyverse risk cutover** → `candidates`. For each pending candidate it
prints the merchant, the findings in plain language, and whether the authorised
mailbox's Sent folder already mentions that account or its charges.

A Sent match means something was already communicated about that account. It is
a strong hint, not proof the same finding was raised — read the entry before
deciding.

Then run → `decide` with either:

- `decisions`: `loyverse_payments_risk_v1:acct_x:events:ab12=baseline loyverse_payments_risk_v1:acct_y:amount:ch_9=send`
- or `decide_all` = `baseline` with `confirm_count` set to the exact undecided
  count, if you have reviewed them all and they are all covered.

`baseline` means never send. `send` releases it to deliver on the first active
run. Every decision is recorded in the audit chain with your GitHub actor.

Changing a recorded decision is refused; that needs a deliberate review, not a
re-run.

## Step 3 — Retire alerting from the ChatGPT task

Do this **before** activating, and note the London time you did it.

1. Open the task (ID `6ab3dc2146d0819187cbc8f1f990a530`) in ChatGPT.
2. Replace its instructions with `risk-monitor/CHATGPT_DRAFTS_TASK.md` in this
   repository. That version removes all alerting, email sending, Telegram
   delivery and sweep reporting, and keeps only payout-blocked merchant drafts.
3. Confirm after its next run that it sent no internal email and no Telegram
   message, and that any draft it prepared is still unsent.

Keep the task **enabled**. Disabling it loses the draft capability.

Do not delete its state file. It is the only record of what the previous owner
sent, and it is what the reconciliation in step 2 is judged against.

## Step 4 — Activate

Edit `risk-monitor/config.json`:

```json
"mode": "active",
"activation": {
  "boundary_epoch": <UTC epoch seconds when you completed step 3>,
  "legacy_alerting_retired": true
}
```

`boundary_epoch` is the moment the ChatGPT task stopped alerting. Candidates
first seen before it never deliver unless you explicitly released them in step
2. Candidates first seen after it are ordinary new findings.

The monitor refuses to start in active mode if either field is missing or if
`legacy_alerting_retired` is false, so a mode flip on its own cannot release
the backlog.

Commit the config. The push triggers a monitor run.

## Step 5 — Verify the first active run

Within the first hour, confirm all four:

1. One internal email arrived, with a Gmail message ID and the `SENT` label.
2. A matching Telegram message arrived in **Loyverse Payments Risk**, with a
   confirmed receipt in `risk-telegram/state.json` — an enqueue is not a
   delivery.
3. `health.json` shows `mode: active`, `status: healthy` and
   `pending_alert_count` falling.
4. `emails_sent_today` in `health.json` matches what actually landed in the
   mailbox. If it does not, stop and reconcile before the next run.

If the run fails after a send intent was persisted, **do not re-run to force a
retry**. Reconcile Sent and the Telegram receipts first; the monitor is built
to never blindly resend, and a manual retry defeats that.

## Rolling back

Set `mode: shadow` and commit. The monitor stops sending merchant alerts
immediately; the watchdog keeps reporting. Recorded candidate decisions and
delivery receipts survive, so a second attempt resumes rather than restarts.

Re-enable alerting in the ChatGPT task only if the outage will outlast your
tolerance for no coverage, and expect to reconcile both sides again afterwards.

## What this does not solve

Carried over from the build documentation, unchanged by this work:

- The Python formatter recommends "Investigate" or keeping an existing pause.
  It does not implement the full ChatGPT "Transactions are OK / Investigate /
  Block payouts" decision policy.
- The Gmail keyword classifier is conservative triage. It cannot interpret an
  original message body the way the ChatGPT workflow did, and it will queue
  ambiguous requests for a human instead of resolving them.
- The new-account legitimacy rule queues a human review. It performs no
  registry search, public research or document verification.
