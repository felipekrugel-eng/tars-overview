"""Regression tests for the receipts-feed completeness gate.

The gate exists because on 2026-09-29 the receipts feed stopped, every downstream build
read the near-empty days as real, and the dashboard published qualified active merchants
falling from 332,105 to 76 for three days.

It then spent at least ten days (to 2026-10-13) firing on every run that started before
12:00 UTC while the feed was perfectly healthy, because it dropped the last LAG_DAYS
*rows* rather than *days* and the in-progress day has no row until ingestion starts.

These tests pin both halves: silence must still be caught, and the time of day the job
runs must not matter.
"""
import csv
import datetime as dt
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from build_subs_data import feed_completeness, STALE_ALARM_DAYS  # noqa: E402

HEALTHY = 9_000_000


def _write(tmp_path, rows):
    p = tmp_path / "receipts_feed_health.csv"
    with p.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["D", "RECEIPTS", "MERCHANTS"])
        for d, n in rows:
            w.writerow([d, int(n), 200_000])
    return p


def _series(end_offset, days=45, value=HEALTHY):
    """`days` healthy days ending `end_offset` days before today (UTC)."""
    today = dt.datetime.utcnow().date()
    return [((today - dt.timedelta(days=end_offset + i)).isoformat(), value)
            for i in range(days)][::-1]


def _alarms(health):
    stale = health.get("staleDays")
    return stale is not None and stale > STALE_ALARM_DAYS


def test_no_row_for_today_does_not_alarm(tmp_path):
    """Early-morning run: ingestion for today has not started, so there is no row at all.

    This is the case that failed 12 runs out of 12 before the fix.
    """
    last, health = feed_completeness(_write(tmp_path, _series(end_offset=1)))
    assert health["checked"] is True
    assert health["staleDays"] == 2, "must judge D-2, regardless of the missing today row"
    assert not _alarms(health)


def test_partial_row_for_today_does_not_alarm(tmp_path):
    """Afternoon run: today exists but is only part-way through. Must behave identically."""
    rows = _series(end_offset=1) + [(dt.datetime.utcnow().date().isoformat(), HEALTHY * 0.4)]
    last, health = feed_completeness(_write(tmp_path, rows))
    assert health["staleDays"] == 2
    assert not _alarms(health)


def test_morning_and_afternoon_agree(tmp_path):
    """The verdict must not depend on what time the job runs."""
    morning = feed_completeness(_write(tmp_path, _series(end_offset=1)))[1]
    afternoon = feed_completeness(_write(
        tmp_path, _series(end_offset=1)
        + [(dt.datetime.utcnow().date().isoformat(), HEALTHY * 0.4)]))[1]
    assert morning["staleDays"] == afternoon["staleDays"]
    assert _alarms(morning) == _alarms(afternoon) is False


def test_feed_silent_for_five_days_alarms(tmp_path):
    """A dead feed emits no rows at all. Silence must still be caught."""
    last, health = feed_completeness(_write(tmp_path, _series(end_offset=6)))
    assert health["staleDays"] >= 5
    assert _alarms(health), "a silent feed must fail the run"


def test_collapsed_feed_alarms(tmp_path):
    """The 2026-09-29 shape: rows still arrive, at a fraction of a percent of normal."""
    rows = _series(end_offset=5) + [
        ((dt.datetime.utcnow().date() - dt.timedelta(days=i)).isoformat(), 700)
        for i in range(2, 5)]
    last, health = feed_completeness(_write(tmp_path, sorted(rows)))
    assert _alarms(health), "a collapsed feed must fail the run"


def test_outage_zeros_do_not_lower_the_bar(tmp_path):
    """A long outage must not drag the median down and quietly re-qualify itself."""
    rows = _series(end_offset=11, days=34) + [
        ((dt.datetime.utcnow().date() - dt.timedelta(days=i)).isoformat(), 0)
        for i in range(2, 11)]
    last, health = feed_completeness(_write(tmp_path, sorted(rows)))
    assert health["trailingMedianReceipts"] > HEALTHY * 0.8, \
        "the bar must still reflect healthy days, not the outage"
    assert _alarms(health)
