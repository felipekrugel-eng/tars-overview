-- Diagnostics: Row counts and unique merchants per month from SALES_PER_ACCOUNT_MONTHLY
-- Used to detect data gaps or incomplete months

SELECT 'active_users' AS source, MONTH AS period, COUNT(*) AS row_count, COUNT(DISTINCT LOYVERSE_MERCHANT_ID) AS metric_value
FROM SALES_PER_ACCOUNT_MONTHLY
WHERE MONTH >= '2025-10'
GROUP BY MONTH
ORDER BY MONTH
