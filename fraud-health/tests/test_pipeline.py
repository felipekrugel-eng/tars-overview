"""Tests for the Fraud Health pipeline.

The acceptance cases from the handover are implemented verbatim in
`TestCohortAcceptance`, plus the defects the 2026-10-09 audit actually found.

    python3 -m pytest fraud-health/tests -q
"""

from __future__ import annotations

import copy
import json
import os
import sys
from datetime import date, datetime

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fraud_health import cohort as C  # noqa: E402
from fraud_health import evidence as EV  # noqa: E402
from fraud_health import publish as P  # noqa: E402
from fraud_health import signals as SG  # noqa: E402
from fraud_health.activation import ActivationParseError, parse  # noqa: E402
from fraud_health.ledger import (  # noqa: E402
    EVIDENCE_ARRIVAL,
    EVIDENCE_BEFORE_LEDGER,
    EVIDENCE_NEVER,
    EVIDENCE_OBSERVED,
    Ledger,
    Observation,
    creation_lower_bound,
)
from fraud_health.methodology import Methodology, apply_band, validate_record  # noqa: E402

METHODOLOGY = Methodology(
    {
        "version": "2.0",
        "scoreDirection": "higher_is_riskier",
        "dimensions": [
            {"key": "legal", "label": "Legal", "max": 20},
            {"key": "operating", "label": "Operating", "max": 15},
            {"key": "identity", "label": "Identity", "max": 15},
            {"key": "contact", "label": "Contact", "max": 10},
            {"key": "businessModel", "label": "Business model", "max": 10},
            {"key": "history", "label": "History", "max": 10},
            {"key": "behavior", "label": "Behavior", "max": 10},
            {"key": "network", "label": "Network", "max": 10},
        ],
        "bands": [
            {"min": 0, "max": 14, "label": "Very low risk", "level": "very-low", "action": "Normal monitoring"},
            {"min": 15, "max": 29, "label": "Low risk", "level": "low", "action": "Normal monitoring"},
            {"min": 30, "max": 44, "label": "Moderate risk", "level": "moderate", "action": "Monitor closely"},
            {"min": 45, "max": 59, "label": "Elevated risk", "level": "elevated", "action": "Enhanced verification"},
            {"min": 60, "max": 74, "label": "High risk", "level": "high", "action": "Verify before further payout exposure"},
            {"min": 75, "max": 89, "label": "Very high risk", "level": "very-high", "action": "Hold payouts pending review"},
            {"min": 90, "max": 100, "label": "Critical", "level": "critical", "action": "Urgent investigation — payouts blocked"},
        ],
    }
)


def obs(at: str, statuses: dict[str, str], connected=None, connected_ts=None) -> Observation:
    accounts = list(statuses)
    return Observation(
        at=at,
        statuses=statuses,
        connected=connected or {a: None for a in accounts},
        connected_ts=connected_ts or {a: None for a in accounts},
        source=at,
    )


def ledger_with(*observations: Observation) -> Ledger:
    ledger = Ledger()
    for observation in observations:
        ledger.apply(observation)
    return ledger


# --------------------------------------------------------------------- ledger


class TestLedger:
    def test_observed_transition_records_bounded_window(self):
        led = ledger_with(
            obs("2026-10-08T03:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-08T09:00:00+01:00", {"acct_a": "Enabled"}),
        )
        entry = led.accounts["acct_a"]
        assert entry.enabledEvidence == EVIDENCE_OBSERVED
        assert entry.enabledWindowStart == "2026-10-08T03:00:00+01:00"
        assert entry.enabledWindowEnd == "2026-10-08T09:00:00+01:00"
        assert entry.enabledAt == entry.enabledWindowEnd

    def test_never_enabled_has_no_date(self):
        led = ledger_with(obs("2026-10-08T03:00:00+01:00", {"acct_a": "Restricted"}))
        assert led.accounts["acct_a"].enabledEvidence == EVIDENCE_NEVER
        assert led.accounts["acct_a"].enabledAt is None

    def test_account_created_before_ledger_is_unknowable(self):
        led = ledger_with(
            obs(
                "2026-10-08T03:00:00+01:00",
                {"acct_a": "Enabled"},
                connected={"acct_a": "2026-05-01"},
            )
        )
        entry = led.accounts["acct_a"]
        assert entry.enabledEvidence == EVIDENCE_BEFORE_LEDGER
        assert entry.enabledAt is None

    def test_account_created_after_ledger_start_gets_arrival_window(self):
        """Created and enabled inside one sampling gap: still bounded by creation."""
        led = ledger_with(
            obs("2026-10-07T00:00:00+01:00", {"acct_seed": "Restricted"}),
            obs(
                "2026-10-08T09:00:00+01:00",
                {"acct_seed": "Restricted", "acct_a": "Enabled"},
                connected={"acct_a": "2026-10-08"},
                connected_ts={"acct_a": "2026-10-08T06:00:00Z"},
            ),
        )
        entry = led.accounts["acct_a"]
        assert entry.enabledEvidence == EVIDENCE_ARRIVAL
        assert entry.enabledWindowStart == "2026-10-08T06:00:00+00:00"
        assert entry.enabledWindowEnd == "2026-10-08T09:00:00+01:00"

    def test_re_enable_does_not_overwrite_first_enablement(self):
        led = ledger_with(
            obs("2026-10-01T00:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-02T00:00:00+01:00", {"acct_a": "Enabled"}),
            obs("2026-10-03T00:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-04T00:00:00+01:00", {"acct_a": "Enabled"}),
        )
        entry = led.accounts["acct_a"]
        assert entry.enabledAt == "2026-10-02T00:00:00+01:00"
        assert len(entry.transitions) == 3

    def test_round_trips_through_json(self):
        led = ledger_with(
            obs("2026-10-08T03:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-08T09:00:00+01:00", {"acct_a": "Enabled"}),
        )
        again = Ledger.from_json(json.loads(json.dumps(led.to_json())))
        assert again.accounts["acct_a"].enabledAt == led.accounts["acct_a"].enabledAt

    def test_creation_lower_bound_prefers_instant_over_date(self):
        assert creation_lower_bound("2026-10-08T06:00:00Z", "2026-10-08").startswith("2026-10-08T06:00")
        # Date-only falls back to London midnight — conservative, never later than truth.
        assert creation_lower_bound(None, "2026-10-08").startswith("2026-10-08T00:00:00+01:00")
        assert creation_lower_bound(None, None) is None


# -------------------------------------------------- cohort acceptance tests


class TestCohortAcceptance:
    """The acceptance cases named in the handover, section 11."""

    def test_created_in_august_enabled_on_target_day_is_included_once(self):
        led = ledger_with(
            obs("2026-08-01T00:00:00+01:00", {"acct_a": "Restricted"}, connected={"acct_a": "2026-08-01"}),
            obs("2026-10-08T09:00:00+01:00", {"acct_a": "Enabled"}, connected={"acct_a": "2026-08-01"}),
        )
        members = C.select(led, date(2026, 10, 8)).members
        assert [m.accountId for m in members] == ["acct_a"]

    def test_created_on_target_day_but_not_enabled_is_excluded(self):
        led = ledger_with(
            obs("2026-10-08T09:00:00+01:00", {"acct_a": "Restricted"}, connected={"acct_a": "2026-10-08"})
        )
        selection = C.select(led, date(2026, 10, 8))
        assert selection.members == []
        assert selection.exclusions.get(C.EXCLUDE_NEVER_ENABLED) == 1

    def test_enabled_on_another_day_is_excluded(self):
        led = ledger_with(
            obs("2026-10-05T00:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-06T09:00:00+01:00", {"acct_a": "Enabled"}),
        )
        selection = C.select(led, date(2026, 10, 8))
        assert selection.members == []
        assert selection.exclusions.get(C.EXCLUDE_OTHER_DAY) == 1

    def test_ambiguous_evidence_is_excluded_and_reported(self):
        led = ledger_with(
            obs("2026-10-08T09:00:00+01:00", {"acct_a": "Enabled"}, connected={"acct_a": "2026-05-01"})
        )
        selection = C.select(led, date(2026, 10, 8))
        assert selection.members == []
        assert selection.exclusions.get(C.EXCLUDE_UNKNOWN_TRANSITION) == 1

    def test_midnight_boundary_inclusive_at_start_exclusive_at_end(self):
        led = ledger_with(
            obs("2026-10-07T23:00:00+01:00", {"acct_a": "Restricted", "acct_b": "Restricted"}),
            obs("2026-10-08T00:00:00+01:00", {"acct_a": "Enabled", "acct_b": "Restricted"}),
            obs("2026-10-09T00:00:00+01:00", {"acct_a": "Enabled", "acct_b": "Enabled"}),
        )
        day8 = [m.accountId for m in C.select(led, date(2026, 10, 8)).members]
        day9 = [m.accountId for m in C.select(led, date(2026, 10, 9)).members]
        assert day8 == ["acct_a"]  # exactly 00:00 belongs to the 8th
        assert day9 == ["acct_b"]  # exactly 00:00 on the 9th belongs to the 9th, not the 8th

    def test_one_second_before_end_of_day_stays_on_that_day(self):
        led = ledger_with(
            obs("2026-10-08T20:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-08T23:59:59+01:00", {"acct_a": "Enabled"}),
        )
        assert [m.accountId for m in C.select(led, date(2026, 10, 8)).members] == ["acct_a"]

    def test_bst_to_gmt_transition_day_is_25_hours(self):
        """2026-10-25 is the BST->GMT switch; the London day is 25 hours long."""
        start, end = C.london_day_bounds(date(2026, 10, 25))
        # Must be measured in absolute time: same-zone datetime subtraction would
        # report 24h by comparing wall clocks and losing the repeated hour.
        assert (C._utc(end) - C._utc(start)).total_seconds() == 25 * 3600
        # An event at 01:30 GMT that day is still the 25th, though it is 00:30 UTC+0
        # after the clocks go back and would be mis-bucketed by a naive UTC date.
        led = ledger_with(
            obs("2026-10-25T00:30:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-25T01:30:00+00:00", {"acct_a": "Enabled"}),
        )
        assert [m.accountId for m in C.select(led, date(2026, 10, 25)).members] == ["acct_a"]

    def test_utc_day_would_disagree_with_london_day(self):
        """23:30 UTC on the 7th is 00:30 BST on the 8th — a UTC cohort gets this wrong."""
        led = ledger_with(
            obs("2026-10-07T22:00:00+00:00", {"acct_a": "Restricted"}),
            obs("2026-10-07T23:30:00+00:00", {"acct_a": "Enabled"}),
        )
        assert [m.accountId for m in C.select(led, date(2026, 10, 8)).members] == ["acct_a"]
        assert C.select(led, date(2026, 10, 7)).members == []

    def test_straddling_window_is_flagged_not_silently_confirmed(self):
        led = ledger_with(
            obs("2026-10-07T22:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-08T04:00:00+01:00", {"acct_a": "Enabled"}),
        )
        member = C.select(led, date(2026, 10, 8)).members[0]
        assert member.enabledCertainty == C.CERTAINTY_AMBIGUOUS

    def test_an_account_appears_in_exactly_one_days_cohort(self):
        led = ledger_with(
            obs("2026-10-07T22:00:00+01:00", {"acct_a": "Restricted"}),
            obs("2026-10-08T04:00:00+01:00", {"acct_a": "Enabled"}),
        )
        days = [
            d
            for d in (date(2026, 10, 6), date(2026, 10, 7), date(2026, 10, 8), date(2026, 10, 9))
            if any(m.accountId == "acct_a" for m in C.select(led, d).members)
        ]
        assert days == [date(2026, 10, 8)]

    def test_previous_complete_london_day(self):
        now = datetime(2026, 10, 9, 0, 5, tzinfo=C.LONDON)
        assert C.previous_complete_london_day(now) == date(2026, 10, 8)


# ----------------------------------------------------------------- dedupe


class TestDeduplication:
    def test_duplicate_owner_rows_collapse_to_one_account(self):
        snapshot = parse(
            'window.__ACT = [{"acct":"acct_a","name":"X","mid":"1"},'
            '{"acct":"acct_a","name":"X duplicate row","mid":"1"}];\n'
        )
        assert len(snapshot.by_account()) == 1

    def test_identical_names_are_not_merged(self):
        """Dedupe is by account id only — never by display name."""
        snapshot = parse(
            'window.__ACT = [{"acct":"acct_a","name":"Joe Pizza"},{"acct":"acct_b","name":"Joe Pizza"}];\n'
        )
        assert len(snapshot.by_account()) == 2

    def test_unparseable_activation_file_raises(self):
        with pytest.raises(ActivationParseError):
            parse("window.__SOMETHING_ELSE = [];")


# ------------------------------------------------------------- methodology


class TestMethodology:
    def _record(self, **over):
        record = {
            "accountId": "acct_a",
            "score": 30,
            "riskScore": 30,
            "trustScore": 70,
            "band": "Moderate risk",
            "action": "Monitor closely",
            "riskDimensions": {
                "legal": 10, "operating": 5, "identity": 5, "contact": 4,
                "businessModel": 3, "history": 3, "behavior": 0, "network": 0,
            },
        }
        record.update(over)
        return record

    def test_valid_record_passes(self):
        assert validate_record(self._record(), METHODOLOGY) == []

    def test_sum_mismatch_is_caught(self):
        """The exact defect that affected 402 of 481 published merchants."""
        problems = validate_record(self._record(score=73, riskScore=73, trustScore=27), METHODOLOGY)
        assert any("!= sum(riskDimensions)" in p for p in problems)

    def test_dimension_over_maximum_is_caught(self):
        record = self._record()
        record["riskDimensions"]["network"] = 99
        assert any("outside [0, 10]" in p for p in validate_record(record, METHODOLOGY))

    def test_unknown_dimension_is_caught(self):
        record = self._record()
        record["riskDimensions"]["reputation"] = 5
        assert any("unknown dimension" in p for p in validate_record(record, METHODOLOGY))

    def test_trust_score_must_be_the_complement(self):
        assert any("trustScore" in p for p in validate_record(self._record(trustScore=50), METHODOLOGY))

    def test_band_and_action_follow_the_score(self):
        problems = validate_record(self._record(band="Very low risk"), METHODOLOGY)
        assert any("band" in p for p in problems)

    def test_override_raises_band_but_sum_still_holds(self):
        record = self._record(
            riskOverrideScore=95,
            riskOverrideReason="known-network-risk",
            band="Critical",
            action="Urgent investigation — payouts blocked",
        )
        assert validate_record(record, METHODOLOGY) == []

    def test_override_without_reason_is_rejected(self):
        record = self._record(riskOverrideScore=95, band="Critical", action="Urgent investigation — payouts blocked")
        assert any("riskOverrideReason" in p for p in validate_record(record, METHODOLOGY))

    def test_index_summary_without_dimensions_is_allowed(self):
        summary = {k: v for k, v in self._record().items() if k != "riskDimensions"}
        assert validate_record(summary, METHODOLOGY, require_dimensions=False) == []

    def test_apply_band_recomputes_everything_from_score(self):
        record = apply_band({"score": 80, "riskDimensions": {}}, METHODOLOGY)
        assert record["band"] == "Very high risk"
        assert record["action"] == "Hold payouts pending review"
        assert record["trustScore"] == 20

    def test_evidence_based_stage_requires_sources(self):
        record = self._record(reviewStage="evidence-based", sources=[])
        assert any("sources is empty" in p for p in validate_record(record, METHODOLOGY))


# ------------------------------------------------------------------ signals


class TestSignals:
    def test_missing_evidence_awards_no_risk_points(self):
        """The core rule: an unknown merchant is not a risky merchant."""
        population = SG.Population([{"acct": "acct_a", "name": "Quiet Shop", "email": "a@gmail.com", "country": "US", "status": "Enabled"}])
        result = SG.evaluate("acct_a", population, None)
        assert result.dimensions(METHODOLOGY.keys, METHODOLOGY.maxima) == METHODOLOGY.zero_dimensions()
        assert result.unverified  # and it says loudly what was not checked

    def test_shared_email_across_accounts_is_a_network_signal(self):
        population = SG.Population([
            {"acct": "acct_a", "name": "A", "email": "same@gmail.com", "country": "US", "status": "Enabled"},
            {"acct": "acct_b", "name": "B", "email": "same@gmail.com", "country": "US", "status": "Enabled"},
        ])
        result = SG.evaluate("acct_a", population, None)
        assert result.dimensions(METHODOLOGY.keys, METHODOLOGY.maxima)["network"] > 0
        assert result.contradictions

    def test_disposable_email_scores_but_freemail_does_not(self):
        population = SG.Population([
            {"acct": "acct_a", "name": "A", "email": "x@mailinator.com", "country": "US", "status": "Enabled"},
            {"acct": "acct_b", "name": "B", "email": "y@gmail.com", "country": "US", "status": "Enabled"},
        ])
        maxima, keys = METHODOLOGY.maxima, METHODOLOGY.keys
        assert SG.evaluate("acct_a", population, None).dimensions(keys, maxima)["contact"] > 0
        assert SG.evaluate("acct_b", population, None).dimensions(keys, maxima)["contact"] == 0

    def test_dimension_points_are_capped_at_the_maximum(self):
        rows = [{"acct": f"acct_{i}", "name": "N", "email": "same@gmail.com", "country": "US", "status": "Enabled"} for i in range(30)]
        population = SG.Population(rows)
        dims = SG.evaluate("acct_0", population, None).dimensions(METHODOLOGY.keys, METHODOLOGY.maxima)
        assert dims["network"] <= METHODOLOGY.maxima["network"]

    def test_completeness_counts_only_genuinely_checkable_dimensions(self):
        assert SG.completeness(set(SG.COMPLETABLE), METHODOLOGY.keys) == 25


# ----------------------------------------------------------------- evidence


class TestEvidence:
    def _file(self, **over):
        raw = {
            "accountId": "acct_a",
            "reviewedAt": "2026-10-09",
            "findings": [{
                "dimension": "legal", "points": 0, "status": "verified",
                "statement": "Registered and active.", "url": "https://example.gov/x",
            }],
        }
        raw.update(over)
        return raw

    def test_valid_file_passes(self):
        assert EV.validate(self._file(), METHODOLOGY.keys, METHODOLOGY.maxima) == []

    def test_verified_without_a_source_is_rejected(self):
        """No citation, no verified claim — the failure the handover flagged."""
        raw = self._file(findings=[{"dimension": "legal", "points": 0, "status": "verified", "statement": "Trust me."}])
        assert any("without a source" in p for p in EV.validate(raw, METHODOLOGY.keys, METHODOLOGY.maxima))

    def test_unverified_without_a_source_is_fine(self):
        raw = self._file(findings=[{"dimension": "legal", "points": 0, "status": "unverified", "statement": "Searched, found nothing."}])
        assert EV.validate(raw, METHODOLOGY.keys, METHODOLOGY.maxima) == []

    def test_unknown_dimension_is_rejected(self):
        raw = self._file(findings=[{"dimension": "vibes", "points": 0, "status": "verified", "statement": "s", "url": "https://x.gov"}])
        assert any("unknown dimension" in p for p in EV.validate(raw, METHODOLOGY.keys, METHODOLOGY.maxima))

    def test_points_above_the_dimension_maximum_are_rejected(self):
        raw = self._file(findings=[{"dimension": "contact", "points": 50, "status": "contradiction", "statement": "s"}])
        assert any("outside [0, 10]" in p for p in EV.validate(raw, METHODOLOGY.keys, METHODOLOGY.maxima))

    def test_sources_are_deduplicated_by_url(self):
        raw = self._file(findings=[
            {"dimension": "legal", "points": 0, "status": "verified", "statement": "a", "url": "https://x.gov/1"},
            {"dimension": "history", "points": 0, "status": "verified", "statement": "b", "url": "https://x.gov/1"},
        ])
        assert len(EV.EvidenceFile.from_json(raw).sources()) == 1


# ------------------------------------------------------------------ publish


class TestPublish:
    def _index(self):
        return {
            "schemaVersion": 2,
            "generatedAt": "2026-10-01T00:00:00+01:00",
            "methodology": METHODOLOGY.raw,
            "merchants": [{
                "id": "acct_old", "accountId": "acct_old", "name": "Existing", "score": 40,
                "riskScore": 40, "trustScore": 60, "band": "Moderate risk",
                "action": "Monitor closely", "detailFile": "risk-health/details-legacy.json",
                "enabled": True,
            }],
        }

    def _record(self, account_id="acct_new", stage="automated-signals-only"):
        record = {
            "id": account_id, "accountId": account_id, "name": "New", "score": 0,
            "riskDimensions": METHODOLOGY.zero_dimensions(), "reviewStage": stage,
            "sources": [{"url": "https://x.gov/1"}] if stage == "evidence-based" else [],
        }
        return apply_band(record, METHODOLOGY)

    def test_existing_reviews_survive_a_new_cohort(self, tmp_path):
        index = self._index()
        P.upsert(index, [self._record()], "2026-10-08", str(tmp_path), METHODOLOGY)
        assert {m["id"] for m in index["merchants"]} == {"acct_old", "acct_new"}

    def test_empty_cohort_writes_nothing_and_does_not_advance_the_stamp(self, tmp_path):
        index = self._index()
        before = copy.deepcopy(index)
        change = P.upsert(index, [], "2026-10-08", str(tmp_path), METHODOLOGY)
        assert change["wrote"] is False
        assert index == before

    def test_rerunning_a_day_is_idempotent(self, tmp_path):
        index = self._index()
        P.upsert(index, [self._record()], "2026-10-08", str(tmp_path), METHODOLOGY)
        first = copy.deepcopy(index["merchants"])
        P.upsert(index, [self._record()], "2026-10-08", str(tmp_path), METHODOLOGY)
        assert index["merchants"] == first

    def test_a_thin_rerun_cannot_clobber_a_researched_review(self, tmp_path):
        index = self._index()
        P.upsert(index, [self._record(stage="evidence-based")], "2026-10-08", str(tmp_path), METHODOLOGY)
        change = P.upsert(index, [self._record(stage="automated-signals-only")], "2026-10-08", str(tmp_path), METHODOLOGY)
        assert change["skipped"] == ["acct_new"]

    def test_live_status_refresh_never_blanks_an_account_missing_from_the_feed(self):
        index = self._index()
        P.refresh_live_status(index, [])  # account absent from the population
        assert index["merchants"][0]["enabled"] is True

    def test_live_status_refresh_applies_a_real_change(self):
        index = self._index()
        changes = P.refresh_live_status(index, [{"acct": "acct_old", "status": "Rejected"}])
        assert index["merchants"][0]["enabled"] is False
        assert changes[0]["to"] == "False"

    def test_coverage_is_recomputed_not_asserted(self):
        index = self._index()
        coverage = P.recompute_coverage(
            index,
            [{"acct": "acct_old", "status": "Enabled"}, {"acct": "acct_other", "status": "Enabled"}],
            {},
        )
        assert coverage["enabledAccounts"] == 2
        assert coverage["reviewedEnabledAccounts"] == 1
        assert coverage["enabledNotYetReviewed"] == ["acct_other"]
