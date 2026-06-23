#!/usr/bin/env python3
"""
Build cusum-data.js — the FACADASH "registrations today" CUSUM widget.

Runs cusum_hourly_registrations.sql (registrations only, cheap — merchants table,
no receipts) and emits the CUSUM_DATA contract the widget expects. Completely
independent of the daily KPI pull: it has its own hourly GitHub Action so the
heavy receipts query can never block or delay this.

Auth: Snowflake key-pair, all values from environment (same secret as the daily
pull). Required env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY (PEM),
  SNOWFLAKE_PRIVATE_KEY_PASSPHRASE (optional), SNOWFLAKE_WAREHOUSE, SNOWFLAKE_ROLE,
  SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA.

CUSUM_DATA shape (matches cusum-preview.html, the approved widget):
  { sample:false, asOf:"YYYY-MM-DD HH:MM", hours:[0..23], todayHourOfData:int,
    today:[24] cumulative (null beyond the current hour),
    best:{date,total,cum:[24]}, lastWeek:{date,total,cum:[24]},
    todayTotal:int, todayByCountry:[{c,regs}] sorted desc (all countries) }
"""
import os, json, pathlib
import snowflake.connector
from cryptography.hazmat.primitives import serialization

HERE   = pathlib.Path(__file__).resolve().parent
SQLDIR = pathlib.Path(os.environ.get("SQL_DIR", HERE / "sql"))
V2     = pathlib.Path(os.environ.get("V2_DIR", HERE.parent / "KPI Dashboard v2 (Caio)"))
OUT    = pathlib.Path(os.environ.get("CUSUMDATA_OUT", V2 / "cusum-data.js"))
SQL_FILE = "cusum_hourly_registrations.sql"


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
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
        role=os.environ.get("SNOWFLAKE_ROLE", "DATA_VIEWER"),
        database=os.environ.get("SNOWFLAKE_DATABASE", "LOYVERSE_DATA_LAKE"),
        schema=os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC"),
        client_session_keep_alive=True)


def cum(arr):
    out, run = [], 0
    for v in arr:
        run += v
        out.append(run)
    return out


def main():
    sql = (SQLDIR / SQL_FILE).read_text()
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 600")
        # Pin the session to UTC so "today", "now", and the hourly reg buckets all
        # agree on one timezone — otherwise the live line breaks near the day boundary
        # (the account's default TZ is behind UTC). The widget's asOf stamp is UTC.
        cur.execute("ALTER SESSION SET TIMEZONE = 'UTC'")
        # DB "now" in the SAME timezone basis the query uses (CURRENT_DATE / HOUR),
        # so the live line truncates at the correct hour regardless of the runner's TZ.
        cur.execute("SELECT HOUR(CURRENT_TIMESTAMP()), "
                    "TO_CHAR(CURRENT_TIMESTAMP(), 'YYYY-MM-DD HH24:MI')")
        cur_hour, as_of = cur.fetchone()
        cur_hour = int(cur_hour)
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [c[0] for c in cur.description]
        cur.close()
    finally:
        conn.close()

    i = {c: n for n, c in enumerate(cols)}
    SERIES, REF, HOUR, COUNTRY, REGS = i["SERIES"], i["REF_DATE"], i["HOUR"], i["COUNTRY"], i["REGS"]

    hourly = {"today": [0] * 24, "best": [0] * 24, "lastweek": [0] * 24}
    ref_date = {}
    country = []
    for r in rows:
        s = str(r[SERIES])
        if s == "country":
            if r[COUNTRY]:
                country.append({"c": str(r[COUNTRY]), "regs": int(r[REGS] or 0)})
        elif s in hourly:
            hourly[s][int(r[HOUR])] = int(r[REGS] or 0)
            ref_date[s] = str(r[REF])[:10]

    today_cum = cum(hourly["today"])
    best_cum  = cum(hourly["best"])
    lw_cum    = cum(hourly["lastweek"])

    # today's line: cumulative through the current hour, null afterwards (don't draw the future)
    h = min(cur_hour, 23)
    today_line  = [today_cum[x] if x <= h else None for x in range(24)]
    today_total = today_cum[h]
    country.sort(key=lambda x: x["regs"], reverse=True)

    data = {
        "sample": False,
        "asOf": as_of,
        "hours": list(range(24)),
        "todayHourOfData": h,
        "today": today_line,
        "best":     {"date": ref_date.get("best", ""),     "total": best_cum[-1], "cum": best_cum},
        "lastWeek": {"date": ref_date.get("lastweek", ""),  "total": lw_cum[-1],   "cum": lw_cum},
        "todayTotal": today_total,
        "todayByCountry": country,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        f.write("// FACADASH registrations CUSUM — auto-generated hourly. Do not edit by hand.\n")
        f.write("const CUSUM_DATA = ")
        json.dump(data, f, separators=(",", ":"))
        f.write(";\n")
    print(f"cusum-data.js: today {today_total} thru {h:02d}:00 | "
          f"best {data['best']['date']} ({data['best']['total']}) | "
          f"lastWeek {data['lastWeek']['date']} ({data['lastWeek']['total']}) | "
          f"{len(country)} countries")


if __name__ == "__main__":
    main()
