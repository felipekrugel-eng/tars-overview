"""Build REAL daily-history.js + COUNTRY_FUNNEL (June month-to-date) from the dated CSV
snapshots in 'Daily DBs Dash Queries'. DAILY_HISTORY = global MTD series (one row/day).
COUNTRY_FUNNEL = per-country funnel for the CURRENT partial month (MTD) + prior month,
from the latest by-country exports — so the country league reflects June, not May."""
import pandas as pd, glob, re, os, json

# Paths are env-overridable so this runs both locally (sandbox defaults) and in GitHub Actions
# (run.py / the workflow set DAILY_DIR and DAILYHIST_OUT to the repo workspace).
SRC = os.environ.get("DAILY_DIR", "/sessions/youthful-dazzling-bardeen/mnt/Daily DBs Dash Queries")
OUT = os.environ.get("DAILYHIST_OUT", "/sessions/youthful-dazzling-bardeen/mnt/Unit Economics Analysis/KPI Dashboard v2 (Caio)/daily-history.js")

def ym(v): return str(v)[:7]
def fdate(p):
    m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(p)); return m.group(1) if m else None
def prev_ym(m):
    y, mo = int(m[:4]), int(m[5:7]) - 1
    if mo < 1: mo, y = 12, y - 1
    return f"{y:04d}-{mo:02d}"

mrr_files = {fdate(p): p for p in glob.glob(SRC + "/MRR QR_DB_*.csv")}
db2_files = {fdate(p): p for p in glob.glob(SRC + "/TPV and Receipts DB2_*.csv") if "49 Days" not in os.path.basename(p)}
regc_files = {fdate(p): p for p in glob.glob(SRC + "/Registrations Month x Country_*.csv")}
payc_files = {fdate(p): p for p in glob.glob(SRC + "/Paying x Country per Month_*.csv")}

# ---------------- global daily MTD history (49-day spine) ----------------
# MRR QR 49-day file = daily snapshots of the cohort/MRR table -> paying, mrr, regMTD, newPayers, arpc per day.
# "49 days 1" = global daily active/receipts series (skip Jun-18; that day comes from the normal TPV query).
SKIP_DATE = "2026-06-18"
mrr49 = sorted(glob.glob(SRC + "/MRR QR_DB 49 Days_*.csv"))[-1]

# "49 days 1" is derived from the receipts grid, the one query heavy enough to hit the
# Snowflake statement timeout on a contended warehouse (it did on 2026-08-28). run.py now
# treats that pull as DEGRADABLE and simply omits this file when it fails, so DO NOT index
# an empty glob here — that would turn a missing receipts pull back into a total loss of
# daily-history.js, which is the exact failure this is meant to prevent. Missing file =>
# active/receipts stay None for the affected days, which every consumer already handles
# (see the live-snapshot branch below, where both are None until that day's TPV file lands).
_g1files = sorted(glob.glob(SRC + "/49 days 1_*.csv"))
active_by, receipts_by = {}, {}
if _g1files:
    g1 = pd.read_csv(_g1files[-1])  # DATE,ACTIVE,RECEIPTS,GTV,AVG_TICKET (GTV/AVG_TICKET deliberately ignored)
    for _, gr in g1.iterrows():
        dd = str(gr["DATE"])[:10]
        if dd == SKIP_DATE: continue
        active_by[dd] = int(pd.to_numeric(gr["ACTIVE"], errors="coerce") or 0)
        receipts_by[dd] = int(pd.to_numeric(gr["RECEIPTS"], errors="coerce") or 0)
else:
    print("[backfill] WARNING — no '49 days 1' CSV (receipts pull degraded); "
          "active/receipts left blank, every other series unaffected", flush=True)

m49 = pd.read_csv(mrr49, usecols=["SNAPSHOT_DATE","COHORT_MONTH","REGISTRATIONS","MONTH_START",
    "PAYING_CUSTOMERS","CUM_PAYING_EVER","MRR_USD"])
for c in ["REGISTRATIONS","PAYING_CUSTOMERS","CUM_PAYING_EVER","MRR_USD"]:
    m49[c] = pd.to_numeric(m49[c], errors="coerce").fillna(0)
m49["d"]   = m49["SNAPSHOT_DATE"].map(lambda x: str(x)[:10])
m49["COH"] = m49["COHORT_MONTH"].map(ym)
m49["CAL"] = m49["MONTH_START"].map(ym)

rows = []
for d, df in m49.groupby("d"):
    monthly = df.groupby("CAL").agg(paying=("PAYING_CUSTOMERS","sum"),mrr=("MRR_USD","sum"),cum=("CUM_PAYING_EVER","sum")).sort_index()
    reg_by_month = df.groupby("COH")["REGISTRATIONS"].max()
    cur = monthly.index[-1]; prevc = monthly.index[-2]
    paying = int(monthly.loc[cur,"paying"]); mrr = float(monthly.loc[cur,"mrr"])
    regMTD = int(reg_by_month.get(cur,0)); newPayersMTD = int(max(0, monthly.loc[cur,"cum"] - monthly.loc[prevc,"cum"]))
    arpc = round(mrr/paying,2) if paying else 0
    if d == SKIP_DATE and d in db2_files:   # Jun-18 active/receipts from the normal query, per instruction
        a = pd.read_csv(db2_files[d], usecols=["CALENDAR_MONTH","ACTIVE_MERCHANTS","RECEIPT_COUNT"])
        a["CAL"] = a["CALENDAR_MONTH"].map(ym)
        for c in ["ACTIVE_MERCHANTS","RECEIPT_COUNT"]: a[c] = pd.to_numeric(a[c],errors="coerce").fillna(0)
        cm = a[a["CAL"]==cur]; active = int(cm["ACTIVE_MERCHANTS"].sum()); receipts = int(cm["RECEIPT_COUNT"].sum())
    else:
        active = active_by.get(d); receipts = receipts_by.get(d)
    rows.append({"date":d,"month":cur,"regMTD":regMTD,"paying":paying,"mrr":round(mrr,2),
                 "newPayersMTD":newPayersMTD,"arpc":arpc,"active":active,"gtv":None,"receipts":receipts,"avgTicket":None})

# extend the 49-day spine with newer LIVE daily snapshots (ongoing days beyond the 49-day pull, e.g. today)
covered = {r["date"] for r in rows}
last49 = max(covered) if covered else ""
for d in sorted(mrr_files):
    if d <= last49 or d in covered: continue
    dfn = pd.read_csv(mrr_files[d], usecols=["COHORT_MONTH","REGISTRATIONS","MONTH_START","PAYING_CUSTOMERS","CUM_PAYING_EVER","MRR_USD"])
    for c in ["REGISTRATIONS","PAYING_CUSTOMERS","CUM_PAYING_EVER","MRR_USD"]:
        dfn[c]=pd.to_numeric(dfn[c],errors="coerce").fillna(0)
    dfn["COH"]=dfn["COHORT_MONTH"].map(ym); dfn["CAL"]=dfn["MONTH_START"].map(ym)
    mo=dfn.groupby("CAL").agg(paying=("PAYING_CUSTOMERS","sum"),mrr=("MRR_USD","sum"),cum=("CUM_PAYING_EVER","sum")).sort_index()
    rbm=dfn.groupby("COH")["REGISTRATIONS"].max()
    cur=mo.index[-1]; prevc=mo.index[-2]
    paying=int(mo.loc[cur,"paying"]); mrr=float(mo.loc[cur,"mrr"])
    regMTD=int(rbm.get(cur,0)); newPayersMTD=int(max(0,mo.loc[cur,"cum"]-mo.loc[prevc,"cum"]))
    arpc=round(mrr/paying,2) if paying else 0
    active=receipts=None
    if d in db2_files:   # active/receipts only once the TPV query for that day is saved
        a=pd.read_csv(db2_files[d],usecols=["CALENDAR_MONTH","ACTIVE_MERCHANTS","RECEIPT_COUNT"]); a["CAL"]=a["CALENDAR_MONTH"].map(ym)
        for c in ["ACTIVE_MERCHANTS","RECEIPT_COUNT"]: a[c]=pd.to_numeric(a[c],errors="coerce").fillna(0)
        cm=a[a["CAL"]==cur]; active=int(cm["ACTIVE_MERCHANTS"].sum()); receipts=int(cm["RECEIPT_COUNT"].sum())
    rows.append({"date":d,"month":cur,"regMTD":regMTD,"paying":paying,"mrr":round(mrr,2),
                 "newPayersMTD":newPayersMTD,"arpc":arpc,"active":active,"gtv":None,"receipts":receipts,"avgTicket":None})
rows.sort(key=lambda r: r["date"])

for i,r in enumerate(rows):
    p = rows[i-1] if i>0 else None
    if p and p["month"]==r["month"]:
        r["newReg"]=max(0,r["regMTD"]-p["regMTD"]); r["newPayers"]=max(0,r["newPayersMTD"]-p["newPayersMTD"])
    else: r["newReg"]=None; r["newPayers"]=None

# rolling/point-in-time series from the dedicated query (its own daily series, ends on the last complete day):
#   REG_30D / ACTIVE_30D = trailing-30-day distinct counts; PAYING_ACTIVE = active paid subscriptions as of the day.
roll_files = sorted(glob.glob(SRC + "/Rolling 30 Days_*.csv"))
roll = {}
if roll_files:
    rr = pd.read_csv(roll_files[-1])
    cols = set(rr.columns)
    def gv(x, col):
        return int(pd.to_numeric(x.get(col), errors="coerce") or 0) if col in cols else None
    pay_col = "PAYING_ACTIVE" if "PAYING_ACTIVE" in cols else "PAYING_30D"
    for _, x in rr.iterrows():
        dd = str(x["SNAPSHOT_DATE"])[:10]
        roll[dd] = {"reg30d": gv(x, "REG_30D"), "active30d": gv(x, "ACTIVE_30D"), "payingActive": gv(x, pay_col)}
for r in rows:
    v = roll.get(r["date"]) or {}
    r["reg30d"] = v.get("reg30d")
    r["active30d"] = v.get("active30d")
    r["payingActive"] = v.get("payingActive")

# ---------------- country funnel: current (MTD) + prior month ----------------
# db2 (TPV and Receipts) is the receipts-derived file and may be absent — see the note above.
# Anchor the funnel's as-of day on the files that are always produced, and fall back to the
# three-way intersection only to keep the historical behaviour when db2 IS present.
_lds = sorted(set(regc_files) & set(payc_files) & set(db2_files)) \
       or sorted(set(regc_files) & set(payc_files))
ld = _lds[-1]
rc = pd.read_csv(regc_files[ld], usecols=["COUNTRY","CALENDAR_MONTH","REGISTRATIONS"])
rc["M"]=rc["CALENDAR_MONTH"].map(ym); rc["REGISTRATIONS"]=pd.to_numeric(rc["REGISTRATIONS"],errors="coerce").fillna(0)
CUR = rc["M"].max(); PREV = prev_ym(CUR)
def col_map(df, valcol, month): return dict(zip(df.loc[df["M"]==month,"COUNTRY"], df.loc[df["M"]==month,valcol]))
regC, regP = col_map(rc,"REGISTRATIONS",CUR), col_map(rc,"REGISTRATIONS",PREV)
pc = pd.read_csv(payc_files[ld], usecols=["COUNTRY","CALENDAR_MONTH","ACTIVE_PAYING_CUSTOMERS"])
pc["M"]=pc["CALENDAR_MONTH"].map(ym); pc["ACTIVE_PAYING_CUSTOMERS"]=pd.to_numeric(pc["ACTIVE_PAYING_CUSTOMERS"],errors="coerce").fillna(0)
payC, payP = col_map(pc,"ACTIVE_PAYING_CUSTOMERS",CUR), col_map(pc,"ACTIVE_PAYING_CUSTOMERS",PREV)
actC, actP, rcpC, rcpP = {}, {}, {}, {}
if ld in db2_files:
    db = pd.read_csv(db2_files[ld], usecols=["COUNTRY","CALENDAR_MONTH","ACTIVE_MERCHANTS","RECEIPT_COUNT"])
    db["M"]=db["CALENDAR_MONTH"].map(ym)
    for c in ["ACTIVE_MERCHANTS","RECEIPT_COUNT"]: db[c]=pd.to_numeric(db[c],errors="coerce").fillna(0)
    actC=db[db["M"]==CUR].groupby("COUNTRY")["ACTIVE_MERCHANTS"].sum().to_dict()
    actP=db[db["M"]==PREV].groupby("COUNTRY")["ACTIVE_MERCHANTS"].sum().to_dict()
    rcpC=db[db["M"]==CUR].groupby("COUNTRY")["RECEIPT_COUNT"].sum().to_dict()
    rcpP=db[db["M"]==PREV].groupby("COUNTRY")["RECEIPT_COUNT"].sum().to_dict()
else:
    # Receipts pull degraded: the funnel keeps registrations + paying (its two ranking
    # columns) and reports zero active/receipts, rather than not being built at all.
    print("[backfill] WARNING — no TPV/Receipts CSV for " + ld +
          "; country funnel active/receipts columns are zero this run", flush=True)

# previous-month registrations to the SAME day-of-month (fair momentum vs prior month-to-date, not full month)
from datetime import date as _date
regPmtd = {}
reg49 = sorted(glob.glob(SRC + "/Registration Month x Country_49 Days_*.csv"))
if reg49:
    r49 = pd.read_csv(reg49[-1], usecols=["SNAPSHOT_DATE","COUNTRY","CALENDAR_MONTH","REGISTRATIONS"])
    r49["snap"] = r49["SNAPSHOT_DATE"].map(lambda x: str(x)[:10]); r49["M"] = r49["CALENDAR_MONTH"].map(ym)
    dom = _date.fromisoformat(ld).day; target = f"{PREV}-{dom:02d}"
    prev_snaps = sorted(s for s in r49["snap"].unique() if s[:7] == PREV)
    if prev_snaps:
        psnap = max([s for s in prev_snaps if s <= target] or [prev_snaps[-1]])
        sub = r49[(r49["snap"] == psnap) & (r49["M"] == PREV)]
        regPmtd = dict(zip(sub["COUNTRY"], pd.to_numeric(sub["REGISTRATIONS"], errors="coerce").fillna(0)))

codes = sorted(c for c in (set(regC)|set(actC)|set(payC)) if isinstance(c,str) and len(c)==2)
def gi(d,c): return int(d.get(c,0) or 0)
cf_rows=[{"c":c,"reg":gi(regC,c),"active":gi(actC,c),"paying":gi(payC,c),"receipts":gi(rcpC,c),
          "regP":gi(regP,c),"activeP":gi(actP,c),"payingP":gi(payP,c),"receiptsP":gi(rcpP,c),
          "regPmtd":gi(regPmtd,c)} for c in codes]
country_funnel={"current":CUR,"previous":PREV,"asOf":ld,"rows":cf_rows}

# ---------------- per-country daily MTD history (for the FACADASH country filter) ----------------
# Same daily series as DAILY_HISTORY, but keyed by country. Sources (all "49-day" by-country files):
#   registrations -> Registration Month x Country_49 Days   (SNAPSHOT_DATE,COUNTRY,CALENDAR_MONTH,REGISTRATIONS)
#   active/receipts-> 49 days by country                     (DATE,COUNTRY,ACTIVE,RECEIPTS)
#   paying        -> Paying by country 49 Days               (DATE,COUNTRY,PAYING)
# MRR/ARPC per country are NOT daily; the front-end reads those from kpi-data.js (monthly bottom-up).
_bycountry = {}   # code -> { date -> row }
def _bcrow(code, d):
    return _bycountry.setdefault(code, {}).setdefault(
        d, {"date": d, "month": d[:7], "regMTD": None, "paying": None, "active": None, "receipts": None})

_regbc = sorted(glob.glob(SRC + "/Registration Month x Country_49 Days_*.csv"))
if _regbc:
    _rr = pd.read_csv(_regbc[-1], usecols=["SNAPSHOT_DATE","COUNTRY","CALENDAR_MONTH","REGISTRATIONS"])
    _rr["snap"] = _rr["SNAPSHOT_DATE"].map(lambda x: str(x)[:10])
    _rr["cm"]   = _rr["CALENDAR_MONTH"].map(ym)
    _rr["REGISTRATIONS"] = pd.to_numeric(_rr["REGISTRATIONS"], errors="coerce").fillna(0)
    _cur = _rr[_rr["cm"] == _rr["snap"].str[:7]]   # current-month rows only -> regMTD per day
    for _, x in _cur.iterrows():
        _bcrow(str(x["COUNTRY"]), x["snap"])["regMTD"] = int(x["REGISTRATIONS"])

_arbc = sorted(glob.glob(SRC + "/49 days by country_*.csv"))
if _arbc:
    _ar = pd.read_csv(_arbc[-1])
    for _, x in _ar.iterrows():
        d = str(x["DATE"])[:10]
        if d == SKIP_DATE: continue
        r = _bcrow(str(x["COUNTRY"]), d)
        r["active"]   = int(pd.to_numeric(x["ACTIVE"],   errors="coerce") or 0)
        r["receipts"] = int(pd.to_numeric(x["RECEIPTS"], errors="coerce") or 0)

_pybc = sorted(glob.glob(SRC + "/Paying by country 49 Days_*.csv"))
if _pybc:
    _py = pd.read_csv(_pybc[-1])
    for _, x in _py.iterrows():
        _bcrow(str(x["COUNTRY"]), str(x["DATE"])[:10])["paying"] = int(pd.to_numeric(x["PAYING"], errors="coerce") or 0)

# per-country rolling / point-in-time series (same three metrics as the global series,
# from rolling_30d_by_country_49days.sql). OPTIONAL: the file is written by a guarded step
# in run.py, so if that query fails these keys stay absent and the dashboard falls back to
# its "trailing-30-day series is global only" note instead of drawing an empty chart.
_rollbc = sorted(glob.glob(SRC + "/Rolling 30 Days by Country_*.csv"))
if _rollbc:
    _rb = pd.read_csv(_rollbc[-1])
    _rcols = set(_rb.columns)
    _rpay = "PAYING_ACTIVE" if "PAYING_ACTIVE" in _rcols else "PAYING_30D"
    def _rgv(x, col):
        # NOTE: float('nan') is truthy, so `... or 0` would pass nan into int() and raise.
        # This module runs unguarded under check=True, so that would kill the whole pull.
        if col not in _rcols: return None
        v = pd.to_numeric(x.get(col), errors="coerce")
        return None if pd.isna(v) else int(v)
    for _, x in _rb.iterrows():
        # No SKIP_DATE here: that guard exists for the bad "49 days 1" active/receipts
        # export, not for this query. The global rolling loader doesn't skip it either,
        # and skipping would leave per-country lines with a hole the global line lacks.
        _d = str(x["SNAPSHOT_DATE"])[:10]
        r = _bcrow(str(x["COUNTRY"]), _d)
        r["reg30d"]       = _rgv(x, "REG_30D")
        r["active30d"]    = _rgv(x, "ACTIVE_30D")
        r["payingActive"] = _rgv(x, _rpay)
    print(f"[bycountry] rolling fields attached from {_rollbc[-1].split('/')[-1]} ({len(_rb)} rows)", flush=True)
else:
    print("[bycountry] no per-country rolling CSV found — rolling views stay global-only", flush=True)

DAILY_HISTORY_BY_COUNTRY = {}
for code, dd in _bycountry.items():
    if not (isinstance(code, str) and len(code) == 2): continue
    lst = [dd[k] for k in sorted(dd)]
    for i, r in enumerate(lst):
        p = lst[i-1] if i > 0 else None
        r["newReg"] = (max(0, r["regMTD"] - p["regMTD"])
                       if (p and p["month"] == r["month"] and r["regMTD"] is not None and p["regMTD"] is not None)
                       else None)
    DAILY_HISTORY_BY_COUNTRY[code] = lst

with open(OUT,"w") as f:
    f.write("// Loyverse daily KPI history — REAL, from dated CSV snapshots in 'Daily DBs Dash Queries'.\n")
    f.write("const DAILY_SAMPLE = false;\n")
    f.write("const DAILY_HISTORY = "); json.dump(rows,f,separators=(",",":")); f.write(";\n")
    f.write("const COUNTRY_FUNNEL = "); json.dump(country_funnel,f,separators=(",",":")); f.write(";\n")
    f.write("const DAILY_HISTORY_BY_COUNTRY = "); json.dump(DAILY_HISTORY_BY_COUNTRY,f,separators=(",",":")); f.write(";\n")
print(f"daily rows {len(rows)} | COUNTRY_FUNNEL {len(cf_rows)} countries, current {CUR} (as of {ld}) vs {PREV}")
print(f"per-country daily: {len(DAILY_HISTORY_BY_COUNTRY)} countries")
print("sample:", json.dumps(cf_rows[0]))
