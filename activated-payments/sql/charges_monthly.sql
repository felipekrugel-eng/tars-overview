-- LOYVERSE PAYMENTS — MONTHLY VOLUME + ACTIVE MERCHANTS (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES
--
-- The monthly twin of charges_daily.sql, feeding the payments Report page. Two grains come back
-- in one pass (single scan of the charges table), discriminated by ROW_KIND:
--   ROW_KIND='ccy'   -> one row per (MONTH, CCY, ACCT): AMOUNT_MINOR + CNT. pull.js converts
--                       minor->major->USD with the same fixed FX map as charges_daily.sql.
--   ROW_KIND='accts' -> one row per (MONTH, ACCT): the merchants that transacted that month.
--
-- WHY THE SECOND GRAIN: charges_daily.sql groups by day+currency only, so "merchants that
-- transacted in month X" was not derivable — only "merchants whose FIRST charge was in month X".
-- The distinct count is deliberately taken per MONTH, not per (MONTH, CCY): a merchant charging
-- in two currencies would otherwise be counted twice when the currency rows are summed.
--
-- ACCOUNT IN THE GRAIN (added 2026-08-17, UK launch): both branches now carry ACCT so pull.js can
-- attribute each month's volume, count and active-merchant count to the merchant's country (from
-- CONNECTED_ACCOUNTS.COUNTRY) and split the Report page by market. The 'accts' branch emits one
-- row per (MONTH, ACCT) rather than a pre-aggregated COUNT(DISTINCT acct), because a blended
-- distinct count cannot be decomposed after the fact; pull.js does the distinct count itself, per
-- country AND in total, so the blended figure is unchanged.
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
       acct                     AS acct,
       SUM(amt)                 AS amount_minor,
       COUNT(*)                 AS cnt,
       CAST(NULL AS NUMBER)     AS accounts
FROM c
GROUP BY m, ccy, acct
UNION ALL
SELECT 'accts',
       m,
       CAST(NULL AS VARCHAR),
       acct,
       CAST(NULL AS NUMBER),
       CAST(NULL AS NUMBER),
       1
FROM c
GROUP BY m, acct
ORDER BY month, row_kind, ccy;
