#!/usr/bin/env python3
"""
Build cusum-data.js — FACADASH "registrations today" CUSUM, by POLLING (no timestamps).

The hourly GitHub Action runs on a UTC cron, so its OWN run-time is true UTC. At each
run we record the cumulative registration count against the current UTC hour; today's
accumulation = count now - count at the UTC-midnight baseline. The hour axis is true
UTC by construction — we never trust CREATED_AT's (local) clock.

Benchmarks (all-time best day, same weekday last week) are built from the per-day
history we accumulate in cusum-state.json. They populate over the first ~week of runs;
the "today" line is correct and live from the very first run.

State file (cusum-state.json, committed so it persists across runs):
  { "day":"YYYY-MM-DD", "baselineTotal":int, "baselineByCountry":{cc:int},
    "todayCum":[24] (cumulative regs recorded at each UTC hour; null if not polled),
    "complete":bool (whether this day started polling near midnight),
    "history":{ "YYYY-MM-DD": {"total":int,"cum":[24],"complete":bool} } }

Auth: Snowflake key-pair from env (same single secret as the daily pull).
"""
import os, json, pathlib, datetime
import snowflake.connector
from cryptography.hazmat.primitives import serialization

HERE   = pathlib.Path(__file__).resolve().parent
SQLDIR = pathlib.Path(os.environ.get("SQL_DIR", HERE / "sql"))
V2     = pathlib.Path(os.environ.get("V2_DIR", HERE.parent / "KPI Dashboard v2 (Caio)"))
OUT    = pathlib.Path(os.environ.get("CUSUMDATA_OUT", V2 / "cusum-data.js"))
STATE  = pathlib.Path(os.environ.get("CUSUM_STATE", HERE / "cusum-state.json"))
SQL_FILE = "cusum_hourly_registrations.sql"
RECON_SQL_FILE = "cusum_today_reconstruct.sql"
HISTORY_KEEP = 60
# Bump whenever the counting basis of the SQL changes (e.g. new fraud filter).
# On mismatch we RECONSTRUCT today's line from a country x hour query of today's
# registrations on the new basis (instead of zeroing it), and back-derive the
# midnight baseline as (count now - regs today).
FILTER_VERSION = 4   # 4 = 2026-08-07 S1 left-anchoring + S8 explosive-cluster rule


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


def load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except Exception:
            pass
    return {}


def ffill_to(cum, hour):
    """Cumulative line through `hour`: forward-fill gaps (hold last value), 0 before the
    first poll, null after the current hour (the future isn't drawn)."""
    out, last = [None] * 24, 0
    for x in range(24):
        if x > hour:
            out[x] = None
        else:
            if cum[x] is not None:
                last = cum[x]
            out[x] = last
    return out


def archive_day(cum):
    """Turn a day's recorded cumulative into a clean forward-filled 24-array + total."""
    out, last = [0] * 24, 0
    for x in range(24):
        if cum[x] is not None:
            last = cum[x]
        out[x] = last
    return out, last


def best_day(hist):
    cand = [(v["total"], k, v) for k, v in hist.items() if v.get("complete") and v.get("cum")]
    if not cand:
        return None
    cand.sort(reverse=True)
    total, date, v = cand[0]
    return {"date": date, "total": total, "cum": v["cum"]}


def last_week(hist, day):
    d = (datetime.date.fromisoformat(day) - datetime.timedelta(days=7)).isoformat()
    v = hist.get(d)
    if not v or not v.get("cum"):
        return None
    return {"date": d, "total": v["total"], "cum": v["cum"]}


def main():
    now   = datetime.datetime.now(datetime.timezone.utc)
    day   = now.strftime("%Y-%m-%d")
    hour  = now.hour
    as_of = now.strftime("%Y-%m-%d %H:%M")

    st = load_state()
    need_recon = st.get("filterVersion") != FILTER_VERSION and st.get("day")

    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 300")
        cur.execute((SQLDIR / SQL_FILE).read_text())
        rows = cur.fetchall()
        recon_rows = []
        if need_recon:
            cur.execute((SQLDIR / RECON_SQL_FILE).read_text())
            recon_rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    total_now, by_country_now = 0, {}
    for cc, regs in rows:
        regs = int(regs or 0)
        if cc == "TOTAL":
            total_now = regs
        elif cc:
            by_country_now[str(cc)] = regs

    # ---- filter-version rebaseline (counting basis changed) ----
    if need_recon:
        # Rebuild today's cumulative line on the NEW counting basis from the
        # reconstruction query (country x CREATED_AT-hour of today's filtered
        # registrations), then back-derive the midnight baseline. Counts whose
        # CREATED_AT hour sits past the current UTC poll hour (clock skew) are
        # folded into the current hour so the line stays consistent with "now".
        hourly, cc_today = [0] * 24, {}
        for cc, hr, n in recon_rows:
            n = int(n or 0)
            if cc:
                cc_today[str(cc)] = cc_today.get(str(cc), 0) + n
            h = int(hr) if hr is not None else hour
            hourly[min(max(h, 0), 23) if h <= hour else hour] += n
        run, cum_recon = 0, [None] * 24
        for h in range(hour + 1):
            run += hourly[h]
            cum_recon[h] = run
        st["day"] = day
        st["todayCum"] = cum_recon
        st["baselineTotal"] = total_now - run
        st["baselineByCountry"] = {cc: n - cc_today.get(cc, 0) for cc, n in by_country_now.items()}
        st["complete"] = False   # reconstructed day: keep out of ATH candidacy

    # ---- day rollover / first run ----
    if st.get("day") != day:
        hist = st.get("history", {})
        if st.get("day") and st.get("todayCum"):
            cum_arr, total = archive_day(st["todayCum"])
            hist[st["day"]] = {"total": total, "cum": cum_arr, "complete": bool(st.get("complete", True))}
        if len(hist) > HISTORY_KEEP:
            for k in sorted(hist)[:-HISTORY_KEEP]:
                hist.pop(k, None)
        st = {"day": day, "baselineTotal": total_now, "baselineByCountry": dict(by_country_now),
              "todayCum": [None] * 24, "complete": hour <= 1, "history": hist}

    st["filterVersion"] = FILTER_VERSION

    base_total = int(st.get("baselineTotal", total_now))
    base_cc    = st.get("baselineByCountry", {})

    cum = st.get("todayCum") or [None] * 24
    cum[hour] = max(0, total_now - base_total)
    st["todayCum"] = cum

    today_line  = ffill_to(cum, hour)
    today_total = today_line[hour] if today_line[hour] is not None else 0

    today_cc = []
    for cc, n in by_country_now.items():
        d = n - int(base_cc.get(cc, 0))
        if d > 0:
            today_cc.append({"c": cc, "regs": d})
    today_cc.sort(key=lambda x: x["regs"], reverse=True)

    hist = st.get("history", {})
    data = {
        "sample": False, "asOf": as_of, "hours": list(range(24)),
        "todayHourOfData": hour,
        "today": today_line,
        "best": best_day(hist),
        "lastWeek": last_week(hist, day),
        "todayTotal": today_total,
        "todayByCountry": today_cc,
    }

    STATE.write_text(json.dumps(st, separators=(",", ":")))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        f.write("// FACADASH registrations CUSUM — auto-generated hourly by polling. Do not edit by hand.\n")
        f.write("const CUSUM_DATA = ")
        json.dump(data, f, separators=(",", ":"))
        f.write(";\n")

    b = data["best"]["date"] if data["best"] else "—"
    lw = data["lastWeek"]["date"] if data["lastWeek"] else "—"
    print(f"cusum-data.js: {day} {hour:02d}:00 UTC | today {today_total} | "
          f"best {b} | lastWeek {lw} | history {len(hist)} days | {len(today_cc)} countries")


if __name__ == "__main__":
    main()
