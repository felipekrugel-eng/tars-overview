"""Is this overlap surprising, or is it the birthday paradox?

Counting shared cards does not work. Measured over the platform's full charge
history, the pair sharing the most card keys is Polar Bear Ice Cream Company and
GOLDEN BEAUTY SUPPLY with 501 keys in common — two busy, unrelated retailers
whose customers overlap and whose ``last4`` values collide. The Think Big ring
shares only two to four keys per pair.

What separates them is volume. Polar Bear has thousands of distinct cards, so
hundreds of coincidental matches are expected. Arenas has six. Two shared keys
between two six-card merchants is not a coincidence anyone should accept.

So every quasi-identifier overlap is scored against what chance alone would
produce, and the tier follows from that number rather than from the raw count.
"""

from __future__ import annotations

import math

# A card key is brand|funding|country|last4. Measured over the committed
# history there are ~26,000 distinct keys in circulation; the default is
# recomputed from the data at run time and this value is only a fallback.
DEFAULT_KEY_SPACE = 26_000

# A genuine shared card sits on a handful of accounts. A key that turns up on
# many accounts is either a last4 collision or a corporate/common card, and it
# carries almost no information about a relationship. Measured: 18,171 keys on
# one account, 5,451 on two, 1,764 on three, falling away to a single key seen
# on twenty. Keys above this are dropped before scoring.
MAX_ACCOUNTS_PER_KEY = 6


def expected_overlap(keys_a: int, keys_b: int, key_space: int) -> float:
    """Shared keys two accounts would be expected to have by chance alone."""
    if key_space <= 0:
        return 0.0
    return (keys_a * keys_b) / key_space


def poisson_tail(observed: int, expected: float) -> float:
    """P(X >= observed) for X ~ Poisson(expected).

    Reported alongside the lift so the investigation report can state the
    strength of a link in a way a reviewer (or a regulator) can check, rather
    than asserting a bare verdict.
    """
    if observed <= 0:
        return 1.0
    if expected <= 0:
        # No expectation at all: any observation is maximally surprising, but
        # we never report zero probability from a model this crude.
        return 1e-12
    # 1 - CDF(observed-1)
    cumulative = 0.0
    term = math.exp(-expected)
    for k in range(observed):
        if k:
            term *= expected / k
        cumulative += term
    return max(1e-12, min(1.0, 1.0 - cumulative))


def lift(observed: int, expected: float) -> float:
    """How many times more overlap than chance predicts."""
    return observed / max(expected, 1e-4)


def overlap_strength(observed: int, keys_a: int, keys_b: int, key_space: int) -> dict:
    """Score one pair's quasi-identifier overlap.

    Returns the numbers the tier decision and the report both need. Kept as a
    dict rather than a tuple because every one of these values is quoted as
    evidence somewhere.
    """
    exp = expected_overlap(keys_a, keys_b, key_space)
    return {
        "observed": observed,
        "expected": round(exp, 4),
        "lift": round(lift(observed, exp), 1),
        "p_value": poisson_tail(observed, exp),
        "distinct_cards_a": keys_a,
        "distinct_cards_b": keys_b,
        "key_space": key_space,
    }
