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
import json
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
    assert r["state"] == "error" and r["reason"] == "stale"
    assert "stale" in r["notes"][0]


def test_stale_beats_a_pending_rebuild(one_pipeline, monkeypatch):
    """Both true at once: the artefact has stopped AND the code moved. Stopped wins,
    because that is the one you have to act on."""
    set_commit(monkeypatch, ago(40))
    monkeypatch.setattr(check, "newest_input", lambda ref, paths: (ago(1), "src"))
    r = check.check()[0]
    assert r["state"] == "error" and r["reason"] == "stale"


def test_unreachable_is_never_red(one_pipeline, monkeypatch):
    """"Could not check" is not "broken". It must never raise an alarm."""
    def boom(ref, path):
        raise RuntimeError("network")
    monkeypatch.setattr(check, "last_commit", boom)
    r = check.check()[0]
    assert r["state"] == "unknown"
    assert r["state"] != "error"


def test_missing_artefact_is_an_error(one_pipeline, monkeypatch):
    set_commit(monkeypatch, None)
    r = check.check()[0]
    assert r["state"] == "error" and r["reason"] == "missing"


# ------------------------------------------------------- the rule, stated as one test
RED_REASONS = {"stale", "missing"}


def test_only_a_stale_or_missing_artefact_may_be_red(one_pipeline, monkeypatch):
    """The contract for this page, pinned.

    Red must mean: the dashboard is serving stale or missing data and someone has to go
    and fix something. If a future change makes anything else red, this fails.
    """
    cases = [
        ("fresh",             ago(2),   None,      None),
        ("ageing",            ago(30),  None,      None),
        ("pending rebuild",   ago(2),   ago(1),    None),
        ("source warning",    ago(2),   None,      ["status = degraded"]),
        ("stale",             ago(40),  None,      None),
    ]
    for label, commit, src, notes in cases:
        set_commit(monkeypatch, commit)
        monkeypatch.setattr(check, "newest_input",
                            lambda ref, paths, _s=src: (_s, "src") if _s else (None, None))
        if notes is not None:
            monkeypatch.setattr(check, "PIPELINES",
                                [("T", "master", "out.js", 36, "pull_status", ["src"])])
            monkeypatch.setattr(check, "read_marker",
                                lambda ref, path, kind, _n=notes: (commit, _n))
        r = check.check()[0]
        if r["state"] == "error":
            assert r["reason"] in RED_REASONS, \
                f"{label} came out red for reason {r['reason']!r} — red is only for a " \
                f"dashboard that has actually stopped updating"


# ------------------------------------------------- it catches fresh-but-wrong (13 Oct)
def test_young_artefact_built_before_its_inputs_is_flagged(one_pipeline, monkeypatch):
    """The 2026-10-13 case: 3.5h old against a 36h limit, and completely wrong.

    Flagged, but AMBER. The pipeline is healthy; the output simply predates a code change
    and the next scheduled run clears it. Making this red meant that merging a one-line fix
    painted the page red — which is exactly how everyone learned to ignore red here.
    """
    set_commit(monkeypatch, ago(3.5))
    monkeypatch.setattr(check, "newest_input",
                        lambda ref, paths: (ago(1.0), "kpi-automation/sql"))
    r = check.check()[0]
    assert r["state"] == "warn", "a pending rebuild is not a break"
    assert r["reason"] == "rebuild"
    assert "built before its inputs changed" in r["notes"][0]


def test_inputs_older_than_the_artefact_are_fine(one_pipeline, monkeypatch):
    set_commit(monkeypatch, ago(2))
    monkeypatch.setattr(check, "newest_input", lambda ref, paths: (ago(50), "src"))
    assert check.check()[0]["state"] == "ok"


# ---------------------------------------------------------------- marker-driven failures
def test_failed_pull_with_fresh_data_is_amber_not_red(monkeypatch):
    """The last pull failed but the published data is still inside its window, so the
    dashboard is not broken and there is nothing to go and fix yet. If the failures keep
    up, the age check turns it red on its own — which is the right moment to act."""
    monkeypatch.setattr(check, "PIPELINES",
                        [("P", "master", "pull_status.json", 36, "pull_status", [])])
    set_commit(monkeypatch, ago(1))
    monkeypatch.setattr(check, "read_marker",
                        lambda ref, path, kind: (ago(1), ["pull_succeeded = false"]))
    r = check.check()[0]
    assert r["state"] == "warn" and r["reason"] == "source"


def test_failed_pull_that_has_gone_stale_is_red(monkeypatch):
    monkeypatch.setattr(check, "PIPELINES",
                        [("P", "master", "pull_status.json", 36, "pull_status", [])])
    set_commit(monkeypatch, ago(50))
    monkeypatch.setattr(check, "read_marker",
                        lambda ref, path, kind: (ago(50), ["pull_succeeded = false"]))
    r = check.check()[0]
    assert r["state"] == "error" and r["reason"] == "stale"


def test_degraded_risk_monitor_with_fresh_data_is_amber(monkeypatch):
    monkeypatch.setattr(check, "PIPELINES",
                        [("R", "master", "health.json", 4, "risk_health", [])])
    set_commit(monkeypatch, ago(1))
    monkeypatch.setattr(check, "read_marker",
                        lambda ref, path, kind: (ago(1), ["status = degraded"]))
    r = check.check()[0]
    assert r["state"] == "warn" and r["reason"] == "source"


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
    """The budget caps BACKFILL of past days. Today is always evaluated — it is one call
    per pipeline and it is the day anyone actually cares about."""
    calls = []
    monkeypatch.setattr(check, "day_state",
                        lambda ref, p, m, d: calls.append(d) or "ok")
    rows = [{"name": "A", "ref": "master", "path": "a", "max_age_h": 36,
             "state": "ok", "notes": []},
            {"name": "B", "ref": "master", "path": "b", "max_age_h": 36,
             "state": "ok", "notes": []}]
    today = check.NOW.date()
    check.build_history(rows, {}, days=30, budget=7)
    past = [d for d in calls if d != today]
    assert len(past) <= 7, "a first run must not fire hundreds of API calls"
    assert calls.count(today) == len(rows), "today must be evaluated for every pipeline"


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


# ---------------------------------------------------------- the record must not heal
def test_a_days_bar_never_recovers_its_colour(monkeypatch):
    """A day that went down stays down, even once the pipeline is fixed.

    The payments pull was down for fourteen hours on 2026-10-14, was fixed, and the bar
    went green as though nothing had happened — because today's cell was overwritten with
    the live state on every check. A chart that forgets outages is worse than no chart.
    """
    rows = [{"name": "P", "ref": "master", "path": "p.json", "max_age_h": 9,
             "state": "error", "notes": []}]
    monkeypatch.setattr(check, "day_state", lambda *a: "ok")
    today = check.NOW.date().isoformat()

    hist, _ = check.build_history(rows, {}, days=3, budget=5)
    assert hist["P"][today] == "down", "an outage must be recorded when it happens"

    rows[0]["state"] = "ok"                       # recovered
    hist, _ = check.build_history(rows, hist, days=3, budget=5)
    assert hist["P"][today] == "down", "recovery must NOT erase the outage"


def test_severity_only_ratchets_upward(monkeypatch):
    rows = [{"name": "P", "ref": "master", "path": "p.json", "max_age_h": 9,
             "state": "warn", "notes": []}]
    monkeypatch.setattr(check, "day_state", lambda *a: "ok")
    today = check.NOW.date().isoformat()
    hist, _ = check.build_history(rows, {}, days=3, budget=5)
    assert hist["P"][today] == "warn"
    rows[0]["state"] = "error"                    # got worse
    hist, _ = check.build_history(rows, hist, days=3, budget=5)
    assert hist["P"][today] == "down", "a worse state must still be recorded"


def test_a_very_busy_day_is_not_reported_as_an_outage(monkeypatch):
    """cusum commits ~144 times a day. Reading only the first page of 100 invents a gap
    where the older commits were, which is how it first came out at 1.7% uptime."""
    monkeypatch.setattr(check, "last_commit_before", lambda ref, p, when: None)
    monkeypatch.setattr(check, "commits_between",
                        lambda ref, p, s, e: ([check.NOW] * 300, False))   # cap hit
    day = check.NOW.date() - dt.timedelta(days=1)
    assert check.day_state("gh-pages", "docs/cusum-data.js", 2, day) == "ok"


def test_an_uncoverable_quiet_day_is_not_guessed(monkeypatch):
    monkeypatch.setattr(check, "last_commit_before", lambda ref, p, when: None)
    monkeypatch.setattr(check, "commits_between", lambda ref, p, s, e: ([check.NOW] * 3, False))
    day = check.NOW.date() - dt.timedelta(days=1)
    assert check.day_state("master", "x.json", 36, day) == "nodata"


def test_uptime_is_not_quoted_until_it_means_something():
    """One bad day out of one known day reads '0.00 % uptime', which is alarming and
    carries no information. The backfill takes a few runs to populate, so the chart must
    not libel a pipeline in the meantime."""
    rows = [{"name": "P", "path": "p", "ref": "master", "max_age_h": 9,
             "state": "error", "reason": "stale", "notes": [], "age_h": 12.0}]
    window = [(check.NOW.date() - dt.timedelta(days=i)).isoformat() for i in range(2, -1, -1)]
    hist = {"P": {window[-1]: "down"}}
    html = check.render_html(rows, "error", hist, window)
    assert "0.00 % uptime" not in html
    assert "1 day recorded" in html


def test_uptime_appears_once_there_is_enough_history():
    rows = [{"name": "P", "path": "p", "ref": "master", "max_age_h": 9,
             "state": "ok", "reason": None, "notes": [], "age_h": 1.0}]
    days = check.MIN_DAYS_FOR_UPTIME + 1
    window = [(check.NOW.date() - dt.timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    hist = {"P": {d: "ok" for d in window}}
    html = check.render_html(rows, "ok", hist, window)
    assert "100.00 % uptime" in html


def test_slack_message_carries_the_diagnosis(monkeypatch, capsys):
    """Slack is what gets read away from the dashboard, so it must carry the diagnosis —
    "payments pull is stale" is far less use than "it is running and discarding its output".
    #26 added this to the page and the matching change here never landed."""
    posted = {}
    class _R:
        def read(self): return b""
        def __enter__(self): return self
        def __exit__(self, *a): return False
    def fake_open(req, timeout=0):
        posted["body"] = json.loads(req.data.decode())
        return _R()
    monkeypatch.setattr(check.urllib.request, "urlopen", fake_open)
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x")
    monkeypatch.setenv("STATUS_SOFT", "1")
    monkeypatch.setattr(check, "check", lambda: [
        {"name": "Payments pull", "path": "p", "ref": "master", "max_age_h": 9,
         "state": "error", "reason": "stale", "age_h": 12.0, "notes": ["stale: 12.0h old"],
         "diagnosis_line": "running but not publishing — its publish step was SKIPPED",
         "diagnosis": {"failing_run": "https://github.com/x/y/actions/runs/1"}}])
    # main() re-runs the diagnosis, which would overwrite the fixture with a live lookup.
    monkeypatch.setattr(check, "_diagnose", None)
    monkeypatch.setattr(check, "build_history", lambda rows, prev, **k: ({}, []))
    monkeypatch.setattr(check, "render_html", lambda *a: "<html></html>")
    monkeypatch.setenv("STATUS_OUT", "/tmp/_slacktest")
    check.main()
    text = posted["body"]["text"]
    assert "Pipeline health" in text, "must be distinguishable from the bot screen"
    assert "publish step was SKIPPED" in text, "the diagnosis must reach Slack"
    assert "see the failing run" in text
