-- =================================================================
-- RECEIPTS / TPV COHORT x COUNTRY x MONTH — DAILY "AS-OF", OPTIMIZED v3
-- READ-ONLY single statement (no CREATE — works with DATA_VIEWER)
-- =================================================================
-- v3: live profile showed GROUPING SETS = 72.6% of runtime. Two of the four
-- grains (STORE_ID, EMPLOYEE_ID -> ACTIVE_STORES/ACTIVE_EMPLOYEES) are unused
-- downstream, so they were removed (halves the grouping pass). The snapshot
-- fan-out is collapsed to per-bucket daily increments before the spine join,
-- and the cosmetic final ORDER BY is dropped. Output columns unchanged.
--
-- Pipeline (LOYVERSE_RECEIPTS_UNIQUE scanned once, in rsrc):
--    rsrc -> flagged -> agg (grouping sets) -> events -> daily_incr -> metrics -> final
-- =================================================================

WITH snapshots AS (
    SELECT DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 70))
    WHERE DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE <= CURRENT_DATE()
),
account_meta AS (
    SELECT LOYVERSE_ID,
           UPPER(TRIM(COUNTRY))                 AS COUNTRY,
           COALESCE(CURRENCY_DECIMAL_PLACES, 2) AS DECIMAL_PLACES,
           MIN(DATE_TRUNC('MONTH', CREATED_AT)::DATE)
               OVER (PARTITION BY LOWER(TRIM(EMAIL))) AS COHORT_MONTH
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
      AND COUNTRY IS NOT NULL AND COUNTRY <> ''
),
-- ===== the ONLY pass over the big table =====
rsrc AS (
    SELECT MERCHANT_ID, TOTAL_MONEY,
           UPPER(TRIM(CURRENCY))            AS RECEIPT_CURRENCY,
           TRY_TO_TIMESTAMP(RECEIPT_DATE)   AS RECEIPT_TS    -- parsed ONCE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
    WHERE TOTAL_MONEY IS NOT NULL AND TOTAL_MONEY > 0
      AND CANCELLED_AT IS NULL
      AND REFUND_FOR IS NULL
      AND UPPER(COALESCE(RECEIPT_TYPE, 'SALE')) <> 'REFUND'
      -- TEST ONLY: uncomment to validate cheaply on recent data, then re-comment
      -- AND TRY_TO_TIMESTAMP(RECEIPT_DATE) >= DATE '2026-01-01'
),
flagged AS (
    SELECT
        mm.COHORT_MONTH,
        mm.COUNTRY,
        DATE_TRUNC('MONTH', r.RECEIPT_TS)::DATE AS CALENDAR_MONTH,
        r.RECEIPT_TS::DATE                      AS VIS_DATE,
        r.MERCHANT_ID,
        (r.TOTAL_MONEY / POWER(10, COALESCE(mm.DECIMAL_PLACES, 2))) *
            CASE r.RECEIPT_CURRENCY
                WHEN 'USD' THEN 1.0      WHEN 'EUR' THEN 1.16
                WHEN 'GBP' THEN 1.34     WHEN 'CAD' THEN 0.74
                WHEN 'AUD' THEN 0.66     WHEN 'NZD' THEN 0.60
                WHEN 'CHF' THEN 1.12     WHEN 'JPY' THEN 0.0066
                WHEN 'KRW' THEN 0.00072  WHEN 'CNY' THEN 0.14
                WHEN 'HKD' THEN 0.128    WHEN 'SGD' THEN 0.74
                WHEN 'INR' THEN 0.012    WHEN 'IDR' THEN 0.000063
                WHEN 'PHP' THEN 0.018    WHEN 'MYR' THEN 0.21
                WHEN 'THB' THEN 0.028    WHEN 'VND' THEN 0.000040
                WHEN 'BRL' THEN 0.17     WHEN 'MXN' THEN 0.058
                WHEN 'ARS' THEN 0.00081  WHEN 'CLP' THEN 0.0010
                WHEN 'COP' THEN 0.00023  WHEN 'PEN' THEN 0.27
                WHEN 'ZAR' THEN 0.054    WHEN 'AED' THEN 0.27
                WHEN 'SAR' THEN 0.27     WHEN 'TRY' THEN 0.029
                WHEN 'PLN' THEN 0.25     WHEN 'SEK' THEN 0.094
                WHEN 'NOK' THEN 0.093    WHEN 'DKK' THEN 0.15
                ELSE NULL
            END AS AMOUNT_USD
    FROM rsrc r
    JOIN account_meta mm ON mm.LOYVERSE_ID = r.MERCHANT_ID
    WHERE r.RECEIPT_TS IS NOT NULL
      AND r.RECEIPT_TS::DATE <= CURRENT_DATE()
),
-- TWO grains in one hash-aggregation pass:
--   GID = GROUPING_ID(VIS_DATE, MERCHANT_ID)
--     1 -> per (bucket, VIS_DATE)   : daily receipts + TPV
--     2 -> per (bucket, MERCHANT_ID): merchant's first day = MIN(VIS_DATE)
-- STORE_ID / EMPLOYEE_ID grains removed (unused downstream; were ~half this pass).
agg AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        MERCHANT_ID,
        GROUPING_ID(VIS_DATE, MERCHANT_ID) AS GID,
        MIN(VIS_DATE)   AS DAY,
        COUNT(*)        AS CNT,
        SUM(AMOUNT_USD) AS AMT
    FROM flagged
    GROUP BY GROUPING SETS (
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, VIS_DATE),
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, MERCHANT_ID)
    )
),
events AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        CASE WHEN DAY < DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) THEN DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) ELSE DAY END AS EFF_DAY,
        CASE WHEN GID = 1 THEN CNT ELSE 0 END                            AS INCR_RECEIPTS,
        CASE WHEN GID = 1 THEN AMT ELSE 0 END                            AS INCR_TPV_USD,
        CASE WHEN GID = 2 AND MERCHANT_ID IS NOT NULL THEN 1 ELSE 0 END  AS NEW_MERCHANTS
    FROM agg
),
-- Collapse per-MERCHANT events to per-bucket DAILY increments BEFORE fanning out.
daily_incr AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH, EFF_DAY,
        SUM(INCR_RECEIPTS) AS D_RECEIPTS,
        SUM(INCR_TPV_USD)  AS D_TPV_USD,
        SUM(NEW_MERCHANTS) AS D_MERCHANTS
    FROM events
    GROUP BY COHORT_MONTH, COUNTRY, CALENDAR_MONTH, EFF_DAY
),
metrics AS (
    SELECT
        s.SNAPSHOT_DATE,
        d.COHORT_MONTH, d.COUNTRY, d.CALENDAR_MONTH,
        SUM(d.D_RECEIPTS
