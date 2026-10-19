#!/usr/bin/env python3
"""
pipeline-status — one answer to "is anything actually wrong?"

WHY THIS EXISTS. The Actions list stopped being a signal in both directions at once.
About 90% of runs are no-ops that gate themselves out in under a minute, so GREEN stopped
meaning "it worked" — `Loyverse risk Telegram delivery` was 100 of its last 100 runs. And
`kpi-pull` failed every single run that did real work for ten days on an alarm that was
wrong, so RED stopped meaning "something broke".

On 2026-10-13 the US dashboard served numbers that were 95% bot registrations for several
hours. Every run was green, the one red run was a false alarm, and nothing in the Actions
list said so. The failure was not a run — it was a published FILE that no longer matched
the code that produces it.

So this asks two questions per artefact, and the second one is the one that mattered that
morning:

  1. AGE — is it newer than its own measured cadence says it should be? Catches a job that
     stopped running, whatever colour its last run was.
  2. INPUTS — was it generated AFTER the code that generates it was last changed? Catches
     an artefact that is perfectly fresh and perfectly wrong. On 13 Oct the bot filter was
     merged at 09:34 and `daily-history.js` had last been written at 06:04: only 3.5h old
     against a 36h limit, so an age check alone says OK — and the dashboard served the US
     bot wave for another five hours. Comparing it against its inputs says REBUILD at the
     moment of the merge.

Both are true or false regardless of how many runs happened, which were no-ops, or whether
the job went green, red, or never started.

DESIGN NOTES
  * Read-only. It writes nothing except its own status page. It cannot break a pipeline.
  * Uses the GitHub API rather than a checkout, deliberately: this repo is 9.3 GB and
    growing ~578 MB a week, so cloning it in a monitoring job would be absurd.
  * Thresholds are measured, not guessed — see MEASURED comments on each entry.
  * Where an artefact embeds its own data timestamp (pull_status.json, cusum asOf), that
    is preferred over the commit time, because a job can commit at 06:04 data that was
    pulled at 04:06 and the second number is the one that matters.
"""
import datetime as dt, hashlib, json, os, re, sys, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

try:
    import diagnose as _diagnose           # same directory, read-only, optional
except Exception:                          # never let diagnosis break the status page
    _diagnose = None

REPO = os.environ.get("STATUS_REPO", "felipekrugel-eng/tars-overview")
HISTORY_DAYS = int(os.environ.get("STATUS_HISTORY_DAYS", "60"))
# Bump when the MEANING of a history cell changes, so the stored bars are rebuilt rather
# than left as a mix of two definitions. 2 = worst state seen during the day (was: state
# at the end of the day, which silently erased any outage that had been fixed by midnight).
HISTORY_METHOD = 2
# Cap API calls per run so the first run does not make 600 of them; the chart fills in
# over the following few runs and is complete within a day.
BACKFILL_BUDGET = int(os.environ.get("STATUS_BACKFILL_BUDGET", "200"))
# Below this many known days an uptime percentage is noise, not information: one bad day
# out of one reads "0.0% uptime", which is alarming and means nothing. Say how much history
# exists instead, and start quoting a figure once there is enough to carry meaning.
MIN_DAYS_FOR_UPTIME = 7
# Where the Pipeline Health tab is served. Only used to link from the Slack message.
STATUS_PAGE_URL = os.environ.get("STATUS_PAGE_URL", "https://facadash.pages.dev/status.html")
TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
NOW = dt.datetime.now(dt.timezone.utc)

# max_age is how stale the artefact may get before it is a problem.
# MEASURED on 2026-10-13 from the last 40 commits touching each path.
# inputs are the source paths that GENERATE the artefact. If any of them changed after the
# artefact was last written, the artefact is out of date with the code even if it is young.
PIPELINES = [
    # name,                 branch,     path,                                                   max_age_h, marker
    ("CUSUM registrations",  "gh-pages", "docs/cusum-data.js",                                     2,  "cusum",
     ["kpi-automation/build_cusum_data.py", "kpi-automation/sql/cusum_hourly_registrations.sql",
      "kpi-automation/sql/cusum_today_reconstruct.sql"]),
    #   MEASURED median gap 0.17h, p90 0.20h — refreshes about every 10 minutes.
    ("Risk monitor",         "master",   "risk-monitor/health.json",                               4,  "risk_health", []),
    #   MEASURED median gap 0.00h, p90 0.21h — hourly cron plus a heartbeat off payments-pull.
    ("Payments pull",        "master",   "payments-automation/data/pull_status.json",              9,  "pull_status", []),
    #   MEASURED median gap 2.73h, p90 3.05h — every ~3h.
    ("Activated payments",   "master",   "activated-payments/registration-daily.json",             9,  "generated_at",
     ["activated-payments/sql", "activated-payments/pull.js"]),
    #   MEASURED median gap 1.27h, p90 3.54h.
    ("Ads + attribution",    "master",   "activated-payments/attach-data.js",                      9,  None, []),
    #   MEASURED median gap 1.45h, p90 3.54h.
    ("Merchant base",        "master",   "merchant-base-automation/data/pull_status.json",        36,  "pull_status",
     ["merchant-base-automation/queries", "merchant-base-automation/run.py",
      "merchant-base-automation/merchant_base_model.py"]),
    #   MEASURED median gap 23.79h, p90 25.08h — daily.
    ("KPI daily history",    "master",   "KPI Dashboard v2 (Caio)/daily-history.js",              36,  None,
     ["kpi-automation/sql", "kpi-automation/run.py", "kpi-automation/build_kpi_data.py"]),
    #   MEASURED median gap 23.99h, p90 24.29h — daily. THIS is the one that was stale on 13 Oct.
    ("KPI subscriptions",    "master",   "KPI Dashboard v2 (Caio)/subs-data.js",                  36,  None,
     ["kpi-automation/sql", "kpi-automation/build_subs_data.py"]),
    #   MEASURED median gap 23.79h, p90 24.28h.
    ("Fraud health",         "master",   "activated-payments/risk-health-data.js",                36,  None,
     ["fraud-health/run.py"]),
    #   MEASURED median gap 15.12h, p90 24.00h.
    ("CASE dashboard",       "master",   "case-data.js",                                         264,  None,
     ["snowflake-pull.js", "queries"]),
    #   MEASURED median gap 24.58h, p90 168.69h — genuinely irregular; it refreshes in bursts
    #   with multi-day quiet spells. The first draft of this file used 120h, BELOW the p90,
    #   and promptly scored it 43% "uptime" on 60 days of entirely normal behaviour. That is
    #   the whole failure mode this page exists to avoid, so every threshold here is set
    #   ABOVE the artefact's own measured p90 gap, never on a view of how often it "should"
    #   refresh. If CASE ought to run daily, fix the schedule — do not tighten this number.
]


def api(path, raw=False):
    url = "https://api.github.com/repos/" + REPO + "/" + path
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github.raw" if raw else "application/vnd.github+json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    return body if raw else json.loads(body)


def last_commit(ref, path):
    q = "commits?sha=" + urllib.parse.quote(ref) + "&path=" + urllib.parse.quote(path) + "&per_page=1"
    cs = api(q)
    if not cs:
        return None
    return dt.datetime.fromisoformat(cs[0]["commit"]["committer"]["date"].replace("Z", "+00:00"))


def read_marker(ref, path, kind):
    """The artefact's own idea of how fresh its DATA is, which can lag its commit."""
    try:
        body = api("contents/" + urllib.parse.quote(path) + "?ref=" + urllib.parse.quote(ref), raw=True)
    except Exception as e:
        return None, ["could not read artefact: %s" % e]
    notes = []
    try:
        if kind == "pull_status":
            d = json.loads(body)
            if d.get("pull_succeeded") is False:
                notes.append("pull_succeeded = false")
            return dt.datetime.fromisoformat(d["completed_at_utc"].replace("Z", "+00:00")), notes
        if kind == "generated_at":
            d = json.loads(body)
            return dt.datetime.fromisoformat(d["generated_at"].replace("Z", "+00:00")), notes
        if kind == "cusum":
            m = re.search(r'"asOf"\s*:\s*"([^"]+)"', body)
            if m:
                return dt.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc), notes
        if kind == "risk_health":
            d = json.loads(body)
            if d.get("status") == "degraded":
                notes.append("status = degraded")
            for g in (d.get("gap_codes") or [])[:4]:
                notes.append("gap: " + str(g))
            ts = d.get("last_completed_at") or d.get("checkpoint_at")
            if ts:
                return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc), notes
    except Exception as e:
        notes.append("marker unreadable: %s" % e)
    return None, notes


def newest_input(ref, paths):
    """When the code that generates this artefact was last changed."""
    newest, which = None, None
    for p in paths:
        try:
            t = last_commit(ref, p)
        except Exception:
            continue
        if t and (newest is None or t > newest):
            newest, which = t, p
    return newest, which


def last_commit_before(ref, path, when):
    """Last commit touching `path` at or before `when` — one cheap call per day."""
    q = ("commits?sha=" + urllib.parse.quote(ref) + "&path=" + urllib.parse.quote(path)
         + "&until=" + when.strftime("%Y-%m-%dT%H:%M:%SZ") + "&per_page=1")
    cs = api(q)
    if not cs:
        return None
    return dt.datetime.fromisoformat(cs[0]["commit"]["committer"]["date"].replace("Z", "+00:00"))


# Some artefacts update every few minutes (cusum commits ~144 times a day), so a single
# page of 100 does not cover a day. Missing the older half of a busy day invents a huge
# gap and reports a perfectly healthy pipeline as down — which is exactly what the first
# version of this did: cusum came out at 1.7% uptime.
COMMIT_PAGES_MAX = 6          # 600 commits/day is far above anything here


def commits_between(ref, path, start, end):
    """Every commit touching `path` inside the window, oldest first.

    Returns (commits, complete). `complete` is False when the page cap was hit before the
    window was covered, so the caller can decline to judge rather than guess.
    """
    out, complete = [], False
    for page in range(1, COMMIT_PAGES_MAX + 1):
        q = ("commits?sha=" + urllib.parse.quote(ref) + "&path=" + urllib.parse.quote(path)
             + "&since=" + start.strftime("%Y-%m-%dT%H:%M:%SZ")
             + "&until=" + end.strftime("%Y-%m-%dT%H:%M:%SZ")
             + "&per_page=100&page=%d" % page)
        batch = api(q)
        out.extend(dt.datetime.fromisoformat(c["commit"]["committer"]["date"].replace("Z", "+00:00"))
                   for c in batch)
        if len(batch) < 100:          # ran out of commits: the window is fully covered
            complete = True
            break
    return sorted(out), complete


def day_state(ref, path, max_age, day):
    """The WORST state the artefact was in at any point that day.

    This used to ask only "was it fresh at the END of the day", which quietly erased
    incidents: the payments pull was stale for fourteen hours on 2026-10-14, was fixed at
    10:50, and the bar read green because the single instant it sampled happened to be
    after the recovery. A chart that forgets outages is worse than no chart, because it
    looks authoritative while hiding exactly what you built it to see.

    The age at any instant is `now - last update before now`, so the age peaks immediately
    BEFORE each update, and again at the end of the window. Checking those points gives the
    true worst age for the day without walking the clock.
    """
    start = dt.datetime.combine(day, dt.time.min, tzinfo=dt.timezone.utc)
    end = min(dt.datetime.combine(day, dt.time(23, 59, 59), tzinfo=dt.timezone.utc), NOW)
    if end <= start:
        return "nodata"
    try:
        prior = last_commit_before(ref, path, start)
        during, complete = commits_between(ref, path, start, end)
    except Exception:
        return "nodata"
    if prior is None and not during:
        return "nodata"                      # the artefact did not exist yet
    if not complete:
        # Too many updates that day to enumerate. An artefact committing >600 times in a
        # day is self-evidently not stale, but say "unknown" rather than assert health.
        return "ok" if len(during) > 24 else "nodata"

    worst, cursor = 0.0, prior
    for c in during:                         # age just before each update
        if cursor is not None:
            worst = max(worst, (c - cursor).total_seconds() / 3600.0)
        cursor = c
    if cursor is not None:                   # age at the end of the window
        worst = max(worst, (end - cursor).total_seconds() / 3600.0)

    return "down" if worst > max_age else "warn" if worst > max_age * 0.75 else "ok"


def build_history(rows, previous, days=HISTORY_DAYS, budget=BACKFILL_BUDGET):
    """One state per pipeline per day, accumulated across runs like cusum-state does.

    Only days never computed before are fetched, at most `budget` per run, so the chart
    fills in over the first few runs instead of making 600 API calls at once. Those
    fetches are independent single-row reads, so they are issued in parallel: path-filtered
    commit queries cost ~0.6s each against this repo, and sequentially a full backfill took
    over five minutes, which is far too slow for a monitoring job.
    """
    today = NOW.date()
    window = [today - dt.timedelta(days=i) for i in range(days - 1, -1, -1)]
    hist = {name: dict(h) for name, h in (previous or {}).items()}
    live = {"ok": "ok", "warn": "warn", "error": "down", "unknown": "nodata"}

    # A DAY NEVER RECOVERS ITS COLOUR.
    #
    # Today's cell used to be overwritten with the live state on every check, so the moment
    # a pipeline came back the outage vanished from the chart. On 2026-10-14 the payments
    # pull was down for fourteen hours, was fixed, and the bar went green as though nothing
    # had happened — which makes the history worse than useless, because it looks
    # authoritative while quietly hiding every crash.
    #
    # An uptime chart records the WORST state seen in a day. A day that went down stays
    # down, a day that wobbled stays amber, and the uptime percentage underneath means
    # something. The live state is on the card above; the bars are the record.
    severity = {"nodata": 0, "ok": 1, "warn": 2, "down": 3}

    today_key = today.isoformat()
    todo = []
    for r in rows:
        h = hist.setdefault(r["name"], {})
        for d in window:
            key = d.isoformat()
            if d == today:
                # Today is the worse of: what we can see RIGHT NOW, and what actually
                # happened earlier today. The live state alone is not enough — a pipeline
                # that was down for fourteen hours and got fixed at 10:50 reads "ok" now,
                # and on a freshly rebuilt file there is no earlier cell to ratchet against.
                todo.append((r, d, key))
                seen = h.get(key)
                now_state = live[r["state"]]
                if seen is None or severity[now_state] > severity[seen]:
                    h[key] = now_state
            elif key not in h and len(todo) < budget:
                todo.append((r, d, key))

    if todo:
        def one(task):
            r, d, key = task
            return r["name"], key, day_state(r["ref"], r["path"], r["max_age_h"], d)
        with ThreadPoolExecutor(max_workers=12) as pool:
            for name, key, state in pool.map(one, todo):
                seen = hist[name].get(key)
                # Never let a later look downgrade a day that already went bad.
                if seen is None or severity[state] > severity[seen]:
                    hist[name][key] = state

    first = window[0].isoformat()
    for name in list(hist):
        hist[name] = {k: v for k, v in hist[name].items() if k >= first}
    return hist, [d.isoformat() for d in window]


def check():
    """Evaluate every pipeline. The per-pipeline work is independent, so it runs in
    parallel — from outside GitHub's network each call costs most of a second."""
    def one(entry):
        name, ref, path, max_age, kind, inputs = entry
        row = {"name": name, "path": path, "ref": ref, "max_age_h": max_age,
               "notes": [], "state": "ok", "reason": None}
        try:
            commit_at = last_commit(ref, path)
        except Exception as e:
            # Could not check is not the same as broken: amber, never red. If the checker
            # itself has stopped, the badge says so from status.json's own age.
            row.update(state="unknown", reason="unreachable",
                       notes=["could not reach GitHub: %s" % e])
            return row
        if commit_at is None:
            row.update(state="error", reason="missing", notes=["artefact does not exist"])
            return row
        data_at, notes = (None, [])
        if kind:
            data_at, notes = read_marker(ref, path, kind)
        row["notes"] += notes
        effective = data_at or commit_at
        row["committed_at"] = commit_at.isoformat()
        row["data_at"] = data_at.isoformat() if data_at else None
        age = (NOW - effective).total_seconds() / 3600.0
        row["age_h"] = round(age, 2)

        # ---- severity -----------------------------------------------------------------
        # RED MEANS ONE THING: the dashboard is serving stale or missing data and someone
        # has to go and fix something. Nothing else is allowed to be red.
        #
        # This is not fussiness. The first version made "built before its inputs changed"
        # red, so the very first thing the page ever reported was a red tick caused by
        # merging a one-line fix — a pipeline that was running perfectly and simply had not
        # been rebuilt yet. Every code merge would have painted the page red until the next
        # pull. That is precisely how this repo taught everyone to ignore red in the first
        # place, and it would have undone the whole point of the page within a week.
        #
        # So: stale or missing -> error. Everything else is amber and informational.
        stale = age > max_age

        # Built before the code that generates it last changed. Real, worth showing, and
        # NOT a break: the pipeline is healthy, the output just predates a code change and
        # the next scheduled run clears it by itself.
        rebuild = False
        if inputs:
            src_at, src_path = newest_input("master", inputs)
            if src_at:
                row["inputs_changed_at"] = src_at.isoformat()
                if src_at > commit_at:
                    rebuild = True
                    behind = (src_at - commit_at).total_seconds() / 3600.0
                    row["notes"].append("built before its inputs changed: %s is %.1fh newer"
                                        % (src_path, behind))

        source_warning = any(n.startswith(("pull_succeeded", "status = degraded", "gap:"))
                             for n in row["notes"])

        if stale:
            row["state"], row["reason"] = "error", "stale"
            row["notes"].insert(0, "stale: %.1fh old, limit %dh" % (age, max_age))
        elif rebuild:
            # Deliberately ranked above `ageing`: "rebuild me" is the more useful sentence.
            row["state"], row["reason"] = "warn", "rebuild"
        elif age > max_age * 0.75:
            row["state"], row["reason"] = "warn", "ageing"
            row["notes"].insert(0, "ageing: %.1fh old, limit %dh" % (age, max_age))
        elif source_warning:
            # The last pull reported a problem but the published data is still inside its
            # window, so the dashboard is not broken. If the failures continue the age check
            # turns this red on its own, which is the right moment to act.
            row["state"], row["reason"] = "warn", "source"
        return row

    with ThreadPoolExecutor(max_workers=10) as pool:
        return list(pool.map(one, PIPELINES))


def render_html(rows, worst, hist, window):
    BAR = {"ok": "#3bab43", "warn": "#e0a33e", "down": "#d64b3e", "nodata": "#e3e6ea"}
    # Red is reserved for "the dashboard is serving stale or missing data, go fix it".
    LABEL = {("error", "stale"):     ("Not updating",   "#cf222e"),
             ("error", "missing"):   ("Missing",        "#cf222e"),
             ("warn",  "rebuild"):   ("Needs rebuild",  "#9a6700"),
             ("warn",  "ageing"):    ("Ageing",         "#9a6700"),
             ("warn",  "source"):    ("Source warning", "#9a6700"),
             ("unknown", "unreachable"): ("Not checked", "#6e7781")}
    HEAD = {"ok":    ("All pipelines operational", "#3bab43"),
            "warn":  ("Everything is publishing \u2014 see the notes below", "#e0a33e"),
            "error": ("A pipeline has stopped updating \u2014 the dashboard is stale", "#d64b3e"),
            "unknown": ("Some pipelines could not be checked", "#6e7781")}

    # The card above shows the state RIGHT NOW. The bars record the WORST state
    # each day reached. Those answer different questions, and when they disagree
    # the page looked like it was contradicting itself: "All pipelines
    # operational" sitting above a yellow bar, with nothing saying why.
    #
    # So today's bar carries both. The fill is the live state and a stripe along
    # the top is the worst moment earlier today, which reads as "fine now, but it
    # wobbled at 06:00" — the true sentence, and the one that was missing.
    #
    # The stored history is NOT changed by this: build_history still ratchets a
    # day to its worst state and a day that went down still stays down. This is
    # presentation only, so the uptime figure underneath still means what it said.
    LIVE = {"ok": "ok", "warn": "warn", "error": "down", "unknown": "nodata"}
    WORD = {"ok": "operational", "warn": "degraded",
            "down": "not updating", "nodata": "no data"}
    today = window[-1] if window else None

    cards = []
    for r in rows:
        h = hist.get(r["name"], {})
        bars, known, good = [], 0, 0
        for d in window:
            st = h.get(d, "nodata")
            if st != "nodata":
                known += 1
                good += (st == "ok")
            if d == today:
                now_st = LIVE[r["state"]]
                tip = "today — %s now" % WORD[now_st]
                style = "background:%s" % BAR[now_st]
                if st != "nodata" and st != now_st:
                    tip += ", %s earlier today" % WORD[st]
                    style += ";box-shadow:inset 0 5px 0 0 %s" % BAR[st]
                bars.append('<i style="%s" title="%s"></i>' % (style, tip))
                continue
            bars.append('<i style="background:%s" title="%s — %s"></i>'
                        % (BAR[st], d, WORD[st]))
        if known >= MIN_DAYS_FOR_UPTIME:
            uptime = "%.2f %% uptime" % (100.0 * good / known)
        elif known:
            uptime = "%d day%s recorded" % (known, "" if known == 1 else "s")
        else:
            uptime = "no history yet"
        text, colour = LABEL.get((r["state"], r.get("reason")),
                                 ("Operational", "#1a7f37"))
        notes = ('<div class=n>%s</div>' % "<br>".join(r["notes"])) if r["notes"] else ""
        dx = ""
        if r.get("diagnosis_line"):
            d = r.get("diagnosis") or {}
            link = (' <a href="%s">see the run</a>' % d["failing_run"]) if d.get("failing_run") else ""
            hint = ('<div class=hint>%s</div>' % d["meaning"]) if d.get("meaning") else ""
            dx = ('<div class=dx><b>%s</b> &middot; %s%s%s</div>'
                  % (d.get("workflow", "?"), r["diagnosis_line"], link, hint))
        age = ("%.1fh old" % r["age_h"]) if "age_h" in r else ""
        cards.append(
            '<section class=c>'
            '<div class=t><div><h2>%s</h2><div class=p>%s · %s · limit %dh</div></div>'
            '<div class=s style="color:%s">%s</div></div>'
            '%s%s<div class=bars>%s</div>'
            '<div class=f><span>%d days ago</span><span class=u>%s</span><span>Today (live)</span></div>'
            '</section>'
            % (r["name"], r["path"], age, r["max_age_h"], colour, text, notes, dx,
               "".join(bars), len(window), uptime))

    htxt, hcol = HEAD[worst]
    return """<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=300>
<title>Pipeline Health &middot; FACADASH</title>
<style>
 *{box-sizing:border-box}
 /* Chrome copied from the FACADASH pages so this does not look like a bolted-on tool. */
 .pagenav{background:#fff;border-bottom:1px solid #E0E0E0;padding:0 24px;display:flex;
          gap:4px;align-items:center;margin:-28px -16px 24px}
 .pagenav a{color:#6A6A6A;font-size:11px;font-weight:bold;letter-spacing:1px;
            text-transform:uppercase;padding:11px 16px;border-bottom:3px solid transparent;
            text-decoration:none}
 .pagenav a:hover{color:#1A1A1A}
 .pagenav a.on{color:#1578C4;border-bottom-color:#1D8FE1}
 body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;
      margin:0;padding:28px 16px 48px;background:#f7f8fa;color:#1f2328}
 .w{max-width:880px;margin:0 auto}
 h1{font-size:20px;margin:0 0 4px;font-weight:650}
 .lede{color:#656d76;font-size:13px;margin:0 0 20px}
 .hd{padding:14px 18px;border-radius:9px;color:#fff;font-weight:600;font-size:15px;margin-bottom:20px}
 .c{background:#fff;border:1px solid #e1e4e8;border-radius:9px;padding:16px 18px 14px;margin-bottom:14px}
 .t{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
 h2{font-size:15px;margin:0;font-weight:620}
 .s{font-size:13px;font-weight:580;white-space:nowrap}
 .p{color:#8b949e;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:3px}
 .n{color:#cf222e;font-size:12.5px;margin-top:9px;line-height:1.45}
 .dx{margin-top:9px;padding:9px 11px;background:#f6f8fa;border-left:3px solid #afb8c1;
     border-radius:0 5px 5px 0;font-size:12.5px;color:#424a53;line-height:1.5}
 .dx b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:#1f2328}
 .dx a{color:#0969da}
 .hint{margin-top:5px;color:#656d76;font-style:italic}
 .bars{display:flex;gap:2px;margin:13px 0 7px;height:34px}
 .bars i{flex:1 1 0;border-radius:1.5px;min-width:2px}
 .f{display:flex;justify-content:space-between;color:#8b949e;font-size:11.5px}
 .u{color:#656d76}
 @media (max-width:560px){.bars{height:28px}.p{display:none}}
</style>
<div class="pagenav">
  <a href="daily.html">FACADASH</a>
  <a href="index.html">Study &amp; Trend</a>
  <a href="retention.html">Churn</a>
  <a href="report.html">Report</a>
  <a href="status.html" class="on">Pipeline Health</a>
</div>
<div class=w>
<h1>Pipeline health</h1>
<p class=lede>Is each published artefact fresher than its own measured cadence, and was it
built after the code that generates it last changed? Independent of how many Actions ran.</p>
<div class=hd style="background:%s">%s</div>
%s
<p class=lede style="margin-top:18px">Checked %s UTC · one bar per day, newest on the right, showing the worst state that day · today's bar is the live state, with any earlier dip as a stripe ·
thresholds measured from each artefact's own commit history</p>
</div>""" % (hcol, htxt, "".join(cards), NOW.strftime("%Y-%m-%d %H:%M"))


def main():
    rows = check()

    # ---- diagnosis -------------------------------------------------------------------
    # Only for pipelines that are flagged, so a healthy run costs nothing extra. Strictly
    # read-only: this dispatches nothing and retries nothing. Automating the REPAIR is what
    # produced the 2026-10-14 mess, where the payments pull retried itself twenty times in
    # nine hours, succeeded at the pull every time, and threw the data away every time.
    # Automating the DIAGNOSIS is the part that was actually slow, and entirely mechanical.
    if _diagnose is not None:
        flagged = [r for r in rows if r["state"] != "ok"]
        if flagged:
            def _dx(r):
                at = None
                if r.get("committed_at"):
                    at = dt.datetime.fromisoformat(r["committed_at"])
                try:
                    d = _diagnose.diagnose(r, at)
                    return r["name"], d, _diagnose.summarise(d)
                except Exception as e:
                    return r["name"], {"note": "diagnosis failed: %s" % e}, ""
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(_dx, flagged))
            by = {n: (d, line) for n, d, line in results}
            for r in rows:
                if r["name"] in by:
                    d, line = by[r["name"]]
                    r["diagnosis"] = d
                    if line:
                        r["diagnosis_line"] = line

    # unknown ranks BELOW warn: "could not check" is not a breakage.
    order = {"error": 3, "warn": 2, "unknown": 1, "ok": 0}
    worst = max(rows, key=lambda r: order[r["state"]])["state"] if rows else "unknown"

    outdir = os.environ.get("STATUS_OUT", "KPI Dashboard v2 (Caio)")
    os.makedirs(outdir, exist_ok=True)
    prev = {}
    try:
        with open(os.path.join(outdir, "status.json")) as fh:
            stored = json.load(fh) or {}
        if stored.get("history_method") == HISTORY_METHOD:
            prev = stored.get("history", {})
        else:
            print("history method changed (%r -> %d) — rebuilding the bars"
                  % (stored.get("history_method"), HISTORY_METHOD))
    except Exception:
        pass
    hist, window = build_history(rows, prev)

    # A digest of everything EXCEPT the clock, so the workflow can commit only when the
    # answer actually changed. Committing every hour would add 24 commits and 24 Cloudflare
    # deploys a day to a repo already taking 8,096 commits a week — the exact problem this
    # page exists to help with. A commit here therefore means something really changed.
    meaningful = {"worst": worst, "history": hist,
                  "pipelines": [{k: v for k, v in r.items()
                                 if k not in ("age_h", "committed_at", "data_at",
                                              "inputs_changed_at")} for r in rows]}
    digest = hashlib.sha256(json.dumps(meaningful, sort_keys=True).encode()).hexdigest()

    out = {"schema_version": 2, "checked_at": NOW.isoformat(), "worst": worst,
           "digest": digest, "history_method": HISTORY_METHOD,
           "pipelines": rows, "history": hist}
    with open(os.path.join(outdir, "status.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    with open(os.path.join(outdir, "status.html"), "w") as fh:
        fh.write(render_html(rows, worst, hist, window))

    for r in rows:
        print("%-22s %-7s %8s  %s" % (r["name"], r["state"].upper(),
                                      ("%.1fh" % r["age_h"]) if "age_h" in r else "-",
                                      "; ".join(r["notes"])))
    # Only genuine breaks. A pending rebuild, an ageing artefact or a check we could not
    # run are all amber: visible on the page, but they never raise an alarm, because an
    # alarm you cannot act on is how the Actions list became unreadable.
    bad = [r for r in rows if r["state"] == "error"]
    print("\nworst: %s" % worst.upper())

    hook = os.environ.get("SLACK_WEBHOOK_URL")
    if hook and bad:
        # The Slack message carries the DIAGNOSIS, not just the symptom. This is what gets
        # read on a phone, away from the dashboard, so "payments pull is stale" is far less
        # use than "it is running fine and discarding its own output, here is the run".
        # (#26 added the diagnosis to the page; the matching change here never landed, so
        # the most useful sentence only reached the place you were already looking.)
        #
        # The prefix matters too: this channel also carries the registration bot screen, and
        # a fraud alert and an ops alert must be distinguishable at a glance, or the channel
        # becomes the Actions tab all over again.
        lines = []
        for r in bad:
            lines.append("• *%s* — %s" % (r["name"], "; ".join(r["notes"]) or r["state"]))
            if r.get("diagnosis_line"):
                lines.append("    _%s_" % r["diagnosis_line"])
            d = r.get("diagnosis") or {}
            if d.get("failing_run"):
                lines.append("    <%s|see the failing run>" % d["failing_run"])
        text = (":triangular_flag_on_post: *Pipeline health — %s*\n" % worst.upper()
                + "\n".join(lines)
                + "\n\n<%s|Open the Pipeline Health tab>" % STATUS_PAGE_URL)
        try:
            req = urllib.request.Request(hook, data=json.dumps({"text": text}).encode(),
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=20).read()
            print("posted to Slack")
        except Exception as e:
            print("Slack post failed: %s" % e)

    # The whole point: this workflow is red ONLY when a published artefact has actually
    # stopped updating, i.e. the dashboard is serving stale or missing data and someone has
    # to act. One run, one meaning. Pending rebuilds and ageing artefacts stay amber.
    if bad and os.environ.get("STATUS_SOFT") != "1":
        sys.exit(1)


if __name__ == "__main__":
    main()
