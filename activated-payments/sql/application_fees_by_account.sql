-- LOYVERSE PAYMENTS — PER-MERCHANT CAPTURED REVENUE layer (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_APPLICATION_FEES
--
-- The application fee is what Loyverse (the platform) collects on top of each connected-account
-- charge — i.e. the money "we have captured from it". One row per (connected account, currency):
--   fee_minor    = SUM(AMOUNT)           gross application fees captured (currency minor unit)
--   refund_minor = SUM(AMOUNT_REFUNDED)  application fees refunded back
-- pull.js converts minor→major→USD (same fixed FX map) and computes captured = fee − refund per
-- account, and the effective take-rate = captured / processed-volume.
--
-- Scoped to the payments-activated PROD accounts we render (Stripe acct_ ids injected at runtime
-- from CONNECTED_ACCOUNTS_METADATA environment='prod' — NO hardcoded ids). Standard Stripe
-- application-fee schema (ACCOUNT / AMOUNT / AMOUNT_REFUNDED / CURRENCY); if the share exposes
-- different column names the query fails softly (allSettled in pull.js) and _discovery.json's
-- describe of this object confirms the real names for a fast follow.
SELECT
    ACCOUNT                        AS account,
    UPPER(TRIM(CURRENCY))          AS ccy,
    SUM(AMOUNT)                    AS fee_minor,
    SUM(COALESCE(AMOUNT_REFUNDED, 0)) AS refund_minor,
    COUNT(*)                       AS fee_cnt
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_APPLICATION_FEES
WHERE ACCOUNT IN (/*ACCOUNT_IDS*/)
GROUP BY 1, 2;
