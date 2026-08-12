-- =================================================================
-- PILOT TRACKER — sales-history adoption, revenue and PRICE TIER,
-- daily x country x cohort x type x tier
-- Unlimited-sales-history pricing pilot, live 2026-07-16 in
-- AU, BE, CO, ID, IN, NG, SG.
-- READ-ONLY (single SELECT — DATA_VIEWER is sufficient)
-- =================================================================
-- Feeds build_pilot_data.py -> pilot-data.js -> pilot.html
--
-- WHY THE PRICE IS RETURNED AND NEVER ASSUMED
-- The pilot was described as two changes shipped together: free history
-- 30d -> 15d AND the add-on price $5 -> $9. A first version of this
-- tracker took the $9 on trust and hardcoded it. It was wrong: probing
-- the catalogue on 2026-08-12 showed three monthly tiers, all live
-- since 2024 —
--     S_SALESHISTORY_1_USD        $5    21,158 subscriptions
--     S_SALESHISTORY_1_USD_V001   $7       446
--     S_SALESHISTORY_1_USD_V002   $9       126
-- — and NOT ONE new pilot-market adopter on the $9 tier. New signups in
-- the seven markets still land on the $5 plan. The price change exists
-- in Chargebee and has not been applied to the pilot.
--
-- So this query returns UNIT_AMOUNT and PLAN_ID at the grain, and the
-- builder derives the price actually charged. Nothing downstream is
-- allowed to state a price the data does not show.
--
-- UNIT_AMOUNT vs AMOUNT — use both, for different questions
--   AMOUNT       what was invoiced: includes QUANTITY (merchants on many
--                stores bill multiples — one line hit $205) and mid-cycle
--                PRORATION (partial lines as low as $0.05). Right for
--                "money collected", useless for "what does it cost".
--   UNIT_AMOUNT  the per-unit list price on the line: cleanly 500 / 700 /
--                900 minor units with no noise. This is the price field.
-- Reading a price off AMOUNT is what produced a phantom "$6.39 -> $5.70
-- price cut" that was really just quantity and term mix.
--
-- WHY THE SKU MATCH IS A LIKE, NOT AN ENUM
-- Loyverse has never billed a Chargebee `addon` — across every invoice
-- line item since 2018 the only entity types are `plan` (99.8%) and
-- `adhoc` (0.15%). Unlimited sales history is a PLAN, sold under 16
-- variants. The LIKE picks up new currencies and version bumps (_V001,
-- _V002) without a code change — which is exactly how the $9 tier was
-- found.
--
-- ADOPTION_TYPE
--   NEW_PAYER  sales history is the merchant's first ever paid line
--   UPSELL     they were already paying for something else
-- The two behave differently and must not share a measurement window:
-- new payers bill on conversion, upsells only appear when an existing
-- subscription renews. A short window catches only those merchants
-- whose renewal date happens to fall inside it.
--
-- THE 14-DAY TRIAL LAG — the thing that makes naive reads wrong
-- Adoption runs through a 14-day trial, so a merchant who hit the new
-- 15-day wall on 16 Jul bills no earlier than 30 Jul. Rows dated
-- 16-29 Jul came from trials started under the OLD rules: they are
-- baseline wearing a post-launch date. build_pilot_data.py buckets them
-- separately as LAUNCH_LAG and excludes them from the verdict.
-- =================================================================

WITH params AS (
    SELECT DATE '2026-07-16' AS LAUNCH_DATE,
           DATE '2026-07-30' AS SIGNAL_DATE,      -- launch + 14-day trial
           DATE '2026-01-01' AS WINDOW_START,     -- long baseline for seasonality
           DATE '2026-07-15' AS BASE_ASOF         -- upsell denominator snapshot
),

pilot_countries AS (
    SELECT column1 AS COUNTRY
    FROM VALUES ('AU'), ('BE'), ('CO'), ('ID'), ('IN'), ('NG'), ('SG')
),

merchants_raw AS (
    SELECT LOWER(TRIM(m.EMAIL))   AS EMAIL_KEY,
           UPPER(TRIM(m.COUNTRY)) AS COUNTRY,
           m.CREATED_AT           AS CREATED_AT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
      AND m.COUNTRY IS NOT NULL AND m.COUNTRY <> ''
),

-- One country per merchant, earliest account wins. Identical to
-- country_month_mrr_daily_asof.sql so counts reconcile with the rest
-- of the dashboard.
merchant_country AS (
    SELECT EMAIL_KEY, COUNTRY
    FROM (SELECT EMAIL_KEY, COUNTRY,
                 ROW_NUMBER() OVER (PARTITION BY EMAIL_KEY ORDER BY CREATED_AT ASC) AS RN
          FROM merchants_raw)
    WHERE RN = 1
),

inv_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                  AS EMAIL_KEY,
           li.value:entity_id::STRING            AS PLAN_ID,
           TO_TIMESTAMP(i.PAID_AT)::DATE         AS PAID_DATE,
           li.value:amount::NUMBER / 100.0       AS AMOUNT,
           li.value:unit_amount::NUMBER / 100.0  AS UNIT_AMOUNT,
           UPPER(COALESCE(i.CURRENCY_CODE,'USD'))::STRING AS CURRENCY_CODE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE
      AND i.PAID_AT IS NOT NULL
      AND i.VOIDED_AT IS NULL
      AND li.value:entity_type::STRING = 'plan'
      AND li.value:amount::NUMBER > 0
      AND c.EMAIL IS NOT NULL

    UNION ALL

    SELECT LOWER(TRIM(c.EMAIL)),
           li.value:entity_id::STRING,
           TO_TIMESTAMP(i.PAID_AT)::DATE,
           li.value:amount::NUMBER / 100.0,
           li.value:unit_amount::NUMBER / 100.0,
           UPPER(COALESCE(i.CURRENCY_CODE,'EUR'))::STRING
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE
      AND i.PAID_AT IS NOT NULL
      AND i.VOIDED_AT IS NULL
      AND li.value:entity_type::STRING = 'plan'
      AND li.value:amount::NUMBER > 0
      AND c.EMAIL IS NOT NULL
),

first_any_paid AS (
    SELECT EMAIL_KEY, MIN(PAID_DATE) AS FIRST_ANY_DATE
    FROM inv_lines GROUP BY EMAIL_KEY
),

history_lines AS (
    SELECT * FROM inv_lines WHERE PLAN_ID ILIKE 'S_SALESHISTORY%'
),

first_history AS (
    SELECT EMAIL_KEY, MIN(PAID_DATE) AS FIRST_SH_DATE
    FROM history_lines GROUP BY EMAIL_KEY
),

-- The plan, price and currency of each merchant's FIRST sales-history
-- line. Ties broken by highest amount so an annual purchase isn't lost
-- behind a same-day proration of a few cents.
first_history_detail AS (
    SELECT EMAIL_KEY, PAID_DATE AS FIRST_SH_DATE, PLAN_ID,
           AMOUNT, UNIT_AMOUNT, CURRENCY_CODE
    FROM (
        SELECT h.*, ROW_NUMBER() OVER (
                 PARTITION BY h.EMAIL_KEY
                 ORDER BY h.PAID_DATE ASC, h.AMOUNT DESC) AS RN
        FROM history_lines h
    )
    WHERE RN = 1
),

adopters AS (
    SELECT fh.EMAIL_KEY,
           fh.FIRST_SH_DATE,
           mc.COUNTRY,
           fd.PLAN_ID,
           fd.AMOUNT,
           fd.UNIT_AMOUNT,
           fd.CURRENCY_CODE,
           IFF(fd.PLAN_ID ILIKE 'S_SALESHISTORY_12%', TRUE, FALSE)          AS IS_ANNUAL,
           IFF(pc.COUNTRY IS NOT NULL, 'PILOT', 'CONTROL')                  AS COHORT,
           IFF(fa.FIRST_ANY_DATE < fh.FIRST_SH_DATE, 'UPSELL', 'NEW_PAYER') AS ADOPTION_TYPE
    FROM first_history fh
    JOIN first_any_paid fa        ON fa.EMAIL_KEY = fh.EMAIL_KEY
    JOIN merchant_country mc      ON mc.EMAIL_KEY = fh.EMAIL_KEY
    JOIN first_history_detail fd  ON fd.EMAIL_KEY = fh.EMAIL_KEY
    LEFT JOIN pilot_countries pc  ON pc.COUNTRY = mc.COUNTRY
),

-- Upsell exposure, frozen at the day before launch: merchants paying
-- for something OTHER than history, billed in the prior 45 days so
-- long-churned accounts don't dilute the rate.
upsell_base_country AS (
    SELECT mc.COUNTRY,
           COUNT(DISTINCT il.EMAIL_KEY) AS PAYERS_WITHOUT_HISTORY
    FROM inv_lines il
    JOIN merchant_country mc ON mc.EMAIL_KEY = il.EMAIL_KEY
    CROSS JOIN params p
    WHERE il.PAID_DATE BETWEEN DATEADD('day', -45, p.BASE_ASOF) AND p.BASE_ASOF
      AND il.EMAIL_KEY NOT IN (
            SELECT fh.EMAIL_KEY FROM first_history fh
            CROSS JOIN params p2
            WHERE fh.FIRST_SH_DATE <= p2.BASE_ASOF)
    GROUP BY mc.COUNTRY
)

SELECT
    a.FIRST_SH_DATE                                        AS ADOPTION_DATE,
    a.COUNTRY,
    a.COHORT,
    a.ADOPTION_TYPE,
    a.IS_ANNUAL,
    a.CURRENCY_CODE,
    -- Price tier, straight from the invoice. PLAN_ID names the Chargebee
    -- item price (..._V001 / _V002 encode the price ladder) and
    -- UNIT_AMOUNT is what that tier charges per unit.
    a.PLAN_ID,
    a.UNIT_AMOUNT,
    CASE WHEN a.FIRST_SH_DATE >= p.SIGNAL_DATE THEN 'SIGNAL'
         WHEN a.FIRST_SH_DATE >= p.LAUNCH_DATE THEN 'LAUNCH_LAG'
         ELSE 'BASELINE' END                               AS PERIOD,
    DATEDIFF('day', p.SIGNAL_DATE, a.FIRST_SH_DATE)        AS DAYS_FROM_SIGNAL,
    COUNT(DISTINCT a.EMAIL_KEY)                            AS ADOPTERS,
    ROUND(SUM(a.AMOUNT), 2)                                AS AMOUNT,
    -- Constant per country (a fixed pre-launch snapshot), repeated on
    -- every row so the builder can pick it up without a second query.
    MAX(ub.PAYERS_WITHOUT_HISTORY)                         AS UPSELL_BASE_COUNTRY
FROM adopters a
CROSS JOIN params p
LEFT JOIN upsell_base_country ub ON ub.COUNTRY = a.COUNTRY
WHERE a.FIRST_SH_DATE >= p.WINDOW_START
  AND a.FIRST_SH_DATE <  CURRENT_DATE()          -- today is partial; exclude
GROUP BY a.FIRST_SH_DATE, a.COUNTRY, a.COHORT, a.ADOPTION_TYPE,
         a.IS_ANNUAL, a.CURRENCY_CODE, a.PLAN_ID, a.UNIT_AMOUNT,
         p.SIGNAL_DATE, p.LAUNCH_DATE
ORDER BY a.FIRST_SH_DATE, a.COHORT, a.ADOPTION_TYPE, a.COUNTRY, a.PLAN_ID;
