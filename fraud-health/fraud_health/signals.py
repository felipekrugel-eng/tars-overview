"""Deterministic risk signals computed from warehouse data alone.

Scope, and why it is deliberately narrow
----------------------------------------
This module may only award risk points for an ANOMALY IT ACTUALLY OBSERVED. It never
awards points because something could not be verified — that is the inverted-trust error
the v2 methodology exists to undo, and it is what made 300-odd legacy merchants look
"high risk" when all that had happened was that a first-pass web search came back thin.

Everything this module cannot see (legal registration, licensing, premises, real operating
history, representative identity) stays at 0 and is written into `unverified`, lowering
`reviewCompleteness`. A reviewer closes those gaps through `evidence.py`.

So a brand-new, unremarkable merchant scores near 0 here and is published as
`automated-signals-only` with low confidence — correctly meaning "nothing alarming
observed yet, and most of the file is still unchecked".
"""

from __future__ import annotations

import collections
import re
from dataclasses import dataclass, field
from typing import Any

from .ledger import AccountLedger

# Free/consumer mail providers. Using one is extremely common among genuine micro-
# merchants, so on its own it is NOT an anomaly and scores nothing. It is recorded only
# because it means the email domain cannot corroborate the business.
FREEMAIL = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com",
    "live.com", "msn.com", "comcast.net", "me.com", "mail.com", "protonmail.com",
    "ymail.com", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net", "gmx.com",
}

# Domains that exist to be thrown away. These ARE an affirmative anomaly on a merchant
# account taking card payments.
DISPOSABLE = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
    "throwawaymail.com", "yopmail.com", "trashmail.com", "sharklasers.com",
    "temp-mail.org", "getnada.com", "dispostable.com", "maildrop.cc",
}


@dataclass
class Signal:
    """One observed anomaly, the dimension it loads onto, and its weight."""

    dimension: str
    points: int
    statement: str


@dataclass
class SignalResult:
    accountId: str
    signals: list[Signal] = field(default_factory=list)
    verified: list[str] = field(default_factory=list)
    unverified: list[str] = field(default_factory=list)
    contradictions: list[str] = field(default_factory=list)

    def dimensions(self, keys: list[str], maxima: dict[str, int]) -> dict[str, int]:
        dims = {k: 0 for k in keys}
        for signal in self.signals:
            if signal.dimension in dims:
                dims[signal.dimension] += signal.points
        # Never exceed a dimension's ceiling: the methodology bounds each one.
        return {k: min(v, maxima[k]) for k, v in dims.items()}


def _domain(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    return email.rsplit("@", 1)[1].strip().lower()


def _norm_name(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


class Population:
    """Cross-account view used for linkage signals.

    Linkage is computed over the whole connected-account population, not just the cohort,
    because a new account's riskiest property is often its relationship to an existing one.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.by_account = {r["acct"]: r for r in rows if r.get("acct")}
        self.by_email: dict[str, list[str]] = collections.defaultdict(list)
        self.by_owner: dict[str, list[str]] = collections.defaultdict(list)
        self.by_name_country: dict[tuple[str, str], list[str]] = collections.defaultdict(list)
        for row in rows:
            account_id = row.get("acct")
            if not account_id:
                continue
            email = (row.get("email") or "").strip().lower()
            if email:
                self.by_email[email].append(account_id)
            owner = row.get("mid")
            if owner:
                self.by_owner[str(owner)].append(account_id)
            name = _norm_name(row.get("name"))
            if name:
                self.by_name_country[(name, row.get("country") or "")].append(account_id)


def evaluate(
    account_id: str,
    population: Population,
    ledger_entry: AccountLedger | None,
    kyc_blockers: dict[str, list[str]] | None = None,
) -> SignalResult:
    """Compute observable signals for one account."""
    result = SignalResult(accountId=account_id)
    row = population.by_account.get(account_id)
    if row is None:
        result.unverified.append(
            "Account is not present in the current activation dataset; no warehouse "
            "signals could be computed."
        )
        return result

    email = (row.get("email") or "").strip().lower()
    domain = _domain(email)

    # ---------------------------------------------------------------- contact
    if domain and domain in DISPOSABLE:
        result.signals.append(
            Signal("contact", 8, f"Account email uses a disposable-mail domain ({domain}).")
        )
        result.contradictions.append(
            f"Disposable-mail domain {domain} on a live card-accepting merchant account."
        )
    elif domain and domain in FREEMAIL:
        result.unverified.append(
            f"Contact email is a consumer mailbox ({domain}), so the email domain does "
            "not corroborate the business. Common for micro-merchants; not scored."
        )
    elif domain:
        result.verified.append(f"Account email uses a business domain ({domain}).")
        result.unverified.append(
            f"Ownership and age of {domain} have not been checked against a registrar."
        )

    # ---------------------------------------------------------------- network
    shared_email = [a for a in population.by_email.get(email, []) if a != account_id]
    if shared_email:
        result.signals.append(
            Signal(
                "network",
                min(8, 3 + 2 * len(shared_email)),
                f"Email address is shared with {len(shared_email)} other connected "
                f"account(s): {', '.join(sorted(shared_email)[:5])}.",
            )
        )
        result.contradictions.append(
            f"Same contact email appears on {len(shared_email) + 1} connected accounts."
        )

    owner = str(row.get("mid")) if row.get("mid") else None
    shared_owner = [a for a in population.by_owner.get(owner, []) if a != account_id] if owner else []
    if shared_owner:
        result.signals.append(
            Signal(
                "network",
                min(6, 2 * len(shared_owner)),
                f"Loyverse owner id {owner} also owns {len(shared_owner)} other "
                f"connected account(s).",
            )
        )

    name_key = (_norm_name(row.get("name")), row.get("country") or "")
    shared_name = [a for a in population.by_name_country.get(name_key, []) if a != account_id]
    if shared_name:
        result.signals.append(
            Signal(
                "identity",
                min(5, 2 * len(shared_name)),
                f"Business name and country match {len(shared_name)} other connected "
                f"account(s).",
            )
        )

    # --------------------------------------------------------------- behavior
    if ledger_entry is not None:
        enables = [t for t in ledger_entry.transitions if t["to"] == "Enabled"]
        disables = [t for t in ledger_entry.transitions if t["from"] == "Enabled"]
        if len(enables) > 1 or disables:
            result.signals.append(
                Signal(
                    "behavior",
                    min(6, 2 * (len(enables) + len(disables) - 1)),
                    f"Enablement has flipped {len(ledger_entry.transitions)} time(s): "
                    f"{len(enables)} enable(s), {len(disables)} disable(s).",
                )
            )
            result.contradictions.append(
                "Account has been enabled and disabled more than once; check why "
                "Stripe reversed the earlier decision."
            )
        if ledger_entry.lastObservedStatus == "Rejected":
            result.signals.append(
                Signal("behavior", 6, "Account is currently in a Rejected state.")
            )

    # Transacting while not enabled to take charges is contradictory.
    receipts = row.get("pos_receipts") or 0
    card_vol = row.get("card_vol_usd") or 0
    if row.get("status") != "Enabled" and card_vol:
        result.signals.append(
            Signal("behavior", 5, "Card volume recorded while the account is not enabled.")
        )
        result.contradictions.append("Card volume present on a non-enabled account.")

    # ----------------------------------------------------------- what is known
    if row.get("status") == "Enabled":
        result.verified.append(
            "Stripe reports charges_enabled = true for this account (warehouse share)."
        )
    if row.get("btype"):
        result.verified.append(f"Stripe legal entity type is recorded as {row['btype']}.")
    if receipts:
        result.verified.append(
            f"Loyverse POS activity is present: {receipts} receipt(s), "
            f"last sale {row.get('last_sale') or 'unknown'}."
        )
    else:
        result.unverified.append(
            "No Loyverse POS receipt history is linked to this account, so trading "
            "activity could not be corroborated from our own data."
        )

    blockers = (kyc_blockers or {}).get(email)
    if blockers:
        result.unverified.append(
            "Stripe still lists outstanding onboarding requirements: " + "; ".join(blockers) + "."
        )

    # The dimensions this module structurally cannot assess. Stated every time so a 0 is
    # never mistaken for a clean bill of health.
    result.unverified.extend(
        [
            "Legal registration and company standing have not been checked against a "
            "government register.",
            "Operating premises, licensing and permits have not been verified.",
            "Representative identity and bank-account ownership have not been "
            "independently confirmed.",
            "Independent operating history and reputation have not been researched.",
        ]
    )
    return result


# Two different ideas, deliberately not conflated.
#
# SCORABLE: dimensions where a warehouse signal CAN fire. A disposable email domain is a
# contact anomaly; a name collision is an identity anomaly. Points may land here.
SCORABLE = {"contact", "network", "identity", "behavior"}
#
# COMPLETABLE: dimensions the warehouse can genuinely finish checking, because we hold
# the whole population and the whole status history. Linkage across every connected
# account, and enablement/transaction behaviour, really are fully checked here.
#
# `contact` and `identity` are NOT in this set: knowing an email is a gmail address says
# nothing about whether phone, website and address cohere, and a name-collision check is
# not representative identity verification. Counting them would have reported a merchant
# nobody has looked at as 50% reviewed. It is 25%.
COMPLETABLE = {"network", "behavior"}

# Retained for callers that want the scoring set.
ASSESSABLE = COMPLETABLE


def completeness(assessed: set[str], all_keys: list[str]) -> int:
    """Percentage of the methodology's dimensions backed by some evidence."""
    if not all_keys:
        return 0
    return round(100 * len(assessed & set(all_keys)) / len(all_keys))
