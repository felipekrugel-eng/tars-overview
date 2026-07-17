-- LOYVERSE PAYMENTS — PER-MERCHANT TRANSACTING layer (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES
--
-- Feeds the "Merchants transacting through Loyverse Payments" table on the Overview page.
-- One row per (connected account, currency) covering SUCCESSFUL, PAID, CAPTURED charges:
--   started  = first real charge (MIN created)      → "date it started"
--   cnt      = number of successful charges          → "number of transactions"
--   amount_minor = gross processed in currency minor → "volume processed so far" (USD in pull.js)
-- pull.js converts minor→major→USD (fixed FX map, same as the daily volume + FACADASH layers)
-- and rolls the per-currency rows up to a single per-account total.
--
-- Scoped to the payments-activated PROD accounts we render (Stripe acct_ ids injected at
-- runtime from CONNECTED_ACCOUNTS_METADATA environment='prod' — NO hardcoded ids).
SELECT
    ACCOUNT                                                                  AS account,
    UPPER(TRIM(CURRENCY))                                                    AS ccy,
    MIN(TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)))                              AS started,
    COUNT(*)                                                                 AS cnt,
    SUM(AMOUNT)                                                              AS amount_minor
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES
WHERE ACCOUNT IN (/*ACCOUNT_IDS*/)
  AND LOWER(STATUS) = 'succeeded'
  AND PAID = TRUE
  AND CAPTURED = TRUE
  AND TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)) IS NOT NULL
GROUP BY 1, 2;
