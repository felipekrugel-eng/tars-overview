"""Card-based links between accounts, and the relay behaviour that exposes a ring.

Two detectors live here.

``card_overlap_edges`` is the static one: which accounts have presented the same
card. It is scored statistically (see statistics.py) because raw overlap is
dominated by coincidence.

``relay_edges`` is the behavioural one, and it is the sharpest instrument we
have. The Think Big report documented a card being declined at Central diner and
then accepted at a sibling account 3m57s, 76s and 8m08s later. Run across the
platform's entire committed history — 58,058 charges — that pattern occurs four
times. Three of them are the ring. The fourth is a last4 collision between two
unrelated merchants whose amounts differ by 39x, which the amount test demotes.

Both detectors deliberately read failed attempts. The existing risk monitor
indexes only succeeded charges, which is why neither the Central-diner relays
nor the Montalto -> Deleon card reuse could ever have been seen: in both cases
the first leg was a decline.
"""

from __future__ import annotations

from collections import defaultdict

from .model import Edge, Observation, STRONG, SUSPECTED
from .statistics import MAX_ACCOUNTS_PER_KEY, overlap_strength

# A card declined at one merchant and accepted at another within this window is
# the signature behaviour. 30 minutes is generous next to the observed 76s-8m.
RELAY_WINDOW_SECONDS = 30 * 60

# The relay is only meaningful if roughly the same sum is being pushed through.
# The one historical false positive differed by 39x ($78.33 declined, $2.00
# accepted); the three real ones differ by 1.06x, 1.31x and 1.43x.
RELAY_MAX_AMOUNT_RATIO = 10.0

# A card declined at one account and then accepted at another for the *exact same
# amount* is a different pattern: it can be days apart, because the operator is
# not standing at a terminal retrying, they are moving the charge to another
# account. Montalto was declined $1,000.00 on Visa credit ..0052 on 28 Sep and
# Deleon Black ran the same card for the same $1,000.00 on 30 Sep. This detector
# is what identifies the eighth account.
RETRY_WINDOW_SECONDS = 14 * 24 * 3600

# Busy, long-established merchants genuinely share customers, and a customer who
# is declined at one shop and pays the same amount at another days later is
# ordinary life. Two small accounts doing it is not. Measured over the full
# history this rule fires six times: the ring twice, the Strictly Needs /
# Resourceful Mindz pair the investigation had already identified separately,
# two same-operator trade names, and one high-volume beauty-supply pair.
RETRY_HIGH_VOLUME_CHARGES = 500

# Tier thresholds for statistical card overlap.
STRONG_P_VALUE = 1e-6
SUSPECTED_P_VALUE = 1e-3


def card_key(brand: str | None, funding: str | None, country: str | None, last4: str | None) -> str | None:
    """Quasi-identifier for a card when no true fingerprint is available.

    This is not a fingerprint: ``last4`` has only 10,000 values, so distinct
    cards collide constantly. It is treated throughout as a lead to be scored,
    never as proof. Where a real Stripe fingerprint exists it supersedes this.
    """
    if not last4:
        return None
    return "|".join([(brand or "?"), (funding or "?"), (country or "?"), last4])


def _index(observations: list[Observation]) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """key -> accounts, and account -> keys."""
    by_key: dict[str, set[str]] = defaultdict(set)
    by_account: dict[str, set[str]] = defaultdict(set)
    for ob in observations:
        if not ob.card_key:
            continue
        by_key[ob.card_key].add(ob.account)
        by_account[ob.account].add(ob.card_key)
    return by_key, by_account


def card_overlap_edges(observations: list[Observation], names: dict[str, str],
                       key_space: int | None = None) -> list[Edge]:
    """Edges for accounts that presented the same card more often than chance allows.

    `key_space` is how many distinct card keys the platform could plausibly
    show, and it sets the bar for what counts as a surprising overlap. It is
    normally measured from the data, but a caller working on a small extract
    has to pass the real figure: on a 100-row sample the measured space is ~85
    keys, under which every overlap looks inevitable and nothing fires.
    """
    by_key, by_account = _index(observations)
    key_space = key_space or len(by_key) or 1

    shared: dict[tuple[str, str], list[str]] = defaultdict(list)
    for key, accounts in by_key.items():
        # Drop keys that are everywhere: they are collisions or common cards and
        # they would otherwise link half the platform together.
        if not 2 <= len(accounts) <= MAX_ACCOUNTS_PER_KEY:
            continue
        ordered = sorted(accounts)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1:]:
                shared[(a, b)].append(key)

    edges: list[Edge] = []
    for (a, b), keys in shared.items():
        stat = overlap_strength(len(keys), len(by_account[a]), len(by_account[b]), key_space)
        if stat["p_value"] < STRONG_P_VALUE:
            tier = STRONG
        elif stat["p_value"] < SUSPECTED_P_VALUE:
            tier = SUSPECTED
        else:
            continue  # indistinguishable from coincidence; not worth a reviewer's time

        times = [ob.created for ob in observations
                 if ob.account in (a, b) and ob.card_key in set(keys)]
        statement = (
            f"{names.get(a, a)} and {names.get(b, b)} presented the same card "
            f"{stat['observed']} time(s) ({', '.join(sorted(keys)[:4])}"
            f"{' and others' if len(keys) > 4 else ''}). Chance alone predicts "
            f"{stat['expected']} shared card(s) for merchants of their size "
            f"({stat['distinct_cards_a']} and {stat['distinct_cards_b']} distinct cards), "
            f"a lift of {stat['lift']}x (p={stat['p_value']:.1e})."
        )
        edges.append(Edge(
            a=a, b=b, kind="shared-card", tier=tier, statement=statement,
            evidence={"identifier": ",".join(sorted(keys)), "cards": sorted(keys), **stat},
            first_seen=min(times) if times else None,
            last_seen=max(times) if times else None,
        ))
    return edges


def relay_edges(observations: list[Observation], names: dict[str, str]) -> list[Edge]:
    """Card declined at one account, accepted at another, minutes apart."""
    by_key: dict[str, list[Observation]] = defaultdict(list)
    for ob in observations:
        if ob.card_key:
            by_key[ob.card_key].append(ob)

    edges: list[Edge] = []
    for key, obs in by_key.items():
        obs.sort(key=lambda o: o.created)
        for first, second in zip(obs, obs[1:]):
            if first.account == second.account:
                continue
            gap = second.created - first.created
            if gap > RELAY_WINDOW_SECONDS or gap < 0:
                continue
            if first.succeeded or not second.succeeded:
                continue
            hi, lo = max(first.amount, second.amount), max(1, min(first.amount, second.amount))
            ratio = hi / lo
            tier = STRONG if ratio <= RELAY_MAX_AMOUNT_RATIO else SUSPECTED
            statement = (
                f"Card {key} was declined at {names.get(first.account, first.account)} for "
                f"{first.amount / 100:,.2f} and accepted at {names.get(second.account, second.account)} "
                f"for {second.amount / 100:,.2f} {gap} seconds later."
            )
            if tier is SUSPECTED:
                statement += (
                    f" The amounts differ by {ratio:.0f}x, which is more consistent with a "
                    f"last4 collision between unrelated merchants than with one operator retrying."
                )
            edges.append(Edge(
                a=first.account, b=second.account, kind="decline-relay", tier=tier,
                statement=statement,
                evidence={"identifier": key, "gap_seconds": gap,
                          "declined_amount": first.amount, "accepted_amount": second.amount,
                          "amount_ratio": round(ratio, 2),
                          "declined_at": first.account, "accepted_at": second.account},
                first_seen=first.created, last_seen=second.created,
            ))
    return edges


def retry_edges(observations: list[Observation], names: dict[str, str]) -> list[Edge]:
    """Same card, same amount, declined at one account and accepted at another."""
    by_key: dict[str, list[Observation]] = defaultdict(list)
    volume: dict[str, int] = defaultdict(int)
    for ob in observations:
        volume[ob.account] += 1
        if ob.card_key:
            by_key[ob.card_key].append(ob)

    edges: list[Edge] = []
    seen: set[tuple[str, str, str, int]] = set()
    for key, obs in by_key.items():
        obs.sort(key=lambda o: o.created)
        for i, first in enumerate(obs):
            if first.succeeded:
                continue
            for second in obs[i + 1:]:
                gap = second.created - first.created
                if gap > RETRY_WINDOW_SECONDS:
                    break
                if second.account == first.account or not second.succeeded:
                    continue
                if second.amount != first.amount:
                    continue
                signature = (first.account, second.account, key, first.amount)
                if signature in seen:
                    break
                seen.add(signature)
                busy = (volume[first.account] >= RETRY_HIGH_VOLUME_CHARGES
                        or volume[second.account] >= RETRY_HIGH_VOLUME_CHARGES)
                tier = SUSPECTED if busy else STRONG
                statement = (
                    f"Card {key} was declined at {names.get(first.account, first.account)} for "
                    f"{first.amount / 100:,.2f} and the same card was accepted at "
                    f"{names.get(second.account, second.account)} for the same "
                    f"{second.amount / 100:,.2f} {gap / 3600:.1f} hours later."
                )
                if busy:
                    statement += (
                        " One of these merchants is high-volume, where a shared customer is an "
                        "ordinary explanation, so this is recorded as a lead rather than a link."
                    )
                edges.append(Edge(
                    a=first.account, b=second.account, kind="cross-account-retry", tier=tier,
                    statement=statement,
                    evidence={"identifier": f"{key}@{first.amount}", "gap_seconds": gap,
                              "amount": first.amount, "declined_at": first.account,
                              "accepted_at": second.account,
                              "charges_a": volume[first.account], "charges_b": volume[second.account]},
                    first_seen=first.created, last_seen=second.created,
                ))
                break
    return edges


def reader_edges(observations: list[Observation], names: dict[str, str]) -> list[Edge]:
    """Two accounts taking payments on one physical terminal reader.

    A reader is enrolled to an account, so sharing one is a hard link rather
    than a lead. This does not fire on the historical data (every account in the
    export has its own readers) but it is cheap insurance: if a ring ever reuses
    hardware, this catches it on the first charge.
    """
    by_reader: dict[str, set[str]] = defaultdict(set)
    seen: dict[str, list[int]] = defaultdict(list)
    for ob in observations:
        if ob.reader:
            by_reader[ob.reader].add(ob.account)
            seen[ob.reader].append(ob.created)

    edges: list[Edge] = []
    for reader, accounts in by_reader.items():
        if len(accounts) < 2:
            continue
        ordered = sorted(accounts)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1:]:
                edges.append(Edge(
                    a=a, b=b, kind="shared-reader", tier="confirmed",
                    statement=(f"{names.get(a, a)} and {names.get(b, b)} both took payments on "
                               f"terminal reader {reader}, a single enrolled physical device."),
                    evidence={"identifier": reader},
                    first_seen=min(seen[reader]), last_seen=max(seen[reader]),
                ))
    return edges
