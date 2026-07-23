-- LOYVERSE PAYMENTS FUNNEL — US base counts for the group funnels (automation-safe)
-- Sources: LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS, LOYVERSE_RECEIPTS,
--          CHARGEBEE_SUBSCRIPTIONS_V
--
-- One row, three columns:
--   ACTIVE_US  : distinct genuine US merchants with >=1 receipt in the trailing 30 days
--   PAYING_US  : distinct genuine US merchants with an active Chargebee subscription
--   DORMANT_US : distinct genuine US merchants registered BEFORE the payments launch
--                (2026-07-01) that are neither active (no receipt in 30d) nor paying —
--                the "existing dormant / other" group base
-- These are the funnel BASES for the group funnels on the dashboard's Funnel page
-- (window.__FUNNEL_BASES). Refreshed every morning.
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
    )
-- NOTE on structure: the three counts are computed as FROM-clause derived tables
-- CROSS JOINed together, NOT as scalar SELECT-list subqueries. Snowflake inlines
-- the us_bot_accounts CTE at each reference, and its S7 branch contains a
-- correlated NOT EXISTS — which Snowflake cannot compile once inlined inside a
-- scalar SELECT-list subquery ("error line 70"). Derived tables compile fine.
SELECT a.active_us, p.paying_us, d.dormant_us
FROM (
    SELECT COUNT(DISTINCT m.LOYVERSE_ID) AS active_us
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
      JOIN LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
        ON r.LOYVERSE_ID = m.LOYVERSE_ID
     WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
       AND m.LOYVERSE_ID IS NOT NULL
       AND TRY_TO_DATE(r.RECEIPT_DATE) >= DATEADD('day', -30, CURRENT_DATE())
       AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)
) a
CROSS JOIN (
    SELECT COUNT(DISTINCT s.LOYVERSE_MERCHANT_ID) AS paying_us
      FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V s
      JOIN LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        ON m.LOYVERSE_ID = s.LOYVERSE_MERCHANT_ID
     WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
       AND LOWER(s.STATUS) = 'active'
       AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)
) p
CROSS JOIN (
    SELECT COUNT(*) AS dormant_us FROM (
        SELECT m.LOYVERSE_ID
          FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
         WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
           AND m.LOYVERSE_ID IS NOT NULL
           AND m.CREATED_AT < '2026-07-01'
           AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)
        MINUS
        -- POS-active in the trailing 30 days
        SELECT r.LOYVERSE_ID
          FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
         WHERE TRY_TO_DATE(r.RECEIPT_DATE) >= DATEADD('day', -30, CURRENT_DATE())
        MINUS
        -- active Chargebee subscription
        SELECT s.LOYVERSE_MERCHANT_ID
          FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V s
         WHERE LOWER(s.STATUS) = 'active'
    )
) d;   -- [US-bot-filter]
