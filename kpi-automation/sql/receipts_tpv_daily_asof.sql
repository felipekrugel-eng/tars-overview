-- =================================================================
-- RECEIPTS / TPV COHORT x COUNTRY x MONTH — DAILY "AS-OF", OPTIMIZED v2
-- READ-ONLY single statement (no CREATE — works with DATA_VIEWER)
-- =================================================================
-- v2 change vs v1: the three ROW_NUMBER window passes were 70% of the
-- runtime and were spilling to remote disk. They're replaced by ONE
-- GROUP BY GROUPING SETS pass (hash aggregation, no sorts), which
-- produces the daily additive totals AND each entity's first-appearance
-- day in a single pass over the one table scan.
--
-- Pipeline (LOYVERSE_RECEIPTS_UNIQUE is scanned exactly once, in rsrc):
--    rsrc -> flagged -> agg (grouping sets) -> events -> metrics -> final
--
-- AS-OF MODEL: a sale is visible from RECEIPT_DATE (<= snapshot);
--   cancellation/refund use current status (matches your original),
--   keeping "active" monotonic so cumulative counts are EXACT.
--
-- TESTING: the scan cost is independent of the snapshot range. To
--   validate cheaply, uncomment the date floor in rsrc (limits the scan
--   to 2026), confirm output, then re-comment for the full run.
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
    SELECT MERCHANT_ID, STORE_ID, EMPLOYEE_ID, TOTAL_MONEY,
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
        r.STORE_ID,
        r.EMPLOYEE_ID,
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
-- ONE hash-aggregation pass, four grains at once (no window sorts):
--   GID = GROUPING_ID(VIS_DATE, MERCHANT_ID, STORE_ID, EMPLOYEE_ID)
--     7  -> per (bucket, VIS_DATE)   : daily receipts + TPV
--     11 -> per (bucket, MERCHANT_ID): merchant's first day  = MIN(VIS_DATE)
--     13 -> per (bucket, STORE_ID)   : store's first day
--     14 -> per (bucket, EMPLOYEE_ID): employee's first day
agg AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        MERCHANT_ID, STORE_ID, EMPLOYEE_ID,
        GROUPING_ID(VIS_DATE, MERCHANT_ID, STORE_ID, EMPLOYEE_ID) AS GID,
        MIN(VIS_DATE)   AS DAY,        -- = VIS_DATE for set 7; first-appearance for entity sets
        COUNT(*)        AS CNT,
        SUM(AMOUNT_USD) AS AMT
    FROM flagged
    GROUP BY GROUPING SETS (
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, VIS_DATE),
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, MERCHANT_ID),
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, STORE_ID),
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, EMPLOYEE_ID)
    )
),
-- Normalize every grain to one event stream, clamping pre-window days to May 1.
events AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        CASE WHEN DAY < DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) THEN DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) ELSE DAY END AS EFF_DAY,
        CASE WHEN GID = 7  THEN CNT ELSE 0 END                              AS INCR_RECEIPTS,
        CASE WHEN GID = 7  THEN AMT ELSE 0 END                              AS INCR_TPV_USD,
        CASE WHEN GID = 11 AND MERCHANT_ID IS NOT NULL THEN 1 ELSE 0 END    AS NEW_MERCHANTS,
        CASE WHEN GID = 13 AND STORE_ID    IS NOT NULL THEN 1 ELSE 0 END    AS NEW_STORES,
        CASE WHEN GID = 14 AND EMPLOYEE_ID IS NOT NULL THEN 1 ELSE 0 END    AS NEW_EMPLOYEES
    FROM agg
),
-- Cumulative (exact) state per bucket per snapshot.
metrics AS (
    SELECT
        s.SNAPSHOT_DATE,
        e.COHORT_MONTH, e.COUNTRY, e.CALENDAR_MONTH,
        SUM(e.INCR_RECEIPTS) AS RECEIPT_COUNT,
        SUM(e.INCR_TPV_USD)  AS TPV_USD_APPROX,
        SUM(e.NEW_MERCHANTS) AS ACTIVE_MERCHANTS,
        SUM(e.NEW_STORES)    AS ACTIVE_STORES,
        SUM(e.NEW_EMPLOYEES) AS ACTIVE_EMPLOYEES
    FROM events e
    JOIN snapshots s ON e.EFF_DAY <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, e.COHORT_MONTH, e.COUNTRY, e.CALENDAR_MONTH
),
-- Cohort x country size, as of each snapshot (small; merchants table only).
merchant_country_meta AS (
    SELECT EMAIL_KEY, COUNTRY, COHORT_MONTH, MIN(CREATED_DATE) AS FIRST_CREATED_DATE
    FROM (
        SELECT LOWER(TRIM(EMAIL))   AS EMAIL_KEY,
               UPPER(TRIM(COUNTRY)) AS COUNTRY,
               CREATED_AT::DATE     AS CREATED_DATE,
               MIN(DATE_TRUNC('MONTH', CREATED_AT)::DATE)
                   OVER (PARTITION BY LOWER(TRIM(EMAIL))) AS COHORT_MONTH
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
          AND COUNTRY IS NOT NULL AND COUNTRY <> ''
    )
    GROUP BY EMAIL_KEY, COUNTRY, COHORT_MONTH
),
cohort_country_size AS (
    SELECT s.SNAPSHOT_DATE, mcm.COHORT_MONTH, mcm.COUNTRY,
           COUNT(DISTINCT mcm.EMAIL_KEY) AS COHORT_COUNTRY_SIZE
    FROM merchant_country_meta mcm
    JOIN snapshots s ON mcm.FIRST_CREATED_DATE <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, mcm.COHORT_MONTH, mcm.COUNTRY
)
SELECT
    m.SNAPSHOT_DATE,
    m.COHORT_MONTH,
    EXTRACT(YEAR FROM m.COHORT_MONTH)                       AS COHORT_YEAR,
    m.COUNTRY,
    m.CALENDAR_MONTH,
    EXTRACT(YEAR FROM m.CALENDAR_MONTH)                     AS CALENDAR_YEAR,
    DATEDIFF('MONTH', m.COHORT_MONTH, m.CALENDAR_MONTH)     AS MONTH_NUMBER,
    cs.COHORT_COUNTRY_SIZE,
    m.ACTIVE_MERCHANTS,
    m.ACTIVE_STORES,
    m.ACTIVE_EMPLOYEES,
    m.RECEIPT_COUNT,
    ROUND(m.TPV_USD_APPROX, 2)                              AS TPV_USD_APPROX,
    ROUND(m.TPV_USD_APPROX / NULLIF(m.ACTIVE_MERCHANTS, 0), 2) AS AVG_TPV_PER_MERCHANT_USD,
    ROUND(m.TPV_USD_APPROX / NULLIF(m.RECEIPT_COUNT, 0), 2)    AS AVG_TICKET_USD,
    ROUND(100.0 * m.ACTIVE_MERCHANTS / NULLIF(cs.COHORT_COUNTRY_SIZE, 0), 4) AS PCT_COHORT_ACTIVE
FROM metrics m
LEFT JOIN cohort_country_size cs
       ON cs.SNAPSHOT_DATE = m.SNAPSHOT_DATE
      AND cs.COHORT_MONTH  = m.COHORT_MONTH
      AND cs.COUNTRY       = m.COUNTRY
ORDER BY m.SNAPSHOT_DATE, m.CALENDAR_MONTH DESC, m.COHORT_MONTH ASC, m.COUNTRY ASC;
