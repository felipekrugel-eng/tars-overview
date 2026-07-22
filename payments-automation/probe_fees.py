#!/usr/bin/env python3
"""
One-off, READ-ONLY diagnostic: does the Stripe Data Pipeline share expose a
balance-transactions table (where Stripe's platform-cost fees — per-auth,
volume, tap-to-pay, payout, terminal, radar — are recorded), and what are its
columns? Prints results to the log only. Writes NOTHING, touches no CSV, no
workbook. Safe to run any number of times.

Trigger via the payments-fees-probe workflow (workflow_dispatch). Once the log
confirms the table + column names, query3_platform_fees.sql is written against
them and this probe can be deleted.

Auth + connection identical to pull_payments.py (SNOWFLAKE_PRIVATE_KEY only).
"""
import os
import snowflake.connector
from cryptography.hazmat.primitives import serialization

SHARE = "GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659"
STRIPE_SCHEMA = f"{SHARE}.STRIPE"


def _private_key():
    pem = os.environ["SNOWFLAKE_PRIVATE_KEY"].encode()
    pw = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE") or None
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


def show(cur, sql, label):
    print(f"\n===== {label} =====\n{sql}")
    try:
        cur.execute(sql)
        cols = [c[0] for c in cur.description]
        rows = cur.fetchall()
        print(f"  ({len(rows)} rows)  cols={cols}")
        for r in rows[:60]:
            print("   ", tuple("" if v is None else v for v in r))
        if len(rows) > 60:
            print(f"    ... {len(rows) - 60} more")
        return rows
    except Exception as e:
        print(f"  !! error: {e}")
        return []


def main():
    conn = connect()
    try:
        cur = conn.cursor()
        try:
            # 1) Every table in the STRIPE schema — find balance / fee / payout tables.
            show(cur, f"SHOW TABLES IN SCHEMA {STRIPE_SCHEMA}", "all tables in STRIPE schema")

            # 2) Likely candidates: describe columns so we know exact names/types.
            for tbl in ("BALANCE_TRANSACTIONS", "BALANCE_TRANSACTION", "FEES", "PAYOUTS",
                        "TERMINAL_FEES", "STRIPE_FEES"):
                fq = f"{STRIPE_SCHEMA}.{tbl}"
                show(cur, f"SHOW COLUMNS IN TABLE {fq}", f"columns of {tbl}")

            # 3) If BALANCE_TRANSACTIONS exists, sample the fee/payout rows so we can
            #    see the real TYPE / REPORTING_CATEGORY / DESCRIPTION values to bucket on.
            bt = f"{STRIPE_SCHEMA}.BALANCE_TRANSACTIONS"
            show(cur,
                 f"SELECT * FROM {bt} "
                 f"WHERE TYPE IN ('stripe_fee','payout') "
                 f"ORDER BY CREATED DESC LIMIT 40",
                 "sample fee/payout balance transactions")
            show(cur,
                 f"SELECT TYPE, REPORTING_CATEGORY, COUNT(*) N, SUM(AMOUNT) SUM_AMT, "
                 f"MIN(CREATED) MINC, MAX(CREATED) MAXC "
                 f"FROM {bt} GROUP BY 1,2 ORDER BY 1,2",
                 "balance-transaction type x reporting_category rollup")
        finally:
            cur.close()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
