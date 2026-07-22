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
SELECT
    CASE
        WHEN DESCRIPTION ILIKE '%per-authorization%'          THEN 'per_auth'
        WHEN DESCRIPTION ILIKE '%volume fee%'                 THEN 'volume'
        WHEN DESCRIPTION ILIKE '%tap on mobile%'              THEN 'tap_to_pay'
        WHEN DESCRIPTION ILIKE '%radar%'                      THEN 'radar'
        WHEN DESCRIPTION ILIKE '%payout%'                     THEN 'payout'
        WHEN DESCRIPTION ILIKE '%terminal use%'               THEN 'terminal_use'
        ELSE 'other'
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
