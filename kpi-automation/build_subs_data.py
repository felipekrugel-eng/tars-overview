#!/usr/bin/env python3
"""
build_subs_data.py — subscription-level detail for the Study & Trend page.

Two things the page could not show before:

  1. MRR SPLIT BY FEATURE. The MRR chart was one black bar a month. Five features sit
     inside it and they do not rank the way subscription counts suggest: Sales history
     has four times Inventory's subscriptions and two thirds of its revenue.

  2. SUBSCRIPTION ADDS AND CANCELLATIONS. The existing flow chart counts MERCHANTS, so a
     merchant who drops one feature of three is invisible to it — and 16k merchants hold
     more than one. This counts subscriptions, from Chargebee's own lifecycle rather
     than inferred from invoice silence.

Reads two CSVs produced by run.py and writes ONE file, "KPI Dashboard v2 (Caio)/subs-data.js".

RECONCILIATION IS THE POINT OF THE FIRST DATASET and is enforced here, not hoped for.
mrr_by_feature_monthly.sql is a deliberate clone of mrr_bottomup_monthly.sql that keeps
the plan id, so the feature split must sum to the MRR the page already draws. This script
compares the two month by month and fails loudly if they diverge by more than a rounding
tolerance — a silent divergence would put two different MRR totals on one screen, which
is the single most damaging thing a dashboard can do.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
MRR_FEATURE_CSV = Path(os.environ.get("MRR_FEATURE_CSV", HERE / "work" / "mrr_by_feature.csv"))
SUB_FLOW_CSV    = Path(os.environ.get("SUB_FLOW_CSV",    HERE / "work" / "subscription_flow.csv"))
MERCHANT_FLOW_CSV = Path(os.environ.get("MERCHANT_FLOW_CSV", HERE / "work" / "merchant_subscription_flow.csv"))
MRR_TOTAL_CSV   = Path(os.environ.get("MRR_TOTAL_CSV",   HERE / "work" / "mrr_bottomup.csv"))
COUNTRY_MONTH_CSV = Path(os.environ.get("COUNTRY_MONTH_CSV", HERE / "work" / "country_month_activity.csv"))
# Agreed case-model GTV baseline, USD per year: EUR 26.9bn (5YP v3.1, 2025) at the EUR x1.16
# used across the page = ~$31.2bn. Override with CASE_GTV_BASELINE_USD when the plan is rebased.
CASE_GTV_BASELINE_USD = float(os.environ.get("CASE_GTV_BASELINE_USD", 26.9e9 * 1.16))
# THE BASELINE DESCRIBES A YEAR, so it is compared against that year. EUR 26.9bn is the 2025
# plan figure; the last complete month it covers is 2025-10. Holding today's trailing twelve
# months against it measures the bound AND a year of growth at once, and reads high for the
# second reason. Measured 2026-11-20 under the per-currency bound: the 12 months to 2025-10
# read $29.61bn, 0.95x the baseline, while the 12 months to 2026-10 read $36.85bn, 1.18x —
# over the same period active merchants grew 26.1% and GTV 24.5%, and GTV per active merchant
# was FLAT at about $8.4k a month. A residual outlier problem does not look like that.
# So the asterisk gates on the matched year, not on the trailing window, and the footnote
# states both. Move this when the plan is rebased.
CASE_GTV_BASELINE_END = os.environ.get("CASE_GTV_BASELINE_END", "2025-10")
FEED_HEALTH_CSV = Path(os.environ.get("FEED_HEALTH_CSV", HERE / "work" / "receipts_feed_health.csv"))
KPI_DATA_JS     = Path(os.environ.get("KPI_DATA_JS",     HERE.parent / "KPI Dashboard v2 (Caio)" / "kpi-data.js"))
OUT_DIR         = Path(os.environ.get("SUBS_OUT_DIR",    HERE.parent / "KPI Dashboard v2 (Caio)"))
OUT_FILE        = OUT_DIR / "subs-data.js"

# Labels are Chargebee's own line-item descriptions, not a reading of the plan id. That
# distinction cost us once: EMPSTORE was labelled "Employee + Store" on the assumption that
# the id named two things, when Chargebee describes it as "Employee management" — the same
# string as EMPLOYEE. They are ONE FEATURE ON TWO PRICING MODELS:
#     S_EMPLOYEE_*   $5  per employee, averaging 2.36 employees  -> $11.77 MRR
#     S_EMPSTORE_*   $25 per store,    averaging 1.40 stores     -> $35.11 MRR
# Mutually exclusive — no merchant holds both — and both actively sold, ~1,850 new
# per-employee subscriptions a month against ~67 per-store. Neither is legacy.
#
# They are kept SEPARATE rather than merged: the two price the same product so differently
# that averaging them would hide the more interesting number. The labels and the ordering
# below put them side by side so nobody reads them as different products, which is the
# mistake this comment exists to prevent from happening twice.
#
# Order is the order the chart stacks them in, biggest earner at the bottom, except that the
# two Employee rows are held together — grouping a product beats ranking a plan.
FEATURE_LABEL = [
    ("INVENTORY",    "Advanced inventory"),
    ("EMPLOYEE",     "Employee mgmt · per employee"),
    ("EMPSTORE",     "Employee mgmt · per store"),
    ("SALESHISTORY", "Unlimited sales history"),
    ("INTEGRATION",  "Integrations"),
    ("OTHER",        "Other"),
]
TERMS = ["monthly", "annual", "other"]


def _month(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series).dt.strftime("%Y-%m")


def _load(path: Path, what: str) -> pd.DataFrame:
    if not path.exists():
        sys.exit(f"[subs] MISSING {what}: {path}")
    df = pd.read_csv(path)
    df.columns = [c.upper() for c in df.columns]
    return df



# ── RECEIPTS FEED COMPLETENESS ──────────────────────────────────────────────────────────
# A build that cannot tell SILENCE from ZERO will eventually publish a catastrophe. On
# 2026-09-29 the receipts feed stopped mid-afternoon; every build afterwards read the empty
# days as real and the dashboard showed qualified active merchants going 332,105 -> 76. It
# stayed wrong for three days because nothing in the pipeline was asked to notice.
#
# The cross-check that already existed here could not have caught it. It compares this
# file's 1+ active column against the activeMonthly series in kpi-data.js — but only for
# months present in BOTH. October existed only here, so it was skipped exactly because it
# was new, which is precisely when a month is most likely to be wrong. A guard that only
# validates what another file already agrees with cannot catch a novel failure.
#
# So completeness is decided from the feed's own daily shape instead:
#   * a day is COMPLETE if it carries at least HEALTHY_FRACTION of the trailing median of
#     settled days. Proportional, not a fixed floor, so it survives the business growing.
#   * the trailing median is taken from days that are themselves settled, so an outage
#     cannot quietly lower the bar it is being judged against.
#   * a month ships only if its LAST DAY is complete. Month grain alone would not have
#     caught this: September was 97.8% complete when the feed died — invisible in a monthly
#     total, still wrong.
LAG_DAYS = 2            # the feed's own normal settling lag; today is never judged
HEALTHY_FRACTION = 0.5  # a day under half the trailing median is not a quiet day, it is a gap
# Beyond this many days with no complete day, the run goes red. Two days is the feed's own
# normal settling lag, so 2 is "nothing is wrong yet" and anything past it is an incident.
STALE_ALARM_DAYS = 2


def feed_completeness(path: Path):
    """Return (last_complete_day, health_dict). last_complete_day is None if unknowable."""
    if not path.exists():
        print(f"[subs] WARNING — no feed health file at {path}; completeness cannot be "
              f"checked and months will be published unguarded", flush=True)
        return None, {"checked": False,
                      "note": "receipts_feed_health.sql did not run"}

    fh = pd.read_csv(path)
    fh.columns = [c.upper() for c in fh.columns]
    fh["D"] = fh["D"].astype(str).str.slice(0, 10)
    fh = fh[fh["D"] <= pd.Timestamp.utcnow().strftime("%Y-%m-%d")].sort_values("D")
    if fh.empty:
        return None, {"checked": False, "note": "feed health query returned no rows"}

    days = fh.set_index("D")["RECEIPTS"].astype(float)
    # Reference window: settled days only, and the most recent LAG_DAYS dropped outright.
    settled = days.iloc[:-LAG_DAYS] if len(days) > LAG_DAYS else days
    if settled.empty:
        return None, {"checked": False, "note": "not enough settled days"}
    ref = settled.iloc[-30:-3] if len(settled) > 30 else settled
    median = float(ref.median()) if len(ref) else 0.0
    floor = median * HEALTHY_FRACTION

    # Walk back from the newest settled day to the last one that clears the floor.
    last_complete = None
    for d, n in settled.iloc[::-1].items():
        if floor <= 0 or float(n) >= floor:
            last_complete = d
            break

    # tz-naive on purpose: every date in this pipeline is a bare calendar day, and
    # subtracting a tz-aware "now" from a naive date raises.
    today = pd.Timestamp(pd.Timestamp.utcnow().strftime("%Y-%m-%d"))
    stale_days = None
    if last_complete:
        stale_days = int((today - pd.Timestamp(last_complete)).days)

    health = {
        "checked": True,
        "lastCompleteDay": last_complete,
        "trailingMedianReceipts": int(median),
        "floor": int(floor),
        "staleDays": stale_days,
        "recent": [{"d": d, "receipts": int(n),
                    "complete": bool(floor <= 0 or float(n) >= floor)}
                   for d, n in days.iloc[-10:].items()],
    }
    return last_complete, health


def last_whole_month(last_complete_day: str) -> str:
    """The newest calendar month the feed covers to its final day."""
    d = pd.Timestamp(last_complete_day)
    month_end = d + pd.offsets.MonthEnd(0)
    if d >= month_end:
        return d.strftime("%Y-%m")                      # the month closed and we have all of it
    # Mid-month: the CURRENT month is unfinished, so the newest whole one is the previous.
    # (Subtracting MonthBegin(1) is the obvious-looking way to write this and is wrong — from
    # mid-month it lands on the first of the SAME month and would hand back an incomplete
    # month as though it were whole. That is the exact class of bug this guard exists to stop,
    # so it is worth the extra line to get right.)
    return (d.to_period("M") - 1).strftime("%Y-%m")


def main() -> None:
    feat = _load(MRR_FEATURE_CSV, "MRR by feature")
    flow = _load(SUB_FLOW_CSV, "subscription flow")

    feat["M"] = _month(feat["MONTH"])
    flow["M"] = _month(flow["MONTH"])

    # ---- cap at the current calendar month -------------------------------------------
    # Annual plans amortise forward, so the feature query emits months that have not
    # happened yet. The total-MRR build caps the same way; not capping here would draw a
    # cliff at the right-hand edge of the chart where the forward months thin out.
    cap = pd.Timestamp.utcnow().strftime("%Y-%m")

    # ---- receipts feed completeness ---------------------------------------------------
    # Decided before anything is built, because it changes what may be published. MRR and
    # subscription flow come from Chargebee and are NOT affected by a receipts outage, so
    # they keep the calendar cap; only the receipts-derived series get the stricter one.
    last_complete_day, feed_health = feed_completeness(FEED_HEALTH_CSV)
    receipts_cap = cap
    feed_stale_fatal = False
    # Set when the 1+ cross-check breaches; published and alarmed, never aborting.
    active_divergence = None
    if last_complete_day:
        receipts_cap = last_whole_month(last_complete_day)
        stale = feed_health.get("staleDays")
        print(f"[subs] receipts feed complete through {last_complete_day} "
              f"({stale} day(s) ago); receipts-derived months capped at {receipts_cap} "
              f"(trailing median {feed_health['trailingMedianReceipts']:,}/day)", flush=True)
        if receipts_cap < cap:
            print(f"[subs] NOTE — {cap} is NOT fully covered by the feed and will be "
                  f"withheld rather than drawn as a decline", flush=True)
        # A feed that has been down for days is an incident, not a quiet patch. Fail the run
        # so it goes red within hours. The alternative — quietly publishing a series that
        # just stops — is what let the September outage run for three days.
        if stale is not None and stale > STALE_ALARM_DAYS:
            # NOTE THE ORDER: we do NOT bail out here. The file still gets written, with the
            # incomplete months withheld, so the dashboard shows a series that simply ends
            # at the last honest month instead of a cliff to near-zero. THEN the run fails,
            # so somebody is told. Exiting early would leave the previously published —
            # already broken — file in place, which is the worst of both worlds: wrong on
            # screen and silent in the logs.
            feed_stale_fatal = True
    feat = feat[feat["M"] <= cap]
    flow = flow[flow["M"] <= cap]

    # ---- reconciliation against the MRR the page already draws ------------------------
    if MRR_TOTAL_CSV.exists():
        tot = _load(MRR_TOTAL_CSV, "bottom-up MRR")
        tot["M"] = _month(tot["MONTH"])
        tot_by_month = tot.groupby("M")["MRR_USD"].sum()
        feat_by_month = feat.groupby("M")["MRR_USD"].sum()
        both = pd.concat([tot_by_month.rename("total"), feat_by_month.rename("split")], axis=1).dropna()
        both["diff"] = both["split"] - both["total"]
        both["pct"] = (both["diff"] / both["total"].replace(0, pd.NA)) * 100
        worst = both["pct"].abs().max()
        print(f"[subs] reconciliation vs mrr_bottomup over {len(both)} months — worst {worst:.4f}%")
        # A tenth of a percent is far above float noise and far below anything a reader
        # would notice; landing between the two means the clone has genuinely drifted.
        bad = both[both["pct"].abs() > 0.1]
        if len(bad):
            print(bad.tail(12).to_string(), file=sys.stderr)
            sys.exit("[subs] FAILED — the feature split no longer sums to the MRR line. "
                     "mrr_by_feature_monthly.sql and mrr_bottomup_monthly.sql have diverged; "
                     "they must stay character-identical apart from the plan id.")
    else:
        print(f"[subs] WARNING — {MRR_TOTAL_CSV} not found, skipping reconciliation", flush=True)

    # ---- MRR by month x feature x term -----------------------------------------------
    # Emitted as a flat cell list rather than a nested object: the page sums whichever
    # cells the term filter selects, and a flat list means "all" is always the sum of the
    # parts with no separate total to fall out of step.
    mrr_cells = [
        {"m": r.M, "f": r.FEATURE, "t": r.TERM, "v": round(float(r.MRR_USD), 2)}
        for r in feat.itertuples()
    ]

    flow_cells = [
        {"m": r.M, "f": r.FEATURE, "t": r.TERM, "a": int(r.ADDS), "c": int(r.CANCELS)}
        for r in flow.itertuples()
    ]

    # ---- merchant-grain twin ----------------------------------------------------------
    # Separate series, never derived by summing the cells above: a merchant with three
    # features is three rows there and one here, and the churn chart plots this one against
    # merchant gross adds. Summing subscriptions into that chart overstated departures by
    # two thirds (Aug 2026: 4,376 subscriptions against 2,610 merchants).
    merchant_flow = []
    if MERCHANT_FLOW_CSV.exists():
        mf = _load(MERCHANT_FLOW_CSV, "merchant subscription flow")
        mf["M"] = _month(mf["MONTH"])
        mf = mf[mf["M"] <= cap]
        merchant_flow = [{"m": r.M, "a": int(r.ADDS), "c": int(r.CANCELS)} for r in mf.itertuples()]
        mbase = int((mf["ADDS"] - mf["CANCELS"]).sum())
        print(f"[subs] merchant-grain flow: {len(merchant_flow)} months, derived merchant base {mbase:,}")
    else:
        print(f"[subs] WARNING — {MERCHANT_FLOW_CSV} not found; the churn chart keeps its "
              f"30-day reading only and the Cancellations toggle stays hidden", flush=True)

    # ---- country x month activity: qualified active, and GTV ---------------------------
    # One query feeds two features. The global qualified-active series is the SUM over
    # countries, which is exact because a merchant has exactly one country — so no merchant
    # can be double-counted or lost, and it saves a second full scan of a 2.7TB table.
    #
    # The 1+ column is NOT published. It exists to be checked against the activeMonthly
    # series the page already draws: both count the same thing from the same table with the
    # same filters, so a disagreement means a definition moved and the chart would be
    # contradicting itself in public. Only 5+/10+ and the per-country figures ship.
    active_qualified, country_month, gtv_recon = [], {}, None
    gtv_monthly, gtv_monthly_cc = [], []
    if COUNTRY_MONTH_CSV.exists():
        cm = _load(COUNTRY_MONTH_CSV, "country x month activity")
        cm["M"] = cm["MONTH"].astype(str).str.slice(0, 7)
        # receipts_cap, NOT cap: this frame is the receipts scan, and a month the feed does
        # not cover to its final day is incomplete, not small.
        before = sorted(cm["M"].unique())
        cm = cm[cm["M"] <= receipts_cap]
        dropped = [m for m in before if m > receipts_cap]
        if dropped:
            print(f"[subs] withheld {len(dropped)} incomplete month(s) from the receipts "
                  f"series: {', '.join(dropped)}", flush=True)

        # FX coverage. A currency missing from the rate table contributes no money, and the
        # query returns how many receipts that affected so the gap is measurable.
        no_rate = int(cm["RECEIPTS_NO_RATE"].sum())
        total_r = int(cm["RECEIPTS"].sum())
        share = (no_rate / total_r * 100) if total_r else 0
        print(f"[subs] GTV currency coverage: {no_rate:,} of {total_r:,} receipts had no FX rate ({share:.3f}%)")
        if share > 2:
            print(f"[subs] WARNING — {share:.2f}% of receipts have no FX rate; GTV understates those "
                  f"countries. Add the missing currencies to fx_rates in country_month_activity.sql",
                  flush=True)

        # Global monthly series, summed over countries.
        g = cm.groupby("M").agg(a1=("ACTIVE_1", "sum"), a5=("ACTIVE_5", "sum"),
                                a10=("ACTIVE_10", "sum")).reset_index()
        published = {}
        if KPI_DATA_JS.exists():
            raw = KPI_DATA_JS.read_text(encoding="utf-8")
            i = raw.find('"activeMonthly"')
            if i >= 0:
                arr = json.loads(raw[raw.index("[", i):raw.index("]", i) + 1])
                published = {r["month"]: r["active"] for r in arr}
        if published:
            worst, worst_m = 0.0, None
            checked = 0
            for r in g.itertuples():
                base = published.get(r.M)
                if not base:
                    continue
                checked += 1
                pct = abs(int(r.a1) - base) / base * 100
                if pct > worst:
                    worst, worst_m = pct, r.M
            print(f"[subs] active 1+ vs published activeMonthly over {checked} months — worst {worst:.3f}% ({worst_m})")
            # Far beyond the drift from receipts landing between two builds, far below
            # anything visible on the chart.
            #
            # BREACHING THIS NO LONGER ABORTS THE BUILD, and the reason is worth keeping.
            # Until 2026-11-02 it called sys.exit() here. On 31 Oct the divergence reached
            # 0.346% and this one line took down the ENTIRE subscriptions file: MRR, churn,
            # the feature split, the flow charts, feedHealth — none of which come from
            # receipts at all, none of which were wrong. subs-data.js sat frozen for 26 hours
            # while kpi-data.js, daily-history.js and flow-data.js refreshed beside it every
            # hour, and the run stayed green because the caller treats a non-zero exit from
            # this script as a warning.
            #
            # A cross-check on one pair of series has no business withholding every other
            # series in the file. So the breach is recorded, published, and raised as an
            # alarm AFTER the file is written — the same shape the feed-stale check below
            # already uses, and the same lesson kpi-pull learned on 28 Aug.
            #
            # The threshold is deliberately NOT relaxed. Widening it to 0.5% would silence
            # today's breach and hide the next real one; the number is published instead so
            # the drift is visible on the page and in the log while it is investigated.
            if worst > 0.25:
                active_divergence = {"pct": round(worst, 3), "month": worst_m}
                print(f"[subs] DIVERGED — the 1+ column is {worst:.2f}% off the published active "
                      f"series at {worst_m}. They must count the same merchants, so "
                      f"country_month_activity.sql and receipts_tpv_daily_asof.sql have drifted. "
                      f"Qualified-active and the country table are published anyway and flagged: "
                      f"at this size the difference is invisible on the chart, and withholding "
                      f"them would blank more of the dashboard than the drift justifies.",
                      file=sys.stderr)
        else:
            print("[subs] WARNING — could not read activeMonthly, qualified active unchecked", flush=True)
        active_qualified = [{"m": r.M, "a5": int(r.a5), "a10": int(r.a10)} for r in g.itertuples()]

        # Latest complete month per country, for the country table. One month only: the
        # table shows a ranking, and shipping 70 months x 200 countries to render 40 rows
        # would be most of a megabyte for nothing.
        months = sorted(cm["M"].unique().tolist())
        # months[-1], not months[-2]. `cm` is ALREADY capped to the last complete
        # receipts month a few lines above, so stepping back again subtracted the
        # partial month twice and showed the country table a month behind everything
        # beside it — August 'Active base' against September MRR.
        snap = months[-1] if months else None

        # EVERY month, summed across countries. Until now the only GTV figures that
        # survived the build were countryMonth (one month) and gtvRecon (one twelve-month
        # total), so a question as ordinary as "what was GTV in March?" meant re-running
        # the query by hand. This publishes the whole series. It is the SAME GTV_USD the
        # country table and the reconciliation already use — aggregated, never recomputed.
        #   gtv          per-currency outlier bound; the figure FACADASH reports
        #   gtvCap10k    the previous flat $10k-per-receipt rule, kept for comparison
        #   gtvUncapped  no bound at all. Orders of magnitude larger, diagnostic only
        if months:
            agg = {"GTV_USD": "sum", "RECEIPTS": "sum", "RECEIPTS_NO_RATE": "sum"}
            for c in ("GTV_USD_CAP10K", "GTV_USD_UNCAPPED"):
                if c in cm.columns:
                    agg[c] = "sum"
            g = cm.groupby("M", as_index=False).agg(agg).sort_values("M")
            has10k = "GTV_USD_CAP10K" in g.columns
            hasunc = "GTV_USD_UNCAPPED" in g.columns
            gtv_monthly = [{"m": str(r.M),
                            "gtv": round(float(r.GTV_USD), 2),
                            "gtvCap10k": round(float(r.GTV_USD_CAP10K), 2) if has10k else None,
                            "gtvUncapped": round(float(r.GTV_USD_UNCAPPED), 2) if hasunc else None,
                            "receipts": int(r.RECEIPTS),
                            "receiptsNoRate": int(r.RECEIPTS_NO_RATE)}
                           for r in g.itertuples()]
            print(f"[subs] gtvMonthly: {len(gtv_monthly)} months, {gtv_monthly[0]['m']}..{gtv_monthly[-1]['m']}",
                  flush=True)

        if snap:
            latest = cm[cm["M"] == snap]
            country_month = {str(r.COUNTRY): {"a1": int(r.ACTIVE_1), "a5": int(r.ACTIVE_5),
                                              "a10": int(r.ACTIVE_10), "gtv": round(float(r.GTV_USD), 2)}
                             for r in latest.itertuples()}
            gtv_total = sum(v["gtv"] for v in country_month.values())
            act_total = sum(v["a1"] for v in country_month.values())
            # Capped against uncapped. The $10k per-receipt cap removes ~99.7% of the raw
            # total — Aug 2026: $4.8bn capped against $1.598 TRILLION uncapped — so the
            # receipts table carries spectacular junk quite apart from the unit question.
            # Logged as a ratio: a sudden move in it means the junk pattern changed, and
            # the capped figure is the only one anyone should rank on.
            unc = float(latest["GTV_USD_UNCAPPED"].sum())
            print(f"[subs] GTV capped ${gtv_total:,.0f} vs uncapped ${unc:,.0f} "
                  f"({(unc/gtv_total if gtv_total else 0):,.0f}x) — the $10k per-receipt cap carries weight")
            # RECONCILIATION AGAINST THE CASE MODEL (added 2026-11-20). GTV_USD now applies a
            # per-currency outlier bound (see currency_caps in country_month_activity.sql);
            # GTV_USD_CAP10K is the previous flat-$10k rule, kept for comparison. The trailing
            # twelve complete months are held against the agreed case-model baseline, and the
            # ratio is PUBLISHED so the page states it from data rather than a hard-coded 1.74x.
            ttm_months = months[-12:]
            ttm = cm[cm["M"].isin(ttm_months)]
            ttm_new = float(ttm["GTV_USD"].sum())
            ttm_old = float(ttm["GTV_USD_CAP10K"].sum()) if "GTV_USD_CAP10K" in ttm.columns else None
            ratio = ttm_new / CASE_GTV_BASELINE_USD if CASE_GTV_BASELINE_USD else None
            # The baseline's own twelve months, so the comparison is like for like.
            mw = [m for m in months if m <= CASE_GTV_BASELINE_END][-12:]
            m_new = float(cm[cm["M"].isin(mw)]["GTV_USD"].sum()) if mw else None
            m_ratio = (m_new / CASE_GTV_BASELINE_USD) if (m_new and CASE_GTV_BASELINE_USD) else None
            gtv_recon = {"ttm": round(ttm_new), "ttmCap10k": round(ttm_old) if ttm_old is not None else None,
                         "baseline": CASE_GTV_BASELINE_USD, "ratio": round(ratio, 3) if ratio else None,
                         "months": len(ttm_months), "from": ttm_months[0], "to": ttm_months[-1],
                         "method": "per-currency" if ttm_old is not None else "cap10k",
                         # The matched window is what the asterisk gates on.
                         "matched": round(m_new) if m_new else None,
                         "matchedRatio": round(m_ratio, 3) if m_ratio else None,
                         "matchedFrom": mw[0] if mw else None, "matchedTo": mw[-1] if mw else None}
            if m_ratio:
                print(f"[subs] GTV matched window {mw[0]}..{mw[-1]} (the baseline's own year): "
                      f"${m_new:,.0f} -> {m_ratio:.2f}x", flush=True)
            print(f"[subs] GTV TTM {ttm_months[0]}..{ttm_months[-1]}: ${ttm_new:,.0f} "
                  f"(per-currency bound) vs case-model ${CASE_GTV_BASELINE_USD:,.0f} -> {ratio:.2f}x"
                  + (f"; flat-$10k rule would read ${ttm_old:,.0f} ({ttm_old/CASE_GTV_BASELINE_USD:.2f}x)"
                     if ttm_old else ""), flush=True)
            # TWO RECONCILIATIONS, ENFORCED RATHER THAN HOPED FOR. The same months read out
            # of gtvMonthly must give gtvRecon.ttm, and the snapshot month must give the
            # country table's total. A series that drifts from the two figures the page
            # already displays is worse than no series at all, so this exits rather than warns.
            by_m = {r["m"]: r["gtv"] for r in gtv_monthly}
            ttm_from_monthly = sum(by_m.get(m, 0.0) for m in ttm_months)
            if abs(ttm_from_monthly - ttm_new) > max(1.0, abs(ttm_new) * 1e-9):
                sys.exit(f"[subs] FAILED — gtvMonthly over {ttm_months[0]}..{ttm_months[-1]} sums to "
                         f"${ttm_from_monthly:,.2f} but gtvRecon.ttm is ${ttm_new:,.2f}")
            if abs(by_m.get(snap, 0.0) - gtv_total) > max(1.0, abs(gtv_total) * 1e-9):
                sys.exit(f"[subs] FAILED — gtvMonthly[{snap}] is ${by_m.get(snap, 0.0):,.2f} but "
                         f"countryMonth sums to ${gtv_total:,.2f}")
            print(f"[subs] gtvMonthly reconciles — TTM ${ttm_from_monthly:,.0f} = gtvRecon.ttm, "
                  f"{snap} ${by_m.get(snap, 0.0):,.0f} = countryMonth", flush=True)

            # The same monthly series for the twenty largest countries in the snapshot
            # month. Twenty rather than all ~200: this is for reading a trend, and the tail
            # is noise measured in hundreds of dollars a month.
            top20 = [c for c, _ in sorted(country_month.items(), key=lambda kv: -kv[1]["gtv"])[:20]]
            gcc = (cm[cm["COUNTRY"].isin(top20)]
                   .groupby(["COUNTRY", "M"], as_index=False)["GTV_USD"].sum()
                   .sort_values(["COUNTRY", "M"]))
            gtv_monthly_cc = [{"cc": str(r.COUNTRY), "m": str(r.M), "gtv": round(float(r.GTV_USD), 2)}
                              for r in gcc.itertuples()]

            if "GTV_USD_CAP10K" in latest.columns:
                old_by = latest.set_index("COUNTRY")["GTV_USD_CAP10K"]
                for cc in ["US", "TH", "PH", "MX", "MY", "SA", "MM", "GB", "ES", "SG", "HT", "JP", "KR"]:
                    if cc in country_month:
                        o = float(old_by.get(cc, 0) or 0); n = country_month[cc]["gtv"]
                        print(f"[subs]   {cc}: ${n:,.0f} (was ${o:,.0f}, {n/o if o else 0:.2f}x)")
            per = gtv_total / act_total if act_total else 0
            print(f"[subs] country table month {snap}: {len(country_month)} countries, "
                  f"GTV ${gtv_total:,.0f}, active {act_total:,}, ${per:,.0f} per active merchant")
            # The old per-country GTV read $188k per active merchant per month. A POS base
            # averages hundreds, so this is the guard that would have caught it.
            if per > 20000:
                sys.exit(f"[subs] FAILED — GTV averages ${per:,.0f} per active merchant, which is not "
                         f"credible for a POS base. Check minor units and FX in country_month_activity.sql.")
    else:
        print(f"[subs] WARNING — {COUNTRY_MONTH_CSV} not found; the Qualified toggle and the "
              f"country table's GTV column stay hidden", flush=True)

    # A feature earns a legend entry only if it appears in the window the charts actually
    # draw (the page starts at 2022-01). Without this, OTHER — one unparseable $25 line item
    # from August 2018 — would sit in the legend forever reading "$0K". Its cells stay in
    # `mrr` regardless, so nothing is dropped from the arithmetic; it simply has no cells in
    # the charted window, which is why removing it cannot change a total.
    WINDOW = "2022-01"
    feat_win = feat[feat["M"] >= WINDOW]
    flow_win = flow[flow["M"] >= WINDOW]
    features = [{"k": k, "l": l} for k, l in FEATURE_LABEL
                if (feat_win["FEATURE"] == k).any() or (flow_win["FEATURE"] == k).any()]
    dropped = [k for k, _ in FEATURE_LABEL
               if k not in {f["k"] for f in features}
               and ((feat["FEATURE"] == k).any() or (flow["FEATURE"] == k).any())]
    if dropped:
        print(f"[subs] features present only before {WINDOW}, left out of the legend: {', '.join(dropped)}")

    # The subscription base the growth line divides by is DERIVED, not measured: a
    # subscription is in the base from the month it starts until the month it is cancelled,
    # so the cumulative net is the base. Logged every run because it is the one number on
    # that chart nobody can see. On 18 Sep 2026 it accumulated to 82,240 against Chargebee's
    # own 78,477 active + 2,655 paused + 1,106 non_renewing = 82,238 — a difference of two,
    # which is the `future` rows. If this ever drifts by more than a handful, the adds or
    # cancels rule has changed and the growth percentages are wrong.
    base = int((flow["ADDS"] - flow["CANCELS"]).sum())
    print(f"[subs] derived subscription base at {cap}: {base:,} "
          f"(cumulative adds minus cancels; compare against Chargebee active + paused + non_renewing)")

    months_mrr = sorted(feat["M"].unique().tolist())
    months_flow = sorted(flow["M"].unique().tolist())

    latest = months_mrr[-1] if months_mrr else None
    summary = []
    if latest:
        cur = feat[feat["M"] == latest].groupby("FEATURE")["MRR_USD"].sum()
        prev_m = months_mrr[-2] if len(months_mrr) > 1 else None
        prev = feat[feat["M"] == prev_m].groupby("FEATURE")["MRR_USD"].sum() if prev_m else None
        for k, l in FEATURE_LABEL:
            if k not in cur.index:
                continue
            row = {"k": k, "l": l, "mrr": round(float(cur[k]), 2)}
            if prev is not None and k in prev.index and prev[k]:
                row["chg"] = round((float(cur[k]) - float(prev[k])) / float(prev[k]) * 100, 2)
            summary.append(row)

    out = {
        "generatedAt": pd.Timestamp.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "currency": "USD",
        "features": features,
        "terms": TERMS,
        "monthsMrr": months_mrr,
        "monthsFlow": months_flow,
        "latestMonth": latest,
        "summary": summary,
        "mrr": mrr_cells,
        "flow": flow_cells,
        "merchantFlow": merchant_flow,
        # Published so the page can SAY the feed is stale instead of drawing the gap as a
        # decline. A dashboard that cannot explain its own last data point is how a feed
        # outage becomes a business panic.
        "feedHealth": {**feed_health, "stale": feed_stale_fatal},
        # Set when qualified-active and the published active line disagree by more than
        # the tolerance. Published so the page can say so rather than quietly drawing two
        # numbers that are meant to be one.
        "activeDivergence": active_divergence,
        # QUERIES THAT DID NOT LAND THIS BUILD, so the page can distinguish "this series is
        # empty because nothing happened" from "this series is empty because we failed to
        # fetch it". feedHealth answers a DIFFERENT question — is the upstream lake feed
        # alive — and on 2026-10-16 it answered yes, correctly, while active merchants and
        # receipts sat blank because our own pull had died of an expired session. Two
        # different failures, two different signals; conflating them is what let a broken
        # dashboard look fine.
        "degraded": [q for q in os.environ.get("DEGRADED_QUERIES", "").split(",") if q],
        "receiptsThrough": receipts_cap,
        "activeQualified": active_qualified,
        "countryMonth": country_month,
        # {ttm, ttmCap10k, baseline, ratio, months, from, to, method} — trailing-twelve-month
        # GTV held against the case-model baseline; the page's GTV footnote reads from this.
        "gtvRecon": gtv_recon,
        # [{m, gtv, gtvCap10k, gtvUncapped, receipts, receiptsNoRate}] — every month the
        # receipts query covers, summed across countries. Reconciled above against both
        # gtvRecon.ttm and the countryMonth total before it is written.
        "gtvMonthly": gtv_monthly,
        # [{cc, m, gtv}] — the same series for the twenty largest countries in the snapshot
        # month. A convenience, not a source: gtvMonthly is the total.
        "gtvMonthlyByCountry": gtv_monthly_cc,
    }

    banner = (
        "// Subscription detail for Study & Trend — generated by kpi-automation/build_subs_data.py.\n"
        "// Do NOT edit by hand.\n"
        "//\n"
        "// window.SUBS_DATA = {\n"
        "//   features[] : {k,l} in stack order, biggest earner first.\n"
        "//   mrr[]      : {m:'YYYY-MM', f:FEATURE, t:'monthly'|'annual', v:USD} — one cell per\n"
        "//                month x feature x term. Summing every cell of a month gives EXACTLY the\n"
        "//                MRR that kpi-data.js reports for it; the build fails if it ever does not,\n"
        "//                because two different MRR totals on one screen is the worst thing a\n"
        "//                dashboard can do. Annual plans are amortised 1/12 per month, same as the\n"
        "//                total, so `t` is the billing term and not the shape of the revenue.\n"
        "//   flow[]     : {m, f, t, a:adds, c:cancels} — SUBSCRIPTIONS, not merchants. A merchant\n"
        "//                with three features contributes three. From Chargebee's own lifecycle\n"
        "//                dates, so a cancellation lands in the month it happened; the merchant\n"
        "//                churn chart above infers churn from invoice silence with a 30-day grace\n"
        "//                and is late by construction. The two are not meant to agree.\n"
        "//   merchantFlow[] : {m, a, c} — the SAME events counted per MERCHANT. Adds is the month a\n"
        "//                merchant's first subscription starts; cancels is the month its last one\n"
        "//                goes, so dropping one feature of three is not a departure. The churn\n"
        "//                chart's Cancellations mode uses this, never a sum over flow[].\n"
        "//   countryMonth : {CC: {a1,a5,a10,gtv}} for the LATEST COMPLETE month, for the country\n"
        "//                table. GTV is USD, converted per currency with ISO minor units — the\n"
        "//                as-of query divides by a per-merchant decimal-places column instead and\n"
        "//                reads $63m per merchant per month in Korea, so do not cross the two.\n"
        "//   gtvMonthly[] : {m, gtv, gtvCap10k, gtvUncapped, receipts, receiptsNoRate} — one row per\n"
        "//                month over the whole receipts history, summed across every country. `gtv`\n"
        "//                is the per-currency outlier bound FACADASH reports; `gtvCap10k` is the\n"
        "//                older flat $10k-per-receipt rule and `gtvUncapped` has no bound at all and\n"
        "//                is diagnostic only. The build FAILS unless these months sum to gtvRecon.ttm\n"
        "//                and the latest one equals the countryMonth total, so one GTV number cannot\n"
        "//                quietly become two. Every month is converted at one set of exchange rates,\n"
        "//                not each month's own, so year-on-year comparisons carry no FX movement.\n"
        "//   gtvMonthlyByCountry[] : {cc, m, gtv} — the same series for the twenty largest countries\n"
        "//                in the latest month. A convenience; gtvMonthly is the total.\n"
        "//   activeQualified[] : {m, a5, a10} — merchants with 5+ and 10+ receipts that month. The\n"
        "//                query also returns a 1+ column; it is deliberately NOT published, only\n"
        "//                reconciled against kpi-data.js activeMonthly, so the line on screen stays\n"
        "//                the one the page has always drawn.\n"
        "//   summary[]  : {k,l,mrr,chg} for the latest month, chg = % vs the month before.\n"
        "// }\n"
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(banner + "window.SUBS_DATA = " + json.dumps(out, separators=(",", ":")) + ";\n",
                        encoding="utf-8")

    tot_latest = sum(c["v"] for c in mrr_cells if c["m"] == latest)
    print(f"[subs] wrote {OUT_FILE} — {len(mrr_cells)} MRR cells, {len(flow_cells)} flow cells, "
          f"{len(features)} features, {len(months_mrr)} months")
    print(f"[subs] {latest}: ${tot_latest:,.0f} MRR — " +
          ", ".join(f"{s['l']} ${s['mrr']:,.0f}" for s in summary))

    # The file is written and correct; now make the outage impossible to ignore. Everything
    # above still shipped, so the dashboard is honest either way — this exists purely so the
    # run goes red and somebody looks, instead of three more days passing.
    if active_divergence and not feed_stale_fatal:
        print(f"\n[subs] FAILED — ACTIVE-MERCHANT CROSS-CHECK DIVERGED.\n"
              f"        qualified-active (country_month_activity.sql) is "
              f"{active_divergence['pct']}% off the published active series "
              f"(receipts_tpv_daily_asof.sql) at {active_divergence['month']}.\n"
              f"        They are supposed to count the same merchants, so one of the two\n"
              f"        queries has drifted. subs-data.js WAS written and flagged; this\n"
              f"        non-zero exit is the alarm, not a build failure.", file=sys.stderr)
        sys.exit(4)

    if feed_stale_fatal:
        print(f"\n[subs] FAILED — RECEIPTS FEED IS DOWN.\n"
              f"        No complete day since {last_complete_day} "
              f"({feed_health.get('staleDays')} days ago).\n"
              f"        Receipts, active merchants, qualified-active and GTV are FROZEN at "
              f"{receipts_cap}; incomplete months were withheld rather than drawn as a decline.\n"
              f"        This is an UPSTREAM data-lake problem, not a dashboard one — check the "
              f"receipts ingestion job.\n"
              f"        subs-data.js WAS written, so the dashboard is showing the truth; this "
              f"non-zero exit is the alarm.", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
