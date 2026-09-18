-- =================================================================
-- MERCHANT-LEVEL SUBSCRIPTION ARRIVALS AND DEPARTURES, per CALENDAR MONTH
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- The merchant-grain twin of subscription_flow_monthly.sql, and it exists because the two
-- must never be mixed in one chart. A merchant holding three features contributes three
-- rows there and one row here; plotting one against the other overstates departures by
-- about two thirds (Aug 2026: 4,376 subscriptions cancelled, 2,610 merchants actually left).
--
-- DEFINITIONS, chosen to be the honest merchant-grain analogue rather than the convenient one:
--   ADDS    the month a merchant's FIRST subscription starts. Not "any subscription started",
--           which would count an existing customer adding a second feature as a new merchant.
--   CANCELS the month a merchant's LAST remaining subscription is cancelled — i.e. when it
--           goes from holding something to holding nothing. A merchant who drops one feature
--           of three has not left and does not appear here; that event is visible only on
--           the subscription chart, which is the reason both charts exist.
--
-- RELATIONSHIP TO daily_paying_flow_grace_vs_raw.sql: none, deliberately. That query infers
-- the paying base from invoices with a 30-day grace, so its adds and churn are about money
-- arriving and stopping. This is about subscriptions existing. The page keeps the two on
-- one chart behind a toggle, and switches BOTH series together — mixing an invoice-derived
-- add with a Chargebee-derived cancel would be the same grain error one level up.
--
-- Future-dated and `future`-status rows are excluded on the same rule as the subscription
-- query: a scheduled end inside a paid term has not happened.
-- =================================================================

WITH subs AS (
    SELECT LOYVERSE_MERCHANT_ID                           AS MID,
           COALESCE(ACTIVATED_AT, CREATED_AT)             AS STARTED,
           IFF(LOWER(STATUS) = 'cancelled'
               AND CANCELLED_AT <= CURRENT_TIMESTAMP(),
               CANCELLED_AT, NULL)                        AS CANCELLED
    FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
    WHERE LOYVERSE_MERCHANT_ID IS NOT NULL
      AND LOWER(STATUS) <> 'future'
      AND COALESCE(ACTIVATED_AT, CREATED_AT) <= CURRENT_TIMESTAMP()
),
arrivals AS (
    SELECT DATE_TRUNC('MONTH', MIN(STARTED))::DATE AS MONTH, MID
    FROM subs GROUP BY MID
),
departures AS (
    -- HAVING COUNT_IF(CANCELLED IS NULL) = 0 is the whole definition: every subscription the
    -- merchant ever held must be cancelled before the merchant counts as gone. One live
    -- subscription anywhere keeps them in the base.
    SELECT DATE_TRUNC('MONTH', MAX(CANCELLED))::DATE AS MONTH, MID
    FROM subs GROUP BY MID
    HAVING COUNT_IF(CANCELLED IS NULL) = 0
)
SELECT COALESCE(a.MONTH, d.MONTH) AS MONTH,
       COALESCE(a.N, 0)           AS ADDS,
       COALESCE(d.N, 0)           AS CANCELS,
       COALESCE(a.N, 0) - COALESCE(d.N, 0) AS NET
FROM      (SELECT MONTH, COUNT(*) AS N FROM arrivals   GROUP BY MONTH) a
FULL OUTER JOIN (SELECT MONTH, COUNT(*) AS N FROM departures GROUP BY MONTH) d
  ON d.MONTH = a.MONTH
WHERE COALESCE(a.MONTH, d.MONTH) IS NOT NULL
ORDER BY MONTH;
