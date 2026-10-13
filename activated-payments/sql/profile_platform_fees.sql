-- =================================================================
-- STRIPE PLATFORM FEES, per month — the cost the Payment Profile was missing
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- WHY THIS EXISTS. The Payment Profile costed a charge at its IC++ fees only, while the
-- Summary of Margins also carried Stripe's platform-level fees — per-authorisation, volume,
-- Tap to Pay, Radar, payout and terminal use. Same book, two different costs, roughly $825
-- apart, and nothing on either page said why. This is the missing piece, pulled so both pages
-- can show the same total cost.
--
-- These fees are billed to the LOYVERSE PLATFORM ACCOUNT and carry no connected-account id,
-- so they cannot be attributed to a merchant, a card brand or a segment. The page apportions
-- them by share of volume and says so. That is the same treatment the country, month and
-- cohort splits already use, and for the same unavoidable reason.
--
-- IN BALANCE_TRANSACTIONS the fee kind lives only in free-text DESCRIPTION, so it is bucketed
-- on that — the categories and sample strings are documented in
-- payments-automation/queries/query3_platform_fees.sql, which this deliberately mirrors
-- rather than reinvents. Keeping the two in step matters: if they bucket differently the two
-- pages go back to disagreeing, which is the whole problem being fixed here.
--
-- CURRENCY IS GBP. Stripe settles the platform in sterling and AMOUNT is NEGATIVE minor units
-- (a fee leaves the balance). Sign is flipped and the unit divided here; the FX conversion is
-- left to the caller, which already owns one rate for the whole file.
--
-- type='stripe_fee' does NOT overlap type='network_cost' (interchange and scheme), which is
-- where the IC++ cost comes from — so adding this to the per-charge cost double-counts
-- nothing.
-- =================================================================

SELECT
    TO_VARCHAR(DATE_TRUNC('month', TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED))), 'YYYY-MM') AS M,
    LOWER(CURRENCY)                                              AS CUR,
    CASE
        WHEN LOWER(DESCRIPTION) LIKE '%per-authorization%'
          OR LOWER(DESCRIPTION) LIKE '%per auth%'                THEN 'per_auth'
        WHEN LOWER(DESCRIPTION) LIKE '%volume fee%'              THEN 'volume'
        WHEN LOWER(DESCRIPTION) LIKE '%tap on mobile%'           THEN 'tap_to_pay'
        WHEN LOWER(DESCRIPTION) LIKE '%radar%'                   THEN 'radar'
        WHEN LOWER(DESCRIPTION) LIKE '%payout%'                  THEN 'payout'
        WHEN LOWER(DESCRIPTION) LIKE '%terminal%'                THEN 'terminal'
        ELSE 'other'
    END                                                          AS BUCKET,
    COUNT(*)                                                     AS N,
    -- Flip the sign and convert minor units. Still GBP at this point.
    ROUND(SUM(-AMOUNT) / 100.0, 4)                               AS AMOUNT_MAJOR
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.BALANCE_TRANSACTIONS
WHERE LOWER(TYPE) = 'stripe_fee'
  AND TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)) >= '2026-04-01'
GROUP BY 1, 2, 3
ORDER BY 1, 3;
