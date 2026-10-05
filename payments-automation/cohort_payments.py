#!/usr/bin/env python3
"""
cohort_payments.py — Loyverse Payments contribution by POS registration cohort.

THE COHORT IS THE POS COHORT. A merchant belongs to the month they registered with Loyverse,
NOT the month they opened a payments account. That is the whole point: it answers "which of
the merchants we acquired are now earning us payments revenue", which is a question about
acquisition, and it lets this sit in the same triangle as MRR, paying and active without the
rows meaning two different things in two different views.

Consequence worth expecting: the triangle is SPARSE and sits low and to the right. Loyverse
Payments only began processing in April 2026, so a merchant who registered in January 2024
and took their first card payment in September 2026 contributes at month of life 32 and
nowhere else. Columns to the left are structurally empty, not missing data. That shape is
itself the finding — it shows which acquisition cohorts the payments book is actually
monetising, and how long after registration that happens.

CONTRIBUTION, DEFINED EXACTLY AS THE MARGINS PAGE DEFINES IT:

    contribution = application fee  -  network fees  -  Stripe fees
                   (our revenue)      (pass-through)   (our platform cost)

Network fees (interchange, scheme, Amex) come per charge from the IC+ feed via
refresh_workbook.build_data, so this reuses that cost model rather than reimplementing it —
a cohort slice must not be able to drift from the margins table by inventing its own
definition of cost.

TWO APPORTIONMENTS, BOTH FLAGGED:
  * ALL Stripe fees are apportioned by share of volume. They are billed to the Loyverse
    platform account and carry no connected-account id, so they cannot be attributed to a
    merchant, let alone a cohort. The per-charge columns Q and R exist but are populated only
    on SETTLED charges, so using them would silently drop Stripe's cost on everything still
    settling. Any cohort's contribution is therefore part actual, part apportioned.
  * Charges still settling carry an ESTIMATED blended cost in `Tval` rather than an
    interchange/scheme/Amex split. Those are counted into the cost but reported separately,
    because an unsettled month understates cost and flatters contribution.

FREE TRANSACTING DAYS. A charge from the 15-day free period has revenue of zero and real
cost, so it drags its cohort negative. That is true and is left alone here — free_period.py
is the place that models the counterfactual, and mixing the two would make this file
impossible to reconcile against the margins table.
"""
from __future__ import annotations

import collections
import csv
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _month_diff(a: str, b: str) -> int:
    """Whole months from cohort `a` (YYYY-MM) to charge month `b` (YYYY-MM)."""
    ay, am = int(a[:4]), int(a[5:7])
    by, bm = int(b[:4]), int(b[5:7])
    return (by - ay) * 12 + (bm - am)


def build(tx_path, ic_path, account_cohort_path, stripe_fees_total=0.0):
    sys.path.insert(0, str(HERE))
    from refresh_workbook import build_data           # the one cost model

    cohort_of = {}
    with open(account_cohort_path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("POS_COHORT"):
                cohort_of[r["ACCOUNT_ID"]] = r["POS_COHORT"]

    # build_data keys its records by charge, but drops the account id, so the raw CSV is read
    # alongside it purely to recover charge -> account.
    acct_of = {}
    with open(tx_path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            acct_of[r["CHARGE_ID"]] = r["CHARGE_ACCOUNT_ID"]

    D = build_data(tx_path, ic_path)
    recs = [r for r in D["recs"] if r["J"] == "succeeded"]
    tpv_total = sum(r["E"] for r in recs)

    cells = collections.defaultdict(lambda: dict(
        txns=0, tpv=0.0, revenue=0.0, network=0.0, stripe=0.0,
        estCost=0.0, estimated=0, unmapped=0))
    unmapped_vol = 0.0
    unmapped_n = 0

    for r in recs:
        acct = acct_of.get(r["A"])
        coh = cohort_of.get(acct)
        if not coh:
            unmapped_n += 1
            unmapped_vol += r["E"]
            continue
        life = _month_diff(coh, r["B"][:7])
        if life < 0:
            # A charge before the merchant registered is impossible; if it appears, the
            # identity join is wrong and silently bucketing it would hide that.
            unmapped_n += 1
            unmapped_vol += r["E"]
            continue

        o = cells[(coh, life)]
        o["txns"] += 1
        o["tpv"] += r["E"]
        o["revenue"] += r["L"] or 0

        if r["kind"] == "actual":
            o["network"] += (r.get("M") or 0) + (r.get("N") or 0) + (r.get("O") or 0)
            # Stripe is NOT summed per charge here. Columns Q and R are populated only on
            # settled charges, so summing them would miss Stripe's fees on the 1,491 charges
            # still settling and leave this view $124 adrift of the margins page. The
            # workbook takes Stripe's total from the PLATFORM account's balance transactions,
            # which covers every charge, so the whole total is apportioned below by volume —
            # the same treatment the country and month splits already use, and for the same
            # reason: Stripe's fees carry no connected-account id at all.
            pass
        else:
            # STILL SETTLING. These carry a blended ESTIMATE in Tval rather than an
            # interchange/scheme/Amex split, and the workbook Summary — and therefore the
            # margins page — EXCLUDES it from the published fee total. Including it here
            # would make this view disagree with the page it sits beside by $758 on today's
            # data, and a cohort table that contradicts the headline discredits both.
            # So it is excluded, matching the published definition, and tracked separately
            # as the known understatement it is.
            o["estCost"] += r.get("Tval") or 0
            o["estimated"] += 1

    # Apportion the whole Stripe fee total by volume share.
    for (coh, life), o in cells.items():
        share = (o["tpv"] / tpv_total) if tpv_total else 0.0
        o["stripe"] += (stripe_fees_total or 0.0) * share
        o["contribution"] = o["revenue"] - o["network"] - o["stripe"]

    by_cohort = collections.defaultdict(dict)
    for (coh, life), o in cells.items():
        by_cohort[coh][life] = {
            "txns": o["txns"],
            "tpv": round(o["tpv"], 2),
            "revenue": round(o["revenue"], 2),
            "network": round(o["network"], 4),
            "stripe": round(o["stripe"], 4),
            "contribution": round(o["contribution"], 4),
            "estimated": o["estimated"],
            # What the still-settling charges are expected to cost, so a cohort heavy with
            # them can be read with the right amount of scepticism.
            "estCost": round(o["estCost"], 4),
        }

    # Flatten to the shape the triangle reads: cohort -> array indexed by month of life, so
    # it lines up with cohortTriangle.mrr / .paying / .active without any re-indexing.
    out = {}
    for coh, lives in by_cohort.items():
        n = max(lives) + 1
        out[coh] = {
            "contribution": [round(lives.get(i, {}).get("contribution", 0.0), 2) for i in range(n)],
            "tpv":          [round(lives.get(i, {}).get("tpv", 0.0), 2) for i in range(n)],
            "revenue":      [round(lives.get(i, {}).get("revenue", 0.0), 2) for i in range(n)],
            "txns":         [lives.get(i, {}).get("txns", 0) for i in range(n)],
        }

    tot_contrib = sum(sum(v["contribution"]) for v in out.values())
    tot_rev = sum(sum(v["revenue"]) for v in out.values())
    tot_tpv = sum(sum(v["tpv"]) for v in out.values())
    est = sum(o["estimated"] for o in cells.values())
    est_cost = sum(o["estCost"] for o in cells.values())

    return {
        "byCohort": out,
        "totals": {
            "contribution": round(tot_contrib, 2),
            "revenue": round(tot_rev, 2),
            "tpv": round(tot_tpv, 2),
            "txns": sum(o["txns"] for o in cells.values()),
        },
        "unmapped": {"txns": unmapped_n, "tpv": round(unmapped_vol, 2),
                     "note": "charges whose Stripe account could not be tied to a Loyverse "
                             "registration month; excluded from every cohort rather than "
                             "pooled into one"},
        "estimatedCharges": est,
        "estimatedCostExcluded": round(est_cost, 2),
        "basis": "POS registration cohort; contribution = application fee - network fees - "
                 "Stripe fees. Stripe's platform-level fees (Radar, Tap to Pay, payout, "
                 "terminal, account volume) carry no merchant id and are apportioned by "
                 "share of volume, so a cohort's contribution is part actual, part "
                 "apportioned.",
    }


if __name__ == "__main__":
    import json
    d = build("data/transactions.csv", "data/icplus_costs.csv", "data/account_cohort.csv",
              float(sys.argv[1]) if len(sys.argv) > 1 else 0.0)
    print(json.dumps(d["totals"], indent=2))
    print("unmapped:", d["unmapped"]["txns"], "charges,", d["unmapped"]["tpv"])
    print("cohorts:", len(d["byCohort"]))
