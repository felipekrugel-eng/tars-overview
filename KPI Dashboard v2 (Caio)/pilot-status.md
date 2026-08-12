# Sales-history pricing pilot — status

STATE: NO_EFFECT
REVENUE_STATE: REVENUE_UP
GENERATED: 2026-08-12 11:16 UTC
LAST_DATA_DATE: 2026-08-11
SIGNAL_DAYS: 13
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-05
DATA_LAG_DAYS: 1

## The treatment (two changes, one date, cannot be separated)
PAYWALL: free sales history 30d -> 15d
PRICE: 5.0 -> 9.0 USD
CHANGE_DATE: 2026-07-16
BREAKEVEN_ADOPTION_DROP: 0.444

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

## Revenue (the business metric)
REVENUE_SOURCE: actual invoice amounts
ACTUAL_REVENUE: 462.0
COUNTERFACTUAL_REVENUE: 230.47
DID_REVENUE: 2.005
OBSERVED_UNIT_PILOT_BASELINE: 6.39
OBSERVED_UNIT_PILOT_SIGNAL: 5.7

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.615
DID: 0.547
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Adoption and revenue can move in opposite directions here: the price rose
1.8x, so adoption can fall 44% before revenue is worse off.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
