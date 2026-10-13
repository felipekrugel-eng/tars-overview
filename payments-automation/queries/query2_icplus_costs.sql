-- Loyverse Embedded Payments — Query 2 of 2: TRUE IC+ COSTS  → export as icplus_costs.csv
-- Run against the Stripe Data Pipeline share, schema STRIPE. Table is FULLY QUALIFIED
-- (database.schema.table) so the query works with no default database set.
-- One query per file. Do NOT stack with Query 1.
-- NOTE: amounts in ICPLUS_FEES are in CENTS (the rebuild divides by 100).
-- PLAN_NAME holds the interchange plan / assessment label
-- (e.g. "CPS/Small Ticket Regulated") that the Fee Breakdown tab itemizes.
-- FEE_NAME is the category: interchange / card_scheme /
-- non_transactional_card_scheme (folded into card_scheme) / discount /
-- per_auth_fee / volume_fee.
-- FEE_CURRENCY, FX_RATE and BILLING_* added 2026-10-13. TOTAL_AMOUNT is in the FEE's own
-- currency, and the export used to drop that fact entirely — so the rebuild summed USD, GBP
-- and EUR fees as though all three were dollars. Small in absolute terms (GBP fees are ~£198
-- of ~$30.6k) but it is the same class of error that put the Summary of Margins $10,481 below
-- the Payment Profile on volume, and the fix is to carry the currency rather than assume it.
--
-- Stripe bills the Loyverse platform in GBP for everything, and FX_RATE is the rate IT used.
-- That makes this the authoritative conversion on the whole dashboard: no hand-maintained
-- constant, no drift, and the rate is the one we were actually charged at.
SELECT
    charge_id, connected_account_name, card_brand, card_funding,
    fee_category, fee_name, plan_name, total_amount, incurred_at,
    fee_currency, fx_rate, billing_currency, billing_amount
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ICPLUS_FEES
WHERE incurred_at >= '2026-04-01'
  -- Same snapshot cut-off as query1 and query3; see the note there. Fees are cut on
  -- INCURRED_AT, the same clock the charges are cut on, so a fee cannot appear in the
  -- snapshot for a charge the snapshot does not contain.
  AND incurred_at < '/*AS_OF*/'
ORDER BY charge_id;
