-- LOYVERSE PAYMENTS — PAYMENT PROFILE: acceptance (automation-safe)
--
-- Declined volume is revenue that was offered and not taken. On 2026-08-27 the rate was 97.81%
-- authorized, 2.18% issuer-declined, 0.02% blocked — with $54,145 attempted and lost, against
-- $410,444 authorized. Insufficient funds and do-not-honor accounted for most of it.
--
-- SEPARATE POPULATION, DELIBERATELY. This reads ANALYTICS_ACCEPTANCE_ITEMIZED, which is
-- ATTEMPT-grained: every authorisation attempt, successful or not. The mix queries read captured
-- charges. The two do not and should not match — 18,826 attempts against 18,999 captured charges
-- on the same day — because a captured charge can follow a retried attempt and an attempt can
-- fail and never become a charge. Never divide one by the other, and never add acceptance volume
-- into a TPV share; that is why this is its own file and its own output.
--
-- AMOUNT_IN_USD is used rather than AMOUNT so declines in other currencies are comparable. It is
-- Stripe's own conversion, not the fixed FX map the rest of the dashboard applies to TPV, so
-- acceptance value and TPV are close but not arithmetically identical.
SELECT
    TO_VARCHAR(TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED))), 'YYYY-MM') AS MONTH,
    MERCHANT_ID                                          AS PLATFORM_MERCHANT,
    LOWER(COALESCE(OUTCOME_TYPE, 'unknown'))             AS OUTCOME,
    LOWER(COALESCE(FAILURE_REASON, BLOCK_REASON, ''))    AS REASON,
    LOWER(COALESCE(CARD_BRAND, 'unknown'))               AS BRAND,
    LOWER(COALESCE(CARD_TYPE, 'unknown'))                AS FUNDING,
    LOWER(COALESCE(CARD_INPUT_METHOD, 'unknown'))        AS INPUT_METHOD,
    UPPER(COALESCE(CARD_COUNTRY, 'unknown'))             AS CARD_COUNTRY,
    -- A retry that eventually succeeds is not lost revenue; the dashboard separates first
    -- attempts from retries so a decline is not counted as loss when the money arrived anyway.
    LOWER(COALESCE(RETRY_STATUS, 'unknown'))             AS RETRY_STATUS,
    COALESCE(IS_FINAL_ATTEMPT, FALSE)                    AS IS_FINAL_ATTEMPT,
    COUNT(*)                                             AS ATTEMPTS,
    SUM(COALESCE(AMOUNT_IN_USD, 0))                      AS USD_MINOR
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ANALYTICS_ACCEPTANCE_ITEMIZED
WHERE TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)) IS NOT NULL
  AND TRY_TO_TIMESTAMP(TO_VARCHAR(CREATED)) >= '2026-04-01'
  AND IS_CONNECTED_ACCOUNT = TRUE
GROUP BY 1,2,3,4,5,6,7,8,9,10
ORDER BY MONTH, ATTEMPTS DESC;
