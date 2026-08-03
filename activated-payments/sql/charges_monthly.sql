-- LOYVERSE PAYMENTS — MONTHLY VOLUME + ACTIVE MERCHANTS (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES
--
-- The monthly twin of charges_daily.sql, feeding the payments Report page. Two grains come back
-- in one pass (single scan of the charges table), discriminated by ROW_KIND:
--   ROW_KIND='ccy'   -> one row per (MONTH, CCY): AMOUNT_MINOR + CNT. pull.js converts
--                       minor->major->USD with the same fixed FX map as charges_daily.sql.
--   ROW_KIND='accts' -> one row per MONTH: ACCOUNTS = COUNT(DISTINCT ACCOUNT).
--
-- WHY THE SECOND GRAIN: charges_daily.sql groups by day+currency only, so "merchants that
-- transacted in month X" was not derivable — only "merchants whose FIRST charge was in month X".
-- The distinct count is deliberately taken per MONTH, not per (MONTH, CCY): a merchant charging
-- in two currencies would otherwise be counted twice when the currency rows are summed.
--
-- Same charge filter as charges_daily.sql (succeeded + paid + captured) so the monthly TPV
-- reconciles with the daily series. Keep the two filters in step.
WITH c AS (
    SELECT TO_VARCHAR(TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED))), 'YYYY-MM') AS m,
           UPPER(TRIM(CURRENCY))                                                 AS ccy,
           ACCOUNT                                                               AS acct,
           AMOUNT                                                                AS amt
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES
    WHERE ACCOUNT IN (/*ACCOUNT_IDS*/)
      AND LOWER(STATUS) = 'succeeded'
      AND PAID = TRUE
      AND CAPTURED = TRUE
      AND TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)) IS NOT NULL
)
SELECT 'ccy'                    AS row_kind,
       m                        AS month,
       ccy                      AS ccy,
       SUM(amt)                 AS amount_minor,
       COUNT(*)                 AS cnt,
       CAST(NULL AS NUMBER)     AS accounts
FROM c
GROUP BY m, ccy
UNION ALL
SELECT 'accts',
       m,
       CAST(NULL AS VARCHAR),
       CAST(NULL AS NUMBER),
       CAST(NULL AS NUMBER),
       COUNT(DISTINCT acct)
FROM c
GROUP BY m
ORDER BY month, row_kind, ccy;
