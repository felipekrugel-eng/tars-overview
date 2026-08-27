-- q3_reconciliation.sql
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

-- Q3 — RECONCILIATION. Run against the Q1 result. These must match
--      window.__FUNNEL_BASES in funnel-data.js. At 2026-08-18:
--        new_us 3,067 | paying_base_us 1,277 | nonpaying_us 2,352
--        dormant_us 124,521 | total_us 131,217
--      and __FUNNEL_STAGES_BY.US: entered 3,721 | signed_up 682 | enabled 202
--        | transacting 52
--      If these drift, the bot filter or the launch date moved — check that
--      before trusting anything downstream.
-- ============================================================================
/*  Wrap the Q1 statement as a subquery named q1, then:

SELECT
    COUNT(*)                                AS TOTAL_US,             -- expect 131,217
    COUNT_IF(BASE_GROUP = 'new')            AS NEW_US,               -- expect   3,067
    COUNT_IF(BASE_GROUP = 'paying')         AS PAYING_BASE_US,       -- expect   1,277
    COUNT_IF(BASE_GROUP = 'nonpaying')      AS NONPAYING_US,         -- expect   2,352
    COUNT_IF(BASE_GROUP = 'dormant')        AS DORMANT_US,           -- expect 124,521
    SUM(IS_SIGNED_UP)                       AS SIGNED_UP,            -- expect     682
    SUM(IS_ENABLED)                         AS ENABLED,              -- expect     202
    SUM(IS_TRANSACTING)                     AS TRANSACTING,          -- expect      52
    SUM(REJECTED_BUT_TRANSACTING)           AS REJECTED_BUT_TXN,     -- expect       2
    COUNT_IF(MONTH_JOINED_POS IS NULL)      AS MISSING_REG_MONTH,    -- must be     0
    COUNT_IF(IS_CONTACTABLE = 'Yes')        AS CONTACTABLE,
    COUNT_IF(IS_TARGETABLE  = 'Yes')        AS TARGETABLE,
    MIN(JOINED_LOYVERSE)                    AS EARLIEST_REGISTRATION,
    MAX(JOINED_LOYVERSE)                    AS LATEST_REGISTRATION
FROM q1;

*/


