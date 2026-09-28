#!/usr/bin/env python3
"""Gate the expensive payments rebuild on the last verified Snowflake pull.

The GitHub cron can be delayed or dropped. Frequent completions of cusum-pull
provide a second wake-up, but each wake-up should do work only when the
authoritative pull manifest has aged out. A successful workbook rebuild from
committed CSVs never advances this manifest.
"""

import argparse
import datetime as dt
import json
import os
from pathlib import Path

MAX_AGE_MINUTES = 170


def should_run(status_path: Path, now: dt.datetime, max_age_minutes: int) -> tuple[bool, str]:
    try:
        status = json.loads(status_path.read_text(encoding="utf-8"))
        if status.get("pull_succeeded") is not True:
            return True, "last pull is not verified successful"
        completed = dt.datetime.fromisoformat(status["completed_at_utc"].replace("Z", "+00:00"))
        if completed.tzinfo is None:
            return True, "last pull timestamp has no timezone"
        age_minutes = (now - completed.astimezone(dt.timezone.utc)).total_seconds() / 60
        if age_minutes < -5:
            return True, f"last pull timestamp is {abs(age_minutes):.0f} min in the future"
        return age_minutes >= max_age_minutes, (
            f"last verified pull is {age_minutes:.0f} min old "
            f"(refresh threshold {max_age_minutes} min)"
        )
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        return True, f"verified pull manifest unavailable or invalid: {type(exc).__name__}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", type=Path, required=True)
    parser.add_argument("--max-age-minutes", type=int, default=MAX_AGE_MINUTES)
    parser.add_argument("--event", required=True)
    args = parser.parse_args()
    if args.max_age_minutes <= 0:
        parser.error("--max-age-minutes must be positive")

    if args.event in {"workflow_dispatch", "push"}:
        run, reason = True, f"{args.event} requested a full refresh"
    else:
        run, reason = should_run(args.status, dt.datetime.now(dt.timezone.utc), args.max_age_minutes)
    print(f"run={'yes' if run else 'no'}: {reason}", flush=True)
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as f:
            f.write(f"run={'yes' if run else 'no'}\n")


if __name__ == "__main__":
    main()
