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
OUT_DIR         = Path(os.environ.get("SUBS_OUT_DIR",    HERE.parent / "KPI Dashboard v2 (Caio)"))
OUT_FILE        = OUT_DIR / "subs-data.js"

# Order is the order the chart stacks them in, biggest earner at the bottom. Chosen once
# here so the legend, the stack and any table agree without each deciding for itself.
FEATURE_LABEL = [
    ("INVENTORY",    "Inventory"),
    ("EMPLOYEE",     "Employee"),
    ("SALESHISTORY", "Sales history"),
    ("EMPSTORE",     "Employee + Store"),
    ("INTEGRATION",  "Integration"),
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


if __name__ == "__main__":
    main()
