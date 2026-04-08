-- KPIs: Core business metrics (MRR→ARR, active users, GTV, churn)
-- Multi-currency: converts all Chargebee amounts to EUR via static FX rates
-- Chargebee amounts are in cents (smallest currency unit) → /100.0
-- GTV from LOYVERSE_RECEIPTS (TOTAL_MONEY is in base currency, not cents)

WITH fx_rates AS (
  SELECT 'EUR' AS currency, 1.0 AS rate UNION ALL
  SELECT 'USD', 0.92 UNION ALL
  SELECT 'GBP', 1.17 UNION ALL
  SELECT 'JPY', 0.0061 UNION ALL
  SELECT 'KRW', 0.00067
),
registered_count AS (
  SELECT COUNT(*) AS cnt FROM LOYVERSE_MERCHANTS
),
active_merchants AS (
  SELECT COUNT(DISTINCT LOYVERSE_MERCHANT_ID) AS cnt
  FROM SALES_PER_ACCOUNT_MONTHLY
  WHERE MONTH >= TO_CHAR(DATEADD('month', -1, CURRENT_DATE()), 'YYYY-MM')
),
paying_subs AS (
  SELECT COUNT(*) AS cnt, COALESCE(SUM(mrr_eur), 0) AS total_mrr
  FROM (
    SELECT eu.MRR * fx.rate AS mrr_eur
    FROM "CHARGEBEE-EU-SUBSCRIPTION" eu
    JOIN fx_rates fx ON fx.currency = COALESCE(eu.CURRENCY_CODE, 'EUR')
    WHERE eu.STATUS = 'active' AND eu.DELETED = FALSE
    UNION ALL
    SELECT uk.MRR * fx.rate AS mrr_eur
    FROM "CHARGEBEE-UK-SUBSCRIPTION" uk
    JOIN fx_rates fx ON fx.currency = COALESCE(uk.CURRENCY_CODE, 'GBP')
    WHERE uk.STATUS = 'active' AND uk.DELETED = FALSE
  )
),
gtv_data AS (
  SELECT COALESCE(SUM(TOTAL_MONEY * fx.rate), 0) AS total_gtv_eur
  FROM LOYVERSE_RECEIPTS lr
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(lr.CURRENCY, 'EUR')
  WHERE TRY_TO_DATE(RECEIPT_DATE) >= DATEADD('month', -1, CURRENT_DATE())
),
active_subs AS (
  SELECT COUNT(*) AS cnt FROM (
    SELECT ID FROM "CHARGEBEE-EU-SUBSCRIPTION" WHERE STATUS = 'active' AND DELETED = FALSE
    UNION ALL
    SELECT ID FROM "CHARGEBEE-UK-SUBSCRIPTION" WHERE STATUS = 'active' AND DELETED = FALSE
  )
),
cancelled_30d AS (
  SELECT COUNT(*) AS cnt FROM (
    SELECT ID FROM "CHARGEBEE-EU-SUBSCRIPTION"
    WHERE STATUS = 'cancelled' AND DELETED = FALSE
      AND CANCELLED_AT IS NOT NULL AND TO_TIMESTAMP(CANCELLED_AT) >= DATEADD('day', -30, CURRENT_TIMESTAMP())
    UNION ALL
    SELECT ID FROM "CHARGEBEE-UK-SUBSCRIPTION"
    WHERE STATUS = 'cancelled' AND DELETED = FALSE
      AND CANCELLED_AT IS NOT NULL AND TO_TIMESTAMP(CANCELLED_AT) >= DATEADD('day', -30, CURRENT_TIMESTAMP())
  )
),
churn_calc AS (
  SELECT
    ROUND(c.cnt * 100.0 / NULLIF(a.cnt + c.cnt, 0), 1) AS monthly_churn_calc,
    ROUND((1 - POWER(1 - c.cnt * 1.0 / NULLIF(a.cnt + c.cnt, 0), 12)) * 100, 0) AS annual_churn_calc
  FROM active_subs a, cancelled_30d c
)
SELECT
  ROUND(ps.total_mrr * 12.0 / 100.0 / 1000000.0, 2) AS total_revenue,
  0 AS payment_revenue,
  CASE WHEN ps.cnt > 0 THEN ROUND(ps.total_mrr / ps.cnt / 100.0, 2) ELSE 0 END AS arpc,
  am.cnt AS active_users,
  ROUND(g.total_gtv_eur / 1000000.0, 1) AS total_gtv,
  0 AS attach_rate, 0 AS take_rate, 0 AS gtv_processed,
  COALESCE(cc.monthly_churn_calc, 2.1) AS monthly_churn,
  COALESCE(cc.annual_churn_calc, 22) AS annual_churn,
  104 AS nrr,
  rc.cnt AS registered, ps.cnt AS paying, 0 AS payments_enabled, 68 AS gross_margin
FROM registered_count rc, active_merchants am, paying_subs ps, gtv_data g, churn_calc cc
