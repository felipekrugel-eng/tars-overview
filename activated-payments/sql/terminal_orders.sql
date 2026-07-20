-- LOYVERSE PAYMENTS FUNNEL — terminal (card reader) acquisition (automation-safe)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.TERMINAL_HARDWARE_ORDERS
--
-- Terminal hardware is ordered PLATFORM-side (MERCHANT_ID is Loyverse's platform account for
-- every row, not the merchant), then shipped to the merchant. So attribute each order to the
-- merchant by SHIPPING_EMAIL, which is the merchant's contact email. One row per email with the
-- first order date, count, and latest status. Excludes canceled orders. No hardcoded ids.
SELECT
    LOWER(TRIM(SHIPPING_EMAIL))                     AS ship_email,
    MIN(TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)))     AS first_order,
    COUNT(*)                                       AS orders,
    MAX(STATUS)                                    AS last_status
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.TERMINAL_HARDWARE_ORDERS
WHERE SHIPPING_EMAIL IS NOT NULL
  AND LOWER(COALESCE(STATUS,'')) <> 'canceled'
GROUP BY LOWER(TRIM(SHIPPING_EMAIL));
