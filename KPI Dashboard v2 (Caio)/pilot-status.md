# Sales-history pricing pilot — status

STATE: EFFECT_DOWN
PRICE_STATE: PRICE_APPLIED
GENERATED: 2026-09-03 09:43 UTC
LAST_DATA_DATE: 2026-09-02
SIGNAL_DAYS: 35
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-05
DATA_LAG_DAYS: 1

## The treatment as intended vs as shipped
PAYWALL_INTENDED: free sales history 30d -> 15d
PRICE_INTENDED: 5.0 -> 9.0 USD (stated by product, unverified)
PRICE_OBSERVED_BASELINE: $5.17 (modal $5.00, 659 adopters)
PRICE_OBSERVED_SIGNAL: $5.50 (modal $5.00, 100 adopters)
PRICE_CHANGE_DETECTED: True
PRICE_FINDING: moved: $5.17 -> $5.50 (+6%)
INTENDED_TIER: S_SALESHISTORY_1_USD_V002
INTENDED_TIER_SUBS_GLOBAL: 140
INTENDED_TIER_PILOT_SUBS_SINCE_LAUNCH: 0

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.622
SIGNAL_PILOT_PER_DAY: 2.914
BASELINE_CONTROL_PER_DAY: 55.602
SIGNAL_CONTROL_PER_DAY: 53.629
DID: 0.834
PILOT_SIGNAL_COUNT: 102
EXPECTED: 122.3
NULL95: [101, 144]
P_VALUE: 0.034
READABLE: True

## Revenue (observed on both sides — no list price assumed)
REVENUE_BASELINE_PER_DAY: 63.64
REVENUE_SIGNAL_PER_DAY: 46.71
COUNTERFACTUAL_REVENUE_PER_DAY: 61.38
DID_REVENUE: 0.761
NOTE: with the price flat, this moves on volume and monthly/annual mix, not pricing.

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.914
DID: 0.85
READABLE: True

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Price is read from UNIT_AMOUNT (never AMOUNT, which carries quantity and proration)
on monthly USD SKUs only. Nothing here multiplies by an assumed price.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
