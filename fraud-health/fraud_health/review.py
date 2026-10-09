"""Build one published review record from signals + reviewer evidence."""

from __future__ import annotations

from typing import Any

from . import evidence as ev
from . import signals as sg
from .cohort import CohortMember
from .ledger import AccountLedger
from .methodology import STAGE_EVIDENCED, STAGE_SIGNALS, Methodology, apply_band

CONFIDENCE_BY_COMPLETENESS = ((80, "high"), (50, "medium"), (0, "low"))

# Review priority is deliberately SEPARATE from the risk band.
#
# The methodology forbids missing evidence from adding risk points, which is right — but
# it means a brand-new merchant nobody has checked scores 0 and lands in "Very low risk /
# Normal monitoring". That reads as a clean bill of health for a file nobody has opened.
#
# Risk stays pure; this carries the operational consequence of an incomplete file, so the
# page can say "no observed risk, and also barely reviewed" without conflating the two.
PRIORITY_OUTSTANDING = "Verification outstanding"
PRIORITY_PARTIAL = "Verification partial"
PRIORITY_COMPLETE = "Verification complete"


def review_priority(completeness: int, stage: str) -> str:
    if stage != STAGE_EVIDENCED or completeness < 50:
        return PRIORITY_OUTSTANDING if completeness < 50 else PRIORITY_PARTIAL
    return PRIORITY_COMPLETE if completeness >= 80 else PRIORITY_PARTIAL


def _confidence(completeness: int, stage: str) -> str:
    # Signals alone can never be better than low confidence, whatever the arithmetic
    # says: nothing in the file has been independently corroborated.
    if stage != STAGE_EVIDENCED:
        return "low"
    for threshold, label in CONFIDENCE_BY_COMPLETENESS:
        if completeness >= threshold:
            return label
    return "low"


def build(
    member: CohortMember,
    population: sg.Population,
    ledger_entry: AccountLedger | None,
    methodology: Methodology,
    evidence: ev.EvidenceFile | None = None,
    kyc_blockers: dict[str, list[str]] | None = None,
    reviewed_at: str = "",
) -> dict[str, Any]:
    """Produce a merchant detail record satisfying the dashboard contract."""
    result = sg.evaluate(member.accountId, population, ledger_entry, kyc_blockers)
    dims = result.dimensions(methodology.keys, methodology.maxima)

    verified = list(result.verified)
    unverified = list(result.unverified)
    contradictions = list(result.contradictions)
    evidence_needed: list[str] = []
    sources: list[dict[str, Any]] = []
    assessed = set(sg.COMPLETABLE)
    summary = ""

    if evidence is not None:
        for finding in evidence.findings:
            dimension = finding["dimension"]
            points = int(finding.get("points", 0) or 0)
            # A reviewer's finding REPLACES the automated value for that dimension: they
            # looked, the job only inferred.
            dims[dimension] = min(points, methodology.maxima[dimension])
            status = finding.get("status")
            # Only a check that REACHED A CONCLUSION counts towards completeness. A
            # finding of "I searched and found nothing conclusive" is worth recording so
            # the next reviewer does not repeat it, but it must not make the file look
            # more complete, or more confident, than it is.
            if status in (ev.STATUS_VERIFIED, ev.STATUS_CONTRADICTION):
                assessed.add(dimension)
            statement = finding["statement"]
            url = finding.get("url")
            rendered = f"{statement} [{url}]" if url else statement
            if status == ev.STATUS_VERIFIED:
                verified.append(rendered)
            elif status == ev.STATUS_CONTRADICTION:
                contradictions.append(rendered)
            else:
                unverified.append(rendered)
        # Drop the standing "not checked" disclaimers only for dimensions where a check
        # actually concluded — an inconclusive search leaves the gap open.
        checked = assessed - sg.COMPLETABLE
        unverified = [u for u in unverified if not _disclaimer_for(u, checked)]
        evidence_needed = list(evidence.evidenceNeeded)
        sources = evidence.sources()
        summary = evidence.summary

    # Evidence-based means a check concluded against a cited source. Sources attached to
    # purely inconclusive findings do not earn that label.
    concluded = bool(assessed - sg.COMPLETABLE)
    stage = STAGE_EVIDENCED if (sources and concluded) else STAGE_SIGNALS
    completeness = sg.completeness(assessed, methodology.keys)
    score = methodology.total(dims)

    if not summary:
        summary = _default_summary(score, contradictions, completeness, stage)

    if not evidence_needed:
        evidence_needed = _default_evidence_needed(methodology, assessed)

    row = population.by_account.get(member.accountId, {})
    record: dict[str, Any] = {
        "id": member.accountId,
        "accountId": member.accountId,
        "merchantId": str(row.get("mid")) if row.get("mid") else None,
        "name": row.get("name") or member.accountId,
        "score": score,
        "riskDimensions": dims,
        "verified": verified,
        "unverified": unverified,
        "contradictions": contradictions,
        "evidenceNeeded": evidence_needed,
        "sources": sources,
        "summary": summary,
        "reviewCompleteness": completeness,
        "confidence": _confidence(completeness, stage),
        "reviewStage": stage,
        "reviewPriority": review_priority(completeness, stage),
        "reviewType": "daily-enabled-review",
        "reviewedAt": reviewed_at,
        "reviewer": (evidence.reviewer if evidence else "fraud-health-pipeline"),
        # Enablement provenance, carried verbatim from the ledger.
        "enabledAt": member.enabledAt,
        "enabledWindowStart": member.enabledWindowStart,
        "enabledWindowEnd": member.enabledWindowEnd,
        "enabledWindowHours": member.enabledWindowHours,
        "enabledCertainty": member.enabledCertainty,
        "enabledEvidenceLevel": member.enabledEvidenceLevel,
        "enabledEvidence": member.to_json()["enabledEvidence"],
        "createdAt": row.get("connected_ts") or row.get("connected"),
        "enabled": row.get("status") == "Enabled",
        "detailsSubmitted": None,
        "location": row.get("country"),
        "email": row.get("email"),
        "website": None,
        "mcc": None,
        "representative": None,
        "successfulTransactions": row.get("pos_receipts"),
        "hasTransacted": bool(row.get("pos_receipts")),
        "lastTransactedAt": row.get("last_sale"),
    }
    return apply_band(record, methodology)


_DISCLAIMERS = {
    "legal": "Legal registration and company standing have not been checked",
    "operating": "Operating premises, licensing and permits have not been verified",
    "identity": "Representative identity and bank-account ownership have not been",
    "history": "Independent operating history and reputation have not been researched",
}


def _disclaimer_for(text: str, checked: set[str]) -> bool:
    return any(text.startswith(prefix) for key, prefix in _DISCLAIMERS.items() if key in checked)


def _default_summary(score: int, contradictions: list[str], completeness: int, stage: str) -> str:
    if stage != STAGE_EVIDENCED:
        base = (
            f"Automated signal pass only: {completeness}% of the risk dimensions are "
            f"backed by data we hold. "
        )
        if contradictions:
            return base + (
                f"{len(contradictions)} affirmative anomaly/anomalies were observed and "
                "are listed below. Independent verification is still outstanding."
            )
        return base + (
            "No affirmative anomaly was observed in warehouse data. This is not a "
            "clean bill of health — the legal, operating, identity and history "
            "dimensions have not been independently checked."
        )
    if contradictions:
        return (
            f"Independent review found {len(contradictions)} contradiction(s) against "
            "public and platform sources; see below."
        )
    return (
        "Independent review corroborated the merchant against cited public sources with "
        "no contradiction identified."
    )


def _default_evidence_needed(methodology: Methodology, assessed: set[str]) -> list[str]:
    wanted = {
        "legal": "Government or state business-registration extract for the exact legal entity.",
        "operating": "Evidence of a real operating location: licence, permit or premises confirmation.",
        "identity": "Representative identity and payout bank-account ownership linkage.",
        "history": "Independent operating history: reviews, listings, supplier or customer evidence.",
        "businessModel": "Confirmation that MCC, descriptor and the actual goods sold cohere.",
        "contact": "Confirmation that phone, website and email resolve to the same business.",
    }
    return [text for key, text in wanted.items() if key in methodology.keys and key not in assessed]
