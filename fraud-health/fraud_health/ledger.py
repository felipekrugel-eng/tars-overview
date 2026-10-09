"""Enablement event ledger.

The problem this solves
----------------------
Stripe publishes no `charges_enabled_at`. Every earlier Fraud Health review dated
enablement from `TOS_ACCEPTANCE_DATE`, which is when the merchant accepted the terms —
not the instant the account crossed into `charges_enabled = true`. A merchant can accept
terms days before Stripe finishes verification, so the proxy silently mis-dates the
cohort, and a cohort keyed on it is not reproducible.

What we do instead
------------------
`activated-payments/activation-data.js` carries `status` per account, and `status ==
"Enabled"` is exactly `charges_enabled == true` (see activation.py). That file has been
regenerated and committed roughly every three hours since 2026-07-17. Replaying its git
history therefore yields a real, observed time series of `charges_enabled` per account.

A `false -> true` transition between two consecutive observations is direct evidence that
the account became enabled inside that window. We record the window rather than inventing
a point in time:

    enabledWindowStart  last observation where the account existed and was NOT enabled
    enabledWindowEnd    first observation where the account WAS enabled
    enabledAt           == enabledWindowEnd (first *observed* enabled), never a proxy

Some accounts are created and enabled inside a single sampling gap, so they first appear
already enabled and no `false -> true` edge is ever visible. Those are still bounded: an
account cannot be enabled before it exists, so its Stripe creation instant is a valid
lower bound. Certainty is therefore recorded at three levels, and never implied:

    observed_transition        we saw not-enabled then enabled. Window is the gap between
                               those two observations (typically ~3h).
    observed_arrival_enabled   the account first appeared already enabled, but it was
                               created at or after the ledger start, so the crossing lies
                               in [created, first observation]. Wider, still real.
    enabled_before_ledger      already enabled at first sighting AND created before the
                               ledger began. The instant is genuinely UNKNOWN; these are
                               never cohort-eligible.
    never_enabled              never observed enabled.

`connected_ts` (full creation instant) is preferred for the lower bound. Where only the
date-only `connected` exists — every revision committed before 2026-10-09 — the bound
falls back to 00:00 Europe/London on that date, which is conservative: it can only widen
the window, never narrow it below the truth.

Accounts are keyed by exact Stripe account id. Nothing here uses `connected` (the Stripe
account creation date) to decide enablement — creation is not enablement.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any, Iterator
from zoneinfo import ZoneInfo

from .activation import ENABLED, parse

SCHEMA_VERSION = 2

LONDON = ZoneInfo("Europe/London")

EVIDENCE_OBSERVED = "observed_transition"
EVIDENCE_ARRIVAL = "observed_arrival_enabled"
EVIDENCE_BEFORE_LEDGER = "enabled_before_ledger"
EVIDENCE_NEVER = "never_enabled"

# Evidence levels that bound the enablement instant well enough to date a cohort day.
COHORT_ELIGIBLE_EVIDENCE = (EVIDENCE_OBSERVED, EVIDENCE_ARRIVAL)


def creation_lower_bound(connected_ts: str | None, connected: str | None) -> str | None:
    """Earliest instant an account could have been enabled: when it was created.

    Prefers the full `connected_ts` instant. Falls back to 00:00 Europe/London on the
    date-only `connected`, which is conservative — it can only widen the window.
    """
    if connected_ts:
        try:
            return datetime.fromisoformat(connected_ts.replace("Z", "+00:00")).isoformat()
        except ValueError:
            pass
    if connected:
        try:
            day = datetime.strptime(connected, "%Y-%m-%d").date()
        except ValueError:
            return None
        return datetime.combine(day, time(0, 0, 0), tzinfo=LONDON).isoformat()
    return None


@dataclass
class AccountLedger:
    """Everything the ledger knows about one Stripe account."""

    accountId: str
    firstObservedAt: str
    firstObservedStatus: str
    lastObservedAt: str
    lastObservedStatus: str
    observations: int = 0
    connected: str | None = None
    connectedTs: str | None = None
    enabledAt: str | None = None
    enabledEvidence: str = EVIDENCE_NEVER
    enabledWindowStart: str | None = None
    enabledWindowEnd: str | None = None
    transitions: list[dict[str, str]] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        out = {
            "accountId": self.accountId,
            "firstObservedAt": self.firstObservedAt,
            "firstObservedStatus": self.firstObservedStatus,
            "lastObservedAt": self.lastObservedAt,
            "lastObservedStatus": self.lastObservedStatus,
            "observations": self.observations,
            "connected": self.connected,
            "connectedTs": self.connectedTs,
            "enabledAt": self.enabledAt,
            "enabledEvidence": self.enabledEvidence,
            "enabledWindowStart": self.enabledWindowStart,
            "enabledWindowEnd": self.enabledWindowEnd,
            "transitions": self.transitions,
        }
        return out

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "AccountLedger":
        return cls(
            accountId=raw["accountId"],
            firstObservedAt=raw["firstObservedAt"],
            firstObservedStatus=raw["firstObservedStatus"],
            lastObservedAt=raw["lastObservedAt"],
            lastObservedStatus=raw["lastObservedStatus"],
            observations=raw.get("observations", 0),
            connected=raw.get("connected"),
            connectedTs=raw.get("connectedTs"),
            enabledAt=raw.get("enabledAt"),
            enabledEvidence=raw.get("enabledEvidence", EVIDENCE_NEVER),
            enabledWindowStart=raw.get("enabledWindowStart"),
            enabledWindowEnd=raw.get("enabledWindowEnd"),
            transitions=raw.get("transitions", []),
        )


@dataclass
class Observation:
    """One revision of activation-data.js, with the time it was observed."""

    at: str  # ISO-8601 with offset
    statuses: dict[str, str]
    connected: dict[str, str | None]
    connected_ts: dict[str, str | None]
    source: str  # commit sha, or "working-tree"


class Ledger:
    """Append-only-ish store of enablement evidence, keyed by Stripe account id."""

    def __init__(self, accounts: dict[str, AccountLedger] | None = None) -> None:
        self.accounts: dict[str, AccountLedger] = accounts or {}
        self.sources: list[str] = []
        self.firstObservationAt: str | None = None
        self.lastObservationAt: str | None = None

    # ------------------------------------------------------------------ apply

    def apply(self, obs: Observation) -> None:
        """Fold one observation into the ledger.

        Observations MUST be applied in ascending time order; `backfill` and `update`
        both guarantee that.
        """
        if self.firstObservationAt is None:
            self.firstObservationAt = obs.at
        self.lastObservationAt = obs.at
        self.sources.append(obs.source)

        for account_id, status in obs.statuses.items():
            is_enabled = status == ENABLED
            entry = self.accounts.get(account_id)

            if entry is None:
                # First time this account has ever been seen.
                entry = AccountLedger(
                    accountId=account_id,
                    firstObservedAt=obs.at,
                    firstObservedStatus=status,
                    lastObservedAt=obs.at,
                    lastObservedStatus=status,
                    observations=1,
                    connected=obs.connected.get(account_id),
                    connectedTs=obs.connected_ts.get(account_id),
                )
                if is_enabled:
                    # Already enabled at first sighting: no false->true edge to see. Fall
                    # back to the creation instant as the lower bound, which is sound —
                    # an account cannot be enabled before it exists.
                    created = creation_lower_bound(entry.connectedTs, entry.connected)
                    ledger_start = self.firstObservationAt
                    if created and ledger_start and created >= ledger_start:
                        entry.enabledEvidence = EVIDENCE_ARRIVAL
                        entry.enabledWindowStart = created
                        entry.enabledWindowEnd = obs.at
                        entry.enabledAt = obs.at
                    else:
                        # Created before we were watching: the crossing could have
                        # happened at any time before the ledger began. Unknowable.
                        entry.enabledEvidence = EVIDENCE_BEFORE_LEDGER
                        entry.enabledAt = None
                        entry.enabledWindowStart = None
                        entry.enabledWindowEnd = obs.at
                self.accounts[account_id] = entry
                continue

            was_enabled = entry.lastObservedStatus == ENABLED
            previous_at = entry.lastObservedAt

            if is_enabled and not was_enabled:
                # The transition we actually care about, with a bounded window.
                entry.transitions.append(
                    {
                        "at": obs.at,
                        "from": entry.lastObservedStatus,
                        "to": status,
                        "windowStart": previous_at,
                    }
                )
                # Only the FIRST enablement establishes enabledAt. EVIDENCE_NEVER is the
                # one state meaning "we have only ever seen this account not-enabled", so
                # it is the only state in which this edge is the first crossing. A later
                # re-enable must not overwrite the original date, and an account whose
                # first enablement predates the ledger can never have one recovered here.
                if entry.enabledEvidence == EVIDENCE_NEVER:
                    entry.enabledEvidence = EVIDENCE_OBSERVED
                    entry.enabledWindowStart = previous_at
                    entry.enabledWindowEnd = obs.at
                    entry.enabledAt = obs.at
            elif not is_enabled and was_enabled:
                entry.transitions.append(
                    {
                        "at": obs.at,
                        "from": entry.lastObservedStatus,
                        "to": status,
                        "windowStart": previous_at,
                    }
                )

            entry.lastObservedAt = obs.at
            entry.lastObservedStatus = status
            entry.observations += 1
            if entry.connected is None:
                entry.connected = obs.connected.get(account_id)
            if entry.connectedTs is None:
                entry.connectedTs = obs.connected_ts.get(account_id)

    # ------------------------------------------------------------------- i/o

    def to_json(self) -> dict[str, Any]:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": {
                "file": "activated-payments/activation-data.js",
                "method": "git-history-replay",
                "equivalence": 'status == "Enabled" <=> charges_enabled == true (pull.js:statusOf)',
                "observations": len(self.sources),
                "firstObservationAt": self.firstObservationAt,
                "lastObservationAt": self.lastObservationAt,
            },
            "evidenceLevels": {
                EVIDENCE_OBSERVED: "not-enabled then enabled was directly observed; the "
                "true instant lies in [enabledWindowStart, enabledWindowEnd]",
                EVIDENCE_ARRIVAL: "first seen already enabled, but created at or after "
                "the ledger start; the true instant lies in [created, first observation]",
                EVIDENCE_BEFORE_LEDGER: "already enabled at first sighting AND created "
                "before the ledger began; the instant is UNKNOWN and the account is not "
                "cohort-eligible",
                EVIDENCE_NEVER: "never observed enabled",
            },
            "cohortEligibleEvidence": list(COHORT_ELIGIBLE_EVIDENCE),
            "accounts": {k: v.to_json() for k, v in sorted(self.accounts.items())},
        }

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "Ledger":
        ledger = cls({k: AccountLedger.from_json(v) for k, v in raw.get("accounts", {}).items()})
        source = raw.get("source", {})
        ledger.firstObservationAt = source.get("firstObservationAt")
        ledger.lastObservationAt = source.get("lastObservationAt")
        ledger.sources = [""] * int(source.get("observations", 0))
        return ledger

    @classmethod
    def load(cls, path: str) -> "Ledger":
        if not os.path.exists(path):
            return cls()
        with open(path, encoding="utf-8") as handle:
            return cls.from_json(json.load(handle))

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(self.to_json(), handle, indent=1, sort_keys=False)
            handle.write("\n")
        os.replace(tmp, path)


# ----------------------------------------------------------------- git replay


def _git(args: list[str], repo: str, binary: bool = False):
    result = subprocess.run(
        ["git", "-C", repo, *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout if binary else result.stdout.decode("utf-8", "replace")


def iter_history(
    repo: str,
    path: str = "activated-payments/activation-data.js",
    ref: str = "HEAD",
) -> Iterator[Observation]:
    """Yield one Observation per commit that touched `path`, oldest first.

    The commit timestamp is used as the observation time: it is when the pull job
    committed the data it had just read from Snowflake, which is the tightest honest
    upper bound we have on when that status was true.
    """
    log = _git(
        ["log", "--reverse", "--format=%H%x09%cI", ref, "--", path],
        repo,
    )
    for line in log.splitlines():
        if not line.strip():
            continue
        sha, _, committed_at = line.partition("\t")
        try:
            blob = _git(["show", f"{sha}:{path}"], repo, binary=True).decode("utf-8", "replace")
            snapshot = parse(blob)
        except Exception:
            # A revision we cannot parse is skipped rather than guessed at. It only
            # widens the window for any transition that straddles it.
            continue
        yield Observation(
            at=committed_at,
            statuses=snapshot.statuses(),
            connected={r["acct"]: r.get("connected") for r in snapshot.rows if r.get("acct")},
            connected_ts={
                r["acct"]: r.get("connected_ts") for r in snapshot.rows if r.get("acct")
            },
            source=sha,
        )


def backfill(repo: str, ref: str = "HEAD", progress: bool = False) -> Ledger:
    """Build a ledger from scratch by replaying the whole committed history."""
    ledger = Ledger()
    for count, obs in enumerate(iter_history(repo, ref=ref), start=1):
        ledger.apply(obs)
        if progress and count % 50 == 0:
            print(f"  ... {count} observations ({obs.at})", flush=True)
    return ledger


def update_from_working_tree(ledger: Ledger, repo: str, observed_at: str | None = None) -> Ledger:
    """Fold the current on-disk activation-data.js into an existing ledger.

    Used by the daily job so the ledger stays current without replaying history.
    """
    from .activation import load as load_activation

    path = os.path.join(repo, "activated-payments", "activation-data.js")
    snapshot = load_activation(path)
    at = observed_at or datetime.now().astimezone().isoformat(timespec="seconds")
    if ledger.lastObservationAt and at <= ledger.lastObservationAt:
        # Never apply an observation out of order; it would corrupt transition windows.
        return ledger
    ledger.apply(
        Observation(
            at=at,
            statuses=snapshot.statuses(),
            connected={r["acct"]: r.get("connected") for r in snapshot.rows if r.get("acct")},
            connected_ts={
                r["acct"]: r.get("connected_ts") for r in snapshot.rows if r.get("acct")
            },
            source="working-tree",
        )
    )
    return ledger
