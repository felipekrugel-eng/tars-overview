-- LOYVERSE PAYMENTS — MONTHLY STRIPE COST (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ICPLUS_FEES
--
-- The monthly twin of icplus_cost_by_account.sql. Interchange-plus fees Stripe bills Loyverse
-- for processing each connected account's transactions — Loyverse's COST of payments. Netting
-- this against the captured application fees gives margin.
--
-- DATE COLUMN CHOICE: this table exposes BALANCE_TRANSACTION_CREATED_AT, ATTRIBUTION_START_TIME
-- and FEE_TRANSACTION_CREATED_AT. Attribution/fee-transaction times are NULL in the share as
-- sampled (see _discovery.json), so BALANCE_TRANSACTION_CREATED_AT is the only reliably
-- populated one and leads the COALESCE. That dates the cost to when it hit the balance, which
-- can lag the underlying charge by a day or two — so month-boundary charges may land their cost
-- in the following month. Immaterial at monthly grain; do not use this for daily margin.
--
-- TOTAL_AMOUNT is stored in cents (e.g. a volume_fee of 0.675 = 0.675c), consistent with
-- icplus_cost_by_account.sql. pull.js applies the same minor->USD conversion.
--
-- ACCOUNT IN THE GRAIN (added 2026-08-17, UK launch): CONNECTED_ACCOUNT_ID joins to
-- CONNECTED_ACCOUNTS and therefore to the merchant's country, letting pull.js split monthly cost
-- by market. Summing over ACCT reproduces exactly what this query returned before.
SELECT
    TO_VARCHAR(TO_DATE(COALESCE(
        TRY_TO_TIMESTAMP(TO_VARCHAR(BALANCE_TRANSACTION_CREATED_AT)),
        TRY_TO_TIMESTAMP(TO_VARCHAR(ATTRIBUTION_START_TIME)),
        TRY_TO_TIMESTAMP(TO_VARCHAR(FEE_TRANSACTION_CREATED_AT))
    )), 'YYYY-MM')                          AS month,
    UPPER(TRIM(FEE_CURRENCY))               AS ccy,
    CONNECTED_ACCOUNT_ID                    AS acct,
    SUM(TOTAL_AMOUNT)                       AS cost_minor,
    COUNT(*)                                AS cost_cnt
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ICPLUS_FEES
WHERE CONNECTED_ACCOUNT_ID IN (/*ACCOUNT_IDS*/)
  AND COALESCE(
        TRY_TO_TIMESTAMP(TO_VARCHAR(BALANCE_TRANSACTION_CREATED_AT)),
        TRY_TO_TIMESTAMP(TO_VARCHAR(ATTRIBUTION_START_TIME)),
        TRY_TO_TIMESTAMP(TO_VARCHAR(FEE_TRANSACTION_CREATED_AT))
      ) IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1, 2;
