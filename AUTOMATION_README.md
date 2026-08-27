# Two workbook automations

**Both are LIVE in `felipekrugel-eng/tars-overview` as of 27 Aug 2026.** Numbers below
are from real CI runs, not local tests.

```
margin-automation/          -> Margin vs Competitors, rebuilt daily 05:20 UTC
merchant-base-automation/   -> US Merchant Base, rebuilt daily 04:40 UTC
.github/workflows/          -> margin-pull.yml + merchant-base-pull.yml
```

Deploy or update with `bash push_automation.sh --push` from `~/Desktop/Automation`.

Both follow the `payments-pull.yml` pattern already in that repo: pull → rebuild →
LibreOffice headless recalc → verify → commit the finished `.xlsx`. No computer
dependency. Each writes only inside its own folder, so the rebase-retry push cannot
conflict with the CASE, FACADASH, activation, cusum or payments pulls.

Both follow the same shape: pull → rebuild → LibreOffice headless recalc → verify →
commit. No computer dependency.

---

## 1. margin-automation

| | |
|---|---|
| Output | `output/Loyverse_Payments_Transaction_Margin_vs_Competitors.xlsx` |
| Inputs | `payments-automation/data/{transactions,icplus_costs}.csv` — committed every 3h |
| Snowflake cost | **zero.** Reuses payments-pull's exports |
| Trigger | daily 05:20 UTC + `workflow_dispatch` + on code/template change |
| Runtime | ~2 min |

### Live CI result (27 Aug 2026)

```
rows 18,794 · volume $417,522.13 · revenue $11,962.27 (take 2.87%)
cost $10,022.34 = 2.400% of volume · margin $1,939.93 (0.465%)
Fee Breakdown: 215 fee lines · 20 new fee columns auto-created
formula errors: 0 · Rate Card unchanged · all identities hold · VERIFY OK
```

The first live run surfaced two defects that local testing had not, both since fixed:
`Fee Breakdown` capped its rows at the template's own length and silently truncated,
and `Transaction Hyper Detail` dropped fee line items with no matching column. Stripe
had added 20 of them since 25 Aug — mostly UK interchange, following the UK launch.

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
| Inputs | `queries/q1_base.sql` → `data/q1_export.csv.gz` |
| Trigger | daily 04:40 UTC + `workflow_dispatch` + on code change |
| Runtime | ~20 min |

### Live CI result (27 Aug 2026)

```
pulled 131,778 rows · 66 generated columns + ACTION + 26 model columns
model formulas 352,224 (only the rows with GTV > 0)  ·  file 29.9 MB
ACTION merged onto 8 rows  ·  action_entries=8  ·  sheets=13  ·  VERIFY OK
snapshots: Prime Base 944 · ACTIVE L12M 1,902 · Transacting 58
           Paying Total 2,557 · EMAIL BASE 3,806
```

Against the hand-built file: **3,156,843 formulas → 352,224 (−89%)** and
**151 MB → 29.9 MB (−80%)**, with identical output.

Business numbers from that run, worth knowing:

- **30-day till volume $47,796,564; through Loyverse Payments $245,113.** Attach rate
  0.51%. **$47.55M/30d still off our rails.**
- **EMAIL 131,778 (100%) · PHONE 235 (0.18%) · CONTACT_NAME 358 (0.27%).** This inverts
  the old SQL note ("Email 4% / Phone 1%"): email-led outreach is viable, anything
  phone-led is dead at 235 numbers.
- **`KYC rejected, still transacting: 3`**, and 571 merchants with suspect GTV (547
  "ticket size suggests another currency", 24 "volume too large to trust").
- 124,517 of 131,778 (94.5%) are dormant; only 4,103 have any 30-day till volume.

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

## Open items

1. ~~Get the Snowflake grant.~~ **Not needed.** `DATA_VIEWER` reads both the data lake
   and the Stripe share — proven by the first live run (131,778 rows with the payments
   columns populated). The "OPEN ITEM" comment in `payments-pull.yml` is stale and
   should be deleted; believing it cost real time here.
2. **Confirm the three best-fit snapshot rules** above. Live counts came out at
   `ACTIVE L12M` 1,902 · `Transacting` 58 · `Paying Total` 2,557.
3. **Pick canonical paths.** During this session the workbooks moved from `Desktop/`
   to `Desktop/Spreadsheets/`, and `Desktop/Loyverse/Payments/` still holds an Aug 18
   merchant base on the *old* 48-column schema. Once the pipeline owns the file, point
   people at the committed copy.
4. **Optional local mirror.** Neither workflow writes to your Desktop. If you want the
   file to land there too, mirror the committed output with a dated `.bak`, matching
   what `payments-call-list-refresh` already does.

## Repo growth — why the cadences look the way they do

Both jobs commit binaries, and git history is permanent. Left unchecked the first
version of this would have added ~330 MB/day (~10 GB/year) against GitHub's 1 GB
recommended repo size. Two changes fixed most of it:

| | Before | After |
|---|---|---|
| `margin-pull` | 8x/day x 19.3 MB = **154 MB/day** | daily = **19 MB/day** |
| merchant-base export | 53.2 MB plain CSV/day | gzipped = **~4.9 MB/day** |
| merchant-base workbook | 29.9 MB/day | unchanged |
| **total** | **~237 MB/day** | **~54 MB/day** |

`margin-pull` used to chain on `payments-pull` completing, which is 8 runs a day. The
workbook is the downloadable artefact, not the live surface — the dashboard is that —
so daily is enough. It now runs at 05:20 UTC, which sits between `payments-pull`'s
3-hourly slots with ~90 min of clearance, preserving the original reason for chaining:
never read CSVs that are midway through being replaced. `workflow_dispatch` is still
there whenever you want it fresher.

The export is committed gzipped (measured at **8.9%** of plain). `build_full_base.py`
reads plain CSV and is untouched; `run.py` decompresses to a working copy that is
gitignored. The compression is made **deterministic** — `mtime=0` *and*
`filename=""` — because both the timestamp and the destination path leak into the gzip
header otherwise, and either one would make git see a change on every run and
re-commit ~5 MB daily even when the data is identical. Verified: same input gives
byte-identical output, changed input gives different output, and the round-trip is
byte-exact.

Still on the table if the repo gets tight: move the `.xlsx` files to Actions artifacts
or Releases instead of git, which would take this to near zero.

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
