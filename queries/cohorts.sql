-- Cohort Analysis: One row per registration month with full KPI breakdown
-- Cohort = all merchants who registered in the same YYYY-MM
-- Tracks: registrations, still active, paying, MRR, GTV, churn, NPV, LTV
-- Registration date: LOYVERSE_MERCHANTS.CREATED_AT
-- Chargebee link: CHARGEBEE-*-CUSTOMER.ID = LOYVERSE_MERCHANTS.LOYVERSE_ID

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
    m.COUNTRY,
    TO_CHAR(m.CREATED_AT, 'YYYY-MM') AS cohort_month,
    m.CREATED_AT AS registered_at
  FROM LOYVERSE_MERCHANTS m
  WHERE m.CREATED_AT IS NOT NULL
),

-- Active merchants (had sales in last 30 days)
active_merchants AS (
  SELECT DISTINCT LOYVERSE_MERCHANT_ID AS loyverse_id
  FROM SALES_PER_ACCOUNT_MONTHLY
  WHERE MONTH >= TO_CHAR(DATEADD('month', -1, CURRENT_DATE()), 'YYYY-MM')
),

-- All Chargebee subscriptions (EU + UK) linked to LOYVERSE_ID
all_subs AS (
  SELECT
    TRY_CAST(c.ID AS NUMBER) AS loyverse_id,
    s.STATUS AS sub_status,
    s.MRR,
    COALESCE(s.CURRENCY_CODE, 'EUR') AS currency_code,
    s.CANCELLED_AT
  FROM "CHARGEBEE-EU-SUBSCRIPTION" s
  JOIN "CHARGEBEE-EU-CUSTOMER" c ON s.CUSTOMER_ID = c.ID
  WHERE s.DELETED = FALSE AND c.DELETED = FALSE
  UNION ALL
  SELECT
    TRY_CAST(c.ID AS NUMBER) AS loyverse_id,
    s.STATUS AS sub_status,
    s.MRR,
    COALESCE(s.CURRENCY_CODE, 'GBP') AS currency_code,
    s.CANCELLED_AT
  FROM "CHARGEBEE-UK-SUBSCRIPTION" s
  JOIN "CHARGEBEE-UK-CUSTOMER" c ON s.CUSTOMER_ID = c.ID
  WHERE s.DELETED = FALSE AND c.DELETED = FALSE
),

-- Active (paying) subscriptions with MRR in EUR
paying_subs AS (
  SELECT
    s.loyverse_id,
    ROUND(SUM(s.MRR * COALESCE(fx.rate, 1.0) / 100.0), 2) AS mrr_eur
  FROM all_subs s
  JOIN fx_rates fx ON fx.currency = s.currency_code
  WHERE s.sub_status = 'active'
  GROUP BY s.loyverse_id
),

-- Cancelled subscriptions in last 30 days (for churn)
recently_cancelled AS (
  SELECT DISTINCT s.loyverse_id
  FROM all_subs s
  WHERE s.sub_status = 'cancelled'
    AND s.CANCELLED_AT IS NOT NULL
    AND TO_TIMESTAMP(s.CANCELLED_AT) >= DATEADD('day', -30, CURRENT_TIMESTAMP())
),

-- GTV per merchant (last 30 days)
merchant_gtv AS (
  SELECT
    lr.MERCHANT_ID AS loyverse_id,
    SUM(lr.TOTAL_MONEY * COALESCE(fx.rate, 1.0)) AS gtv_30d_eur
  FROM LOYVERSE_RECEIPTS lr
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(lr.CURRENCY, 'EUR')
  WHERE TRY_TO_DATE(lr.RECEIPT_DATE) >= DATEADD('day', -30, CURRENT_DATE())
  GROUP BY lr.MERCHANT_ID
),

-- All-time GTV per merchant (for LTV calculation)
merchant_gtv_alltime AS (
  SELECT
    lr.MERCHANT_ID AS loyverse_id,
    SUM(lr.TOTAL_MONEY * COALESCE(fx.rate, 1.0)) AS gtv_total_eur
  FROM LOYVERSE_RECEIPTS lr
  LEFT JOIN fx_rates fx ON fx.currency = COALESCE(lr.CURRENCY, 'EUR')
  GROUP BY lr.MERCHANT_ID
),

-- All-time revenue per merchant from invoices (for LTV/NPV)
merchant_revenue_alltime AS (
  SELECT loyverse_id, SUM(rev_eur) AS total_revenue_eur FROM (
    SELECT
      TRY_CAST(c.ID AS NUMBER) AS loyverse_id,
      SUM(i.TOTAL * COALESCE(fx.rate, 1.0) / 100.0) AS rev_eur
    FROM "CHARGEBEE-EU-INVOICE" i
    JOIN "CHARGEBEE-EU-CUSTOMER" c ON i.CUSTOMER_ID = c.ID
    JOIN fx_rates fx ON fx.currency = COALESCE(i.CURRENCY_CODE, 'EUR')
    WHERE i.STATUS IN ('paid', 'payment_due') AND i.DELETED = FALSE AND c.DELETED = FALSE
    GROUP BY TRY_CAST(c.ID AS NUMBER)
    UNION ALL
    SELECT
      TRY_CAST(c.ID AS NUMBER) AS loyverse_id,
      SUM(i.TOTAL * COALESCE(fx.rate, 1.0) / 100.0) AS rev_eur
    FROM "CHARGEBEE-UK-INVOICE" i
    JOIN "CHARGEBEE-UK-CUSTOMER" c ON i.CUSTOMER_ID = c.ID
    JOIN fx_rates fx ON fx.currency = COALESCE(i.CURRENCY_CODE, 'GBP')
    WHERE i.STATUS IN ('paid', 'payment_due') AND i.DELETED = FALSE AND c.DELETED = FALSE
    GROUP BY TRY_CAST(c.ID AS NUMBER)
  )
  GROUP BY loyverse_id
)

-- Aggregate by cohort
SELECT
  cb.cohort_month,
  COUNT(*) AS registrations,

  -- Active (had sales last 30d)
  COUNT(CASE WHEN am.loyverse_id IS NOT NULL THEN 1 END) AS active_now,
  ROUND(COUNT(CASE WHEN am.loyverse_id IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS active_pct,

  -- Paying (active Chargebee subscription)
  COUNT(CASE WHEN ps.loyverse_id IS NOT NULL THEN 1 END) AS paying_now,
  ROUND(COUNT(CASE WHEN ps.loyverse_id IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS paying_pct,

  -- Conversion: active to paying
  ROUND(COUNT(CASE WHEN ps.loyverse_id IS NOT NULL THEN 1 END) * 100.0
    / NULLIF(COUNT(CASE WHEN am.loyverse_id IS NOT NULL THEN 1 END), 0), 1) AS active_to_paying_pct,

  -- MRR and ARR
  ROUND(COALESCE(SUM(ps.mrr_eur), 0), 0) AS cohort_mrr_eur,
  ROUND(COALESCE(SUM(ps.mrr_eur), 0) * 12, 0) AS cohort_arr_eur,

  -- ARPC (avg revenue per paying customer per month)
  ROUND(COALESCE(SUM(ps.mrr_eur), 0) / NULLIF(COUNT(CASE WHEN ps.loyverse_id IS NOT NULL THEN 1 END), 0), 2) AS arpc_eur,

  -- GTV (last 30 days)
  ROUND(COALESCE(SUM(g.gtv_30d_eur), 0) / 1000.0, 1) AS gtv_30d_k_eur,

  -- GTV all-time
  ROUND(COALESCE(SUM(ga.gtv_total_eur), 0) / 1000000.0, 2) AS gtv_alltime_m_eur,

  -- Revenue all-time (total revenue from this cohort)
  ROUND(COALESCE(SUM(r.total_revenue_eur), 0) / 1000.0, 1) AS revenue_alltime_k_eur,

  -- NPV per merchant (total revenue / registrations)
  ROUND(COALESCE(SUM(r.total_revenue_eur), 0) / NULLIF(COUNT(*), 0), 2) AS npv_per_merchant_eur,

  -- LTV per paying merchant (total revenue / paying count)
  ROUND(COALESCE(SUM(r.total_revenue_eur), 0) / NULLIF(COUNT(CASE WHEN ps.loyverse_id IS NOT NULL THEN 1 END), 0), 2) AS ltv_per_paying_eur,

  -- Churn (cancelled in last 30d / (paying + cancelled))
  COUNT(CASE WHEN rc.loyverse_id IS NOT NULL THEN 1 END) AS cancelled_30d,
  ROUND(COUNT(CASE WHEN rc.loyverse_id IS NOT NULL THEN 1 END) * 100.0
    / NULLIF(COUNT(CASE WHEN ps.loyverse_id IS NOT NULL THEN 1 END)
           + COUNT(CASE WHEN rc.loyverse_id IS NOT NULL THEN 1 END), 0), 1) AS churn_rate_30d,

  -- Cohort age in months
  DATEDIFF('month', MIN(cb.registered_at), CURRENT_TIMESTAMP()) AS cohort_age_months

FROM cohort_base cb
LEFT JOIN active_merchants am ON am.loyverse_id = cb.LOYVERSE_ID
LEFT JOIN paying_subs ps ON ps.loyverse_id = cb.LOYVERSE_ID
LEFT JOIN recently_cancelled rc ON rc.loyverse_id = cb.LOYVERSE_ID
LEFT JOIN merchant_gtv g ON g.loyverse_id = cb.LOYVERSE_ID
LEFT JOIN merchant_gtv_alltime ga ON ga.loyverse_id = cb.LOYVERSE_ID
LEFT JOIN merchant_revenue_alltime r ON r.loyverse_id = cb.LOYVERSE_ID
GROUP BY cb.cohort_month
ORDER BY cb.cohort_month DESC
