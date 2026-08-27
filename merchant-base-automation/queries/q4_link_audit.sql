-- q4_link_audit.sql
-- ONE QUERY PER FILE. Split out of US_Merchant_Base_Refresh_Snowflake.sql,
-- which stacked Q0-Q4 in a single file against the standing rule
-- 'never stack two queries in one file'.
--
-- Shared run context (from the original preamble):
--   account ORXEAZX-TC97659 · user TARS_SERVICE_USER · role DATA_VIEWER
--   warehouse COMPUTE_WH (statement timeout 3600s)
--   database LOYVERSE_DATA_LAKE · schema PUBLIC
-- Run order: q0 once (cheap) -> q1 (the base) -> q2 (receipts, slow)
--            -> q3 + q4 to reconcile. q1 is the only one the pipeline needs.
-- ============================================================================

-- Q4 — LINK AUDIT. Run this WITH Q1, every time. It is the honesty check on the
-- inferred Stripe <-> Loyverse link.
--
-- (a) How many US Stripe accounts linked, and by which method.
-- (b) The ones that did NOT link — listed in full, with their identifying
--     fields, so they can be matched by hand instead of silently vanishing from
--     the base. 682 accounts is a small enough universe to eyeball.
--
-- Any account appearing in (b) is a merchant whose payments activity exists in
-- Stripe but is invisible in the workbook. That gap should be zero, or known.
-- ===========================================================================
WITH stripe_acct AS (
    SELECT
        a.ID                                            AS STRIPE_ACCOUNT_ID,
        a.CREATED                                       AS CONNECTED_AT,
        a.CHARGES_ENABLED,
        COALESCE(a.SUPPORT_EMAIL, a.EMAIL)              AS ACCOUNT_EMAIL,
        COALESCE(a.BUSINESS_NAME,
                 a.LEGAL_ENTITY_BUSINESS_NAME,
                 a.DISPLAY_NAME)                        AS ACCOUNT_NAME,
        LOWER(TRIM(COALESCE(a.EMAIL, a.SUPPORT_EMAIL))) AS LINK_EMAIL,
        LOWER(TRIM(COALESCE(a.BUSINESS_NAME,
                            a.LEGAL_ENTITY_BUSINESS_NAME,
                            a.DISPLAY_NAME)))           AS LINK_NAME
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS a
    WHERE UPPER(TRIM(a.COUNTRY)) = 'US'
),
loyverse_email AS (
    SELECT LOWER(TRIM(m.EMAIL)) AS LINK_EMAIL, COUNT(*) AS N_MERCHANTS, MIN(m.LOYVERSE_ID) AS LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US' AND m.EMAIL IS NOT NULL AND TRIM(m.EMAIL) <> ''
    GROUP BY 1
),
loyverse_name AS (
    SELECT LOWER(TRIM(m.BUSINESS_NAME)) AS LINK_NAME, COUNT(*) AS N_MERCHANTS, MIN(m.LOYVERSE_ID) AS LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US' AND m.BUSINESS_NAME IS NOT NULL AND TRIM(m.BUSINESS_NAME) <> ''
    GROUP BY 1
),
audit AS (
    SELECT
        sa.STRIPE_ACCOUNT_ID,
        sa.ACCOUNT_NAME,
        sa.ACCOUNT_EMAIL,
        sa.CONNECTED_AT,
        sa.CHARGES_ENABLED,
        COALESCE(le.LOYVERSE_ID, ln.LOYVERSE_ID) AS LOYVERSE_ID,
        CASE
            WHEN le.LOYVERSE_ID IS NOT NULL AND le.N_MERCHANTS = 1 THEN 'Email (exact)'
            WHEN le.LOYVERSE_ID IS NOT NULL                        THEN 'Email (shared address)'
            WHEN ln.LOYVERSE_ID IS NOT NULL AND ln.N_MERCHANTS = 1 THEN 'Business name (exact)'
            WHEN ln.LOYVERSE_ID IS NOT NULL                        THEN 'Business name (shared)'
            ELSE 'UNLINKED'
        END AS LINK_METHOD
    FROM stripe_acct sa
    LEFT JOIN loyverse_email le ON le.LINK_EMAIL = sa.LINK_EMAIL
    LEFT JOIN loyverse_name  ln ON ln.LINK_NAME  = sa.LINK_NAME
)

-- (a) coverage by method
SELECT
    LINK_METHOD,
    COUNT(*)                                                    AS ACCOUNTS,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)          AS PCT
FROM audit
GROUP BY LINK_METHOD
ORDER BY ACCOUNTS DESC;

/*
-- (b) the accounts that failed to link — work these by hand
SELECT STRIPE_ACCOUNT_ID, ACCOUNT_NAME, ACCOUNT_EMAIL, CONNECTED_AT, CHARGES_ENABLED
FROM audit
WHERE LINK_METHOD = 'UNLINKED'
ORDER BY CHARGES_ENABLED DESC, CONNECTED_AT DESC;
*/
