-- Revenue Sample: Last 5 EU invoices for spot-checking amounts and currencies
-- Useful for verifying cents conversion and multi-currency handling

SELECT AMOUNT_DUE, AMOUNT_PAID, TOTAL, CURRENCY_CODE, STATUS,
       TO_TIMESTAMP(DATE) AS invoice_date
FROM "CHARGEBEE-EU-INVOICE"
WHERE STATUS IN ('paid','payment_due') AND DELETED = FALSE
  AND YEAR(TO_TIMESTAMP(DATE)) = YEAR(CURRENT_DATE())
ORDER BY TO_TIMESTAMP(DATE) DESC
LIMIT 5
