"""Tests for the pipeline-health check.

Two things are being pinned here, and the second matters as much as the first:

  1. It must catch a pipeline that stopped, AND a pipeline that is perfectly fresh but was
     built before the code that generates it changed. The second is the case that let the
     US bot wave sit on the dashboard for five hours on 2026-10-13 while every Action was
     green — the artefact was 3.5h old against a 36h limit.

  2. It must not cry wolf. The first draft of the config gave CASE a 120h threshold when
     its measured p90 gap is 168.69h, and scored it 43% "uptime" on sixty days of entirely
     normal behaviour. A monitor that invents problems is how this repo got into a state
     where nobody could read the Actions list, so there is a test below asserting every
     threshold sits above its artefact's own measured p90.
"""
import datetime as dt
import importlib.util
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("check", HERE.parent / "check.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

NOW = check.NOW


def ago(hours):
    return NOW - dt.timedelta(hours=hours)


@pytest.fixture
def one_pipeline(monkeypatch):
    """Reduce the config to a single 36h daily artefact with one input path."""
    monkeypatch.setattr(check, "PIPELINES",
                        [("Test", "master", "out.js", 36, None, ["src"])])
    monkeypatch.setattr(check, "newest_input", lambda ref, paths: (None, None))
    return check


def set_commit(monkeypatch, when):
    monkeypatch.setattr(check, "last_commit", lambda ref, path: when)


# ---------------------------------------------------------------- it catches a stall
def test_fresh_is_ok(one_pipeline, monkeypatch):
    set_commit(monkeypatch, ago(2))
    assert check.check()[0]["state"] == "ok"


def test_ageing_warns_before_it_breaks(one_pipeline, monkeypatch):
    set_commit(monkeypatch, ago(30))          # past 75% of 36h, not yet over
    assert check.check()[0]["state"] == "warn"


def test_stale_is_an_error(one_pipeline, monkeypatch):
    set_commit(monkeypatch, ago(40))
    r = check.check()[0]
    assert r["state"] == "error"
    assert "stale" in r["notes"][0]


def test_missing_artefact_is_an_error(one_pipeline, monkeypatch):
    set_commit(monkeypatch, None)
    assert check.check()[0]["state"] == "error"


# ------------------------------------------------- it catches fresh-but-wrong (13 Oct)
def test_young_artefact_built_before_its_inputs_is_an_error(one_pipeline, monkeypatch):
    """The 2026-10-13 case: 3.5h old against a 36h limit, and completely wrong."""
    set_commit(monkeypatch, ago(3.5))
    monkeypatch.setattr(check, "newest_input",
                        lambda ref, paths: (ago(1.0), "kpi-automation/sql"))
    r = check.check()[0]
    assert r["state"] == "error", "age alone says OK — this is the check that must fire"
    assert "built before its inputs changed" in r["notes"][0]


def test_inputs_older_than_the_artefact_are_fine(one_pipeline, monkeypatch):
    set_commit(monkeypatch, ago(2))
    monkeypatch.setattr(check, "newest_input", lambda ref, paths: (ago(50), "src"))
    assert check.check()[0]["state"] == "ok"


# ---------------------------------------------------------------- marker-driven failures
def test_failed_pull_is_an_error_even_when_recent(monkeypatch):
    monkeypatch.setattr(check, "PIPELINES",
                        [("P", "master", "pull_status.json", 36, "pull_status", [])])
    set_commit(monkeypatch, ago(1))
    monkeypatch.setattr(check, "read_marker",
                        lambda ref, path, kind: (ago(1), ["pull_succeeded = false"]))
    assert check.check()[0]["state"] == "error"


def test_degraded_risk_monitor_is_an_error(monkeypatch):
    monkeypatch.setattr(check, "PIPELINES",
                        [("R", "master", "health.json", 4, "risk_health", [])])
    set_commit(monkeypatch, ago(1))
    monkeypatch.setattr(check, "read_marker",
                        lambda ref, path, kind: (ago(1), ["status = degraded"]))
    assert check.check()[0]["state"] == "error"


def test_data_timestamp_beats_commit_time(monkeypatch):
    """A job can commit at 06:04 data that was pulled at 04:06. The data time is the one
    that matters, so a recent commit must not launder stale data into a green tick."""
    monkeypatch.setattr(check, "PIPELINES",
                        [("P", "master", "pull_status.json", 9, "pull_status", [])])
    set_commit(monkeypatch, ago(0.2))                       # committed 12 minutes ago
    monkeypatch.setattr(check, "read_marker",
                        lambda ref, path, kind: (ago(20), []))   # but the data is 20h old
    assert check.check()[0]["state"] == "error"


# ---------------------------------------------------------------- history behaviour
def test_history_records_today_and_prunes_the_window(monkeypatch):
    rows = [{"name": "Test", "ref": "master", "path": "out.js",
             "max_age_h": 36, "state": "error", "notes": []}]
    old_day = (NOW.date() - dt.timedelta(days=400)).isoformat()
    prev = {"Test": {old_day: "ok"}}
    monkeypatch.setattr(check, "day_state", lambda *a: "ok")
    hist, window = check.build_history(rows, prev, days=5, budget=10)
    assert hist["Test"][NOW.date().isoformat()] == "down", "today follows the live state"
    assert old_day not in hist["Test"], "days outside the window are pruned"
    assert len(window) == 5


def test_backfill_budget_is_respected(monkeypatch):
    calls = []
    monkeypatch.setattr(check, "day_state",
                        lambda ref, p, m, d: calls.append(d) or "ok")
    rows = [{"name": "A", "ref": "master", "path": "a", "max_age_h": 36,
             "state": "ok", "notes": []},
            {"name": "B", "ref": "master", "path": "b", "max_age_h": 36,
             "state": "ok", "notes": []}]
    check.build_history(rows, {}, days=30, budget=7)
    assert len(calls) == 7, "a first run must not fire hundreds of API calls"


# ---------------------------------------------------------------- the anti-false-alarm rule
# MEASURED 2026-10-13 from the last 40 commits touching each artefact.
MEASURED_P90_H = {
    "CUSUM registrations": 0.20, "Risk monitor": 0.21, "Payments pull": 3.05,
    "Activated payments": 3.54, "Ads + attribution": 3.54, "Merchant base": 25.08,
    "KPI daily history": 24.29, "KPI subscriptions": 24.28, "Fraud health": 24.00,
    "CASE dashboard": 168.69,
}


def test_every_threshold_sits_above_its_measured_p90():
    """The rule that keeps this page trustworthy. A threshold below an artefact's own p90
    gap scores normal behaviour as an outage — which is what a 120h CASE limit did."""
    for name, _ref, _path, max_age, _kind, _inputs in check.PIPELINES:
        p90 = MEASURED_P90_H[name]
        assert max_age > p90, (
            f"{name}: threshold {max_age}h is below its measured p90 gap of {p90}h, "
            f"so routine behaviour would be reported as a failure")


def test_config_and_measurements_have_not_drifted_apart():
    assert {p[0] for p in check.PIPELINES} == set(MEASURED_P90_H), \
        "a pipeline was added or renamed without recording its measured cadence"
