-- ================================================================
-- Rolling 30-day KPI series BY COUNTRY — one row per (day, country), 49 days
-- ending YESTERDAY. Per-country twin of rolling_30d_active_paying_49days.sql.
-- Output: SNAPSHOT_DATE, COUNTRY, REG_30D, ACTIVE_30D, PAYING_ACTIVE
--
-- Feeds the FACADASH country filter so the "Rolling 30 days" toggle works for a
-- single country (previously global-only: the per-country daily rows carried MTD
-- figures only, so the chart had no points to draw).
--
-- COUNTRY grain: one country per merchant EMAIL (earliest account wins, see
-- merchant_country). Deduping on email — not LOYVERSE_ID — is what keeps the
-- per-country counts additive: a multi-account merchant is counted once, in one
-- country, so SUM(country) reconciles with the global query.
--
-- Cost note: country is a GROUP BY dimension, not a parameter — the same source
-- rows are scanned once, so this is NOT 248x the global query. Result grows from
-- 49 rows to ~49 x 200.
--
-- KNOWN GAP (pre-existing, matches country_month_mrr_daily_asof.sql): Chargebee
-- emails with no LOYVERSE_MERCHANTS row have no country and drop out, so
-- per-country PAYING_ACTIVE sums slightly below the global figure.
--
-- The us_bot_accounts block below is spliced verbatim from the global query —
-- keep it IDENTICAL across all kpi-automation/sql files.
-- ================================================================
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
spine AS (                                   -- 49 days, ending yesterday (CURRENT_DATE-1)
    SELECT DATEADD('day', SEQ4(), DATEADD('day', -49, CURRENT_DATE()))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 49))
),
merchant_country AS (                        -- one country per merchant email (earliest account wins)
    SELECT EMAIL_KEY, COUNTRY
    FROM (
        SELECT LOWER(TRIM(EMAIL))   AS EMAIL_KEY,
               UPPER(TRIM(COUNTRY)) AS COUNTRY,
               ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(EMAIL))
                                  ORDER BY CREATED_AT ASC, LOYVERSE_ID ASC) AS RN
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE EMAIL IS NOT NULL AND COUNTRY IS NOT NULL AND TRIM(COUNTRY) <> ''
          AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
    )
    WHERE RN = 1
),
-- ---------- REG_30D ----------
reg_email AS (                                    -- one registration day per merchant email (first account)
    SELECT LOWER(TRIM(EMAIL)) AS EMAIL_KEY,
           MIN(CREATED_AT::DATE) AS REG_DAY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
      AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
    GROUP BY LOWER(TRIM(EMAIL))
),
reg_counts AS (
    SELECT s.SNAPSHOT_DATE, mc.COUNTRY, COUNT(DISTINCT re.EMAIL_KEY) AS REG_30D
    FROM spine s
    JOIN reg_email re
      ON re.REG_DAY BETWEEN DATEADD('day', -29, s.SNAPSHOT_DATE) AND s.SNAPSHOT_DATE
    JOIN merchant_country mc ON mc.EMAIL_KEY = re.EMAIL_KEY
    GROUP BY s.SNAPSHOT_DATE, mc.COUNTRY
),
-- ---------- ACTIVE_30D ----------
merchant_email AS (                               -- one email per account (prevents receipt join fan-out)
    SELECT LOYVERSE_ID, MIN(LOWER(TRIM(EMAIL))) AS EMAIL_KEY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL
      AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
    GROUP BY LOYVERSE_ID
),
receipt_days AS (                                 -- distinct (email, active day) from valid receipts
    SELECT DISTINCT me.EMAIL_KEY,
                    TRY_TO_TIMESTAMP(r.RECEIPT_DATE)::DATE AS ACT_DAY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE r
    JOIN merchant_email me ON me.LOYVERSE_ID = r.MERCHANT_ID
    WHERE r.TOTAL_MONEY IS NOT NULL AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
      AND TRY_TO_TIMESTAMP(r.RECEIPT_DATE)::DATE
            BETWEEN DATEADD('day', -78, CURRENT_DATE()) AND DATEADD('day', -1, CURRENT_DATE())
      -- OPTIONAL pruning aid (only if CREATED_AT tracks RECEIPT_DATE closely):
      -- AND r.CREATED_AT >= DATEADD('day', -110, CURRENT_DATE())
),
active_counts AS (
    SELECT s.SNAPSHOT_DATE, mc.COUNTRY, COUNT(DISTINCT rd.EMAIL_KEY) AS ACTIVE_30D
    FROM spine s
    JOIN receipt_days rd
      ON rd.ACT_DAY BETWEEN DATEADD('day', -29, s.SNAPSHOT_DATE) AND s.SNAPSHOT_DATE
    JOIN merchant_country mc ON mc.EMAIL_KEY = rd.EMAIL_KEY
    GROUP BY s.SNAPSHOT_DATE, mc.COUNTRY
),
-- ---------- PAYING_ACTIVE (point-in-time subscription coverage) ----------
sub_periods AS (                                  -- distinct (email, billing period) for paid plan/addon lines
    SELECT DISTINCT LOWER(TRIM(c.EMAIL)) AS EMAIL_KEY,
                    TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS P_START,
                    TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS P_END
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.STATUS = 'paid' AND i.DELETED = FALSE AND i.VOIDED_AT IS NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:entity_type::STRING IN ('plan','addon')
      AND TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   >= DATEADD('day', -49, CURRENT_DATE())
      AND TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE <= DATEADD('day', -1,  CURRENT_DATE())
    UNION
    SELECT DISTINCT LOWER(TRIM(c.EMAIL)),
                    TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE,
                    TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.STATUS = 'paid' AND i.DELETED = FALSE AND i.VOIDED_AT IS NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:entity_type::STRING IN ('plan','addon')
      AND TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   >= DATEADD('day', -49, CURRENT_DATE())
      AND TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE <= DATEADD('day', -1,  CURRENT_DATE())
),
paying_active AS (
    SELECT s.SNAPSHOT_DATE, mc.COUNTRY, COUNT(DISTINCT sp.EMAIL_KEY) AS PAYING_ACTIVE
    FROM spine s
    JOIN sub_periods sp
      ON s.SNAPSHOT_DATE BETWEEN sp.P_START AND sp.P_END   -- subscription covers day D
    JOIN merchant_country mc ON mc.EMAIL_KEY = sp.EMAIL_KEY
    GROUP BY s.SNAPSHOT_DATE, mc.COUNTRY
),
grid AS (                                    -- every (day, country) pair any metric touches
    SELECT SNAPSHOT_DATE, COUNTRY FROM reg_counts
    UNION
    SELECT SNAPSHOT_DATE, COUNTRY FROM active_counts
    UNION
    SELECT SNAPSHOT_DATE, COUNTRY FROM paying_active
)
SELECT g.SNAPSHOT_DATE,
       g.COUNTRY,
       COALESCE(r.REG_30D,       0) AS REG_30D,
       COALESCE(a.ACTIVE_30D,    0) AS ACTIVE_30D,
       COALESCE(p.PAYING_ACTIVE, 0) AS PAYING_ACTIVE
FROM grid g
LEFT JOIN reg_counts    r ON r.SNAPSHOT_DATE = g.SNAPSHOT_DATE AND r.COUNTRY = g.COUNTRY
LEFT JOIN active_counts a ON a.SNAPSHOT_DATE = g.SNAPSHOT_DATE AND a.COUNTRY = g.COUNTRY
LEFT JOIN paying_active p ON p.SNAPSHOT_DATE = g.SNAPSHOT_DATE AND p.COUNTRY = g.COUNTRY
ORDER BY g.SNAPSHOT_DATE, g.COUNTRY;
