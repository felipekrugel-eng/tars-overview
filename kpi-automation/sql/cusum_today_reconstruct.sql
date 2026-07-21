-- =================================================================
-- CUSUM today-line RECONSTRUCTION (one-shot, used on FILTER_VERSION bumps).
-- Returns today's filtered registrations per country x hour so the CUSUM can
-- rebuild today's cumulative line after the counting basis changes, instead
-- of zeroing it. READ-ONLY single SELECT (works with DATA_VIEWER).
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
                   '(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\-]+[0-9a-fx]{6,}.*', 'i')
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
first_reg AS (                                   -- one row per merchant (email-deduped) + country + first-seen time
    SELECT LOWER(TRIM(EMAIL))        AS email,
           MAX(UPPER(TRIM(COUNTRY))) AS country,
           MIN(CREATED_AT)           AS first_at
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL
      AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
    GROUP BY 1
)
-- Today's NEW registrations (filtered basis), broken down by country x hour of
-- CREATED_AT. Same TO_DATE(...) day convention as the daily as-of queries.
SELECT country                AS country,
       HOUR(first_at)         AS hr,
       COUNT(*)               AS regs
FROM first_reg
WHERE TO_DATE(first_at) = TO_DATE(CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP()))
GROUP BY 1, 2;
