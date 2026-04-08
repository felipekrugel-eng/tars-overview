-- Markets: Top 10 countries by merchant count with GTV data
-- Joins LOYVERSE_RECEIPTS → LOYVERSE_MERCHANTS on LOYVERSE_ID (not ID)
-- GTV converted to EUR millions via static FX rates

WITH fx_rates AS (
  SELECT 'EUR' AS currency, 1.0 AS rate UNION ALL
  SELECT 'USD', 0.92 UNION ALL
  SELECT 'GBP', 1.17 UNION ALL
  SELECT 'JPY', 0.0061 UNION ALL
  SELECT 'KRW', 0.00067
),
gtv_by_country AS (
  SELECT m.COUNTRY,
    SUM(lr.TOTAL_MONEY * fx.rate) / 1000000.0 AS gtv_millions
  FROM LOYVERSE_RECEIPTS lr
  JOIN LOYVERSE_MERCHANTS m ON lr.MERCHANT_ID = m.LOYVERSE_ID
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(lr.CURRENCY, 'EUR')
  WHERE m.COUNTRY IS NOT NULL AND m.COUNTRY != '' AND TRY_TO_DATE(lr.RECEIPT_DATE) >= DATEADD('month', -1, CURRENT_DATE())
  GROUP BY m.COUNTRY
)
SELECT COALESCE(m.COUNTRY, 'Unknown') AS country, '' AS flag_emoji,
  COALESCE(g.gtv_millions, 0) AS gtv_millions, COUNT(*) AS merchant_count,
  CASE WHEN COUNT(*) > 0 THEN COALESCE(g.gtv_millions, 0) / COUNT(*) ELSE 0 END AS avg_gtv_per_merchant
FROM LOYVERSE_MERCHANTS m
LEFT JOIN gtv_by_country g ON g.COUNTRY = m.COUNTRY
WHERE m.COUNTRY IS NOT NULL AND m.COUNTRY != ''
GROUP BY m.COUNTRY, g.gtv_millions
ORDER BY COUNT(*) DESC LIMIT 10
