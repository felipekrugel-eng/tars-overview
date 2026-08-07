-- LOYVERSE PAYMENTS FUNNEL — US group bases (automation-safe)
-- Sources: LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS, LOYVERSE_RECEIPTS,
--          CHARGEBEE_SUBSCRIPTIONS_V
--
-- REWRITTEN 2026-08-03. The previous version returned ACTIVE_US = "every genuine US
-- merchant with a receipt in the trailing 30 days", and the dashboard used that as the
-- denominator for the "Non paying" group — whose numerator counts only merchants that are
-- pre-launch AND non-paying AND active. Paying merchants (~1.3k) and post-launch
-- registrations were therefore inside the denominator but unreachable by the numerator, so
-- the non-paying conversion rate read several times worse than reality.
--
-- Each base below is now scoped to EXACTLY the population its numerator draws from, using
-- the same four mutually-exclusive groups the UI renders, in the same priority order:
--     new       : registered on/after the launch date
--     paying    : pre-launch AND an active Chargebee subscription
--     nonpaying : pre-launch AND no active subscription AND >=1 receipt in the last 30 days
--     dormant   : pre-launch AND no active subscription AND no receipt in the last 30 days
-- The four are disjoint and sum to TOTAL_US, so the group funnels can no longer drift apart
-- from their denominators. ACTIVE_US / PAYING_US are still emitted for reference and for
-- backwards compatibility, but they are NOT group bases:
--     ACTIVE_US = all genuine US merchants active in 30d (any plan, any registration date)
--     PAYING_US = all genuine US merchants with an active subscription (any registration date)
--
-- "Active" is defined identically on both sides of every ratio: >=1 LOYVERSE_RECEIPTS row in
-- the trailing 30 days. The dashboard numerator must use the same rule — do NOT pair these
-- bases with the monthly SALES_PER_ACCOUNT_MONTHLY 90-day 'pos_active' flag.
--
-- US bot/fraud accounts are excluded via the shared business-name signature filter.
WITH -- ----------------------------------------------------------------
    -- US BOT/FAKE-ACCOUNT FILTER (added 2026-07-21)
    -- Excludes the US registration bot campaign quantified in the July 2026
    -- fraud investigation (Mem note 08de7ff9 / July_2026_US_bot_fraud_full_report.xlsx).
    -- Signature-based on BUSINESS_NAME, US rows only, applied ALL-TIME.
    -- Deliberately does NOT use email randomness (47% false-positive rate).
    -- Keep this block SEMANTICALLY IDENTICAL across all kpi-automation/sql files.
    -- LOCAL DIVERGENCE (this file only): S7's pre-attack-name exclusion is written
    -- as a MINUS instead of the canonical correlated NOT EXISTS, because this
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
params AS (SELECT DATE '2026-07-01' AS LAUNCH),
-- Genuine US merchants (bots removed) — the universe every base is carved from
us AS (
    SELECT m.LOYVERSE_ID, m.CREATED_AT
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
     WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
       AND m.LOYVERSE_ID IS NOT NULL
       AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
),
-- POS-active in the trailing 30 days (daily receipts — the canonical definition)
active_ids AS (
    SELECT DISTINCT r.MERCHANT_ID AS LOYVERSE_ID
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
     WHERE TRY_TO_DATE(r.RECEIPT_DATE) >= DATEADD('day', -30, CURRENT_DATE())
),
-- Merchants with an active Chargebee subscription
paying_ids AS (
    SELECT DISTINCT s.LOYVERSE_MERCHANT_ID AS LOYVERSE_ID
      FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V s
     WHERE LOWER(s.STATUS) = 'active'
),
-- One row per genuine US merchant, tagged with its group AND its raw flags.
-- NOTE on structure: every count below comes from THIS single pass via COUNT_IF. The
-- reference counts are deliberately NOT written as scalar SELECT-list subqueries — the
-- us_bot_accounts CTE is inlined at each reference and Snowflake has failed to compile it
-- inside a scalar SELECT-list subquery in this file before (see the LOCAL DIVERGENCE note
-- above). One pass also means the group bases and the reference counts can never disagree.
tagged AS (
    SELECT u.LOYVERSE_ID,
           IFF(a.LOYVERSE_ID IS NOT NULL, 1, 0) AS IS_ACTIVE,
           IFF(p.LOYVERSE_ID IS NOT NULL, 1, 0) AS IS_PAYING,
           CASE
             WHEN u.CREATED_AT >= (SELECT LAUNCH FROM params)            THEN 'new'
             WHEN p.LOYVERSE_ID IS NOT NULL                             THEN 'paying'
             WHEN a.LOYVERSE_ID IS NOT NULL                             THEN 'nonpaying'
             ELSE                                                            'dormant'
           END AS GRP
      FROM us u
      LEFT JOIN paying_ids p ON p.LOYVERSE_ID = u.LOYVERSE_ID
      LEFT JOIN active_ids a ON a.LOYVERSE_ID = u.LOYVERSE_ID
)
SELECT
    -- group bases (disjoint; sum = TOTAL_US)
    COUNT_IF(GRP = 'new')       AS new_us,
    COUNT_IF(GRP = 'paying')    AS paying_base_us,
    COUNT_IF(GRP = 'nonpaying') AS nonpaying_us,
    COUNT_IF(GRP = 'dormant')   AS dormant_us,
    COUNT(*)                    AS total_us,
    -- reference counts (NOT group bases — see header)
    COUNT_IF(IS_ACTIVE = 1)     AS active_us,
    COUNT_IF(IS_PAYING = 1)     AS paying_us
FROM tagged;   -- [US-bot-filter]
