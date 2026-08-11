#!/usr/bin/env python3
"""
Build kpi-data.js (Study & Churn pages) from the tidy Snowflake query outputs —
no Excel workbook. Reads the CSVs that run.py writes from the daily as-of queries,
takes the LATEST snapshot, and computes the same kpi-data.js refresh.py produced.

Inputs (CSV, written by run.py into WORK dir):
  cohort_grid.csv     <- cohort_unit_economics_daily_asof.sql
                         cols: SNAPSHOT_DATE, COHORT_MONTH, MONTH_START, MONTH_NUMBER,
                               REGISTRATIONS, PAYING_CUSTOMERS, CUM_PAYING_EVER, MRR_USD, ARPC_USD
  receipts.csv        <- receipts_tpv_daily_asof.sql
                         cols: SNAPSHOT_DATE, COHORT_MONTH, COUNTRY, CALENDAR_MONTH, MONTH_NUMBER,
                               COHORT_COUNTRY_SIZE, ACTIVE_MERCHANTS, RECEIPT_COUNT
  paying_country.csv  <- country_month_mrr_daily_asof.sql
                         cols: SNAPSHOT_DATE, COUNTRY, CALENDAR_MONTH, ACTIVE_PAYING_CUSTOMERS, MRR_USD
  country_lifetime.csv<- country_registrations_daily_asof.sql (latest snapshot)
                         cols: SNAPSHOT_DATE, COUNTRY, REGISTRATIONS, EVER_PAID, PCT_EVER_PAID
  country_reg_month.csv <- country_month_registrations_daily_asof.sql
                         cols: SNAPSHOT_DATE, COUNTRY, CALENDAR_MONTH, REGISTRATIONS

VALIDATION: on first run, diff this kpi-data.js against the current workbook-built one
(numbers should match within rounding). Column names above are the only thing to confirm
against the live query output — adjust the COL_* constants if a name differs.
"""
import os, json, datetime, pathlib
import pandas as pd

WORK = pathlib.Path(os.environ.get("WORK_DIR", "."))
OUT  = pathlib.Path(os.environ.get("KPIDATA_OUT",
        "/sessions/youthful-dazzling-bardeen/mnt/Unit Economics Analysis/KPI Dashboard v2 (Caio)/kpi-data.js"))
TOPN = 25
ACTIVE_FROM = "2022-01"

def ym(v):
    if isinstance(v, (datetime.datetime, datetime.date)): return f"{v.year:04d}-{v.month:02d}"
    return str(v)[:7]
def prev_ym(m):
    y, mo = int(m[:4]), int(m[5:7]) - 1
    if mo < 1: mo, y = 12, y - 1
    return f"{y:04d}-{mo:02d}"
def mdiff(a, b): return (int(b[:4])-int(a[:4]))*12 + (int(b[5:7])-int(a[5:7]))

def latest_snapshot(df):
    s = df["SNAPSHOT_DATE"].astype(str).str[:10]
    return df[s == s.max()].copy()

def num(df, cols):
    for c in cols: df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    return df

# ---- load latest snapshot of each query output ----
grid = latest_snapshot(pd.read_csv(WORK / "cohort_grid.csv"))
rcpt = latest_snapshot(pd.read_csv(WORK / "receipts.csv"))
payc = latest_snapshot(pd.read_csv(WORK / "paying_country.csv"))
clife = latest_snapshot(pd.read_csv(WORK / "country_lifetime.csv"))
cregm = latest_snapshot(pd.read_csv(WORK / "country_reg_month.csv"))

grid["COHORT"] = grid["COHORT_MONTH"].map(ym); grid["CAL"] = grid["MONTH_START"].map(ym)
grid = num(grid, ["REGISTRATIONS","PAYING_CUSTOMERS","CUM_PAYING_EVER","MRR_USD","ARPC_USD"])
grid["MN"] = pd.to_numeric(grid["MONTH_NUMBER"], errors="coerce").fillna(0).astype(int)
cal_months = sorted(grid["CAL"].unique())
latest_cal, latest_complete = cal_months[-1], cal_months[-2]

# ---- monthly ----
reg_by_month = grid.groupby("COHORT")["REGISTRATIONS"].max().astype(int)
mo = grid.groupby("CAL").agg(paying=("PAYING_CUSTOMERS","sum"), mrr=("MRR_USD","sum"),
                             cum=("CUM_PAYING_EVER","sum")).sort_index()
mo["new_payers"] = mo["cum"].diff().fillna(mo["cum"]).clip(lower=0)
mo["arpc"] = (mo["mrr"] / mo["paying"].replace(0, pd.NA)).fillna(0)

# ---- semester (H1/H2) new-payer cohort split (for the report page) ----
# For each calendar half: new payers first paying in the half (any cohort) vs those whose
# REGISTRATION cohort is also in the same half (fresh same-period conversions), + conversion %s.
# Derived from the cohort grid: per-cohort first payers/month = diff of CUM_PAYING_EVER.
def _halfkey(m): return m[:4] + ("-H1" if int(m[5:7]) <= 6 else "-H2")
_gg = grid[["COHORT", "CAL", "CUM_PAYING_EVER"]].sort_values(["COHORT", "CAL"]).copy()
_gg["newp"] = _gg.groupby("COHORT")["CUM_PAYING_EVER"].diff()
_gg["newp"] = _gg["newp"].fillna(_gg["CUM_PAYING_EVER"]).clip(lower=0)   # first month of a cohort = its own cum
_gg["calH"] = _gg["CAL"].map(_halfkey)
_gg["cohH"] = _gg["COHORT"].map(_halfkey)
_reg_half = {}
for _coh, _r in reg_by_month.items():
    _reg_half[_halfkey(_coh)] = _reg_half.get(_halfkey(_coh), 0) + int(_r)
semester_split = {}
for H in sorted(_gg["calH"].unique()):
    _sub = _gg[_gg["calH"] == H]
    _total = int(_sub["newp"].sum())
    _same  = int(_sub[_sub["cohH"] == H]["newp"].sum())
    _regs  = int(_reg_half.get(H, 0))
    semester_split[H] = {
        "newPayersTotal": _total,
        "newPayersSameHalfCohort": _same,
        "registrations": _regs,
        "pctSameHalfOfTotal":  round(100.0 * _same  / _total, 1) if _total else 0,
        "convAllCohorts":      round(100.0 * _total / _regs, 1)  if _regs else 0,
        "convSameHalfCohort":  round(100.0 * _same  / _regs, 1)  if _regs else 0,
    }
# ---- bottom-up current-state MRR is the source of truth for mrr/paying/arpc ----
# (amortized Chargebee line items, VOID_DATE IS NULL, per country x month). Falls back to
# the as-of cohort grid if the CSV is missing so the pull can never break.
try:
    _bu = pd.read_csv(WORK / "mrr_bottomup.csv")
    _bu["M"] = _bu["MONTH"].astype(str).str[:7]
    for _c in ("PAYING_MERCHANTS","MRR_USD"): _bu[_c] = pd.to_numeric(_bu[_c], errors="coerce").fillna(0)
    bu_m = _bu.groupby("M").agg(mrr=("MRR_USD","sum"), pay=("PAYING_MERCHANTS","sum"))
    print(f"   [mrr] bottom-up source: {len(bu_m)} months")
except Exception as _e:
    bu_m = None; print("   [mrr][warn] bottom-up CSV unavailable, using as-of grid:", _e)

# per-country MRR/ARPC by month (bottom-up) — powers the FACADASH country-filter MRR/ARPC tiles
mrr_country = {}; arpc_country = {}
if bu_m is not None:
    try:
        for _c, _g in _bu.groupby("COUNTRY"):
            _mm = {m: round(float(v), 2) for m, v in zip(_g["M"], _g["MRR_USD"])}
            _pp = {m: float(v) for m, v in zip(_g["M"], _g["PAYING_MERCHANTS"])}
            mrr_country[str(_c)]  = _mm
            arpc_country[str(_c)] = {m: (round(_mm[m] / _pp[m], 2) if _pp.get(m) else 0) for m in _mm}
    except Exception as _e:
        print("   [mrr-country][warn]", _e)

def _bu_mrr(m): return float(bu_m.loc[m,"mrr"]) if (bu_m is not None and m in bu_m.index) else (float(mo.loc[m,"mrr"]) if m in mo.index else 0.0)
def _bu_pay(m): return int(bu_m.loc[m,"pay"]) if (bu_m is not None and m in bu_m.index) else (int(mo.loc[m,"paying"]) if m in mo.index else 0)

months = sorted(set(mo.index) | set(reg_by_month.index))
monthly_out = []
for m in months:
    _mrr = _bu_mrr(m); _pay = _bu_pay(m)
    monthly_out.append({"month": m,
        "registrations": int(reg_by_month.get(m, 0)),
        "paying": _pay,
        "mrr": round(_mrr, 2),
        "newPayers": int(mo.loc[m,"new_payers"]) if m in mo.index else 0,
        "cumEverPaid": int(mo.loc[m,"cum"]) if m in mo.index else 0,
        "arpc": round(_mrr/_pay, 2) if _pay else 0})

# ---- receipts/active by cohort x country x month (latest snapshot) ----
rcpt["COH"] = rcpt["COHORT_MONTH"].map(ym); rcpt["CAL"] = rcpt["CALENDAR_MONTH"].map(ym)
rcpt = num(rcpt, ["ACTIVE_MERCHANTS","RECEIPT_COUNT","COHORT_COUNTRY_SIZE"])
rcpt["MN"] = pd.to_numeric(rcpt["MONTH_NUMBER"], errors="coerce").fillna(0).astype(int)
# global active per month (each merchant in one cohort+country, so summing is a valid distinct total)
active_by_month = rcpt.groupby("CAL")["ACTIVE_MERCHANTS"].sum()
active_monthly = [{"month": m, "active": int(active_by_month[m])}
                  for m in sorted(active_by_month.index) if m >= ACTIVE_FROM and m <= latest_complete]
# cohort-age active + activation% (sum over countries)
# MN<0 = receipts whose calendar month is BEFORE the cohort's registration month (backdated /
# device-clock rows). They have no valid cohort age, and a cohort with only such rows made
# mx=max(MN) negative -> arr=[None]*(mx+1) an EMPTY list -> arr[i] IndexError below. Cohort-age
# curves only use MN>=0. The global active_by_month + per-country totals above keep ALL rows, so
# this drops no real activity — it only excludes negative ages from the age-based curves.
ca = rcpt[rcpt["MN"] >= 0].groupby(["COH","MN"]).agg(active=("ACTIVE_MERCHANTS","sum"),
                                    size=("COHORT_COUNTRY_SIZE","sum")).reset_index()
cohort_active_age, cohort_active_pct = {}, {}
for coh, g in ca.groupby("COH"):
    mx = int(g["MN"].max()); arr = [None]*(mx+1); pct = [None]*(mx+1)
    for _, r in g.iterrows():
        i = int(r["MN"]); arr[i] = int(r["active"])
        pct[i] = round(100.0*r["active"]/r["size"],2) if r["size"] else None
    cohort_active_age[coh], cohort_active_pct[coh] = arr, pct
def active_snap(coh):
    arr = cohort_active_age.get(coh); age = mdiff(coh, latest_complete)
    return arr[age] if arr and 0 <= age < len(arr) and arr[age] is not None else 0
# per-country active / receipts by month
def _to_nested(s):
    out = {}
    for (c, m), v in s.items():
        out.setdefault(str(c), {})[m] = int(v)
    return out
active_country_all   = _to_nested(rcpt.groupby(["COUNTRY","CAL"])["ACTIVE_MERCHANTS"].sum())
receipts_country_all = _to_nested(rcpt.groupby(["COUNTRY","CAL"])["RECEIPT_COUNT"].sum())

# ---- aggregate retention curve (avg activation% by age across cohorts) ----
by_age = {}
for coh, pct in cohort_active_pct.items():
    for age, v in enumerate(pct):
        if v is not None: by_age.setdefault(age, []).append(v)
ages = sorted(by_age)
reg_pct = [round(sum(by_age[a])/len(by_age[a]),2) for a in ages]
retention = {"age": ages, "registrationPct": reg_pct, "momPct": [None]*len(ages)}
b1 = reg_pct[1] if len(reg_pct) > 1 else None
retention["activatedProxyPct"] = ([round(v/b1*100,2) for v in reg_pct[1:]] if b1 else [])

# ---- paying by country ----
payc["CAL"] = payc["CALENDAR_MONTH"].map(ym)
payc["ACTIVE_PAYING_CUSTOMERS"] = pd.to_numeric(payc["ACTIVE_PAYING_CUSTOMERS"], errors="coerce").fillna(0)
paying_country_all = {c: dict(zip(g["CAL"], g["ACTIVE_PAYING_CUSTOMERS"].astype(int)))
                      for c, g in payc.groupby("COUNTRY")}

# ---- countries (lifetime) ----
clife = num(clife, ["REGISTRATIONS","EVER_PAID"])
clife = clife.dropna(subset=["COUNTRY"]).sort_values("REGISTRATIONS", ascending=False)
countries_out = []
for _, r in clife.iterrows():
    regs = int(r["REGISTRATIONS"])
    countries_out.append({"country": str(r["COUNTRY"]), "registrations": regs,
        "everPaid": int(r["EVER_PAID"]),
        "pctEverPaid": round(100.0*r["EVER_PAID"]/regs,2) if regs else 0,
        "active": int(active_country_all.get(str(r["COUNTRY"]), {}).get(latest_complete, 0))})
top = [c["country"] for c in countries_out[:TOPN]]
top100 = [c["country"] for c in countries_out]

# ---- registrations by country by month ----
cregm["CAL"] = cregm["CALENDAR_MONTH"].map(ym)
cregm["REGISTRATIONS"] = pd.to_numeric(cregm["REGISTRATIONS"], errors="coerce").fillna(0)
reg_country_all = {c: dict(zip(g["CAL"], g["REGISTRATIONS"].astype(int))) for c, g in cregm.groupby("COUNTRY")}
creg_out = {c: reg_country_all.get(c, {}) for c in top}

# ---- cohort summary + triangle + compare ----
last = grid[grid["CAL"] == latest_complete]
cohorts_out = []
for _, r in last.sort_values("COHORT").iterrows():
    regs = int(r["REGISTRATIONS"])
    cohorts_out.append({"cohort": r["COHORT"], "registrations": regs,
        "payingNow": int(r["PAYING_CUSTOMERS"]), "everPaid": int(r["CUM_PAYING_EVER"]),
        "mrr": round(float(r["MRR_USD"]),2), "arpc": round(float(r["ARPC_USD"]),2),
        "active": int(active_snap(r["COHORT"])),
        "pctEverPaid": round(100.0*r["CUM_PAYING_EVER"]/regs,2) if regs else 0,
        "pctPayingNow": round(100.0*r["PAYING_CUSTOMERS"]/regs,2) if regs else 0})
tri = {}
for coh, g in grid.groupby("COHORT"):
    g = g.sort_values("MN")
    tri[coh] = {"mrr": [round(float(x),0) for x in g["MRR_USD"]], "paying": [int(x) for x in g["PAYING_CUSTOMERS"]]}
compare_cohorts = [c["cohort"] for c in cohorts_out][-24:]
# Carry the compare series through the CURRENT (partial) calendar month, not just the last
# complete one, so the Triangle view shows every cohort's latest figure — e.g. the July cohort's
# M1 is August-to-date. Until 2026-08-08 this cut at latest_complete, so the newest diagonal was
# computed, thrown away here, and the view lagged by up to a month.
# The partial column is genuinely partial for MRR and active (both accumulate within a month);
# the dashboard marks that column rather than the data hiding it. The summary TABLE still uses
# latest_complete via active_snap(), which is what its "snapshot at latest complete month"
# heading promises.
gridc = grid[(grid["COHORT"].isin(compare_cohorts)) & (grid["CAL"] <= latest_cal) & (grid["MN"] <= 24)]
compare_series = {}
for coh in compare_cohorts:
    g = gridc[gridc["COHORT"] == coh].sort_values("MN")
    n = min(mdiff(coh, latest_cal) + 1, 25)
    mrr_a, pay_a, act_a, pct_a = [None]*n, [None]*n, [None]*n, [None]*n
    for _, r in g.iterrows():
        i = int(r["MN"])
        if i < n: mrr_a[i] = round(float(r["MRR_USD"]),0); pay_a[i] = int(r["PAYING_CUSTOMERS"])
    arr, arrp = cohort_active_age.get(coh, []), cohort_active_pct.get(coh, [])
    for i in range(n):
        if i < len(arr) and arr[i] is not None: act_a[i] = int(arr[i])
        if i < len(arrp) and arrp[i] is not None: pct_a[i] = arrp[i]
    compare_series[coh] = {"mrr": mrr_a, "paying": pay_a, "active": act_a, "activePct": pct_a}

# ---- country league funnel (current + prior month) ----
lg_prev = prev_ym(latest_complete)
def gv(d, c, m): return int((d.get(c) or {}).get(m, 0))
funnel_rows = [{"c": c,
    "reg": gv(reg_country_all, c, latest_complete), "active": gv(active_country_all, c, latest_complete),
    "paying": gv(paying_country_all, c, latest_complete), "receipts": gv(receipts_country_all, c, latest_complete),
    "regP": gv(reg_country_all, c, lg_prev), "activeP": gv(active_country_all, c, lg_prev),
    "payingP": gv(paying_country_all, c, lg_prev), "receiptsP": gv(receipts_country_all, c, lg_prev)} for c in top100]
country_funnel = {"current": latest_complete, "previous": lg_prev, "rows": funnel_rows}

# country names — keep in sync with refresh.py / the dashboard
from country_names import COUNTRY_NAMES  # ships beside this script

data = {
    "meta": {"generatedAt": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
             "source": "Snowflake daily as-of queries (server-side, Chargebee-invoice methodology)",
             "currency": "USD", "latestMonth": latest_cal, "snapshotMonth": latest_complete,
             "activeFrom": ACTIVE_FROM,
             "dataStatus": "ACTUAL — generated server-side from Snowflake (no Excel workbook).",
             "notes": ["MRR = paid plan/addon invoice line items, spread across billing period, GBP x1.34 / EUR x1.16.",
                       "Merchants deduped by email. Active = >=1 valid receipt in month (device-clock-filtered in SQL).",
                       "Latest month is partial; the snapshot month is the latest complete month."]},
    "activeMonthly": active_monthly, "monthly": monthly_out, "cohorts": cohorts_out,
    "cohortCompare": compare_series, "cohortTriangle": tri, "countries": countries_out,
    "countryRegistrationsByMonth": creg_out,
    "activeByCountryByMonth": {c: active_country_all.get(c, {}) for c in top},
    "receiptsByCountryByMonth": {c: receipts_country_all.get(c, {}) for c in top},
    "payingByCountryByMonth": {c: paying_country_all.get(c, {}) for c in top},
    "mrrByCountryByMonth": {c: mrr_country.get(c, {}) for c in top100},
    "arpcByCountryByMonth": {c: arpc_country.get(c, {}) for c in top100},
    "semesterCohortSplit": semester_split,
    "countryFunnel": country_funnel, "countryNames": COUNTRY_NAMES, "retention": retention,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w") as f:
    f.write("// Loyverse KPI Dashboard data — auto-generated server-side. Do not edit by hand.\n")
    f.write("const KPI_DATA = "); json.dump(data, f, separators=(",", ":")); f.write(";\n")
print(f"kpi-data.js: months {len(monthly_out)} | cohorts {len(cohorts_out)} | countries {len(countries_out)} | latest {latest_cal}")
