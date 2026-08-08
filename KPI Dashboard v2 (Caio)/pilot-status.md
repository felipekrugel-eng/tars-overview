# Sales-history pricing pilot — status

STATE: NO_EFFECT
GENERATED: 2026-08-08 05:43 UTC
LAST_DATA_DATE: 2026-08-06
SIGNAL_DAYS: 8
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-06
DATA_LAG_DAYS: 2

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.638
SIGNAL_PILOT_PER_DAY: 3.25
BASELINE_CONTROL_PER_DAY: 55.638
SIGNAL_CONTROL_PER_DAY: 56.25
DID: 0.884
PILOT_SIGNAL_COUNT: 26
EXPECTED: 29.4
NULL95: [19, 40]
P_VALUE: 0.3027
READABLE: True

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.75
DID: 0.591
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
