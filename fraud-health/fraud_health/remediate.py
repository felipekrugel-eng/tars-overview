"""One-off repair of the published Fraud Health dataset.

Every defect here was found by auditing master on 2026-10-09 and is fixed once, with a
written remediation log, rather than being patched by hand again.

1. SCORE RECONCILIATION. For 455 of 469 older records the headline score was exactly
   `100 - sum(legacy trust points)` — an inverted TRUST model wearing a risk label. The
   eight risk dimensions the dashboard draws were back-fitted separately and did not
   reconcile, so 402 of 481 merchants displayed a headline contradicting their own bars.
   Fix: `score := sum(riskDimensions)`, then band, action, riskScore and trustScore are
   recomputed from it. Dimensions themselves are NOT touched — they are the surviving
   per-dimension judgement and the thing the page actually renders.

2. SCORE OVERRIDES. 13 records carried `riskOverride: "known-network-risk"`, a deliberate
   human decision that forced the score to 95. Those extra points have no dimensional
   home, so folding them into `score` would re-break invariant 1. They are preserved as
   `riskOverrideScore` + `riskOverrideReason`, and `effectiveScore` = max(score, override)
   drives the band and the recommended action. The human call survives; the arithmetic
   stays honest.

3. DUPLICATE MERCHANTS. Four records were keyed by hand-written slugs ("two-brothers",
   "valcrestus", "deleon-black", "interior-glass") rather than Stripe account ids, and
   each duplicates a real `acct_...` record for the same merchant at a different score.
   The Stripe-keyed record wins — it is the one reconcilable against live data — and the
   slug record's evidence is merged into it before the slug is dropped.

4. STALE ENABLED FLAGS. Ten merchants were published as `enabled: true` while the live
   population had them Restricted or Rejected. Refreshed from live data, and only where
   live data exists.

5. COVERAGE BLOCK. Hand-maintained totals that no longer matched anything. Recomputed.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from .methodology import STAGE_LEGACY, Methodology, effective_score

SLUG_MERGES = {
    "two-brothers": "acct_1UMdcQ7k2AfD2jbs",
    "valcrestus": "acct_1UIvww6kwe44hxTX",
    "deleon-black": "acct_1UHQin79Tya3nQY2",
    "interior-glass": "acct_1UJE8o8m76Cdi9l6",
}

EVIDENCE_LISTS = ("verified", "unverified", "contradictions", "evidenceNeeded")


def load_shards(base_dir: str) -> dict[str, dict[str, Any]]:
    out = {}
    directory = os.path.join(base_dir, "risk-health")
    for name in sorted(os.listdir(directory)):
        if name.endswith(".json") and name != "index.json":
            with open(os.path.join(directory, name), encoding="utf-8") as handle:
                out[f"risk-health/{name}"] = json.load(handle)
    return out


def _detail_index(shards: dict[str, dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (path, (m.get("accountId") or m.get("id"))): m
        for path, shard in shards.items()
        for m in shard.get("merchants", [])
    }


def run(
    index: dict[str, Any],
    shards: dict[str, dict[str, Any]],
    methodology: Methodology,
    population_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Apply every repair in place. Returns the remediation log."""
    details = _detail_index(shards)
    log: dict[str, Any] = {
        "remediatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "scoreReconciliation": [],
        "overridesPreserved": [],
        "duplicatesMerged": [],
        "staleEnabledFixed": [],
        "unresolved": [],
    }

    merchants = index["merchants"]
    by_id = {m["id"]: m for m in merchants}

    # ---------------------------------------------------------- 3. duplicates
    for slug, canonical_id in SLUG_MERGES.items():
        slug_row = by_id.get(slug)
        canonical = by_id.get(canonical_id)
        if slug_row is None:
            continue
        if canonical is None:
            log["unresolved"].append(
                f"{slug}: canonical {canonical_id} not in index; slug retained"
            )
            continue
        slug_detail = details.get((slug_row["detailFile"], slug))
        canonical_detail = details.get((canonical["detailFile"], canonical_id))
        if slug_detail is not None and canonical_detail is not None:
            for key in EVIDENCE_LISTS:
                merged = list(canonical_detail.get(key) or [])
                for item in slug_detail.get(key) or []:
                    if item not in merged:
                        merged.append(item)
                canonical_detail[key] = merged
        log["duplicatesMerged"].append(
            {
                "slug": slug,
                "slugScore": slug_row.get("score"),
                "canonical": canonical_id,
                "canonicalScore": canonical.get("score"),
                "name": slug_row.get("name"),
            }
        )
        # Drop the slug from both the index and its shard.
        merchants[:] = [m for m in merchants if m["id"] != slug]
        shard = shards.get(slug_row["detailFile"])
        if shard:
            shard["merchants"] = [
                m for m in shard["merchants"] if (m.get("accountId") or m.get("id")) != slug
            ]
        by_id.pop(slug, None)

    # -------------------------------------------- 1 + 2. reconcile and override
    for merchant in merchants:
        detail = details.get((merchant["detailFile"], merchant["id"]))
        if detail is None:
            log["unresolved"].append(f"{merchant['id']}: no detail record; left untouched")
            continue
        dims = detail.get("riskDimensions")
        if not isinstance(dims, dict):
            log["unresolved"].append(f"{merchant['id']}: no riskDimensions; left untouched")
            continue

        # Clamp any dimension that exceeds its maximum before summing.
        for key in methodology.keys:
            value = int(dims.get(key, 0) or 0)
            dims[key] = max(0, min(value, methodology.maxima[key]))
        for stray in set(dims) - set(methodology.keys):
            dims.pop(stray)

        old_score = int(merchant["score"])
        new_score = methodology.total(dims)

        override = merchant.get("riskOverride")
        if override is not None:
            merchant["riskOverrideScore"] = old_score
            merchant["riskOverrideReason"] = str(override)
            detail["riskOverrideScore"] = old_score
            detail["riskOverrideReason"] = str(override)
            merchant.pop("riskOverride", None)
            log["overridesPreserved"].append(
                {
                    "accountId": merchant["id"],
                    "name": merchant.get("name"),
                    "overrideScore": old_score,
                    "dimensionSum": new_score,
                    "reason": str(override),
                }
            )

        for target in (merchant, detail):
            target["score"] = new_score
            target["riskScore"] = new_score
            target["trustScore"] = 100 - new_score
        # Legacy records keep a marker so a reader can tell what the score was born from.
        if "scores" in detail or "legacyEvidenceScores" in detail:
            merchant["scoreBasis"] = STAGE_LEGACY
            detail["scoreBasis"] = STAGE_LEGACY

        band = methodology.band_for(effective_score(merchant))
        for target in (merchant, detail):
            target["band"] = band["label"]
            target["action"] = band["action"]

        if old_score != new_score:
            log["scoreReconciliation"].append(
                {
                    "accountId": merchant["id"],
                    "name": merchant.get("name"),
                    "from": old_score,
                    "to": new_score,
                    "band": band["label"],
                    "action": band["action"],
                }
            )

    # ------------------------------------------------------ 4. stale enabled
    live = {r["acct"]: r for r in population_rows if r.get("acct")}
    for merchant in merchants:
        row = live.get(merchant["id"])
        if row is None:
            continue
        now_enabled = row.get("status") == "Enabled"
        if merchant.get("enabled") is not None and merchant["enabled"] != now_enabled:
            log["staleEnabledFixed"].append(
                {
                    "accountId": merchant["id"],
                    "name": merchant.get("name"),
                    "from": merchant["enabled"],
                    "to": now_enabled,
                    "liveStatus": row.get("status"),
                }
            )
        merchant["enabled"] = now_enabled
        merchant["liveStatus"] = row.get("status")

    merchants.sort(key=lambda m: (-effective_score(m), m["id"]))
    # The stale hand-written batch block is superseded by `coverage`, recomputed on write.
    index.pop("batch", None)
    return log
