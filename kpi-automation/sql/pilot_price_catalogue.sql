-- =================================================================
-- PILOT TRACKER — sales-history PRICE CATALOGUE and pilot exposure
-- READ-ONLY (single SELECT — DATA_VIEWER is sufficient)
-- =================================================================
-- Feeds build_pilot_data.py (optional second input) -> pilot-data.js
--
-- WHY THIS EXISTS
-- The invoice query can only see prices that have been BILLED. It cannot
-- see a price that exists in Chargebee and is not being attached to
-- anything — which is precisely the situation the pilot turned out to be
-- in. On 2026-08-12 the catalogue held three live monthly tiers:
--
--     S_SALESHISTORY_1_USD        $5    21,158 subscriptions
--     S_SALESHISTORY_1_USD_V001   $7       446
--     S_SALESHISTORY_1_USD_V002   $9       126
--
-- ...and zero new pilot-market adopters on the $9 one. Without this query
-- the page can say "nobody paid $9" but not "the $9 tier exists and is in
-- use elsewhere", which is the difference between a data problem and a
-- configuration problem.
--
-- SITE COVERAGE — read this before trusting a zero
-- Only the UK Chargebee site populates SUBSCRIPTION_ITEMS (Product
-- Catalog 2.0): 44,818 of 85,079 rows. The EU site populates NEITHER
-- SUBSCRIPTION_ITEMS NOR ADDONS on any of its 101,026 rows, so EU
-- subscriptions are invisible here. Belgium is a pilot market on the EU
-- site, so BE exposure cannot be read from this query — the invoice query
-- covers it instead (BE adopters billed EUR 5.00). A zero in PILOT_SUBS
-- means "none on the UK site", not "none anywhere". The builder labels
-- this rather than hiding it.
--
-- Cheap: subscription tables are ~186k rows total, no receipts grid.
-- =================================================================

WITH pilot_countries AS (
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

merchant_country AS (
    SELECT EMAIL_KEY, COUNTRY
    FROM (SELECT EMAIL_KEY, COUNTRY,
                 ROW_NUMBER() OVER (PARTITION BY EMAIL_KEY ORDER BY CREATED_AT ASC) AS RN
          FROM merchants_raw)
    WHERE RN = 1
),

-- Sales-history item prices attached to live UK subscriptions, with the
-- merchant's country resolved so pilot exposure can be counted.
sub_items AS (
    SELECT si.value:item_price_id::STRING       AS ITEM_PRICE_ID,
           si.value:unit_price::NUMBER / 100.0  AS UNIT_PRICE,
           LOWER(TRIM(c.EMAIL))                 AS EMAIL_KEY,
           TO_TIMESTAMP(s.CREATED_AT)::DATE     AS SUB_CREATED
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-SUBSCRIPTION" s
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = s.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => s.SUBSCRIPTION_ITEMS) si
    WHERE s.DELETED = FALSE
      AND si.value:item_price_id::STRING ILIKE '%SALESHISTORY%'
),

tagged AS (
    SELECT si.*,
           mc.COUNTRY,
           IFF(pc.COUNTRY IS NOT NULL, 'PILOT', 'CONTROL') AS COHORT,
           IFF(si.ITEM_PRICE_ID ILIKE 'S_SALESHISTORY_12%', 'ANNUAL', 'MONTHLY') AS TERM
    FROM sub_items si
    LEFT JOIN merchant_country mc ON mc.EMAIL_KEY = si.EMAIL_KEY
    LEFT JOIN pilot_countries pc  ON pc.COUNTRY = mc.COUNTRY
)

SELECT
    ITEM_PRICE_ID,
    TERM,
    -- The currency is encoded in the SKU suffix, not stored on the item.
    CASE WHEN ITEM_PRICE_ID ILIKE '%_USD%' THEN 'USD'
         WHEN ITEM_PRICE_ID ILIKE '%_EUR%' THEN 'EUR'
         WHEN ITEM_PRICE_ID ILIKE '%_GBP%' THEN 'GBP'
         WHEN ITEM_PRICE_ID ILIKE '%_JPY%' THEN 'JPY'
         WHEN ITEM_PRICE_ID ILIKE '%_KRW%' THEN 'KRW'
         ELSE '?' END                                     AS CURRENCY_CODE,
    MAX(UNIT_PRICE)                                       AS UNIT_PRICE,
    COUNT(*)                                              AS SUBSCRIPTIONS,
    COUNT_IF(COHORT = 'PILOT')                            AS PILOT_SUBS,
    -- Attached to a pilot merchant since launch: the number that should be
    -- non-zero on the intended new tier and is not.
    COUNT_IF(COHORT = 'PILOT' AND SUB_CREATED >= DATE '2026-07-16') AS PILOT_SUBS_SINCE_LAUNCH,
    MIN(SUB_CREATED)                                      AS FIRST_ATTACHED,
    MAX(SUB_CREATED)                                      AS LAST_ATTACHED
FROM tagged
GROUP BY ITEM_PRICE_ID, TERM, 3
ORDER BY TERM, CURRENCY_CODE, UNIT_PRICE;
