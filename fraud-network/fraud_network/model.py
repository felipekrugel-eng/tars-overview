"""Core types for the cross-account linkage graph.

The whole point of this package is to say *how sure we are* about a link, because
the Think Big investigation turned on exactly that distinction: a shared Verizon
FiOS line is near-conclusive, a shared mobile-carrier IP is a lead, and a shared
card ``last4`` is often pure coincidence (the platform history contains 7,759
distinct card keys that appear on two or more accounts, nearly all of them
collisions between unrelated merchants).

So every edge carries a tier, and only the top two tiers are allowed to merge
accounts into an investigation. Nothing here ever decides to restrict an
account; the output is evidence for a human.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any

# ---------------------------------------------------------------- tiers
# CONFIRMED: the identifier is unique by construction and matched exactly.
#   A Stripe card fingerprint, a terminal reader id, a device UUID, a bank
#   account fingerprint, a Loyverse owner id, an exact email address. If two
#   accounts share one of these, they share a physical or logical object.
# STRONG: a quasi-identifier whose co-occurrence is statistically implausible,
#   or a behaviour that is hard to produce by accident (a card declined at one
#   account and accepted at a sibling minutes later).
# SUSPECTED: a real but individually weak signal — same town, same mobile
#   carrier egress IP, similar trading name.
# WEAK: recorded for completeness, never contributes to a cluster.
CONFIRMED = "confirmed"
STRONG = "strong"
SUSPECTED = "suspected"
WEAK = "weak"

TIER_ORDER = {WEAK: 0, SUSPECTED: 1, STRONG: 2, CONFIRMED: 3}

# Only these tiers merge accounts into one investigation. Suspected edges are
# published against the cluster as "peripheral" so a reviewer sees them without
# them silently inflating the ring.
CLUSTERING_TIERS = {STRONG, CONFIRMED}


def stronger(a: str, b: str) -> str:
    """Return the higher-confidence of two tiers."""
    return a if TIER_ORDER[a] >= TIER_ORDER[b] else b


@dataclass
class Edge:
    """One observed connection between two accounts.

    ``evidence`` holds the machine-readable basis (identifier value, counts,
    the statistic that justified the tier). ``statement`` is the sentence a
    human reads in the investigation report; it must be literally true and
    self-contained, because it is quoted into reports that leave this system.
    """

    a: str
    b: str
    kind: str
    tier: str
    statement: str
    evidence: dict[str, Any] = field(default_factory=dict)
    first_seen: int | None = None
    last_seen: int | None = None

    def __post_init__(self) -> None:
        if self.a == self.b:
            raise ValueError("an edge must join two different accounts")
        # Canonical ordering so the same pair always produces the same key,
        # whichever order the detector happened to see them in.
        if self.a > self.b:
            self.a, self.b = self.b, self.a
        if self.tier not in TIER_ORDER:
            raise ValueError(f"unknown tier {self.tier!r}")

    @property
    def pair(self) -> tuple[str, str]:
        return (self.a, self.b)

    @property
    def key(self) -> str:
        """Stable identity for delta detection between runs."""
        value = self.evidence.get("identifier", "")
        return f"{self.kind}|{self.a}|{self.b}|{value}"

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Observation:
    """One charge attempt, normalised across sources."""

    account: str
    name: str
    created: int
    amount: int           # minor units
    currency: str
    status: str           # succeeded | failed | ...
    card_key: str | None  # brand|funding|country|last4 quasi-identifier
    fingerprint: str | None = None   # true Stripe fingerprint when available
    reader: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded"
