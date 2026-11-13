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
import os
import time, sys, subprocess, datetime, pathlib, re, json
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

# Subscription detail for the Study & Trend page: MRR split by feature, and subscription
# gross adds / cancellations. Both are small and fast (~2s each) but kept OUT of
# QUERY_FILES and run in their own guarded step, on the same rule as the flow charts:
# a new query must never be able to break kpi-data.js or daily-history.js. If this step
# is skipped, subs-data.js simply stays at its last committed value and the page degrades
# to the single-bar MRR chart it had before.
MRR_FEATURE_SQL = "mrr_by_feature_monthly.sql"
SUB_FLOW_SQL    = "subscription_flow_monthly.sql"
MERCHANT_FLOW_SQL = "merchant_subscription_flow_monthly.sql"
# Country x month activity: qualified active (1+/5+/10+ receipts) AND GTV in USD.
# UNLIKE the two above this is a full scan
# of LOYVERSE_RECEIPTS_UNIQUE — 9.6B rows, 2.7TB, no clustering key, so nothing prunes and it
# is measured in tens of minutes. It runs LAST inside the guarded step for that reason: if it
# is killed by the job budget, subs-data.js still gets its MRR and flow sections and only the
# Qualified toggle goes missing.
COUNTRY_MONTH_SQL = "country_month_activity.sql"
# Cheap daily receipts count (sub-second: the date floor prunes micro-partitions). Its only
# job is to let the build tell a DEAD FEED from a QUIET MONTH — see receipts_feed_health.sql.
FEED_HEALTH_SQL = "receipts_feed_health.sql"
# Set when the feed-health guard fires. Collected rather than raised on the spot so the rest
# of the run still completes and publishes — the alarm is raised at the very end.
FEED_DOWN: list = []
# Set when build_subs_data.py exits 4: the two active-merchant queries have drifted.
# Collected rather than raised so the rest of the run still completes and publishes.
ACTIVE_DIVERGED: list = []

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

# ---------------------------------------------------------------------------
# SESSION EXPIRY IS NOT A DATA FAILURE (added 2026-10-16 after the 16 Oct outage)
#
# What happened: receipts_tpv_daily_asof.sql died with
#     390112 (08001): Session expired - reauthentication required
# and, being DEGRADABLE, took active merchants, receipts and GTV off the dashboard for the
# day. Nothing was wrong with the data or the query. The run had simply been connected long
# enough that Snowflake's master token expired underneath it.
#
# client_session_keep_alive=True does NOT prevent this. The heartbeat keeps the session from
# going idle; it does not extend the master token, which has a hard lifetime (4h by default).
# This pull holds ONE connection across all seven queries and the receipts grid alone is
# allowed 7200s, so a slow warehouse day can put the total past that ceiling — and then the
# next query to run is the one that dies, whichever it happens to be.
#
# DEGRADING WAS THE WRONG RESPONSE. Degrading exists for a query that genuinely cannot
# complete; an expired token means the connection is stale, not that the data is unavailable.
# The right answer is to throw the connection away and reconnect, which costs about a second.
# Only if the query fails again on a FRESH session is it a real failure worth degrading.
SESSION_DEAD = ("390112", "08001", "session expired", "session is expired",
                "authentication token has expired", "session no longer exists")


def _is_session_dead(exc):
    s = f"{getattr(exc, 'errno', '')} {getattr(exc, 'sqlstate', '')} {exc}".lower()
    return any(m in s for m in SESSION_DEAD)


def run_sql(conn, sql_file, timeout=DEFAULT_TIMEOUT):
    sql = (SQLDIR / sql_file).read_text()
    cur = conn.cursor()
    cur.execute(f"ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = {int(timeout)}")
    cur.execute(sql)
    df = cur.fetch_pandas_all() if hasattr(cur, "fetch_pandas_all") else \
         pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])
    cur.close()
    return df


# The job's own wall-clock budget, so a retry can tell whether it has room to run.
# Mirrors timeout-minutes in kpi-pull.yml; overridden there so the two cannot drift.
RUN_STARTED = time.time()
JOB_BUDGET_MINUTES = float(os.environ.get("JOB_BUDGET_MINUTES", "330"))
# Below this much remaining, a retry is not worth starting: it would be killed mid-flight and
# the run would end with NOTHING committed, which is strictly worse than degrading one series.
RETRY_SAFETY_MARGIN_MINUTES = 12.0


def minutes_left():
    return JOB_BUDGET_MINUTES - (time.time() - RUN_STARTED) / 60.0


class Session:
    """One Snowflake connection that replaces itself when the token expires.

    Deliberately not a retry-everything wrapper. A statement timeout, a permissions error or
    a bad query must still fail on the first attempt and be handled by the degrade logic —
    retrying those just burns warehouse time to reach the same answer. Only a dead SESSION is
    retried, and only once, because the second attempt starts from a brand-new token: if it
    fails again the problem is real.

    THE RETRY IS ALSO BOUNDED BY THE CLOCK, which the first version of this class was not,
    and that omission cost a whole run. Retrying re-runs the query FROM THE START: when the
    receipts grid dies at minute 100 of a two-hour scan, the retry asks for another two
    hours. A normal kpi-pull already takes 202-263 minutes against a 330-minute job cap, so
    one retry can put it over — 2026-10-29 was cancelled at exactly 330 minutes, and
    2026-11-02 ran 234 minutes and was heading the same way. A run killed at the cap commits
    NOTHING; a run that degrades one series commits everything else. Degrading is what the
    DEGRADABLE list is for, so when there is no room, use it.
    """

    def __init__(self):
        self.conn = connect()

    def run(self, sql_file, timeout=DEFAULT_TIMEOUT):
        started = time.time()
        try:
            return run_sql(self.conn, sql_file, timeout)
        except Exception as e:
            if not _is_session_dead(e):
                raise
            # The failed attempt is the best estimate of what the retry will cost: the query
            # is the same and the warehouse is in the same state.
            est = (time.time() - started) / 60.0
            left = minutes_left()
            if est + RETRY_SAFETY_MARGIN_MINUTES > left:
                print(f"[session] token expired during {sql_file} after {est:.0f} min, but only "
                      f"{left:.0f} min of job budget remain. NOT retrying — a retry would be "
                      f"killed at the cap and the run would commit nothing at all. Letting this "
                      f"query degrade so everything else still publishes.", flush=True)
                raise
            print(f"[session] token expired during {sql_file} ({type(e).__name__}: {e}). "
                  f"Reconnecting and retrying once — this is a stale connection, not a data "
                  f"problem, and degrading the series over it would blank the dashboard for "
                  f"no reason. ~{est:.0f} min to redo, {left:.0f} min of budget left.", flush=True)
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = connect()
            return run_sql(self.conn, sql_file, timeout)

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass

def latest(df):
    s = df["SNAPSHOT_DATE"].astype(str).str[:10]
    return df[s == s.max()].copy()

def apply_paying_snapshot(snap, today, count, mrr_unpaid=None):
    """Fold today's paying-customer reading into the snapshot record.

    `mrr_unpaid` rides along on the same daily entry because it has the same problem and
    the same answer: Chargebee stamps a paid date on written-off invoices, so the MRR
    sitting on invoices still being collected cannot be reconstructed for any past month.
    It only becomes a series if it is captured as it happens, under the same
    first-reading-of-the-day rule as the count beside it.

    Pure: takes the record and a reading, returns (new record, log lines). It is separated
    from the I/O around it so the two rules that actually matter can be tested rather than
    reasoned about, because both fail silently and permanently if they are wrong.

    RULE 1 — ONE READING PER DAY, the FIRST one. The pipeline can run more than once in a
    day (retries, manual dispatches), and a later reading would quietly move a figure that
    may already have become a month close.

    RULE 2 — A MONTH CLOSE IS WRITTEN ONCE AND NEVER REWRITTEN. Not by a later run, not by
    a rerun of an earlier day, not by this function under any input. A closed month that
    moves under a reader destroys trust in every month beside it.

    Closing happens on days 1-3 using the EARLIEST reading in that window. Days 1-3 rather
    than the 1st alone because one missed run would otherwise leave a permanent hole — the
    view has no as-of, so a month that is not captured near its boundary cannot be
    recovered later. The cost is that a close may be taken up to two days late; the count
    moves by tens of merchants a day against ~60,000, far inside the precision this figure
    is read to.
    """
    snap = dict(snap or {})
    close = dict(snap.get("monthClose") or {})
    daily = dict(snap.get("daily") or {})
    log = []

    if today in daily:
        log.append(f"{today} already snapshotted ({daily[today]['value']:,}) — "
                   f"today's reading of {count:,} not stored")
    else:
        entry = {"value": int(count), "source": "snapshot"}
        if mrr_unpaid is not None:
            entry["mrrUnpaid"] = round(float(mrr_unpaid), 2)
        daily[today] = entry
        log.append(f"snapshot {today}: {int(count):,} paying customers"
                   + (f", ${float(mrr_unpaid):,.0f} MRR on unpaid invoices"
                      if mrr_unpaid is not None else ""))

    d = datetime.date.fromisoformat(today)
    if d.day <= 3:
        prev = (d.replace(day=1) - datetime.timedelta(days=1)).strftime("%Y-%m")
        if prev in close:
            log.append(f"{prev} already closed at {close[prev]['value']:,} — left alone")
        else:
            window = sorted(k for k in daily
                            if k[:7] == d.strftime("%Y-%m") and int(k[8:10]) <= 3)
            if window:
                first = window[0]
                close[prev] = {"value": daily[first]["value"], "source": "snapshot",
                               "takenOn": first}
                log.append(f"closed {prev} at {close[prev]['value']:,} (from {first})")

    snap["monthClose"] = dict(sorted(close.items()))
    snap["daily"] = dict(sorted(daily.items()))
    return snap, log


def write(path, df):
    path.write_text(df.to_csv(index=False)); print(f"   -> {path.name} ({len(df)} rows)", flush=True)

def main():
    conn = Session(); dfs = {}; degraded = []

    # Each query is isolated AND its CSVs are written the moment it returns, so a failure
    # late in the loop can never discard work that already succeeded (the 28 Aug failure
    # mode). A DEGRADABLE query that fails is logged and skipped; anything else still
    # aborts the run, because without it the dashboard would show wrong numbers, not blanks.
    def pull(key):
        f = QUERY_FILES[key]
        print(f"[run] {f}", flush=True)
        try:
            dfs[key] = conn.run(f, QUERY_TIMEOUTS.get(key, DEFAULT_TIMEOUT))
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
        # The Snowflake connector returns NUMBER columns as decimal.Decimal, so a groupby
        # .sum() over them stays object-dtype Decimal (not float64) even though the source
        # values are plain counts/amounts. Python's Decimal does not support mixed
        # arithmetic with float (TypeError: unsupported operand type(s) for /: 'float' and
        # 'decimal.Decimal'), which broke AVG_TICKET below once one side of the divide
        # picked up Decimal and the other stayed float. Normalize both sides to float here.
        agg["ACTIVE"] = pd.to_numeric(agg["ACTIVE"], errors="coerce").astype(float)
        agg["RECEIPTS"] = pd.to_numeric(agg["RECEIPTS"], errors="coerce").astype(float)
        agg["GTV"] = pd.to_numeric(agg["GTV"], errors="coerce").astype(float)
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
        # Same Decimal-from-Snowflake normalization as the global "49 days 1" block above.
        for col in ("ACTIVE", "RECEIPTS", "GTV"):
            recc[col] = pd.to_numeric(recc[col], errors="coerce").astype(float)
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

    # ---- live MRR (mrr_live.csv) ----
    # The headline MRR from 2026-11-09: the monthly value of subscriptions LIVE at each
    # month end, same merchant base as the paying count, so ARPC divides two figures that
    # describe one population. GUARDED — build_kpi_data.py falls back to the bottom-up
    # number and says so if this file is missing, rather than the run failing.
    _mrr_live = None
    try:
        _ml_conn = connect()
        try:
            _ml_cur = _ml_conn.cursor()
            _ml_cur.execute((SQLDIR / "mrr_live_monthly.sql").read_text().rstrip().rstrip(";"))
            _ml_df = _ml_cur.fetch_pandas_all() if hasattr(_ml_cur, "fetch_pandas_all") else \
                     pd.DataFrame(_ml_cur.fetchall(), columns=[c[0] for c in _ml_cur.description])
            _ml_cur.close()
        finally:
            _ml_conn.close()
        write(WORK / "mrr_live.csv", _ml_df)
        _mrr_live = _ml_df
        print(f"[mrrlive] {len(_ml_df)} months, latest "
              f"{_ml_df['MONTH'].iloc[-1]} ${float(_ml_df['MRR'].iloc[-1]):,.0f}", flush=True)
    except Exception as _e:
        print(f"[mrrlive] SKIPPED — {type(_e).__name__}: {_e}", flush=True)

    # ---- MRR bridge (mrr_bridge.csv) ----
    # Decomposes the month-over-month change in the SAME live MRR above into new,
    # reactivation, expansion, contraction and churn. GUARDED like its sibling: without the
    # file the Churn tab hides the chart rather than drawing a bridge from a stale CSV.
    #
    # The identity is checked HERE, not only on the page, because a bridge that does not
    # close is not a presentation problem — it means the classification dropped or
    # double-counted revenue, and the number it would publish is wrong.
    try:
        _mb_conn = connect()
        try:
            _mb_cur = _mb_conn.cursor()
            _mb_cur.execute((SQLDIR / "mrr_bridge_monthly.sql").read_text().rstrip().rstrip(";"))
            _mb_df = _mb_cur.fetch_pandas_all() if hasattr(_mb_cur, "fetch_pandas_all") else \
                     pd.DataFrame(_mb_cur.fetchall(), columns=[c[0] for c in _mb_cur.description])
            _mb_cur.close()
        finally:
            _mb_conn.close()
        _net = (_mb_df["NEW_MRR"] + _mb_df["REACTIVATION_MRR"] + _mb_df["EXPANSION_MRR"]
                - _mb_df["CONTRACTION_MRR"] - _mb_df["CHURN_MRR"])
        _gap = (_mb_df["OPENING_MRR"] + _net - _mb_df["CLOSING_MRR"]).abs()
        _broken = int((_gap > 0.05).sum())
        if _broken:
            raise RuntimeError(f"bridge does not close in {_broken} month(s), worst ${_gap.max():,.2f} "
                               "— not published")
        write(WORK / "mrr_bridge.csv", _mb_df)
        print(f"[mrrbridge] {len(_mb_df)} months, identity holds everywhere "
              f"(worst ${_gap.max():,.2f}), latest {_mb_df['MONTH'].iloc[-1]} "
              f"net ${float(_net.iloc[-1]):,.0f}", flush=True)
    except Exception as _e:
        print(f"[mrrbridge] SKIPPED — {type(_e).__name__}: {_e}", flush=True)

    # ---- paying-customer snapshot (paying-snapshots.json) ----
    # Must run BEFORE build_kpi_data.py, which reads this file for the headline count.
    #
    # WHY A SNAPSHOT FILE AND NOT A QUERY. CHARGEBEE_SUBSCRIPTIONS_V carries CURRENT status
    # only — ask it in December what March looked like and it answers about December. The
    # count therefore has to be CAPTURED as time passes. Everything before 2026-11 was
    # reconstructed once (paying_customers_backfill.sql) and frozen; from here the number
    # accumulates one reading at a time. The at-risk MRR captured alongside it has exactly
    # the same problem — see apply_paying_snapshot.
    #
    # A MONTH CLOSE IS WRITTEN ONCE AND NEVER REWRITTEN. That is the whole contract of this
    # file. A closed month that moves under a reader is worse than one that is slightly off,
    # because nothing they wrote down last week can be trusted again.
    #
    # GUARDED. This is a new, additive number on a pipeline whose critical deliverables are
    # daily-history.js and kpi-data.js. It must not be able to take them down, so every
    # failure here degrades to "no snapshot today" and the build carries on with the
    # previously committed file.
    try:
        _snap_path = V2 / "paying-snapshots.json"
        _snap = json.loads(_snap_path.read_text(encoding="utf-8")) if _snap_path.exists() else {}

        _pc_conn = connect()
        try:
            _cur = _pc_conn.cursor()
            _cur.execute((SQLDIR / "paying_customers_active_subs.sql").read_text().rstrip().rstrip(";"))
            _row = _cur.fetchone()
            _cur.close()
        finally:
            _pc_conn.close()

        # The in-progress row of mrr_live is the LAST one — yesterday, labelled with the
        # current month. Captured here rather than left in the CSV because the CSV is
        # rewritten whole every run and would carry no history of it.
        _unpaid = None
        if _mrr_live is not None and len(_mrr_live):
            try:
                _unpaid = float(_mrr_live["MRR_ON_UNPAID_INVOICES"].iloc[-1])
            except Exception:
                _unpaid = None

        _snap, _log = apply_paying_snapshot(_snap, str(_row[0])[:10], int(_row[1]), _unpaid)
        for _line in _log:
            print(f"[paying] {_line}", flush=True)
        _snap_path.write_text(json.dumps(_snap, indent=1) + "\n", encoding="utf-8")
    except Exception as _e:
        print(f"[paying] SKIPPED — {type(_e).__name__}: {_e}", flush=True)

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

    # ---- subscription detail (subs-data.js) ----
    # GUARDED, same rationale as the flow charts. Two cheap queries against the Chargebee
    # invoice and subscription tables; the build step reconciles the feature split against
    # mrr_bottomup.csv and refuses to write a file whose parts do not sum to the whole.
    try:
        sconn = connect()
        try:
            def _run(fname):
                cur = sconn.cursor()
                cur.execute((SQLDIR / fname).read_text().rstrip().rstrip(";"))
                df = cur.fetch_pandas_all() if hasattr(cur, "fetch_pandas_all") else \
                     pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])
                cur.close()
                return df
            print("[subs] mrr_by_feature + subscription_flow", flush=True)
            feat_csv = WORK / "mrr_by_feature.csv"
            flow_csv = WORK / "subscription_flow.csv"
            write(feat_csv, _run(MRR_FEATURE_SQL))
            write(flow_csv, _run(SUB_FLOW_SQL))
            mflow_csv = WORK / "merchant_subscription_flow.csv"
            write(mflow_csv, _run(MERCHANT_FLOW_SQL))
            # Feed health FIRST, and outside the try that guards the big scan. It costs
            # nothing and it must be available even when the expensive query fails — those
            # are exactly the runs where the data is most likely to be wrong.
            health_csv = WORK / "receipts_feed_health.csv"
            try:
                print("[subs] receipts_feed_health (freshness probe)", flush=True)
                write(health_csv, _run(FEED_HEALTH_SQL))
            except Exception as e:
                print(f"[subs] WARNING — feed health probe failed: {e}", flush=True)

            cmonth_csv = WORK / "country_month_activity.csv"
            try:
                cur = sconn.cursor()
                cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 4200")
                cur.close()
                print("[subs] country_month_activity (full receipts scan, ~13 min)", flush=True)
                write(cmonth_csv, _run(COUNTRY_MONTH_SQL))
            except Exception as e:
                print(f"[subs] WARNING — country/month activity skipped: {e}", flush=True)
        finally:
            sconn.close()
        senv = {**os.environ,
                "MRR_FEATURE_CSV": str(feat_csv),
                "SUB_FLOW_CSV": str(flow_csv),
                "MERCHANT_FLOW_CSV": str(mflow_csv),
                "COUNTRY_MONTH_CSV": str(cmonth_csv),
                "FEED_HEALTH_CSV": str(health_csv),
                # WHICH QUERIES DID NOT LAND THIS BUILD. Until 2026-10-16 this only reached
                # GITHUB_OUTPUT, which turns the Actions run red and tells nobody else. On
                # 16 Oct the receipts pull died of an expired session, active merchants and
                # receipts went blank on the dashboard, the feed-health banner stayed silent
                # because the LAKE was perfectly healthy, and the first anyone knew was
                # Felipe noticing empty charts. A blank series has to say why it is blank,
                # on the page, not in a log nobody reads.
                "DEGRADED_QUERIES": ",".join(degraded),
                "KPI_DATA_JS": str(V2 / "kpi-data.js"),
                "MRR_TOTAL_CSV": str(WORK / "mrr_bottomup.csv"),
                "SUBS_OUT_DIR": str(V2)}
        # Exit code 3 is reserved by build_subs_data.py for "the receipts feed is down".
        # It is NOT a build failure — the file was written correctly — so it must not be
        # swallowed by the warning below, which exists to stop a new query breaking the
        # critical deliverables. A dead upstream feed is the one thing here that has to
        # reach a human, so it is re-raised and fails the run.
        rc = subprocess.run([sys.executable, str(HERE / "build_subs_data.py")], env=senv).returncode
        if rc == 3:
            FEED_DOWN.append(True)
            print("[subs] subs-data.js regenerated WITH the incomplete months withheld, "
                  "but THE RECEIPTS FEED IS DOWN", flush=True)
        elif rc == 4:
            # Exit 4: the active-merchant cross-check diverged. Like exit 3, the FILE WAS
            # WRITTEN correctly — this is an alarm about the data, not a build failure, so
            # it must not be swallowed by the warning handler below (which would leave the
            # run green) nor raised as an exception (which would discard nothing but would
            # read as the build breaking). It goes to a workflow output and turns the run
            # red, the same way feed_down does.
            ACTIVE_DIVERGED.append(True)
            print("[subs] subs-data.js regenerated and FLAGGED — qualified-active and the "
                  "published active series disagree; see the divergence above", flush=True)
        elif rc != 0:
            raise RuntimeError(f"build_subs_data.py exited {rc}")
        else:
            print("[done] subs-data.js regenerated", flush=True)
    except Exception as e:
        print(f"[subs] WARNING — subscription detail skipped this run: {e}", flush=True)

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
    # A dead receipts feed is reported the SAME WAY a degraded query is, and for the same
    # reason: commit first, go red afterwards. Exiting non-zero here would abort before the
    # commit and leave the OLD, broken subs-data.js live — the exact failure this guard
    # exists to prevent. The corrected file must ship; the alarm comes after.
    if FEED_DOWN:
        print("\n[feed] RECEIPTS FEED IS DOWN — receipts, active merchants, qualified-active "
              "and GTV were withheld for months the feed does not cover. The dashboard will "
              "show the series ending at the last complete month instead of falling to zero. "
              "This is an upstream data-lake problem: check the receipts ingestion job.",
              flush=True)

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as fh:
            fh.write(f"degraded={','.join(degraded)}\n")
            fh.write(f"feed_down={'true' if FEED_DOWN else ''}\n")
            fh.write(f"active_diverged={'true' if ACTIVE_DIVERGED else ''}\n")


if __name__ == "__main__":
    main()
