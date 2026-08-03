-- LOYVERSE PAYMENTS — MONTHLY CAPTURED REVENUE (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_BALANCE_TRANSACTION_FEE_DETAILS
--         joined to GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_BALANCE_TRANSACTIONS for the date
--
-- The monthly twin of app_fees_by_account.sql (which groups by ACCOUNT only and therefore has
-- no time dimension at all). FEE_DETAILS carries NO transaction date — its only timestamp is
-- BATCH_TIMESTAMP, which is the ingestion batch, NOT when the fee occurred. Dating a fee
-- therefore requires the join below: FEE_DETAILS.BALANCE_TRANSACTION_ID -> BALANCE_TRANSACTIONS.ID
-- -> CREATED. Do NOT be tempted to month-truncate BATCH_TIMESTAMP; it would attribute revenue to
-- whenever the pipeline happened to load the row.
--
-- The application-fee lines are exactly what Loyverse (the platform) captured on each connected
-- account charge. Amounts are in the currency's MINOR unit; pull.js converts to USD.
SELECT
    TO_VARCHAR(TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(bt.CREATED))), 'YYYY-MM') AS month,
    UPPER(TRIM(fd.CURRENCY))                                                 AS ccy,
    SUM(fd.AMOUNT)                                                           AS fee_minor,
    COUNT(*)                                                                 AS fee_cnt
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_BALANCE_TRANSACTION_FEE_DETAILS fd
JOIN GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_BALANCE_TRANSACTIONS bt
  ON bt.ID = fd.BALANCE_TRANSACTION_ID
WHERE fd.ACCOUNT IN (/*ACCOUNT_IDS*/)
  AND LOWER(fd.TYPE) = 'application_fee'
  AND TRY_TO_TIMESTAMP(TO_VARCHAR(bt.CREATED)) IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;
