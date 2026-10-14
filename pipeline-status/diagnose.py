#!/usr/bin/env python3
"""
diagnose.py — turn "a pipeline is red" into "here is what is wrong and where".

WHY DIAGNOSIS AND NOT AUTO-REPAIR. The obvious next step after a status page is to make it
fix things. This repo already shows why that is the wrong instinct: on 2026-10-14 the
payments pull retried itself roughly every ten minutes for nine hours. Every single attempt
pulled 56,077 transactions correctly, was OOM-killed during the workbook rebuild, and threw
the good data away — twenty times, about eight hours of runner time, zero progress. The
automation was not the cure, it WAS the failure mode: it made a broken thing fail faster
and more quietly.

What actually cost time that morning was not the repair. It was working out what had
broken, and every step of that was mechanical:

    artefact -> owning workflow -> recent runs -> which step failed -> log tail ->
    error signature -> did it publish anything?

So that is what this automates. It is strictly read-only: it dispatches nothing, retries
nothing, and changes nothing. It just means the next person starts where I finished rather
than where I started.

THE CHECK THAT MATTERS MOST is `published`: has the owning workflow RUN since the artefact
was last written? A job that stopped running and a job that runs happily and publishes
nothing look identical from the artefact alone, and they need opposite responses. That
distinction is exactly what was invisible on 14 Oct.
"""
import datetime as dt
import io
import json
import os
import re
import urllib.parse
import urllib.request
import urllib.error
import zipfile

REPO = os.environ.get("STATUS_REPO", "felipekrugel-eng/tars-overview")
TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")

# Which workflow is responsible for writing each artefact.
WORKFLOW_FOR = {
    "CUSUM registrations": "cusum-pull.yml",
    "Risk monitor":        "loyverse-risk-monitor.yml",
    "Payments pull":       "payments-pull.yml",
    "Activated payments":  "activated-payments-pull.yml",
    "Ads + attribution":   "ads-pull.yml",
    "Merchant base":       "merchant-base-pull.yml",
    "KPI daily history":   "kpi-pull.yml",
    "KPI subscriptions":   "kpi-pull.yml",
    "Fraud health":        "fraud-health-daily.yml",
    "CASE dashboard":      "snowflake-pull.yml",
}

# Log signatures worth naming, most specific first. Each maps to what it means and what a
# person would do next — the sentence I had to work out by hand on 14 Oct.
SIGNATURES = [
    (r"Killed\s*$|Killed\s+python|exit code 137",
     "OOM-killed on the runner (exit 137)",
     "The runner ran out of memory. Needs a lower-memory build, a larger runner, or less data."),
    (r"The runner has received a shutdown signal|exit code 143",
     "terminated (exit 143)",
     "Cancelled or the runner went away. Usually concurrency or a timeout, not a code fault."),
    (r"statement timed out|STATEMENT_TIMEOUT|Query reached its timeout",
     "Snowflake statement timeout",
     "A query exceeded its timeout. Not a credentials problem."),
    (r"The job running on runner .* has exceeded the maximum execution time|timeout-minutes",
     "job timeout",
     "The job hit timeout-minutes. It is too slow, or hung."),
    (r"JWT token is invalid|Incorrect username or password|authentication failed|invalid_grant",
     "authentication failure",
     "A credential expired or was rotated. Check the relevant secret."),
    (r"403 Forbidden|rate limit exceeded|secondary rate limit",
     "refused or rate-limited",
     "Permission or throttling. Re-running will not help until that is resolved."),
    (r"non-fast-forward|failed to push some refs|Updates were rejected",
     "push rejected",
     "Lost a push race against master. The job's retry loop should cover this."),
    (r"Traceback \(most recent call last\)",
     "unhandled exception",
     "A code fault. The last line of the traceback is below."),
]


def api(path, raw=False, binary=False):
    url = "https://api.github.com/repos/" + REPO + "/" + path
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github.raw" if raw else "application/vnd.github+json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(req, timeout=45) as r:
        data = r.read()
    if binary:
        return data
    body = data.decode("utf-8", "replace")
    return body if raw else json.loads(body)


def _runs(wf, limit=30):
    return api("actions/workflows/%s/runs?per_page=%d" % (urllib.parse.quote(wf), limit)) \
        .get("workflow_runs", [])


def _ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _failed_step_and_log(run_id):
    """Which step failed, and the signature in its log."""
    out = {"step": None, "signature": None, "meaning": None, "detail": None,
           "skipped_publish": None, "runner_lost": None}
    try:
        jobs = api("actions/runs/%d/jobs" % run_id).get("jobs", [])
    except Exception:
        return out
    if not jobs:
        return out
    job = jobs[0]
    for s in job.get("steps", []):
        if s.get("conclusion") == "failure":
            out["step"] = s.get("name")
            break
    # Did the job do its work and then fail to publish it? The 14 Oct shape.
    for s in job.get("steps", []):
        if re.search(r"commit|push|publish", s.get("name", ""), re.I):
            out["skipped_publish"] = (s.get("conclusion") == "skipped")
            break

    # DID THE RUNNER ITSELF DIE? GitHub's own post-job steps ("Post Run actions/checkout")
    # run unconditionally — unless there is no runner left to run them. If those are
    # skipped, the VM went away rather than the code failing, and NO conditional can help:
    # `if: always()` has nothing to execute on. This is worth naming because it is easy to
    # get wrong by hand — on 2026-10-14 the first attempted fix was exactly an `always()`
    # that could never have fired.
    posts = [s for s in job.get("steps", []) if s.get("name", "").startswith("Post ")]
    if posts:
        out["runner_lost"] = all(s.get("conclusion") == "skipped" for s in posts)
    try:
        blob = api("actions/runs/%d/logs" % run_id, binary=True)
        zf = zipfile.ZipFile(io.BytesIO(blob))
        # The archive mangles step names into filenames: "Pull -> rebuild -> recalc"
        # becomes "8_Pull - rebuild - recalc.txt". Match on alphanumerics only, or the
        # fallback silently reads the wrong file and every signature misses.
        def norm(x):
            return re.sub(r"[^a-z0-9]", "", x.lower())
        names = zf.namelist()
        want = norm(out["step"] or "")
        hits = [n for n in names if want and want[:24] in norm(n)]
        if not hits:   # last resort: the biggest log is almost always the real step
            hits = sorted(names, key=lambda n: zf.getinfo(n).file_size)[-1:]
        text = zf.read(hits[-1]).decode("utf-8", "replace")
    except Exception:
        return out
    tail = text[-20000:]
    for pattern, meaning, advice in SIGNATURES:
        if re.search(pattern, tail, re.I | re.M):
            out["signature"], out["meaning"] = meaning, advice
            break
    err = [l for l in tail.splitlines() if "##[error]" in l]
    if err:
        out["detail"] = re.sub(r"^[0-9T:.Z-]+\s*", "", err[-1]).replace("##[error]", "").strip()[:160]
    return out


def diagnose(row, artefact_commit_at):
    """Everything a person would look up before deciding what to do."""
    wf = WORKFLOW_FOR.get(row["name"])
    d = {"workflow": wf}
    if not wf:
        d["note"] = "no workflow mapped for this artefact"
        return d
    try:
        runs = [r for r in _runs(wf) if r.get("conclusion")]
    except Exception as e:
        d["note"] = "could not read workflow runs: %s" % e
        return d
    if not runs:
        d["note"] = "the workflow has no completed runs"
        return d

    ok = [r for r in runs if r["conclusion"] == "success"]
    d["last_success"] = ok[0]["created_at"] if ok else None
    streak = 0
    for r in runs:
        if r["conclusion"] == "success":
            break
        streak += 1
    d["consecutive_non_success"] = streak
    d["recent"] = [{"at": r["created_at"], "outcome": r["conclusion"]} for r in runs[:6]]

    # THE KEY QUESTION: has it run at all since the artefact was last written?
    if artefact_commit_at:
        since = [r for r in runs if _ts(r["created_at"]) > artefact_commit_at]
        d["runs_since_artefact"] = len(since)
        if since and not any(r["conclusion"] == "success" for r in since):
            d["verdict"] = ("running but not publishing — %d run(s) since the artefact was "
                            "last written, none succeeded" % len(since))
        elif since:
            d["verdict"] = ("ran and succeeded since the artefact was last written — it is "
                            "publishing nothing, or writing elsewhere")
        else:
            d["verdict"] = "has not run since the artefact was last written — it is not firing"

    failing = next((r for r in runs if r["conclusion"] == "failure"), None)
    if failing:
        d["failing_run"] = failing["html_url"]
        d.update({k: v for k, v in _failed_step_and_log(failing["id"]).items() if v is not None})
    return d


def summarise(d):
    """One line a human can act on."""
    if not d or d.get("note"):
        return (d or {}).get("note", "")
    bits = []
    if d.get("verdict"):
        bits.append(d["verdict"])
    if d.get("step"):
        bits.append("failing step: %s" % d["step"])
    if d.get("signature"):
        bits.append(d["signature"])
    if d.get("runner_lost"):
        bits.append("THE RUNNER ITSELF WAS LOST (post-job steps skipped) — no `if: always()` "
                    "can rescue work from this; the data has to be committed before the "
                    "step that kills it")
    elif d.get("skipped_publish"):
        bits.append("its publish step was SKIPPED, so the work was discarded")
    if d.get("consecutive_non_success"):
        bits.append("%d consecutive non-success runs" % d["consecutive_non_success"])
    if d.get("last_success"):
        bits.append("last success %s" % d["last_success"][:16].replace("T", " "))
    return " · ".join(bits)
