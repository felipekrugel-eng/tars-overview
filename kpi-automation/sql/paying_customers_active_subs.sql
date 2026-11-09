-- =================================================================
-- PAYING CUSTOMERS — live count, one row
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- THE DEFINITION, as Alex reports it and as the dashboard now headlines:
--   a paying customer is a distinct LOYVERSE_MERCHANT_ID with at least one subscription
--   currently in status 'active' or 'non_renewing'.
--
-- DISTINCT MERCHANT, NOT SUBSCRIPTION. A merchant on three features is one paying
-- customer, not three. The subscription count is roughly a third higher and is a
-- different question.
--
-- non_renewing IS INCLUDED. Those subscriptions are inside a paid term that has been told
-- not to renew: the merchant has paid for the period they are in, so they are paying
-- today and will drop out by themselves when the term ends. Excluding them would report
-- churn before it happened.
--
-- 'paused' and 'future' are NOT included — paused is not currently billing, and future
-- has not started.
--
-- THIS REPLACES the invoice-derived PAYING_MERCHANTS from mrr_bottomup_monthly.sql as the
-- headline. That number is still published as `payingInvoice` and still drives ARPC,
-- because ARPC divides an invoice-based MRR and both halves of a ratio have to come from
-- the same population.
--
-- There is no month grain here: the view carries current status only, so this is a
-- snapshot of today. History is a separate problem solved by paying_customers_backfill.sql
-- and by the frozen month closes in "KPI Dashboard v2 (Caio)/paying-snapshots.json".
-- =================================================================

SELECT
    CURRENT_DATE()                              AS SNAPSHOT_DATE,
    COUNT(DISTINCT LOYVERSE_MERCHANT_ID)        AS PAYING_CUSTOMERS
FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
WHERE LOYVERSE_MERCHANT_ID IS NOT NULL
  AND LOWER(STATUS) IN ('active', 'non_renewing');
