# Sales-history pricing pilot — status

STATE: TOO_EARLY
GENERATED: 2026-08-04 07:49 UTC
LAST_DATA_DATE: 2026-08-03
SIGNAL_DAYS: 5
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: 2026-08-06
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-05
DATA_LAG_DAYS: 1

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.643
SIGNAL_PILOT_PER_DAY: 2.6
BASELINE_CONTROL_PER_DAY: 55.633
SIGNAL_CONTROL_PER_DAY: 52.0
DID: 0.764
PILOT_SIGNAL_COUNT: 13
EXPECTED: 17.0
NULL95: [9, 26]
P_VALUE: 0.1992
READABLE: False

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.6
DID: 0.523
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
