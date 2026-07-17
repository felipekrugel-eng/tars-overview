-- LOYVERSE PAYMENTS — CONNECTED ACCOUNT METADATA (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS_METADATA
--
-- CONNECTED_ACCOUNTS_METADATA is a key/value table: one row per (ACCOUNT_ID, KEY).
-- The KEY 'owner_id' carries the REAL Loyverse merchant/owner id (numeric, e.g. 4988970)
-- that Loyverse stamps on each connected Stripe account — this is the true per-merchant
-- linkage (CONNECTED_ACCOUNTS.MERCHANT_ID is only the platform account id and is constant).
-- The KEY 'environment' carries 'prod' vs 'test', i.e. the real-vs-test account signal.
-- Pivoting to one row per account gives the dashboard its linkage + environment columns.
SELECT
    ACCOUNT_ID                                            AS acct,
    MAX(CASE WHEN LOWER(KEY) = 'owner_id'    THEN VALUE END) AS owner_id,
    MAX(CASE WHEN LOWER(KEY) = 'environment' THEN VALUE END) AS environment,
    MAX(CASE WHEN LOWER(KEY) = 'release'     THEN VALUE END) AS release_date
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS_METADATA
GROUP BY ACCOUNT_ID;
