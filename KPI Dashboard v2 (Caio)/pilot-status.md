# Sales-history pricing pilot — status

STATE: NO_EFFECT
GENERATED: 2026-08-12 10:02 UTC
LAST_DATA_DATE: 2026-08-11
SIGNAL_DAYS: 13
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-05
DATA_LAG_DAYS: 1

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.638
SIGNAL_PILOT_PER_DAY: 2.692
BASELINE_CONTROL_PER_DAY: 55.638
SIGNAL_CONTROL_PER_DAY: 54.231
DID: 0.759
PILOT_SIGNAL_COUNT: 35
EXPECTED: 46.1
NULL95: [33, 60]
P_VALUE: 0.0547
READABLE: True

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.615
DID: 0.547
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
