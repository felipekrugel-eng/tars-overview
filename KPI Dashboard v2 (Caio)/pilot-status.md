# Sales-history pricing pilot — status

STATE: NO_EFFECT
GENERATED: 2026-08-11 05:49 UTC
LAST_DATA_DATE: 2026-08-09
SIGNAL_DAYS: 11
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-06
DATA_LAG_DAYS: 2

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.638
SIGNAL_PILOT_PER_DAY: 2.909
BASELINE_CONTROL_PER_DAY: 55.638
SIGNAL_CONTROL_PER_DAY: 54.636
DID: 0.814
PILOT_SIGNAL_COUNT: 32
EXPECTED: 39.3
NULL95: [28, 52]
P_VALUE: 0.1378
READABLE: True

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.545
DID: 0.475
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
