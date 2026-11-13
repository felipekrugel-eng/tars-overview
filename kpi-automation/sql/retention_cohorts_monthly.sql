-- =================================================================
-- COHORT RETENTION — two definitions of t0, measured
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- WHY THIS EXISTS. The Churn tab's "paying / subscription retention" curve was a hardcoded
-- array of 61 numbers in retention.html, flagged measured:true, stepping down by exactly
-- 0.8, 0.7, 0.6, 0.5 and 0.4 points a month and nothing else. A measured series has sixty
-- different month-over-month deltas; that one had five. The page's "91% net retained at M12"
-- headline was read off it. This query replaces it with the real thing.
--
-- TWO COHORT DEFINITIONS, because they answer different questions and the page toggles
-- between them:
--
--   SUBSCRIPTION COHORT (t0 = the month the merchant FIRST PAID). Classic retention: every
--   cohort starts at 100% of merchants and 100% of its MRR, and the curve is how much of
--   that survives. This is the one the old synthetic line pretended to be.
--
--   REGISTRATION COHORT (t0 = the month the merchant SIGNED UP). Starts near zero, climbs
--   as the cohort converts to paid, peaks, then decays. It answers "what does a month of
--   sign-ups turn into", which the subscription view cannot: a cohort that never converts
--   is invisible to a curve that only begins at first payment.
--
-- Both are emitted at cohort x age grain; the build aggregates them. Aggregation is
-- SUM over SUM, never the average of per-cohort percentages — a mean of ratios lets a tiny
-- cohort with one lucky merchant weigh as much as a cohort of thousands.
--
-- EMAIL, NOT ACCOUNT. Merchants are deduped by lower(email) exactly as the registrations
-- series is, and a cohort month is the earliest account that email ever created. Without
-- this the numerator counts accounts and the denominator counts people.
--
-- MRR IS THE SAME MRR as mrr_live_monthly.sql and mrr_bridge_monthly.sql: same line
-- selection, same credit notes, same FX, same coverage rule. Three views of one number.
--
-- NO BOT FILTER ON THE PAYING SIDE, deliberately. The registrations denominator the build
-- divides by IS bot-filtered, so in principle the two sides differ. In practice a bot does
-- not enter card details and pay Chargebee for a year, so the paying numerator contains
-- none; adding the 340-line filter here would cost a great deal and change nothing.
-- =================================================================

WITH months AS (
  SELECT MEND FROM (
    SELECT LAST_DAY(DATEADD('month', SEQ4(), '2016-01-01'::DATE)) AS MEND
    FROM TABLE(GENERATOR(ROWCOUNT => 240))
  ) WHERE MEND < DATE_TRUNC('month', CURRENT_DATE())
  UNION ALL
  SELECT DATEADD('day', -1, CURRENT_DATE())
),
m AS (SELECT MEND, DATEADD('day', 1, MEND)::TIMESTAMP AS NXT FROM months),
-- email identity and registration month for every account that has ever had a subscription
ident AS (
  SELECT s.MID,
         LOWER(TRIM(mm.EMAIL))                              AS EMAIL_KEY,
         MIN(DATE_TRUNC('MONTH', mm.CREATED_AT)::DATE)      AS ACCT_REG_MONTH
  FROM (SELECT DISTINCT LOYVERSE_MERCHANT_ID AS MID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
        WHERE LOYVERSE_MERCHANT_ID IS NOT NULL) s
  JOIN LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS mm ON mm.LOYVERSE_ID = s.MID
  WHERE mm.EMAIL IS NOT NULL AND mm.CREATED_AT IS NOT NULL
  GROUP BY 1, 2
),
-- the email's OWN first registration, across every account it ever opened, so the cohort
-- month matches the one the registrations series counted it in
reg AS (
  SELECT LOWER(TRIM(EMAIL)) AS EMAIL_KEY,
         MIN(DATE_TRUNC('MONTH', CREATED_AT)::DATE) AS REG_MONTH
  FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
  WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
    AND LOWER(TRIM(EMAIL)) IN (SELECT EMAIL_KEY FROM ident)
  GROUP BY 1
),
subs AS (
  SELECT LOWER(REGION) AS REGION, ID AS SUB_ID, LOYVERSE_MERCHANT_ID AS MID,
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
-- MRR per EMAIL per month
em AS (
  SELECT DATE_TRUNC('MONTH', c.MEND)::DATE AS MONTH_START, i.EMAIL_KEY,
         SUM(c.SGN * c.MONTHLY_USD) AS MRR
  FROM cov c
  JOIN subs s  ON s.REGION = c.REGION AND s.SUB_ID = c.SUB_ID
  JOIN ident i ON i.MID = s.MID
  WHERE s.STARTED < c.NXT AND (s.CANCELLED IS NULL OR s.CANCELLED >= c.NXT)
  GROUP BY 1, 2
  HAVING SUM(c.SGN * c.MONTHLY_USD) > 0
),
first_pay AS (SELECT EMAIL_KEY, MIN(MONTH_START) AS FIRST_PAID_MONTH FROM em GROUP BY 1),
-- t0 MRR for the subscription-cohort denominator: what the cohort was worth in its first
-- paying month, which is the only sane base for "percent of starting revenue retained".
t0 AS (
  SELECT f.EMAIL_KEY, f.FIRST_PAID_MONTH, e.MRR AS MRR_T0
  FROM first_pay f JOIN em e ON e.EMAIL_KEY = f.EMAIL_KEY AND e.MONTH_START = f.FIRST_PAID_MONTH
)
-- GRAIN: one row per (basis, cohort, age). The build turns these into curves.
SELECT 'sub' AS BASIS,
       TO_CHAR(t.FIRST_PAID_MONTH, 'YYYY-MM')                              AS COHORT,
       DATEDIFF('month', t.FIRST_PAID_MONTH, e.MONTH_START)                AS AGE,
       COUNT(DISTINCT e.EMAIL_KEY)                                         AS MERCHANTS,
       ROUND(SUM(e.MRR), 2)                                                AS MRR,
       MAX(z.COHORT_MERCHANTS)                                             AS COHORT_MERCHANTS,
       ROUND(MAX(z.COHORT_MRR_T0), 2)                                      AS COHORT_BASE_MRR
FROM t0 t
JOIN em e ON e.EMAIL_KEY = t.EMAIL_KEY AND e.MONTH_START >= t.FIRST_PAID_MONTH
JOIN (SELECT FIRST_PAID_MONTH, COUNT(*) AS COHORT_MERCHANTS, SUM(MRR_T0) AS COHORT_MRR_T0
      FROM t0 GROUP BY 1) z ON z.FIRST_PAID_MONTH = t.FIRST_PAID_MONTH
GROUP BY 1, 2, 3

UNION ALL

SELECT 'reg' AS BASIS,
       TO_CHAR(r.REG_MONTH, 'YYYY-MM')                                     AS COHORT,
       DATEDIFF('month', r.REG_MONTH, e.MONTH_START)                       AS AGE,
       COUNT(DISTINCT e.EMAIL_KEY)                                         AS MERCHANTS,
       ROUND(SUM(e.MRR), 2)                                                AS MRR,
       NULL                                                                AS COHORT_MERCHANTS,
       NULL                                                                AS COHORT_BASE_MRR
FROM reg r
JOIN em e ON e.EMAIL_KEY = r.EMAIL_KEY AND e.MONTH_START >= r.REG_MONTH
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
;
