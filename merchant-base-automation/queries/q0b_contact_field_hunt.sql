-- q0b_contact_field_hunt.sql
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

-- Q0b — CONTACT-FIELD HUNT. Answers the question that has been open since
--       loyverse_merchants_columns_discovery.sql: is there ANY phone/address
--       source in the lake outside Stripe? If this returns rows on a merchant-
--       grain table, that table is the fix for 1% phone coverage.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM LOYVERSE_DATA_LAKE.INFORMATION_SCHEMA.COLUMNS
WHERE (   LOWER(COLUMN_NAME) LIKE '%phone%'
       OR LOWER(COLUMN_NAME) LIKE '%mobile%'
       OR LOWER(COLUMN_NAME) LIKE '%contact%'
       OR LOWER(COLUMN_NAME) LIKE '%city%'
       OR LOWER(COLUMN_NAME) LIKE '%address%'
       OR LOWER(COLUMN_NAME) LIKE '%region%'
       OR LOWER(COLUMN_NAME) LIKE '%state%'
       OR LOWER(COLUMN_NAME) LIKE '%postal%'
       OR LOWER(COLUMN_NAME) LIKE '%zip%')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Same for the Stripe share. Run this too — the share lives in a separate
-- database and its INFORMATION_SCHEMA is separate. Note there is NO
-- BUSINESS_TYPE column on CONNECTED_ACCOUNTS; use LEGAL_ENTITY_TYPE.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'STRIPE'
  AND TABLE_NAME IN ('CONNECTED_ACCOUNTS', 'CONNECTED_ACCOUNT_CHARGES')
ORDER BY TABLE_NAME, ORDINAL_POSITION;


