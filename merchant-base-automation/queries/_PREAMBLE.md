# Original preamble — US_Merchant_Base_Refresh_Snowflake.sql

Kept verbatim. Every gotcha here still applies to the split queries, in
particular the CREATED_AT timezone note, the TOTAL_MONEY dollars-not-cents
note, the currency-labelling defect, and the instruction that the
`us_bot_accounts` block must stay byte-identical to the copy in
`activated-payments/sql/us_registrations.sql`.

```sql
-- ============================================================================
-- US MERCHANT BASE — FULL REBUILD (all 131,217 US merchants)
-- Replaces "US_Merchant_Base_Full_Definition of Campaigns.xlsx" as at run date.
--
-- Author:  Cowork session, 18 August 2026 (Felipe)
-- Rev 2:   scope changed from the ~18k POS-active subset to the FULL US base.
--          Every live US merchant appears as a row. Differentiation happens in
--          columns (BASE_GROUP / IS_TARGETABLE / EXCLUSION_REASON), never by
--          omission — a merchant missing from the file raises questions, a
--          merchant tagged 'dormant' answers them.
--
-- Fixes:   (1) col AA "Month Joined Loyverse POS" — 100% empty in the old file
--          (2) POS layer frozen at 2026-07-12 — 2,276 merchants missing
--          (3) Email 4% / Phone 1% / Contact 0.7% — the real campaign blocker
--          (4) "Paying Customer" 249 blanks + 25 conflicts vs the funnel data
--          (5) base stated as 15,948 when the true US denominator is 131,217
--
-- Run context (from kpi-automation, Mem note 5c015b2b):
--   account   ORXEAZX-TC97659
--   user      TARS_SERVICE_USER
--   role      DATA_VIEWER
--   warehouse COMPUTE_WH        (statement timeout 3600s)
--   database  LOYVERSE_DATA_LAKE
--   schema    PUBLIC
--
-- Run order: Q0 once (cheap) -> Q1 (the base, minutes) -> Q2 (receipts, slow)
--            -> Q3 to reconcile. Export Q1 to CSV and hand it to the workbook
--            builder script (build_full_base.py) shipped alongside this file.
--
-- GOTCHAS baked in below:
--   * LOYVERSE_MERCHANTS.CREATED_AT is TIMESTAMP_LTZ but stores LOCAL wall-clock,
--     not a true UTC instant. Fine for a YYYY-MM bucket, wrong for hourly work.
--   * LOYVERSE_RECEIPTS_UNIQUE.TOTAL_MONEY is in DOLLARS, NOT cents. Do not
--     divide by 100. This was long assumed both ways in the library -- see
--     us_paying_merchants_gtv.sql (dollars) vs the dashboard's monthly.sql
--     (divides by minor units) -- so Q1 stopped assuming and now MEASURES it,
--     carrying the factor it chose on every row in GTV_UNIT_SCALE. Confirmed
--     independently against Stripe: across the 52 merchants who also process
--     cards, POS median ticket / settled card ticket = 0.83x.
--   * The real GTV defect is CURRENCY LABELLING, not units. 555 merchants
--     report 'USD' with median tickets in the thousands and carry 89% of
--     apparent 30-day volume. Tiered, not dropped, in GTV_CONFIDENCE.
--   * STRIPE.CONNECTED_ACCOUNT_CHARGES.AMOUNT is in currency MINOR units.
--   * The us_bot_accounts block must stay byte-identical to the copy in
--     activated-payments/sql/us_registrations.sql. Do not edit it here only.
--   * At 131k rows do NOT put formulas in the workbook. Everything the old file
--     computed in-sheet (cols AF, AG, AV — 47,844 formulas) is computed here
--     instead and lands as static values. See the DERIVED block in Q1.
-- ============================================================================


-- ============================================================================
```
