-- GTV by Market: Last 30 days of GTV per country from receipts
-- Ranked by GTV descending — used for market-level GTV analysis

WITH fx_rates AS (
  SELECT 'EUR' AS currency, 1.0 AS rate UNION ALL
  SELECT 'USD', 0.92 UNION ALL
  SELECT 'GBP', 1.17 UNION ALL
  SELECT 'JPY', 0.0061 UNION ALL
  SELECT 'KRW', 0.00067
)
SELECT m.COUNTRY,
  ROUND(SUM(lr.TOTAL_MONEY * fx.rate) / 1000000.0, 1) AS gtv_millions,
  COUNT(DISTINCT lr.MERCHANT_ID) AS merchant_count
FROM LOYVERSE_RECEIPTS lr
JOIN LOYVERSE_MERCHANTS m ON lr.MERCHANT_ID = m.LOYVERSE_ID
LEFT JOIN fx_rates fx ON fx.currency = COALESCE(lr.CURRENCY, 'EUR')
WHERE TRY_TO_DATE(lr.RECEIPT_DATE) >= DATEADD('month', -1, CURRENT_DATE())
GROUP BY m.COUNTRY
ORDER BY gtv_millions DESC
