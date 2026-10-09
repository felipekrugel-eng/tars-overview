"""Merge a day's reviews into the published index and detail shards.

Invariants this module exists to keep:

* The index is UPSERTED, never replaced. 481 historical reviews predate this pipeline and
  a daily run must leave every one of them intact. An empty cohort changes nothing but
  the run log.
* One detail record per account per day, in that day's shard. Re-running the same day
  overwrites that day's record for that account and touches nothing else, so the job is
  idempotent.
* A higher-quality review is never silently replaced by a thinner one. An
  `automated-signals-only` record will not overwrite an `evidence-based` record for the
  same account unless it is itself evidence-based.
* `generatedAt` advances only when a run actually wrote something, so the stamp on the
  page cannot imply a refresh that did not happen.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from .methodology import STAGE_EVIDENCED, Methodology

SCHEMA_VERSION = 2

# Fields the index carries for each merchant. Everything else stays in the detail shard.
SUMMARY_FIELDS = (
    "id", "accountId", "merchantId", "name", "dba", "score", "riskScore", "trustScore",
    "band", "action", "createdAt", "enabledAt", "enabledCertainty", "enabledEvidenceLevel",
    "reviewedAt", "reviewType", "reviewStage", "reviewPriority", "confidence", "detailFile",
    "reviewCompleteness", "enabled", "fullyEnabled", "detailsSubmitted", "hasTransacted",
    "successfulTransactions", "lastTransactedAt", "location", "website", "mcc",
    "identityVerification", "representative", "email", "phone", "statementDescriptor",
    "scoreBasis", "riskOverride", "riskOverrideReason",
)


def summarize(record: dict[str, Any], detail_file: str) -> dict[str, Any]:
    """Project a full detail record down to its index summary."""
    out = {k: record[k] for k in SUMMARY_FIELDS if k in record and record[k] is not None}
    out["detailFile"] = detail_file
    return out


def shard_name(day: str) -> str:
    return f"risk-health/details-{day}-enabled.json"


def _quality(record: dict[str, Any]) -> int:
    return 2 if record.get("reviewStage") == STAGE_EVIDENCED else 1


def upsert(
    index: dict[str, Any],
    records: list[dict[str, Any]],
    day: str,
    base_dir: str,
    methodology: Methodology,
) -> dict[str, Any]:
    """Merge `records` into `index` and the day's shard. Returns a change report."""
    detail_file = shard_name(day)
    shard_path = os.path.join(base_dir, "risk-health", os.path.basename(detail_file))

    existing_shard: dict[str, Any] = {"merchants": []}
    if os.path.exists(shard_path):
        with open(shard_path, encoding="utf-8") as handle:
            existing_shard = json.load(handle)

    by_account = {m["id"]: m for m in index.get("merchants", [])}
    shard_by_account = {
        (m.get("accountId") or m.get("id")): m for m in existing_shard.get("merchants", [])
    }

    added, updated, skipped = [], [], []
    for record in records:
        account_id = record["accountId"]
        previous = by_account.get(account_id)
        if previous is not None:
            # Guard against a thin re-run clobbering a researched review.
            previous_stage = previous.get("reviewStage")
            if previous_stage == STAGE_EVIDENCED and _quality(record) < 2:
                skipped.append(account_id)
                continue
            updated.append(account_id)
        else:
            added.append(account_id)
        shard_by_account[account_id] = record
        by_account[account_id] = summarize(record, detail_file)

    if not (added or updated):
        return {"added": [], "updated": [], "skipped": skipped, "wrote": False}

    reviewed_at = datetime.now().astimezone().isoformat(timespec="seconds")
    shard = {
        "schemaVersion": SCHEMA_VERSION,
        "scoreDirection": methodology.raw.get("scoreDirection"),
        "batch": {
            "label": f"Daily newly-enabled review — {day} Europe/London",
            "cohortDate": day,
            "reviewedAt": reviewed_at,
            "count": len(shard_by_account),
            "cohortDefinition": (
                "Accounts observed crossing into charges_enabled = true on the stated "
                "Europe/London calendar day, per the fraud-health enablement ledger "
                "replayed from the committed history of activation-data.js. Stripe "
                "account creation date is never used to select a cohort."
            ),
        },
        "reviewedAt": reviewed_at,
        "merchants": sorted(shard_by_account.values(), key=lambda m: m["accountId"]),
    }
    os.makedirs(os.path.dirname(shard_path), exist_ok=True)
    _write_json(shard_path, shard)

    index["merchants"] = sorted(by_account.values(), key=lambda m: (-m.get("score", 0), m["id"]))
    index["generatedAt"] = reviewed_at
    index["schemaVersion"] = SCHEMA_VERSION
    return {"added": added, "updated": updated, "skipped": skipped, "wrote": True}


def recompute_coverage(
    index: dict[str, Any],
    population_rows: list[dict[str, Any]],
    ledger_accounts: dict[str, Any],
) -> dict[str, Any]:
    """Recount coverage from live data instead of carrying stale hand-written totals.

    The previous `coverage` block claimed 449 reviewed-enabled accounts against a live
    population that holds 452 enabled accounts, with no way to tell which figure was
    current. Everything here is derived at write time.
    """
    live = {r["acct"]: r for r in population_rows if r.get("acct")}
    enabled_live = {a for a, r in live.items() if r.get("status") == "Enabled"}
    reviewed = {m["id"] for m in index.get("merchants", [])}
    reviewed_enabled = enabled_live & reviewed

    coverage = {
        "computedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "activated-payments/activation-data.js",
        "connectedAccounts": len(live),
        "enabledAccounts": len(enabled_live),
        "reviewedAccounts": len(reviewed),
        "reviewedEnabledAccounts": len(reviewed_enabled),
        "enabledNotYetReviewed": sorted(enabled_live - reviewed),
        "reviewedNoLongerInPopulation": sorted(reviewed - set(live)),
        "enabledCoveragePct": (
            round(100 * len(reviewed_enabled) / len(enabled_live), 1) if enabled_live else None
        ),
        "ledgerAccounts": len(ledger_accounts),
        "scoringModel": "risk-v2",
        "scoreDirection": "0 = no observed risk, 100 = extreme risk",
    }
    index["coverage"] = coverage
    return coverage


def refresh_live_status(
    index: dict[str, Any], population_rows: list[dict[str, Any]]
) -> list[dict[str, str]]:
    """Refresh the enabled flag on reviewed merchants from the live population.

    Only overwrites where live data genuinely exists for the account. An account missing
    from the feed keeps its last known value rather than being blanked to `unknown` —
    writing a null over a real value is the failure mode the handover calls out.
    """
    live = {r["acct"]: r for r in population_rows if r.get("acct")}
    changes = []
    for merchant in index.get("merchants", []):
        row = live.get(merchant["id"])
        if row is None:
            continue
        now_enabled = row.get("status") == "Enabled"
        if merchant.get("enabled") != now_enabled:
            changes.append(
                {
                    "accountId": merchant["id"],
                    "name": merchant.get("name", ""),
                    "from": str(merchant.get("enabled")),
                    "to": str(now_enabled),
                    "liveStatus": row.get("status", ""),
                }
            )
            merchant["enabled"] = now_enabled
        merchant["liveStatus"] = row.get("status")
        merchant["liveStatusAt"] = index.get("generatedAt")
    return changes


def _write_json(path: str, payload: dict[str, Any]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, ensure_ascii=False)
        handle.write("\n")
    os.replace(tmp, path)


def write_index(path: str, index: dict[str, Any]) -> None:
    _write_json(path, index)
