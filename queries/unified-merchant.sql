-- Unified Merchant View: One row per merchant with data from all tables
-- Master key: LOYVERSE_MERCHANTS.LOYVERSE_ID
-- Join chain:
--   LOYVERSE_MERCHANTS.LOYVERSE_ID = CHARGEBEE-*-CUSTOMER.ID (TRY_CAST)
--   CHARGEBEE-*-SUBSCRIPTION.CUSTOMER_ID = CHARGEBEE-*-CUSTOMER.ID
--   SALES_PER_ACCOUNT_MONTHLY.LOYVERSE_MERCHANT_ID = LOYVERSE_ID
--   LOYVERSE_RECEIPTS.MERCHANT_ID = LOYVERSE_ID

WITH fx_rates AS (
  SELECT 'EUR' AS currency, 1.0 AS rate UNION ALL
  SELECT 'USD', 0.92 UNION ALL
  SELECT 'GBP', 1.17 UNION ALL
  SELECT 'JPY', 0.0061 UNION ALL
  SELECT 'KRW', 0.00067
),

-- Base: all Loyverse merchants
merchants AS (
  SELECT
    m.LOYVERSE_ID,
    m.ID AS MERCHANT_UUID,
    m.COUNTRY,
    m.EMAIL,
    m.CREATED_AT AS registered_at,
    TO_CHAR(m.CREATED_AT, 'YYYY-MM') AS cohort_month
  FROM LOYVERSE_MERCHANTS m
  WHERE m.CREATED_AT IS NOT NULL
),

-- Chargebee EU subscriptions (active status, MRR)
eu_subs AS (
  SELECT
    TRY_CAST(c.ID AS NUMBER) AS loyverse_id,
    s.ID AS subscription_id,
    s.STATUS AS sub_status,
    s.MRR,
    s.CURRENCY_CODE,
    s.CREATED_AT AS sub_created_at,
    s.CANCELLED_AT AS sub_cancelled_at
  FROM "CHARGEBEE-EU-SUBSCRIPTION" s
  JOIN "CHARGEBEE-EU-CUSTOMER" c ON s.CUSTOMER_ID = c.ID
  WHERE s.DELETED = FALSE AND c.DELETED = FALSE
),

-- Chargebee UK subscriptions
uk_subs AS (
  SELECT
    TRY_CAST(c.ID AS NUMBER) AS loyverse_id,
    s.ID AS subscription_id,
    s.STATUS AS sub_status,
    s.MRR,
    s.CURRENCY_CODE,
    s.CREATED_AT AS sub_created_at,
    s.CANCELLED_AT AS sub_cancelled_at
  FROM "CHARGEBEE-UK-SUBSCRIPTION" s
  JOIN "CHARGEBEE-UK-CUSTOMER" c ON s.CUSTOMER_ID = c.ID
  WHERE s.DELETED = FALSE AND c.DELETED = FALSE
),

-- Combined subscriptions
all_subs AS (
  SELECT loyverse_id, subscription_id, sub_status, MRR, CURRENCY_CODE, sub_created_at, sub_cancelled_at, 'EU' AS region FROM eu_subs
  UNION ALL
  SELECT loyverse_id, subscription_id, sub_status, MRR, CURRENCY_CODE, sub_created_at, sub_cancelled_at, 'UK' AS region FROM uk_subs
),

-- Best subscription per merchant (prefer active, then most recent)
ranked_subs AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY loyverse_id
      ORDER BY CASE WHEN sub_status = 'active' THEN 0 ELSE 1 END, sub_created_at DESC
    ) AS rn
  FROM all_subs
),

best_sub AS (
  SELECT * FROM ranked_subs WHERE rn = 1
),

-- MRR in EUR per merchant
merchant_mrr AS (
  SELECT
    bs.loyverse_id,
    bs.subscription_id,
    bs.sub_status,
    bs.region,
    ROUND(bs.MRR * COALESCE(fx.rate, 1.0) / 100.0, 2) AS mrr_eur,
    bs.CURRENCY_CODE,
    bs.sub_created_at,
    bs.sub_cancelled_at
  FROM best_sub bs
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(bs.CURRENCY_CODE, 'EUR')
),

-- Activity: was merchant active in last 30 days?
recent_activity AS (
  SELECT LOYVERSE_MERCHANT_ID AS loyverse_id, MAX(MONTH) AS last_active_month, SUM(TOTAL_SALES_COUNT) AS recent_txn_count
  FROM SALES_PER_ACCOUNT_MONTHLY
  WHERE MONTH >= TO_CHAR(DATEADD('month', -1, CURRENT_DATE()), 'YYYY-MM')
  GROUP BY LOYVERSE_MERCHANT_ID
),

-- GTV: last 30 days from LOYVERSE_RECEIPTS
merchant_gtv AS (
  SELECT
    lr.MERCHANT_ID AS loyverse_id,
    ROUND(SUM(lr.TOTAL_MONEY * COALESCE(fx.rate, 1.0)), 2) AS gtv_30d_eur,
    COUNT(*) AS receipt_count_30d
  FROM LOYVERSE_RECEIPTS lr
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(lr.CURRENCY, 'EUR')
  WHERE TRY_TO_DATE(lr.RECEIPT_DATE) >= DATEADD('day', -30, CURRENT_DATE())
  GROUP BY lr.MERCHANT_ID
)

-- Final unified view
SELECT
  m.LOYVERSE_ID,
  m.MERCHANT_UUID,
  m.COUNTRY,
  m.EMAIL,
  m.registered_at,
  m.cohort_month,
  mm.subscription_id,
  mm.sub_status,
  mm.region AS chargebee_region,
  mm.mrr_eur,
  mm.CURRENCY_CODE,
  mm.sub_created_at,
  mm.sub_cancelled_at,
  CASE WHEN ra.loyverse_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_active_30d,
  CASE WHEN mm.sub_status = 'active' THEN TRUE ELSE FALSE END AS is_paying,
  CASE WHEN mm.sub_status = 'cancelled' AND mm.sub_cancelled_at IS NOT NULL THEN TRUE ELSE FALSE END AS is_churned,
  ra.last_active_month,
  ra.recent_txn_count,
  g.gtv_30d_eur,
  g.receipt_count_30d
FROM merchants m
LEFT JOIN merchant_mrr mm ON mm.loyverse_id = m.LOYVERSE_ID
LEFT JOIN recent_activity ra ON ra.loyverse_id = m.LOYVERSE_ID
LEFT JOIN merchant_gtv g ON g.loyverse_id = m.LOYVERSE_ID
ORDER BY m.registered_at DESC
LIMIT 1000
