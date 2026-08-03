-- LOYVERSE PAYMENTS FUNNEL — group tag per merchant (automation-safe)
-- Companion to us_bases.sql. That query returns the four group SIZES; this one returns which
-- group each merchant in the payments book belongs to, using the IDENTICAL CASE ladder and the
-- identical definitions of "active" (>=1 receipt in the trailing 30 days) and "paying" (active
-- Chargebee subscription).
--
-- WHY THIS EXISTS: the Funnel page used to decide group membership from activation-data.js's
-- `pos_active` flag, which is derived from SALES_PER_ACCOUNT_MONTHLY (monthly granularity,
-- 90-day window) while the bases came from LOYVERSE_RECEIPTS (daily, 30-day window). Numerator
-- and denominator were therefore measuring different things. Tagging each merchant server-side
-- with the same rule that sizes the base makes every group ratio internally consistent.
--
-- Merchant id list is injected at runtime — NO hardcoded ids.
-- Merchants absent from the result (e.g. non-US, or bot-filtered) get no tag; the UI falls back.
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
    ),
-- ----------------------------------------------------------------
params AS (SELECT DATE '2026-07-01' AS LAUNCH),
us AS (
    SELECT m.LOYVERSE_ID, m.CREATED_AT
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
     WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
       AND m.LOYVERSE_ID IS NOT NULL
       AND m.LOYVERSE_ID IN (/*MERCHANT_IDS*/)
       AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
),
active_ids AS (
    SELECT DISTINCT r.MERCHANT_ID AS LOYVERSE_ID
      FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
     WHERE TRY_TO_DATE(r.RECEIPT_DATE) >= DATEADD('day', -30, CURRENT_DATE())
),
paying_ids AS (
    SELECT DISTINCT s.LOYVERSE_MERCHANT_ID AS LOYVERSE_ID
      FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V s
     WHERE LOWER(s.STATUS) = 'active'
)
SELECT
    u.LOYVERSE_ID                            AS merchant_id,
    CASE
      WHEN u.CREATED_AT >= (SELECT LAUNCH FROM params) THEN 'new'
      WHEN p.LOYVERSE_ID IS NOT NULL                  THEN 'paying'
      WHEN a.LOYVERSE_ID IS NOT NULL                  THEN 'nonpaying'
      ELSE                                                 'dormant'
    END                                      AS grp,
    IFF(a.LOYVERSE_ID IS NOT NULL, TRUE, FALSE) AS pos_active_30d,
    IFF(p.LOYVERSE_ID IS NOT NULL, TRUE, FALSE) AS has_active_sub
FROM us u
LEFT JOIN paying_ids p ON p.LOYVERSE_ID = u.LOYVERSE_ID
LEFT JOIN active_ids a ON a.LOYVERSE_ID = u.LOYVERSE_ID;   -- [US-bot-filter]
