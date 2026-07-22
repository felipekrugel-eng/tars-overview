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
SELECT
    charge_id, connected_account_name, card_brand, card_funding,
    fee_category, fee_name, plan_name, total_amount, incurred_at
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ICPLUS_FEES
WHERE incurred_at >= '2026-04-01'
ORDER BY charge_id;
