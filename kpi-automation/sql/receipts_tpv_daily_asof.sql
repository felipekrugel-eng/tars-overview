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
      AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
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
-- ONE hash-aggregation pass, TWO grains at once (no window sorts):
--   GID = GROUPING_ID(VIS_DATE, MERCHANT_ID)
--     1 -> per (bucket, VIS_DATE)   : daily receipts + TPV
--     2 -> per (bucket, MERCHANT_ID): merchant's first day = MIN(VIS_DATE)
-- The STORE_ID / EMPLOYEE_ID grains (ACTIVE_STORES / ACTIVE_EMPLOYEES) were
-- removed: nothing downstream (run.py, build_kpi_data.py, backfill_daily.py)
-- consumes them, yet they DOUBLED this GROUPING SETS pass — which the live
-- query profile showed was 72.6% of total runtime. Halving the grains is the
-- single biggest win, with zero change to any dashboard number.
agg AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        MERCHANT_ID,
        GROUPING_ID(VIS_DATE, MERCHANT_ID) AS GID,
        MIN(VIS_DATE)   AS DAY,        -- = VIS_DATE for set 1; first-appearance for merchant set
        COUNT(*)        AS CNT,
        SUM(AMOUNT_USD) AS AMT
    FROM flagged
    GROUP BY GROUPING SETS (
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, VIS_DATE),
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, MERCHANT_ID)
    )
),
-- Normalize every grain to one event stream, clamping pre-window days to May 1.
events AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        CASE WHEN DAY < DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) THEN DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) ELSE DAY END AS EFF_DAY,
        CASE WHEN GID = 1 THEN CNT ELSE 0 END                            AS INCR_RECEIPTS,
        CASE WHEN GID = 1 THEN AMT ELSE 0 END                            AS INCR_TPV_USD,
        CASE WHEN GID = 2 AND MERCHANT_ID IS NOT NULL THEN 1 ELSE 0 END  AS NEW_MERCHANTS
    FROM agg
),
-- Collapse the per-ENTITY event stream down to per-bucket DAILY increments
-- BEFORE fanning out across snapshots. THIS IS THE TIMEOUT FIX: previously the
-- snapshot range-join saw one row per (bucket, merchant) + (bucket, store) +
-- (bucket, employee) and multiplied each by up to ~54 snapshot dates — hundreds
-- of millions of intermediate rows. Now it sees only (bucket, EFF_DAY) rows
-- (≤ ~54 days per bucket), so the fan-out shrinks by orders of magnitude.
-- SUM is associative, so the result is byte-identical to the old query.
daily_incr AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH, EFF_DAY,
        SUM(INCR_RECEIPTS) AS D_RECEIPTS,
        SUM(INCR_TPV_USD)  AS D_TPV_USD,
        SUM(NEW_MERCHANTS) AS D_MERCHANTS
    FROM events
    GROUP BY COHORT_MONTH, COUNTRY, CALENDAR_MONTH, EFF_DAY
),
-- Cumulative (exact) state per bucket per snapshot.
-- PRUNED FAN-OUT: nothing downstream consumes the full historical triangle for
-- every snapshot. run.py only reads (a) the LATEST snapshot's full grid
-- [receipts.csv + "TPV and Receipts DB2"] and (b) for EVERY snapshot, only the
-- rows whose CALENDAR_MONTH is the snapshot's own month [the "49 days 1"
-- current-month slice]. Every other (snapshot, bucket) pair is computed,
-- transferred, then discarded. We therefore keep ONLY those two slices in the
-- snapshot join condition. This prunes the range-join fan-out (the slow step)
-- by ~an order of magnitude. The cumulative SUM for each SURVIVING (snapshot,
-- bucket) pair is unchanged — all of that bucket's daily increments with
-- EFF_DAY <= SNAPSHOT_DATE still contribute — so output is byte-identical to
-- what downstream would have used.
metrics AS (
    SELECT
        s.SNAPSHOT_DATE,
        d.COHORT_MONTH, d.COUNTRY, d.CALENDAR_MONTH,
        SUM(d.D_RECEIPTS)  AS RECEIPT_COUNT,
        SUM(d.D_TPV_USD)   AS TPV_USD_APPROX,
        SUM(d.D_MERCHANTS) AS ACTIVE_MERCHANTS
    FROM daily_incr d
    JOIN snapshots s
      ON d.EFF_DAY <= s.SNAPSHOT_DATE
     AND (
            s.SNAPSHOT_DATE = (SELECT MAX(SNAPSHOT_DATE) FROM snapshots)
         OR DATE_TRUNC('MONTH', d.CALENDAR_MONTH) = DATE_TRUNC('MONTH', s.SNAPSHOT_DATE)
         )
    GROUP BY s.SNAPSHOT_DATE, d.COHORT_MONTH, d.COUNTRY, d.CALENDAR_MONTH
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
    AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
    )
    GROUP BY EMAIL_KEY, COUNTRY, COHORT_MONTH
),
-- Same collapse for cohort sizing. Each EMAIL_KEY is already unique per
-- (cohort, country) in merchant_country_meta, so the old COUNT(DISTINCT) over a
-- 54x snapshot fan-out is equivalent to a cumulative SUM of per-day new-merchant
-- counts. Pre-aggregate to (cohort, country, NEW_DATE) first, then fan out.
cohort_country_new AS (
    SELECT COHORT_MONTH, COUNTRY,
           FIRST_CREATED_DATE AS NEW_DATE,
           COUNT(*)           AS NEW_MERCHANTS
    FROM merchant_country_meta
    GROUP BY COHORT_MONTH, COUNTRY, FIRST_CREATED_DATE
),
cohort_country_size AS (
    SELECT s.SNAPSHOT_DATE, n.COHORT_MONTH, n.COUNTRY,
           SUM(n.NEW_MERCHANTS) AS COHORT_COUNTRY_SIZE
    FROM cohort_country_new n
    JOIN snapshots s ON n.NEW_DATE <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, n.COHORT_MONTH, n.COUNTRY
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
    m.RECEIPT_COUNT,
    ROUND(m.TPV_USD_APPROX, 2)                              AS TPV_USD_APPROX,
    ROUND(m.TPV_USD_APPROX / NULLIF(m.ACTIVE_MERCHANTS, 0), 2) AS AVG_TPV_PER_MERCHANT_USD,
    ROUND(m.TPV_USD_APPROX / NULLIF(m.RECEIPT_COUNT, 0), 2)    AS AVG_TICKET_USD,
    ROUND(100.0 * m.ACTIVE_MERCHANTS / NULLIF(cs.COHORT_COUNTRY_SIZE, 0), 4) AS PCT_COHORT_ACTIVE
FROM metrics m
LEFT JOIN cohort_country_size cs
       ON cs.SNAPSHOT_DATE = m.SNAPSHOT_DATE
      AND cs.COHORT_MONTH  = m.COHORT_MONTH
      AND cs.COUNTRY       = m.COUNTRY;
-- NOTE: the final ORDER BY was removed on purpose. Nothing downstream relies on
-- row order — run.py writes the result straight to CSV and build_kpi_data.py /
-- backfill_daily.py both groupby + sort in pandas. Sorting the full historical
-- grid (all ~130 calendar months x 54 snapshots) was a heavy, needless final
-- step that dominated the back half of the run.
