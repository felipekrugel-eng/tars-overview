#!/usr/bin/env python3
"""
build_pilot_data.py — pilot-data.js for the FACADASH pilot tracker page.

Reads the CSV produced by sql/pilot_history_adoption_daily.sql and emits
pilot-data.js consumed by pilot.html.

Env:
  PILOT_CSV    input CSV (written by run.py)
  PILOTDATA_OUT  output path, default: "KPI Dashboard v2 (Caio)/pilot-data.js"

No new dependencies — pandas only, same as build_kpi_data.py. The Poisson
maths is done longhand below rather than pulling in scipy.

WHAT THIS COMPUTES, AND THE ONE TRAP IT AVOIDS
----------------------------------------------
The pilot cut free sales history from 30 to 15 days on 2026-07-16 in
AU/BE/CO/ID/IN/NG/SG. Adoption runs through a 14-day trial, so a merchant
who hit the new wall on 16 Jul bills no earlier than 30 Jul.

Rows dated 16-29 Jul therefore came from trials that STARTED under the old
rule. They look post-launch and are not. They are bucketed LAUNCH_LAG and
excluded from the verdict — folding them in is the single easiest way to
get this analysis wrong, in either direction.

The verdict compares SIGNAL (30 Jul onward) against BASELINE, with the
control markets supplying the seasonal correction:

    DiD = (pilot signal/day  / pilot baseline/day)
        / (control signal/day / control baseline/day)

DiD > 1 means pilot markets accelerated by more than the controls did.
Significance is a Poisson test on the pilot SIGNAL count against the
expectation implied by its own baseline scaled by the control's movement.
"""
import os, json, math, pathlib, datetime
import pandas as pd

CSV = pathlib.Path(os.environ["PILOT_CSV"])
OUT = pathlib.Path(os.environ.get(
    "PILOTDATA_OUT", "KPI Dashboard v2 (Caio)/pilot-data.js"))

LAUNCH = datetime.date(2026, 7, 16)
SIGNAL = datetime.date(2026, 7, 30)
PILOT_COUNTRIES = ["AU", "BE", "CO", "ID", "IN", "NG", "SG"]

# Signal days needed to CONFIRM a 25% effect at the pilot's ~3.6 adoptions/day baseline
# (Poisson power calc; the page has quoted this as prose since the tracker was built).
# Kept here so the projected date and the copy can never drift apart.
CONFIRM_DAYS = 37

# ---------- Poisson helpers (avoid a scipy dependency) ----------

def _pmf(k, lam):
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(k * math.log(lam) - lam - math.lgamma(k + 1))

def poisson_cdf(k, lam):
    """P(X <= k). Exact sum; k here is at most a few hundred."""
    if lam <= 0:
        return 1.0
    return min(1.0, sum(_pmf(i, lam) for i in range(int(k) + 1)))

def poisson_sf(k, lam):
    """P(X >= k)."""
    if k <= 0:
        return 1.0
    return max(0.0, 1.0 - poisson_cdf(int(k) - 1, lam))

def poisson_p(obs, exp):
    """One-sided p in the observed direction."""
    if exp <= 0:
        return None
    return poisson_sf(obs, exp) if obs > exp else poisson_cdf(obs, exp)

def poisson_interval95(lam):
    """Central 95% range under the null."""
    if lam <= 0:
        return [0, 0]
    lo = 0
    while poisson_cdf(lo, lam) < 0.025:
        lo += 1
    hi = max(1, int(lam))
    while poisson_cdf(hi, lam) < 0.975:
        hi += 1
    return [lo, hi]

# ---------- load ----------

df = pd.read_csv(CSV)
df.columns = [c.upper() for c in df.columns]
df["ADOPTION_DATE"] = pd.to_datetime(df["ADOPTION_DATE"]).dt.date
df["ADOPTERS"] = df["ADOPTERS"].fillna(0).astype(int)

if df.empty:
    raise SystemExit("PILOT_CSV is empty — refusing to write pilot-data.js")

last_date = max(df.ADOPTION_DATE)

# Elapsed days per period. Anchored to real calendar boundaries rather than
# observed min/max, so a day with zero adopters still counts as a day —
# otherwise sparse early SIGNAL days inflate the rate.
first_date = min(df.ADOPTION_DATE)
days = {
    "BASELINE":   (min(LAUNCH, last_date + datetime.timedelta(days=1)) - first_date).days,
    "LAUNCH_LAG": max(0, (min(SIGNAL, last_date + datetime.timedelta(days=1)) - LAUNCH).days),
    "SIGNAL":     max(0, (last_date + datetime.timedelta(days=1) - SIGNAL).days),
}

# ---------- projected readability dates ----------
# The tracker is gated on SIGNAL DAYS, but a reader wants a calendar date. Signal days only
# advance as data lands, and Chargebee ingestion runs 1-2 days behind, so the date a threshold
# is reached is the signal day PLUS the observed lag — not today plus the shortfall. Measuring
# the lag from the data itself keeps the projection honest if ingestion speeds up or slows down.
DATA_LAG_DAYS = max(0, (datetime.date.today() - last_date).days)

def _eta(need):
    """Calendar date the Nth signal day should be visible on the page."""
    shortfall = need - days["SIGNAL"]
    if shortfall <= 0:
        return None                      # already there
    return (datetime.date.today() + datetime.timedelta(days=shortfall)).isoformat()

def total(period, cohort, atype):
    m = df[(df.PERIOD == period) & (df.COHORT == cohort) & (df.ADOPTION_TYPE == atype)]
    return int(m.ADOPTERS.sum())

def rate(period, cohort, atype):
    d = days.get(period, 0)
    return (total(period, cohort, atype) / d) if d else None

# ---------- verdict ----------

verdict = {}
for atype in ["NEW_PAYER", "UPSELL"]:
    pb, cb = rate("BASELINE", "PILOT", atype), rate("BASELINE", "CONTROL", atype)
    ps, cs = rate("SIGNAL", "PILOT", atype),   rate("SIGNAL", "CONTROL", atype)
    entry = {
        "baselinePilotPerDay": pb, "baselineControlPerDay": cb,
        "signalPilotPerDay": ps,   "signalControlPerDay": cs,
        "signalDays": days["SIGNAL"],
        "pilotSignalCount": total("SIGNAL", "PILOT", atype),
        "did": None, "expected": None, "p": None, "null95": None,
        "readable": False,
    }
    if days["SIGNAL"] > 0 and pb and cb and cs is not None:
        control_move = (cs / cb) if cb else None
        if control_move:
            entry["controlMove"] = control_move
            entry["did"] = (ps / pb) / control_move if pb else None
            exp = pb * control_move * days["SIGNAL"]
            entry["expected"] = exp
            entry["p"] = poisson_p(entry["pilotSignalCount"], exp)
            entry["null95"] = poisson_interval95(exp)
            # An upsell verdict needs a full billing month: upsells only
            # surface when an existing subscription renews, so a short
            # window samples only merchants whose renewal date lands in it.
            need = 28 if atype == "UPSELL" else 7
            entry["readable"] = days["SIGNAL"] >= need
            entry["daysNeeded"] = need
            entry["readableEta"] = _eta(need)
            if atype == "NEW_PAYER":
                entry["confirmDays"] = CONFIRM_DAYS
                entry["confirmEta"] = _eta(CONFIRM_DAYS)
    verdict[atype] = entry

# ---------- daily series (for the chart) ----------

series = {}
for cohort in ["PILOT", "CONTROL"]:
    for atype in ["NEW_PAYER", "UPSELL"]:
        s = (df[(df.COHORT == cohort) & (df.ADOPTION_TYPE == atype)]
             .groupby("ADOPTION_DATE", as_index=False).ADOPTERS.sum()
             .sort_values("ADOPTION_DATE"))
        series[f"{cohort}_{atype}"] = [
            {"d": r.ADOPTION_DATE.isoformat(), "n": int(r.ADOPTERS)}
            for r in s.itertuples()
        ]

# ---------- per country ----------

countries = []
for c in PILOT_COUNTRIES:
    sub = df[df.COUNTRY == c]
    base = sub.UPSELL_BASE_COUNTRY.dropna()
    row = {"country": c, "upsellBase": int(base.max()) if len(base) else None}
    for period in ["BASELINE", "LAUNCH_LAG", "SIGNAL"]:
        for atype in ["NEW_PAYER", "UPSELL"]:
            n = int(sub[(sub.PERIOD == period) & (sub.ADOPTION_TYPE == atype)].ADOPTERS.sum())
            d = days.get(period, 0)
            row[f"{period}_{atype}"] = n
            row[f"{period}_{atype}_perDay"] = (n / d) if d else None
    countries.append(row)

# ---------- write ----------

payload = {
    "meta": {
        "generatedAt": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "launchDate": LAUNCH.isoformat(),
        "signalDate": SIGNAL.isoformat(),
        "lastDataDate": last_date.isoformat(),
        "dataLagDays": DATA_LAG_DAYS,
        "pilotCountries": PILOT_COUNTRIES,
        "days": days,
        "source": "Chargebee invoice line items, SKU family S_SALESHISTORY%",
        "notes": [
            "Free sales history cut 30d -> 15d on 2026-07-16 in the 7 pilot markets.",
            "Adoption runs through a 14-day trial, so the first genuinely treated "
            "merchant bills 2026-07-30. Rows dated 16-29 Jul came from trials started "
            "under the old rule and are bucketed LAUNCH_LAG, excluded from the verdict.",
            "Trial STARTS are not measurable: Chargebee TRIAL_START is populated on 1 "
            "subscription row in 186,105. Merchants who hit the wall and walked away "
            "are invisible.",
            "Upsells only appear when an existing subscription renews, so that channel "
            "needs a full billing month before its numbers mean anything.",
        ],
    },
    "verdict": verdict,
    "series": series,
    "countries": countries,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    "// Loyverse pilot tracker data — auto-generated server-side. Do not edit by hand.\n"
    "const PILOT_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n"
)
print(f" -> {OUT.name} (signal days: {days['SIGNAL']}, "
      f"pilot new-payer signal: {verdict['NEW_PAYER']['pilotSignalCount']})", flush=True)

# ---------- plain-text status file ----------
# The daily Cowork check reads this, not pilot-data.js: WebFetch returns empty
# for .js files, so a machine-readable .md is the only reliable transport.
# Keep the STATE line stable — the checker diffs on it to decide whether to
# speak up at all.
np = verdict["NEW_PAYER"]
if days["SIGNAL"] <= 0:
    state = "NO_SIGNAL_YET"
elif not np["readable"]:
    state = "TOO_EARLY"
elif np["p"] is not None and np["p"] < 0.05:
    state = "EFFECT_UP" if (np["did"] or 0) > 1 else "EFFECT_DOWN"
else:
    state = "NO_EFFECT"

def _r(x, n=3):
    return "null" if x is None else round(x, n)

status = f"""# Sales-history pricing pilot — status

STATE: {state}
GENERATED: {payload['meta']['generatedAt']}
LAST_DATA_DATE: {last_date.isoformat()}
SIGNAL_DAYS: {days['SIGNAL']}
SIGNAL_DAYS_NEEDED: {np.get('daysNeeded', 7)}
SIGNAL_DAYS_READABLE_ETA: {np.get('readableEta') or 'reached'}
SIGNAL_DAYS_CONFIRM: {np.get('confirmDays', CONFIRM_DAYS)}
SIGNAL_DAYS_CONFIRM_ETA: {np.get('confirmEta') or 'reached'}
DATA_LAG_DAYS: {DATA_LAG_DAYS}

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: {_r(np['baselinePilotPerDay'])}
SIGNAL_PILOT_PER_DAY: {_r(np['signalPilotPerDay'])}
BASELINE_CONTROL_PER_DAY: {_r(np['baselineControlPerDay'])}
SIGNAL_CONTROL_PER_DAY: {_r(np['signalControlPerDay'])}
DID: {_r(np['did'])}
PILOT_SIGNAL_COUNT: {np['pilotSignalCount']}
EXPECTED: {_r(np['expected'], 1)}
NULL95: {np['null95']}
P_VALUE: {_r(np['p'], 4)}
READABLE: {np['readable']}

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: {_r(verdict['UPSELL']['signalPilotPerDay'])}
DID: {_r(verdict['UPSELL']['did'])}
READABLE: {verdict['UPSELL']['readable']}

## Reading this
Launch was {LAUNCH.isoformat()}; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills {SIGNAL.isoformat()}. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
"""
STATUS_OUT = OUT.parent / "pilot-status.md"
STATUS_OUT.write_text(status)
print(f" -> {STATUS_OUT.name} (STATE: {state})", flush=True)
