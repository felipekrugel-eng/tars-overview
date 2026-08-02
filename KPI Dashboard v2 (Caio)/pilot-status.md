# Sales-history pricing pilot — status

STATE: TOO_EARLY
GENERATED: 2026-08-02 05:35 UTC
LAST_DATA_DATE: 2026-07-31
SIGNAL_DAYS: 2
SIGNAL_DAYS_NEEDED: 7

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.643
SIGNAL_PILOT_PER_DAY: 3.0
BASELINE_CONTROL_PER_DAY: 55.643
SIGNAL_CONTROL_PER_DAY: 52.5
DID: 0.873
PILOT_SIGNAL_COUNT: 6
EXPECTED: 6.9
NULL95: [2, 12]
P_VALUE: 0.4686
READABLE: False

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.5
DID: 0.378
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
