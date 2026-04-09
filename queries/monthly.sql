-- Monthly: Revenue, active users, and GTV by month for current year
-- Combines EU + UK Chargebee invoices with FX conversion and cents→EUR
-- GTV from LOYVERSE_RECEIPTS by month
-- Targets are static VALUES (update annually)

WITH fx_rates AS (
    -- FX rates: 1 unit of currency = X EUR (as of April 2026)
    -- Source: open.er-api.com — update quarterly
    SELECT 'EUR' AS currency, 1.0 AS rate UNION ALL
    SELECT 'USD', 0.8564 UNION ALL
    SELECT 'GBP', 1.1492 UNION ALL
    SELECT 'JPY', 0.005405 UNION ALL
    SELECT 'KRW', 0.00057917 UNION ALL
    SELECT 'PHP', 0.014400 UNION ALL
    SELECT 'THB', 0.026718 UNION ALL
    SELECT 'IDR', 0.00005035 UNION ALL
    SELECT 'MXN', 0.049128 UNION ALL
    SELECT 'MYR', 0.2152 UNION ALL
    SELECT 'VND', 0.00003284 UNION ALL
    SELECT 'BRL', 0.1678 UNION ALL
    SELECT 'SAR', 0.2284 UNION ALL
    SELECT 'INR', 0.009269 UNION ALL
    SELECT 'COP', 0.00023219 UNION ALL
    SELECT 'ARS', 0.00061743 UNION ALL
    SELECT 'EGP', 0.016092 UNION ALL
    SELECT 'NGN', 0.00062172 UNION ALL
    SELECT 'KES', 0.006607 UNION ALL
    SELECT 'UAH', 0.019716 UNION ALL
    SELECT 'TRY', 0.019240 UNION ALL
    SELECT 'RUB', 0.010912 UNION ALL
    SELECT 'PLN', 0.2351 UNION ALL
    SELECT 'AUD', 0.6036 UNION ALL
    SELECT 'CAD', 0.6186 UNION ALL
    SELECT 'CHF', 1.0835 UNION ALL
    SELECT 'SEK', 0.092139 UNION ALL
    SELECT 'NOK', 0.089589 UNION ALL
    SELECT 'DKK', 0.1340 UNION ALL
    SELECT 'CZK', 0.040999 UNION ALL
    SELECT 'HUF', 0.002656 UNION ALL
    SELECT 'RON', 0.1963 UNION ALL
    SELECT 'ZAR', 0.052269 UNION ALL
    SELECT 'PKR', 0.003074 UNION ALL
    SELECT 'BDT', 0.006974 UNION ALL
    SELECT 'LKR', 0.002721 UNION ALL
    SELECT 'MMK', 0.00040774 UNION ALL
    SELECT 'TWD', 0.026992 UNION ALL
    SELECT 'SGD', 0.6721 UNION ALL
    SELECT 'HKD', 0.1094 UNION ALL
    SELECT 'NZD', 0.4993 UNION ALL
    SELECT 'ILS', 0.2773 UNION ALL
    SELECT 'AED', 0.2332 UNION ALL
    SELECT 'PEN', 0.2514 UNION ALL
    SELECT 'CLP', 0.00093392 UNION ALL
    SELECT 'QAR', 0.2353 UNION ALL
    SELECT 'KHR', 0.00021232 UNION ALL
    SELECT 'LAK', 0.00003912
  ),
  monthly_inv AS (
    SELECT MONTH(TO_TIMESTAMP(DATE)) AS m, SUM(TOTAL * fx.rate / 100.0) AS rev
    FROM "CHARGEBEE-EU-INVOICE" eu
    JOIN fx_rates fx ON fx.currency = COALESCE(eu.CURRENCY_CODE, 'EUR')
    WHERE eu.STATUS IN ('paid','payment_due') AND YEAR(TO_TIMESTAMP(DATE)) = YEAR(CURRENT_DATE()) AND eu.DELETED = FALSE
    GROUP BY 1
    UNION ALL
    SELECT MONTH(TO_TIMESTAMP(DATE)) AS m, SUM(TOTAL * fx.rate / 100.0) AS rev
    FROM "CHARGEBEE-UK-INVOICE" uk
    JOIN fx_rates fx ON fx.currency = COALESCE(uk.CURRENCY_CODE, 'GBP')
    WHERE uk.STATUS IN ('paid','payment_due') AND YEAR(TO_TIMESTAMP(DATE)) = YEAR(CURRENT_DATE()) AND uk.DELETED = FALSE
    GROUP BY 1
  ),
  monthly_rev AS (
    SELECT m AS month_num, ROUND(SUM(rev) / 1000000.0, 3) AS revenue_actual FROM monthly_inv GROUP BY m
  ),
  monthly_active AS (
    SELECT CAST(SUBSTRING(MONTH, 6, 2) AS INTEGER) AS month_num,
      COUNT(DISTINCT LOYVERSE_MERCHANT_ID) AS active_actual
    FROM SALES_PER_ACCOUNT_MONTHLY
    WHERE MONTH LIKE CONCAT(CAST(YEAR(CURRENT_DATE()) AS VARCHAR), '%')
    GROUP BY 1
  ),
  monthly_gtv AS (
    SELECT MONTH(TRY_TO_DATE(RECEIPT_DATE)) AS month_num,
      ROUND(SUM(TOTAL_MONEY * CASE COALESCE(CURRENCY, 'EUR')
        WHEN 'EUR' THEN 1.0
        WHEN 'USD' THEN 0.92
        WHEN 'GBP' THEN 1.17
        WHEN 'JPY' THEN 0.0061
        WHEN 'KRW' THEN 0.00067
        ELSE 1.0 END) / 1000000.0, 1) AS gtv_actual
    FROM LOYVERSE_RECEIPTS
    WHERE YEAR(TRY_TO_DATE(RECEIPT_DATE)) = YEAR(CURRENT_DATE())
    GROUP BY MONTH(TRY_TO_DATE(RECEIPT_DATE))
  ),
  targets AS (
    SELECT column1 AS month_num, column2 AS revenue_target, column3 AS active_users_target
    FROM VALUES
      (1,0.73,340000),(2,0.75,345000),(3,0.78,350000),(4,0.80,360000),
      (5,0.82,365000),(6,0.85,370000),(7,0.87,375000),(8,0.89,380000),
      (9,0.91,385000),(10,0.93,390000),(11,0.95,395000),(12,0.97,400000)
  )
  SELECT t.month_num,
    DECODE(t.month_num,1,'Jan',2,'Feb',3,'Mar',4,'Apr',5,'May',6,'Jun',
      7,'Jul',8,'Aug',9,'Sep',10,'Oct',11,'Nov',12,'Dec') AS month_abbr,
    mr.revenue_actual, t.revenue_target,
    0 AS payment_revenue_actual, 0 AS payment_revenue_target,
    0 AS arpc_actual, 0 AS arpc_target,
    ma.active_actual AS active_users_actual, t.active_users_target,
    mg.gtv_actual, 0 AS gtv_target
  FROM targets t
  LEFT JOIN monthly_rev mr ON mr.month_num = t.month_num
  LEFT JOIN monthly_active ma ON ma.month_num = t.month_num
  LEFT JOIN monthly_gtv mg ON mg.month_num = t.month_num
  ORDER BY t.month_num-- Monthly: Revenue, active users, and GTV by month for current year
-- Combines EU + UK Chargebee invoices with FX conversion and cents→EUR
-- GTV from LOYVERSE_RECEIPTS by month
-- Targets are static VALUES (update annually)

WITH fx_rates AS (
  SELECT 'EUR' AS currency, 1.0 AS rate UNION ALL
  SELECT 'USD', 0.92 UNION ALL
  SELECT 'GBP', 1.17 UNION ALL
  SELECT 'JPY', 0.0061 UNION ALL
  SELECT 'KRW', 0.00067
),
monthly_inv AS (
  SELECT MONTH(TO_TIMESTAMP(DATE)) AS m, SUM(TOTAL * fx.rate / 100.0) AS rev
  FROM "CHARGEBEE-EU-INVOICE" eu
  JOIN fx_rates fx ON fx.currency = COALESCE(eu.CURRENCY_CODE, 'EUR')
  WHERE eu.STATUS IN ('paid','payment_due') AND YEAR(TO_TIMESTAMP(DATE)) = YEAR(CURRENT_DATE()) AND eu.DELETED = FALSE
  GROUP BY 1
  UNION ALL
  SELECT MONTH(TO_TIMESTAMP(DATE)) AS m, SUM(TOTAL * fx.rate / 100.0) AS rev
  FROM "CHARGEBEE-UK-INVOICE" uk
  JOIN fx_rates fx ON fx.currency = COALESCE(uk.CURRENCY_CODE, 'GBP')
  WHERE uk.STATUS IN ('paid','payment_due') AND YEAR(TO_TIMESTAMP(DATE)) = YEAR(CURRENT_DATE()) AND uk.DELETED = FALSE
  GROUP BY 1
),
monthly_rev AS (
  SELECT m AS month_num, ROUND(SUM(rev) / 1000000.0, 3) AS revenue_actual FROM monthly_inv GROUP BY m
),
monthly_active AS (
  SELECT CAST(SUBSTRING(MONTH, 6, 2) AS INTEGER) AS month_num,
    COUNT(DISTINCT LOYVERSE_MERCHANT_ID) AS active_actual
  FROM SALES_PER_ACCOUNT_MONTHLY
  WHERE MONTH LIKE CONCAT(CAST(YEAR(CURRENT_DATE()) AS VARCHAR), '%')
  GROUP BY 1
),
monthly_gtv AS (
  SELECT MONTH(TRY_TO_DATE(RECEIPT_DATE)) AS month_num,
    ROUND(SUM(TOTAL_MONEY * CASE COALESCE(CURRENCY, 'EUR')
      WHEN 'EUR' THEN 1.0
      WHEN 'USD' THEN 0.92
      WHEN 'GBP' THEN 1.17
      WHEN 'JPY' THEN 0.0061
      WHEN 'KRW' THEN 0.00067
      ELSE 1.0 END) / 1000000.0, 1) AS gtv_actual
  FROM LOYVERSE_RECEIPTS
  WHERE YEAR(TRY_TO_DATE(RECEIPT_DATE)) = YEAR(CURRENT_DATE())
  GROUP BY MONTH(TRY_TO_DATE(RECEIPT_DATE))
),
targets AS (
  SELECT column1 AS month_num, column2 AS revenue_target, column3 AS active_users_target
  FROM VALUES
    (1,0.73,340000),(2,0.75,345000),(3,0.78,350000),(4,0.80,360000),
    (5,0.82,365000),(6,0.85,370000),(7,0.87,375000),(8,0.89,380000),
    (9,0.91,385000),(10,0.93,390000),(11,0.95,395000),(12,0.97,400000)
)
SELECT t.month_num,
  DECODE(t.month_num,1,'Jan',2,'Feb',3,'Mar',4,'Apr',5,'May',6,'Jun',
    7,'Jul',8,'Aug',9,'Sep',10,'Oct',11,'Nov',12,'Dec') AS month_abbr,
  mr.revenue_actual, t.revenue_target,
  0 AS payment_revenue_actual, 0 AS payment_revenue_target,
  0 AS arpc_actual, 0 AS arpc_target,
  ma.active_actual AS active_users_actual, t.active_users_target,
  mg.gtv_actual, 0 AS gtv_target
FROM targets t
LEFT JOIN monthly_rev mr ON mr.month_num = t.month_num
LEFT JOIN monthly_active ma ON ma.month_num = t.month_num
LEFT JOIN monthly_gtv mg ON mg.month_num = t.month_num
ORDER BY t.month_num
