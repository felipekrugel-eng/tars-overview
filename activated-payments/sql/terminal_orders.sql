-- LOYVERSE PAYMENTS FUNNEL — terminal (card reader) acquisition (automation-safe)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.TERMINAL_HARDWARE_ORDERS
--
-- One row per connected account that has ordered Stripe Terminal hardware. MERCHANT_ID here
-- is the Stripe connected-account id (acct_…), injected at runtime from the prod account list
-- (NO hardcoded ids). Feeds the enablement / terminal drill-down: among merchants who have
-- signed up / passed KYC, who has actually acquired a card reader and who hasn't.
SELECT
    MERCHANT_ID                                    AS account,
    MIN(TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)))     AS first_order,
    COUNT(*)                                       AS orders
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.TERMINAL_HARDWARE_ORDERS
WHERE MERCHANT_ID IN (/*ACCOUNT_IDS*/)
GROUP BY MERCHANT_ID;
