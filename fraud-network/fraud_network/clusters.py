"""Group linked accounts into investigations that survive being added to.

An investigation is not recomputed from scratch every run. When an eighth
account joins a ring of seven, a reviewer needs to see "LOY-NET-0001 gained a
member", not a brand-new seven-plus-one cluster with an unfamiliar name. So
cluster identity is inherited from the previous run: whichever existing
investigation already contains any of this component's members lends its id,
oldest first. Two previously separate investigations joining is recorded as a
merge, because that is itself a finding.

Accounts attached only by suspected edges are kept apart as `peripheral`. They
appear in the report, they do not inflate the confirmed membership, and they are
the queue a human works through.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from .model import CLUSTERING_TIERS, Edge, TIER_ORDER


@dataclass
class Cluster:
    id: str
    members: list[str] = field(default_factory=list)
    peripheral: list[str] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    new_members: list[str] = field(default_factory=list)
    merged_from: list[str] = field(default_factory=list)
    created_at: int | None = None

    @property
    def confirmed_edges(self) -> list[Edge]:
        return [e for e in self.edges if e.tier == "confirmed"]

    def strength(self) -> str:
        """The strongest tier present, which is what a reviewer triages on."""
        if not self.edges:
            return "weak"
        return max((e.tier for e in self.edges), key=lambda t: TIER_ORDER[t])


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def build(edges: list[Edge], previous: dict[str, Any] | None = None, now: int | None = None) -> list[Cluster]:
    """Components over clustering-tier edges, with ids inherited from `previous`."""
    previous = previous or {}
    prior_clusters: dict[str, list[str]] = {
        cid: list(c.get("members", [])) for cid, c in previous.get("clusters", {}).items()
    }
    prior_created: dict[str, int] = {
        cid: c.get("created_at") or 0 for cid, c in previous.get("clusters", {}).items()
    }
    member_to_prior: dict[str, str] = {}
    for cid, members in prior_clusters.items():
        for m in members:
            member_to_prior[m] = cid

    uf = _UnionFind()
    hard = [e for e in edges if e.tier in CLUSTERING_TIERS]
    for e in hard:
        uf.union(e.a, e.b)

    components: dict[str, set[str]] = defaultdict(set)
    for e in hard:
        components[uf.find(e.a)].add(e.a)
        components[uf.find(e.a)].add(e.b)

    # Suspected-only edges attach peripherally to whichever component they touch.
    soft = [e for e in edges if e.tier not in CLUSTERING_TIERS]

    clusters: list[Cluster] = []
    used_ids: set[str] = set()
    for root, members in sorted(components.items(), key=lambda kv: -len(kv[1])):
        member_list = sorted(members)
        # Inherit the oldest existing investigation id that already holds a member.
        candidates = {member_to_prior[m] for m in member_list if m in member_to_prior}
        candidates -= used_ids
        if candidates:
            cid = min(candidates, key=lambda c: (prior_created.get(c, 0), c))
            merged_from = sorted(candidates - {cid})
            created_at = prior_created.get(cid) or now
        else:
            cid = _next_id(used_ids | set(prior_clusters))
            merged_from = []
            created_at = now
        used_ids.add(cid)

        known = set(prior_clusters.get(cid, []))
        for other in merged_from:
            known |= set(prior_clusters.get(other, []))

        cluster_edges = [e for e in hard if e.a in members and e.b in members]
        periph: set[str] = set()
        for e in soft:
            inside_a, inside_b = e.a in members, e.b in members
            if inside_a and inside_b:
                # Too weak to have formed the cluster, but once the cluster
                # exists on harder evidence this corroborates it, and it is
                # usually the detail that explains the ring: Montalto and
                # Deleon were opened 30 minutes apart, which only means
                # something once a shared card has already connected them.
                cluster_edges.append(e)
            elif inside_a:
                periph.add(e.b)
                cluster_edges.append(e)
            elif inside_b:
                periph.add(e.a)
                cluster_edges.append(e)

        clusters.append(Cluster(
            id=cid,
            members=member_list,
            peripheral=sorted(periph),
            edges=cluster_edges,
            new_members=sorted(set(member_list) - known) if known else [],
            merged_from=merged_from,
            created_at=created_at,
        ))
    return clusters


def _next_id(taken: set[str]) -> str:
    n = 1
    while f"LOY-NET-{n:04d}" in taken:
        n += 1
    return f"LOY-NET-{n:04d}"


def to_state(clusters: list[Cluster]) -> dict[str, Any]:
    """Serialise for the next run's delta detection."""
    return {
        "clusters": {
            c.id: {
                "members": c.members,
                "peripheral": c.peripheral,
                "created_at": c.created_at,
                "edge_keys": sorted({e.key for e in c.edges}),
            }
            for c in clusters
        }
    }
