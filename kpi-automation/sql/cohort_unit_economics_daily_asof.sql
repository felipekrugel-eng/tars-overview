-- =================================================================
-- LOYVERSE COHORT UNIT ECONOMICS — DAILY "AS-OF" RECONSTRUCTION
-- READ-ONLY VERSION (single SELECT, no CREATE — works with DATA_VIEWER)
-- =================================================================
-- Produces your canonical cohort unit-economics result set as it
-- WOULD HAVE looked on each calendar day from 2026-05-01 to 2026-06-18.
-- One row per (SNAPSHOT_DATE x COHORT_MONTH x MONTH_START).
--
-- WHY THIS WORKS WITHOUT TIME TRAVEL:
--   Time Travel retention is 1 day, so the physical history of May /
--   early June is gone. But this query depends only on dates that live
--   INSIDE the data, so each day is rebuilt by gating source rows on
--   their own timestamps. A 49-day "spine" (SNAPSHOT_DATE) is threaded
--   through the CTEs:
--     - Merchants: counted only if CREATED_AT <= SNAPSHOT_DATE
--     - Invoices:  PAID_AT <= SNAPSHOT_DATE (paid by then) AND not yet
--                  voided as of then (VOIDED_AT > SNAPSHOT_DATE or NULL)
--     - Month grid bounded by SNAPSHOT_DATE's month
--
-- RESIDUAL CAVEAT:
--   Airbyte overwrites rows, so we can't know WHEN an invoice was hard
--   DELETED (no delete timestamp). A row deleted in Chargebee since then
--   is excluded from all snapshots (DELETED = FALSE). Voids and payments
--   ARE reconstructed exactly via VOIDED_AT / PAID_AT. Only hard-deleted
--   invoices are approximated — typically negligible.
--
-- PERFORMANCE NOTE:
--   The spread-line x 49-day join is the heavy step (an inequality/range
--   join). Run on a Medium+ warehouse. To test cheaply first, lower
--   ROWCOUNT in the "snapshots" CTE (e.g. 3) or narrow the date bounds.
--   OUTPUT TRIMMED (2026-06): emits only the 9 columns consumed downstream
--   (build_kpi_data.py + backfill_daily.py). The 8 window functions, the
--   plan/addon/UK/EU MRR splits, the PCT_*/BLENDED_ARPU scalars, and the final
--   ORDER BY were removed (all unused) — this drops the window sort/partition
--   pass and the output sort. The heavy spread x 49-snapshot join is unchanged,
--   so the emitted values are identical; this just stops computing/sorting waste.
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
snapshots AS (
    -- One row per calendar day, 2026-05-01 .. 2026-06-18 (49 days)
    SELECT DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 70))
    WHERE DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE <= CURRENT_DATE()
),
merchants AS (
    SELECT
        LOWER(TRIM(m.EMAIL))                         AS EMAIL_KEY,
        MIN(m.CREATED_AT::DATE)                      AS FIRST_CREATED_DATE,
        MIN(DATE_TRUNC('MONTH', m.CREATED_AT)::DATE) AS COHORT_MONTH
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
      AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
    GROUP BY LOWER(TRIM(m.EMAIL))
),
-- Cohort size per snapshot: merchants registered on/before that day
cohort_size AS (
    SELECT s.SNAPSHOT_DATE, m.COHORT_MONTH, COUNT(*) AS REGISTRATIONS
    FROM merchants m
    JOIN snapshots s ON m.FIRST_CREATED_DATE <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, m.COHORT_MONTH
),
uk_lines AS (
    SELECT
        LOWER(TRIM(c.EMAIL))                                 AS EMAIL_KEY,
        TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE       AS PERIOD_START,
        TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE         AS PERIOD_END,
        li.value:amount::NUMBER / 100.0                      AS AMOUNT_RAW,
        li.value:entity_type::STRING                         AS ENTITY_TYPE,
        i.CURRENCY_CODE                                      AS CURRENCY,
        'UK'                                                 AS REGION,
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
        li.value:entity_type::STRING                         AS ENTITY_TYPE,
        i.CURRENCY_CODE                                      AS CURRENCY,
        'EU'                                                 AS REGION,
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
    SELECT
        EMAIL_KEY, PERIOD_START, PERIOD_END, ENTITY_TYPE, REGION, PAID_DATE, VOID_DATE,
        CASE CURRENCY
            WHEN 'USD' THEN AMOUNT_RAW
            WHEN 'GBP' THEN AMOUNT_RAW * 1.34
            WHEN 'EUR' THEN AMOUNT_RAW * 1.16
            ELSE AMOUNT_RAW
        END AS AMOUNT_USD,
        GREATEST(DATEDIFF('MONTH', PERIOD_START, PERIOD_END), 1) AS MONTHS_IN_PERIOD
    FROM all_lines
),
-- Spread each line item evenly across its billing period (carry paid/void dates)
spread AS (
    SELECT
        l.EMAIL_KEY,
        DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', l.PERIOD_START))::DATE AS MONTH_START,
        l.AMOUNT_USD / l.MONTHS_IN_PERIOD AS MONTHLY_AMOUNT_USD,
        l.ENTITY_TYPE,
        l.REGION,
        l.PAID_DATE,
        l.VOID_DATE
    FROM lines_usd l,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < l.MONTHS_IN_PERIOD
),
-- Visible spread per snapshot: paid by that day, not yet voided
spread_asof AS (
    SELECT
        s.SNAPSHOT_DATE, sp.EMAIL_KEY, sp.MONTH_START,
        sp.MONTHLY_AMOUNT_USD, sp.ENTITY_TYPE, sp.REGION
    FROM spread sp
    JOIN snapshots s
      ON sp.PAID_DATE <= s.SNAPSHOT_DATE
     AND (sp.VOID_DATE IS NULL OR sp.VOID_DATE > s.SNAPSHOT_DATE)
),
merchant_month_mrr AS (
    -- Only total MRR_USD is consumed downstream; the plan/addon/UK/EU splits were
    -- never read by build_kpi_data.py or backfill_daily.py, so they're dropped here.
    -- (ENTITY_TYPE / REGION are now unreferenced and get pruned from spread_asof.)
    SELECT
        SNAPSHOT_DATE, EMAIL_KEY, MONTH_START,
        SUM(MONTHLY_AMOUNT_USD) AS MRR_USD
    FROM spread_asof
    GROUP BY SNAPSHOT_DATE, EMAIL_KEY, MONTH_START
),
-- Each merchant's first paying month, per snapshot
merchant_first_paid AS (
    SELECT SNAPSHOT_DATE, EMAIL_KEY, MIN(MONTH_START) AS FIRST_PAID_MONTH
    FROM merchant_month_mrr
    WHERE MRR_USD > 0
    GROUP BY SNAPSHOT_DATE, EMAIL_KEY
),
-- Paying merchants per snapshot x cohort x month
paying_per_cohort_month AS (
    SELECT
        mm.SNAPSHOT_DATE,
        m.COHORT_MONTH,
        mm.MONTH_START,
        COUNT(DISTINCT m.EMAIL_KEY)         AS PAYING_CUSTOMERS,
        SUM(mm.MRR_USD)                     AS MRR_USD
    FROM merchants m
    JOIN merchant_month_mrr mm ON mm.EMAIL_KEY = m.EMAIL_KEY
    WHERE mm.MRR_USD > 0
    GROUP BY mm.SNAPSHOT_DATE, m.COHORT_MONTH, mm.MONTH_START
),
-- Per-snapshot time bounds: earliest cohort -> snapshot month
bounds AS (
    SELECT
        SNAPSHOT_DATE,
        MIN(COHORT_MONTH)                       AS MIN_MONTH,
        DATE_TRUNC('MONTH', SNAPSHOT_DATE)::DATE AS MAX_MONTH
    FROM cohort_size
    GROUP BY SNAPSHOT_DATE
),
all_months AS (
    SELECT
        b.SNAPSHOT_DATE,
        DATEADD('MONTH', g.SEQ, b.MIN_MONTH)::DATE AS MONTH_START
    FROM bounds b,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 600))) g
    WHERE DATEADD('MONTH', g.SEQ, b.MIN_MONTH)::DATE <= b.MAX_MONTH
),
-- Full grid per snapshot: every cohort x every month from cohort onward
cohort_month_grid AS (
    SELECT
        cs.SNAPSHOT_DATE,
        cs.COHORT_MONTH,
        cs.REGISTRATIONS,
        am.MONTH_START,
        DATEDIFF('MONTH', cs.COHORT_MONTH, am.MONTH_START) AS MONTH_NUMBER
    FROM cohort_size cs
    JOIN all_months am ON am.SNAPSHOT_DATE = cs.SNAPSHOT_DATE
    WHERE am.MONTH_START >= cs.COHORT_MONTH
),
-- Cumulative distinct merchants who ever paid by month N, per snapshot
cum_ever_paid AS (
    SELECT
        g.SNAPSHOT_DATE,
        m.COHORT_MONTH,
        g.MONTH_START,
        COUNT(DISTINCT m.EMAIL_KEY) AS CUM_PAYING_EVER
    FROM merchant_first_paid fp
    JOIN merchants m         ON m.EMAIL_KEY = fp.EMAIL_KEY
    JOIN cohort_month_grid g ON g.SNAPSHOT_DATE = fp.SNAPSHOT_DATE
                            AND g.COHORT_MONTH  = m.COHORT_MONTH
    WHERE fp.FIRST_PAID_MONTH <= g.MONTH_START
    GROUP BY g.SNAPSHOT_DATE, m.COHORT_MONTH, g.MONTH_START
)
-- Only the 9 columns consumed by build_kpi_data.py + backfill_daily.py are emitted.
-- The former window functions (CUM_REVENUE / LTV_* / PEAK_* / PCT_RETAINED_*), the
-- plan/addon/UK/EU MRR splits, and the PCT_*/BLENDED_ARPU scalars were never read
-- downstream, so they're dropped — that removes the whole window sort/partition pass.
-- The final global ORDER BY is also removed (the pandas consumers re-group/sort);
-- the 9 emitted columns are value-identical to before, just unsorted.
SELECT
    g.SNAPSHOT_DATE,
    g.COHORT_MONTH,
    g.REGISTRATIONS,
    g.MONTH_START,
    g.MONTH_NUMBER,
    COALESCE(p.PAYING_CUSTOMERS, 0)         AS PAYING_CUSTOMERS,
    COALESCE(cep.CUM_PAYING_EVER, 0)        AS CUM_PAYING_EVER,
    COALESCE(p.MRR_USD,       0)            AS MRR_USD,
    ROUND(COALESCE(p.MRR_USD, 0) / NULLIF(p.PAYING_CUSTOMERS, 0), 2)     AS ARPC_USD
FROM cohort_month_grid g
LEFT JOIN paying_per_cohort_month p
       ON p.SNAPSHOT_DATE = g.SNAPSHOT_DATE
      AND p.COHORT_MONTH  = g.COHORT_MONTH
      AND p.MONTH_START   = g.MONTH_START
LEFT JOIN cum_ever_paid cep
       ON cep.SNAPSHOT_DATE = g.SNAPSHOT_DATE
      AND cep.COHORT_MONTH  = g.COHORT_MONTH
      AND cep.MONTH_START   = g.MONTH_START;


-- =================================================================
-- TIP — cheap test run first:
--   Change   ROWCOUNT => 49   in the "snapshots" CTE to   ROWCOUNT => 3
--   to compute just May 1-3, confirm it runs and looks right, then
--   put it back to 49 for the full month range.
--
-- VALIDATION — compare one day to your live query:
--   Add  WHERE g.SNAPSHOT_DATE = CURRENT_DATE()  is not needed; instead
--   just filter the snapshots CTE to a single day, or run your original
--   query and compare the 2026-06-18 slice. Small diffs are expected:
--   this version defines "paid" by PAID_AT (point-in-time) rather than the
--   current STATUS = 'paid' flag, which is the more correct as-of basis.
-- =================================================================
