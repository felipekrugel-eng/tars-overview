#!/usr/bin/env python3
"""
build_pilot_data.py — pilot-data.js for the FACADASH pilot tracker page.

Reads the CSV produced by sql/pilot_history_adoption_daily.sql and emits
pilot-data.js consumed by pilot.html.

Env:
  PILOT_CSV      input CSV (written by run.py or pilot_run.py)
  PILOTDATA_OUT  output path, default: "KPI Dashboard v2 (Caio)/pilot-data.js"

No new dependencies — pandas only, same as build_kpi_data.py. The Poisson
maths is done longhand below rather than pulling in scipy.


WHAT THIS COMPUTES, AND THE TWO TRAPS IT AVOIDS
-----------------------------------------------
The pilot shipped TWO changes together on 2026-07-16 in AU/BE/CO/ID/IN/NG/SG:
free sales history cut from 30 to 15 days, AND the add-on price raised from
$5 to $9. Nothing in this data separates them. The pilot is one combined
treatment and must be judged as one.

TRAP 1 — the 14-day trial lag.
Adoption runs through a 14-day trial, so a merchant who hit the new wall on
16 Jul bills no earlier than 30 Jul. Rows dated 16-29 Jul came from trials that
STARTED under the old rules. They look post-launch and are not. They are
bucketed LAUNCH_LAG and excluded from the verdict — folding them in is the
easiest way to get this analysis wrong, in either direction.

TRAP 2 — judging a price rise on adoption count.
A +80% price against a -24% adoption drop is a large revenue GAIN, but a page
showing only adopter count reads as failure. So the verdict is computed twice:
once on adopters (the behavioural question) and once on revenue (the business
question), and the page leads with revenue. The break-even is fixed arithmetic:
adoption can fall 1 - 5/9 = 44.4% before revenue is worse off.

The verdict compares SIGNAL (30 Jul onward) against BASELINE, with the control
markets supplying the seasonal correction:

    DiD = (pilot signal/day  / pilot baseline/day)
        / (control signal/day / control baseline/day)

DiD > 1 means pilot markets accelerated by more than the controls did.
Significance is a Poisson test on the pilot SIGNAL count against the
expectation implied by its own baseline scaled by the control's movement.

The control cohort keeps the $5 price, which is what makes it a valid
comparison for adoption. If the price ever rises globally this DiD becomes
invalid — that is the assumption to check first if the page starts lying.
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

# List price each side of the change, monthly USD. Used for the break-even arithmetic,
# for the counterfactual (which is priced at the OLD price by definition), and as the
# fallback if the CSV predates the AMOUNT column. Actual revenue comes from invoice
# amounts wherever they are available.
PRICE_BEFORE = 5.0
PRICE_AFTER = 9.0
PRICE_CHANGE_DATE = LAUNCH          # same date, same 7 markets as the paywall cut

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

# AMOUNT arrived with the revenue rewrite of the SQL. If an older CSV is handed in,
# fall back to list price so the page still renders — flagged as modelled so it says
# so on screen rather than quietly presenting an assumption as a measurement.
HAVE_AMOUNT = "AMOUNT" in df.columns
if HAVE_AMOUNT:
    df["AMOUNT"] = pd.to_numeric(df["AMOUNT"], errors="coerce").fillna(0.0)
else:
    df["AMOUNT"] = df.apply(
        lambda r: r.ADOPTERS * (PRICE_AFTER if r.ADOPTION_DATE >= PRICE_CHANGE_DATE
                                else PRICE_BEFORE), axis=1)

# Annual SKUs are a different revenue shape ($54/yr vs $9/mo) and would distort a
# monthly unit-price check. Kept in the adopter counts, excluded from that check.
if "IS_ANNUAL" not in df.columns:
    df["IS_ANNUAL"] = False
df["IS_ANNUAL"] = df["IS_ANNUAL"].astype(str).str.upper().isin(["TRUE", "1", "T", "YES"])

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

def _slice(period, cohort, atype):
    return df[(df.PERIOD == period) & (df.COHORT == cohort) & (df.ADOPTION_TYPE == atype)]

def total(period, cohort, atype):
    return int(_slice(period, cohort, atype).ADOPTERS.sum())

def revenue(period, cohort, atype):
    return float(_slice(period, cohort, atype).AMOUNT.sum())

def rate(period, cohort, atype):
    d = days.get(period, 0)
    return (total(period, cohort, atype) / d) if d else None

def rev_rate(period, cohort, atype):
    d = days.get(period, 0)
    return (revenue(period, cohort, atype) / d) if d else None

# ---------- observed unit price, monthly SKUs only ----------
# The point of this is to VERIFY the $5 -> $9 change against the invoices rather than
# trust the constants above. A mismatch here is the first thing to investigate if the
# revenue numbers look wrong, so it is printed at the end of every run.
def observed_unit(period, cohort):
    m = df[(df.PERIOD == period) & (df.COHORT == cohort) & (~df.IS_ANNUAL)]
    n = int(m.ADOPTERS.sum())
    return round(float(m.AMOUNT.sum()) / n, 2) if n else None

observed = {
    "pilotBaselineUnit":   observed_unit("BASELINE", "PILOT"),
    "pilotSignalUnit":     observed_unit("SIGNAL", "PILOT"),
    "controlBaselineUnit": observed_unit("BASELINE", "CONTROL"),
    "controlSignalUnit":   observed_unit("SIGNAL", "CONTROL"),
}

# ---------- verdict: adopters and revenue ----------

verdict = {}
for atype in ["NEW_PAYER", "UPSELL"]:
    pb, cb = rate("BASELINE", "PILOT", atype), rate("BASELINE", "CONTROL", atype)
    ps, cs = rate("SIGNAL", "PILOT", atype),   rate("SIGNAL", "CONTROL", atype)
    rpb, rps = rev_rate("BASELINE", "PILOT", atype), rev_rate("SIGNAL", "PILOT", atype)
    entry = {
        "baselinePilotPerDay": pb, "baselineControlPerDay": cb,
        "signalPilotPerDay": ps,   "signalControlPerDay": cs,
        "revenueBaselinePerDay": rpb, "revenueSignalPerDay": rps,
        "signalDays": days["SIGNAL"],
        "pilotSignalCount": total("SIGNAL", "PILOT", atype),
        "pilotSignalRevenue": round(revenue("SIGNAL", "PILOT", atype), 2),
        "did": None, "didRevenue": None, "expected": None, "p": None, "null95": None,
        "counterfactualPerDay": None, "counterfactualRevenuePerDay": None,
        "readable": False,
    }
    if days["SIGNAL"] > 0 and pb and cb and cs is not None:
        control_move = (cs / cb) if cb else None
        if control_move:
            entry["controlMove"] = control_move
            entry["did"] = (ps / pb) / control_move if pb else None
            # Counterfactual: this cohort's own baseline rate, moved by however much the
            # untreated control cohort moved, priced at the OLD price. This is the same
            # arithmetic the p-value already uses — exposed so the page can draw it.
            entry["counterfactualPerDay"] = pb * control_move
            entry["counterfactualRevenuePerDay"] = entry["counterfactualPerDay"] * PRICE_BEFORE
            # Revenue DiD compares actual revenue against that counterfactual revenue.
            # Where real amounts exist this needs no price assumption on the actual side.
            if entry["counterfactualRevenuePerDay"] and rps is not None:
                entry["didRevenue"] = rps / entry["counterfactualRevenuePerDay"]
            exp = pb * control_move * days["SIGNAL"]
            entry["expected"] = exp
            entry["p"] = poisson_p(entry["pilotSignalCount"], exp)
            entry["null95"] = poisson_interval95(exp)
            # An upsell verdict needs a full billing month: upsells only surface when an
            # existing subscription renews, so a short window samples only merchants
            # whose renewal date lands in it.
            need = 28 if atype == "UPSELL" else 7
            entry["readable"] = days["SIGNAL"] >= need
            entry["daysNeeded"] = need
            entry["readableEta"] = _eta(need)
            if atype == "NEW_PAYER":
                entry["confirmDays"] = CONFIRM_DAYS
                entry["confirmEta"] = _eta(CONFIRM_DAYS)
    verdict[atype] = entry

# ---------- daily series (for the detail chart) ----------

series = {}
for cohort in ["PILOT", "CONTROL"]:
    for atype in ["NEW_PAYER", "UPSELL"]:
        s = (df[(df.COHORT == cohort) & (df.ADOPTION_TYPE == atype)]
             .groupby("ADOPTION_DATE", as_index=False)
             .agg(ADOPTERS=("ADOPTERS", "sum"), AMOUNT=("AMOUNT", "sum"))
             .sort_values("ADOPTION_DATE"))
        series[f"{cohort}_{atype}"] = [
            {"d": r.ADOPTION_DATE.isoformat(), "n": int(r.ADOPTERS),
             "r": round(float(r.AMOUNT), 2)}
            for r in s.itertuples()
        ]

# ---------- cumulative actual vs counterfactual, from the signal date ----------
# This is what the main chart draws. Straight cumulative sums, no smoothing: the
# counterfactual is a constant daily rate so its line is straight, and any divergence
# between the two is the pilot's effect rather than a smoothing artefact.

np_ = verdict["NEW_PAYER"]
pilot_daily = {r["d"]: r for r in series.get("PILOT_NEW_PAYER", [])}
cf_rate = np_.get("counterfactualPerDay") or 0.0
cf_rev_rate = np_.get("counterfactualRevenuePerDay") or 0.0

curve, cum, cum_rev, cum_cf, cum_cf_rev = [], 0, 0.0, 0.0, 0.0
day = SIGNAL
while day <= last_date:
    iso = day.isoformat()
    row = pilot_daily.get(iso)
    cum += int(row["n"]) if row else 0
    cum_rev += float(row["r"]) if row else 0.0
    cum_cf += cf_rate
    cum_cf_rev += cf_rev_rate
    curve.append({
        "d": iso,
        "actual": cum,
        "counterfactual": round(cum_cf, 2),
        "actualRevenue": round(cum_rev, 2),
        "counterfactualRevenue": round(cum_cf_rev, 2),
    })
    day += datetime.timedelta(days=1)

# ---------- per country ----------

countries = []
for c in PILOT_COUNTRIES:
    sub = df[df.COUNTRY == c]
    base = sub.UPSELL_BASE_COUNTRY.dropna() if "UPSELL_BASE_COUNTRY" in sub.columns else []
    row = {"country": c, "upsellBase": int(base.max()) if len(base) else None}
    for period in ["BASELINE", "LAUNCH_LAG", "SIGNAL"]:
        for atype in ["NEW_PAYER", "UPSELL"]:
            m = sub[(sub.PERIOD == period) & (sub.ADOPTION_TYPE == atype)]
            n = int(m.ADOPTERS.sum())
            d = days.get(period, 0)
            row[f"{period}_{atype}"] = n
            row[f"{period}_{atype}_perDay"] = (n / d) if d else None
            row[f"{period}_{atype}_revenue"] = round(float(m.AMOUNT.sum()), 2)
    countries.append(row)

# ---------- headline ----------

breakeven_drop = 1.0 - (PRICE_BEFORE / PRICE_AFTER)
last_pt = curve[-1] if curve else None
headline = {
    "signalDays": days["SIGNAL"],
    "daysNeeded": np_.get("daysNeeded", 7),
    "readable": np_.get("readable", False),
    "adoptersActual": last_pt["actual"] if last_pt else 0,
    "adoptersCounterfactual": last_pt["counterfactual"] if last_pt else 0,
    "revenueActual": last_pt["actualRevenue"] if last_pt else 0,
    "revenueCounterfactual": last_pt["counterfactualRevenue"] if last_pt else 0,
    "adoptionChange": np_.get("did"),
    "revenueChange": np_.get("didRevenue"),
    "breakevenAdoptionDrop": breakeven_drop,
    "p": np_.get("p"),
}

# ---------- write ----------

notes = [
    "Free sales history cut 30d -> 15d AND the add-on price raised $5 -> $9, both on "
    "2026-07-16, both in the same 7 markets. The two effects cannot be separated.",
    "Adoption runs through a 14-day trial, so the first genuinely treated merchant bills "
    "2026-07-30. Rows dated 16-29 Jul came from trials started under the old rules and are "
    "bucketed LAUNCH_LAG, excluded from the verdict.",
    "Trial STARTS are not measurable: Chargebee TRIAL_START is populated on 1 subscription "
    "row in 186,105. Merchants who hit the new 15-day wall and walked away are invisible — "
    "this page can only see people who paid.",
    "Upsells only appear when an existing subscription renews, so that channel needs a full "
    "billing month before its numbers mean anything.",
    "The counterfactual assumes pilot markets would have tracked the control markets. It is "
    "the best available comparison, not a controlled experiment — markets were not randomised.",
]
if not HAVE_AMOUNT:
    notes.append(
        "Revenue is MODELLED at list price ($5 before, $9 after) because this CSV has no "
        "AMOUNT column. Re-run with the current SQL to get actual invoiced amounts.")

payload = {
    "meta": {
        "schemaVersion": 2,
        "generatedAt": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "launchDate": LAUNCH.isoformat(),
        "signalDate": SIGNAL.isoformat(),
        "lastDataDate": last_date.isoformat(),
        "dataLagDays": DATA_LAG_DAYS,
        "pilotCountries": PILOT_COUNTRIES,
        "days": days,
        "source": "Chargebee invoice line items, SKU family S_SALESHISTORY%",
        "price": {
            "before": PRICE_BEFORE,
            "after": PRICE_AFTER,
            "currency": "USD",
            "changeDate": PRICE_CHANGE_DATE.isoformat(),
            "ratio": PRICE_AFTER / PRICE_BEFORE,
            "breakevenAdoptionDrop": breakeven_drop,
            "modelled": not HAVE_AMOUNT,
            "observed": observed,
            "modelNote": (
                "Revenue is the actual Chargebee invoice amount on each merchant's first "
                "sales-history line. Annual SKUs and non-USD variants are included at their "
                "invoiced value, so the totals are real money but not all monthly."
                if HAVE_AMOUNT else
                "Revenue is modelled at monthly list price ($5 -> $9); this data file predates "
                "the revenue query. Treat dollar figures as directional."
            ),
        },
        "bundledTreatment": (
            "The paywall cut (30d -> 15d free history) and the price rise ($5 -> $9) went live "
            "on the same date in the same 7 markets. They cannot be separated in this data — "
            "the pilot is one combined treatment, and should be judged as one."
        ),
        "notes": notes,
    },
    "verdict": verdict,
    "series": series,
    "curve": curve,
    "countries": countries,
    "headline": headline,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    "// Loyverse pilot tracker data (schema v2) — auto-generated server-side. Do not edit by hand.\n"
    "const PILOT_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n"
)
print(f" -> {OUT.name} (signal days: {days['SIGNAL']}, "
      f"adopters: {headline['adoptersActual']} vs "
      f"{headline['adoptersCounterfactual']:.1f} counterfactual, "
      f"revenue: {headline['revenueActual']:.0f} vs "
      f"{headline['revenueCounterfactual']:.0f})", flush=True)
if observed["pilotSignalUnit"] and observed["pilotBaselineUnit"]:
    print(f"    observed unit price, pilot: {observed['pilotBaselineUnit']} -> "
          f"{observed['pilotSignalUnit']} (expected {PRICE_BEFORE} -> {PRICE_AFTER})", flush=True)

# ---------- plain-text status file ----------
# The daily Cowork check reads this, not pilot-data.js: WebFetch returns empty
# for .js files, so a machine-readable .md is the only reliable transport.
# Keep the STATE line stable — the checker diffs on it to decide whether to
# speak up at all.
if days["SIGNAL"] <= 0:
    state = "NO_SIGNAL_YET"
elif not np_["readable"]:
    state = "TOO_EARLY"
elif np_["p"] is not None and np_["p"] < 0.05:
    state = "EFFECT_UP" if (np_["did"] or 0) > 1 else "EFFECT_DOWN"
else:
    state = "NO_EFFECT"

# Revenue direction is reported on its own line, because it and the adoption verdict can
# point opposite ways — and the business answer is the revenue one. STATE keeps its exact
# old meaning so the existing daily checker is unaffected.
rev_state = ("REVENUE_UP" if (headline["revenueChange"] or 0) > 1
             else "REVENUE_DOWN" if headline["revenueChange"] else "REVENUE_UNKNOWN")

def _r(x, n=3):
    return "null" if x is None else round(x, n)

status = f"""# Sales-history pricing pilot — status

STATE: {state}
REVENUE_STATE: {rev_state}
GENERATED: {payload['meta']['generatedAt']}
LAST_DATA_DATE: {last_date.isoformat()}
SIGNAL_DAYS: {days['SIGNAL']}
SIGNAL_DAYS_NEEDED: {np_.get('daysNeeded', 7)}
SIGNAL_DAYS_READABLE_ETA: {np_.get('readableEta') or 'reached'}
SIGNAL_DAYS_CONFIRM: {np_.get('confirmDays', CONFIRM_DAYS)}
SIGNAL_DAYS_CONFIRM_ETA: {np_.get('confirmEta') or 'reached'}
DATA_LAG_DAYS: {DATA_LAG_DAYS}

## The treatment (two changes, one date, cannot be separated)
PAYWALL: free sales history 30d -> 15d
PRICE: {PRICE_BEFORE} -> {PRICE_AFTER} USD
CHANGE_DATE: {PRICE_CHANGE_DATE.isoformat()}
BREAKEVEN_ADOPTION_DROP: {breakeven_drop:.3f}

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: {_r(np_['baselinePilotPerDay'])}
SIGNAL_PILOT_PER_DAY: {_r(np_['signalPilotPerDay'])}
BASELINE_CONTROL_PER_DAY: {_r(np_['baselineControlPerDay'])}
SIGNAL_CONTROL_PER_DAY: {_r(np_['signalControlPerDay'])}
DID: {_r(np_['did'])}
PILOT_SIGNAL_COUNT: {np_['pilotSignalCount']}
EXPECTED: {_r(np_['expected'], 1)}
NULL95: {np_['null95']}
P_VALUE: {_r(np_['p'], 4)}
READABLE: {np_['readable']}

## Revenue (the business metric)
REVENUE_SOURCE: {'actual invoice amounts' if HAVE_AMOUNT else 'MODELLED at list price'}
ACTUAL_REVENUE: {headline['revenueActual']}
COUNTERFACTUAL_REVENUE: {headline['revenueCounterfactual']}
DID_REVENUE: {_r(headline['revenueChange'])}
OBSERVED_UNIT_PILOT_BASELINE: {observed['pilotBaselineUnit']}
OBSERVED_UNIT_PILOT_SIGNAL: {observed['pilotSignalUnit']}

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: {_r(verdict['UPSELL']['signalPilotPerDay'])}
DID: {_r(verdict['UPSELL']['did'])}
READABLE: {verdict['UPSELL']['readable']}

## Reading this
Launch was {LAUNCH.isoformat()}; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills {SIGNAL.isoformat()}. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Adoption and revenue can move in opposite directions here: the price rose
{PRICE_AFTER / PRICE_BEFORE:.1f}x, so adoption can fall {breakeven_drop * 100:.0f}% before revenue is worse off.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
"""
STATUS_OUT = OUT.parent / "pilot-status.md"
STATUS_OUT.write_text(status)
print(f" -> {STATUS_OUT.name} (STATE: {state} / {rev_state})", flush=True)
