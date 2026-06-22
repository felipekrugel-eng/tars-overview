-- =================================================================
-- COUNTRY x MONTH MRR / ACTIVE PAYERS — DAILY "AS-OF" VERSION
-- READ-ONLY (single SELECT, no CREATE — works with DATA_VIEWER)
-- =================================================================
-- One row per (SNAPSHOT_DATE x COUNTRY x CALENDAR_MONTH), rebuilt for
-- each calendar day 2026-05-01 .. 2026-06-18.
--   - Country per merchant: earliest account wins (stable across days)
--   - Invoices visible only if PAID_AT <= SNAPSHOT_DATE and not yet
--     voided as of then (plan + addon line items, same as original)
--   - Country lifecycle grid runs first-registration-month (as of the
--     snapshot) -> the snapshot's own month (replaces CURRENT_DATE())
-- Caveat: hard-deleted invoices can't be time-placed; excluded from all
--   snapshots. Voids/payments reconstructed exactly via VOIDED_AT/PAID_AT.
-- TEST: set ROWCOUNT => 3 in "snapshots" first, then switch back to 49.
-- =================================================================

WITH snapshots AS (
    SELECT DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 70))          -- TEST: set to 3 first
    WHERE DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE <= CURRENT_DATE()
),
merchants_raw AS (
    SELECT LOWER(TRIM(m.EMAIL))                      AS EMAIL_KEY,
           UPPER(TRIM(m.COUNTRY))                    AS COUNTRY,
           m.CREATED_AT                              AS CREATED_AT,
           m.CREATED_AT::DATE                        AS CREATED_DATE,
           DATE_TRUNC('MONTH', m.CREATED_AT)::DATE   AS COHORT_MONTH
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
      AND m.COUNTRY IS NOT NULL AND m.COUNTRY <> ''
),
-- One country per merchant (earliest account wins) -> avoids double-counting payers.
merchant_country AS (
    SELECT EMAIL_KEY, COUNTRY
    FROM (
        SELECT EMAIL_KEY, COUNTRY,
               ROW_NUMBER() OVER (PARTITION BY EMAIL_KEY ORDER BY CREATED_AT ASC) AS RN
        FROM merchants_raw
    )
    WHERE RN = 1
),
-- First registration month per country, as of each snapshot day.
reg_per_country AS (
    SELECT s.SNAPSHOT_DATE, mr.COUNTRY, MIN(mr.COHORT_MONTH) AS FIRST_MONTH
    FROM merchants_raw mr
    JOIN snapshots s ON mr.CREATED_DATE <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, mr.COUNTRY
),
-- ===== MRR: canonical Chargebee line-item logic (carry paid/void dates) =====
uk_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                           AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS PERIOD_END,
           li.value:amount::NUMBER / 100.0               AS AMOUNT_RAW,
           i.CURRENCY_CODE                                AS CURRENCY,
           TO_TIMESTAMP(i.PAID_AT)::DATE                  AS PAID_DATE,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                           AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS PERIOD_END,
           li.value:amount::NUMBER / 100.0               AS AMOUNT_RAW,
           i.CURRENCY_CODE                                AS CURRENCY,
           TO_TIMESTAMP(i.PAID_AT)::DATE                  AS PAID_DATE,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
all_lines AS (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines),
lines_usd AS (
    SELECT EMAIL_KEY, PERIOD_START, PERIOD_END, PAID_DATE, VOID_DATE,
           CASE CURRENCY
               WHEN 'USD' THEN AMOUNT_RAW
               WHEN 'GBP' THEN AMOUNT_RAW * 1.34
               WHEN 'EUR' THEN AMOUNT_RAW * 1.16
               ELSE AMOUNT_RAW
           END AS AMOUNT_USD,
           GREATEST(DATEDIFF('MONTH', PERIOD_START, PERIOD_END), 1) AS MONTHS_IN_PERIOD
    FROM all_lines
),
spread AS (
    SELECT l.EMAIL_KEY,
           DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', l.PERIOD_START))::DATE AS MONTH_START,
           l.AMOUNT_USD / l.MONTHS_IN_PERIOD AS MONTHLY_AMOUNT_USD,
           l.PAID_DATE,
           l.VOID_DATE
    FROM lines_usd l,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < l.MONTHS_IN_PERIOD
),
-- Spread rows visible per snapshot
spread_asof AS (
    SELECT s.SNAPSHOT_DATE, sp.EMAIL_KEY, sp.MONTH_START, sp.MONTHLY_AMOUNT_USD
    FROM spread sp
    JOIN snapshots s
      ON sp.PAID_DATE <= s.SNAPSHOT_DATE
     AND (sp.VOID_DATE IS NULL OR sp.VOID_DATE > s.SNAPSHOT_DATE)
),
merchant_month_mrr AS (
    SELECT SNAPSHOT_DATE, EMAIL_KEY, MONTH_START, SUM(MONTHLY_AMOUNT_USD) AS MRR_USD
    FROM spread_asof
    GROUP BY SNAPSHOT_DATE, EMAIL_KEY, MONTH_START
),
-- Active paying customers per country per month, per snapshot.
active_per_country_month AS (
    SELECT mm.SNAPSHOT_DATE,
           mc.COUNTRY,
           mm.MONTH_START,
           COUNT(DISTINCT mm.EMAIL_KEY) AS ACTIVE_PAYING_CUSTOMERS,
           SUM(mm.MRR_USD)              AS MRR_USD
    FROM merchant_month_mrr mm
    JOIN merchant_country mc ON mc.EMAIL_KEY = mm.EMAIL_KEY
    WHERE mm.MRR_USD > 0
    GROUP BY mm.SNAPSHOT_DATE, mc.COUNTRY, mm.MONTH_START
),
-- Lifecycle grid: country x month from its first registration -> snapshot month.
country_span AS (
    SELECT SNAPSHOT_DATE,
           COUNTRY,
           FIRST_MONTH,
           DATE_TRUNC('MONTH', SNAPSHOT_DATE)::DATE AS LAST_MONTH   -- was CURRENT_DATE()
    FROM reg_per_country
),
month_spine AS (
    SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 600))
),
country_month_grid AS (
    SELECT cs.SNAPSHOT_DATE,
           cs.COUNTRY,
           DATEADD('MONTH', s.SEQ, cs.FIRST_MONTH)::DATE AS CALENDAR_MONTH
    FROM country_span cs
    CROSS JOIN month_spine s
    WHERE DATEADD('MONTH', s.SEQ, cs.FIRST_MONTH)::DATE <= cs.LAST_MONTH
)
SELECT
    g.SNAPSHOT_DATE,
    g.COUNTRY,
    g.CALENDAR_MONTH,
    YEAR(g.CALENDAR_MONTH)                              AS CALENDAR_YEAR,
    DATEDIFF('MONTH',
             MIN(g.CALENDAR_MONTH) OVER (PARTITION BY g.SNAPSHOT_DATE, g.COUNTRY),
             g.CALENDAR_MONTH)                          AS MONTH_NUMBER,
    COALESCE(a.ACTIVE_PAYING_CUSTOMERS, 0)              AS ACTIVE_PAYING_CUSTOMERS,
    ROUND(COALESCE(a.MRR_USD, 0), 2)                    AS MRR_USD,
    ROUND(COALESCE(a.MRR_USD, 0)
          / NULLIF(a.ACTIVE_PAYING_CUSTOMERS, 0), 2)    AS ARPC_USD
FROM country_month_grid g
LEFT JOIN active_per_country_month a
       ON a.SNAPSHOT_DATE = g.SNAPSHOT_DATE
      AND a.COUNTRY       = g.COUNTRY
      AND a.MONTH_START   = g.CALENDAR_MONTH
ORDER BY g.SNAPSHOT_DATE, g.COUNTRY, g.CALENDAR_MONTH;
