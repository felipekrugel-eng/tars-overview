-- Funnel: Registered → Active → Paying → Payments-enabled conversion funnel
-- Targets are 2026 goals

WITH reg AS (SELECT COUNT(*) AS cnt FROM LOYVERSE_MERCHANTS),
active AS (
  SELECT COUNT(DISTINCT LOYVERSE_MERCHANT_ID) AS cnt FROM SALES_PER_ACCOUNT_MONTHLY
  WHERE MONTH >= TO_CHAR(DATEADD('month', -1, CURRENT_DATE()), 'YYYY-MM')
),
paying AS (
  SELECT COUNT(*) AS cnt FROM (
    SELECT ID FROM "CHARGEBEE-EU-SUBSCRIPTION" WHERE STATUS = 'active' AND DELETED = FALSE
    UNION ALL
    SELECT ID FROM "CHARGEBEE-UK-SUBSCRIPTION" WHERE STATUS = 'active' AND DELETED = FALSE
  )
)
SELECT * FROM (
  SELECT 'registered' AS stage, reg.cnt AS current_value, 5000000 AS target_2026, NULL AS conversion_rate, 1 AS stage_order FROM reg
  UNION ALL SELECT 'active', active.cnt, 400000, ROUND(active.cnt * 100.0 / NULLIF(reg.cnt, 0), 1), 2 FROM active, reg
  UNION ALL SELECT 'paying', paying.cnt, 20000, ROUND(paying.cnt * 100.0 / NULLIF(active.cnt, 0), 1), 3 FROM paying, active
  UNION ALL SELECT 'payments_enabled', 0, 1600, 0, 4
) ORDER BY stage_order
