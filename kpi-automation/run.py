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
import os, sys, subprocess, datetime, pathlib
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
}

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

def run_sql(conn, sql_file):
    sql = (SQLDIR / sql_file).read_text()
    cur = conn.cursor()
    cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 3600")
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
    conn = connect(); dfs = {}
    try:
        for key, f in QUERY_FILES.items():
            print(f"[run] {f}", flush=True); dfs[key] = run_sql(conn, f)
    finally:
        conn.close()

    # ---- inputs for build_kpi_data.py (tidy full as-of outputs) ----
    write(WORK / "cohort_grid.csv",      dfs["cohort"])
    write(WORK / "receipts.csv",         dfs["receipts"])
    write(WORK / "paying_country.csv",   dfs["paying"])
    write(WORK / "country_lifetime.csv", dfs["clife"])
    write(WORK / "country_reg_month.csv",dfs["cregm"])

    # ---- inputs for backfill_daily.py (CSV filenames it globs) ----
    write(DAILY / f"MRR QR_DB 49 Days_{TS}.csv",                 dfs["cohort"])
    write(DAILY / f"Registration Month x Country_49 Days_{TS}.csv", dfs["cregm"])
    write(DAILY / f"Rolling 30 Days_{TS}.csv",                   dfs["rolling"])
    # latest-snapshot "normal daily" files
    lc = latest(dfs["cohort"]);  write(DAILY / f"MRR QR_DB_{TS}.csv", lc)
    lp = latest(dfs["paying"])[["COUNTRY","CALENDAR_MONTH","ACTIVE_PAYING_CUSTOMERS"]]
    write(DAILY / f"Paying x Country per Month_{TS}.csv", lp)
    lr = latest(dfs["cregm"])[["COUNTRY","CALENDAR_MONTH","REGISTRATIONS"]]
    write(DAILY / f"Registrations Month x Country_{TS}.csv", lr)
    lt = latest(dfs["receipts"])
    write(DAILY / f"TPV and Receipts DB2_{TS}.csv", lt[["COUNTRY","CALENDAR_MONTH","ACTIVE_MERCHANTS","RECEIPT_COUNT"]])
    # global daily active/receipts ("49 days 1"): each merchant in one country → current-month sum = global distinct
    g = dfs["receipts"].copy()
    g["S"] = g["SNAPSHOT_DATE"].astype(str).str[:10]; g["M"] = g["CALENDAR_MONTH"].astype(str).str[:7]
    g = g[g["M"] == g["S"].str[:7]]
    agg = g.groupby("S").agg(ACTIVE=("ACTIVE_MERCHANTS","sum"), RECEIPTS=("RECEIPT_COUNT","sum")).reset_index()
    agg = agg.rename(columns={"S":"DATE"}); agg["GTV"] = 0; agg["AVG_TICKET"] = 0
    write(DAILY / f"49 days 1_{TS}.csv", agg[["DATE","ACTIVE","RECEIPTS","GTV","AVG_TICKET"]])

    # ---- regenerate both data files ----
    print("[backfill] daily-history.js", flush=True)
    subprocess.run([sys.executable, str(KPIRUN / "backfill_daily.py")], check=True)
    print("[build] kpi-data.js", flush=True)
    env = {**os.environ, "WORK_DIR": str(WORK), "KPIDATA_OUT": str(V2 / "kpi-data.js")}
    subprocess.run([sys.executable, str(HERE / "build_kpi_data.py")], check=True, env=env)
    print("[done] daily-history.js + kpi-data.js regenerated", flush=True)

if __name__ == "__main__":
    main()
