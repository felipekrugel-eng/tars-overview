#!/usr/bin/env python3
"""
free_period.py — what the 15 free transacting days actually cost.

THE QUESTION. Loyverse Payments gave new merchants 15 days of free transactions. Those
charges are real volume with a real cost — we still paid interchange, scheme fees and Stripe
on every one — but they earned no application fee. They therefore sit in the margin table as
pure cost, and they are not a small effect: 7,135 of 43,931 succeeded charges (16.2%) and
$265,981 of $1,155,717 volume (23.0%).

That is enough to invert the headline. Published contribution is -$258, which reads as a book
that loses money on every dollar it processes. Price the free charges at what the merchants
would otherwise have paid and contribution is positive. The promotion is the difference
between those two readings, and nothing on the dashboard could show it before this.

WHAT THIS IS NOT. It is a COUNTERFACTUAL, not recovered revenue. Some of that volume exists
only because it was free, so this is an upper bound on what was given away, not a bill anyone
could have sent. The page says so.

PRICING, AS AGREED WITH FELIPE (2026-10-02), in precedence order:
  1. NAMED OVERRIDES — merchants on individually negotiated terms:
        The Fin              1.70% + 12c   (the new price, set 2026-10-02)
        KIM'S INC / JB expo  1.84% flat, no fixed fee
        Galo Entertainment   1.70% flat, no fixed fee
  2. DERIVED — a merchant who also has PAID charges is priced at their own observed rate,
     recovered by least squares over those charges. This is the truest counterfactual: it is
     literally what we billed them for comparable transactions. It is also self-validating —
     the three largest fit 2.000% + 5.0c with a maximum residual of half a cent, which is a
     contracted price, not a coincidence.
  3. STANDARD RATE — everyone else, by card funding:
        debit    1.99% + 15c
        credit   2.49% + 15c

PREPAID IS A THIRD BUCKET AND WAS NOT PRICED. 870 free charges ($21,580) are on prepaid
cards. Prepaid is priced as debit here, which is the usual treatment — prepaid settles at
debit interchange — but it IS an assumption, so it is counted separately and reported, rather
than folded silently into the debit number.

Writes nothing on its own; run.py calls build() and embeds the result in margins-data.js.
"""
from __future__ import annotations

import collections
import csv

# ── pricing ────────────────────────────────────────────────────────────────────────────
# Matched on a lowercased substring of MERCHANT_NAME, because the platform merchant ids are
# not stable across pulls and the names are distinctive enough to be unambiguous here. Each
# entry is (pct, fixed) with fixed in DOLLARS.
NAMED_OVERRIDES = [
    ("the fin",            (0.0170, 0.12)),
    ("kim's inc",          (0.0184, 0.00)),
    ("kims inc",           (0.0184, 0.00)),
    ("galo entertainment", (0.0170, 0.00)),
]
STANDARD = {
    "debit":   (0.0199, 0.15),
    "credit":  (0.0249, 0.15),
    # Not separately priced; treated as debit and reported as an assumption.
    "prepaid": (0.0199, 0.15),
}
STANDARD_FALLBACK = (0.0249, 0.15)   # unknown funding -> the dearer of the two, conservative

# A derived rate is only trusted inside a plausible band. Outside it the fit has latched onto
# noise — two charges of nearly equal size cannot separate a percentage from a fixed fee —
# and the merchant falls through to the standard rate instead.
DERIVED_MIN_CHARGES = 3
DERIVED_PCT_RANGE = (0.005, 0.05)
DERIVED_FIXED_RANGE = (-0.02, 0.60)


def _fit(pairs):
    """Least squares fee = pct*amount + fixed over (amount, fee) pairs."""
    n = len(pairs)
    if n < DERIVED_MIN_CHARGES:
        return None
    sx = sum(a for a, _ in pairs)
    sy = sum(f for _, f in pairs)
    sxx = sum(a * a for a, _ in pairs)
    sxy = sum(a * f for a, f in pairs)
    den = n * sxx - sx * sx
    if abs(den) < 1e-9:          # every charge the same size: pct and fixed are inseparable
        return None
    pct = (n * sxy - sx * sy) / den
    fixed = (sy - pct * sx) / n
    if not (DERIVED_PCT_RANGE[0] < pct < DERIVED_PCT_RANGE[1]):
        return None
    if not (DERIVED_FIXED_RANGE[0] < fixed < DERIVED_FIXED_RANGE[1]):
        return None
    resid = max(abs(f - (pct * a + fixed)) for a, f in pairs)
    return pct, fixed, resid


def _named(name):
    low = (name or "").strip().lower()
    for frag, price in NAMED_OVERRIDES:
        if frag in low:
            return price
    return None


def build(tx_path):
    """Return the free-period counterfactual, keyed for the dashboard."""
    with open(tx_path, newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r["STATUS"] == "succeeded"]

    def amt(r):
        return int(r["AMOUNT"]) / 100

    def fee(r):
        v = (r["APPLICATION_FEE_AMOUNT"] or "").strip()
        return int(v) / 100 if v else 0.0

    paid_by = collections.defaultdict(list)
    for r in rows:
        if fee(r) > 0:
            paid_by[r["MERCHANT_NAME"]].append((amt(r), fee(r)))

    merchants = {}
    months = collections.defaultdict(lambda: dict(n=0, vol=0.0, forgone=0.0))
    prepaid = dict(n=0, vol=0.0, forgone=0.0)
    basis_n = collections.Counter()

    for r in rows:
        if fee(r) > 0:
            continue                                  # not free; nothing to recover
        name = r["MERCHANT_NAME"] or r["PLATFORM_MERCHANT_ID"]
        funding = (r["CARD_FUNDING"] or "").strip().lower()

        price = _named(name)
        basis = "negotiated"
        if price is None:
            f = _fit(paid_by.get(name, []))
            if f:
                price, basis = (f[0], f[1]), "derived"
            else:
                price = STANDARD.get(funding, STANDARD_FALLBACK)
                basis = "standard"

        a = amt(r)
        would_have = price[0] * a + price[1]
        m = r["CREATED_AT"][:7]

        slot = merchants.setdefault(name, dict(
            name=name, cc=(r.get("MERCHANT_COUNTRY") or "").upper(),
            n=0, vol=0.0, forgone=0.0, basis=basis,
            pct=round(price[0], 6), fixed=round(price[1], 4),
            first=r["CREATED_AT"][:10], last=r["CREATED_AT"][:10]))
        slot["n"] += 1
        slot["vol"] += a
        slot["forgone"] += would_have
        slot["first"] = min(slot["first"], r["CREATED_AT"][:10])
        slot["last"] = max(slot["last"], r["CREATED_AT"][:10])
        # A merchant priced per-funding has no single rate, so the stored pct/fixed is only
        # meaningful for negotiated and derived merchants. Flagged rather than averaged.
        if basis == "standard" and slot["basis"] == "standard":
            slot["pct"] = None
            slot["fixed"] = None

        months[m]["n"] += 1
        months[m]["vol"] += a
        months[m]["forgone"] += would_have
        basis_n[basis] += 1
        if funding == "prepaid":
            prepaid["n"] += 1
            prepaid["vol"] += a
            prepaid["forgone"] += would_have

    for v in merchants.values():
        v["vol"] = round(v["vol"], 2)
        v["forgone"] = round(v["forgone"], 2)
    for v in months.values():
        for k in ("vol", "forgone"):
            v[k] = round(v[k], 2)

    total_n = sum(v["n"] for v in merchants.values())
    total_vol = round(sum(v["vol"] for v in merchants.values()), 2)
    total_forgone = round(sum(v["forgone"] for v in merchants.values()), 2)

    return {
        "freeTxns": total_n,
        "freeVolume": total_vol,
        "forgoneRevenue": total_forgone,
        # The rate we would have earned on this volume, for comparison with the book's
        # actual take rate — a free period does not just cost money, it drags the headline.
        "impliedTakeRate": (total_forgone / total_vol) if total_vol else None,
        "merchants": sorted(merchants.values(), key=lambda x: -x["forgone"]),
        "byMonth": {m: dict(v) for m, v in sorted(months.items())},
        "basisCounts": dict(basis_n),
        "prepaidAssumption": {
            "n": prepaid["n"], "volume": round(prepaid["vol"], 2),
            "forgone": round(prepaid["forgone"], 2),
            "note": "Prepaid cards were not separately priced and are charged at the debit "
                    "rate (1.99% + 15c), the usual treatment since prepaid settles at debit "
                    "interchange. Shown separately because it is an assumption, not an "
                    "agreed price.",
        },
        "pricing": {
            "negotiated": {"The Fin": "1.70% + 12c",
                           "KIM'S INC (JB expo)": "1.84% flat",
                           "Galo Entertainment": "1.70% flat"},
            "derived": "merchants with paid charges are priced at their own observed rate",
            "standard": {"debit": "1.99% + 15c", "credit": "2.49% + 15c",
                         "prepaid": "charged as debit"},
        },
        "caveat": "A COUNTERFACTUAL, NOT RECOVERABLE REVENUE. Some of this volume exists "
                  "only because it was free, so this is an upper bound on what the promotion "
                  "gave away, not a bill anyone could have sent.",
    }


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(build(sys.argv[1] if len(sys.argv) > 1 else "data/transactions.csv"),
                     indent=2)[:4000])
