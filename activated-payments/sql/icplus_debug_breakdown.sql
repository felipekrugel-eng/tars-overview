-- TEMPORARY DIAGNOSTIC — ICPLUS_FEES cost composition for the payments-activated
-- PROD accounts. Groups by fee category / name / event so we can see which fee rows
-- inflate the per-merchant Stripe cost (e.g. fixed per_auth_fee vs per-txn interchange).
-- NOT part of the production data model; used once to define the correct cost filter.
-- Account ids injected at runtime from CONNECTED_ACCOUNTS_METADATA (NO hardcoded ids).
SELECT
    FEE_CATEGORY                       AS fee_category,
    FEE_NAME                           AS fee_name,
    EVENT_TYPE                         AS event_type,
    UPPER(TRIM(FEE_CURRENCY))          AS ccy,
    COUNT(*)                           AS n,
    SUM(TOTAL_AMOUNT)                  AS total_major,
    MIN(TOTAL_AMOUNT)                  AS min_major,
    MAX(TOTAL_AMOUNT)                  AS max_major
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ICPLUS_FEES
WHERE CONNECTED_ACCOUNT_ID IN (/*ACCOUNT_IDS*/)
GROUP BY 1, 2, 3, 4
ORDER BY total_major DESC;
