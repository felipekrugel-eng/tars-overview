# Sales-history pricing pilot — status

STATE: TOO_EARLY
GENERATED: 2026-08-02 07:52 UTC
LAST_DATA_DATE: 2026-08-01
SIGNAL_DAYS: 3
SIGNAL_DAYS_NEEDED: 7

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.643
SIGNAL_PILOT_PER_DAY: 3.333
BASELINE_CONTROL_PER_DAY: 55.643
SIGNAL_CONTROL_PER_DAY: 53.0
DID: 0.961
PILOT_SIGNAL_COUNT: 10
EXPECTED: 10.4
NULL95: [5, 17]
P_VALUE: 0.5319
READABLE: False

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.667
DID: 0.576
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
