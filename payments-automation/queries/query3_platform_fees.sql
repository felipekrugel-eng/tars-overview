-- Loyverse Embedded Payments — Query 3 of 3: PLATFORM (Stripe) FEES  → platform_fees.csv
-- Run against the Stripe Data Pipeline share, schema STRIPE. Table is FULLY QUALIFIED
-- so it works with no default database set. One query per file.
--
-- WHAT THIS IS: the Stripe platform-cost fees Stripe charges the Loyverse PLATFORM
-- account (acct_1SSKsA7e4AMQfKY3) — per-authorization, volume (incl. adjustments),
-- Tap-to-Pay ("Tap on Mobile"), Radar (fraud), payout, and terminal-use fees. These
-- live in BALANCE_TRANSACTIONS as TYPE='stripe_fee' / REPORTING_CATEGORY='fee'; the
-- specific fee kind is only in the free-text DESCRIPTION, so we bucket on it.
--
-- Verified empirically 21-22 Jul 2026 (payments-fees-probe):
--   * BALANCE_TRANSACTIONS cols include DESCRIPTION, AMOUNT, CURRENCY, TYPE,
--     REPORTING_CATEGORY, CREATED. AMOUNT is minor units (pence), NEGATIVE for fees.
--   * Sample DESCRIPTIONs:
--       "Card payments (2026-07-21): Stripe per-authorization fees"      -> per_auth
--       "Card payments (2026-07-21): Stripe volume fees"                 -> volume
--       "Card payments (2026-07-20): adjustment to Stripe volume fees"   -> volume
--       "Terminal (2026-07-20): Tap on Mobile- Per Auth Fee"             -> tap_to_pay
--       "Radar (2026-07-20): Standard"                                   -> radar
--   * CURRENCY on these rows is 'gbp' (platform settlement currency), whereas the
--     merchant charges (query1) are mostly 'usd'. CURRENCY is returned below so the
--     consumer can see the unit and decide on any FX handling. Amounts are minor units.
--   * type='stripe_fee' does NOT overlap type='network_cost' (interchange/scheme),
--     which is a separate balance-transaction type — so summing this alongside the
--     IC+ network fees does not double-count.
--
-- Window matches query1 ('2026-04-01') so a fresh run picks up all fees through today.
-- Output is one row per (fee_category, currency): the count and the SUMMED minor-unit
-- amount (negative). COUNT lets the pull log reconcile against the 40-row probe sample.
-- WHAT 'other' TURNED OUT TO BE (2026-10-13). This CASE used to end at terminal_use and
-- sweep everything else into 'other', which the consumer never read. That hid GBP 25,758.70
-- against GBP 3,663.68 for everything classified — seven times the entire recognised cost.
-- Enumerated, it was six things, and they split cleanly into two kinds:
--
--   PROCESSING COST, wrongly discarded          GBP        was
--     account_volume  Connect Account Volume     386.99    in 'other' AND the consumer
--                                                          had a row for it, so the
--                                                          margins sheet printed a line
--                                                          called "Account Volume Fee"
--                                                          that was structurally always 0
--     dispute         Card Dispute                52.67    in 'other'
--     terminal cellular connectivity               7.00    in 'other' -> folded into
--                                                          terminal_use below; it is a
--                                                          terminal fee and GBP 7 does
--                                                          not earn its own P&L line
--
--   FIXED SUBSCRIPTIONS, correctly outside unit cost
--     premium_support Stripe Premium Support   24,000.00   6 monthly charges
--     sigma           Sigma / Data Pipeline     1,312.04   subscription + usage
--
-- The subscriptions are NOT per-transaction cost and must not enter contribution, which is a
-- unit-economics measure — but they are real money, they are larger than this book's entire
-- revenue, and sweeping them into an unread bucket meant nothing on the dashboard ever said
-- so. They are emitted under their own categories so the consumer can show them BELOW the
-- line instead of silently dropping them.
--
-- There is no ELSE bucket any more. Every row is named, so a new Stripe fee type cannot
-- quietly disappear: it fails the consumer's category check and shows up in the pull log.
SELECT
    CASE
        WHEN DESCRIPTION ILIKE '%per-authorization%'          THEN 'per_auth'
        -- Before '%volume fee%': "Connect (...): Account Volume Billing" is a different fee
        -- from "Card payments (...): Stripe volume fees". Verified these are the only two
        -- description families containing "volume".
        WHEN DESCRIPTION ILIKE '%account volume%'             THEN 'account_volume'
        WHEN DESCRIPTION ILIKE '%volume fee%'                 THEN 'volume'
        WHEN DESCRIPTION ILIKE '%tap on mobile%'              THEN 'tap_to_pay'
        WHEN DESCRIPTION ILIKE '%radar%'                      THEN 'radar'
        WHEN DESCRIPTION ILIKE '%payout%'                     THEN 'payout'
        WHEN DESCRIPTION ILIKE '%terminal use%'               THEN 'terminal_use'
        WHEN DESCRIPTION ILIKE '%terminal cellular%'          THEN 'terminal_use'
        WHEN DESCRIPTION ILIKE '%dispute%'                    THEN 'dispute'
        -- Fixed subscriptions. Reported, never added to unit cost.
        WHEN DESCRIPTION ILIKE '%premium support%'            THEN 'sub_premium_support'
        WHEN DESCRIPTION ILIKE '%sigma%'
          OR DESCRIPTION ILIKE '%data pipeline%'              THEN 'sub_sigma'
        ELSE 'unclassified'
    END                                             AS fee_category,
    CURRENCY                                        AS currency,
    COUNT(*)                                        AS n,
    SUM(AMOUNT)                                     AS total_amount_minor
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.BALANCE_TRANSACTIONS
WHERE TYPE = 'stripe_fee'
  AND REPORTING_CATEGORY = 'fee'
  AND CREATED >= '2026-04-01'
GROUP BY 1, 2
ORDER BY 1, 2;
