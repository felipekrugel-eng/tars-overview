-- =================================================================
-- COUNTRY x MONTH REGISTRATIONS (+ CUMULATIVE) — DAILY "AS-OF" VERSION
-- READ-ONLY (single SELECT, no CREATE — works with DATA_VIEWER)
-- =================================================================
-- One row per (SNAPSHOT_DATE x COUNTRY x CALENDAR_MONTH), rebuilt for
-- each calendar day 2026-05-01 .. 2026-06-18.
--   - A merchant counts only if CREATED_AT <= SNAPSHOT_DATE
--   - Country lifecycle grid runs first-registration-month (as of the
--     snapshot) -> the snapshot's own month (replaces CURRENT_DATE())
-- No invoices involved, so there's no void/delete caveat here — this is
-- an exact reconstruction from merchant CREATED_AT.
-- TEST: set ROWCOUNT => 3 in "snapshots" first, then switch back to 49.
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
snapshots AS (
    SELECT DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 70))          -- TEST: set to 3 first
    WHERE DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE <= CURRENT_DATE()
),
-- Dedup by email x country; registration month = earliest account (OUTPUT-A convention).
merchants AS (
    SELECT LOWER(TRIM(m.EMAIL))                         AS EMAIL_KEY,
           UPPER(TRIM(m.COUNTRY))                       AS COUNTRY,
           MIN(DATE_TRUNC('MONTH', m.CREATED_AT)::DATE) AS REG_MONTH,
           MIN(m.CREATED_AT::DATE)                      AS FIRST_CREATED_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL
      AND m.CREATED_AT IS NOT NULL
      AND m.COUNTRY IS NOT NULL AND m.COUNTRY <> ''
      AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM bot_accounts)   -- [bot-filter]
    GROUP BY LOWER(TRIM(m.EMAIL)), UPPER(TRIM(m.COUNTRY))
),
-- Registrations per country x month, counting only merchants that existed by the snapshot day.
reg_per_month AS (
    SELECT s.SNAPSHOT_DATE, m.COUNTRY, m.REG_MONTH, COUNT(*) AS REGISTRATIONS
    FROM merchants m
    JOIN snapshots s ON m.FIRST_CREATED_DATE <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, m.COUNTRY, m.REG_MONTH
),
-- Each country's lifecycle span (per snapshot): first registration -> snapshot month.
country_span AS (
    SELECT SNAPSHOT_DATE,
           COUNTRY,
           MIN(REG_MONTH)                          AS FIRST_MONTH,
           DATE_TRUNC('MONTH', SNAPSHOT_DATE)::DATE AS LAST_MONTH   -- was CURRENT_DATE()
    FROM reg_per_month
    GROUP BY SNAPSHOT_DATE, COUNTRY
),
month_spine AS (
    SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 600))
),
-- Every (country x month) from that country's first registration onward, per snapshot.
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
    YEAR(g.CALENDAR_MONTH)                               AS CALENDAR_YEAR,
    DATEDIFF('MONTH',
             MIN(g.CALENDAR_MONTH) OVER (PARTITION BY g.SNAPSHOT_DATE, g.COUNTRY),
             g.CALENDAR_MONTH)                           AS MONTH_NUMBER,   -- 0 = country's first month
    COALESCE(r.REGISTRATIONS, 0)                         AS REGISTRATIONS,
    SUM(COALESCE(r.REGISTRATIONS, 0))
        OVER (PARTITION BY g.SNAPSHOT_DATE, g.COUNTRY ORDER BY g.CALENDAR_MONTH) AS CUM_REGISTRATIONS
FROM country_month_grid g
LEFT JOIN reg_per_month r
       ON r.SNAPSHOT_DATE = g.SNAPSHOT_DATE
      AND r.COUNTRY       = g.COUNTRY
      AND r.REG_MONTH     = g.CALENDAR_MONTH
ORDER BY g.SNAPSHOT_DATE, g.COUNTRY, g.CALENDAR_MONTH;
