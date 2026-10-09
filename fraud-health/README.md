# Fraud Health pipeline

Daily newly-enabled merchant review for Loyverse Payments. Publishes to
`activated-payments/risk-health/`, rendered by `activated-payments/risk-health.html` and
deployed to Cloudflare Pages behind Access.

Built 2026-10-09 to replace a ChatGPT scheduled task that generated JSON patches by hand.

---

## The problem it fixes

Stripe publishes no `charges_enabled_at`. The previous process dated enablement from
`TOS_ACCEPTANCE_DATE` — when the merchant accepted the terms, which can be days before
Stripe finishes verification — or, in several batches, from the account creation date.
Neither is enablement, so the "newly enabled today" cohort was neither correct nor
reproducible.

But a real enablement history already existed, unnoticed. `activated-payments/pull.js`
derives `status` as:

```js
if (truthy(chargesEnabled)) return 'Enabled';
```

so `status == "Enabled"` **is** `charges_enabled == true`. That file has been regenerated
and committed roughly every three hours since 2026-07-17. Replaying its git history gives
a genuine, observed time series of `charges_enabled` per account.

`fraud-health/enablement-ledger.json` is that replay: 617 observations over 1,383
accounts. A `false -> true` edge between two observations is direct evidence, bounded by
the sampling gap (median 3.5h) rather than guessed from a proxy.

## Evidence levels

Every account carries one, and the cohort rules follow from it:

| level | meaning | cohort-eligible |
|---|---|---|
| `observed_transition` | we saw not-enabled, then enabled | yes |
| `observed_arrival_enabled` | first seen already enabled, but created after the ledger began, so bounded by its creation instant | yes |
| `enabled_before_ledger` | already enabled at first sighting and created before the ledger began — instant genuinely unknown | **no** |
| `never_enabled` | never observed enabled | no |

An account is in day *D*'s cohort when the window ENDS in *D*, per Europe/London calendar
day with real BST/GMT handling. If the whole window sits inside *D* the member is
`confirmed`; if it crosses midnight it is `boundary_ambiguous`, reviewed on *D* anyway and
published with the ambiguity visible. Dropping straddlers would leave permanent unreviewed
holes in a fraud control, which is worse than a disclosed ±3h.

Everything excluded gets a reason code, published with the cohort.

## Risk is not uncertainty

The methodology in `index.json` is authoritative; the code reads it rather than restating
it. Two rules are enforced on every record by `validate.py`:

1. `score == sum(riskDimensions)`, each within `[0, max]`.
2. Missing evidence never adds risk. It lowers `reviewCompleteness` and lands in
   `unverified`. A dimension of 0 means *no anomaly observed*, never *risk disproven*.

Because a brand-new unchecked merchant correctly scores near 0, `reviewPriority` carries
the operational consequence separately — a 0-score merchant at 25% completeness reads
"Verification outstanding", not "Normal monitoring".

A human may still override a score (`riskOverrideScore` + `riskOverrideReason`). The sum
invariant holds regardless; the override drives the band and the action, and the dashboard
marks it `OVR`.

## Automated vs. researched

Independent verification cannot run inside a scheduled job, so the two are split and
never blurred:

- **`signals.py`** — what the warehouse proves on its own, on a schedule. It may only
  award points for an anomaly it *observed* (shared email across accounts, enable/disable
  churn, disposable-mail domain, card volume on a non-enabled account). It cannot assess
  legal registration, premises, identity or operating history, and says so on every record.
- **`evidence/<accountId>.json`** — findings written by a reviewer (person or model),
  merged deterministically. **A finding with `status: "verified"` and no `url` is rejected
  at validation.** An inconclusive finding is recorded so the next reviewer doesn't repeat
  the search, but it does not raise completeness or confidence.

A review is `evidence-based` only when a check actually concluded against a cited source;
otherwise it stays `automated-signals-only` at low confidence.

## Commands

```bash
python3 fraud-health/run.py backfill    # rebuild the ledger from full git history
python3 fraud-health/run.py ledger      # fold in the current activation-data.js
python3 fraud-health/run.py cohort --day 2026-10-08   # inspect, no writes
python3 fraud-health/run.py daily       # the scheduled job (defaults to yesterday)
python3 fraud-health/run.py validate    # integrity gate
python3 fraud-health/run.py remediate   # one-off repair, already applied
python3 -m pytest fraud-health/tests -q
```

`backfill` needs full history (`git fetch --unshallow`); nothing else does.

## Idempotency

Re-running a day rewrites that day's records and touches nothing else. An empty cohort
writes nothing at all, so `generatedAt` never advances on a run that produced no data. An
`automated-signals-only` record will not overwrite an `evidence-based` one.

## Scheduling

`fraud-health-daily.yml` hangs off the completion of the payments activation pull, because
that pull is its only input. GitHub drops the `schedule` event in this repo — the pull
workflow documents it happening in July, on 08-06 and for eight hours on 08-27 — so the
cron is a second chance, not the primary trigger. Each run walks the last three complete
London days and reviews any that has no report, so a missed run self-heals.

`fraud-health-daily` is listed in `deploy-cloudflare.yml`'s `workflow_run` trigger; without
that, a review committed by `GITHUB_TOKEN` would never reach the site.

## Known limitations

- **The ledger starts 2026-07-17.** 49 accounts were already enabled before the first
  observation; their enablement instant is unrecoverable and they are permanently
  cohort-ineligible. They are in the historical reviewed population.
- **Resolution is the pull cadence**, roughly 3h (p90 8.7h, worst observed 30.6h across a
  gap in the pull). Windows narrow as `connected_ts` — added to the pull on 2026-10-09 —
  accumulates.
- **No live Stripe API.** Everything comes from the Snowflake share, so `requirements`,
  `disabled_reason` detail and payout-level state are not available to this pipeline.
- **City/state/MCC/website** were not pulled until 2026-10-09 and populate from the next
  pull onward. Until then, state-level registry checks cannot be targeted, which is the
  single biggest limit on independent verification.
- **`reviewCompleteness` tops out at 25% without a reviewer.** That is the honest ceiling
  for warehouse-only evidence, not a defect.
