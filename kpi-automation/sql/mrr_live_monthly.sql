-- =================================================================
-- MRR — LIVE SUBSCRIPTION VALUE AT MONTH END, per calendar month
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- THE HEADLINE MRR from 2026-11-09. Replaces the amortised bottom-up figure in
-- mrr_bottomup_monthly.sql, which is still built and published as `mrrInvoice`.
--
-- WHAT IT MEASURES: the monthly value of the subscriptions that were LIVE on the last day
-- of the month — the same merchant base as the paying-customer count, so MRR and paying
-- customers finally describe one population and ARPC is a ratio of two halves that agree.
--   * an invoice line (plan/addon, not voided) whose billing period COVERS the month end,
--   * on a subscription that had started and had not been cancelled by then,
--   * UNPAID INVOICES COUNT — this is contracted value, not cash,
--   * less credit notes with reason 'Subscription Change', so a mid-term plan switch is not
--     counted twice: the old plan's remaining value is credited back as the new one bills,
--   * each line normalised to a monthly figure — whole months for a full billing period
--     (27+ days, so a 28-to-31-day month is one month, not 0.92 or 1.02), and
--     days/30.4375 for a part period.
--
-- HOW IT DIFFERS from the bottom-up number it replaces. That one amortises each invoice
-- across the months it covers, so an annual plan billed in March contributes to the
-- following February whether or not the merchant is still a customer. This one asks what
-- was live at the month end and values it. October 2026: $1,015,469 here against
-- $1,069,752 bottom-up, about 5% lower, and in line with the ~$1.00M run-rate the
-- subscription book itself reports.
--
-- MRR_ON_UNPAID_INVOICES IS ONLY MEANINGFUL GOING FORWARD. Chargebee stamps a paid date on
-- an invoice that was written off, so an abandoned invoice from 2023 is indistinguishable
-- from a collected one today. The column reads $0 for every settled month and rises toward
-- the present ($0 in July 2026, $29k in October, $54k for the month in progress) — that is
-- the measurement catching up, not a trend. The daily value is captured into
-- paying-snapshots.json so the at-risk figure accumulates an honest history from here.
--
-- ONE ROW PER MONTH END from 2022-01 to the last complete month, PLUS one row for
-- YESTERDAY, labelled with the current month, as the in-progress reading.
--
-- CHANGED FROM THE SPEC AS SUPPLIED: the month filter was written as a QUALIFY, which
-- Snowflake rejects without a window function ("found QUALIFY clause but no window
-- function"). It is a plain WHERE on a subquery here — identical rows, and the only
-- alteration to the query as given.
--
-- OUT OF SCOPE, and deliberately not changed: mrrByCountryByMonth, ARPC by country and the
-- cohort MRR series all still come from the bottom-up query, so they will NOT sum to this
-- headline. meta.notes on the dashboard says so.
-- =================================================================

WITH months AS (
  -- QUALIFY needs a window function in Snowflake, so the month-end filter is a plain WHERE
  -- on a subquery. Same rows, same order; see the header note.
  SELECT MEND FROM (
    SELECT LAST_DAY(DATEADD('month', SEQ4(), '2022-01-01'::DATE)) AS MEND
    FROM TABLE(GENERATOR(ROWCOUNT => 200))
  ) WHERE MEND < DATE_TRUNC('month', CURRENT_DATE())
  UNION ALL
  SELECT DATEADD('day', -1, CURRENT_DATE())
),
m AS (SELECT MEND, DATEADD('day', 1, MEND)::TIMESTAMP AS NXT FROM months),
subs AS (
  SELECT LOWER(REGION) AS REGION, ID AS SUB_ID,
         COALESCE(ACTIVATED_AT, CREATED_AT) AS STARTED,
         IFF(LOWER(STATUS) = 'cancelled', CANCELLED_AT, NULL) AS CANCELLED
  FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
  WHERE LOYVERSE_MERCHANT_ID IS NOT NULL AND LOWER(STATUS) <> 'future'
),
lines AS (
  SELECT 'uk' AS REGION, 1 AS SGN, (i.PAID_AT IS NOT NULL) AS PAID, li.value:subscription_id::STRING AS SUB_ID,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PS, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE AS PE,
         i.CURRENCY_CODE AS CUR, li.value:amount::NUMBER / 100.0 AS AMT
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE i.DELETED = FALSE AND i.VOIDED_AT IS NULL
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
  UNION ALL
  SELECT 'eu', 1, (i.PAID_AT IS NOT NULL), li.value:subscription_id::STRING,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE,
         i.CURRENCY_CODE, li.value:amount::NUMBER / 100.0
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE i.DELETED = FALSE AND i.VOIDED_AT IS NULL
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
  UNION ALL
  SELECT 'uk', -1, TRUE, COALESCE(li.value:subscription_id::STRING, c.SUBSCRIPTION_ID),
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE,
         c.CURRENCY_CODE, li.value:amount::NUMBER / 100.0
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CREDIT_NOTE" c
  CROSS JOIN LATERAL FLATTEN(input => c.LINE_ITEMS) li
  WHERE c.DELETED = FALSE AND c.VOIDED_AT IS NULL AND c.CREATE_REASON_CODE = 'Subscription Change'
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
  UNION ALL
  SELECT 'eu', -1, TRUE, COALESCE(li.value:subscription_id::STRING, c.SUBSCRIPTION_ID),
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE, TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE,
         c.CURRENCY_CODE, li.value:amount::NUMBER / 100.0
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CREDIT_NOTE" c
  CROSS JOIN LATERAL FLATTEN(input => c.LINE_ITEMS) li
  WHERE c.DELETED = FALSE AND c.VOIDED_AT IS NULL AND c.CREATE_REASON_CODE = 'Subscription Change'
    AND li.value:entity_type::STRING IN ('plan','addon') AND li.value:amount::NUMBER > 0
),
cov AS (
  SELECT m.MEND, m.NXT, l.REGION, l.SUB_ID, l.SGN, l.PAID,
         l.AMT * CASE l.CUR WHEN 'GBP' THEN 1.34 WHEN 'EUR' THEN 1.16 ELSE 1 END
         / CASE WHEN DATEDIFF('day', l.PS, l.PE) >= 27
                THEN GREATEST(ROUND(DATEDIFF('day', l.PS, l.PE) / 30.4375), 1)
                ELSE GREATEST(DATEDIFF('day', l.PS, l.PE), 1) / 30.4375 END AS MONTHLY_USD
  FROM m JOIN lines l ON l.PS <= m.MEND AND l.PE > m.MEND
)
SELECT TO_CHAR(c.MEND, 'YYYY-MM')                                  AS MONTH,
       ROUND(SUM(IFF(c.SGN = 1, c.MONTHLY_USD, 0)), 2)              AS MRR_GROSS,
       ROUND(SUM(IFF(c.SGN = -1, c.MONTHLY_USD, 0)), 2)             AS PLAN_CHANGE_CREDITS,
       ROUND(SUM(c.SGN * c.MONTHLY_USD), 2)                         AS MRR,
       ROUND(SUM(IFF(c.SGN = 1 AND NOT c.PAID, c.MONTHLY_USD, 0)), 2) AS MRR_ON_UNPAID_INVOICES
FROM cov c
JOIN subs s ON s.REGION = c.REGION AND s.SUB_ID = c.SUB_ID
WHERE s.STARTED < c.NXT AND (s.CANCELLED IS NULL OR s.CANCELLED >= c.NXT)
GROUP BY 1 ORDER BY 1
;
