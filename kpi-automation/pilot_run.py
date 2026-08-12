#!/usr/bin/env python3
"""
pilot_run.py — pilot tracker refresh, on its own.

WHY THIS EXISTS
The pilot query already runs as the last guarded step of run.py, inside the
`kpi-pull` workflow. But kpi-pull takes 90-330 minutes because of the cohort and
receipts grids, so refreshing the pilot page meant either waiting for 04:00 UTC or
sitting through a multi-hour run for a query that takes well under a minute.

This script runs ONLY the pilot query and rebuilds ONLY pilot-data.js +
pilot-status.md. Nothing else in the repo is read or written, so it can be fired
whenever you want an answer without touching the critical daily deliverables.

run.py keeps its own copy of this step. That duplication is deliberate: the daily
refresh should not depend on this file existing, and this file should not depend on
the daily refresh succeeding.

Auth: Snowflake key-pair, all values from environment (GitHub Actions secrets),
identical to run.py.
Required env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY (PEM),
  SNOWFLAKE_PRIVATE_KEY_PASSPHRASE (optional), SNOWFLAKE_WAREHOUSE, SNOWFLAKE_ROLE,
  SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA
Optional env: SQL_DIR, V2_DIR, WORK_DIR
"""
import os, sys, subprocess, pathlib
import pandas as pd
import snowflake.connector
from cryptography.hazmat.primitives import serialization

HERE   = pathlib.Path(__file__).resolve().parent
REPO   = pathlib.Path(os.environ.get("REPO_DIR", HERE.parent))
SQLDIR = pathlib.Path(os.environ.get("SQL_DIR", HERE / "sql"))
V2     = pathlib.Path(os.environ.get("V2_DIR", REPO / "KPI Dashboard v2 (Caio)"))
WORK   = pathlib.Path(os.environ.get("WORK_DIR", HERE / "_work"))
WORK.mkdir(parents=True, exist_ok=True)

SQL_FILE = "pilot_history_adoption_daily.sql"
# Second, optional input: the price catalogue. Guarded separately below — if it fails,
# the page still builds and simply says the catalogue was not checked this run.
CAT_SQL_FILE = "pilot_price_catalogue.sql"


def _private_key():
    pem = os.environ["SNOWFLAKE_PRIVATE_KEY"].encode()
    pw  = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE") or None
    key = serialization.load_pem_private_key(pem, password=pw.encode() if pw else None)
    return key.private_bytes(serialization.Encoding.DER,
                             serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def connect():
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
        private_key=_private_key(),
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
        role=os.environ.get("SNOWFLAKE_ROLE", "DATA_VIEWER"),
        database=os.environ.get("SNOWFLAKE_DATABASE", "LOYVERSE_DATA_LAKE"),
        schema=os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC"),
        client_session_keep_alive=True)


def main():
    print(f"[pilot] {SQL_FILE} -> pilot_adoption.csv", flush=True)
    conn = connect()
    try:
        cur = conn.cursor()
        # Generous but finite: the Chargebee invoice tables hold ~1.5M line items
        # in total, so a run over 10 minutes means something is wrong, not slow.
        cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 600")
        cur.execute((SQLDIR / SQL_FILE).read_text())
        df = cur.fetch_pandas_all() if hasattr(cur, "fetch_pandas_all") else \
             pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])
        cur.close()
    finally:
        conn.close()

    if df.empty:
        # Better to fail loudly than to overwrite a good pilot-data.js with nothing.
        sys.exit("[pilot] FAILED — query returned zero rows; not rebuilding pilot-data.js")

    csv = WORK / "pilot_adoption.csv"
    csv.write_text(df.to_csv(index=False))
    print(f"   -> {csv.name} ({len(df)} rows)", flush=True)

    # ---- price catalogue: which tiers exist, and is the pilot attached to them ----
    # Guarded: the invoice query is what the page cannot do without. A catalogue failure
    # should cost the price panel, not the whole page.
    cat_csv = None
    try:
        print(f"[pilot] {CAT_SQL_FILE} -> pilot_catalogue.csv", flush=True)
        conn2 = connect()
        try:
            cur2 = conn2.cursor()
            cur2.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 300")
            cur2.execute((SQLDIR / CAT_SQL_FILE).read_text())
            cdf = cur2.fetch_pandas_all() if hasattr(cur2, "fetch_pandas_all") else \
                  pd.DataFrame(cur2.fetchall(), columns=[c[0] for c in cur2.description])
            cur2.close()
        finally:
            conn2.close()
        if not cdf.empty:
            cat_csv = WORK / "pilot_catalogue.csv"
            cat_csv.write_text(cdf.to_csv(index=False))
            print(f"   -> {cat_csv.name} ({len(cdf)} rows)", flush=True)
        else:
            print("[pilot] WARNING — catalogue query returned no rows", flush=True)
    except Exception as e:
        print(f"[pilot] WARNING — price catalogue skipped: {e}", flush=True)

    print("[pilot] build pilot-data.js + pilot-status.md", flush=True)
    env = {**os.environ,
           "PILOT_CSV": str(csv),
           "PILOTDATA_OUT": str(V2 / "pilot-data.js")}
    if cat_csv:
        env["PILOT_CATALOGUE_CSV"] = str(cat_csv)
    subprocess.run([sys.executable, str(HERE / "build_pilot_data.py")],
                   check=True, env=env)
    print("[done] pilot tracker refreshed", flush=True)


if __name__ == "__main__":
    main()
