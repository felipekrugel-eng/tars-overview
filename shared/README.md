# shared/ — the things both payments pipelines must agree on

Two pages describe the Loyverse Payments book: the **Summary of Margins** (built by
`payments-automation/`) and the **Payment Profile** (built by `activated-payments/`). For
months they published different numbers for the same quarter, and every explanation was a
different one.

This directory holds the three things that stop that happening again.

---

## 1. The snapshot — one pull, one instant

`payments-automation/pull_payments.py` is now the **only** job that pulls charge-level facts
from Snowflake. It fixes a single cut-off timestamp *before* it runs anything, substitutes it
into all three queries, and writes:

| file | what |
|---|---|
| `payments-automation/data/transactions.csv` | one row per charge |
| `payments-automation/data/icplus_costs.csv` | one row per IC+ fee line |
| `payments-automation/data/platform_fees.csv` | Stripe's platform fees by bucket |
| `payments-automation/data/pull_status.json` | the manifest, including `snapshot_as_of_utc` |

Both pipelines read those files. `activated-payments/pull.js` no longer queries Snowflake for
anything that appears on both pages.

**Why a cut-off and not just "one job".** Three queries issued seconds apart each see whatever
had landed by the time they ran, so even a single pull is not a single instant unless it is
made to be one. The cut-off is also deliberately a few minutes in the past
(`SNAPSHOT_LAG_MINUTES`): Stripe's feeds land with a delay, and cutting at *now* slices through
a half-arrived minute where the charges exist but their fee rows do not — which reads as free
volume and understates cost.

**What is still pulled live by `activated-payments`**, and why that is fine: accounts,
subscriptions, registrations, KYC, terminal orders, and authorisation *attempts*. None of them
appear on the margins page, so there is no second number for them to contradict.

## 2. `fx.json` — one rate

GBP matters because Stripe settles the Loyverse platform in sterling while merchant charges
are mostly USD. The margins build used to *derive* the rate from Stripe per run while the
profile used a hardcoded `1.34` — about $80 apart on the same book, permanently.

Deriving per run cannot reconcile: two pipelines that pull at different times disagree by
whatever sterling did in between, and the published figures restate with no code change. So
the rate is **pinned** here and read by both. Stripe's live rate is still derived on every
margins build, purely to warn when the pin has gone stale.

## 3. `reconcile.py` — the check

Run in CI by `activated-payments-pull` immediately after the profile is rebuilt, before
anything is committed. It compares volume, transactions, revenue and cost across the two
pages, and asserts both carry the **same snapshot instant**. It exits non-zero on drift, so a
build that would publish contradictory numbers fails instead of shipping them.

```
python3 shared/reconcile.py
```

---

## Ordering

`payments-pull` takes the snapshot and commits it together with the margins page built from
it. `activated-payments-pull` is chained to `payments-pull` completing, so a new snapshot is
always followed by a profile rebuilt on that same snapshot. Without the chain, margins would
show vintage N while the profile still showed N-1 for up to three hours — which is the
original complaint, in a smaller window.

## If you change one side, change the other

These must stay in step, and each file says so at the point it matters:

- the eight platform-fee buckets — `queries/query3_platform_fees.sql` ↔ `PLATFORM_FEE_ROWS`
  in `refresh_workbook.py` ↔ `PROC`/`SUBS` in `pull.js`
- the network-cost set (`interchange`, `card_scheme`, `discount`) — `NETWORK` in
  `refresh_workbook.py` ↔ `NON_NETWORK_FEES` in `pull_payments.py` (the split now happens in the pull, and `pull.js` reads the result)
- fixed Stripe subscriptions (Premium Support, Sigma) stay **out** of cost on both pages, and
  are disclosed below the line

`reconcile.py` will catch it if they drift, but it tells you *that* something broke, not what.

---

## Repository size

Git keeps every version of every file forever. This pipeline runs ~15× a day, and it used to
re-commit an 80 MB fee export and a 67 MB workbook on every run — roughly 150 MB of permanent
history per run, against about 150 MB of actual current data. The repository reached **9.5 GB,
~98% of it superseded copies nobody has ever opened**, and `Checkout repo` had started taking
minutes in every workflow that clones it.

What changed:

| | before | after |
|---|---|---|
| committed every run | ~150 MB | ~16 MB |
| `icplus_costs.csv` (80 MB) | every run | once a day |
| the workbook (67 MB) | every run | once a day |
| what the Profile reads | the 80 MB raw export | `icplus_by_charge.csv`, 2.8 MB |

`icplus_by_charge.csv` is the raw fee rows collapsed to one row per **(charge, fee currency)**
— 504,000 rows down to 58,000. The currency grain is not optional: a charge can carry fees in
more than one currency, and merging them forces a guess at the rate, which is what put the
Profile $5.69 adrift of margins once already. Verified to reproduce the Profile's figures to
the cent.

The two large files are still committed daily and still downloadable; they exist for analysis,
not for the pages. Anything fresher than a day is better pulled straight from Snowflake.

**The 9.5 GB already accumulated is separate.** `.github/workflows/repo-shrink.yml` reclaims
it, but it rewrites history and force-pushes, so it needs the pipelines paused first and every
local clone re-cloned after. Read the header of that file before running it. Nothing breaks at
9.5 GB — it is slow and over GitHub's 5 GB soft limit — so it is a deliberate maintenance job,
not an emergency.
