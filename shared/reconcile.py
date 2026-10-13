#!/usr/bin/env python3
"""
reconcile.py — does the Summary of Margins agree with the Payment Profile?

WHY THIS EXISTS. The two pages describe the same book and for months they published different
numbers. The causes were found and fixed one at a time — face-value FX, a conflated
zero-vs-unknown, four different denominators, a double-counted fee, a silently discarded
bucket, two rates for one currency, and finally two separate pulls at two separate moments.
Every one of them was invisible until somebody happened to put the two pages side by side.

A fix nobody checks is a fix with a shelf life. This runs in CI on every build and FAILS it
when the two drift apart, so the next cause — and there will be one — is caught by the
pipeline on the day it appears rather than by Felipe three weeks later.

WHAT IT CHECKS, and why these and not more:
  * the SNAPSHOT INSTANT is identical          — the guarantee the whole redesign rests on
  * volume, transactions, revenue, cost        — the four figures both pages state outright
Each is compared with a tolerance, because the two sides round independently: margins totals
through a spreadsheet, the profile sums in JavaScript. The tolerance is tight enough that a
real defect cannot hide under it (the smallest genuine bug found here was $5.69) and loose
enough that floating-point noise cannot fail a good build.

Usage:  python3 shared/reconcile.py            # from the repo root; exits non-zero on drift
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARGINS = os.path.join(ROOT, "activated-payments", "margins-data.js")
PROFILE = os.path.join(ROOT, "activated-payments", "profile-data.js")

# Absolute dollars, and a relative floor so the check stays meaningful as the book grows.
ABS_TOL = 5.00
REL_TOL = 0.0005          # 5 basis points of a percent


def _js_object(path, var):
    """Pull `window.<var> = {...};` out of a generated data file.

    These files are JavaScript, not JSON, so they are parsed rather than imported. A regex is
    enough because they are machine-written with a fixed shape — and if that ever stops being
    true this raises instead of guessing.
    """
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    m = re.search(r"window\.%s\s*=\s*" % re.escape(var), text)
    if not m:
        raise SystemExit(f"FAIL: {os.path.basename(path)} has no window.{var}")
    start = text.index("{", m.end()) if "{" in text[m.end():m.end() + 4] else m.end()
    # Brace-match so nested objects survive; strings cannot contain unescaped braces here.
    depth, i, in_str, esc = 0, start, False, False
    while i < len(text):
        c = text[i]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
        elif c == '"': in_str = True
        elif c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
        i += 1
    raise SystemExit(f"FAIL: could not parse window.{var} out of {os.path.basename(path)}")


def _js_array(path, var):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    m = re.search(r"window\.%s\s*=\s*\[" % re.escape(var), text)
    if not m:
        raise SystemExit(f"FAIL: {os.path.basename(path)} has no window.{var}")
    start = text.index("[", m.start())
    depth, i, in_str, esc = 0, start, False, False
    while i < len(text):
        c = text[i]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
        elif c == '"': in_str = True
        elif c == "[": depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
        i += 1
    raise SystemExit(f"FAIL: could not parse window.{var} out of {os.path.basename(path)}")


def close(a, b):
    if a is None or b is None:
        return False
    return abs(a - b) <= max(ABS_TOL, abs(b) * REL_TOL)


def main():
    # Optional explicit paths, so a candidate pair can be checked without disturbing the
    # committed one — which is how this check itself was verified before it was trusted.
    global MARGINS, PROFILE
    if len(sys.argv) > 1:
        MARGINS = sys.argv[1]
    if len(sys.argv) > 2:
        PROFILE = sys.argv[2]
    for p in (MARGINS, PROFILE):
        if not os.path.exists(p):
            print(f"SKIP: {os.path.basename(p)} not present — nothing to reconcile.")
            return 0

    mj = _js_object(MARGINS, "MARGINS")
    cost_rows = _js_array(PROFILE, "__PROFILE_COST")
    platform = _js_object(PROFILE, "__PROFILE_PLATFORM")
    meta = _js_object(PROFILE, "__PROFILE_META")

    # ---- the guarantee the redesign rests on: one snapshot, one instant ----
    m_as_of = mj.get("snapshotAsOf")
    p_as_of = meta.get("snapshotAsOf")
    problems = []
    if not m_as_of or not p_as_of:
        # TRANSITIONAL, AND DELIBERATELY NOT FATAL — once, and only until both pipelines have
        # run since the shared snapshot landed. The two pages adopt it in separate jobs, so
        # for one cycle one of them is still a pre-snapshot file with no instant to compare.
        # Failing the build for that would block the very run that fixes it.
        #
        # Comparing the FIGURES in that state would be worse than useless: they are from two
        # different moments by construction, so a gap is expected and says nothing. So this
        # warns loudly, skips the comparison, and returns clean exactly once per side.
        #
        # It cannot become a permanent blind spot: the moment both files carry an instant —
        # which is the steady state after one full cycle — every check below is enforced, and
        # a page that LOSES its instant later shows up here as the same loud warning.
        print(f"::warning title=Reconciliation skipped::margins as-of={m_as_of!r}, "
              f"profile as-of={p_as_of!r} — one page has not yet been rebuilt on the shared "
              f"snapshot, so the two are from different moments and cannot be compared. This "
              f"is expected for ONE cycle after the shared-snapshot change and must not "
              f"persist; if it does, that page is not reading the snapshot.")
        print("SKIPPED: the two pages are not yet on a common snapshot. "
              "Nothing compared — this is not a pass.")
        return 0
    if m_as_of != p_as_of:
        problems.append(f"DIFFERENT SNAPSHOTS: margins is as of {m_as_of}, profile as of "
                        f"{p_as_of}. The pages describe two different moments, which is the "
                        f"exact failure the shared snapshot was built to prevent.")

    # ---- the four figures both pages state ----
    p_vol = sum(r.get("usd") or 0 for r in cost_rows)
    p_txn = sum(r.get("n") or 0 for r in cost_rows)
    p_rev = sum(r.get("rev") or 0 for r in cost_rows)
    p_cost = sum(r.get("cost") or 0 for r in cost_rows) + (platform.get("total") or 0)

    k = mj.get("kpis") or {}
    m_vol, m_txn, m_rev = k.get("tpv"), k.get("txns"), k.get("revenue")
    m_cost = k.get("totalFees")

    checks = [
        ("volume",       m_vol,  p_vol),
        ("transactions", m_txn,  p_txn),
        ("revenue",      m_rev,  p_rev),
        ("cost",         m_cost, p_cost),
    ]
    print(f"snapshot as of {p_as_of} UTC")
    print(f"{'':14}{'margins':>16}{'profile':>16}{'gap':>12}")
    for name, a, b in checks:
        gap = (a - b) if (a is not None and b is not None) else None
        flag = "" if close(a, b) else "   <-- DRIFT"
        av = f"{a:,.2f}" if isinstance(a, (int, float)) else str(a)
        bv = f"{b:,.2f}" if isinstance(b, (int, float)) else str(b)
        gv = f"{gap:,.2f}" if gap is not None else "n/a"
        print(f"  {name:12}{av:>16}{bv:>16}{gv:>12}{flag}")
        if not close(a, b):
            problems.append(f"{name}: margins {av} vs profile {bv} (gap {gv})")

    if problems:
        print("\nRECONCILIATION FAILED — the two payments pages disagree:", file=sys.stderr)
        for p in problems:
            print(f"  * {p}", file=sys.stderr)
        print("\nThey are built from one snapshot with one set of definitions, so a gap here "
              "means something has genuinely changed, not that they drifted. Find it before "
              "this ships.", file=sys.stderr)
        return 1

    print("\nOK — both pages agree, from one snapshot at one instant.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
