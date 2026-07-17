-- LOYVERSE PAYMENTS — CHARGEBEE SUBSCRIPTION / MRR layer (automation-safe)
-- Source: LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
--
-- One row per Chargebee subscription, linked to the Loyverse merchant via
-- LOYVERSE_MERCHANT_ID. Filtered to only the payments-activated merchants we are
-- rendering (id list injected at runtime from account metadata — NO hardcoded ids).
-- pull.js picks the "best" subscription per merchant (active preferred, then highest MRR)
-- to populate sub_status / plan / mrr / is_paying.
SELECT
    LOYVERSE_MERCHANT_ID   AS merchant_id,
    STATUS                 AS status,
    PLAN_ID                AS plan_id,
    MRR                    AS mrr,
    PLAN_AMOUNT            AS plan_amount,
    CURRENCY_CODE          AS currency_code,
    ACTIVATED_AT           AS activated_at,
    CANCELLED_AT           AS cancelled_at
FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
WHERE LOYVERSE_MERCHANT_ID IN (/*MERCHANT_IDS*/);
