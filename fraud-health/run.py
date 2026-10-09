#!/usr/bin/env python3
"""Fraud Health daily pipeline.

    python3 fraud-health/run.py ledger       refresh the enablement ledger
    python3 fraud-health/run.py backfill     rebuild the ledger from full git history
    python3 fraud-health/run.py cohort       print a day's cohort (no writes)
    python3 fraud-health/run.py daily        the scheduled job: ledger + cohort + publish
    python3 fraud-health/run.py remediate    one-off dataset repair (see remediate.py)
    python3 fraud-health/run.py validate     integrity gate

`daily` is idempotent. Re-running it for the same day rewrites that day's records and
leaves every other review untouched; an empty cohort writes nothing at all, so the
page's `generatedAt` never advances on a run that produced no data.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "fraud-health"))

from fraud_health import cohort as cohort_mod  # noqa: E402
from fraud_health import evidence as evidence_mod  # noqa: E402
from fraud_health import publish as publish_mod  # noqa: E402
from fraud_health import remediate as remediate_mod  # noqa: E402
from fraud_health import review as review_mod  # noqa: E402
from fraud_health import signals as signals_mod  # noqa: E402
from fraud_health import validate as validate_mod  # noqa: E402
from fraud_health.activation import load as load_activation  # noqa: E402
from fraud_health.ledger import Ledger, backfill, update_from_working_tree  # noqa: E402
from fraud_health.methodology import Methodology  # noqa: E402

PAYMENTS = os.path.join(REPO, "activated-payments")
INDEX_PATH = os.path.join(PAYMENTS, "risk-health", "index.json")
LEDGER_PATH = os.path.join(REPO, "fraud-health", "enablement-ledger.json")
EVIDENCE_DIR = os.path.join(REPO, "fraud-health", "evidence")
REPORT_DIR = os.path.join(REPO, "fraud-health", "reports")
ACTIVATION = os.path.join(PAYMENTS, "activation-data.js")


def _load_index() -> dict:
    with open(INDEX_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def _activation():
    snapshot = load_activation(ACTIVATION)
    kyc = {}
    with open(ACTIVATION, encoding="utf-8") as handle:
        text = handle.read()
    marker = "window.__ACT_KYC = "
    if marker in text:
        start = text.index(marker) + len(marker)
        end = text.index("\n", start)
        try:
            kyc = json.loads(text[start:end].rstrip().rstrip(";"))
        except json.JSONDecodeError:
            kyc = {}
    return snapshot, kyc


def _write_report(name: str, payload: dict) -> str:
    os.makedirs(REPORT_DIR, exist_ok=True)
    path = os.path.join(REPORT_DIR, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, ensure_ascii=False)
        handle.write("\n")
    return path


# --------------------------------------------------------------------- commands


def cmd_backfill(args) -> int:
    ledger = backfill(REPO, ref=args.ref, progress=True)
    ledger.save(LEDGER_PATH)
    print(f"ledger rebuilt: {len(ledger.accounts)} accounts from {len(ledger.sources)} observations")
    return 0


def cmd_ledger(args) -> int:
    ledger = Ledger.load(LEDGER_PATH)
    if not ledger.accounts:
        print("no ledger on disk — run `backfill` first")
        return 1
    before = len(ledger.accounts)
    update_from_working_tree(ledger, REPO)
    ledger.save(LEDGER_PATH)
    print(f"ledger updated: {before} -> {len(ledger.accounts)} accounts")
    return 0


def _resolve_day(args) -> date:
    if args.day:
        return date.fromisoformat(args.day)
    return cohort_mod.previous_complete_london_day()


def cmd_cohort(args) -> int:
    ledger = Ledger.load(LEDGER_PATH)
    day = _resolve_day(args)
    selection = cohort_mod.select(ledger, day)
    print(json.dumps(selection.to_json(), indent=1))
    return 0


def cmd_daily(args) -> int:
    day = _resolve_day(args)
    ledger = Ledger.load(LEDGER_PATH)
    if not ledger.accounts:
        print("FATAL: no enablement ledger — run `backfill` first", file=sys.stderr)
        return 2

    update_from_working_tree(ledger, REPO)
    ledger.save(LEDGER_PATH)

    snapshot, kyc = _activation()
    population = signals_mod.Population(snapshot.rows)
    index = _load_index()
    methodology = Methodology(index["methodology"])
    selection = cohort_mod.select(ledger, day)
    evidence_files = evidence_mod.load_all(EVIDENCE_DIR)

    # A malformed evidence file must stop the run, not be silently half-applied.
    problems = []
    for account_id, loaded in evidence_files.items():
        raw = json.load(open(os.path.join(EVIDENCE_DIR, f"{account_id}.json"), encoding="utf-8"))
        problems.extend(evidence_mod.validate(raw, methodology.keys, methodology.maxima))
    if problems:
        print("FATAL: evidence files failed validation:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 2

    reviewed_at = datetime.now().astimezone().isoformat(timespec="seconds")
    records = [
        review_mod.build(
            member,
            population,
            ledger.accounts.get(member.accountId),
            methodology,
            evidence_files.get(member.accountId),
            kyc,
            reviewed_at,
        )
        for member in selection.members
    ]

    for record in records:
        issues = validate_mod.validate_record(record, methodology)
        if issues:
            print("FATAL: generated record failed validation:", file=sys.stderr)
            for issue in issues:
                print(f"  - {issue}", file=sys.stderr)
            return 2

    change = publish_mod.upsert(index, records, day.isoformat(), PAYMENTS, methodology)
    status_changes = publish_mod.refresh_live_status(index, snapshot.rows)
    publish_mod.recompute_coverage(index, snapshot.rows, ledger.accounts)

    reviewed_ids = {m["id"] for m in index["merchants"]}
    pending = cohort_mod.backlog(ledger, reviewed_ids)
    index["latestDailyReview"] = {
        "cohortDate": day.isoformat(),
        "cohortType": "newly-enabled",
        "timezone": "Europe/London",
        "reviewedAt": reviewed_at,
        "count": len(records),
        "confirmed": selection.to_json()["confirmed"],
        "boundaryAmbiguous": selection.to_json()["boundaryAmbiguous"],
        "evidenceBased": sum(1 for r in records if r.get("sources")),
        "averageRiskScore": (
            round(sum(r["score"] for r in records) / len(records), 1) if records else None
        ),
        "exclusions": selection.exclusions,
        "unreviewedEnablementBacklog": len(pending),
    }

    if change["wrote"] or status_changes:
        publish_mod.write_index(INDEX_PATH, index)
        _sync_loader(index["generatedAt"])

    report = {
        "cohort": selection.to_json(include_excluded=False),
        "published": change,
        "liveStatusChanges": status_changes,
        "coverage": index["coverage"],
        "backlog": pending,
    }
    path = _write_report(f"daily-{day.isoformat()}.json", report)

    print(f"cohort {day}: {len(records)} merchant(s)")
    print(f"  added={len(change['added'])} updated={len(change['updated'])} skipped={len(change['skipped'])}")
    print(f"  live status changes applied: {len(status_changes)}")
    print(f"  enabled coverage: {index['coverage']['enabledCoveragePct']}%")
    print(f"  unreviewed enablement backlog: {len(pending)}")
    print(f"  report: {os.path.relpath(path, REPO)}")
    return 0


def _sync_loader(generated_at: str) -> None:
    """Keep risk-health-data.js in step with the index it points at."""
    path = os.path.join(PAYMENTS, "risk-health-data.js")
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    import re

    updated = re.sub(
        r'generatedAt:\s*"[^"]*"', f'generatedAt: "{generated_at}"', text, count=1
    )
    if updated != text:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(updated)


def cmd_remediate(args) -> int:
    index = _load_index()
    methodology = Methodology(index["methodology"])
    shards = remediate_mod.load_shards(PAYMENTS)
    snapshot, _ = _activation()
    ledger = Ledger.load(LEDGER_PATH)

    log = remediate_mod.run(index, shards, methodology, snapshot.rows)
    publish_mod.recompute_coverage(index, snapshot.rows, ledger.accounts)
    index["generatedAt"] = log["remediatedAt"]

    if args.dry_run:
        print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in log.items()}, indent=1))
        return 0

    for path, shard in shards.items():
        full = os.path.join(PAYMENTS, path)
        with open(full, "w", encoding="utf-8") as handle:
            json.dump(shard, handle, indent=1, ensure_ascii=False)
            handle.write("\n")
    publish_mod.write_index(INDEX_PATH, index)
    _sync_loader(index["generatedAt"])
    report = _write_report("remediation-2026-10-09.json", log)

    print("remediation applied:")
    print(f"  scores reconciled : {len(log['scoreReconciliation'])}")
    print(f"  overrides preserved: {len(log['overridesPreserved'])}")
    print(f"  duplicates merged : {len(log['duplicatesMerged'])}")
    print(f"  stale enabled fixed: {len(log['staleEnabledFixed'])}")
    print(f"  unresolved        : {len(log['unresolved'])}")
    print(f"  report: {os.path.relpath(report, REPO)}")
    return 0


def cmd_validate(args) -> int:
    return validate_mod.main([PAYMENTS])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("backfill"); p.add_argument("--ref", default="HEAD"); p.set_defaults(fn=cmd_backfill)
    p = sub.add_parser("ledger"); p.set_defaults(fn=cmd_ledger)
    p = sub.add_parser("cohort"); p.add_argument("--day"); p.set_defaults(fn=cmd_cohort)
    p = sub.add_parser("daily"); p.add_argument("--day"); p.set_defaults(fn=cmd_daily)
    p = sub.add_parser("remediate"); p.add_argument("--dry-run", action="store_true"); p.set_defaults(fn=cmd_remediate)
    p = sub.add_parser("validate"); p.set_defaults(fn=cmd_validate)

    args = parser.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
