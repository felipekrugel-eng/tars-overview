"""
build_cohort_country.py — per-country cohort files for the Study & Trend "Cohorts" section.

WHY SEPARATE FILES: the country filter has to drive three widgets (comparison chart, triangle
view, summary table) across ~250 countries x 25 cohorts x 25 ages. Embedding that in kpi-data.js
would add megabytes to a file that EVERY page loads. Instead each country gets one small JSON in
cohort-country/, fetched only when that country is selected. "All countries" keeps using the
data already embedded in kpi-data.js, so first paint is unchanged.

Inputs (CSV, written by run.py into WORK dir):
  cohort_country.csv <- cohort_country_snapshot.sql
                        cols: SNAPSHOT_DATE, COHORT_MONTH, COUNTRY, REGISTRATIONS, MONTH_START,
                              MONTH_NUMBER, PAYING_CUSTOMERS, CUM_PAYING_EVER, MRR_USD, ARPC_USD
  receipts.csv       <- receipts_tpv_daily_asof.sql (already pulled for kpi-data.js)
                        cols: SNAPSHOT_DATE, COHORT_MONTH, COUNTRY, CALENDAR_MONTH, MONTH_NUMBER,
                              COHORT_COUNTRY_SIZE, ACTIVE_MERCHANTS, RECEIPT_COUNT

Output: <OUT_DIR>/cohort-country/<CC>.json  +  cohort-country/_index.json

Each country file mirrors the shapes index.html already consumes, so the front end can swap it in
without a second code path:
  {"country","name","snapshotMonth","cohorts":[{cohort,registrations,everPaid,payingNow,mrr,arpc,
   active,pctEverPaid,pctPayingNow}],"cohortCompare":{"<cohort>":{mrr,paying,active,activePct}}}

Env:
  COHORT_COUNTRY_CSV  input (default: <WORK_DIR or here>/cohort_country.csv)
  RECEIPTS_CSV        input (default: <WORK_DIR or here>/receipts.csv)
  COHORT_COUNTRY_OUT  output dir (default: <here>)
"""
import csv, json, os, pathlib, collections

HERE = pathlib.Path(os.path.dirname(os.path.abspath(__file__)))
WORK = pathlib.Path(os.environ.get("WORK_DIR", str(HERE)))
CC_CSV   = pathlib.Path(os.environ.get("COHORT_COUNTRY_CSV", str(WORK / "cohort_country.csv")))
RCPT_CSV = pathlib.Path(os.environ.get("RECEIPTS_CSV",       str(WORK / "receipts.csv")))
OUT_DIR  = pathlib.Path(os.environ.get("COHORT_COUNTRY_OUT", str(HERE)))
N_SHOWN  = 24          # cohorts shown by the table/chart/triangle (complete cohorts only)

try:
    from country_names import COUNTRY_NAMES
except Exception:
    COUNTRY_NAMES = {}


def ym(v):
    return str(v)[:7]


def _rows(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _latest_snapshot(rows):
    if not rows:
        return rows
    mx = max(str(r.get("SNAPSHOT_DATE", ""))[:10] for r in rows)
    return [r for r in rows if str(r.get("SNAPSHOT_DATE", ""))[:10] == mx]


def _f(r, k):
    try:
        return float(r.get(k) or 0)
    except (TypeError, ValueError):
        return 0.0


def main():
    cc = _latest_snapshot(_rows(CC_CSV))
    if not cc:
        raise SystemExit("cohort_country.csv is empty — nothing to build")

    # Snapshot month = the latest COMPLETE calendar month, i.e. the month BEFORE the as-of date.
    # Derived from SNAPSHOT_DATE rather than from the newest MONTH_START in the grid: the grid's
    # last month is only the in-progress month when the newest cohort actually has a row there,
    # so inferring it from the data silently slips a month in edge cases.
    asof = max(str(r.get("SNAPSHOT_DATE", ""))[:10] for r in cc)
    y, m = int(asof[:4]), int(asof[5:7])
    snapshot_month = f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"
    months = sorted({ym(r["MONTH_START"]) for r in cc})
    if snapshot_month not in months:      # fixture / partial-grid safety net
        snapshot_month = months[-2] if len(months) > 1 else months[-1]
    # The CURRENT, in-progress month. The age series runs to here so the Triangle view can show
    # each cohort's latest figure (July cohort's M1 = August-to-date). snapshot_month stays the
    # last COMPLETE month and still drives the summary table and which cohorts are listed.
    current_month = f"{y:04d}-{m:02d}"
    if current_month not in months:
        current_month = months[-1] if months else snapshot_month

    # active merchants by (country, cohort, calendar month) — the country dimension that
    # build_kpi_data.py sums away.
    active = collections.defaultdict(dict)
    for r in _latest_snapshot(_rows(RCPT_CSV)):
        mn = int(_f(r, "MONTH_NUMBER"))
        if mn < 0:                      # backdated receipts have no valid cohort age
            continue
        ctry = (r.get("COUNTRY") or "ZZ").strip().upper() or "ZZ"
        active[(ctry, ym(r["COHORT_MONTH"]))][mn] = int(_f(r, "ACTIVE_MERCHANTS"))

    # index the cohort x country grid
    by_country = collections.defaultdict(lambda: collections.defaultdict(dict))
    size = {}
    for r in cc:
        ctry = (r.get("COUNTRY") or "ZZ").strip().upper() or "ZZ"
        coh, mn = ym(r["COHORT_MONTH"]), int(_f(r, "MONTH_NUMBER"))
        by_country[ctry][coh][mn] = r
        size[(ctry, coh)] = int(_f(r, "REGISTRATIONS"))

    all_cohorts = sorted({ym(r["COHORT_MONTH"]) for r in cc})
    shown = [c for c in all_cohorts if c <= snapshot_month][-N_SHOWN:]

    out_dir = OUT_DIR / "cohort-country"
    out_dir.mkdir(parents=True, exist_ok=True)
    index, written = [], 0

    for ctry, cohs in sorted(by_country.items()):
        rows_out, compare = [], {}
        for coh in shown:
            ages = cohs.get(coh) or {}
            regs = size.get((ctry, coh), 0)
            act = active.get((ctry, coh), {})
            if not ages and not act and not regs:
                continue
            # Cap the age series at the CURRENT month, matching build_kpi_data.py's global
            # cohortCompare (CAL <= latest_cal, n = mdiff(coh, latest_cal)+1). Both sides must use
            # the same bound: the Triangle is country-filterable, so a country capped a month
            # earlier than the global view would lose its newest column the moment you filtered.
            # Changed 2026-08-08 from snapshot_month; the trailing point is the in-progress month
            # and the dashboard marks it as partial rather than dropping it.
            age_at_cap = (int(current_month[:4]) - int(coh[:4])) * 12 + \
                         (int(current_month[5:7]) - int(coh[5:7]))
            n_ages = min(max([*ages.keys(), *act.keys(), 0]) + 1, age_at_cap + 1, 25)
            if n_ages <= 0:
                continue
            mrr_s, pay_s, act_s, actpct_s = [], [], [], []
            for i in range(n_ages):
                r = ages.get(i)
                mrr_s.append(round(_f(r, "MRR_USD"), 2) if r else None)
                pay_s.append(int(_f(r, "PAYING_CUSTOMERS")) if r else None)
                a = act.get(i)
                act_s.append(a if a is not None else None)
                actpct_s.append(round(100.0 * a / regs, 2) if (a is not None and regs) else None)
            compare[coh] = {"mrr": mrr_s, "paying": pay_s, "active": act_s, "activePct": actpct_s}

            # summary row = the cohort's value at the snapshot month (age computed above)
            snap = ages.get(age_at_snap)
            paying = int(_f(snap, "PAYING_CUSTOMERS")) if snap else 0
            ever = int(_f(snap, "CUM_PAYING_EVER")) if snap else 0
            mrr = round(_f(snap, "MRR_USD"), 2) if snap else 0.0
            rows_out.append({
                "cohort": coh, "registrations": regs, "everPaid": ever, "payingNow": paying,
                "mrr": mrr, "arpc": round(mrr / paying, 2) if paying else 0.0,
                "active": int(act.get(age_at_snap) or 0),
                "pctEverPaid": round(100.0 * ever / regs, 2) if regs else 0.0,
                "pctPayingNow": round(100.0 * paying / regs, 2) if regs else 0.0})

        if not rows_out:
            continue
        payload = {"country": ctry, "name": COUNTRY_NAMES.get(ctry, ctry),
                   "snapshotMonth": snapshot_month, "cohorts": rows_out,
                   "cohortCompare": compare}
        with open(out_dir / f"{ctry}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"))
        written += 1
        index.append({"c": ctry, "n": COUNTRY_NAMES.get(ctry, ctry),
                      "reg": sum(r["registrations"] for r in rows_out),
                      "pay": sum(r["payingNow"] for r in rows_out)})

    # _index.json drives the dropdown: every country with cohort data, biggest first.
    index.sort(key=lambda x: -x["reg"])
    with open(out_dir / "_index.json", "w", encoding="utf-8") as f:
        json.dump({"snapshotMonth": snapshot_month, "cohorts": shown, "countries": index},
                  f, separators=(",", ":"))

    kb = sum(p.stat().st_size for p in out_dir.glob("*.json")) / 1024
    print(f"cohort-country: {written} countries, cohorts {shown[0]}..{shown[-1]}, "
          f"snapshot {snapshot_month}, {kb:.0f} KB total")


if __name__ == "__main__":
    main()
