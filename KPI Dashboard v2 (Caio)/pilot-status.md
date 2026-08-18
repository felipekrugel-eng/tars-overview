# Sales-history pricing pilot — status

STATE: EFFECT_DOWN
PRICE_STATE: PRICE_NOT_APPLIED
GENERATED: 2026-08-18 05:43 UTC
LAST_DATA_DATE: 2026-08-16
SIGNAL_DAYS: 18
SIGNAL_DAYS_NEEDED: 7
SIGNAL_DAYS_READABLE_ETA: reached
SIGNAL_DAYS_CONFIRM: 37
SIGNAL_DAYS_CONFIRM_ETA: 2026-09-06
DATA_LAG_DAYS: 2

## The treatment as intended vs as shipped
PAYWALL_INTENDED: free sales history 30d -> 15d
PRICE_INTENDED: 5.0 -> 9.0 USD (stated by product, unverified)
PRICE_OBSERVED_BASELINE: $5.17 (modal $5.00, 659 adopters)
PRICE_OBSERVED_SIGNAL: $5.15 (modal $5.00, 52 adopters)
PRICE_CHANGE_DETECTED: False
PRICE_FINDING: flat: merchants arriving after the change pay $5.15 on average against $5.17 before, within normal tier-mix wobble
INTENDED_TIER: S_SALESHISTORY_1_USD_V002
INTENDED_TIER_SUBS_GLOBAL: 129
INTENDED_TIER_PILOT_SUBS_SINCE_LAUNCH: 0

## New payers (the primary metric)
BASELINE_PILOT_PER_DAY: 3.633
SIGNAL_PILOT_PER_DAY: 2.722
BASELINE_CONTROL_PER_DAY: 55.633
SIGNAL_CONTROL_PER_DAY: 53.889
DID: 0.774
PILOT_SIGNAL_COUNT: 49
EXPECTED: 63.3
NULL95: [48, 79]
P_VALUE: 0.037
READABLE: True

## Revenue (observed on both sides — no list price assumed)
REVENUE_BASELINE_PER_DAY: 64.25
REVENUE_SIGNAL_PER_DAY: 35.11
COUNTERFACTUAL_REVENUE_PER_DAY: 62.24
DID_REVENUE: 0.564
NOTE: with the price flat, this moves on volume and monthly/annual mix, not pricing.

## Upsells (needs a full billing month — 28 signal days)
SIGNAL_PILOT_PER_DAY: 0.778
DID: 0.709
READABLE: False

## Reading this
Launch was 2026-07-16; adoption runs through a 14-day trial, so the first
genuinely treated merchant bills 2026-07-30. Anything dated 16-29 Jul came from
trials started under the old 30-day rule and is excluded from the verdict.
Price is read from UNIT_AMOUNT (never AMOUNT, which carries quantity and proration)
on monthly USD SKUs only. Nothing here multiplies by an assumed price.
Trial STARTS are not measurable anywhere — merchants who hit the wall and
walked away are invisible.
