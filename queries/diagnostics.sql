-- Diagnostics: Row counts, unique merchants, and GTV currency distribution
-- Used to detect data gaps, incomplete months, and FX inflation issues

SELECT 'active_users' AS source, MONTH AS period, COUNT(*) AS row_count, COUNT(DISTINCT LOYVERSE_MERCHANT_ID) AS metric_value
FROM SALES_PER_ACCOUNT_MONTHLY
WHERE MONTH >= '2025-10'
GROUP BY MONTH

UNION ALL

-- GTV by currency: shows raw TOTAL_MONEY sums per currency for last 30 days
-- If NULL currency has a huge metric_value, those receipts are being treated as EUR
SELECT 'gtv_currency' AS source,
  COALESCE(CURRENCY, 'NULL') AS period,
  COUNT(*) AS row_count,
  ROUND(SUM(TOTAL_MONEY)) AS metric_value
FROM LOYVERSE_RECEIPTS
WHERE TRY_TO_DATE(RECEIPT_DATE) >= DATEADD('month', -1, CURRENT_DATE())
GROUP BY CURRENCY

UNION ALL

-- Summary: what % of receipts have NULL currency?
SELECT 'gtv_null_pct' AS source,
  'null_vs_total' AS period,
  COUNT(CASE WHEN CURRENCY IS NULL THEN 1 END) AS row_count,
  COUNT(*) AS metric_value
FROM LOYVERSE_RECEIPTS
WHERE TRY_TO_DATE(RECEIPT_DATE) >= DATEADD('month', -1, CURRENT_DATE())

ORDER BY source, metric_value DESC
