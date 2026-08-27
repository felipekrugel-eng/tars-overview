-- q0_schema_discovery.sql
-- ONE QUERY PER FILE. Split out of US_Merchant_Base_Refresh_Snowflake.sql,
-- which stacked Q0-Q4 in a single file against the standing rule
-- 'never stack two queries in one file'.
--
-- Shared run context (from the original preamble):
--   account ORXEAZX-TC97659 · user TARS_SERVICE_USER · role DATA_VIEWER
--   warehouse COMPUTE_WH (statement timeout 3600s)
--   database LOYVERSE_DATA_LAKE · schema PUBLIC
-- Run order: q0 once (cheap) -> q1 (the base) -> q2 (receipts, slow)
--            -> q3 + q4 to reconcile. q1 is the only one the pipeline needs.
-- ============================================================================

-- Q0 — SCHEMA DISCOVERY. Run once. Confirms the columns marked [VERIFY], chiefly
--      the MRR grain on CHARGEBEE_SUBSCRIPTIONS_V and whether LOYVERSE_MERCHANTS
--      carries address fields (the old file had City 24% / State 14% populated
--      from an unknown source — if the address columns exist here, they are the
--      source and coverage goes to ~100%).
-- ============================================================================
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM LOYVERSE_DATA_LAKE.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'PUBLIC'
  AND TABLE_NAME IN ('LOYVERSE_MERCHANTS',
                     'LOYVERSE_RECEIPTS_UNIQUE',
                     'SALES_PER_ACCOUNT_MONTHLY',
                     'CHARGEBEE_SUBSCRIPTIONS_V')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
