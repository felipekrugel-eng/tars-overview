"""Integrity gate for the published Fraud Health dataset.

Run by CI on every change under `activated-payments/risk-health/`, and by the daily job
before it commits. A non-zero exit means the dataset must not ship.

It checks the things that actually went wrong before: scores that disagree with their own
dimensions, merchants keyed by something other than a Stripe account id, detail files that
do not resolve, records published as verified with no source, and — because this is a
static site served to a browser — personal data that must never reach the repository.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

from .methodology import Methodology, validate_record

# Patterns that must never appear in published review data. The site sits behind
# Cloudflare Access, but access control is not a licence to store identity documents in
# a git repository that many people can read.
FORBIDDEN = [
    (re.compile(r"\bsk_live_[0-9A-Za-z]{10,}"), "Stripe live secret key"),
    (re.compile(r"\brk_live_[0-9A-Za-z]{10,}"), "Stripe live restricted key"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "US social security number"),
    (re.compile(r"\b(?:\d[ -]*?){13,16}\b"), "possible full card number"),
    (re.compile(r"\bIBAN[: ]+[A-Z]{2}\d{2}[A-Z0-9]{10,}", re.I), "IBAN"),
    (
        re.compile(r"\b(date of birth|d\.o\.b\.|DOB)\b[: ]+\d", re.I),
        "date of birth",
    ),
    (re.compile(r"\bpassport (?:no|number)\b[: ]*[A-Z0-9]{6,}", re.I), "passport number"),
]

# Card-number-shaped strings that are really something else.
CARD_ALLOW = re.compile(r"^\s*(?:\d{4}[ -]?){0,2}\d{0,4}\s*$")


def _scan_sensitive(node: Any, path: str, problems: list[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            _scan_sensitive(value, f"{path}.{key}", problems)
    elif isinstance(node, list):
        for position, value in enumerate(node):
            _scan_sensitive(value, f"{path}[{position}]", problems)
    elif isinstance(node, str):
        for pattern, label in FORBIDDEN:
            match = pattern.search(node)
            if not match:
                continue
            if label == "possible full card number":
                digits = re.sub(r"\D", "", match.group(0))
                # Ignore timestamps, counts and ids that merely look card-shaped.
                if len(digits) < 13 or not CARD_ALLOW.match(match.group(0)):
                    continue
            problems.append(f"{path}: contains {label}")


def validate_dataset(base_dir: str) -> list[str]:
    """Validate index + every detail shard. Returns a list of problems."""
    problems: list[str] = []
    index_path = os.path.join(base_dir, "risk-health", "index.json")
    if not os.path.exists(index_path):
        return [f"{index_path} does not exist"]

    with open(index_path, encoding="utf-8") as handle:
        index = json.load(handle)

    try:
        methodology = Methodology(index["methodology"])
    except Exception as exc:  # noqa: BLE001 - surfaced as a dataset problem
        return [f"methodology block is unusable: {exc}"]

    merchants = index.get("merchants", [])
    if not merchants:
        problems.append("index.json has no merchants")

    seen: set[str] = set()
    shards: dict[str, dict[str, Any]] = {}

    for merchant in merchants:
        account_id = merchant.get("id")
        if not account_id:
            problems.append("index merchant with no id")
            continue
        if not account_id.startswith("acct_"):
            problems.append(
                f"{account_id}: merchant id is not a Stripe account id — accounts must be "
                "keyed by acct_... so they can be reconciled against live data"
            )
        if account_id in seen:
            problems.append(f"{account_id}: duplicate merchant in index")
        seen.add(account_id)
        if merchant.get("accountId") not in (None, account_id):
            problems.append(f"{account_id}: accountId disagrees with id")

        problems.extend(validate_record(merchant, methodology, require_dimensions=False))

        detail_file = merchant.get("detailFile")
        if not detail_file:
            problems.append(f"{account_id}: no detailFile")
            continue
        if detail_file not in shards:
            # detailFile is resolved by the browser relative to activated-payments/.
            shard_path = os.path.join(base_dir, detail_file)
            if not os.path.exists(shard_path):
                problems.append(f"{account_id}: detailFile {detail_file} does not resolve")
                shards[detail_file] = {"merchants": []}
            else:
                with open(shard_path, encoding="utf-8") as handle:
                    shards[detail_file] = json.load(handle)
        shard = shards[detail_file]
        record = next(
            (
                m
                for m in shard.get("merchants", [])
                if (m.get("accountId") or m.get("id")) == account_id
            ),
            None,
        )
        if record is None:
            problems.append(f"{account_id}: no detail record inside {detail_file}")
            continue
        problems.extend(validate_record(record, methodology))
        if record.get("score") != merchant.get("score"):
            problems.append(
                f"{account_id}: index score {merchant.get('score')} != detail score "
                f"{record.get('score')}"
            )

    _scan_sensitive(index, "index", problems)
    for name, shard in shards.items():
        _scan_sensitive(shard, name, problems)

    coverage = index.get("coverage")
    if isinstance(coverage, dict):
        reviewed = coverage.get("reviewedAccounts")
        if reviewed is not None and reviewed != len(merchants):
            problems.append(
                f"coverage.reviewedAccounts {reviewed} != {len(merchants)} merchants in index"
            )
    return problems


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    base_dir = argv[0] if argv else "activated-payments"
    problems = validate_dataset(base_dir)
    if problems:
        print(f"FAIL — {len(problems)} integrity problem(s) in {base_dir}:")
        for problem in problems[:100]:
            print(f"  - {problem}")
        if len(problems) > 100:
            print(f"  ... and {len(problems) - 100} more")
        return 1
    print(f"OK — {base_dir} passed every integrity check")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
