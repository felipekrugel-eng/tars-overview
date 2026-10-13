-- Loyverse Embedded Payments — Query 1 of 2: TRANSACTIONS  → export as transactions.csv
-- Run against the Stripe Data Pipeline share, schema STRIPE. Tables are FULLY QUALIFIED
-- (database.schema.table) so the query works with no default database set.
-- One query per file. Do NOT stack with Query 2.
--
-- IMPORTANT: this is a Stripe CONNECT share with DIRECT charges. The merchant
-- charges live in CONNECTED_ACCOUNT_CHARGES, but Loyverse's application fee
-- (= revenue / gross take) accrues to the PLATFORM, so it lives in the
-- platform-level APPLICATION_FEES table (NOT CONNECTED_ACCOUNT_APPLICATION_FEES,
-- which is empty). The platform CHARGES table is also empty. All verified
-- empirically 21 Jul 2026 (query_0c schema + query_1c diagnostic):
--   CONNECTED_ACCOUNT_CHARGES:  ID, CREATED, ACCOUNT (=acct_ id), MERCHANT_ID,
--     CURRENCY, STATUS, AMOUNT (cents), CARD_BRAND, CARD_FUNDING, CARD_COUNTRY,
--     CARD_LAST4, APPLICATION_FEE_ID.
--   CONNECTED_ACCOUNTS:         ID (=acct_ id), BUSINESS_NAME, LEGAL_ENTITY_BUSINESS_NAME,
--     COUNTRY (ISO-2 country of INCORPORATION of the merchant).
--
-- MERCHANT_COUNTRY (added 2026-08-17, UK launch) is the merchant's own country, taken from
-- CONNECTED_ACCOUNTS.COUNTRY. It is deliberately NOT the same thing as CARD_COUNTRY below, which
-- is where the CARDHOLDER's card was issued — a US merchant routinely takes foreign cards, so
-- CARD_COUNTRY cannot answer "how is the UK business doing". The margins page splits on
-- MERCHANT_COUNTRY; CARD_COUNTRY stays exactly where it was, feeding the card-mix analysis.
--   APPLICATION_FEES (platform): CHARGE_ID (= connected charge ID, join key),
--     AMOUNT (cents, = Loyverse revenue), CURRENCY, CREATED.
-- Window filter is >= '2026-04-01' so a fresh run picks up all charges through today.
SELECT
    c.ID                                                    AS charge_id,
    c.CREATED                                               AS created_at,
    c.ACCOUNT                                               AS charge_account_id,
    c.MERCHANT_ID                                           AS platform_merchant_id,
    COALESCE(a.BUSINESS_NAME, a.LEGAL_ENTITY_BUSINESS_NAME) AS merchant_name,
    UPPER(TRIM(a.COUNTRY))                                  AS merchant_country,
    c.CURRENCY                                              AS currency,
    c.STATUS                                                AS status,
    c.AMOUNT                                                AS amount,
    c.CARD_BRAND                                            AS card_brand,
    c.CARD_FUNDING                                          AS card_funding,
    c.CARD_COUNTRY                                          AS card_country,
    c.CARD_LAST4                                            AS card_last4,
    af.AMOUNT                                               AS application_fee_amount,
    -- ── Columns below exist so the PAYMENT PROFILE can be built from this same snapshot
    -- rather than from its own separate Snowflake pull. That was the whole discrepancy:
    -- two pages, two pulls, two different moments, numbers that could never match. One
    -- row per charge, read by both. See shared/README.md.
    c.BALANCE_TRANSACTION_ID                                AS balance_transaction_id,
    c.PAID                                                  AS paid,
    c.CAPTURED                                              AS captured,
    pm.CARD_WALLET_TYPE                                     AS card_wallet_type,
    pm.CARD_READ_METHOD                                     AS card_read_method,
    pm.TYPE                                                 AS pm_type,
    pm.TERMINAL_READER_ID                                   AS terminal_reader_id
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES c
LEFT JOIN GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS a
    ON a.ID = c.ACCOUNT
LEFT JOIN GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.APPLICATION_FEES af
    ON af.CHARGE_ID = c.ID
-- Payment-method attributes (wallet, how the card was read, terminal reader). The view is
-- charge-grained already, but QUALIFY guards the arithmetic: a duplicate row here would
-- double-count a charge's money in every share on the Profile page.
LEFT JOIN (
    SELECT d.CHARGE_ID, d.CARD_WALLET_TYPE, d.CARD_READ_METHOD, d.TYPE, d.TERMINAL_READER_ID
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d
    QUALIFY ROW_NUMBER() OVER (PARTITION BY d.CHARGE_ID ORDER BY d.BATCH_TIMESTAMP DESC NULLS LAST) = 1
) pm ON pm.CHARGE_ID = c.ID
WHERE c.CREATED >= '2026-04-01'
  -- THE SNAPSHOT CUT-OFF. Substituted by pull_payments.py with ONE timestamp shared by all
  -- three queries in the pull. Without it the queries run seconds apart and each sees a
  -- slightly different book, so even a single pull is not a single instant.
  AND c.CREATED < '/*AS_OF*/'
ORDER BY c.ID;
