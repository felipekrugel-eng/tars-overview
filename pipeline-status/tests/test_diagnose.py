"""Tests for the automated diagnosis.

The point of this module is to do, automatically, the entirely mechanical work that made
2026-10-14 slow: artefact -> owning workflow -> recent runs -> failing step -> log tail ->
error signature -> did it publish anything.

It is read-only on purpose. Automating the REPAIR is what caused that morning: the payments
pull retried itself roughly every ten minutes for nine hours, pulled 56,077 transactions
correctly every single time, was OOM-killed during the workbook rebuild, and threw the good
data away — twenty times, with no progress and no alert. Retrying harder is not a fix.
"""
import datetime as dt
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE.parent / (name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


diagnose = _load("diagnose")
check = _load("check")
NOW = dt.datetime.now(dt.timezone.utc)


def iso(h):
    return (NOW - dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")


def fake_runs(monkeypatch, runs):
    monkeypatch.setattr(diagnose, "_runs", lambda wf, limit=30: runs)


def no_logs(monkeypatch):
    monkeypatch.setattr(diagnose, "_failed_step_and_log", lambda rid: {
        "step": None, "signature": None, "meaning": None, "detail": None,
        "skipped_publish": None})


# ------------------------------------------------------------------ the three verdicts
def test_not_firing_at_all(monkeypatch):
    """The workflow has not run since the artefact was written: it is not firing."""
    fake_runs(monkeypatch, [{"id": 1, "created_at": iso(40), "conclusion": "success",
                             "html_url": "u"}])
    no_logs(monkeypatch)
    d = diagnose.diagnose({"name": "Payments pull"}, NOW - dt.timedelta(hours=20))
    assert "has not run since" in d["verdict"]


def test_running_but_not_publishing(monkeypatch):
    """The 2026-10-14 shape: plenty of runs, none of them succeeded."""
    runs = [{"id": i, "created_at": iso(i), "conclusion": "failure", "html_url": "u"}
            for i in range(1, 6)]
    fake_runs(monkeypatch, runs)
    no_logs(monkeypatch)
    d = diagnose.diagnose({"name": "Payments pull"}, NOW - dt.timedelta(hours=12))
    assert "running but not publishing" in d["verdict"]
    assert d["consecutive_non_success"] == 5
    assert "5 run(s)" in d["verdict"]


def test_succeeded_but_artefact_did_not_move(monkeypatch):
    """Green runs and a stale artefact means it is writing nothing, or writing elsewhere."""
    fake_runs(monkeypatch, [{"id": 1, "created_at": iso(1), "conclusion": "success",
                             "html_url": "u"}])
    no_logs(monkeypatch)
    d = diagnose.diagnose({"name": "Risk monitor"}, NOW - dt.timedelta(hours=12))
    assert "publishing nothing" in d["verdict"]


# ------------------------------------------------------------------ log signatures
def _sig(text):
    for pattern, meaning, advice in diagnose.SIGNATURES:
        import re
        if re.search(pattern, text, re.I | re.M):
            return meaning
    return None


def test_oom_is_recognised():
    assert "OOM" in _sig("line 1: 3861 Killed   python run.py\n##[error]Process completed with exit code 137")


def test_cancellation_is_not_mistaken_for_a_crash():
    assert "terminated" in _sig("The runner has received a shutdown signal")


def test_snowflake_timeout_is_recognised():
    assert "timeout" in _sig("Error: statement timed out after 4200 seconds")


def test_auth_failure_is_recognised():
    assert "authentication" in _sig("JWT token is invalid")


def test_push_race_is_recognised():
    assert "push" in _sig("! [rejected] master -> master (non-fast-forward)")


def test_unknown_errors_do_not_guess():
    assert _sig("something nobody has seen before") is None, \
        "an unrecognised failure must say nothing rather than invent a cause"


# ------------------------------------------------------------------ the summary line
def test_summary_names_the_discarded_work(monkeypatch):
    """The single most useful sentence on 14 Oct: it ran, it worked, it threw it away."""
    line = diagnose.summarise({
        "workflow": "payments-pull.yml",
        "verdict": "running but not publishing — 28 run(s) since the artefact was last written",
        "step": "Pull -> rebuild -> recalc -> verify",
        "signature": "OOM-killed on the runner (exit 137)",
        "skipped_publish": True,
        "consecutive_non_success": 28,
    })
    assert "OOM-killed" in line
    assert "publish step was SKIPPED" in line
    assert "28 consecutive" in line


def test_summary_is_quiet_when_there_is_nothing_to_say():
    assert diagnose.summarise({"note": "no workflow mapped for this artefact"}) == \
        "no workflow mapped for this artefact"


# ------------------------------------------------------------------ config integrity
def test_every_pipeline_has_an_owning_workflow():
    """A pipeline added without a workflow mapping silently gets no diagnosis — which is
    the quiet kind of gap this whole page exists to stop."""
    names = {p[0] for p in check.PIPELINES}
    missing = names - set(diagnose.WORKFLOW_FOR)
    assert not missing, "no workflow mapped for: %s" % ", ".join(sorted(missing))


def test_diagnosis_never_raises_on_a_broken_api(monkeypatch):
    """A monitoring aid must never be able to break the page it annotates."""
    def boom(wf, limit=30):
        raise RuntimeError("github down")
    monkeypatch.setattr(diagnose, "_runs", boom)
    d = diagnose.diagnose({"name": "Payments pull"}, NOW)
    assert "could not read workflow runs" in d["note"]


# ------------------------------------------------------- the lesson from 2026-10-14
def test_runner_loss_is_distinguished_from_a_step_failure(monkeypatch):
    """GitHub's own post-job steps run unconditionally unless the runner is gone.

    Getting this wrong cost a wasted fix: `if: always()` was added to the commit step and
    could never have fired, because there was no runner left to run it. The summary has to
    say so, loudly, or the next person tries the same thing.
    """
    monkeypatch.setattr(diagnose, "api", lambda *a, **k: {"jobs": [{"steps": [
        {"name": "Pull -> rebuild", "conclusion": "cancelled"},
        {"name": "Commit & push if the workbook changed", "conclusion": "skipped"},
        {"name": "Post Run actions/setup-python@v5", "conclusion": "skipped"},
        {"name": "Post Run actions/checkout@v4", "conclusion": "skipped"},
    ]}]})
    out = diagnose._failed_step_and_log(1)
    assert out["runner_lost"] is True
    line = diagnose.summarise({"runner_lost": True, "skipped_publish": True})
    assert "RUNNER ITSELF WAS LOST" in line
    assert "always()" in line


def test_a_normal_step_failure_is_not_called_runner_loss(monkeypatch):
    monkeypatch.setattr(diagnose, "api", lambda *a, **k: {"jobs": [{"steps": [
        {"name": "Pull -> rebuild", "conclusion": "failure"},
        {"name": "Commit & push", "conclusion": "skipped"},
        {"name": "Post Run actions/checkout@v4", "conclusion": "success"},
    ]}]})
    out = diagnose._failed_step_and_log(1)
    assert out["runner_lost"] is False
    assert "discarded" in diagnose.summarise({"skipped_publish": True})
