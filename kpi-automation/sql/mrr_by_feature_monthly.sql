-- =================================================================
-- MRR BY FEATURE x TERM, per CALENDAR MONTH
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- The per-feature split of the number mrr_bottomup_monthly.sql already produces.
--
-- IT IS A DELIBERATE CLONE OF THAT QUERY, differing in exactly one thing: it keeps
-- li.value:entity_id and groups by it, where the original throws it away. Every other
-- clause -- the invoice filters, the plan/addon restriction, the FX rates, the
-- amortisation over the billing period, the void handling, the current-month top-up --
-- is character-for-character the same. That is the point: the stacked bars on the
-- dashboard must add up to the MRR line the same page already draws, and the only way
-- to guarantee that is for both numbers to come out of the same arithmetic. If you edit
-- one of these, edit both. build_subs_data.py fails the build if they drift by >0.1%.
--
-- PLAN IDS look like S_<FEATURE>_<TERM>_<CURRENCY>[_V<nnn>], e.g. S_INVENTORY_12_USD:
--   FEATURE  SALESHISTORY | EMPLOYEE | INVENTORY | INTEGRATION | EMPSTORE
--   TERM     1 = monthly, 12 = annual (billing term, NOT the amortisation -- an annual
--            plan still contributes 1/12 of its value to each of twelve months below)
--   V001/V002 are price revisions of the same product and fold into the same feature.
-- Anything that does not parse lands in 'OTHER' rather than being dropped, so the split
-- always sums to the total. That bucket should stay empty; if it grows, a new plan family
-- has been launched and belongs in the FEATURE_LABEL map in build_kpi_data.py.
--
-- COMMITTED, NOT COLLECTED, and the CURRENT-MONTH TOP-UP: see the long explanation in
-- mrr_bottomup_monthly.sql. Both changed together on 2026-11-06.
--
-- ONE APPROXIMATION THE TOTAL DOES NOT HAVE. A topped-up subscription contributes its
-- whole MRR under its PRIMARY plan's feature, because the subscription-level MRR field
-- is not itemised. A merchant on Inventory plus an Employee addon therefore shows the
-- addon's value under Inventory for the current month, until the real invoice arrives
-- and replaces the estimate with the itemised split. This does NOT affect the total or
-- the reconciliation — the same rows sum to the same number either way — only the
-- feature mix of the month in progress.
--
-- NOTE: includes forward months (annual plans amortised ahead); the build step caps at
--       the current calendar month for display, exactly as it does for the total.
-- =================================================================

WITH cur AS (SELECT DATE_TRUNC('MONTH', CURRENT_DATE())::DATE AS MSTART),
uk_lines AS (
    SELECT li.value:subscription_id::STRING                           AS SUB_ID,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE            AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE              AS PERIOD_END,
           li.value:amount::NUMBER / 100.0                           AS AMOUNT_RAW,
           li.value:entity_id::STRING                                AS PLAN_ID,
           i.CURRENCY_CODE                                           AS CURRENCY,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT li.value:subscription_id::STRING                           AS SUB_ID,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE            AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE              AS PERIOD_END,
           li.value:amount::NUMBER / 100.0                           AS AMOUNT_RAW,
           li.value:entity_id::STRING                                AS PLAN_ID,
           i.CURRENCY_CODE                                           AS CURRENCY,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
all_lines AS (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines),
lines_usd AS (
    SELECT SUB_ID,
           CASE CURRENCY
               WHEN 'USD' THEN AMOUNT_RAW
               WHEN 'GBP' THEN AMOUNT_RAW * 1.34
               WHEN 'EUR' THEN AMOUNT_RAW * 1.16
               ELSE AMOUNT_RAW
           END AS AMOUNT_USD,
           PERIOD_START,
           GREATEST(DATEDIFF('MONTH', PERIOD_START, PERIOD_END), 1) AS MONTHS_IN_PERIOD,
           -- SPLIT_PART on the underscore-delimited plan id. Position 2 is the feature and
           -- position 3 the term; a plan id that does not follow the shape yields an empty
           -- string and is caught by the CASE below rather than silently mis-bucketed.
           UPPER(COALESCE(NULLIF(SPLIT_PART(PLAN_ID, '_', 2), ''), 'OTHER')) AS FEATURE_RAW,
           SPLIT_PART(PLAN_ID, '_', 3)                                       AS TERM_RAW
    FROM all_lines
    WHERE VOID_DATE IS NULL
),
tagged AS (
    SELECT SUB_ID, AMOUNT_USD, PERIOD_START, MONTHS_IN_PERIOD,
           CASE WHEN FEATURE_RAW IN ('SALESHISTORY','EMPLOYEE','INVENTORY','INTEGRATION','EMPSTORE')
                THEN FEATURE_RAW ELSE 'OTHER' END AS FEATURE,
           CASE WHEN TERM_RAW = '1'  THEN 'monthly'
                WHEN TERM_RAW = '12' THEN 'annual'
                ELSE 'other' END                  AS TERM
    FROM lines_usd
),
spread AS (
    SELECT t.SUB_ID, t.FEATURE, t.TERM,
           DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', t.PERIOD_START))::DATE AS MONTH_START,
           t.AMOUNT_USD / t.MONTHS_IN_PERIOD AS MONTHLY_AMOUNT_USD
    FROM tagged t,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < t.MONTHS_IN_PERIOD
),
billed_this_month AS (
    SELECT DISTINCT s.SUB_ID FROM spread s, cur WHERE s.MONTH_START = cur.MSTART
),
live_subs AS (
    SELECT s.ID AS SUB_ID, s.MRR, s.CURRENCY_CODE, s.PLAN_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-SUBSCRIPTION" s
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = s.CUSTOMER_ID
    WHERE s.DELETED = FALSE AND s.STATUS IN ('active','non_renewing')
      AND s.MRR > 0 AND c.EMAIL IS NOT NULL
    UNION ALL
    SELECT s.ID, s.MRR, s.CURRENCY_CODE, s.PLAN_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-SUBSCRIPTION" s
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = s.CUSTOMER_ID
    WHERE s.DELETED = FALSE AND s.STATUS IN ('active','non_renewing')
      AND s.MRR > 0 AND c.EMAIL IS NOT NULL
),
topup AS (
    SELECT cur.MSTART AS MONTH_START,
           CASE WHEN UPPER(COALESCE(NULLIF(SPLIT_PART(s.PLAN_ID, '_', 2), ''), 'OTHER'))
                     IN ('SALESHISTORY','EMPLOYEE','INVENTORY','INTEGRATION','EMPSTORE')
                THEN UPPER(SPLIT_PART(s.PLAN_ID, '_', 2)) ELSE 'OTHER' END AS FEATURE,
           CASE WHEN SPLIT_PART(s.PLAN_ID, '_', 3) = '1'  THEN 'monthly'
                WHEN SPLIT_PART(s.PLAN_ID, '_', 3) = '12' THEN 'annual'
                ELSE 'other' END                                           AS TERM,
           CASE s.CURRENCY_CODE
               WHEN 'USD' THEN s.MRR / 100.0
               WHEN 'GBP' THEN s.MRR / 100.0 * 1.34
               WHEN 'EUR' THEN s.MRR / 100.0 * 1.16
               ELSE s.MRR / 100.0
           END AS MONTHLY_AMOUNT_USD
    FROM live_subs s, cur
    WHERE s.SUB_ID NOT IN (SELECT SUB_ID FROM billed_this_month)
),
combined AS (
    SELECT FEATURE, TERM, MONTH_START, MONTHLY_AMOUNT_USD FROM spread
    UNION ALL
    SELECT FEATURE, TERM, MONTH_START, MONTHLY_AMOUNT_USD FROM topup
)
SELECT MONTH_START           AS MONTH,
       FEATURE,
       TERM,
       ROUND(SUM(MONTHLY_AMOUNT_USD), 2) AS MRR_USD
FROM combined
GROUP BY MONTH_START, FEATURE, TERM
HAVING SUM(MONTHLY_AMOUNT_USD) > 0
ORDER BY MONTH_START, MRR_USD DESC;
