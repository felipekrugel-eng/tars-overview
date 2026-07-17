-- LOYVERSE PAYMENTS — POS receipts layer (automation-safe)
-- Source: LOYVERSE_DATA_LAKE.PUBLIC.SALES_PER_ACCOUNT_MONTHLY
--
-- Pre-aggregated monthly receipt counts per Loyverse merchant. Filtered to only the
-- payments-activated merchants we render (id list injected at runtime — NO hardcoded ids).
-- Collapsed to one row per merchant: total receipts, number of active months, and the
-- most recent active month (proxy for last_sale until per-receipt GTV is wired).
SELECT
    LOYVERSE_MERCHANT_ID        AS merchant_id,
    SUM(TOTAL_SALES_COUNT)      AS receipts,
    COUNT(DISTINCT MONTH)       AS active_months,
    MAX(MONTH)                  AS last_month
FROM LOYVERSE_DATA_LAKE.PUBLIC.SALES_PER_ACCOUNT_MONTHLY
WHERE LOYVERSE_MERCHANT_ID IN (/*MERCHANT_IDS*/)
GROUP BY LOYVERSE_MERCHANT_ID;
