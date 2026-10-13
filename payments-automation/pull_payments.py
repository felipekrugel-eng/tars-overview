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
import os, csv, sys, pathlib, json, datetime, hashlib
import snowflake.connector
from cryptography.hazmat.primitives import serialization

HERE    = pathlib.Path(__file__).resolve().parent
SQL_DIR = pathlib.Path(os.environ.get("SQL_DIR", HERE / "queries"))
DATA_DIR = pathlib.Path(os.environ.get("DATA_DIR", HERE / "data"))
MIN_ROWS = int(os.environ.get("MIN_ROWS", "100"))

Q1 = "query1_transactions.sql"
Q2 = "query2_icplus_costs.sql"
Q3 = "query3_platform_fees.sql"
OUT1 = "transactions.csv"
OUT2 = "icplus_costs.csv"
OUT3 = "platform_fees.csv"

# Stable header for platform_fees.csv so refresh_workbook can rely on it even when the
# fee query is skipped/errors (it then just sees zero rows -> every Stripe-fee bucket 0).
PF_HEADER = ["FEE_CATEGORY", "CURRENCY", "N", "TOTAL_AMOUNT_MINOR"]


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


# ── THE SNAPSHOT INSTANT ──────────────────────────────────────────────────────────────
# ONE timestamp, chosen once, substituted into every query in this pull.
#
# WHY THIS EXISTS. The Summary of Margins and the Payment Profile used to be built from two
# separate Snowflake pulls on two separate crons. They ran fifteen minutes apart and each
# could skip a cycle on its own, so the two pages described the same book at two different
# moments and their numbers simply never matched - 18 charges apart on the day this was
# written, and unboundedly more after a skipped run. No alignment of definitions can fix a
# difference of vintage.
#
# A single pull is not automatically a single instant either: three queries issued seconds
# apart each see whatever had landed by the time it ran. So the cut-off is fixed BEFORE the
# first query and every query is cut on it. Everything downstream - the workbook, the
# margins page, the profile page - is then a view of one well-defined moment.
#
# The cut-off is deliberately in the PAST (SNAPSHOT_LAG_MINUTES). Stripe's feeds land with a
# short delay, so cutting at "now" means slicing through a partially-arrived minute: the
# charges are there but their fee rows are not yet, which reads as free volume and understates
# cost. Lagging the cut-off trades a few minutes of freshness for a complete picture.
SNAPSHOT_LAG_MINUTES = int(os.environ.get("SNAPSHOT_LAG_MINUTES", "15"))


def snapshot_as_of():
    """The one instant this pull describes, as a Snowflake-comparable UTC string."""
    now = datetime.datetime.now(datetime.timezone.utc)
    cut = now - datetime.timedelta(minutes=SNAPSHOT_LAG_MINUTES)
    return cut.strftime("%Y-%m-%d %H:%M:%S")


def run_query(cur, sql_file, as_of):
    sql = (SQL_DIR / sql_file).read_text()
    if "/*AS_OF*/" not in sql:
        # Refuse rather than silently pull an uncut query: a query without the cut-off
        # returns a different instant from its siblings, which is the exact bug this
        # whole mechanism exists to prevent.
        raise RuntimeError(f"{sql_file} has no /*AS_OF*/ placeholder — it would not be "
                           f"cut to the snapshot instant and must not run in this pull")
    sql = sql.replace("/*AS_OF*/", as_of)
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


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_pull_status(cols, rows, transaction_count, icplus_count, platform_fee_count,
                      as_of=None):
    """Write small authoritative evidence for freshness monitors.

    This file changes after every genuinely successful Snowflake pull. Fallback
    rebuilds never touch it, so a green workbook build cannot masquerade as a
    fresh extraction.
    """
    latest_created = None
    if "CREATED_AT" in cols:
        i = cols.index("CREATED_AT")
        values = [row[i] for row in rows if row[i] is not None]
        if values:
            latest = max(values)
            latest_created = latest.isoformat() if hasattr(latest, "isoformat") else str(latest)
            if getattr(latest, "tzinfo", None) is None:
                latest_created += "Z"

    files = [DATA_DIR / OUT1, DATA_DIR / OUT2, DATA_DIR / OUT3]
    status = {
        "schema_version": 2,
        "source": "snowflake_stripe_share",
        "pull_succeeded": True,
        # THE SHARED VINTAGE. Every page built from this snapshot shows this timestamp, so
        # "do these two numbers come from the same moment?" is answerable by looking rather
        # than by trusting. activated-payments/pull.js reads it from here too.
        "snapshot_as_of_utc": as_of,
        "completed_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "latest_charge_created_at_utc": latest_created,
        "rows": {
            "transactions": transaction_count,
            "icplus_costs": icplus_count,
            "platform_fees": platform_fee_count,
        },
        "sha256": {p.name: sha256_file(p) for p in files},
    }
    path = DATA_DIR / "pull_status.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(status, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)
    print(f"Wrote {path} freshness evidence at {status['completed_at_utc']}.")


def main():
    print(f"SQL_DIR  = {SQL_DIR}")
    print(f"DATA_DIR = {DATA_DIR}")
    as_of = snapshot_as_of()
    print(f"SNAPSHOT AS OF = {as_of} UTC (lag {SNAPSHOT_LAG_MINUTES} min) — every query in "
          f"this pull is cut at this one instant, and both dashboard pages are built from it.")
    conn = connect()
    try:
        cur = conn.cursor()
        try:
            cur.execute("ALTER SESSION SET USE_CACHED_RESULT = FALSE")
            print("Snowflake result cache disabled for freshness-critical pull.")
            print(f"Running {Q1} ...")
            c1, r1 = run_query(cur, Q1, as_of)
            print(f"  transactions rows = {len(r1):,}  cols = {c1}")
            print(f"Running {Q2} ...")
            c2, r2 = run_query(cur, Q2, as_of)
            print(f"  icplus rows       = {len(r2):,}  cols = {c2}")

            # Query 3 — Stripe platform fees from balance-transaction actuals.
            # NON-FATAL: if the table/grant is missing or the query errors, keep going
            # with an empty result so the (existing) transactions + icplus pull still
            # succeeds and refresh falls back to zero for every Stripe-fee bucket.
            print(f"Running {Q3} ...")
            try:
                c3, r3 = run_query(cur, Q3, as_of)
                print(f"  platform-fee rows = {len(r3):,}  cols = {c3}")
                print("  --- Stripe platform-fee buckets (minor units, negative = cost) ---")
                for row in r3:
                    cat, curr, n, amt = row
                    major = (float(amt) / 100.0) if amt is not None else 0.0
                    print(f"    {str(cat):14s} {str(curr):4s} n={int(n):5d}  "
                          f"total={amt}  ({major:,.2f} {str(curr).upper()})")
                tot_minor = sum(int(x[3]) for x in r3 if x[3] is not None)
                print(f"  --- platform-fee grand total = {tot_minor} minor "
                      f"({tot_minor / 100.0:,.2f} in stated currency) ---")
            except Exception as e:
                c3, r3 = PF_HEADER, []
                print(f"  !! platform-fee query skipped (non-fatal): {e}", file=sys.stderr)
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
    # platform_fees.csv is NOT gated: always (re)written, even when empty, so the header
    # is present and refresh_workbook sees a well-formed file (empty -> all buckets 0).
    write_csv(DATA_DIR / OUT3, c3 or PF_HEADER, r3)
    write_pull_status(c1, r1, len(r1), len(r2), len(r3), as_of=as_of)
    print(f"Wrote {DATA_DIR / OUT1} ({len(r1):,} rows), "
          f"{DATA_DIR / OUT2} ({len(r2):,} rows), and "
          f"{DATA_DIR / OUT3} ({len(r3):,} rows).")


if __name__ == "__main__":
    main()
