-- q2_pos_activity_detail.sql
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

-- Q2 — POS ACTIVITY DETAIL (expensive, ~20-30 min against 8.76bn rows).
--      Only needed for the money columns: GTV, avg ticket, first/last sale,
--      active days. Everything else in Q1 already covers the POS shape via
--      SALES_PER_ACCOUNT_MONTHLY, which is cheap.
--
--      Scope this to the merchants you will actually work — running it across
--      all 131k when 124k are dormant wastes most of the warehouse time.
--
--      TOTAL_MONEY is in DOLLARS. This block used to divide by 100 on the old
--      cents assumption, which understated every figure it produced by 100x.
--      Corrected 18 Aug after measuring against Stripe. If you are comparing
--      output to anything produced before that date, that is the discrepancy.
-- ============================================================================
/*
SELECT
    r.MERCHANT_ID,
    SUM(r.TOTAL_MONEY)                                  AS TOTAL_GTV_USD,
    COUNT(*)                                            AS RECEIPTS_12M,
    COUNT(DISTINCT CAST(r.CREATED_AT AS DATE))          AS ACTIVE_DAYS_12M,
    MIN(CAST(r.CREATED_AT AS DATE))                     AS FIRST_SALE_12M,
    MAX(CAST(r.CREATED_AT AS DATE))                     AS LAST_SALE,
    DATEDIFF('day', MAX(r.CREATED_AT), CURRENT_DATE())  AS DAYS_SINCE_LAST_SALE,
    AVG(r.TOTAL_MONEY)                                  AS AVG_TICKET_USD
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE r
WHERE r.CREATED_AT >= DATEADD('month', -12, CURRENT_DATE())
  AND r.CANCELLED_AT IS NULL
  AND r.MERCHANT_ID IN (
        -- scope: everyone except dormant. Paste ids from Q1, or re-run the CTEs
        -- and filter WHERE BASE_GROUP <> 'dormant'.
        SELECT MERCHANT_ID FROM base WHERE BASE_GROUP <> 'dormant'
      )
GROUP BY r.MERCHANT_ID;
*/


