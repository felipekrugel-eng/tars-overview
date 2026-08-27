# Two workbook automations — repo-ready

Drop these three folders into `felipekrugel-eng/tars-overview` at the repo root and push:

```
margin-automation/          -> Margin vs Competitors, rebuilt every 3 hours
merchant-base-automation/   -> US Merchant Base, rebuilt daily
.github/workflows/          -> margin-pull.yml + merchant-base-pull.yml
```

Both follow the `payments-pull.yml` pattern already in that repo: pull → rebuild →
LibreOffice headless recalc → verify → commit the finished `.xlsx`. No computer
dependency. Each writes only inside its own folder, so the rebase-retry push cannot
conflict with the CASE, FACADASH, activation, cusum or payments pulls.

**Both were run end to end here and both pass their verify gates.** Numbers below are
from those runs.

---

## 1. margin-automation

| | |
|---|---|
| Output | `output/Loyverse_Payments_Transaction_Margin_vs_Competitors.xlsx` |
| Inputs | `payments-automation/data/{transactions,icplus_costs}.csv` — already committed every 3h |
| Snowflake cost | **zero.** Reuses payments-pull's exports |
| Trigger | `workflow_run` on payments-pull completing |
| Runtime | ~90s rebuild + ~10s recalc |

### Test result

```
rows 13,452 · volume $278,989.23 · revenue $7,938.71 (take 2.85%)
cost $6,951.90 = 2.49% of volume · margin $986.81 (0.35%)
  interchange 1.79% · card scheme 0.27% · Amex 0.10% · Stripe 0.34%
formula errors: 0 · Rate Card unchanged · all identities hold
```

### The template

`tools/make_margin_template.py` converted your Aug 25 workbook into
`template/…xlsx` — run once, already done. Six fixes:

1. **Re-ranged 2,264 formula references** from the `$16091` ceiling to `$300000`.
2. **Converted 321,780 XLOOKUPs to INDEX/MATCH.** XLOOKUP works on LibreOffice 26.2
   (tested) but the apt build on `ubuntu-latest` may predate it, which would turn all
   321,780 cells into `#NAME?`. INDEX/MATCH removes the version risk entirely.
3. **Relocated the floating footers** (old rows 16093–16097) to twelve live scenario
   totals on `Summary` rows 58–69.
4. **Normalised column C** to `=MONTH($B)` — it was blank in rows 3–6, an array
   formula in row 7, static from row 8.
5. **Trimmed the BE/BF two-row overshoot.**
6. **Replaced the `Sheet1` PivotTable** with `Merchant Months`, a self-extending
   formula tab. Reproduces your pivot row for row and totals 16,089 txns.

File went 19.3 MB → 11.1 MB.

### Never touched

`Rate Card` and `Merchant Months`. The builder snapshots both before writing and
**refuses to save** if either changed; `verify()` then re-checks 82 Rate Card input
cells against the template. Those rates include your 24 Aug corrections and the
Stripe IC+ tier table transcribed from the signed agreement — not reproducible from
any data source.

---

## 2. merchant-base-automation

| | |
|---|---|
| Output | `output/US_Merchant_Base_FULL.xlsx` |
| Inputs | `queries/q1_base.sql` → `data/q1_export.csv` |
| Trigger | daily 04:40 UTC |
| Runtime | ~4 min on a 90k-row fixture |

### Test result

```
Full Base 90,757 rows · 65 generated columns + ACTION + 26 model columns
model formulas 246,288 (only the 10,262 rows with GTV > 0)
Margin Assumptions: card volume $90.3M/mo · breakeven T1 2.233%
  revenue at 1.99% $1.80M · at 2.29% $2.07M · at 2.49% $2.25M
  margin at 1.99% -$219,688 · at 2.29% +$51,335 · at 2.49% +$232,017
formula errors: 0 · VERIFY OK
```

Tested against `data/q1_export.FIXTURE_90757rows.csv`, extracted from your Aug 21
workbook because there is no Snowflake access here (the full 131k extract exhausted
memory). It is the **dormant tail** of the base, so `Prime Base` and
`Transacting Merchants` build empty from it — correct for that slice; the rules are
proven separately below against the real 131k data.

Two housekeeping notes: delete that fixture once a real pull has run, and
`merchant-base-automation/output/US_Merchant_Base_FULL.xlsx` is the fixture-built
workbook — it is there to prove the shape, not as a real deliverable. The first real
run overwrites it.

### Pipeline

`build_full_base.py` (unchanged, yours) produces the 7 generated tabs.
`merchant_base_model.py` then adds your layer back:

- **Model columns** — Revenue × 3 prices, Margin × price × tier, breakeven, and the
  working columns. **Written only where `POS_GTV_12M_USD > 0`.** In your workbook these
  were filled across all 131,248 rows, but only 11.2% have GTV — 2,797,728 cells were
  computing an empty string. Same output, ~10× smaller file.
- **Columns resolved by name, never by letter.** Your formulas hardcoded `$AB` and
  `$AF`, which only worked because `GTV MONTH AVERAGE` had been inserted by hand at
  `AD`. Now every reference is looked up from the header row at build time.
- **`Margin Assumptions`** rebuilt with ranges bounded at 300,000 instead of 131250.
  Inputs are blue; the previous workbook's input cells win on every refresh, so a
  price you edit in Excel is not undone by the next run.
- **`ACTION` merged forward on `MERCHANT_ID`.** It is not in the SQL — Q1's SELECT
  ends at `PULLED_AT` — so a rebuild would erase it. `verify()` fails the run if
  fewer entries survive than were carried in. Your **eight existing entries are
  recovered** into `data/action_seed.csv` (streamed out of the sheet XML, since
  openpyxl runs out of memory on that 496 MB sheet) because the first automated run
  has no previous workbook to merge from. Merge path tested: 3/3 seeded entries
  written and read back.
- **`PAYING_ACTIVE N_ACTIVE` is not regenerated,** and `verify()` fails if it ever
  reappears. It held 918,622 rows of which 1,294 had data: 730 MB of empty rows and
  the largest object in the 151 MB file.

### Snapshot tabs

Now rule-driven instead of frozen pastes. **`Prime Base` was reverse-engineered
exactly** — 939 rows, zero extras, zero omissions:

```
ACTIVE_ON_POS = Yes AND IS_PAYING = Yes AND IS_TARGETABLE = Yes
AND IS_CONTACTABLE = Yes
AND GTV_CONFIDENCE IN ('2 - Plausible', 'No recent till volume')
```

The other three are **best fit, and need your confirmation.** Each rule is a strict
superset of your tab — 0 rows missing, some extra — and no column in `Full Base`
separates the extras, so those tabs were pruned by hand or exported with a filter
recorded nowhere. Automating them **widens** the tabs:

| Tab | Rule | Rule rows | Your tab |
|---|---|---|---|
| `ACTIVE L12M_GTV 2500-28000` | uncapped GTV/12 in $2.5k–$28k, contactable | 1,900 | 1,716 |
| `Transacting Merchants` | `FUNNEL_STAGE = 'Transacting'` | 52 | 50 |
| `Paying Total` | `SUBSCRIPTION_STATUS` populated | 2,540 | 1,954 |

All four rules are a single dict at the top of `merchant_base_model.py` — one-line
edits.

### SQL

`US_Merchant_Base_Refresh_Snowflake.sql` stacked Q0–Q4 in one file, against your
standing rule. Split into `queries/`: `q0_schema_discovery`, `q0b_contact_field_hunt`,
`q1_base` (the only one the pipeline runs), `q2_pos_activity_detail`,
`q3_reconciliation`, `q4_link_audit`. The original preamble and all its gotchas are
kept verbatim in `queries/_PREAMBLE.md`.

---

## Before you push

1. **Get the Snowflake grant.** `DATA_VIEWER` still lacks `IMPORTED PRIVILEGES` on
   `GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659`, flagged as an OPEN ITEM in
   `payments-pull.yml`. Until it lands, both pipelines run on schedule but the Stripe
   layer is as fresh as the last manual export. **This is still the highest-leverage
   item on the list.**
2. **Confirm the three best-fit snapshot rules** above.
3. **Pick canonical paths.** During this session the workbooks moved from `Desktop/`
   to `Desktop/Spreadsheets/`, and `Desktop/Loyverse/Payments/` still holds an Aug 18
   merchant base on the *old* 48-column schema. Once the pipeline owns the file, point
   people at the committed copy.
4. **Optional local mirror.** Neither workflow writes to your Desktop. If you want the
   file to land there too, mirror the committed output with a dated `.bak`, matching
   what `payments-call-list-refresh` already does.

## What if someone has the workbook open?

**On the CI runner: irrelevant.** Both jobs run on a fresh `ubuntu-latest` checkout.
Nobody has those files open, git writes into a workspace that is thrown away, and the
commit is of a file only the runner has touched. This is the whole reason the rebuild
lives server-side.

**It only matters if you add the local Desktop mirror.** Three guards are in place:

| Situation | Behaviour |
|---|---|
| Workbook open in Excel (`~$name.xlsx` present) | **Publish is skipped**, exit code 2. The build is kept so you can re-run without rebuilding. Nothing on disk is touched. |
| Anything reading the file mid-publish | Written to a `.tmp` sibling then `os.replace()` — one atomic rename. A reader gets the whole old file or the whole new one, never a torn one. `shutil.copyfile` truncates the destination first, which is exactly the window that produces a corrupt read. |
| Previous workbook exists but is unreadable (half-copied, Excel mid-save) | **Hard failure before the build starts.** |

That last one was a genuine hole and the reason for this section. `carry_inputs()`
originally caught the read error, logged a note, and carried on with the
`ASSUMPTIONS` defaults — which are the 21 Aug values and look completely plausible.
So a torn read would have quietly republished the old prices and dropped hand-typed
`ACTION` text, with nothing in the log but a note. Worse, `verify()`'s ACTION check
was vacuous: it compared against a baseline computed by the *same* failing function,
so `0 < 0` passed. The baseline is now floored by `action_seed.csv`, which is a plain
CSV and cannot fail that way.

Verified: missing previous → 0 carried (correct, that's a first run); torn or
zero-byte previous → raises; lock present → publish skipped and destination
untouched; lock absent → atomic replace with no temp file left behind.

**Expectation to set with anyone using these files.** Only two things you type into
the workbook survive a rebuild: **`Margin Assumptions` inputs** (the blue cells) and
**`ACTION`**. Everything else is regenerated. If someone adds a column or a tab by
hand it will be gone on the next run — which is the point of having a template, but
it needs saying out loud.

## Two things to look at in the numbers

- **1.99% flat is loss-making on both sides.** Margin workbook: -$1,400 on the test
  window. Merchant base: -$219,688/mo against a 2.233% blended breakeven. 2.29% is
  the first price that clears cost.
- **Your ticket-sanity band excludes most of the volume.** Of 10,262 merchants with
  GTV, only 4,809 pass — and clean card volume is $2.13M/mo against $90.3M
  unfiltered. Worth checking whether the $8–$60 band is doing what you intended.
