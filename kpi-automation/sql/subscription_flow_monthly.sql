-- =================================================================
-- SUBSCRIPTION GROSS ADDS AND CANCELLATIONS, per CALENDAR MONTH x FEATURE x TERM
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- Counts SUBSCRIPTIONS, not merchants. A merchant who takes three features is three
-- rows here and one row on the paying-base flow chart above it. That is the whole point
-- of this query: 12,995 merchants hold two active subscriptions and 3,173 hold three,
-- so merchant-level churn cannot see a merchant dropping one feature of three, which is
-- the most common way revenue leaks.
--
-- DIFFERENT SOURCE FROM THE CHURN CHART ABOVE, and deliberately so:
--   * daily_paying_flow_grace_vs_raw.sql infers churn from INVOICES -- a merchant is gone
--     once 30 days past their last paid period. It answers "did the money stop", which is
--     the right question for a paying base, and it is late by construction.
--   * this reads Chargebee's own subscription lifecycle. A cancellation is an event with a
--     date, not an inference from silence, so it lands in the month it happened.
-- The two will NOT agree, and neither is wrong. The page says which is which.
--
-- FUTURE-DATED CANCELLATIONS ARE EXCLUDED. `non_renewing` subscriptions carry a
-- CANCELLED_AT in the future -- the scheduled end of a term the merchant has already paid
-- for (1,102 of them as of Sep 2026). Counting those as cancellations would book a churn
-- that has not happened and, worse, would book it in a month that has not happened. Only
-- status='cancelled' with a date at or before today counts.
--
-- ADDS use ACTIVATED_AT, falling back to CREATED_AT. A subscription created but never
-- activated (status='future') has not started paying and is not an add yet; the fallback
-- only catches rows where Chargebee left ACTIVATED_AT null on a subscription that did go
-- live, which the region feeds do inconsistently.
--
-- PLAN ID SHAPE is documented in mrr_by_feature_monthly.sql; the FEATURE/TERM parsing here
-- is identical so the two datasets bucket the same way and can be read side by side.
-- =================================================================

WITH subs AS (
    SELECT ID,
           LOWER(STATUS)                                                      AS STATUS,
           UPPER(COALESCE(NULLIF(SPLIT_PART(PLAN_ID, '_', 2), ''), 'OTHER'))  AS FEATURE_RAW,
           SPLIT_PART(PLAN_ID, '_', 3)                                        AS TERM_RAW,
           COALESCE(ACTIVATED_AT, CREATED_AT)                                 AS STARTED_AT,
           CANCELLED_AT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
),
tagged AS (
    SELECT ID, STATUS, STARTED_AT, CANCELLED_AT,
           CASE WHEN FEATURE_RAW IN ('SALESHISTORY','EMPLOYEE','INVENTORY','INTEGRATION','EMPSTORE')
                THEN FEATURE_RAW ELSE 'OTHER' END AS FEATURE,
           CASE WHEN TERM_RAW = '1'  THEN 'monthly'
                WHEN TERM_RAW = '12' THEN 'annual'
                ELSE 'other' END                  AS TERM
    FROM subs
),
adds AS (
    SELECT DATE_TRUNC('MONTH', STARTED_AT)::DATE AS MONTH, FEATURE, TERM, COUNT(*) AS N
    FROM tagged
    WHERE STARTED_AT IS NOT NULL
      AND STATUS <> 'future'                      -- not started paying yet
      AND STARTED_AT <= CURRENT_TIMESTAMP()
    GROUP BY 1,2,3
),
cancels AS (
    SELECT DATE_TRUNC('MONTH', CANCELLED_AT)::DATE AS MONTH, FEATURE, TERM, COUNT(*) AS N
    FROM tagged
    WHERE CANCELLED_AT IS NOT NULL
      AND STATUS = 'cancelled'                    -- excludes non_renewing scheduled ends
      AND CANCELLED_AT <= CURRENT_TIMESTAMP()
    GROUP BY 1,2,3
),
-- Full outer join so a month with adds but no cancellations (or the reverse) still
-- produces a row. Left as a join rather than a spine because both sides are dense.
joined AS (
    SELECT COALESCE(a.MONTH, c.MONTH)     AS MONTH,
           COALESCE(a.FEATURE, c.FEATURE) AS FEATURE,
           COALESCE(a.TERM, c.TERM)       AS TERM,
           COALESCE(a.N, 0)               AS ADDS,
           COALESCE(c.N, 0)               AS CANCELS
    FROM adds a
    FULL OUTER JOIN cancels c
      ON c.MONTH = a.MONTH AND c.FEATURE = a.FEATURE AND c.TERM = a.TERM
)
SELECT MONTH, FEATURE, TERM, ADDS, CANCELS, ADDS - CANCELS AS NET
FROM joined
WHERE MONTH IS NOT NULL
ORDER BY MONTH, FEATURE, TERM;
