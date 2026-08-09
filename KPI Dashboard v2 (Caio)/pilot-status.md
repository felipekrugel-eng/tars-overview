# Sales-history pricing pilot — status

STATE: NO_EFFECT
GENERATED: 2026-08-09 05:45 UTC
LAST_DATA_DATE: 2026-08-07
SIGNAL_DAYS: 9
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-06
DATA_LAG_DAYS: 2

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.638
SIGNAL_PILOT_PER_DAY: 3.111
BASELINE_CONTROL_PER_DAY: 55.638
SIGNAL_CONTROL_PER_DAY: 55.889
DID: 0.851
PILOT_SIGNAL_COUNT: 28
EXPECTED: 32.9
NULL95: [22, 45]
P_VALUE: 0.2257
READABLE: True

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.667
DID: 0.536
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
