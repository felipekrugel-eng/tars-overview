"""Links between accounts that come from who they say they are, not what they charged.

The transaction detectors in cards.py find operators who move cards between
accounts. They cannot see an account that has not transacted yet — and the
Think Big investigation's most urgent finding was exactly that: Alesio Barquin,
created 23 Sep, terms accepted from the ring's Verizon line nine minutes later,
charges and payouts enabled, no payments yet. Nothing a transaction-based
detector does would ever have surfaced it.

So the same graph also carries identity edges, built from the fields the daily
activation pull already commits plus the private representative feed.

Street addresses, dates of birth and document data are deliberately not used
here. The activation pull carries city and state only, by design, and the
representative feed carries a name and Stripe's own KYC outcome. That is enough
to connect accounts without this package becoming a dossier.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .model import CONFIRMED, Edge, STRONG, SUSPECTED

# Consumer mailboxes are not an identity. Two merchants on gmail.com are not
# related; two merchants on the same *address* at gmail.com certainly are.
FREEMAIL = {
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "aol.com", "live.com", "msn.com", "comcast.net", "me.com", "proton.me",
    "protonmail.com", "ymail.com", "mail.com", "gmx.com",
}

# A website on one of these is not a business website, and a free-mail domain
# shared by two merchants says nothing at all.
GENERIC_HOSTS = FREEMAIL | {
    "facebook.com", "instagram.com", "linktr.ee", "sites.google.com",
    "wixsite.com", "squarespace.com", "shopify.com", "wordpress.com",
    "business.site", "google.com", "yelp.com", "linkedin.com",
}

# Onboarding within this window is only interesting alongside another signal.
# One hour. Measured: 16 pairs at 1h, 86 at 6h, 875 at 72h.
COORDINATED_ONBOARDING_SECONDS = 3600

# Legal-form suffixes carry no identifying information: "Central Diner LLC" and
# "Central Diner" are the same business name for linkage purposes.
_SUFFIXES = {"llc", "l", "c", "inc", "corp", "corporation", "co", "ltd",
             "limited", "lp", "llp", "the"}

# Names that identify nothing. "test" alone appears on 11 live accounts.
PLACEHOLDER_NAMES = {"test", "testing", "test test", "demo", "n a", "na", "none"}


def _norm_name(value):
    """Normalise a person or business name for comparison."""
    if not value:
        return ""
    words = re.sub(r"[^a-z0-9]+", " ", value.lower()).split()
    kept = [w for w in words if w not in _SUFFIXES]
    return " ".join(kept or words)



def _domain(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().lower()
    value = re.sub(r"^https?://", "", value).split("/")[0]
    return value.removeprefix("www.") or None


def load_accounts(activation_js: str | Path) -> dict[str, dict[str, Any]]:
    """Parse window.__ACT out of activated-payments/activation-data.js."""
    text = Path(activation_js).read_text(encoding="utf-8")
    match = re.search(r"window\.__ACT\s*=\s*(\[.*?\])\s*;", text, re.S)
    if not match:
        raise ValueError("window.__ACT not found in activation data")
    return {row["acct"]: row for row in json.loads(match.group(1)) if row.get("acct")}


def load_representatives(path: str | Path) -> dict[str, dict[str, Any]]:
    p = Path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("accounts", {})

def _pairs(groups, minimum=2, maximum=25):
    """Yield every account pair inside each group, skipping groups that are too big.

    A cap matters: without one, a single generic value ("test", a city with
    forty merchants) produces hundreds of meaningless edges and drowns the
    report. Caps below are set from measured group sizes on the live
    population, not from taste.
    """
    for value, accounts in groups.items():
        unique = sorted(set(accounts))
        if not minimum <= len(unique) <= maximum:
            continue
        for i, a in enumerate(unique):
            for b in unique[i + 1:]:
                yield value, a, b, len(unique)


def _timestamp(row):
    """Seconds since epoch for an account's onboarding, or None."""
    raw = row.get("connected_ts") or row.get("connected")
    if not raw:
        return None
    text = str(raw).strip().replace("Z", "")
    if "T" not in text:
        text += "T00:00:00"
    try:
        return int(datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")
                   .replace(tzinfo=timezone.utc).timestamp())
    except ValueError:
        return None


def identity_edges(accounts, representatives=None, names=None):
    """Every identity-based connection between accounts.

    Edge volumes below were measured against the full live population of 1,484
    activated accounts covering roughly seven months, so the numbers in the
    comments are what a reviewer should actually expect to see per sweep.
    """
    representatives = representatives or {}
    names = names or {}

    def label(acct):
        return names.get(acct) or (accounts.get(acct, {}) or {}).get("name") or acct

    by_email, by_owner, by_domain = defaultdict(list), defaultdict(list), defaultdict(list)
    by_descriptor, by_business, by_place = defaultdict(list), defaultdict(list), defaultdict(list)
    by_rep, by_mcc = defaultdict(list), defaultdict(list)

    for acct, row in accounts.items():
        email = (row.get("email") or "").strip().lower()
        if email:
            by_email[email].append(acct)
        owner = str(row.get("mid") or "").strip()
        if owner:
            by_owner[owner].append(acct)
        domain = _domain(row.get("url"))
        if domain and domain not in GENERIC_HOSTS:
            by_domain[domain].append(acct)
        descriptor = _norm_name(row.get("stmt"))
        if descriptor:
            by_descriptor[descriptor].append(acct)
        business = _norm_name(row.get("name"))
        if business and business not in PLACEHOLDER_NAMES:
            by_business[business].append(acct)
        city = (row.get("city") or "").strip().lower()
        state = (row.get("state") or "").strip().upper()
        mcc = str(row.get("mcc") or "").strip()
        if city and state and mcc:
            by_place[(city, state, mcc)].append(acct)
        rep = _norm_name((representatives.get(acct) or {}).get("name"))
        if rep:
            by_rep[rep].append(acct)
        stamp = _timestamp(row)
        if mcc and stamp is not None:
            by_mcc[mcc].append((stamp, acct))

    edges = []

    # Live volume: 3 pairs. An email address is an account credential, so two
    # accounts sharing one are the same hands by definition.
    for email, a, b, n in _pairs(by_email):
        edges.append(Edge(a=a, b=b, kind="shared-email", tier=CONFIRMED,
                          statement=(f"{label(a)} and {label(b)} use the same contact email "
                                     f"address, which appears on {n} accounts."),
                          evidence={"identifier": email, "accounts_sharing": n}))

    # Live volume: 1 pair.
    for owner, a, b, n in _pairs(by_owner):
        edges.append(Edge(a=a, b=b, kind="shared-owner", tier=CONFIRMED,
                          statement=(f"{label(a)} and {label(b)} are both operated from Loyverse "
                                     f"merchant account {owner}, which holds {n} payment accounts."),
                          evidence={"identifier": owner, "accounts_sharing": n}))

    # Live volume: 17 pairs. Free hosts and social profiles are excluded above,
    # so what is left is a domain somebody had to register.
    for domain, a, b, n in _pairs(by_domain, maximum=6):
        edges.append(Edge(a=a, b=b, kind="shared-website", tier=STRONG,
                          statement=(f"{label(a)} and {label(b)} declare the same business "
                                     f"website ({domain})."),
                          evidence={"identifier": domain, "accounts_sharing": n}))

    # Live volume: 34 pairs. Two businesses that bill cardholders under one name.
    for descriptor, a, b, n in _pairs(by_descriptor, maximum=6):
        edges.append(Edge(a=a, b=b, kind="shared-descriptor", tier=STRONG,
                          statement=(f"{label(a)} and {label(b)} bill cardholders under the same "
                                     f"statement descriptor, shared by {n} accounts."),
                          evidence={"identifier": descriptor, "accounts_sharing": n}))

    # Live volume: about 5 pairs once placeholder names are dropped.
    for business, a, b, n in _pairs(by_business, maximum=4):
        edges.append(Edge(a=a, b=b, kind="shared-business-name", tier=STRONG,
                          statement=(f"{label(a)} and {label(b)} are registered under the same "
                                     f"business name once legal suffixes are removed."),
                          evidence={"identifier": business, "accounts_sharing": n}))

    # The representative's name links the accounts but is deliberately kept out
    # of the statement: a reviewer can action the link without being handed the
    # person's name in a report that travels.
    for rep, a, b, n in _pairs(by_rep, maximum=6):
        edges.append(Edge(a=a, b=b, kind="shared-representative", tier=STRONG,
                          statement=(f"{label(a)} and {label(b)} name the same individual as the "
                                     f"account representative; that name appears on {n} accounts."),
                          evidence={"identifier": "rep:" + rep, "accounts_sharing": n}))

    # Live volume: 21 pairs. Town alone links 384 pairs and is useless; town
    # plus the same merchant category is specific enough to be worth a look,
    # and is never more than a lead.
    for (city, state, mcc), a, b, n in _pairs(by_place, maximum=4):
        edges.append(Edge(a=a, b=b, kind="same-town-and-trade", tier=SUSPECTED,
                          statement=(f"{label(a)} and {label(b)} are registered in "
                                     f"{city.title()}, {state} under the same merchant category "
                                     f"({mcc}); {n} accounts share that combination."),
                          evidence={"identifier": f"{city}|{state}|{mcc}", "accounts_sharing": n}))

    # Live volume: 16 pairs over seven months. This is the only detector in the
    # package that can fire on an account which has never taken a payment, and
    # it is the one that would have flagged Montalto and Deleon on 19 September
    # — created 30 minutes apart, same trade, before either charged a card.
    # Widening the window to 72 hours produces 875 pairs and is worthless.
    for mcc, entries in by_mcc.items():
        entries.sort()
        for i, (t_a, a) in enumerate(entries):
            for t_b, b in entries[i + 1:]:
                gap = t_b - t_a
                if gap > COORDINATED_ONBOARDING_SECONDS:
                    break
                minutes = round(gap / 60)
                edges.append(Edge(a=a, b=b, kind="coordinated-onboarding", tier=SUSPECTED,
                                  statement=(f"{label(a)} and {label(b)} both completed onboarding "
                                             f"in merchant category {mcc} {minutes} minutes apart."),
                                  evidence={"identifier": f"mcc:{mcc}", "gap_seconds": gap,
                                            "first": a, "second": b}))

    return edges


def onboarding_profile(accounts, members):
    """How the members of a cluster were opened, as a cluster-level annotation."""
    stamps = sorted(
        ((acct, _timestamp(accounts.get(acct) or {})) for acct in members
         if _timestamp(accounts.get(acct) or {}) is not None),
        key=lambda pair: pair[1],
    )
    if len(stamps) < 2:
        return None
    span = stamps[-1][1] - stamps[0][1]
    statuses = {}
    for acct in members:
        status = (accounts.get(acct) or {}).get("status")
        if status:
            statuses.setdefault(status, []).append(acct)
    return {
        "order": [acct for acct, _ in stamps],
        "span_seconds": span,
        "span_days": round(span / 86400, 1),
        "burst": span <= COORDINATED_ONBOARDING_SECONDS,
        "statuses": statuses,
        "still_enabled": sorted(statuses.get("Enabled", [])),
    }
