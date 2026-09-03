# Sales-history pricing pilot — status

STATE: EFFECT_DOWN
PRICE_STATE: PRICE_APPLIED
GENERATED: 2026-09-03 05:50 UTC
LAST_DATA_DATE: 2026-09-01
SIGNAL_DAYS: 34
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-06
DATA_LAG_DAYS: 2

## The treatment as intended vs as shipped
PAYWALL_INTENDED: free sales history 30d -> 15d
PRICE_INTENDED: 5.0 -> 9.0 USD (stated by product, unverified)
PRICE_OBSERVED_BASELINE: $5.17 (modal $5.00, 659 adopters)
PRICE_OBSERVED_SIGNAL: $5.51 (modal $5.00, 98 adopters)
PRICE_CHANGE_DETECTED: True
PRICE_FINDING: moved: $5.17 -> $5.51 (+7%)
INTENDED_TIER: not found / catalogue not queried
INTENDED_TIER_SUBS_GLOBAL: null
INTENDED_TIER_PILOT_SUBS_SINCE_LAUNCH: null

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.622
SIGNAL_PILOT_PER_DAY: 2.941
BASELINE_CONTROL_PER_DAY: 55.602
SIGNAL_CONTROL_PER_DAY: 53.441
DID: 0.845
PILOT_SIGNAL_COUNT: 100
EXPECTED: 118.4
NULL95: [98, 140]
P_VALUE: 0.0473
READABLE: True

## Revenue (observed on both sides — no list price assumed)
REVENUE_BASELINE_PER_DAY: 63.64
REVENUE_SIGNAL_PER_DAY: 45.29
COUNTERFACTUAL_REVENUE_PER_DAY: 61.16
DID_REVENUE: 0.741
NOTE: with the price flat, this moves on volume and monthly/annual mix, not pricing.

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.912
DID: 0.842
READABLE: True

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Price is read from UNIT_AMOUNT (never AMOUNT, which carries quantity and proration)
on monthly USD SKUs only. Nothing here multiplies by an assumed price.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
