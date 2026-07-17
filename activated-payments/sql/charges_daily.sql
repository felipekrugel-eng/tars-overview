-- LOYVERSE PAYMENTS — DAILY TERMINAL VOLUME layer (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES
--
-- Real money processed on Loyverse Payments terminals. One row per (day, currency):
-- gross amount of SUCCESSFUL, PAID, CAPTURED charges in the currency's minor unit
-- (Stripe stores AMOUNT in the smallest unit — cents for 2-decimal currencies, whole
-- units for zero-decimal currencies like JPY/KRW/VND). pull.js converts minor→major
-- and then to USD (fixed FX map, same as the FACADASH TPV layer) and sums per day.
--
-- Scoped to the payments-activated PROD accounts we render (Stripe acct_ ids injected
-- at runtime from CONNECTED_ACCOUNTS_METADATA environment='prod' — NO hardcoded ids).
-- CREATED is normalised via TRY_TO_TIMESTAMP(TO_VARCHAR(...)) so it works whether the
-- share exposes CREATED as a timestamp or as unix-epoch seconds.
SELECT
    TO_VARCHAR(TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED))), 'YYYY-MM-DD') AS d,
    UPPER(TRIM(CURRENCY))                                                    AS ccy,
    SUM(AMOUNT)                                                              AS amount_minor,
    COUNT(*)                                                                 AS cnt
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES
WHERE ACCOUNT IN (/*ACCOUNT_IDS*/)
  AND LOWER(STATUS) = 'succeeded'
  AND PAID = TRUE
  AND CAPTURED = TRUE
  AND TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)) IS NOT NULL
GROUP BY 1, 2
ORDER BY 1;
