# FACADASH automation — Phase 1 (server-side daily refresh)

Replaces the manual "run queries in Snowflake → save CSVs → run scripts → drag the zip to Netlify" loop with a **scheduled GitHub Action** that pulls from Snowflake and regenerates the dashboard data, hands-free. No desktop, no manual exports.

## What it does
1. GitHub Action (`kpi-pull.yml`) runs on a schedule (default 06:00 & 14:00 UTC) or on demand.
2. `run.py` connects to Snowflake (key-pair) and runs the canonical **daily as-of** queries in `sql/` — the same logic you ran by hand, but server-side.
3. From those query outputs it regenerates **both** dashboard data files:
   - `daily-history.js` (FACADASH daily page) via `backfill_daily.py`
   - `kpi-data.js` (Study & Churn pages) via `build_kpi_data.py`
4. The Action commits both; Netlify auto-deploys on push. **No desktop, no Excel, no manual exports.**

## Scope & validation — READ THIS
- **Covers both data files.** The Excel workbook is NOT needed: the workbook tabs were just pasted query outputs, and the "cleaning" (device-clock receipt filtering, etc.) lives in the SQL. `build_kpi_data.py` reads the tidy query outputs directly and computes the same `kpi-data.js`. See the query → field map at the top of `build_kpi_data.py`.
- **Two things to confirm on the first supervised run:**
  1. **Column names.** `run.py` / `build_kpi_data.py` reference the query output columns (e.g. `ACTIVE_MERCHANTS`, `CUM_PAYING_EVER`). If a query emits a different name, adjust the constant — quick label fix, not logic.
  2. **Diff `kpi-data.js` against the current workbook-built version.** Numbers should match within rounding. If a field is off, it's a derivation to reconcile (the Study/Churn pages are the place to eyeball: monthly evolution, cohort retention, country tables).
- The `sql/` here are concrete validated queries (no placeholder views). Keep `country_names.py` in sync with `refresh.py` if countries are added.

## One-time setup
**1. Snowflake (Dmytro/Alex):** create a read-only role + small warehouse + a key-pair for the bot. Recommended:
```sql
CREATE ROLE IF NOT EXISTS FACADASH_READER;
GRANT USAGE ON DATABASE LOYVERSE_DATA_LAKE TO ROLE FACADASH_READER;
GRANT USAGE ON SCHEMA LOYVERSE_DATA_LAKE.PUBLIC TO ROLE FACADASH_READER;
GRANT SELECT ON ALL TABLES IN SCHEMA LOYVERSE_DATA_LAKE.PUBLIC TO ROLE FACADASH_READER;
GRANT SELECT ON FUTURE TABLES IN SCHEMA LOYVERSE_DATA_LAKE.PUBLIC TO ROLE FACADASH_READER;
CREATE WAREHOUSE IF NOT EXISTS FACADASH_WH WAREHOUSE_SIZE=XSMALL AUTO_SUSPEND=60 AUTO_RESUME=TRUE INITIALLY_SUSPENDED=TRUE;
GRANT USAGE ON WAREHOUSE FACADASH_WH TO ROLE FACADASH_READER;
```
(Interim shortcut: reuse the existing `TARS_SERVICE_USER` key-pair that already powers `snowflake-pull.yml`, and skip the new role until later.)

**2. Repo:** drop these into the dashboard repo (the one that auto-deploys to Netlify, e.g. `tars-overview`):
- `kpi-automation/` (this folder: `run.py`, `requirements.txt`, `sql/`)
- `.github-workflows-kpi-pull.yml` → rename/move to `.github/workflows/kpi-pull.yml`
- ensure `kpi_run/backfill_daily.py` and the `Daily DBs Dash Queries/` folder exist in the repo (or adjust the `*_DIR` env vars in the workflow).

**3. GitHub secrets** (repo → Settings → Secrets → Actions):
`SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PRIVATE_KEY` (full PEM), `SNOWFLAKE_PRIVATE_KEY_PASSPHRASE` (if set), `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_ROLE`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`.

## First run (supervised)
Trigger the Action manually (workflow_dispatch). Check the logs:
- each query prints row counts;
- if `backfill_daily.py` errors on a missing column, open `run.py`, fix the `VERIFY` column name to match the query's actual output, and re-run. (These are quick label fixes, not logic changes.)
Once green, the commit + Netlify deploy happen automatically and it'll run on schedule thereafter.

## Cadence & cost
Default twice-daily. The receipts/TPV query is the heavy one; keep cadence modest until Phase 2 (incremental Streams + Tasks) makes it cheap enough for higher frequency. The `FACADASH_WH` auto-suspends after 60s, so idle cost is ~zero; add a Snowflake **resource monitor** on it as a hard ceiling.

## Files
- `run.py` — the runner (Snowflake → query outputs → `backfill_daily.py` + `build_kpi_data.py`).
- `build_kpi_data.py` — generates `kpi-data.js` from the tidy query outputs (replaces the Excel→`refresh.py` path).
- `country_names.py` — ISO2→name dict used by the generator (keep in sync with `refresh.py`).
- `sql/` — the canonical daily as-of queries.
- `requirements.txt` — Python deps.
- `.github-workflows-kpi-pull.yml` — the GitHub Action (move to `.github/workflows/`).
