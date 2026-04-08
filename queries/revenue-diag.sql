-- Revenue Diagnostics: Summary stats for EU invoice data
-- Checks total rows, current-year rows, amount totals, and date range

SELECT 'eu_invoices' AS source,
  COUNT(*) AS total_rows,
  COUNT(CASE WHEN YEAR(TO_TIMESTAMP(DATE)) = YEAR(CURRENT_DATE()) THEN 1 END) AS current_year_rows,
  SUM(CASE WHEN YEAR(TO_TIMESTAMP(DATE)) = YEAR(CURRENT_DATE()) THEN TOTAL ELSE 0 END) AS current_year_amount,
  MIN(TO_TIMESTAMP(DATE)) AS min_date,
  MAX(TO_TIMESTAMP(DATE)) AS max_date
FROM "CHARGEBEE-EU-INVOICE"
WHERE STATUS IN ('paid','payment_due') AND DELETED = FALSE
