#!/usr/bin/env python3
"""
build_pilot_data.py — pilot-data.js for the FACADASH pilot tracker page.

Reads the CSV produced by sql/pilot_history_adoption_daily.sql (and optionally
sql/pilot_price_catalogue.sql) and emits pilot-data.js consumed by pilot.html.

Env:
  PILOT_CSV            input CSV (written by run.py or pilot_run.py)
  PILOT_CATALOGUE_CSV  optional; price-catalogue CSV. Omit and the page simply
                       says the catalogue was not checked this run.
  PILOTDATA_OUT        output path, default: "KPI Dashboard v2 (Caio)/pilot-data.js"

No new dependencies — pandas only, same as build_kpi_data.py. The Poisson maths
is done longhand below rather than pulling in scipy.


THE RULE THIS FILE EXISTS TO ENFORCE
------------------------------------
Never state a price the data does not show.

An earlier version hardcoded PRICE_BEFORE = 5.0 / PRICE_AFTER = 9.0 from a verbal
description of the pilot, computed a +37% revenue gain from it, and shipped that as
the page headline. The price rise had not been applied to a single pilot merchant.
Probing the catalogue on 2026-08-12 found three monthly tiers, all live since 2024:

    S_SALESHISTORY_1_USD        $5    21,158 subscriptions
    S_SALESHISTORY_1_USD_V001   $7       446
    S_SALESHISTORY_1_USD_V002   $9       126

and every new pilot-market adopter still landing on the $5 one.

So: the price is DERIVED from UNIT_AMOUNT on the invoices, the intended price is
carried separately and labelled as an unverified claim, and `changeDetected` gates
whether any price-based framing appears on the page at all.

UNIT_AMOUNT, not AMOUNT, for price. AMOUNT includes quantity (merchants on many
stores bill multiples) and mid-cycle proration (partial lines of a few cents).
Averaging AMOUNT produced a phantom "$6.39 -> $5.70 price cut" that was really
quantity and monthly/annual mix. AMOUNT is still summed, but only for revenue.


THE OTHER TWO TRAPS
-------------------
1. THE 14-DAY TRIAL LAG. A merchant who hit the new wall on 16 Jul bills no earlier
   than 30 Jul. Rows dated 16-29 Jul came from trials started under the old rules;
   they look post-launch and are not. Bucketed LAUNCH_LAG, excluded from the verdict.

2. THE COUNTERFACTUAL MUST NOT CARRY A PRICE ASSUMPTION. It is this cohort's own
   OBSERVED baseline revenue per day, moved by however much the untreated control
   cohort moved. No list price anywhere. That way the revenue comparison stays valid
   whether or not a price change ever lands.

    DiD = (pilot signal/day  / pilot baseline/day)
        / (control signal/day / control baseline/day)

Significance is a Poisson test on the pilot SIGNAL count against the expectation
implied by its own baseline scaled by the control's movement.
"""
import os, json, math, pathlib, datetime
import pandas as pd

CSV = pathlib.Path(os.environ["PILOT_CSV"])
CAT_CSV = os.environ.get("PILOT_CATALOGUE_CSV")
OUT = pathlib.Path(os.environ.get(
    "PILOTDATA_OUT", "KPI Dashboard v2 (Caio)/pilot-data.js"))

LAUNCH = datetime.date(2026, 7, 16)
SIGNAL = datetime.date(2026, 7, 30)
PILOT_COUNTRIES = ["AU", "BE", "CO", "ID", "IN", "NG", "SG"]

# Signal days needed to CONFIRM a 25% effect at the pilot's ~3.6 adoptions/day baseline
# (Poisson power calc; the page has quoted this as prose since the tracker was built).
# Kept here so the projected date and the copy can never drift apart.
CONFIRM_DAYS = 37

# What the pilot was SAID to do. This is a claim to be tested, not an input to any
# calculation — nothing below multiplies by it. It appears on the page only as
# "intended", next to what the invoices actually show.
INTENDED_PRICE_BEFORE = 5.0
INTENDED_PRICE_AFTER = 9.0
INTENDED_CURRENCY = "USD"

# A price change has to move the observed average by more than this to count as real,
# so that ordinary tier-mix wobble is not reported as a repricing.
PRICE_CHANGE_TOLERANCE = 0.02      # 2%

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

# Older CSVs predate these columns. Degrade explicitly rather than inventing values:
# every downstream consumer checks the corresponding `*Available` flag.
HAVE_AMOUNT = "AMOUNT" in df.columns
HAVE_UNIT = "UNIT_AMOUNT" in df.columns
HAVE_PLAN = "PLAN_ID" in df.columns

df["AMOUNT"] = (pd.to_numeric(df["AMOUNT"], errors="coerce").fillna(0.0)
                if HAVE_AMOUNT else 0.0)
df["UNIT_AMOUNT"] = (pd.to_numeric(df["UNIT_AMOUNT"], errors="coerce")
                     if HAVE_UNIT else None)
if not HAVE_PLAN:
    df["PLAN_ID"] = "(not returned by this query version)"
if "CURRENCY_CODE" not in df.columns:
    df["CURRENCY_CODE"] = "?"
if "IS_ANNUAL" not in df.columns:
    df["IS_ANNUAL"] = False
df["IS_ANNUAL"] = df["IS_ANNUAL"].astype(str).str.upper().isin(["TRUE", "1", "T", "YES"])

last_date = max(df.ADOPTION_DATE)

# Elapsed days per period. Anchored to real calendar boundaries rather than observed
# min/max, so a day with zero adopters still counts as a day — otherwise sparse early
# SIGNAL days inflate the rate.
first_date = min(df.ADOPTION_DATE)
days = {
    "BASELINE":   (min(LAUNCH, last_date + datetime.timedelta(days=1)) - first_date).days,
    "LAUNCH_LAG": max(0, (min(SIGNAL, last_date + datetime.timedelta(days=1)) - LAUNCH).days),
    "SIGNAL":     max(0, (last_date + datetime.timedelta(days=1) - SIGNAL).days),
}

# ---------- projected readability dates ----------
# The tracker is gated on SIGNAL DAYS, but a reader wants a calendar date. Signal days
# only advance as data lands, and Chargebee ingestion runs 1-2 days behind, so the date
# a threshold is reached is the signal day PLUS the observed lag. Measuring the lag from
# the data keeps the projection honest if ingestion speeds up or slows down.
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

# ---------- OBSERVED PRICE ----------
# Monthly SKUs in one currency only. Mixing terms compares $9/mo with $54/yr; mixing
# currencies compares dollars with rupiah. Either produces a number that moves for
# reasons that have nothing to do with price.

def price_profile(period, cohort, currency=INTENDED_CURRENCY):
    m = df[(df.PERIOD == period) & (df.COHORT == cohort) & (~df.IS_ANNUAL)
           & (df.CURRENCY_CODE == currency)]
    if not HAVE_UNIT or m.empty or m.UNIT_AMOUNT.isna().all():
        return None
    m = m[m.UNIT_AMOUNT.notna()]
    n = int(m.ADOPTERS.sum())
    if not n:
        return None
    tiers = (m.groupby(["PLAN_ID", "UNIT_AMOUNT"], as_index=False).ADOPTERS.sum()
             .sort_values(["UNIT_AMOUNT", "ADOPTERS"], ascending=[True, False]))
    modal = tiers.loc[tiers.ADOPTERS.idxmax()]
    return {
        "currency": currency,
        "adopters": n,
        # Adopter-weighted: what a merchant arriving in this window typically paid.
        "weightedAvg": round(float((m.UNIT_AMOUNT * m.ADOPTERS).sum()) / n, 4),
        "modalUnit": round(float(modal.UNIT_AMOUNT), 2),
        "modalPlan": str(modal.PLAN_ID),
        "tiers": [
            {"plan": str(r.PLAN_ID), "unit": round(float(r.UNIT_AMOUNT), 2),
             "adopters": int(r.ADOPTERS)}
            for r in tiers.itertuples()
        ],
    }

price_baseline = price_profile("BASELINE", "PILOT")
price_signal = price_profile("SIGNAL", "PILOT")
price_baseline_ctrl = price_profile("BASELINE", "CONTROL")
price_signal_ctrl = price_profile("SIGNAL", "CONTROL")

def detect_change(base, sig):
    """Did the price actually move? Returns (bool, ratio_or_None, reason)."""
    if not base or not sig:
        return False, None, "not measurable — no monthly %s adopters in one of the windows" % INTENDED_CURRENCY
    ratio = sig["weightedAvg"] / base["weightedAvg"] if base["weightedAvg"] else None
    if ratio is None:
        return False, None, "baseline price is zero"
    moved = abs(ratio - 1.0) > PRICE_CHANGE_TOLERANCE
    if not moved:
        return False, ratio, (
            "flat: merchants arriving after the change pay $%.2f on average against "
            "$%.2f before, within normal tier-mix wobble"
            % (sig["weightedAvg"], base["weightedAvg"]))
    return True, ratio, (
        "moved: $%.2f -> $%.2f (%+.0f%%)"
        % (base["weightedAvg"], sig["weightedAvg"], (ratio - 1) * 100))

price_changed, price_ratio, price_reason = detect_change(price_baseline, price_signal)

# ---------- price catalogue (optional second input) ----------
catalogue = None
intended_tier = None
if CAT_CSV and pathlib.Path(CAT_CSV).exists():
    cdf = pd.read_csv(CAT_CSV)
    cdf.columns = [c.upper() for c in cdf.columns]
    for col in ("UNIT_PRICE", "SUBSCRIPTIONS", "PILOT_SUBS", "PILOT_SUBS_SINCE_LAUNCH"):
        if col in cdf.columns:
            cdf[col] = pd.to_numeric(cdf[col], errors="coerce").fillna(0)
    catalogue = [
        {"itemPriceId": str(r.ITEM_PRICE_ID), "term": str(r.TERM),
         "currency": str(r.CURRENCY_CODE), "unitPrice": round(float(r.UNIT_PRICE), 2),
         "subscriptions": int(r.SUBSCRIPTIONS), "pilotSubs": int(r.PILOT_SUBS),
         "pilotSubsSinceLaunch": int(r.PILOT_SUBS_SINCE_LAUNCH),
         "firstAttached": str(r.FIRST_ATTACHED), "lastAttached": str(r.LAST_ATTACHED)}
        for r in cdf.itertuples()
    ]
    # The tier the pilot was supposed to move to. If it exists and no pilot merchant
    # has been attached to it since launch, that is the whole finding in one row.
    for row in catalogue:
        if (row["term"] == "MONTHLY" and row["currency"] == INTENDED_CURRENCY
                and abs(row["unitPrice"] - INTENDED_PRICE_AFTER) < 0.005):
            intended_tier = row
            break

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
            # Counterfactual: this cohort's own baseline, moved by the untreated
            # control cohort's movement. Adopters AND revenue, both observed — no
            # list price is used on either side of the comparison.
            entry["counterfactualPerDay"] = pb * control_move
            if rpb is not None:
                entry["counterfactualRevenuePerDay"] = rpb * control_move
                if entry["counterfactualRevenuePerDay"] and rps is not None:
                    entry["didRevenue"] = rps / entry["counterfactualRevenuePerDay"]
            exp = pb * control_move * days["SIGNAL"]
            entry["expected"] = exp
            entry["p"] = poisson_p(entry["pilotSignalCount"], exp)
            entry["null95"] = poisson_interval95(exp)
            # An upsell verdict needs a full billing month: upsells only surface when
            # an existing subscription renews, so a short window samples only merchants
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
# What the main chart draws. Straight cumulative sums, no smoothing: the counterfactual
# is a constant daily rate so its line is straight, and any divergence is the pilot's
# effect rather than a smoothing artefact.

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
    # Modal monthly price this market's new arrivals actually paid in the signal window.
    ms = sub[(sub.PERIOD == "SIGNAL") & (~sub.IS_ANNUAL) & (sub.UNIT_AMOUNT.notna())] \
        if HAVE_UNIT else sub.iloc[0:0]
    if len(ms) and ms.ADOPTERS.sum():
        g = ms.groupby("UNIT_AMOUNT", as_index=False).ADOPTERS.sum()
        row["signalModalUnit"] = round(float(g.loc[g.ADOPTERS.idxmax()].UNIT_AMOUNT), 2)
    else:
        row["signalModalUnit"] = None
    countries.append(row)

# ---------- headline ----------

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
    "p": np_.get("p"),
    # Gates the page: with the price flat, revenue moves only because volume and
    # monthly/annual mix moved, and the page must not imply a pricing effect.
    "priceChanged": price_changed,
}

# ---------- write ----------

notes = [
    "The pilot was described as two changes on 2026-07-16 in the same 7 markets: free "
    "sales history cut 30d -> 15d, AND the add-on price raised $5 -> $9. The paywall cut "
    "shipped. The price rise is NOT present in billing — see the price panel.",
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
    "Revenue mixes monthly and annual first invoices ($5/mo alongside $50/yr), so revenue "
    "per adopter moves with term mix as well as with price. Price is read from UNIT_AMOUNT, "
    "which carries neither quantity nor proration, and is the only field used for pricing.",
]
if not HAVE_UNIT:
    notes.append(
        "This data file predates UNIT_AMOUNT, so no price could be verified at all. "
        "Re-run the pilot pull to populate the price panel.")

payload = {
    "meta": {
        "schemaVersion": 3,
        "generatedAt": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "launchDate": LAUNCH.isoformat(),
        "signalDate": SIGNAL.isoformat(),
        "lastDataDate": last_date.isoformat(),
        "dataLagDays": DATA_LAG_DAYS,
        "pilotCountries": PILOT_COUNTRIES,
        "days": days,
        "source": "Chargebee invoice line items, SKU family S_SALESHISTORY%",
        "price": {
            # Everything under `observed` is measured. Everything under `intended` is a
            # claim about what should have happened, carried so the page can show the gap.
            "available": HAVE_UNIT,
            "currency": INTENDED_CURRENCY,
            "changeDetected": price_changed,
            "changeRatio": price_ratio,
            "changeReason": price_reason,
            "tolerance": PRICE_CHANGE_TOLERANCE,
            "observed": {
                "pilotBaseline": price_baseline,
                "pilotSignal": price_signal,
                "controlBaseline": price_baseline_ctrl,
                "controlSignal": price_signal_ctrl,
            },
            "intended": {
                "before": INTENDED_PRICE_BEFORE,
                "after": INTENDED_PRICE_AFTER,
                "currency": INTENDED_CURRENCY,
                "source": "stated by product — NOT confirmed in billing",
                "breakevenAdoptionDrop": 1.0 - (INTENDED_PRICE_BEFORE / INTENDED_PRICE_AFTER),
            },
            "catalogue": catalogue,
            "intendedTier": intended_tier,
            "catalogueNote": (
                "Catalogue is UK-site subscription items only. The EU site populates neither "
                "SUBSCRIPTION_ITEMS nor ADDONS on any of its 101,026 rows, so Belgium is not "
                "represented here — a zero means 'none on the UK site', not 'none anywhere'."
                if catalogue else
                "Price catalogue was not queried this run, so this page can say what merchants "
                "were charged but not which tiers exist."
            ),
        },
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
    "// Loyverse pilot tracker data (schema v3) — auto-generated server-side. Do not edit by hand.\n"
    "const PILOT_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n"
)
print(f" -> {OUT.name} (signal days: {days['SIGNAL']}, "
      f"adopters: {headline['adoptersActual']} vs "
      f"{headline['adoptersCounterfactual']:.1f} counterfactual)", flush=True)
print(f"    PRICE: {price_reason}", flush=True)
if intended_tier:
    print(f"    intended ${INTENDED_PRICE_AFTER:.0f} tier {intended_tier['itemPriceId']}: "
          f"{intended_tier['subscriptions']} subscriptions globally, "
          f"{intended_tier['pilotSubsSinceLaunch']} attached to pilot merchants since launch",
          flush=True)
elif catalogue:
    print(f"    no ${INTENDED_PRICE_AFTER:.0f} monthly {INTENDED_CURRENCY} tier found in the catalogue",
          flush=True)

# ---------- plain-text status file ----------
# The daily Cowork check reads this, not pilot-data.js: WebFetch returns empty for .js
# files, so a machine-readable .md is the only reliable transport. Keep the STATE line
# stable — the checker diffs on it to decide whether to speak up at all.
if days["SIGNAL"] <= 0:
    state = "NO_SIGNAL_YET"
elif not np_["readable"]:
    state = "TOO_EARLY"
elif np_["p"] is not None and np_["p"] < 0.05:
    state = "EFFECT_UP" if (np_["did"] or 0) > 1 else "EFFECT_DOWN"
else:
    state = "NO_EFFECT"

# Reported separately from STATE, which keeps its exact previous meaning. PRICE_STATE is
# the line to watch: NOT_APPLIED means the pilot is only testing half of what it intended.
if not HAVE_UNIT:
    price_state = "PRICE_UNKNOWN"
elif price_changed:
    price_state = "PRICE_APPLIED"
else:
    price_state = "PRICE_NOT_APPLIED"

def _r(x, n=3):
    return "null" if x is None else round(x, n)

def _pp(p):
    return "null" if not p else f"${p['weightedAvg']:.2f} (modal ${p['modalUnit']:.2f}, {p['adopters']} adopters)"

status = f"""# Sales-history pricing pilot — status

STATE: {state}
PRICE_STATE: {price_state}
GENERATED: {payload['meta']['generatedAt']}
LAST_DATA_DATE: {last_date.isoformat()}
SIGNAL_DAYS: {days['SIGNAL']}
SIGNAL_DAYS_NEEDED: {np_.get('daysNeeded', 7)}
SIGNAL_DAYS_READABLE_ETA: {np_.get('readableEta') or 'reached'}
SIGNAL_DAYS_CONFIRM: {np_.get('confirmDays', CONFIRM_DAYS)}
SIGNAL_DAYS_CONFIRM_ETA: {np_.get('confirmEta') or 'reached'}
DATA_LAG_DAYS: {DATA_LAG_DAYS}

## The treatment as intended vs as shipped
PAYWALL_INTENDED: free sales history 30d -> 15d
PRICE_INTENDED: {INTENDED_PRICE_BEFORE} -> {INTENDED_PRICE_AFTER} {INTENDED_CURRENCY} (stated by product, unverified)
PRICE_OBSERVED_BASELINE: {_pp(price_baseline)}
PRICE_OBSERVED_SIGNAL: {_pp(price_signal)}
PRICE_CHANGE_DETECTED: {price_changed}
PRICE_FINDING: {price_reason}
INTENDED_TIER: {intended_tier['itemPriceId'] if intended_tier else 'not found / catalogue not queried'}
INTENDED_TIER_SUBS_GLOBAL: {intended_tier['subscriptions'] if intended_tier else 'null'}
INTENDED_TIER_PILOT_SUBS_SINCE_LAUNCH: {intended_tier['pilotSubsSinceLaunch'] if intended_tier else 'null'}

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

## Revenue (observed on both sides — no list price assumed)
REVENUE_BASELINE_PER_DAY: {_r(np_['revenueBaselinePerDay'], 2)}
REVENUE_SIGNAL_PER_DAY: {_r(np_['revenueSignalPerDay'], 2)}
COUNTERFACTUAL_REVENUE_PER_DAY: {_r(np_['counterfactualRevenuePerDay'], 2)}
DID_REVENUE: {_r(np_['didRevenue'])}
NOTE: with the price flat, this moves on volume and monthly/annual mix, not pricing.

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: {_r(verdict['UPSELL']['signalPilotPerDay'])}
DID: {_r(verdict['UPSELL']['did'])}
READABLE: {verdict['UPSELL']['readable']}

## Reading this
Launch was {LAUNCH.isoformat()}; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills {SIGNAL.isoformat()}. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Price is read from UNIT_AMOUNT (never AMOUNT, which carries quantity and proration)
on monthly {INTENDED_CURRENCY} SKUs only. Nothing here multiplies by an assumed price.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
"""
STATUS_OUT = OUT.parent / "pilot-status.md"
STATUS_OUT.write_text(status)
print(f" -> {STATUS_OUT.name} (STATE: {state} / {price_state})", flush=True)
