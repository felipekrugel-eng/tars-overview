#!/usr/bin/env python3
"""
FACADASH full data refresh — server-side Snowflake pull (NO desktop, NO Excel, NO manual CSVs).

Runs the canonical daily "as-of" queries directly against Snowflake, then regenerates
BOTH dashboard data files:
  - daily-history.js  (FACADASH daily page)  via backfill_daily.py
  - kpi-data.js        (Study & Churn pages)  via build_kpi_data.py
The GitHub Action commits both; Netlify auto-deploys.

Auth: Snowflake key-pair, all values from environment (GitHub Actions secrets).
Required env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY (PEM),
  SNOWFLAKE_PRIVATE_KEY_PASSPHRASE (optional), SNOWFLAKE_WAREHOUSE, SNOWFLAKE_ROLE,
  SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA
"""
import os, sys, subprocess, datetime, pathlib, re
import pandas as pd
import snowflake.connector
from cryptography.hazmat.primitives import serialization

HERE   = pathlib.Path(__file__).resolve().parent
REPO   = pathlib.Path(os.environ.get("REPO_DIR", HERE.parent))
SQLDIR = pathlib.Path(os.environ.get("SQL_DIR", HERE / "sql"))
DAILY  = pathlib.Path(os.environ.get("DAILY_DIR", REPO / "Daily DBs Dash Queries"))
KPIRUN = pathlib.Path(os.environ.get("KPIRUN_DIR", REPO / "kpi_run"))
V2     = pathlib.Path(os.environ.get("V2_DIR", REPO / "KPI Dashboard v2 (Caio)"))
WORK   = pathlib.Path(os.environ.get("WORK_DIR", HERE / "_work"))
TS     = datetime.date.today().isoformat()
DAILY.mkdir(parents=True, exist_ok=True); WORK.mkdir(parents=True, exist_ok=True)

QUERY_FILES = {
    "cohort":   "cohort_unit_economics_daily_asof.sql",     # cohort grid: monthly, cohorts, triangle
    "receipts": "receipts_tpv_daily_asof.sql",              # active/receipts by cohort×country×month
    "paying":   "country_month_mrr_daily_asof.sql",         # active paying by country×month
    "clife":    "country_registrations_daily_asof.sql",     # country lifetime reg + ever-paid
    "cregm":    "country_month_registrations_daily_asof.sql",# reg by country×month (+ regPmtd momentum)
    "rolling":  "rolling_30d_active_paying_49days.sql",      # REG_30D / ACTIVE_30D / PAYING_ACTIVE
    "mrrbu":    "mrr_bottomup_monthly.sql",                 # bottom-up current-state MRR by country x month (dashboard source of truth)
}

# Paying-base flow charts (Study & Trend monthly + FACADASH daily gross adds).
# Kept OUT of QUERY_FILES and run in its own guarded step at the very end: it is a
# heavier ~4.5-year grid query, and it must never be able to break the critical
# daily-history.js / kpi-data.js refresh above. Only the small aggregated daily
# result (~1.6k rows) comes back to the runner — the grid stays server-side.
GRACE_SQL = "daily_paying_flow_grace_vs_raw.sql"

# Per-country twin of the rolling series (REG_30D / ACTIVE_30D / PAYING_ACTIVE by country).
# Also kept OUT of QUERY_FILES and run in its own guarded step: it takes ~12 min and only
# feeds the FACADASH country filter's "Rolling 30 days" views, which degrade gracefully.
ROLLING_BY_COUNTRY_SQL = "rolling_30d_by_country_49days.sql"

# ---------------------------------------------------------------------------
# FAILURE ISOLATION (added 2026-08-29 after the 28 Aug outage)
#
# What happened: receipts_tpv_daily_asof.sql — the SECOND of the seven queries — hit the
# 3600s Snowflake statement timeout (57014) on a contended COMPUTE_WH. main() ran every
# query in one loop and wrote nothing until the loop finished, so that single timeout threw
# away the cohort pull that had already succeeded and skipped the five cheap ones entirely.
# daily-history.js got no row for the 28th and the daily registrations graph showed a hole —
# even though registrations have NOTHING to do with receipts. They just shared a basket.
#
# Three changes stop that class of failure:
#   1. DEGRADABLE — a listed query may fail without taking the run down. The rest still land.
#   2. Each query's CSVs are written as soon as that query returns, not after all seven.
#   3. build_kpi_data.py is skipped (not failed) when its receipts input is missing, so
#      daily-history.js — the file that lost the 28th — refreshes regardless.
#
# Keep this set tight: a query belongs here only if the dashboard genuinely degrades
# gracefully without it (blank series, not wrong numbers).
DEGRADABLE = {
    "receipts",  # -> active / receipts lines + kpi-data.js; every consumer handles None
    "rolling",   # -> reg30d / active30d / payingActive; backfill_daily already guards it
}

# Per-query statement timeout, seconds. The GitHub job budget is 330 min, so the receipts
# grid can afford more than the old blanket 3600s — that cap was tight enough that ordinary
# warehouse contention tripped it, which is exactly what happened on the 28th. Everything
# else keeps the previous 3600s; none of them has ever come close.
QUERY_TIMEOUTS  = {"receipts": 7200}
DEFAULT_TIMEOUT = 3600

def _private_key():
    pem = os.environ["SNOWFLAKE_PRIVATE_KEY"].encode()
    pw  = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE") or None
    key = serialization.load_pem_private_key(pem, password=pw.encode() if pw else None)
    return key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())

def connect():
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
        private_key=_private_key(),
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "FACADASH_WH"),
        role=os.environ.get("SNOWFLAKE_ROLE", "FACADASH_READER"),
        database=os.environ.get("SNOWFLAKE_DATABASE", "LOYVERSE_DATA_LAKE"),
        schema=os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC"),
        client_session_keep_alive=True)

def run_sql(conn, sql_file, timeout=DEFAULT_TIMEOUT):
    sql = (SQLDIR / sql_file).read_text()
    cur = conn.cursor()
    cur.execute(f"ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = {int(timeout)}")
    cur.execute(sql)
    df = cur.fetch_pandas_all() if hasattr(cur, "fetch_pandas_all") else \
         pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])
    cur.close()
    return df

def latest(df):
    s = df["SNAPSHOT_DATE"].astype(str).str[:10]
    return df[s == s.max()].copy()

def write(path, df):
    path.write_text(df.to_csv(index=False)); print(f"   -> {path.name} ({len(df)} rows)", flush=True)

def main():
    conn = connect(); dfs = {}; degraded = []

    # Each query is isolated AND its CSVs are written the moment it returns, so a failure
    # late in the loop can never discard work that already succeeded (the 28 Aug failure
    # mode). A DEGRADABLE query that fails is logged and skipped; anything else still
    # aborts the run, because without it the dashboard would show wrong numbers, not blanks.
    def pull(key):
        f = QUERY_FILES[key]
        print(f"[run] {f}", flush=True)
        try:
            dfs[key] = run_sql(conn, f, QUERY_TIMEOUTS.get(key, DEFAULT_TIMEOUT))
            return True
        except Exception as e:
            if key not in DEGRADABLE:
                raise
            degraded.append(key)
            print(f"[run] DEGRADED — {f} failed ({type(e).__name__}: {e}). "
                  f"Continuing; only the series fed by '{key}' pause this run.", flush=True)
            return False

    try:
        # ---- 1. cohort: the daily spine (registrations, paying, MRR, ARPC) ----
        pull("cohort")
        write(WORK  / "cohort_grid.csv",             dfs["cohort"])
        write(DAILY / f"MRR QR_DB 49 Days_{TS}.csv", dfs["cohort"])
        write(DAILY / f"MRR QR_DB_{TS}.csv",         latest(dfs["cohort"]))

        # ---- 2. paying / country lifetime / registrations by month / bottom-up MRR ----
        # Cheap queries, and the ones the 28th lost for no reason. They now land before the
        # heavy receipts grid is even attempted, so a receipts timeout cannot reach them.
        pull("paying")
        write(WORK / "paying_country.csv", dfs["paying"])
        write(DAILY / f"Paying x Country per Month_{TS}.csv",
              latest(dfs["paying"])[["COUNTRY","CALENDAR_MONTH","ACTIVE_PAYING_CUSTOMERS"]])

        pull("clife")
        write(WORK / "country_lifetime.csv", dfs["clife"])

        pull("cregm")
        write(WORK  / "country_reg_month.csv", dfs["cregm"])
        write(DAILY / f"Registration Month x Country_49 Days_{TS}.csv", dfs["cregm"])
        write(DAILY / f"Registrations Month x Country_{TS}.csv",
              latest(dfs["cregm"])[["COUNTRY","CALENDAR_MONTH","REGISTRATIONS"]])

        pull("mrrbu")
        write(WORK / "mrr_bottomup.csv", dfs["mrrbu"])   # no SNAPSHOT_DATE column; write as-is

        # ---- 3. rolling 30d (DEGRADABLE) ----
        if pull("rolling"):
            write(DAILY / f"Rolling 30 Days_{TS}.csv", dfs["rolling"])

        # ---- 4. receipts grid (DEGRADABLE) — the heavy one, deliberately LAST ----
        # ~26.5M rows, one scan of LOYVERSE_RECEIPTS_UNIQUE fanned across ~70 snapshots.
        # It is both the slowest query and the only one that has ever timed out, so it runs
        # after everything else has already been written to disk.
        if pull("receipts"):
            write(WORK / "receipts.csv", latest(dfs["receipts"]))   # latest snapshot only — build_kpi_data uses ONLY the latest; writing the full ~26.5M-row grid OOM'd the runner
            write(DAILY / f"TPV and Receipts DB2_{TS}.csv",
                  latest(dfs["receipts"])[["COUNTRY","CALENDAR_MONTH","ACTIVE_MERCHANTS","RECEIPT_COUNT",
                                            "TPV_USD_APPROX","AVG_TICKET_USD"]])
    finally:
        conn.close()

    # global daily active/receipts ("49 days 1"): each merchant in one country → current-month sum = global distinct.
    # MEMORY: this used to .copy() 4 cols of the full ~26.5M-row grid AND build two full-length object-string
    # Series (g["S"], g["M"]) while the full grid was still resident — the peak alloc that OOM-killed the runner
    # right here (it surfaces as "The operation was canceled"). Now: no .copy(); compare months as compact
    # int64 PeriodArrays (not GB-sized object strings); slice to current-month rows FIRST, then build DATE.
    # Output is byte-identical.
    # Both blocks below are receipts-derived, so they are skipped when that pull degraded.
    # backfill_daily.py treats the two files as optional and leaves active/receipts blank.
    if "receipts" in dfs:
        rec = dfs["receipts"]
        cur = rec.loc[
            rec["SNAPSHOT_DATE"].astype("datetime64[ns]").dt.to_period("M")
            == rec["CALENDAR_MONTH"].astype("datetime64[ns]").dt.to_period("M"),
            ["SNAPSHOT_DATE", "ACTIVE_MERCHANTS", "RECEIPT_COUNT", "TPV_USD_APPROX"],
        ]
        agg = (cur.assign(DATE=cur["SNAPSHOT_DATE"].astype(str).str[:10])
                  .groupby("DATE")
                  .agg(ACTIVE=("ACTIVE_MERCHANTS", "sum"), RECEIPTS=("RECEIPT_COUNT", "sum"),
                       GTV=("TPV_USD_APPROX", "sum"))
                  .reset_index())
        # AVG_TICKET is derived here (GTV / RECEIPTS) rather than re-summed from the query's
        # per-row AVG_TICKET_USD, because that column is a per-cohort-row average and summing/
        # averaging it across rows would not equal the true blended ticket size.
        agg["AVG_TICKET"] = (agg["GTV"] / agg["RECEIPTS"].replace(0, pd.NA)).fillna(0).round(2)
        write(DAILY / f"49 days 1_{TS}.csv", agg[["DATE","ACTIVE","RECEIPTS","GTV","AVG_TICKET"]])

        # ---- by-country daily active/receipts/GTV (current-month rows -> DATE x COUNTRY) ----
        # Same derivation as "49 days 1" above but KEEPS the country dimension so FACADASH can
        # filter the daily graphs/tiles per country. Output is tiny (~25 countries x ~49 days).
        recc = rec.loc[
            rec["SNAPSHOT_DATE"].astype("datetime64[ns]").dt.to_period("M")
            == rec["CALENDAR_MONTH"].astype("datetime64[ns]").dt.to_period("M"),
            ["SNAPSHOT_DATE", "COUNTRY", "ACTIVE_MERCHANTS", "RECEIPT_COUNT", "TPV_USD_APPROX"],
        ]
        recc = (recc.assign(DATE=recc["SNAPSHOT_DATE"].astype(str).str[:10])
                    .groupby(["DATE", "COUNTRY"])
                    .agg(ACTIVE=("ACTIVE_MERCHANTS", "sum"), RECEIPTS=("RECEIPT_COUNT", "sum"),
                         GTV=("TPV_USD_APPROX", "sum"))
                    .reset_index())
        write(DAILY / f"49 days by country_{TS}.csv", recc[["DATE","COUNTRY","ACTIVE","RECEIPTS","GTV"]])

    # ---- by-country daily paying (current-month rows per snapshot -> DATE x COUNTRY) ----
    pay = dfs["paying"]
    payc = pay.loc[
        pay["SNAPSHOT_DATE"].astype("datetime64[ns]").dt.to_period("M")
        == pay["CALENDAR_MONTH"].astype("datetime64[ns]").dt.to_period("M"),
        ["SNAPSHOT_DATE", "COUNTRY", "ACTIVE_PAYING_CUSTOMERS"],
    ]
    payc = (payc.assign(DATE=payc["SNAPSHOT_DATE"].astype(str).str[:10])
                .groupby(["DATE", "COUNTRY"])
                .agg(PAYING=("ACTIVE_PAYING_CUSTOMERS", "sum"))
                .reset_index())
    write(DAILY / f"Paying by country 49 Days_{TS}.csv", payc[["DATE","COUNTRY","PAYING"]])

    # Release the big in-memory frames (esp. the ~26.5M-row receipts grid) BEFORE the generator
    # subprocesses. They read the CSVs from disk, so keeping the frames resident just doubles RAM
    # alongside the subprocess and OOMs the runner ("lost communication with the server").
    import gc
    dfs.clear()
    # Rebind rather than `del`: rec/cur/agg/recc are never bound at all when the receipts
    # pull degraded, and a NameError here would defeat the whole point of degrading.
    rec = cur = agg = recc = pay = payc = None
    gc.collect()

    # ---- per-country rolling series (optional, GUARDED) ----
    # Own connection, after the main loop: a failure here — or the ~12 min runtime — must
    # never put daily-history.js / kpi-data.js at risk. Verified 2026-07-28 against the
    # global series: reg30d 0.00%, active30d +0.25%, payingActive -0.84% (the -0.84% is the
    # known Chargebee-email-without-country gap, same as country_month_mrr_daily_asof.sql).
    try:
        print("[rollingc] " + ROLLING_BY_COUNTRY_SQL, flush=True)
        _cx = connect()
        try:
            _rc = run_sql(_cx, ROLLING_BY_COUNTRY_SQL)
        finally:
            _cx.close()
        write(DAILY / f"Rolling 30 Days by Country_{TS}.csv", _rc)
    except Exception as _e:
        print(f"[rollingc] SKIPPED — {type(_e).__name__}: {_e}", flush=True)

    # ---- regenerate both data files ----
    # daily-history.js ALWAYS rebuilds. It carries the registrations / paying / MRR daily
    # series — the ones the 28 Aug run lost — and backfill_daily.py now treats the
    # receipts-derived CSVs as optional, blanking active/receipts rather than crashing.
    print("[backfill] daily-history.js", flush=True)
    bf_env = {**os.environ, "DAILY_DIR": str(DAILY), "DAILYHIST_OUT": str(V2 / "daily-history.js")}
    subprocess.run([sys.executable, str(KPIRUN / "backfill_daily.py")], check=True, env=bf_env)

    # kpi-data.js hard-requires receipts.csv (build_kpi_data.py reads it unconditionally, and
    # the cohort triangle is meaningless without it). If the receipts pull degraded, keep the
    # previous kpi-data.js — Study & Churn show yesterday's numbers for a day, which is far
    # better than failing the run and losing today's daily page as well.
    if (WORK / "receipts.csv").exists():
        print("[build] kpi-data.js", flush=True)
        env = {**os.environ, "WORK_DIR": str(WORK), "KPIDATA_OUT": str(V2 / "kpi-data.js")}
        subprocess.run([sys.executable, str(HERE / "build_kpi_data.py")], check=True, env=env)
        print("[done] daily-history.js + kpi-data.js regenerated", flush=True)
    else:
        print("[build] SKIPPED kpi-data.js — no receipts.csv this run; "
              "keeping the previously committed file", flush=True)
        print("[done] daily-history.js regenerated", flush=True)

    # ---- paying-base flow charts (flow-data.js + daily-flow.js) ----
    # GUARDED: a failure here (e.g. the heavy grace query spilling/timing out) must NOT
    # fail the run — the two files above are the critical deliverables and are already done.
    try:
        print("[flow] grace query -> flow_grace.csv", flush=True)
        gsql = (SQLDIR / GRACE_SQL).read_text()
        # make the window end today (the checked-in SQL has a fixed D_END for manual use)
        gsql = re.sub(r"DATE\s*'\d{4}-\d{2}-\d{2}'\s*AS\s+D_END", "CURRENT_DATE AS D_END", gsql, count=1)
        gconn = connect()
        try:
            cur = gconn.cursor()
            # Measured ~1 min on the smallest warehouse (full 4.5-yr window, 6 Jul 2026),
            # so this is NOT a tight cap — it's a generous backstop (~10x observed) purely
            # so a pathological hang can't eat into the daily job's 150-min GitHub budget.
            # A normal run finishes long before this; if it ever trips, the flow charts are
            # dropped for the day (guarded) and the critical deploy is unaffected.
            cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 600")
            cur.execute(gsql)
            gdf = cur.fetch_pandas_all() if hasattr(cur, "fetch_pandas_all") else \
                  pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])
            cur.close()
        finally:
            gconn.close()
        grace_csv = WORK / "flow_grace.csv"
        write(grace_csv, gdf)
        print("[flow] build flow-data.js + daily-flow.js", flush=True)
        fenv = {**os.environ, "FLOW_GRACE_CSV": str(grace_csv), "FLOW_OUT_DIR": str(V2)}
        subprocess.run([sys.executable, str(HERE / "build_flow_charts.py")], check=True, env=fenv)
        print("[done] flow-data.js + daily-flow.js regenerated", flush=True)
    except Exception as e:
        print(f"[flow] WARNING — paying-base flow charts skipped this run: {e}", flush=True)

    # ---- pilot tracker (pilot-data.js + pilot-status.md) ----
    # GUARDED, same rationale as the flow charts above: a new query must never
    # be able to break the critical deliverables, which are already written.
    # Cost is trivial — the Chargebee invoice tables hold ~1.5M line items in
    # total, nothing like the receipts grid.
    try:
        print("[pilot] history adoption -> pilot_adoption.csv", flush=True)
        pconn = connect()
        try:
            cur = pconn.cursor()
            cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 600")
            cur.execute((SQLDIR / "pilot_history_adoption_daily.sql").read_text())
            pdf = cur.fetch_pandas_all() if hasattr(cur, "fetch_pandas_all") else \
                  pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])
            cur.close()
        finally:
            pconn.close()
        pilot_csv = WORK / "pilot_adoption.csv"
        write(pilot_csv, pdf)
        print("[pilot] build pilot-data.js", flush=True)
        penv = {**os.environ, "PILOT_CSV": str(pilot_csv),
                "PILOTDATA_OUT": str(V2 / "pilot-data.js")}
        subprocess.run([sys.executable, str(HERE / "build_pilot_data.py")],
                       check=True, env=penv)
        print("[done] pilot-data.js + pilot-status.md regenerated", flush=True)
    except Exception as e:
        print(f"[pilot] WARNING — pilot tracker skipped this run: {e}", flush=True)

    # ---- per-country cohort files (cohort-country/<CC>.json) ----
    # GUARDED, same rationale as the two steps above. Feeds the country filter on the Study &
    # Trend "Cohorts" section. If this is skipped the section still works — the front end falls
    # back to the all-countries data embedded in kpi-data.js and the picker reports no data.
    # Cheaper than its 49-snapshot sibling: a single as-of, and COUNTRY only widens the GROUP BY.
    try:
        # build_cohort_country.py joins against receipts.csv, so there is nothing to build
        # when the receipts pull degraded — skip the Snowflake round-trip rather than pay
        # for a query whose output we would only throw away in the except below.
        if not (WORK / "receipts.csv").exists():
            raise RuntimeError("no receipts.csv this run (receipts pull degraded)")
        print("[cohctry] cohort x country snapshot -> cohort_country.csv", flush=True)
        ccconn = connect()
        try:
            cur = ccconn.cursor()
            cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 600")
            cur.execute((SQLDIR / "cohort_country_snapshot.sql").read_text())
            ccdf = cur.fetch_pandas_all() if hasattr(cur, "fetch_pandas_all") else \
                   pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])
            cur.close()
        finally:
            ccconn.close()
        cc_csv = WORK / "cohort_country.csv"
        write(cc_csv, ccdf)
        print("[cohctry] build cohort-country/*.json", flush=True)
        ccenv = {**os.environ, "COHORT_COUNTRY_CSV": str(cc_csv),
                 "RECEIPTS_CSV": str(WORK / "receipts.csv"),
                 "COHORT_COUNTRY_OUT": str(V2)}
        subprocess.run([sys.executable, str(HERE / "build_cohort_country.py")],
                       check=True, env=ccenv)
        print("[done] cohort-country/*.json regenerated", flush=True)
    except Exception as e:
        print(f"[cohctry] WARNING — per-country cohort files skipped this run: {e}", flush=True)

    # ---- degradation report ----
    # Exit 0 so the workflow still COMMITS what did land — a degraded run publishes real,
    # fresh data for every series that succeeded, and refusing to commit it is precisely
    # how one timed-out query cost the daily graphs a whole day on 28 Aug. The failure is
    # surfaced instead through a step output, which a later workflow step turns into a red
    # run AFTER the commit, so a degraded day is loud without being destructive.
    if degraded:
        names = ", ".join(f"{k} ({QUERY_FILES[k]})" for k in degraded)
        print(f"\n[degraded] This run published without: {names}", flush=True)
        print("[degraded] Everything else is fresh and committed. Re-dispatch kpi-pull to "
              "backfill — the as-of snapshot window spans ~70 days, so a later run fills "
              "the gap retroactively.", flush=True)
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as fh:
            fh.write(f"degraded={','.join(degraded)}\n")


if __name__ == "__main__":
    main()
