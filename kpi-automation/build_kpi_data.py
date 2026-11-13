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
# 60, not 25 (raised 2026-09-21). The country table shows the top 40 on whichever column
# is sorted, and the trend arrow needs activeByCountryByMonth for every row it draws. At 25
# the rows below that rank lost their arrow and their paying figure the moment you re-sorted.
# 60 gives the table headroom on any sort order; the cost is per-country monthly dicts for
# 35 more countries, which is tens of kilobytes on a 0.95MB file.
TOPN = 60
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

# ---- PAYING CUSTOMERS: subscription-based, the figure Alex reports ----
# A paying customer is a merchant with at least one live Chargebee subscription (active or
# non_renewing) at month end. That is NOT what the invoice-derived count above measures —
# that one counts merchants an invoice was raised for in the month, which is a different
# population and runs lower.
#
# It cannot be computed here. CHARGEBEE_SUBSCRIPTIONS_V holds CURRENT status only, so the
# count has to be captured as time passes; paying-snapshots.json is that record, written by
# run.py and frozen once a month closes. See that file's _doc block for provenance.
#
# BOTH NUMBERS ARE PUBLISHED. `paying` is the headline, `payingInvoice` is the old count,
# and `payingSource` says which bucket the headline came from, so a reader can always see
# whether a month was measured, reported by Alex, or reconstructed.
#
# ARPC KEEPS DIVIDING BY payingInvoice. MRR here is invoice-based, so its denominator must
# be the invoice-based population: mixing the two would divide one month's revenue by
# another definition's merchants and quietly misstate ARPC by the gap between them.
# Beside kpi-data.js, wherever that is being written — one path to keep in step, not two.
_PAY_SNAP = pathlib.Path(os.environ.get("PAYING_SNAPSHOTS", OUT.parent / "paying-snapshots.json"))
_close, _daily = {}, {}
try:
    _snap = json.loads(_PAY_SNAP.read_text(encoding="utf-8"))
    _close = {k: v for k, v in (_snap.get("monthClose") or {}).items()}
    _daily = {k: v for k, v in (_snap.get("daily") or {}).items()}
    print(f"   [paying] snapshots: {len(_close)} month closes, {len(_daily)} daily readings")
except Exception as _e:
    print("   [paying][warn] paying-snapshots.json unavailable, "
          "falling back to the invoice count for every month:", _e)

_latest_daily = max(_daily) if _daily else None
_cur_month = _latest_daily[:7] if _latest_daily else None

def _paying(m):
    """(count, source) for month m. Falls back to the invoice count, loudly."""
    if m in _close:
        return int(_close[m]["value"]), str(_close[m].get("source") or "monthClose")
    if _cur_month and m == _cur_month:
        return int(_daily[_latest_daily]["value"]), "snapshot-" + _latest_daily
    return None, None

# ---- MRR: the value of subscriptions LIVE at month end ----
# The headline from 2026-11-09, from mrr_live_monthly.sql. Same merchant base as the paying
# count above, which is the point: ARPC can finally divide MRR by paying customers without
# the two halves describing different populations.
#
# The bottom-up amortised figure is still built and is published as `mrrInvoice`. It is NOT
# the same number and is not meant to be — it spreads each invoice across the months it
# covers, so an annual plan billed in March still contributes next February whether or not
# the merchant is still there. October 2026 reads ~$1,015k live against ~$1,070k bottom-up.
#
# FALLS BACK LOUDLY. If the CSV is missing, every month reverts to the bottom-up number and
# says so, rather than the page silently showing a different definition under the new label.
_live_mrr, _live_unpaid = {}, {}
try:
    _ml = pd.read_csv(WORK / "mrr_live.csv")
    _ml["M"] = _ml["MONTH"].astype(str).str[:7]
    for _c in ("MRR", "MRR_ON_UNPAID_INVOICES"):
        _ml[_c] = pd.to_numeric(_ml[_c], errors="coerce").fillna(0.0)
    # One row per month already; last-wins guards against a duplicate in-progress row.
    for _m, _v, _u in zip(_ml["M"], _ml["MRR"], _ml["MRR_ON_UNPAID_INVOICES"]):
        _live_mrr[_m] = float(_v); _live_unpaid[_m] = float(_u)
    print(f"   [mrr] live source: {len(_live_mrr)} months")
except Exception as _e:
    print("   [mrr][warn] mrr_live.csv unavailable — EVERY month falls back to the bottom-up "
          "amortised MRR, which is a DIFFERENT definition and runs ~5% higher:", _e)

months = sorted(set(mo.index) | set(reg_by_month.index))
monthly_out = []
_fellback = []
_mrr_fellback = []
for m in months:
    _inv_mrr = _bu_mrr(m); _inv = _bu_pay(m)
    _pay, _src = _paying(m)
    if _pay is None:
        _pay, _src = _inv, "invoice-fallback"
        _fellback.append(m)
    if m in _live_mrr:
        _mrr = _live_mrr[m]
    else:
        _mrr = _inv_mrr
        _mrr_fellback.append(m)
    monthly_out.append({"month": m,
        "registrations": int(reg_by_month.get(m, 0)),
        "paying": _pay,
        "payingInvoice": _inv,
        "payingSource": _src,
        "mrr": round(_mrr, 2),
        "mrrUnpaid": round(_live_unpaid.get(m, 0.0), 2),
        "mrrInvoice": round(_inv_mrr, 2),
        "newPayers": int(mo.loc[m,"new_payers"]) if m in mo.index else 0,
        "cumEverPaid": int(mo.loc[m,"cum"]) if m in mo.index else 0,
        # Both halves from the live-subscription definition now.
        "arpc": round(_mrr/_pay, 2) if _pay else 0})
if _fellback:
    print(f"   [paying][warn] no snapshot for {len(_fellback)} month(s) — using the invoice "
          f"count there, which is a DIFFERENT definition and reads lower: "
          f"{_fellback[0]}..{_fellback[-1]}")
if _mrr_fellback:
    print(f"   [mrr][warn] no live MRR for {len(_mrr_fellback)} month(s) — using the bottom-up "
          f"figure there: {_mrr_fellback[0]}..{_mrr_fellback[-1]}")

# ---- receipts/active by cohort x country x month (latest snapshot) ----
rcpt["COH"] = rcpt["COHORT_MONTH"].map(ym); rcpt["CAL"] = rcpt["CALENDAR_MONTH"].map(ym)
# TPV_USD_APPROX (the SQL's country-aware, multi-currency GTV column) is included here so
# gtv_country_all below can be built the same way as active_country_all/receipts_country_all.
# It's optional/backward-compatible: older receipts.csv snapshots that predate the GTV wiring
# in receipts_tpv_daily_asof.sql simply won't have the column, so it's added as 0 rather than
# via the num() helper (which would KeyError on a missing column).
if "TPV_USD_APPROX" not in rcpt.columns: rcpt["TPV_USD_APPROX"] = 0
rcpt = num(rcpt, ["ACTIVE_MERCHANTS","RECEIPT_COUNT","COHORT_COUNTRY_SIZE","TPV_USD_APPROX"])
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
# Same shape as _to_nested but keeps two decimal places instead of truncating to int, since
# this one carries a USD amount (GTV) rather than a count.
def _to_nested_usd(s):
    out = {}
    for (c, m), v in s.items():
        out.setdefault(str(c), {})[m] = round(float(v), 2)
    return out
active_country_all   = _to_nested(rcpt.groupby(["COUNTRY","CAL"])["ACTIVE_MERCHANTS"].sum())
receipts_country_all = _to_nested(rcpt.groupby(["COUNTRY","CAL"])["RECEIPT_COUNT"].sum())
gtv_country_all       = _to_nested_usd(rcpt.groupby(["COUNTRY","CAL"])["TPV_USD_APPROX"].sum())

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
# ---- MRR bridge: how last month's MRR became this month's ----
# One row per month from mrr_bridge_monthly.sql, which decomposes the change in the SAME live
# MRR published above. Emitted as a plain list because the chart reads it in order.
#
# OPTIONAL BY DESIGN. An empty list means the Churn tab hides the chart and says the data is
# not in this build, which is the honest state. The alternative — carrying the last good
# bridge — would redraw a stale decomposition under a fresh MRR line and nothing on the page
# would reveal it.
#
# The closing-equals-published check is here rather than in run.py because only this file has
# both numbers: run.py verified the bridge closes on itself, this verifies it closes on the
# MRR series the page actually draws. A bridge that balances internally but disagrees with the
# headline is the more dangerous failure, because every row still adds up.
mrr_bridge = []
try:
    _mb = pd.read_csv(WORK / "mrr_bridge.csv")
    _cols = ["NEW_MRR", "REACTIVATION_MRR", "EXPANSION_MRR", "CONTRACTION_MRR", "CHURN_MRR",
             "OPENING_MRR", "CLOSING_MRR"]
    for _c in _cols:
        _mb[_c] = pd.to_numeric(_mb[_c], errors="coerce").fillna(0.0)
    _mb["M"] = _mb["MONTH"].astype(str).str[:7]
    _drift = []
    for _, _r in _mb.iterrows():
        _m = _r["M"]
        mrr_bridge.append({
            "month": _m,
            "opening": round(float(_r["OPENING_MRR"]), 2),
            "new": round(float(_r["NEW_MRR"]), 2),
            "reactivation": round(float(_r["REACTIVATION_MRR"]), 2),
            "expansion": round(float(_r["EXPANSION_MRR"]), 2),
            "contraction": round(float(_r["CONTRACTION_MRR"]), 2),
            "churn": round(float(_r["CHURN_MRR"]), 2),
            "closing": round(float(_r["CLOSING_MRR"]), 2),
            "paying": int(_r.get("PAYING_MERCHANTS", 0) or 0),
            "newMerchants": int(_r.get("NEW_MERCHANTS", 0) or 0),
            "reactivatedMerchants": int(_r.get("REACTIVATED_MERCHANTS", 0) or 0),
            "churnedMerchants": int(_r.get("CHURNED_MERCHANTS", 0) or 0),
        })
        _pub = _live_mrr.get(_m)
        if _pub is not None and abs(float(_r["CLOSING_MRR"]) - _pub) > max(1.0, abs(_pub) * 0.002):
            _drift.append((_m, float(_r["CLOSING_MRR"]), _pub))
    if _drift:
        # Not fatal: the newest month legitimately moves between the two queries, which run
        # minutes apart against a live book. Named in full so a real divergence is visible
        # rather than averaged into a reassuring summary line.
        print(f"   [bridge][warn] closing MRR differs from the published series in "
              f"{len(_drift)} month(s): " +
              ", ".join(f"{m} bridge {b:,.0f} vs {p:,.0f}" for m, b, p in _drift[:6]))
    print(f"   [bridge] {len(mrr_bridge)} months")
except Exception as _e:
    print("   [bridge][warn] mrr_bridge.csv unavailable — the Churn tab will hide the revenue "
          "bridge rather than draw a stale one:", _e)

# ---- cohort retention curves, measured, on two definitions of t0 ----
# Replaces a hardcoded array. Aggregated SUM over SUM, never as the mean of per-cohort
# percentages: a mean of ratios lets a 40-merchant cohort weigh the same as a 4,000-merchant
# one, which is how a curve ends up describing the small cohorts rather than the business.
#
# 'sub' — t0 is the merchant's first paying month. Every cohort starts at 100% of its
#         merchants and 100% of its MRR, so the curve is pure survival. Revenue sits ABOVE
#         merchants because the survivors expand: at M60 roughly a fifth of the merchants
#         are left and over half the revenue.
# 'reg' — t0 is the sign-up month. The denominator is that month's REGISTRATIONS, taken from
#         the series already published above so the page divides by the number it shows
#         elsewhere. The curve starts near zero, climbs as the cohort converts, then decays.
#
# A cohort only contributes to an age it has actually reached, so the tail is computed from
# progressively fewer cohorts. That count is emitted per age — a curve thinning to a handful
# of old cohorts is not the same measurement as its head and the page marks where it changes.
retention_cohorts = {}
try:
    _rc = pd.read_csv(WORK / "retention_cohorts.csv")
    for _c in ("AGE", "MERCHANTS", "MRR", "COHORT_MERCHANTS", "COHORT_BASE_MRR"):
        _rc[_c] = pd.to_numeric(_rc[_c], errors="coerce")
    _rc["COHORT"] = _rc["COHORT"].astype(str).str[:7]
    _regs = {r["month"]: float(r.get("registrations") or 0) for r in monthly_out}

    def _curve(_df, _den_m, _den_r):
        """_den_m/_den_r: cohort -> denominator. Returns curves keyed by age."""
        _acc = {}
        for _, _r in _df.iterrows():
            _a = int(_r["AGE"])
            if _a < 0:
                continue
            _dm, _dr = _den_m.get(_r["COHORT"]), _den_r.get(_r["COHORT"])
            if not _dm:
                continue
            _s = _acc.setdefault(_a, {"m": 0.0, "dm": 0.0, "r": 0.0, "dr": 0.0, "n": 0})
            _s["m"] += float(_r["MERCHANTS"] or 0); _s["dm"] += _dm
            if _dr:
                _s["r"] += float(_r["MRR"] or 0); _s["dr"] += _dr
            _s["n"] += 1
        _ages = sorted(_acc)
        return {
            "age": _ages,
            "merchantsPct": [round(_acc[a]["m"] / _acc[a]["dm"] * 100, 2) if _acc[a]["dm"] else None for a in _ages],
            "revenuePct":   [round(_acc[a]["r"] / _acc[a]["dr"] * 100, 2) if _acc[a]["dr"] else None for a in _ages],
            "cohorts":      [_acc[a]["n"] for a in _ages],
            "merchants":    [int(round(_acc[a]["m"])) for a in _ages],
            "mrr":          [round(_acc[a]["r"], 2) for a in _ages],
        }

    _sub = _rc[_rc["BASIS"] == "sub"]
    _subm = _sub.groupby("COHORT")["COHORT_MERCHANTS"].max().fillna(0).to_dict()
    _subr = _sub.groupby("COHORT")["COHORT_BASE_MRR"].max().fillna(0).to_dict()
    _reg = _rc[_rc["BASIS"] == "reg"]
    _regden = {c: _regs.get(c, 0.0) for c in _reg["COHORT"].unique()}

    retention_cohorts = {
        "sub": _curve(_sub, {k: float(v) for k, v in _subm.items()},
                            {k: float(v) for k, v in _subr.items()}),
        # Revenue on the registration basis has no t0 to index against — the cohort billed
        # nothing in its sign-up month — so revenuePct here is MRR as a percentage of the
        # cohort's registrations, i.e. cents of MRR per registered merchant x 100. The page
        # relabels the axis rather than pretending it is a retention percentage.
        "reg": _curve(_reg, _regden, _regden),
        "meta": {
            "subCohorts": int(_sub["COHORT"].nunique()),
            "regCohorts": int(_reg["COHORT"].nunique()),
            "subBasis": "t0 = first paying month; denominators are the cohort's merchants and MRR in that month",
            "regBasis": "t0 = sign-up month; denominator is that month's registrations",
        },
    }
    _s12 = retention_cohorts["sub"]
    _i12 = _s12["age"].index(12) if 12 in _s12["age"] else None
    print(f"   [retcoh] sub {retention_cohorts['meta']['subCohorts']} cohorts, "
          f"reg {retention_cohorts['meta']['regCohorts']} cohorts"
          + (f", M12 merchants {_s12['merchantsPct'][_i12]}% revenue {_s12['revenuePct'][_i12]}%"
             if _i12 is not None else ""))
except Exception as _e:
    print("   [retcoh][warn] retention_cohorts.csv unavailable — the Churn tab will show the "
          "benchmark lines only and say the measured curve is missing:", _e)

# cohortTriangle carries EVERY cohort, not the last 24 that cohortCompare is trimmed to, and it
# is what the dashboard's Triangle view reads so a merchant from a 2017 cohort can be seen at all.
# ACTIVE was computed for every cohort above but only ever exported inside the 24-cohort
# compare_series, so the Triangle could show Paying back to 2015 and Active only back to 2024.
# The arrays are aligned by age index with mrr/paying, and None-padded where a cohort has no
# receipts row for that age — absence of receipts is not zero receipts.
tri = {}
for coh, g in grid.groupby("COHORT"):
    g = g.sort_values("MN")
    n = len(g)
    act_src = cohort_active_age.get(coh, [])
    act = [int(act_src[i]) if i < len(act_src) and act_src[i] is not None else None for i in range(n)]
    tri[coh] = {"mrr": [round(float(x),0) for x in g["MRR_USD"]],
                "paying": [int(x) for x in g["PAYING_CUSTOMERS"]],
                "active": act}
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
             "notes": ["MRR = monthly value of live Chargebee subscriptions at month end (active or non-renewing, unpaid invoices included), net of plan-change credits. GBP x1.34 / EUR x1.16. ARPC = MRR / paying customers.",
                       "MRR by country, ARPC by country and the cohort MRR series still use the older bottom-up method (paid invoices amortised across their billing period), so they do NOT sum to the headline MRR. The per-month mrrInvoice field carries that older figure for comparison.",
                       "Merchants deduped by email. Active = >=1 valid receipt in month (device-clock-filtered in SQL).",
                       "Latest month is partial; the snapshot month is the latest complete month."]},
    "activeMonthly": active_monthly, "monthly": monthly_out, "cohorts": cohorts_out,
    "cohortCompare": compare_series, "cohortTriangle": tri, "countries": countries_out,
    "countryRegistrationsByMonth": creg_out,
    "activeByCountryByMonth": {c: active_country_all.get(c, {}) for c in top},
    "receiptsByCountryByMonth": {c: receipts_country_all.get(c, {}) for c in top},
    "gtvByCountryByMonth": {c: gtv_country_all.get(c, {}) for c in top},
    "payingByCountryByMonth": {c: paying_country_all.get(c, {}) for c in top},
    "mrrByCountryByMonth": {c: mrr_country.get(c, {}) for c in top100},
    "arpcByCountryByMonth": {c: arpc_country.get(c, {}) for c in top100},
    "semesterCohortSplit": semester_split,
    "countryFunnel": country_funnel, "countryNames": COUNTRY_NAMES, "retention": retention,
    "mrrBridge": mrr_bridge, "retentionCohorts": retention_cohorts,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w") as f:
    f.write("// Loyverse KPI Dashboard data — auto-generated server-side. Do not edit by hand.\n")
    f.write("const KPI_DATA = "); json.dump(data, f, separators=(",", ":")); f.write(";\n")
print(f"kpi-data.js: months {len(monthly_out)} | cohorts {len(cohorts_out)} | countries {len(countries_out)} | latest {latest_cal}")
