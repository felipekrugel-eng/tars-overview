-- =================================================================
-- MRR — BOTTOM-UP, CURRENT-STATE, per COUNTRY x CALENDAR MONTH
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- This is the aggregate roll-up of merchant_mrr_ledger.sql and is intended to
-- REPLACE the as-of-snapshot MRR as the dashboard's source of truth.
--   - amortized: each Chargebee plan+addon line item spread evenly across its
--     billing period (annual plan = 1/12 per month), USD-normalized
--     (GBP x1.34, EUR x1.16)
--   - CURRENT state of all invoices (no as-of spine): excludes hard-deleted and
--     currently voided/refunded invoices (VOID_DATE IS NULL) -> the complete,
--     latest-known figure (this is why it runs ~1-3% above the old as-of number
--     for closed months: it includes payments that landed after the snapshot).
-- Output is small (per country x month), safe to run daily in the pipeline.
--   PAYING_MERCHANTS = distinct merchants contributing MRR that month
--   MRR_USD          = SUM of their amortized monthly amounts  ("therefore the MRR")
--   ARPC_USD         = MRR_USD / PAYING_MERCHANTS
-- Global monthly MRR = SUM(MRR_USD) over countries for that month.
-- NOTE: includes forward months (annual plans amortized ahead); the build step
--       should cap at the current calendar month for display.
-- =================================================================

WITH merchants_raw AS (
    SELECT LOWER(TRIM(m.EMAIL))    AS EMAIL_KEY,
           UPPER(TRIM(m.COUNTRY))  AS COUNTRY,
           m.CREATED_AT            AS CREATED_AT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
),
merchant_country AS (
    SELECT EMAIL_KEY, COUNTRY FROM (
        SELECT EMAIL_KEY, COUNTRY,
               ROW_NUMBER() OVER (PARTITION BY EMAIL_KEY ORDER BY CREATED_AT ASC) AS RN
        FROM merchants_raw
    ) WHERE RN = 1
),
uk_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                                       AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE            AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE              AS PERIOD_END,
           li.value:amount::NUMBER / 100.0                           AS AMOUNT_RAW,
           i.CURRENCY_CODE                                           AS CURRENCY,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                                       AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE            AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE              AS PERIOD_END,
           li.value:amount::NUMBER / 100.0                           AS AMOUNT_RAW,
           i.CURRENCY_CODE                                           AS CURRENCY,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
all_lines AS (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines),
lines_usd AS (
    SELECT EMAIL_KEY, PERIOD_START,
           CASE CURRENCY
               WHEN 'USD' THEN AMOUNT_RAW
               WHEN 'GBP' THEN AMOUNT_RAW * 1.34
               WHEN 'EUR' THEN AMOUNT_RAW * 1.16
               ELSE AMOUNT_RAW
           END AS AMOUNT_USD,
           GREATEST(DATEDIFF('MONTH', PERIOD_START, PERIOD_END), 1) AS MONTHS_IN_PERIOD
    FROM all_lines
    WHERE VOID_DATE IS NULL
),
spread AS (
    SELECT l.EMAIL_KEY,
           DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', l.PERIOD_START))::DATE AS MONTH_START,
           l.AMOUNT_USD / l.MONTHS_IN_PERIOD AS MONTHLY_AMOUNT_USD
    FROM lines_usd l,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < l.MONTHS_IN_PERIOD
),
merchant_month AS (
    SELECT EMAIL_KEY, MONTH_START, SUM(MONTHLY_AMOUNT_USD) AS MRR_USD
    FROM spread
    GROUP BY EMAIL_KEY, MONTH_START
    HAVING SUM(MONTHLY_AMOUNT_USD) > 0
)
SELECT
    COALESCE(mc.COUNTRY, 'XX')                          AS COUNTRY,
    mm.MONTH_START                                      AS MONTH,
    COUNT(DISTINCT mm.EMAIL_KEY)                        AS PAYING_MERCHANTS,
    ROUND(SUM(mm.MRR_USD), 2)                           AS MRR_USD,
    ROUND(SUM(mm.MRR_USD) / NULLIF(COUNT(DISTINCT mm.EMAIL_KEY),0), 2) AS ARPC_USD
FROM merchant_month mm
LEFT JOIN merchant_country mc ON mc.EMAIL_KEY = mm.EMAIL_KEY
GROUP BY COALESCE(mc.COUNTRY, 'XX'), mm.MONTH_START
ORDER BY mm.MONTH_START, MRR_USD DESC;
