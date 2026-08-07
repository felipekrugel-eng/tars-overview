-- =================================================================
-- COHORT x COUNTRY SNAPSHOT — latest complete month
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- The country twin of cohort_unit_economics_daily_asof.sql. That query reconstructs
-- 49 daily snapshots but carries NO country dimension, so the Study & Trend "Cohorts"
-- widgets can only ever be shown all-countries. This one drops the 49-day spine (a
-- single as-of = today) and adds COUNTRY instead, which is what the country filter needs.
--
-- OUTPUT: one row per (COHORT_MONTH x COUNTRY x MONTH_START), covering
--   * the last N_COHORTS registration months  (the chart/table/triangle window)
--   * cohort ages M0 .. MAX_AGE
-- Rows with no paying activity are still emitted so REGISTRATIONS is complete.
--
-- COUNTRY ATTRIBUTION: merchants are deduped by email and an email can own accounts in
-- more than one country, so the merchant is attributed to the country of its FIRST-created
-- account — the same MIN(CREATED_AT) basis that already defines COHORT_MONTH. This is the
-- merchant's registration country, NOT the Chargebee billing country, so a per-country MRR
-- split here will not tie exactly to a finance-side billing-country split.
--
-- RECONCILIATION: summing every country for a given cohort reproduces the all-countries
-- figures from cohort_unit_economics_daily_asof.sql at the same as-of date, EXCEPT for
-- merchants whose LOYVERSE_MERCHANTS.COUNTRY is NULL — those land in the 'ZZ' bucket
-- rather than being dropped, so the sum stays whole.
--
-- COST: cheaper than its 49-snapshot sibling despite the extra dimension — adding COUNTRY
-- to the GROUP BY changes output cardinality, not the join work, and the heavy
-- spread x snapshot range join collapses to a single as-of comparison.
--
-- Active-merchant counts are NOT here: receipts_tpv_daily_asof.sql already returns
-- COHORT_MONTH x COUNTRY x ACTIVE_MERCHANTS and build_kpi_data.py just sums the country
-- dimension away. The build script joins the two.
-- =================================================================

WITH -- ----------------------------------------------------------------
    -- US BOT/FAKE-ACCOUNT FILTER (added 2026-07-21)
    -- Excludes the US registration bot campaign quantified in the July 2026
    -- fraud investigation (Mem note 08de7ff9 / July_2026_US_bot_fraud_full_report.xlsx).
    -- Signature-based on BUSINESS_NAME, US rows only, applied ALL-TIME.
    -- Deliberately does NOT use email randomness (47% false-positive rate).
    -- Keep this block IDENTICAL across all kpi-automation/sql files.
    us_bot_accounts AS (
        -- S1-S6: per-account business-name signatures
        SELECT LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE UPPER(TRIM(COUNTRY)) = 'US'
          AND LOYVERSE_ID IS NOT NULL
          AND BUSINESS_NAME IS NOT NULL
          AND (
               -- S1: transaction-ID business names (Order_/Sale#/... + hex id) - July flood
               REGEXP_LIKE(TRIM(BUSINESS_NAME),
                   '.*(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\-]+[0-9a-fx]{6,}.*', 'i')
               -- S2: marketplace-brand impersonation (leet-normalized) + lure keyword
            OR (    REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                        '.*(poshmark|posh|vinted|depop|etsy).*')
                AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                        '.*(sold|order|support|helper|security|verify|wallet|aml|compliance|team|info).*'))
               -- S2b: leet-evaded brand name (e.g. 'P0shmark', 'V1nted') = flag outright
            OR (    LOWER(TRIM(BUSINESS_NAME)) <> TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa')
                AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                        '.*(poshmark|vinted|depop|etsy).*'))
               -- S3: 'seller kyc' placeholder cluster
            OR TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') LIKE '%seller kyc%'
               -- S4: template persona names (WordWord##)
            OR REGEXP_LIKE(TRIM(BUSINESS_NAME), '[A-Z][a-z]{2,}[A-Z][a-z]{2,}[0-9]{1,3}')
               -- S5: zero-width character evasion
            OR REGEXP_LIKE(BUSINESS_NAME, '.*[\u200B\u200C\u200D\u2060\uFEFF].*')
               -- S6: Cyrillic homoglyphs in a US business name
            OR REGEXP_LIKE(BUSINESS_NAME, '.*[\u0400-\u04FF].*')
          )
        UNION
        -- S8: explosive name clusters (added 2026-08-07)
        -- S7 exempts any name that also existed in the US before the attack, on the reasoning
        -- that it is an organic duplicate. That protection was load-bearing in the wrong
        -- direction: 7 US "Poshmark" accounts dating from 2025-11 exempted the entire 787-account
        -- attack-era cluster, leaving 374 registrations on 2 July and 216 on 30 July in the
        -- published figures. S8 restores the catch for names whose attack-era cohort is both
        -- large (>= 20) and dwarfs any pre-attack presence (>= 10x), which is the shape of a
        -- scripted wave rather than a popular name. Genuinely long-standing duplicates are left
        -- alone by the ratio test: depop (85 attack-era vs 129 before), test (57 vs 906) and
        -- walmart (14 vs 132) are all untouched. Brand-agnostic on purpose, so the next wave
        -- does not need a new signature.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        JOIN (
            SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM_NAME
            FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
            WHERE UPPER(TRIM(COUNTRY)) = 'US'
              AND BUSINESS_NAME IS NOT NULL
              AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
            GROUP BY 1
            HAVING COUNT_IF(CREATED_AT >= '2026-03-01') >= 20
               AND COUNT_IF(CREATED_AT >= '2026-03-01') >= 10 * COUNT_IF(CREATED_AT < '2026-03-01')
        ) c8
          ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = c8.NORM_NAME
        WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
          AND m.LOYVERSE_ID IS NOT NULL
          AND m.CREATED_AT >= '2026-03-01'
        UNION
        -- S7: bulk clusters - same normalized name >= 3x among US signups in the
        -- attack era (>= 2026-03-01). Names already established in the US before
        -- the attack are treated as organic duplicates and NOT flagged.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        JOIN (
            SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM_NAME
            FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
            WHERE UPPER(TRIM(COUNTRY)) = 'US'
              AND BUSINESS_NAME IS NOT NULL
              AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
              AND CREATED_AT >= '2026-03-01'
            GROUP BY 1
            HAVING COUNT(*) >= 3
        ) c
          ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
        WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
          AND m.LOYVERSE_ID IS NOT NULL
          AND m.CREATED_AT >= '2026-03-01'
          AND NOT EXISTS (
              SELECT 1
              FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS p
              WHERE UPPER(TRIM(p.COUNTRY)) = 'US'
                AND p.BUSINESS_NAME IS NOT NULL
                AND p.CREATED_AT < '2026-03-01'
                AND TRANSLATE(LOWER(TRIM(p.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
          )
    ),
params AS (
    SELECT DATE_TRUNC('MONTH', CURRENT_DATE())::DATE AS THIS_MONTH,
           25 AS N_COHORTS,   -- cohort window: covers the 24 shown + the in-progress month
           24 AS MAX_AGE      -- cohort ages M0..M24, matching the comparison chart
),
merchants AS (
    SELECT
        LOWER(TRIM(m.EMAIL))                         AS EMAIL_KEY,
        MIN(m.CREATED_AT::DATE)                      AS FIRST_CREATED_DATE,
        MIN(DATE_TRUNC('MONTH', m.CREATED_AT)::DATE) AS COHORT_MONTH,
        -- country of the earliest-created account for this email; NULL -> 'ZZ' so that
        -- summing all countries still reconciles with the all-countries query.
        COALESCE(UPPER(TRIM(MIN_BY(m.COUNTRY, m.CREATED_AT))), 'ZZ') AS COUNTRY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
      AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
    GROUP BY LOWER(TRIM(m.EMAIL))
),
-- Cohort size per cohort x country, restricted to the recent cohort window
cohort_size AS (
    SELECT m.COHORT_MONTH, m.COUNTRY, COUNT(*) AS REGISTRATIONS
    FROM merchants m
    WHERE m.COHORT_MONTH > DATEADD('month', -(SELECT N_COHORTS FROM params),
                                   (SELECT THIS_MONTH FROM params))
      AND m.FIRST_CREATED_DATE <= CURRENT_DATE()
    GROUP BY m.COHORT_MONTH, m.COUNTRY
),
uk_lines AS (
    SELECT
        LOWER(TRIM(c.EMAIL))                                 AS EMAIL_KEY,
        TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE       AS PERIOD_START,
        TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE         AS PERIOD_END,
        li.value:amount::NUMBER / 100.0                      AS AMOUNT_RAW,
        i.CURRENCY_CODE                                      AS CURRENCY,
        TO_TIMESTAMP(i.PAID_AT)::DATE                        AS PAID_DATE,
        IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE
      AND i.PAID_AT IS NOT NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT
        LOWER(TRIM(c.EMAIL))                                 AS EMAIL_KEY,
        TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE       AS PERIOD_START,
        TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE         AS PERIOD_END,
        li.value:amount::NUMBER / 100.0                      AS AMOUNT_RAW,
        i.CURRENCY_CODE                                      AS CURRENCY,
        TO_TIMESTAMP(i.PAID_AT)::DATE                        AS PAID_DATE,
        IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE
      AND i.PAID_AT IS NOT NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
all_lines AS (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines),
lines_usd AS (
    -- Same fixed FX rates as cohort_unit_economics_daily_asof.sql — keep them in step.
    SELECT
        EMAIL_KEY, PERIOD_START, PERIOD_END, PAID_DATE, VOID_DATE,
        CASE CURRENCY
            WHEN 'USD' THEN AMOUNT_RAW
            WHEN 'GBP' THEN AMOUNT_RAW * 1.34
            WHEN 'EUR' THEN AMOUNT_RAW * 1.16
            ELSE AMOUNT_RAW
        END AS AMOUNT_USD,
        GREATEST(DATEDIFF('MONTH', PERIOD_START, PERIOD_END), 1) AS MONTHS_IN_PERIOD
    FROM all_lines
),
-- Spread each line item evenly across its billing period
spread AS (
    SELECT
        l.EMAIL_KEY,
        DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', l.PERIOD_START))::DATE AS MONTH_START,
        l.AMOUNT_USD / l.MONTHS_IN_PERIOD AS MONTHLY_AMOUNT_USD,
        l.PAID_DATE,
        l.VOID_DATE
    FROM lines_usd l,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < l.MONTHS_IN_PERIOD
),
-- Single as-of (today): paid by now, not voided. Replaces the 49-snapshot range join.
spread_live AS (
    SELECT EMAIL_KEY, MONTH_START, MONTHLY_AMOUNT_USD
    FROM spread
    WHERE PAID_DATE <= CURRENT_DATE()
      AND (VOID_DATE IS NULL OR VOID_DATE > CURRENT_DATE())
),
merchant_month_mrr AS (
    SELECT EMAIL_KEY, MONTH_START, SUM(MONTHLY_AMOUNT_USD) AS MRR_USD
    FROM spread_live
    GROUP BY EMAIL_KEY, MONTH_START
),
merchant_first_paid AS (
    SELECT EMAIL_KEY, MIN(MONTH_START) AS FIRST_PAID_MONTH
    FROM merchant_month_mrr
    WHERE MRR_USD > 0
    GROUP BY EMAIL_KEY
),
-- Paying merchants + MRR per cohort x country x month
paying_per_ccm AS (
    SELECT
        m.COHORT_MONTH,
        m.COUNTRY,
        mm.MONTH_START,
        COUNT(DISTINCT m.EMAIL_KEY) AS PAYING_CUSTOMERS,
        SUM(mm.MRR_USD)             AS MRR_USD
    FROM merchants m
    JOIN merchant_month_mrr mm ON mm.EMAIL_KEY = m.EMAIL_KEY
    WHERE mm.MRR_USD > 0
    GROUP BY m.COHORT_MONTH, m.COUNTRY, mm.MONTH_START
),
-- Grid: every cohort x country x month from the cohort month up to MAX_AGE / this month
cohort_month_grid AS (
    SELECT
        cs.COHORT_MONTH,
        cs.COUNTRY,
        cs.REGISTRATIONS,
        DATEADD('MONTH', g.SEQ, cs.COHORT_MONTH)::DATE AS MONTH_START,
        g.SEQ                                          AS MONTH_NUMBER
    FROM cohort_size cs,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 25))) g
    WHERE g.SEQ <= (SELECT MAX_AGE FROM params)
      AND DATEADD('MONTH', g.SEQ, cs.COHORT_MONTH)::DATE <= (SELECT THIS_MONTH FROM params)
),
cum_ever_paid AS (
    SELECT
        g.COHORT_MONTH,
        g.COUNTRY,
        g.MONTH_START,
        COUNT(DISTINCT m.EMAIL_KEY) AS CUM_PAYING_EVER
    FROM merchant_first_paid fp
    JOIN merchants m         ON m.EMAIL_KEY   = fp.EMAIL_KEY
    JOIN cohort_month_grid g ON g.COHORT_MONTH = m.COHORT_MONTH
                            AND g.COUNTRY      = m.COUNTRY
    WHERE fp.FIRST_PAID_MONTH <= g.MONTH_START
    GROUP BY g.COHORT_MONTH, g.COUNTRY, g.MONTH_START
)
SELECT
    CURRENT_DATE()                          AS SNAPSHOT_DATE,
    g.COHORT_MONTH,
    g.COUNTRY,
    g.REGISTRATIONS,
    g.MONTH_START,
    g.MONTH_NUMBER,
    COALESCE(p.PAYING_CUSTOMERS, 0)         AS PAYING_CUSTOMERS,
    COALESCE(cep.CUM_PAYING_EVER, 0)        AS CUM_PAYING_EVER,
    COALESCE(p.MRR_USD, 0)                  AS MRR_USD,
    ROUND(COALESCE(p.MRR_USD, 0) / NULLIF(p.PAYING_CUSTOMERS, 0), 2) AS ARPC_USD
FROM cohort_month_grid g
LEFT JOIN paying_per_ccm p
       ON p.COHORT_MONTH = g.COHORT_MONTH
      AND p.COUNTRY      = g.COUNTRY
      AND p.MONTH_START  = g.MONTH_START
LEFT JOIN cum_ever_paid cep
       ON cep.COHORT_MONTH = g.COHORT_MONTH
      AND cep.COUNTRY      = g.COUNTRY
      AND cep.MONTH_START  = g.MONTH_START;
