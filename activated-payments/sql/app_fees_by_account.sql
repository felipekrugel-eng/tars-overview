-- LOYVERSE PAYMENTS — PER-MERCHANT CAPTURED REVENUE (automation-safe, NO hardcoded IDs)
-- Source: ...STRIPE.CONNECTED_ACCOUNT_BALANCE_TRANSACTION_FEE_DETAILS
--
-- The application-fee lines here ("Loyverse UK Connect application fee") are exactly what
-- Loyverse (the platform) captured on each connected-account charge — the "amount we have
-- captured from it". The dedicated CONNECTED_ACCOUNT_APPLICATION_FEES view is empty in this
-- share, so the fee-detail breakdown is the authoritative source.
--   fee_minor = SUM(AMOUNT) in the currency's minor unit (18 = $0.18)
-- pull.js converts minor→major→USD (same fixed FX map as volume) per (account, currency).
--
-- Scoped to the payments-activated PROD accounts we render (acct_ ids injected at runtime
-- from CONNECTED_ACCOUNTS_METADATA environment='prod' — NO hardcoded ids).
SELECT
    ACCOUNT                 AS account,
    UPPER(TRIM(CURRENCY))   AS ccy,
    SUM(AMOUNT)             AS fee_minor,
    COUNT(*)                AS fee_cnt
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_BALANCE_TRANSACTION_FEE_DETAILS
WHERE ACCOUNT IN (/*ACCOUNT_IDS*/)
  AND LOWER(TYPE) = 'application_fee'
GROUP BY 1, 2;
