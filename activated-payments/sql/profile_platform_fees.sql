-- =================================================================
-- STRIPE PLATFORM FEES, per month — the cost the Payment Profile was missing
-- READ-ONLY (one statement, works with DATA_VIEWER)
-- =================================================================
-- WHY THIS EXISTS. The Payment Profile costed a charge from ICPLUS_FEES alone, while the
-- Summary of Margins took Stripe's platform-level fees from the balance transactions. Same
-- book, two different costs, and nothing on either page said why.
--
-- Worse than a missing component, it was a SOURCE COLLISION. ICPLUS_FEES itemises per_auth
-- and volume fees per charge, and BALANCE_TRANSACTIONS bills the same two fees in aggregate.
-- The Profile summed every ICPLUS row, so it already had them; adding the platform figure on
-- top would have counted them twice. The two sources also disagree:
--
--     per_auth   GBP 2,046.26 per-charge   vs   GBP 2,069.62 platform   (+1.1%)
--     volume     GBP 1,051.70 per-charge   vs   GBP 1,073.11 platform   (+2.0%)
--
-- (The platform per_auth figure was 2,212.65 before REPORTING_CATEGORY = 'fee' was applied
-- below. 2,069.62 is the correct one; the gap is much smaller than it first appeared.)
--
-- The platform figure is higher because it is what Stripe actually took out of the balance,
-- including fees on charges the per-charge feed has not itemised yet. So the PLATFORM total is
-- the truth about how much we paid, and the per-charge feed is the truth about who incurred
-- it. The Profile takes the total from here and uses the per-charge split only to attribute
-- it — total exact, attribution defensible, nothing counted twice.
--
-- These fees carry no connected-account id, so they cannot be attributed to a merchant, a
-- brand or a segment by any means other than apportionment. The page says so.
--
-- CURRENCY IS GBP. Stripe settles the platform in sterling and AMOUNT is NEGATIVE minor units
-- (a fee leaves the balance). Sign flipped and unit divided here; FX is left to the caller,
-- which owns one rate for the whole file.
--
-- type='stripe_fee' does NOT overlap type='network_cost' (interchange and scheme), which is
-- where the Profile's network cost comes from — so there is no double count across the two.
-- =================================================================

SELECT
    TO_VARCHAR(DATE_TRUNC('month', CREATED), 'YYYY-MM')          AS M,
    -- BUCKETING COPIED VERBATIM from payments-automation/queries/query3_platform_fees.sql.
    -- Not paraphrased: if the two bucket differently the two pages go straight back to
    -- disagreeing, which is the whole problem being fixed. Change one and change the other.
    -- That file carries the full account of what each bucket is and why the subscriptions
    -- are separated; this is the mirror, not the explanation.
    CASE
        WHEN DESCRIPTION ILIKE '%per-authorization%'          THEN 'per_auth'
        WHEN DESCRIPTION ILIKE '%account volume%'             THEN 'account_volume'
        WHEN DESCRIPTION ILIKE '%volume fee%'                 THEN 'volume'
        WHEN DESCRIPTION ILIKE '%tap on mobile%'              THEN 'tap_to_pay'
        WHEN DESCRIPTION ILIKE '%radar%'                      THEN 'radar'
        WHEN DESCRIPTION ILIKE '%payout%'                     THEN 'payout'
        WHEN DESCRIPTION ILIKE '%terminal use%'               THEN 'terminal_use'
        WHEN DESCRIPTION ILIKE '%terminal cellular%'          THEN 'terminal_use'
        WHEN DESCRIPTION ILIKE '%dispute%'                    THEN 'dispute'
        WHEN DESCRIPTION ILIKE '%premium support%'            THEN 'sub_premium_support'
        WHEN DESCRIPTION ILIKE '%sigma%'
          OR DESCRIPTION ILIKE '%data pipeline%'              THEN 'sub_sigma'
        ELSE 'unclassified'
    END                                                          AS BUCKET,
    LOWER(CURRENCY)                                              AS CUR,
    COUNT(*)                                                     AS N,
    ROUND(SUM(-AMOUNT) / 100.0, 4)                               AS AMOUNT_MAJOR
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.BALANCE_TRANSACTIONS
WHERE TYPE = 'stripe_fee'
  -- REPORTING_CATEGORY = 'fee' excludes non-fee rows of the same type and shifts per_auth
  -- (GBP 2,212.65 -> 2,069.62), so it has to be here and has to match query3.
  --
  -- CORRECTION, 2026-10-13. An earlier draft of this comment claimed the missing filter was
  -- what produced the huge 'other' bucket. That was wrong, and measuring it disproved it:
  -- with the filter in place 'other' was still GBP 25,758.70. The real explanation was that
  -- nobody had ever enumerated the bucket — it was GBP 24,000 of Stripe Premium Support,
  -- GBP 1,312 of Sigma, and GBP 446.66 of genuine processing fees that had no CASE branch.
  -- The hypothesis was plausible and the number moved, which is exactly how a wrong
  -- explanation survives; it did not survive being checked against the total.
  AND REPORTING_CATEGORY = 'fee'
  AND CREATED >= '2026-04-01'
GROUP BY 1, 2, 3
ORDER BY 1, 2;
