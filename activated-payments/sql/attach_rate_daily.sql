-- =================================================================
-- LOYVERSE PAYMENTS ATTACHMENT RATE — daily, per merchant
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- Of the money crossing a till on a given day, how much came through Loyverse Payments.
--
-- THE DEFINITION IS NOT NEW. merchant-base-automation/queries/q1_base.sql already computes
-- PAYMENTS_ATTACH_RATE_L30D per merchant and the campaign runs on it; this query is that
-- definition with a date axis instead of a single 30-day window. Every rule is carried
-- across deliberately:
--   * denominator is POS GTV from LOYVERSE_RECEIPTS, USD only
--   * TOTAL_MONEY's unit is MEASURED, not assumed — see gtv_unit below
--   * the per-merchant rate is capped at 1.0, because a rate above 100% is a data fault
--     and should not be allowed to average other merchants upward
--   * a day with no till volume yields NULL, not 0%: "none of it came through us" and
--     "there was nothing to come through us" are different answers
-- If the campaign definition changes, change both. They are meant to agree.
--
-- ONLY FROM EACH MERCHANT'S FIRST LOYVERSE PAYMENTS CHARGE ONWARD. A merchant's till
-- volume from before they had a terminal is not volume we failed to attach — counting it
-- would drag the rate down and then make it appear to climb as old months age out, which
-- is an artefact of joining dates rather than anything anyone did. So a merchant enters
-- numerator and denominator on the same day.
--
-- COST. LOYVERSE_RECEIPTS has no clustering key, so filtering to ~100 merchants still
-- reads the whole table: this costs the same as asking for everyone. It is written as its
-- own query for clarity, but if the daily budget tightens it should be folded into
-- kpi-automation/sql/country_month_activity.sql, which already makes that pass.
--
-- Output is one row per merchant per day — a few thousand rows. The blended rate, the
-- median and the rolling windows are all computed in the build step, from these rows, so
-- there is exactly one place where "attachment rate" is defined and one place where it is
-- aggregated.
-- =================================================================

WITH accounts AS (
    -- Stripe accounts we render, with their Loyverse owner id. Same metadata pivot the
    -- rest of the payments pipeline uses; environment filtering happens in pull.js, which
    -- owns that rule for every layer.
    SELECT ACCOUNT_ID,
           TRY_TO_NUMBER(MAX(CASE WHEN LOWER(KEY) = 'owner_id' THEN VALUE END)) AS MERCHANT_ID
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS_METADATA
    GROUP BY 1
),
-- Daily Loyverse Payments volume per merchant. Successful captured charges only, which is
-- the same set charges_daily.sql reports, so the two cannot disagree about what a charge is.
lp_daily AS (
    SELECT a.MERCHANT_ID,
           TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)))               AS D,
           SUM(c.AMOUNT / POWER(10, COALESCE(cur.MINOR_UNITS, 2)))        AS LP_USD,
           COUNT(*)                                                       AS LP_TXNS
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES c
    JOIN accounts a ON a.ACCOUNT_ID = c.ACCOUNT
    -- USD only, matching the denominator. The payments book is US and UK today; GBP volume
    -- is excluded here rather than converted, because mixing a converted numerator with a
    -- USD-only denominator would silently inflate the rate for UK merchants.
    LEFT JOIN (SELECT 'usd' AS CODE, 2 AS MINOR_UNITS) cur ON cur.CODE = LOWER(c.CURRENCY)
    WHERE LOWER(c.STATUS) = 'succeeded'
      AND c.PAID = TRUE
      AND c.CAPTURED = TRUE
      AND LOWER(c.CURRENCY) = 'usd'
      AND a.MERCHANT_ID IS NOT NULL
    GROUP BY 1, 2
),
-- The day each merchant first took a Loyverse Payments charge. Everything before it is
-- out of scope for both sides of the ratio.
lp_start AS (
    SELECT MERCHANT_ID, MIN(D) AS FIRST_LP_DAY
    FROM lp_daily
    WHERE LP_USD > 0
    GROUP BY 1
),
-- UNIT SAFEGUARD, lifted verbatim in spirit from q1_base.sql. The library disagrees with
-- itself about TOTAL_MONEY, so the scale is measured rather than assumed: a median card
-- ticket above $1,000 is not credible for this base, so if the observed median clears that
-- bar the column is in minor units and gets divided by 100. Carried out as a column so the
-- decision is visible rather than buried here.
gtv_unit AS (
    SELECT APPROX_PERCENTILE(r.TOTAL_MONEY, 0.5) AS MEDIAN_TICKET_RAW,
           COALESCE(IFF(APPROX_PERCENTILE(r.TOTAL_MONEY, 0.5) > 1000, 0.01, 1.0), 1.0) AS GTV_SCALE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
    WHERE r.RECEIPT_DATE >= TO_VARCHAR(DATEADD('day', -30, CURRENT_DATE()))
      AND UPPER(TRIM(r.CURRENCY)) = 'USD'
      AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
),
-- Daily till volume for those merchants, from their first LP charge onward. Cleaning rules
-- are the canonical ones: no refunds, no cancellations, no zero rows, USD only, and the
-- $10k per-receipt cap that q1_base.sql applies — kept to a separate column so the capping
-- stays auditable rather than silently swallowing a whale.
pos_daily AS (
    SELECT r.MERCHANT_ID,
           TRY_TO_DATE(r.RECEIPT_DATE)                                 AS D,
           SUM(LEAST(r.TOTAL_MONEY * gu.GTV_SCALE, 10000))             AS POS_USD,
           SUM(r.TOTAL_MONEY * gu.GTV_SCALE)                           AS POS_USD_UNCAPPED,
           COUNT(*)                                                    AS POS_RECEIPTS
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
    CROSS JOIN gtv_unit gu
    JOIN lp_start s ON s.MERCHANT_ID = r.MERCHANT_ID
    WHERE r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
      AND UPPER(TRIM(r.CURRENCY)) = 'USD'
      AND TRY_TO_DATE(r.RECEIPT_DATE) >= s.FIRST_LP_DAY
      AND TRY_TO_DATE(r.RECEIPT_DATE) <= CURRENT_DATE()
    GROUP BY 1, 2
)
-- FULL OUTER so a day appears whether the till ran without us (rate 0) or we took a charge
-- the receipts feed has not caught up with (rate NULL rather than a silent 100%).
SELECT COALESCE(p.MERCHANT_ID, l.MERCHANT_ID)       AS MERCHANT_ID,
       COALESCE(p.D, l.D)                           AS D,
       ROUND(COALESCE(l.LP_USD, 0), 2)              AS LP_USD,
       COALESCE(l.LP_TXNS, 0)                       AS LP_TXNS,
       ROUND(COALESCE(p.POS_USD, 0), 2)             AS POS_USD,
       ROUND(COALESCE(p.POS_USD_UNCAPPED, 0), 2)    AS POS_USD_UNCAPPED,
       COALESCE(p.POS_RECEIPTS, 0)                  AS POS_RECEIPTS
FROM pos_daily p
FULL OUTER JOIN lp_daily l
  ON l.MERCHANT_ID = p.MERCHANT_ID AND l.D = p.D
WHERE COALESCE(p.D, l.D) IS NOT NULL
  AND COALESCE(p.D, l.D) >= (SELECT MIN(FIRST_LP_DAY) FROM lp_start)
ORDER BY 2, 1;
