-- LOYVERSE PAYMENTS — PER-MERCHANT STRIPE COST (automation-safe, NO hardcoded IDs)
-- Source: ...STRIPE.ICPLUS_FEES
--
-- Interchange-plus fees Stripe bills Loyverse for processing each connected account's
-- transactions (stripe_fee, network_cost, etc.) — Loyverse's COST of payments. Netting this
-- against the captured application fees gives "our margin".
--   cost_minor = SUM(TOTAL_AMOUNT) in the fee's own currency, MINOR unit / cents.
--   TOTAL_AMOUNT is stored in cents: e.g. a volume_fee of 0.675 = 0.675¢ = $0.00675
--   (0.1% of a $6.75 charge); interchange summed across all charges ≈ 1.80% of volume.
-- pull.js converts minor→major→USD (fixed FX map, ÷100) per (account, currency) and
-- computes margin = captured − cost.
--
-- Scoped to the payments-activated PROD accounts we render (acct_ ids injected at runtime
-- from CONNECTED_ACCOUNTS_METADATA environment='prod' — NO hardcoded ids).
SELECT
    CONNECTED_ACCOUNT_ID        AS account,
    UPPER(TRIM(FEE_CURRENCY))   AS ccy,
    SUM(TOTAL_AMOUNT)           AS cost_minor,
    COUNT(*)                    AS cost_cnt
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ICPLUS_FEES
WHERE CONNECTED_ACCOUNT_ID IN (/*ACCOUNT_IDS*/)
GROUP BY 1, 2;
