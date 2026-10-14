# pipeline-status

One answer to **"is anything actually wrong?"**, on the dashboard you already look at.

## Why this exists

By 13 October 2026 this repo was doing roughly **1,700 Actions runs a day**, and the run
list had stopped being a signal in both directions at once:

- **Green stopped meaning "it worked."** About 90% of runs are no-ops that gate themselves
  out in under a minute. `Loyverse risk Telegram delivery` was 100 of its last 100 runs.
  `pages build` 93%. `fraud-health-daily` 91%.
- **Red stopped meaning "something broke."** `kpi-pull` failed every single run that did
  real work for ten days — 12 out of 12 — on a false alarm. A permanent red that meant
  nothing, sitting beside the reds that would have.

That morning the US dashboard served registration figures that were 95% bot accounts for
about five hours. Every run was green, the one red run was the false alarm, and nothing in
the Actions list said otherwise. **The failure was not a run.** It was a published file
that no longer matched the code that produces it.

So this checks artefacts, not runs.

## What it checks

For each published artefact, two questions:

1. **Age** — is it newer than its *own measured* cadence? Catches a job that stopped,
   whatever colour its last run was.
2. **Inputs** — was it generated *after* the code that generates it last changed? Catches
   an artefact that is perfectly fresh and completely wrong. On 13 Oct the bot filter
   merged at 09:34 and `daily-history.js` had last been written at 06:04 — 3.5h old against
   a 36h limit, so age alone says OK. Comparing it to `kpi-automation/sql/` says REBUILD at
   the moment of the merge.

Where an artefact publishes its own data timestamp — `pull_status.json`, the CUSUM `asOf`,
`risk-monitor/health.json` — that is preferred over the commit time, because a job can
commit at 06:04 data that was pulled at 04:06, and the second number is the one that
matters.

## Automated diagnosis, not automated repair

When a pipeline is flagged, `diagnose.py` does the lookup a person would do:

```
artefact -> owning workflow -> recent runs -> which step failed -> log tail ->
error signature -> did it publish anything?
```

On 2026-10-14 that produced, with no human involved:

> **payments-pull.yml** · running but not publishing — 28 run(s) since the artefact was last
> written, none succeeded · failing step: Pull -> rebuild -> recalc -> verify · OOM-killed on
> the runner (exit 137) · its publish step was SKIPPED, so the work was discarded · 28
> consecutive non-success runs
> *The runner ran out of memory. Needs a lower-memory build, a larger runner, or less data.*

That is the whole of a twenty-minute manual investigation, on the card.

**Why it diagnoses and does not repair.** The obvious next step after a status page is to
make it fix things. This repo already shows why that is wrong. That same morning the
payments pull retried itself every ten minutes for nine hours. Every attempt pulled 56,077
transactions correctly, was OOM-killed during the workbook rebuild, and threw the good data
away — twenty times, eight hours of runner time, no progress and no alert. **The automation
was not the cure, it was the failure mode.** Retrying harder makes a broken thing fail
faster and more quietly.

So this dispatches nothing and retries nothing. It only means the next person starts where
the last investigation finished.

**The check that matters most is `verdict`**, which separates three cases that look
identical from the artefact alone and need opposite responses:

| verdict | meaning |
|---|---|
| has not run since the artefact was last written | the workflow is not firing — check its trigger |
| running but not publishing | it runs and fails, or runs and discards its work |
| ran and succeeded, artefact did not move | it is writing nothing, or writing somewhere else |

Unrecognised failures say nothing rather than guess. `test_unknown_errors_do_not_guess`
pins that: a monitor that invents causes is worse than one that admits ignorance.

Known signatures live in `SIGNATURES` in `diagnose.py` — exit 137 (OOM), exit 143
(terminated), Snowflake statement timeouts, job timeouts, auth failures, rate limiting,
push races, and unhandled exceptions. Add to that list as new failure shapes appear.

## What red means

**Red means exactly one thing: the dashboard is serving stale or missing data and someone
has to go and fix something.** Nothing else is allowed to be red.

| state | shown as | meaning | do you act? |
|---|---|---|---|
| `error` / `stale` | **Not updating** | the artefact has stopped refreshing | **yes** — find out why the job stopped |
| `error` / `missing` | **Missing** | the artefact is not there | **yes** |
| `warn` / `rebuild` | Needs rebuild | code changed; the output predates it | no — the next run clears it |
| `warn` / `ageing` | Ageing | past 75% of its limit, not over | no — watch it |
| `warn` / `source` | Source warning | last pull reported a problem, data still fresh | no — it goes red by itself if it persists |
| `unknown` | Not checked | the check could not run | no |

This distinction is the whole reason the page is worth having. The first version made
"built before its inputs changed" **red**, so the very first thing it ever reported was a
red tick caused by merging a one-line fix — a pipeline that was running perfectly and had
simply not been rebuilt yet. Every code merge would have painted the page red until the
next pull, and within a week red would have meant nothing again. That is precisely how the
Actions list got into the state this page was built to escape.

`test_only_a_stale_or_missing_artefact_may_be_red` pins the contract.

## The rule that keeps it trustworthy

**Every threshold sits above the artefact's own measured p90 gap.** Not above how often
someone thinks it ought to run.

The first draft of this file gave the CASE dashboard a 120h limit when its measured p90 gap
is 168.69h, and promptly scored it **43% "uptime"** across sixty days of entirely normal
behaviour. That is the exact failure this page exists to replace, caught by the page itself
before it shipped. There is a test asserting the rule, so the next person cannot tighten a
threshold on a hunch:

```
test_every_threshold_sits_above_its_measured_p90
```

If a pipeline ought to run more often than it does, fix its schedule. Do not tighten the
number here.

## Where it shows up

- **A badge in the FACADASH header**, beside `DATA THROUGH` and `KPIS UPDATED`. Green when
  everything is fresh, amber when something is ageing, red when something has stopped. This
  is the point: a tab only helps if you remember to open it.
- **The Pipeline Health tab**, with one bar per day over the last 60 days per pipeline, so
  "is it normally like that?" is answerable at a glance.
- **One workflow in the Actions list** that is red *only* when a published artefact has
  really stopped updating.
- **Slack**, if `SLACK_WEBHOOK_URL` is ever set. Optional; nothing depends on it.

## Design notes

- **Read-only.** It writes nothing but its own page. It cannot break a pipeline.
- **Uses the GitHub API, not a checkout** — deliberately. This repo is 9.3 GB and growing
  about 578 MB a week; cloning it inside a monitoring job would be absurd.
- **Commits only when the answer changes.** `status.json` carries a `digest` of everything
  except the clock. Publishing hourly would add 24 commits and 24 Cloudflare deploys a day
  to a repo already taking 8,096 commits a week. A commit here means something changed.
- **Runs off the `cusum-pull` heartbeat**, not a plain cron, because GitHub drops the
  `schedule` event in this repo — recorded in July, on 08-06, and for eight hours on 08-27.
- **History accumulates forward**, like `cusum-state.json`. Days before an artefact existed
  show grey, honestly, rather than being guessed at.

## Running it by hand

```
GITHUB_TOKEN=... STATUS_OUT=/tmp/st STATUS_SOFT=1 python3 pipeline-status/check.py
python3 -m pytest pipeline-status/tests -q
```

`STATUS_SOFT=1` stops it exiting non-zero, which is what you want locally.

## Adding a pipeline

Add a row to `PIPELINES` in `check.py` with the artefact path, then **measure** its cadence
before choosing a threshold:

```
GET /repos/{repo}/commits?path={artefact}&per_page=40
```

Take the p90 gap between consecutive commits and set the threshold above it. Record the
measurement in `MEASURED_P90_H` in the tests, or `test_config_and_measurements_have_not_drifted_apart`
will fail — on purpose.
