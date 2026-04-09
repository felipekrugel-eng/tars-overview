-- Cohort Aging Matrix: KPIs per cohort at each month of age
-- Result: one row per (cohort_month, age_months)
-- Used to render the cohort evolution heatmap on the CASE dashboard
-- Tracks: active merchants (retention), revenue, cumulative revenue, GTV
--
-- Data sources:
--   Activity: SALES_PER_ACCOUNT_MONTHLY (merchant × month)
--   Revenue:  CHARGEBEE-*-INVOICE (linked via customer ID → LOYVERSE_ID)
--   GTV:      LOYVERSE_RECEIPTS (merchant × receipt date)

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

-- All merchants with their cohort month
cohort_base AS (
  SELECT
    m.LOYVERSE_ID,
    TO_CHAR(m.CREATED_AT, 'YYYY-MM') AS cohort_month
  FROM LOYVERSE_MERCHANTS m
  WHERE m.CREATED_AT IS NOT NULL
),

-- Registration counts per cohort
cohort_sizes AS (
  SELECT cohort_month, COUNT(*) AS registrations
  FROM cohort_base
  GROUP BY cohort_month
),

-- Monthly activity: which merchants were active in which months
-- Source: SALES_PER_ACCOUNT_MONTHLY (has MONTH in YYYY-MM format)
monthly_activity AS (
  SELECT
    cb.cohort_month,
    s.MONTH AS obs_month,
    DATEDIFF('month',
      TO_DATE(cb.cohort_month || '-01', 'YYYY-MM-DD'),
      TO_DATE(s.MONTH || '-01', 'YYYY-MM-DD')
    ) AS age_months,
    COUNT(DISTINCT s.LOYVERSE_MERCHANT_ID) AS active_merchants
  FROM SALES_PER_ACCOUNT_MONTHLY s
  JOIN cohort_base cb ON cb.LOYVERSE_ID = s.LOYVERSE_MERCHANT_ID
  WHERE s.MONTH >= cb.cohort_month
  GROUP BY cb.cohort_month, s.MONTH
),

-- Monthly revenue from Chargebee invoices (EU + UK)
monthly_revenue AS (
  SELECT cohort_month, obs_month, age_months, SUM(rev_eur) AS revenue_eur FROM (
    -- EU invoices
    SELECT
      cb.cohort_month,
      TO_CHAR(TO_TIMESTAMP(i.DATE), 'YYYY-MM') AS obs_month,
      DATEDIFF('month',
        TO_DATE(cb.cohort_month || '-01', 'YYYY-MM-DD'),
        TO_DATE(TO_CHAR(TO_TIMESTAMP(i.DATE), 'YYYY-MM') || '-01', 'YYYY-MM-DD')
      ) AS age_months,
      i.TOTAL * COALESCE(fx.rate, 1.0) / 100.0 AS rev_eur
    FROM "CHARGEBEE-EU-INVOICE" i
    JOIN "CHARGEBEE-EU-CUSTOMER" c ON i.CUSTOMER_ID = c.ID
    JOIN cohort_base cb ON cb.LOYVERSE_ID = TRY_CAST(c.ID AS NUMBER)
    JOIN fx_rates fx ON fx.currency = COALESCE(i.CURRENCY_CODE, 'EUR')
    WHERE i.STATUS IN ('paid', 'payment_due') AND i.DELETED = FALSE AND c.DELETED = FALSE
    UNION ALL
    -- UK invoices
    SELECT
      cb.cohort_month,
      TO_CHAR(TO_TIMESTAMP(i.DATE), 'YYYY-MM') AS obs_month,
      DATEDIFF('month',
        TO_DATE(cb.cohort_month || '-01', 'YYYY-MM-DD'),
        TO_DATE(TO_CHAR(TO_TIMESTAMP(i.DATE), 'YYYY-MM') || '-01', 'YYYY-MM-DD')
      ) AS age_months,
      i.TOTAL * COALESCE(fx.rate, 1.0) / 100.0 AS rev_eur
    FROM "CHARGEBEE-UK-INVOICE" i
    JOIN "CHARGEBEE-UK-CUSTOMER" c ON i.CUSTOMER_ID = c.ID
    JOIN cohort_base cb ON cb.LOYVERSE_ID = TRY_CAST(c.ID AS NUMBER)
    JOIN fx_rates fx ON fx.currency = COALESCE(i.CURRENCY_CODE, 'GBP')
    WHERE i.STATUS IN ('paid', 'payment_due') AND i.DELETED = FALSE AND c.DELETED = FALSE
  )
  WHERE age_months >= 0
  GROUP BY cohort_month, obs_month, age_months
),

-- Monthly GTV from receipts
monthly_gtv AS (
  SELECT
    cb.cohort_month,
    TO_CHAR(TRY_TO_DATE(lr.RECEIPT_DATE), 'YYYY-MM') AS obs_month,
    DATEDIFF('month',
      TO_DATE(cb.cohort_month || '-01', 'YYYY-MM-DD'),
      TO_DATE(TO_CHAR(TRY_TO_DATE(lr.RECEIPT_DATE), 'YYYY-MM') || '-01', 'YYYY-MM-DD')
    ) AS age_months,
    SUM(lr.TOTAL_MONEY * fx.rate) AS gtv_eur  -- NULL rate excludes unknown currencies
  FROM LOYVERSE_RECEIPTS lr
  JOIN cohort_base cb ON cb.LOYVERSE_ID = lr.MERCHANT_ID
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(lr.CURRENCY, 'EUR')
  WHERE TRY_TO_DATE(lr.RECEIPT_DATE) IS NOT NULL
    AND TO_CHAR(TRY_TO_DATE(lr.RECEIPT_DATE), 'YYYY-MM') >= cb.cohort_month
  GROUP BY cb.cohort_month, TO_CHAR(TRY_TO_DATE(lr.RECEIPT_DATE), 'YYYY-MM')
)

-- Combine all metrics per cohort × age
SELECT
  COALESCE(a.cohort_month, r.cohort_month, g.cohort_month) AS cohort_month,
  COALESCE(a.age_months, r.age_months, g.age_months) AS age_months,
  cs.registrations,
  COALESCE(a.active_merchants, 0) AS active_merchants,
  ROUND(COALESCE(a.active_merchants, 0) * 100.0 / NULLIF(cs.registrations, 0), 1) AS retention_pct,
  ROUND(COALESCE(r.revenue_eur, 0), 0) AS revenue_eur,
  ROUND(SUM(COALESCE(r.revenue_eur, 0)) OVER (
    PARTITION BY COALESCE(a.cohort_month, r.cohort_month, g.cohort_month)
    ORDER BY COALESCE(a.age_months, r.age_months, g.age_months)
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ), 0) AS cumulative_revenue_eur,
  ROUND(COALESCE(r.revenue_eur, 0) / NULLIF(COALESCE(a.active_merchants, 0), 0), 2) AS revenue_per_active_eur,
  ROUND(COALESCE(g.gtv_eur, 0) / 1000.0, 1) AS gtv_k_eur
FROM monthly_activity a
FULL OUTER JOIN monthly_revenue r
  ON a.cohort_month = r.cohort_month AND a.age_months = r.age_months
FULL OUTER JOIN monthly_gtv g
  ON COALESCE(a.cohort_month, r.cohort_month) = g.cohort_month
  AND COALESCE(a.age_months, r.age_months) = g.age_months
JOIN cohort_sizes cs
  ON cs.cohort_month = COALESCE(a.cohort_month, r.cohort_month, g.cohort_month)
WHERE COALESCE(a.age_months, r.age_months, g.age_months) >= 0
  AND COALESCE(a.age_months, r.age_months, g.age_months) <= 120
ORDER BY COALESCE(a.cohort_month, r.cohort_month, g.cohort_month) DESC,
         COALESCE(a.age_months, r.age_months, g.age_months)
