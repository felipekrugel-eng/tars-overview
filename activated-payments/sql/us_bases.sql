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
    -- GLOBAL BOT/FAKE-ACCOUNT FILTER (added 2026-09-07)
    -- The us_bot_accounts block above is hard-scoped to COUNTRY = 'US'. That scope was set
    -- on the July 2026 finding that the campaign was US-only. It is no longer true: the
    -- Sep 5-7 2026 Vinted/Mercari wave hit NL/CH/AT/DK/CZ/NO/FI/SE and never touched the US,
    -- and a re-screen found unfiltered Poshmark clusters in GB (44 on 2026-05-31) and a
    -- disposable-mail cluster in LT (34 on 2026-03-21) that have been in the published
    -- numbers all along. These three signatures are country-agnostic.
    --
    -- G1 and G2 both require a machine-generated email mailbox as a SECOND factor. Email
    -- randomness on its own has a ~47% false-positive rate (July 2026 investigation) and
    -- must never be used alone -- but inside an already-suspicious set it is what separates
    -- a scripted wave from a real cohort. Two false positives it demonstrably prevents:
    --   * @loyverse.com accounts that are genuine merchants onboarded by staff, e.g. PH
    --     'Sabunan Point' (13,850 receipts over 148 days) and PH 'KUAN UA' (7,087 receipts).
    --   * PH 'EXPO2026', 31 same-name same-day signups on individual human gmail addresses
    --     minutes apart -- a real event cohort, not a burst.
    -- Every account these three rules add has ZERO receipts, all-time (verified 2026-09-07).
    --
    -- Keep this block IDENTICAL across every file that uses it.
    -- ----------------------------------------------------------------
    random_local AS (
        -- Machine-generated mailbox: 8-12 chars, alphanumeric only, containing BOTH letters
        -- and digits. Human addresses carry dots, plus-addressing, or are all letters.
        -- NOTE: Snowflake REGEXP_LIKE is implicitly anchored -- the '.*' wrappers are required.
        SELECT LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE EMAIL IS NOT NULL
          AND REGEXP_LIKE(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '^[a-z0-9]{8,12}$')
          AND REGEXP_LIKE(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '.*[0-9].*')
          AND REGEXP_LIKE(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '.*[a-z].*')
    ),
    global_bot_accounts AS (
        -- G1: signup on Loyverse's OWN email domain with a machine-generated mailbox.
        -- Verification mail for these goes nowhere real; staff accounts are left alone by
        -- the random_local test.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        WHERE SPLIT_PART(LOWER(TRIM(m.EMAIL)), '@', 2) = 'loyverse.com'
          AND m.CREATED_AT >= '2026-03-01'
          AND m.LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM random_local)
        UNION
        -- G2: scripted burst -- same normalised business name, same country, same calendar
        -- day, >= 20 accounts, prior all-time presence of that name in that country under a
        -- tenth of the burst (the S8 ratio test, generalised off the US), and >= 90% of the
        -- burst on machine-generated mailboxes.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        JOIN (
            SELECT C, NORM, D
            FROM (
                SELECT UPPER(TRIM(COUNTRY)) AS C,
                       TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM,
                       DATE(CREATED_AT) AS D,
                       COUNT(*) AS N,
                       COUNT_IF(LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM random_local)) AS N_RANDOM
                FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
                WHERE BUSINESS_NAME IS NOT NULL
                  AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
                  AND COUNTRY IS NOT NULL
                GROUP BY 1, 2, 3
            )
            QUALIFY N >= 20
                AND D >= '2026-03-01'
                AND N_RANDOM >= 0.90 * N
                AND COALESCE(SUM(N) OVER (PARTITION BY C, NORM ORDER BY D
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) < N / 10.0
        ) b
          ON UPPER(TRIM(m.COUNTRY)) = b.C
         AND TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = b.NORM
         AND DATE(m.CREATED_AT) = b.D
        UNION
        -- G3: marketplace-brand impersonation using the brand's OWN email domain. The
        -- business name is exactly the brand (optionally with a suffix) and the mailbox sits
        -- on that same brand's domain. No plausible merchant reads this way.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        WHERE m.BUSINESS_NAME IS NOT NULL
          AND m.CREATED_AT >= '2026-03-01'
          AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa'),
                  '(vinted|mercari|poshmark|depop|etsy)([[:space:]_#:.-].*)?')
          AND SPLIT_PART(LOWER(TRIM(m.EMAIL)), '@', 2) IN
                  ('vinted.com', 'mercari.com', 'poshmark.com', 'depop.com', 'etsy.com')
    ),
    bot_accounts AS (
        -- Single exclusion set consumed by the query below: the US-scoped signatures plus
        -- the country-agnostic ones. Every reference site uses this, not either half.
        SELECT LOYVERSE_ID FROM us_bot_accounts
        UNION
        SELECT LOYVERSE_ID FROM global_bot_accounts
    ),
-- ----------------------------------------------------------------
params AS (SELECT /*LAUNCH*/DATE '2026-07-01' AS LAUNCH),
-- Genuine merchants in the market being measured (bots removed) — the universe every base
-- is carved from. COUNTRY and LAUNCH are tokenised (2026-08-17, UK launch): pull.js
-- substitutes the market it is pulling, defaulting to US so this file still runs unchanged
-- on its own. The bot CTEs above are deliberately NOT tokenised. us_bot_accounts stays
-- hard-scoped to US because it describes one specific US registration-fraud campaign;
-- global_bot_accounts is country-agnostic by design and covers every other market. The
-- query below reads bot_accounts (the union), so it is correct whichever market is pulled.
us AS (
    SELECT m.LOYVERSE_ID, m.CREATED_AT
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
     WHERE UPPER(TRIM(m.COUNTRY)) = /*COUNTRY*/'US'
       AND m.LOYVERSE_ID IS NOT NULL
       AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM bot_accounts)   -- [bot-filter]
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
FROM tagged;   -- [bot-filter]
