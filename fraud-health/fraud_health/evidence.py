"""Reviewer-authored evidence, merged deterministically into published reviews.

Why this is a separate layer
----------------------------
Independent verification — company registers, licences, premises, web presence — cannot
be done by a scheduled job. It needs a model or a person actually looking things up. The
previous process blurred that line: a scheduled task asserted "verified" facts with no
source URL attached, and the handover records that several of those claims could not be
stood up afterwards.

So the two are split. `signals.py` produces what the warehouse can prove on its own, on a
schedule. A reviewer writes findings into `fraud-health/evidence/<accountId>.json`, and
this module folds them in. The pipeline never writes an evidence file and never invents a
source; a claim with no `url` cannot be marked verified.

File format (all fields optional except `accountId` and `reviewedAt`):

    {
      "accountId": "acct_...",
      "reviewedAt": "2026-10-09",
      "reviewer": "claude-code / felipe",
      "findings": [
        {
          "dimension": "legal",
          "points": 0,
          "status": "verified",          // verified | unverified | contradiction
          "statement": "Registered in Arizona as ... , status Active, since 2019-04-02.",
          "url": "https://ecorp.azcc.gov/...",
          "sourceType": "state-register",
          "checkedAt": "2026-10-09",
          "establishes": "legal existence and standing of the named entity"
        }
      ],
      "evidenceNeeded": ["..."],
      "summary": "..."
    }

`points` is risk, in the same units as the methodology: 0 means the check came back clean.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

STATUS_VERIFIED = "verified"
STATUS_UNVERIFIED = "unverified"
STATUS_CONTRADICTION = "contradiction"

VALID_STATUSES = {STATUS_VERIFIED, STATUS_UNVERIFIED, STATUS_CONTRADICTION}


@dataclass
class EvidenceFile:
    accountId: str
    reviewedAt: str
    reviewer: str = ""
    findings: list[dict[str, Any]] = field(default_factory=list)
    evidenceNeeded: list[str] = field(default_factory=list)
    summary: str = ""

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "EvidenceFile":
        return cls(
            accountId=raw["accountId"],
            reviewedAt=raw["reviewedAt"],
            reviewer=raw.get("reviewer", ""),
            findings=raw.get("findings", []),
            evidenceNeeded=raw.get("evidenceNeeded", []),
            summary=raw.get("summary", ""),
        )

    def dimensions_touched(self) -> set[str]:
        return {f["dimension"] for f in self.findings if f.get("dimension")}

    def sources(self) -> list[dict[str, Any]]:
        """Every cited source, deduplicated by URL, in first-seen order."""
        seen: dict[str, dict[str, Any]] = {}
        for finding in self.findings:
            url = finding.get("url")
            if not url or url in seen:
                continue
            seen[url] = {
                "url": url,
                "sourceType": finding.get("sourceType", "unspecified"),
                "checkedAt": finding.get("checkedAt", self.reviewedAt),
                "establishes": finding.get("establishes", ""),
                "dimension": finding.get("dimension"),
            }
        return list(seen.values())


def validate(raw: dict[str, Any], dimension_keys: list[str], maxima: dict[str, int]) -> list[str]:
    """Structural checks on an evidence file. Empty list means usable."""
    problems: list[str] = []
    account_id = raw.get("accountId", "<no id>")
    if not raw.get("accountId"):
        problems.append("evidence file has no accountId")
    if not raw.get("reviewedAt"):
        problems.append(f"{account_id}: evidence file has no reviewedAt")

    for position, finding in enumerate(raw.get("findings", [])):
        where = f"{account_id} finding[{position}]"
        dimension = finding.get("dimension")
        if dimension not in dimension_keys:
            problems.append(f"{where}: unknown dimension {dimension!r}")
        status = finding.get("status")
        if status not in VALID_STATUSES:
            problems.append(f"{where}: status {status!r} not one of {sorted(VALID_STATUSES)}")
        if not finding.get("statement"):
            problems.append(f"{where}: no statement")
        points = finding.get("points", 0)
        if not isinstance(points, int) or isinstance(points, bool):
            problems.append(f"{where}: points {points!r} is not an integer")
        elif dimension in maxima and not 0 <= points <= maxima[dimension]:
            problems.append(f"{where}: points {points} outside [0, {maxima[dimension]}]")
        # The rule that keeps the dashboard honest: no citation, no verified claim.
        if status == STATUS_VERIFIED and not finding.get("url"):
            problems.append(
                f"{where}: status is 'verified' but no source url is cited — a claim "
                "without a source cannot be published as verified"
            )
    return problems


def load_all(directory: str) -> dict[str, EvidenceFile]:
    """Load every evidence file in `directory`, keyed by account id."""
    out: dict[str, EvidenceFile] = {}
    if not os.path.isdir(directory):
        return out
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(directory, name), encoding="utf-8") as handle:
            raw = json.load(handle)
        evidence = EvidenceFile.from_json(raw)
        out[evidence.accountId] = evidence
    return out
