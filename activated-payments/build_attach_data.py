#!/usr/bin/env python3
"""
build_attach_data.py — Loyverse Payments attachment rate, daily.

Of the money crossing a till, how much comes through Loyverse Payments. The definition is
merchant-base-automation/queries/q1_base.sql's PAYMENTS_ATTACH_RATE_L30D — the one the
campaign already runs on — given a date axis by sql/attach_rate_daily.sql. This script does
the aggregating and nothing else: one place defines the metric, one place aggregates it.

THREE THINGS IT COMPUTES, because the average hides the thing worth acting on:

  BLENDED   total LP volume / total till volume. Dominated by the biggest tills, which is
            the right read for "how much of the money is ours".
  MEDIAN    the middle merchant's own rate. The right read for "what does a typical
            merchant do". These sat 19 points apart when this was built (31.9% against
            51.4%), and a page showing only one of them would mislead about the other.
  SPREAD    how many merchants are effectively all-in against how many barely use it. At
            build time: 16 merchants above 95%, 26 below 25%, out of 90. That bimodality
            is the finding; an average of 32% describes almost nobody.

The blended figure reconciles with PAYMENTS_ATTACH_RATE_L30D in the committed campaign
export: 31.9% here against 32.1% there. The median runs higher, 51.4% against 44.9%, and
that gap is the intended effect of counting each merchant only from their first Loyverse
Payments charge — the export divides by their whole recent till volume, including the days
before they had a terminal.

ROLLING, NOT RAW. At ~70 transacting merchants a single day swings wildly and is undefined
whenever the tills are shut, so the published line is a 7-day rolling rate — summed over
the window rather than an average of daily rates, so a quiet Sunday cannot weigh the same
as a busy Saturday. The raw daily series ships too, for the chart to draw faintly behind.

Writes activated-payments/attach-data.js as window.__PAY_ATTACH.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ATTACH_CSV = Path(os.environ.get("ATTACH_CSV", HERE / "work" / "attach_rate_daily.csv"))
OUT_FILE = Path(os.environ.get("ATTACH_OUT", HERE / "attach-data.js"))

ROLL = 7          # days in the rolling window
HIGH = 0.95       # "effectively all-in"
LOW = 0.25        # "barely using it"


def main() -> None:
    if not ATTACH_CSV.exists():
        sys.exit(f"[attach] MISSING {ATTACH_CSV}")
    df = pd.read_csv(ATTACH_CSV)
    df.columns = [c.upper() for c in df.columns]
    df["D"] = pd.to_datetime(df["D"]).dt.strftime("%Y-%m-%d")

    # ---- the settling window ----------------------------------------------------------
    # THE TWO SIDES OF THIS RATIO DO NOT ARRIVE TOGETHER, and that is the single most
    # dangerous thing about the metric. Stripe volume is current within minutes; the
    # receipts feed runs about two days behind. Published raw, the newest days therefore
    # show a numerator against a partial denominator and the rate climbs — 119% on
    # 2026-09-20, with till volume at 37% of its trailing median and Stripe volume normal.
    # A tile reading "attachment is surging" off the back of a lagging feed is worse than
    # no tile.
    #
    # Two guards, because a fixed lag alone is brittle:
    #   * drop the last SETTLE_DAYS complete days outright — measured, not assumed, from
    #     the shape above
    #   * then keep dropping from the tail while a day's till volume is under half its
    #     trailing median, which catches a feed that has stalled for longer than usual
    today = pd.Timestamp.utcnow().strftime("%Y-%m-%d")
    df = df[df["D"] < today]
    if df.empty:
        sys.exit("[attach] no complete days in the input")

    SETTLE_DAYS = 2
    daily_pos = df.groupby("D")["POS_USD"].sum().sort_index()
    days_all = daily_pos.index.tolist()
    keep = days_all[:-SETTLE_DAYS] if len(days_all) > SETTLE_DAYS else []
    if not keep:
        sys.exit("[attach] not enough settled days")
    # Trailing median from a window that is itself settled, so a stalled feed cannot lower
    # the bar it is being judged against.
    ref = daily_pos.loc[keep[-40:-10]] if len(keep) > 40 else daily_pos.loc[keep]
    floor = float(ref.median()) * 0.5 if len(ref) else 0.0
    dropped_extra = 0
    while len(keep) > 1 and floor > 0 and float(daily_pos.loc[keep[-1]]) < floor:
        keep.pop()
        dropped_extra += 1
    print(f"[attach] settling window: dropped {SETTLE_DAYS} day(s) by rule"
          + (f" plus {dropped_extra} more below half the trailing median" if dropped_extra else "")
          + f"; published through {keep[-1]}")
    df = df[df["D"].isin(keep)]

    # ---- daily totals -----------------------------------------------------------------
    daily = df.groupby("D").agg(lp=("LP_USD", "sum"), pos=("POS_USD", "sum"),
                                txns=("LP_TXNS", "sum"),
                                merchants=("MERCHANT_ID", "nunique")).reset_index()
    daily = daily.sort_values("D").reset_index(drop=True)

    # Rolling sums, then the ratio — NOT a rolling average of daily ratios. A day with $20
    # of till volume would otherwise carry the same weight as a day with $20,000.
    daily["lp_roll"] = daily["lp"].rolling(ROLL, min_periods=1).sum()
    daily["pos_roll"] = daily["pos"].rolling(ROLL, min_periods=1).sum()

    def rate(num, den):
        # Capped at 100, the same rule applied per merchant: a blended rate above 100% means
        # the receipts feed has not caught up with Stripe, not that a till took more on our
        # rails than it took in total. Left uncapped it would pull every rolling window and
        # the headline upward.
        return round(min(num / den * 100, 100.0), 2) if den and den > 0 else None

    # ---- per-merchant rates, for the median and the spread ----------------------------
    # Capped at 100% per merchant, as q1_base.sql does: a rate above 100 is a data fault
    # (a charge the receipts feed has not caught up with) and must not pull the median up.
    def merchant_rates(window_days):
        w = df[df["D"].isin(window_days)]
        g = w.groupby("MERCHANT_ID").agg(lp=("LP_USD", "sum"), pos=("POS_USD", "sum"))
        g = g[g["pos"] > 0]
        if g.empty:
            return pd.Series(dtype=float)
        return (g["lp"] / g["pos"]).clip(upper=1.0)

    days = daily["D"].tolist()
    rows = []
    for i, d in enumerate(days):
        win = days[max(0, i - ROLL + 1): i + 1]
        mr = merchant_rates(win)
        rows.append({
            "d": d,
            "lp": round(float(daily.at[i, "lp"]), 2),
            "pos": round(float(daily.at[i, "pos"]), 2),
            "raw": rate(daily.at[i, "lp"], daily.at[i, "pos"]),
            "roll": rate(daily.at[i, "lp_roll"], daily.at[i, "pos_roll"]),
            "med": round(float(mr.median()) * 100, 2) if len(mr) else None,
            "n": int(len(mr)),
        })

    # ---- headline, on the same 30-day window the campaign file uses -------------------
    last30 = days[-30:]
    w30 = df[df["D"].isin(last30)]
    lp30, pos30 = float(w30["LP_USD"].sum()), float(w30["POS_USD"].sum())
    mr30 = merchant_rates(last30)
    blended30 = rate(lp30, pos30)
    median30 = round(float(mr30.median()) * 100, 2) if len(mr30) else None

    # Prior 30 days, for the tile's change figure. Like-for-like window, not month-to-date
    # against a full month, which is the comparison that always reads as a collapse.
    prev30 = days[-60:-30]
    wp = df[df["D"].isin(prev30)]
    blended_prev = rate(float(wp["LP_USD"].sum()), float(wp["POS_USD"].sum()))

    spread = {
        "high": int((mr30 >= HIGH).sum()),
        "low": int((mr30 < LOW).sum()),
        "total": int(len(mr30)),
    }
    # The distribution itself, in ten-point bands, because the bimodality is the story and
    # a single number cannot carry it.
    bands = []
    for lo in range(0, 100, 10):
        hi = lo + 10
        sel = (mr30 * 100 >= lo) & (mr30 * 100 < hi if hi < 100 else mr30 * 100 <= 100)
        bands.append({"lo": lo, "hi": hi, "n": int(sel.sum())})

    out = {
        "generatedAt": pd.Timestamp.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "rollDays": ROLL,
        "lastDay": days[-1] if days else None,
        "headline": {
            "blended": blended30, "median": median30,
            "blendedPrev": blended_prev,
            "lp": round(lp30, 2), "pos": round(pos30, 2),
            "merchants": spread["total"],
            "opportunity": round(max(pos30 - lp30, 0), 2),
        },
        "spread": spread,
        "bands": bands,
        "daily": rows,
    }

    banner = (
        "// Loyverse Payments attachment rate — generated by activated-payments/build_attach_data.py.\n"
        "// Do NOT edit by hand.\n"
        "//\n"
        "// Of the money crossing a till, how much came through Loyverse Payments. Same definition\n"
        "// as PAYMENTS_ATTACH_RATE_L30D in merchant-base-automation/queries/q1_base.sql, which the\n"
        "// campaign runs on — change one and change the other.\n"
        "//\n"
        "// window.__PAY_ATTACH = {\n"
        "//   headline : {blended, median, blendedPrev, lp, pos, merchants, opportunity} over the last\n"
        "//              30 complete days. BLENDED is volume-weighted and MEDIAN is the middle\n"
        "//              merchant; they sat 13 points apart at build time and mean different things.\n"
        "//              `opportunity` is till volume NOT running through us — the prize.\n"
        "//   spread   : {high, low, total} — merchants at 95%+ and under 25%. The base is bimodal;\n"
        "//              the average describes almost nobody.\n"
        "//   bands[]  : {lo, hi, n} — the distribution in ten-point bands.\n"
        "//   daily[]  : {d, lp, pos, raw, roll, med, n}. `roll` is a 7-day rolling rate computed\n"
        "//              from rolling SUMS, not an average of daily rates, so a quiet Sunday cannot\n"
        "//              weigh as much as a busy Saturday. `raw` is the single day and is noisy by\n"
        "//              nature at this merchant count — draw it faintly if at all. Either is null\n"
        "//              when there was no till volume that day: no attachment and nothing to\n"
        "//              attach to are different answers.\n"
        "//   Each merchant counts only from their FIRST Loyverse Payments charge onward, so a\n"
        "//   merchant enters numerator and denominator on the same day and the rate cannot drift\n"
        "//   upward merely because old pre-terminal volume ages out.\n"
        "// }\n"
    )
    OUT_FILE.write_text(banner + "window.__PAY_ATTACH = " + json.dumps(out, separators=(",", ":")) + ";\n",
                        encoding="utf-8")
    print(f"[attach] wrote {OUT_FILE} — {len(rows)} days, through {out['lastDay']}")
    print(f"[attach] last 30 days: blended {blended30}%  median {median30}%  "
          f"({spread['total']} merchants, {spread['high']} at {int(HIGH*100)}%+, {spread['low']} under {int(LOW*100)}%)")
    print(f"[attach] LP ${lp30:,.0f} of ${pos30:,.0f} till volume — ${out['headline']['opportunity']:,.0f} not on us")


if __name__ == "__main__":
    main()
