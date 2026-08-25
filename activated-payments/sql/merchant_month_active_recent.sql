-- LOYVERSE PAYMENTS — RECENT ACTIVE MONTHS FROM RAW RECEIPTS (automation-safe)
--
-- WHY THIS EXISTS ALONGSIDE merchant_month_flags.sql
-- That query reads SALES_PER_ACCOUNT_MONTHLY, which is cheap and complete for history but
-- LAGS: on 2026-08-25 its most recent month was 2026-03. Loyverse Payments has only existed
-- since 2026-04, so every month that matters for intersecting "active" with a payments KPI
-- falls in the gap. Reading only the lagged table would have produced an entirely plausible
-- triangle of zeros for exactly the question this feature was built to answer.
--
-- So the recent window comes from the raw receipts table instead, and the two are unioned in
-- pull.js: the monthly table owns everything up to its own last month, this query owns the
-- months after it. RECENT_FROM below must stay at or before that lag boundary so no month is
-- left uncovered by either source.
--
-- COST. The KPI pipeline's receipts query has hit the 3,600s timeout, but it scans ALL history
-- for ALL merchants across 49 daily snapshots. This one is bounded twice over: to the few
-- hundred merchants holding a connected account, and to a handful of recent months. The date
-- predicate is written against the raw string as well as the parsed timestamp, so Snowflake can
-- prune on the stored value rather than parsing every row before filtering.
--
-- Receipt hygiene matches the KPI pipeline exactly: money on the receipt, not cancelled, not a
-- refund, and not the refund of another receipt.

SELECT DISTINCT
    MERCHANT_ID                                                  AS MERCHANT_ID,
    TO_VARCHAR(TRY_TO_TIMESTAMP(RECEIPT_DATE), 'YYYY-MM')        AS MONTH_START
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
WHERE MERCHANT_ID IN (/*MERCHANT_IDS*/)
  AND RECEIPT_DATE >= '/*RECENT_FROM*/'
  AND TOTAL_MONEY IS NOT NULL AND TOTAL_MONEY > 0
  AND CANCELLED_AT IS NULL
  AND REFUND_FOR IS NULL
  AND UPPER(COALESCE(RECEIPT_TYPE, 'SALE')) <> 'REFUND'
  AND TRY_TO_TIMESTAMP(RECEIPT_DATE) >= TO_TIMESTAMP('/*RECENT_FROM*/')
;
