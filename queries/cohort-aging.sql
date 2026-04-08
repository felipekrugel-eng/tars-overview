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
  SELECT 'EUR' AS currency, 1.0 AS rate UNION ALL
  SELECT 'USD', 0.92 UNION ALL
  SELECT 'GBP', 1.17 UNION ALL
  SELECT 'JPY', 0.0061 UNION ALL
  SELECT 'KRW', 0.00067
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
    SUM(lr.TOTAL_MONEY * COALESCE(fx.rate, 1.0)) AS gtv_eur
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
