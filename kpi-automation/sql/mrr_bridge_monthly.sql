-- =================================================================
-- MRR BRIDGE — where the revenue went, month to month
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- THE QUESTION. The dashboard could say how many merchants joined and how many left, and
-- what MRR totalled, but not how the one became the other. A month where 300 merchants
-- arrive and 280 leave looks healthy; if the 280 were paying $40 each and the 300 pay $12,
-- revenue fell. This decomposes the month-over-month change in MRR into the five things
-- that can cause it.
--
-- IT IS THE SAME MRR as mrr_live_monthly.sql — same line selection, same credit-note
-- handling, same FX, same month-coverage rule — regrouped to MERCHANT x MONTH and then
-- differenced. That is deliberate and not negotiable: a bridge built on a second definition
-- would decompose a number the page does not show. The identity below is checked on every
-- run and the build fails if it breaks:
--
--     MRR(m-1) + NEW + REACTIVATION + EXPANSION - CONTRACTION - CHURN = MRR(m)
--
-- THE FIVE COMPONENTS, per merchant, comparing month m-1 with month m:
--   NEW            0 -> positive, and the merchant has NEVER had MRR before. First revenue.
--   REACTIVATION   0 -> positive, but it had MRR in some earlier month. Won back.
--                  Kept apart from NEW because mixing them flatters acquisition: a merchant
--                  returning after two months away is not a new customer, and a business
--                  that churns and re-signs the same accounts would look like it was growing.
--   EXPANSION      positive -> larger. A module added, a store added, a plan upgraded.
--   CONTRACTION    positive -> smaller but still positive. The leak the merchant-count
--                  charts cannot see at all: a merchant on three features dropping one is
--                  invisible to a headcount and obvious here.
--   CHURN          positive -> 0. The whole relationship stopped.
--
-- CHURN AND CONTRACTION ARE EMITTED POSITIVE. The sign is applied by the reader, so nobody
-- has to remember whether a "-$4,000 churn" month was good or bad.
--
-- A MERCHANT, NOT A SUBSCRIPTION. A merchant swapping one feature for a pricier one is
-- expansion, not a churn plus a new sale. At subscription grain that swap would read as
-- both, inflating gross adds and gross churn while the net stayed right — the usual way a
-- bridge is made to look more dramatic than the business is.
--
-- GRID, NOT GAPS. Every merchant is crossed with every month from its first revenue to the
-- last month on the axis, missing months filled with 0, so a merchant that stops paying
-- produces a CHURN row in the month it stopped rather than silently vanishing. Without the
-- grid, LAG would compare a merchant's March with its June and call it continuous.
--
-- THE LAST ROW IS THE MONTH IN PROGRESS, read as at yesterday, exactly as the MRR series
-- does. It is genuinely partial — a renewal due on the 28th has not happened yet — so the
-- dashboard marks it rather than hiding it.
-- =================================================================

WITH months AS (
  SELECT MEND FROM (
    SELECT LAST_DAY(DATEADD('month', SEQ4(), '2022-01-01'::DATE)) AS MEND
    FROM TABLE(GENERATOR(ROWCOUNT => 200))
  ) WHERE MEND < DATE_TRUNC('month', CURRENT_DATE())
  UNION ALL
  SELECT DATEADD('day', -1, CURRENT_DATE())
),
m AS (SELECT MEND, DATEADD('day', 1, MEND)::TIMESTAMP AS NXT FROM months),
subs AS (
  -- LOYVERSE_MERCHANT_ID carried through: this is the one change from mrr_live_monthly.sql
  -- besides the grouping. Everything else below is that query, byte for byte.
  SELECT LOWER(REGION) AS REGION, ID AS SUB_ID, LOYVERSE_MERCHANT_ID AS MERCHANT_ID,
         COALESCE(ACTIVATED_AT, CREATED_AT) AS STARTED,
         IFF(LOWER(STATUS) = 'cancelled', CANCELLED_AT, NULL) AS CANCELLED
  FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
  WHERE LOYVERSE_MERCHANT_ID IS NOT NULL AND LOWER(STATUS) <> 'future'
),
lines AS (
  SELECT 'uk' AS REGION, 1 AS SGN, li.value:subscription_id::STRING AS SUB_ID,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PS, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE AS PE,
         i.CURRENCY_CODE AS CUR, li.value:amount::NUMBER / 100.0 AS AMT
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE i.DELETED = FALSE AND i.VOIDED_AT IS NULL
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
  UNION ALL
  SELECT 'eu', 1, li.value:subscription_id::STRING,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE,
         i.CURRENCY_CODE, li.value:amount::NUMBER / 100.0
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE i.DELETED = FALSE AND i.VOIDED_AT IS NULL
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
  UNION ALL
  SELECT 'uk', -1, COALESCE(li.value:subscription_id::STRING, c.SUBSCRIPTION_ID),
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE,
         c.CURRENCY_CODE, li.value:amount::NUMBER / 100.0
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CREDIT_NOTE" c
  CROSS JOIN LATERAL FLATTEN(input => c.LINE_ITEMS) li
  WHERE c.DELETED = FALSE AND c.VOIDED_AT IS NULL AND c.CREATE_REASON_CODE = 'Subscription Change'
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
  UNION ALL
  SELECT 'eu', -1, COALESCE(li.value:subscription_id::STRING, c.SUBSCRIPTION_ID),
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE,
         c.CURRENCY_CODE, li.value:amount::NUMBER / 100.0
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CREDIT_NOTE" c
  CROSS JOIN LATERAL FLATTEN(input => c.LINE_ITEMS) li
  WHERE c.DELETED = FALSE AND c.VOIDED_AT IS NULL AND c.CREATE_REASON_CODE = 'Subscription Change'
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
),
cov AS (
  SELECT m.MEND, m.NXT, l.REGION, l.SUB_ID, l.SGN,
         l.AMT * CASE l.CUR WHEN 'GBP' THEN 1.34 WHEN 'EUR' THEN 1.16 ELSE 1 END
         / CASE WHEN DATEDIFF('day', l.PS, l.PE) >= 27
                THEN GREATEST(ROUND(DATEDIFF('day', l.PS, l.PE) / 30.4375), 1)
                ELSE GREATEST(DATEDIFF('day', l.PS, l.PE), 1) / 30.4375 END AS MONTHLY_USD
  FROM m JOIN lines l ON l.PS <= m.MEND AND l.PE > m.MEND
),
-- MRR per merchant per month. A merchant appears only in months it actually billed; the
-- grid below supplies the zeros.
mm AS (
  SELECT TO_CHAR(c.MEND, 'YYYY-MM') AS MONTH, s.MERCHANT_ID,
         SUM(c.SGN * c.MONTHLY_USD) AS MRR
  FROM cov c
  JOIN subs s ON s.REGION = c.REGION AND s.SUB_ID = c.SUB_ID
  WHERE s.STARTED < c.NXT AND (s.CANCELLED IS NULL OR s.CANCELLED >= c.NXT)
  GROUP BY 1, 2
  HAVING SUM(c.SGN * c.MONTHLY_USD) > 0
),
axis AS (SELECT TO_CHAR(MEND, 'YYYY-MM') AS MONTH FROM months),
-- One row per merchant per month from its FIRST revenue month onward. Starting at the
-- merchant's own first month rather than at 2022-01 keeps the grid to the merchants that
-- existed, instead of crossing every merchant with every month that ever was.
span AS (SELECT MERCHANT_ID, MIN(MONTH) AS FIRST_MONTH FROM mm GROUP BY 1),
grid AS (
  SELECT a.MONTH, s.MERCHANT_ID, COALESCE(x.MRR, 0) AS MRR
  FROM span s
  JOIN axis a ON a.MONTH >= s.FIRST_MONTH
  LEFT JOIN mm x ON x.MERCHANT_ID = s.MERCHANT_ID AND x.MONTH = a.MONTH
),
-- PREV is last month's MRR; EVER_BEFORE says whether this merchant had ever billed before
-- this month, which is the only thing separating a new customer from a won-back one.
step AS (
  SELECT MONTH, MERCHANT_ID, MRR,
         LAG(MRR) OVER (PARTITION BY MERCHANT_ID ORDER BY MONTH) AS PREV,
         COALESCE(MAX(IFF(MRR > 0, 1, 0))
           OVER (PARTITION BY MERCHANT_ID ORDER BY MONTH
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS EVER_BEFORE
  FROM grid
)
SELECT MONTH,
       ROUND(SUM(IFF(COALESCE(PREV,0) = 0 AND MRR > 0 AND EVER_BEFORE = 0, MRR, 0)), 2) AS NEW_MRR,
       ROUND(SUM(IFF(COALESCE(PREV,0) = 0 AND MRR > 0 AND EVER_BEFORE = 1, MRR, 0)), 2) AS REACTIVATION_MRR,
       ROUND(SUM(IFF(COALESCE(PREV,0) > 0 AND MRR > PREV, MRR - PREV, 0)), 2)           AS EXPANSION_MRR,
       ROUND(SUM(IFF(MRR > 0 AND COALESCE(PREV,0) > MRR, PREV - MRR, 0)), 2)            AS CONTRACTION_MRR,
       ROUND(SUM(IFF(MRR = 0 AND COALESCE(PREV,0) > 0, PREV, 0)), 2)                    AS CHURN_MRR,
       ROUND(SUM(COALESCE(PREV, 0)), 2)                                                 AS OPENING_MRR,
       ROUND(SUM(MRR), 2)                                                               AS CLOSING_MRR,
       COUNT_IF(MRR > 0)                                                                AS PAYING_MERCHANTS,
       COUNT_IF(COALESCE(PREV,0) = 0 AND MRR > 0 AND EVER_BEFORE = 0)                   AS NEW_MERCHANTS,
       COUNT_IF(COALESCE(PREV,0) = 0 AND MRR > 0 AND EVER_BEFORE = 1)                   AS REACTIVATED_MERCHANTS,
       COUNT_IF(MRR = 0 AND COALESCE(PREV,0) > 0)                                       AS CHURNED_MERCHANTS
FROM step
GROUP BY 1
ORDER BY 1
;
