#!/usr/bin/env python3
"""
FACADASH-pattern Snowflake pull for the Embedded Payments true-cost workbook.

Runs the two canonical queries (queries/query1_transactions.sql + query2_icplus_costs.sql)
against the Stripe Data Pipeline share in Snowflake and writes:
  data/transactions.csv   (one row per charge)
  data/icplus_costs.csv   (one row per IC+ fee line, TOTAL_AMOUNT in CENTS)
with headers that exactly match what refresh_workbook.py expects.

Auth: Snowflake key-pair from env — identical convention to kpi-automation
(build_cusum_data.py). The ONLY secret is SNOWFLAKE_PRIVATE_KEY (already configured
in the repo from the CASE pull). Everything else is plain config passed by the workflow.

Sanity gate: refuses to overwrite the CSVs if either result is suspiciously small
(<100 rows) — protects the dashboard from a bad/empty pull (e.g. a missing grant).

OPEN ITEM: role DATA_VIEWER must hold SELECT / IMPORTED PRIVILEGES on the Stripe share
GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659. Until that grant lands this pull
raises on the sanity gate and the workflow leaves the last-good committed CSVs in place.
"""
import os, csv, sys, pathlib
import snowflake.connector
from cryptography.hazmat.primitives import serialization

HERE    = pathlib.Path(__file__).resolve().parent
SQL_DIR = pathlib.Path(os.environ.get("SQL_DIR", HERE / "queries"))
DATA_DIR = pathlib.Path(os.environ.get("DATA_DIR", HERE / "data"))
MIN_ROWS = int(os.environ.get("MIN_ROWS", "100"))

Q1 = "query1_transactions.sql"
Q2 = "query2_icplus_costs.sql"
OUT1 = "transactions.csv"
OUT2 = "icplus_costs.csv"


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


def run_query(cur, sql_file):
    sql = (SQL_DIR / sql_file).read_text()
    # SQL files may contain a trailing semicolon / comments — execute as a single statement.
    cur.execute(sql)
    cols = [c[0] for c in cur.description]
    rows = cur.fetchall()
    return cols, rows


def write_csv(path, cols, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow(["" if v is None else v for v in r])
    tmp.replace(path)


def main():
    print(f"SQL_DIR  = {SQL_DIR}")
    print(f"DATA_DIR = {DATA_DIR}")
    conn = connect()
    try:
        cur = conn.cursor()
        try:
            print(f"Running {Q1} ...")
            c1, r1 = run_query(cur, Q1)
            print(f"  transactions rows = {len(r1):,}  cols = {c1}")
            print(f"Running {Q2} ...")
            c2, r2 = run_query(cur, Q2)
            print(f"  icplus rows       = {len(r2):,}  cols = {c2}")
        finally:
            cur.close()
    finally:
        conn.close()

    # Sanity gate BEFORE writing — never clobber good CSVs with a bad pull.
    if len(r1) < MIN_ROWS or len(r2) < MIN_ROWS:
        print(f"SANITY GATE: transactions={len(r1)} icplus={len(r2)} "
              f"(min {MIN_ROWS}). Refusing to overwrite CSVs.", file=sys.stderr)
        print("Likely cause: DATA_VIEWER lacks the Stripe-share grant. "
              "Leaving the last-good committed CSVs untouched.", file=sys.stderr)
        sys.exit(2)

    write_csv(DATA_DIR / OUT1, c1, r1)
    write_csv(DATA_DIR / OUT2, c2, r2)
    print(f"Wrote {DATA_DIR / OUT1} ({len(r1):,} rows) and "
          f"{DATA_DIR / OUT2} ({len(r2):,} rows).")


if __name__ == "__main__":
    main()
