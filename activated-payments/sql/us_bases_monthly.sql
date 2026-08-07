-- LOYVERSE PAYMENTS FUNNEL — US group bases AT EACH MONTH END (automation-safe)
-- Sources: LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS, LOYVERSE_RECEIPTS,
--          CHARGEBEE_SUBSCRIPTIONS_V
--
-- ADDED 2026-08-05 for the Funnel sub-tab's month filter. us_bases.sql answers "how big is
-- each group TODAY" and has no history, so picking a month on the Funnel page had nothing
-- correct to divide by. This file is the same four disjoint groups evaluated AS OF a series
-- of month ends, so a month's numerators can be put over that month's denominators.
--
-- Groups, priority order, identical to us_bases.sql — but every test is taken AS OF the
-- month's as-of date rather than today:
--     new       : registered on/after LAUNCH (and on/before the as-of date)
--     paying    : pre-launch AND a subscription live on the as-of date
--     nonpaying : pre-launch AND no live subscription AND >=1 receipt in the 30 days to as-of
--     dormant   : pre-launch AND no live subscription AND no receipt in those 30 days
-- The four are disjoint and sum to TOTAL_US for that month. ACTIVE_US / PAYING_US are again
-- reference-only and are NOT group bases.
--
-- AS-OF DATE. For every COMPLETE month it is the last calendar day. For the month in
-- progress it is CURRENT_DATE, so the newest row reads "August so far" and matches what the
-- Funnel page shows for the current month. IS_PARTIAL flags that row; the UI labels it.
--
-- BACKFILL IS EXACT FOR REGISTRATION AND POS, RECONSTRUCTED FOR SUBSCRIPTIONS.
--   * Registration is a fact with a date (CREATED_AT) — exact at any as-of.
--   * POS activity comes from daily LOYVERSE_RECEIPTS — the 30-day window simply ends at the
--     as-of date instead of today, so it is exact at any as-of.
--   * Paying status is RECONSTRUCTED. CHARGEBEE_SUBSCRIPTIONS_V.STATUS is current-state only,
--     so a past month uses ACTIVATED_AT <= as-of AND (CANCELLED_AT IS NULL OR CANCELLED_AT >
--     as-of). This is NOT byte-identical to us_bases.sql's LOWER(STATUS) = 'active': a
--     subscription that is paused or non-renewing but never cancelled counts as live here.
--     pull.js therefore compares the newest row against the live us_bases.sql figure on every
--     run and logs the gap — treat a widening gap as a signal that this reconstruction needs
--     revisiting, NOT as a data error in either query.
--
-- BOT FILTER IS APPLIED ALL-TIME, NOT AS OF THE MONTH. A registration confirmed as bot today
-- is excluded from July's base too, even though nobody knew in July. This is deliberate: the
-- alternative makes the base jump around as detection improves, and the July 2026 report
-- already treats the filter as all-time. Keep the block below SEMANTICALLY IDENTICAL to
-- us_bases.sql / us_group_tags.sql / cohort_country_snapshot.sql.
--
-- START MONTH. FIRST_MONTH below is the earliest month the Funnel page can offer, which is
-- bounded by the earliest stage timestamp in funnel-data.js (first prod connection, Apr 2026).
-- Widen it if the page ever needs earlier months; cost scales with months x receipts.
WITH -- ----------------------------------------------------------------
    -- US BOT/FAKE-ACCOUNT FILTER (added 2026-07-21)
    -- Excludes the US registration bot campaign quantified in the July 2026
    -- fraud investigation (Mem note 08de7ff9 / July_2026_US_bot_fraud_full_report.xlsx).
    -- Signature-based on BUSINESS_NAME, US rows only, applied ALL-TIME.
    -- Deliberately does NOT use email randomness (47% false-positive rate).
    -- Keep this block SEMANTICALLY IDENTICAL across all kpi-automation/sql files.
    -- LOCAL DIVERGENCE (this file, as in us_bases.sql): S7's pre-attack-name exclusion is
    -- written as a MINUS instead of the canonical correlated NOT EXISTS, because this
    -- statement references the CTE from multiple derived tables and Snowflake
    -- fails to compile the inlined correlated subquery here ("error line 76").
    -- Same rows are flagged; do NOT copy the NOT EXISTS form back into this file.
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
            -- attack-era clusters (>=3 same normalized name) ...
            SELECT NORM_NAME FROM (
                SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM_NAME
                FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
                WHERE UPPER(TRIM(COUNTRY)) = 'US'
                  AND BUSINESS_NAME IS NOT NULL
                  AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
                  AND CREATED_AT >= '2026-03-01'
                GROUP BY 1
                HAVING COUNT(*) >= 3
            )
            MINUS
            -- ... excluding names already established in the US pre-attack
            SELECT DISTINCT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa')
            FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
            WHERE UPPER(TRIM(COUNTRY)) = 'US'
              AND BUSINESS_NAME IS NOT NULL
              AND CREATED_AT < '2026-03-01'
        ) c
          ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
        WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
          AND m.LOYVERSE_ID IS NOT NULL
          AND m.CREATED_AT >= '2026-03-01'
    ),
-- ----------------------------------------------------------------
params AS (
    SELECT DATE '2026-07-01' AS LAUNCH,          -- must match us_bases.sql / us_group_tags.sql
           DATE '2026-04-01' AS FIRST_MONTH,     -- earliest month the Funnel page can offer
           30                AS POS_WINDOW_DAYS  -- must match us_bases.sql's trailing-30-day rule
),
-- One row per month from FIRST_MONTH to the month in progress. AS_OF is the last day of a
-- complete month, or today for the month in progress (so the newest row is "month so far").
months AS (
    SELECT m_start,
           LEAST(LAST_DAY(m_start), CURRENT_DATE())                       AS as_of,
           IFF(LAST_DAY(m_start) > CURRENT_DATE(), TRUE, FALSE)           AS is_partial
      FROM (
        SELECT DATEADD('month', SEQ4(), (SELECT FIRST_MONTH FROM params)) AS m_start
          FROM TABLE(GENERATOR(ROWCOUNT => 120))
      )
     WHERE m_start <= DATE_TRUNC('month', CURRENT_DATE())
),
-- Genuine US merchants (bots removed) — the universe every base is carved from.
-- CREATED_AT is a timestamp, so membership at an as-of DATE is "< the next day", not "<= the
-- date", or every merchant that registered on the as-of day itself would be dropped.
us AS (
    SELECT m.LOYVERSE_ID, m.CREATED_AT
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
     WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
       AND m.LOYVERSE_ID IS NOT NULL
       AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
),
-- POS-active in the 30 days ENDING AT EACH AS-OF (daily receipts — the canonical definition).
-- Semi-joined to `us` so the receipts scan is bounded to the population that can matter; the
-- result is identical to filtering afterwards, which is what us_bases.sql does.
active_ids AS (
    SELECT DISTINCT mo.m_start, r.MERCHANT_ID AS LOYVERSE_ID
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
      JOIN months mo
        ON TRY_TO_DATE(r.RECEIPT_DATE) >  DATEADD('day', -(SELECT POS_WINDOW_DAYS FROM params), mo.as_of)
       AND TRY_TO_DATE(r.RECEIPT_DATE) <= mo.as_of
     WHERE r.MERCHANT_ID IN (SELECT LOYVERSE_ID FROM us)
),
-- Subscriptions live at each as-of, reconstructed from ACTIVATED_AT / CANCELLED_AT because
-- STATUS is current-state only. See the header note on why this is not identical to
-- LOWER(STATUS) = 'active' and how pull.js watches the gap.
paying_ids AS (
    SELECT DISTINCT mo.m_start, s.LOYVERSE_MERCHANT_ID AS LOYVERSE_ID
      FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V s
      JOIN months mo
        ON s.ACTIVATED_AT < DATEADD('day', 1, mo.as_of)
       AND (s.CANCELLED_AT IS NULL OR s.CANCELLED_AT >= DATEADD('day', 1, mo.as_of))
     WHERE s.LOYVERSE_MERCHANT_ID IS NOT NULL
       AND s.ACTIVATED_AT IS NOT NULL
),
-- One row per (month, genuine US merchant that existed by that month's as-of), tagged with
-- its group and its raw flags. Same single-pass COUNT_IF shape as us_bases.sql — no scalar
-- SELECT-list subqueries, because the inlined us_bot_accounts CTE has failed to compile in
-- that position in this family of files before.
tagged AS (
    SELECT mo.m_start,
           mo.as_of,
           mo.is_partial,
           u.LOYVERSE_ID,
           IFF(a.LOYVERSE_ID IS NOT NULL, 1, 0) AS IS_ACTIVE,
           IFF(p.LOYVERSE_ID IS NOT NULL, 1, 0) AS IS_PAYING,
           CASE
             WHEN u.CREATED_AT >= (SELECT LAUNCH FROM params)             THEN 'new'
             WHEN p.LOYVERSE_ID IS NOT NULL                              THEN 'paying'
             WHEN a.LOYVERSE_ID IS NOT NULL                              THEN 'nonpaying'
             ELSE                                                             'dormant'
           END AS GRP
      FROM months mo
      JOIN us u
        ON u.CREATED_AT < DATEADD('day', 1, mo.as_of)
      LEFT JOIN paying_ids p ON p.LOYVERSE_ID = u.LOYVERSE_ID AND p.m_start = mo.m_start
      LEFT JOIN active_ids a ON a.LOYVERSE_ID = u.LOYVERSE_ID AND a.m_start = mo.m_start
)
SELECT
    TO_CHAR(m_start, 'YYYY-MM')  AS month,
    MAX(as_of)                   AS as_of,
    MAX(is_partial)              AS is_partial,
    -- group bases (disjoint; sum = TOTAL_US for that month)
    COUNT_IF(GRP = 'new')        AS new_us,
    COUNT_IF(GRP = 'paying')     AS paying_base_us,
    COUNT_IF(GRP = 'nonpaying')  AS nonpaying_us,
    COUNT_IF(GRP = 'dormant')    AS dormant_us,
    COUNT(*)                     AS total_us,
    -- reference counts (NOT group bases — see header)
    COUNT_IF(IS_ACTIVE = 1)      AS active_us,
    COUNT_IF(IS_PAYING = 1)      AS paying_us
FROM tagged   -- [US-bot-filter]
GROUP BY m_start
ORDER BY m_start;
