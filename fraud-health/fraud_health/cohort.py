"""Daily enabled-only cohort selection.

The cohort for a London calendar day D is the set of connected accounts the ledger
observed crossing into `charges_enabled = true` on that day.

Day boundaries are Europe/London, inclusive of 00:00:00 and exclusive of the next
00:00:00, resolved through the IANA tz database so BST/GMT transitions are handled
rather than assumed. A UTC calendar day is NOT used: during BST it is offset by an hour
and would both drop and add merchants at the edges.

Selection rule
--------------
An account is in the cohort for D when its first observed enablement window ENDS inside
D — that is, the first observation that showed it enabled falls on D.

Because the underlying feed is sampled roughly every three hours, the true instant is
known only to lie in [enabledWindowStart, enabledWindowEnd]. Two cases follow:

  confirmed          the whole window lies inside D. The account became enabled on D.
  boundary_ambiguous the window straddles midnight, so the crossing may have happened
                     late on D-1. The account is still reviewed exactly once, on D, and
                     the ambiguity is published with it rather than hidden.

Assigning straddlers to the day of `enabledWindowEnd` is deliberate. Dropping them, as a
strict reading would, would leave permanent unreviewed holes in a fraud control — the
one outcome worse than a review carrying a disclosed ±3h uncertainty.

Everything else is excluded with a machine-readable reason code, and the exclusion report
is published alongside the cohort so a reviewer can see what was *not* looked at.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .ledger import (
    COHORT_ELIGIBLE_EVIDENCE,
    EVIDENCE_BEFORE_LEDGER,
    EVIDENCE_NEVER,
    Ledger,
)

LONDON = ZoneInfo("Europe/London")

CERTAINTY_CONFIRMED = "confirmed"
CERTAINTY_AMBIGUOUS = "boundary_ambiguous"

# Exclusion reason codes. Stable strings — the dashboard and tests rely on them.
EXCLUDE_NEVER_ENABLED = "never_observed_enabled"
EXCLUDE_UNKNOWN_TRANSITION = "enabled_before_ledger_started"
EXCLUDE_NO_BOUND = "no_creation_lower_bound"
EXCLUDE_OTHER_DAY = "enabled_on_another_day"
EXCLUDE_NOT_CURRENTLY_ENABLED = "no_longer_enabled_at_review_time"


@dataclass
class CohortMember:
    accountId: str
    enabledAt: str
    enabledWindowStart: str
    enabledWindowEnd: str
    enabledCertainty: str
    enabledEvidenceLevel: str
    enabledWindowHours: float
    connected: str | None
    currentStatus: str

    def to_json(self) -> dict[str, Any]:
        return {
            "accountId": self.accountId,
            "enabledAt": self.enabledAt,
            "enabledWindowStart": self.enabledWindowStart,
            "enabledWindowEnd": self.enabledWindowEnd,
            "enabledWindowHours": self.enabledWindowHours,
            "enabledCertainty": self.enabledCertainty,
            "enabledEvidenceLevel": self.enabledEvidenceLevel,
            "enabledEvidence": "derived from the committed history of charges_enabled in "
            "activated-payments/activation-data.js (see fraud-health ledger)",
            "connected": self.connected,
            "currentStatus": self.currentStatus,
        }


@dataclass
class Cohort:
    cohortDate: str
    windowStart: str
    windowEnd: str
    timezone: str = "Europe/London"
    members: list[CohortMember] = field(default_factory=list)
    exclusions: dict[str, int] = field(default_factory=dict)
    excludedAccounts: list[dict[str, str]] = field(default_factory=list)

    def to_json(self, include_excluded: bool = False) -> dict[str, Any]:
        out: dict[str, Any] = {
            "cohortDate": self.cohortDate,
            "timezone": self.timezone,
            "windowStart": self.windowStart,
            "windowEnd": self.windowEnd,
            "count": len(self.members),
            "confirmed": sum(1 for m in self.members if m.enabledCertainty == CERTAINTY_CONFIRMED),
            "boundaryAmbiguous": sum(
                1 for m in self.members if m.enabledCertainty == CERTAINTY_AMBIGUOUS
            ),
            "members": [m.to_json() for m in self.members],
            "exclusions": self.exclusions,
        }
        if include_excluded:
            out["excludedAccounts"] = self.excludedAccounts
        return out


def _utc(moment: datetime) -> datetime:
    """Absolute time, for arithmetic and comparison.

    Python compares and subtracts two aware datetimes that share a tzinfo object by
    IGNORING the zone and using the naive wall-clock values. Across the BST/GMT switch
    that silently loses an hour: the 25-hour day of 2026-10-25 measures as 24. Every
    comparison and every duration below therefore goes through UTC.
    """
    return moment.astimezone(timezone.utc)


def london_day_bounds(day: date) -> tuple[datetime, datetime]:
    """Return [00:00:00, next 00:00:00) for `day` in Europe/London.

    Built from consecutive local midnights rather than by adding 24h, so the 23h and 25h
    days at the BST/GMT transitions come out right.
    """
    start = datetime.combine(day, time(0, 0, 0), tzinfo=LONDON)
    end = datetime.combine(day + timedelta(days=1), time(0, 0, 0), tzinfo=LONDON)
    return start, end


def previous_complete_london_day(now: datetime | None = None) -> date:
    """The last London calendar day that has fully elapsed."""
    now = (now or datetime.now(tz=LONDON)).astimezone(LONDON)
    return now.date() - timedelta(days=1)


def _parse(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp)


def select(
    ledger: Ledger,
    day: date,
    require_currently_enabled: bool = True,
) -> Cohort:
    """Build the cohort for one London calendar day."""
    start, end = london_day_bounds(day)
    cohort = Cohort(
        cohortDate=day.isoformat(),
        windowStart=start.isoformat(),
        windowEnd=end.isoformat(),
    )
    counts: dict[str, int] = {}

    def exclude(account_id: str, reason: str) -> None:
        counts[reason] = counts.get(reason, 0) + 1
        cohort.excludedAccounts.append({"accountId": account_id, "reason": reason})

    for account_id, entry in sorted(ledger.accounts.items()):
        if entry.enabledEvidence == EVIDENCE_BEFORE_LEDGER:
            # Already enabled before we were watching, and created before that too. Dating
            # it from the first sighting would invent a crossing we never saw. These are
            # the historical population, reviewed separately — never a daily cohort.
            exclude(account_id, EXCLUDE_UNKNOWN_TRANSITION)
            continue
        if entry.enabledEvidence == EVIDENCE_NEVER:
            exclude(account_id, EXCLUDE_NEVER_ENABLED)
            continue
        if entry.enabledEvidence not in COHORT_ELIGIBLE_EVIDENCE:
            exclude(account_id, EXCLUDE_NEVER_ENABLED)
            continue
        if not entry.enabledWindowEnd or not entry.enabledWindowStart:
            exclude(account_id, EXCLUDE_NO_BOUND)
            continue

        window_end = _parse(entry.enabledWindowEnd).astimezone(LONDON)
        if not (_utc(start) <= _utc(window_end) < _utc(end)):
            exclude(account_id, EXCLUDE_OTHER_DAY)
            continue

        if require_currently_enabled and entry.lastObservedStatus != "Enabled":
            # Enabled on the cohort day but no longer enabled now. Not a silent drop:
            # it is reported so a reviewer can see a same-week enable-then-disable.
            exclude(account_id, EXCLUDE_NOT_CURRENTLY_ENABLED)
            continue

        window_start = _parse(entry.enabledWindowStart).astimezone(LONDON)
        certainty = (
            CERTAINTY_CONFIRMED if _utc(window_start) >= _utc(start) else CERTAINTY_AMBIGUOUS
        )
        hours = round((_utc(window_end) - _utc(window_start)).total_seconds() / 3600.0, 2)
        cohort.members.append(
            CohortMember(
                accountId=account_id,
                enabledAt=window_end.isoformat(),
                enabledWindowStart=window_start.isoformat(),
                enabledWindowEnd=window_end.isoformat(),
                enabledCertainty=certainty,
                enabledEvidenceLevel=entry.enabledEvidence,
                enabledWindowHours=hours,
                connected=entry.connected,
                currentStatus=entry.lastObservedStatus,
            )
        )

    cohort.exclusions = dict(sorted(counts.items()))
    return cohort


def backlog(ledger: Ledger, reviewed: set[str], since: date | None = None) -> list[str]:
    """Accounts with an observed enablement transition that have never been reviewed.

    The daily job alone cannot close a hole left by a day the job did not run, so it also
    reports this backlog instead of quietly moving on.
    """
    out = []
    for account_id, entry in sorted(ledger.accounts.items()):
        if entry.enabledEvidence not in COHORT_ELIGIBLE_EVIDENCE or account_id in reviewed:
            continue
        if since and entry.enabledWindowEnd:
            if _parse(entry.enabledWindowEnd).astimezone(LONDON).date() < since:
                continue
        out.append(account_id)
    return out
