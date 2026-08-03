-- =================================================================
-- DAILY PAYING FLOW — RAW vs GRACE-ADJUSTED (side by side)
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- Same walk-forward as daily_paying_flow.sql, but computes churn/adds under TWO
-- definitions in one pass so you can see how much churn is just renewal-timing lag:
--   RAW    = "paying on D" if a paid invoice period covers D  (PERIOD_START <= D < PERIOD_END)
--   G3     = same, but PERIOD_END is extended by 3 days, so a renewal that posts a couple of
--            days late does NOT register as a churn + re-add. Feeds the FACADASH daily
--            gross-adds panel, which wants a short, responsive window.
--   GRACE  = same with a 30-DAY extension. This is the company-standard churn definition
--            (Alex + team): a merchant is churned only once it is 30 days past period end
--            with no payment. Feeds the Study & Trend monthly adds-vs-churn chart.
-- The gap CHURN_RAW − CHURN_GRACE (biggest at month boundaries) ≈ renewal-lag noise;
-- CHURN_GRACE is the "cleaner" churn.
--   ⚠ CENSORING: a 30-day grace means a merchant who lapsed yesterday still counts as paying
--            for another 30 days. CHURN_GRACE therefore reads LOW and FINAL_GRACE reads HIGH
--            over the trailing 30 days, settling over the following month. Consumers must treat
--            the last 30 days (and the newest calendar month) as provisional.
--   FINAL = paying at end of day (INITIAL of next day). Merchants deduped by email.
-- ⚙️  Edit D_START / D_END / GRACE_DAYS in params. (Chargebee only — POS-only fake
--     accounts are NOT paying subs, so they don't appear here.)
-- =================================================================

WITH params AS (
    SELECT DATE '2022-01-01' AS D_START,   -- full history from Jan 2022
           DATE '2026-07-05' AS D_END,
           3                 AS GRACE_DAYS_D, -- short window -> *_G3  (FACADASH daily adds)
           30                AS GRACE_DAYS    -- 30d team standard -> *_GRACE (Study & Trend)
),
-- ⚠️ 4.5-year window = a large merchant x day grid built TWICE (raw + grace). If this
--    times out or spills, run it a YEAR AT A TIME (set D_START/D_END to 2022-01-01..2022-12-31,
--    then 2023-..., etc.) and send each CSV — they stitch seamlessly (Jan-1 Initial of one
--    year = Dec-31 Final of the prior). intervals is NOT date-filtered, so each chunk is exact.
uk_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                        AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS PERIOD_END,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                        AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS PERIOD_END,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
intervals AS (
    SELECT DISTINCT EMAIL_KEY, PERIOD_START, PERIOD_END,
           DATEADD('day', (SELECT GRACE_DAYS_D FROM params), PERIOD_END) AS PERIOD_END_G3,
           DATEADD('day', (SELECT GRACE_DAYS   FROM params), PERIOD_END) AS PERIOD_END_G
    FROM (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines)
    WHERE VOID_DATE IS NULL AND PERIOD_END > PERIOD_START
),
spine AS (
    SELECT d FROM (
        SELECT DATEADD('day', SEQ4() - 1, (SELECT DATEADD('day', -1, D_START) FROM params)) AS d
        FROM TABLE(GENERATOR(ROWCOUNT => 4000))
    )
    WHERE d BETWEEN (SELECT DATEADD('day', -1, D_START) FROM params) AND (SELECT D_END FROM params)
),
member_raw AS (
    SELECT DISTINCT i.EMAIL_KEY, s.d
    FROM intervals i JOIN spine s ON s.d >= i.PERIOD_START AND s.d < i.PERIOD_END
),
member_g3 AS (
    SELECT DISTINCT i.EMAIL_KEY, s.d
    FROM intervals i JOIN spine s ON s.d >= i.PERIOD_START AND s.d < i.PERIOD_END_G3
),
member_grace AS (
    SELECT DISTINCT i.EMAIL_KEY, s.d
    FROM intervals i JOIN spine s ON s.d >= i.PERIOD_START AND s.d < i.PERIOD_END_G
),
active_merchants AS (SELECT DISTINCT EMAIL_KEY FROM member_grace),   -- widest grace is the superset
grid AS (SELECT m.EMAIL_KEY, s.d FROM active_merchants m CROSS JOIN spine s),
mem AS (
    SELECT g.EMAIL_KEY, g.d,
           IFF(mr.EMAIL_KEY IS NOT NULL, 1, 0) AS is_raw,
           IFF(m3.EMAIL_KEY IS NOT NULL, 1, 0) AS is_g3,
           IFF(mg.EMAIL_KEY IS NOT NULL, 1, 0) AS is_grace
    FROM grid g
    LEFT JOIN member_raw   mr ON mr.EMAIL_KEY = g.EMAIL_KEY AND mr.d = g.d
    LEFT JOIN member_g3    m3 ON m3.EMAIL_KEY = g.EMAIL_KEY AND m3.d = g.d
    LEFT JOIN member_grace mg ON mg.EMAIL_KEY = g.EMAIL_KEY AND mg.d = g.d
),
chg AS (
    SELECT EMAIL_KEY, d, is_raw, is_g3, is_grace,
           LAG(is_raw)   OVER (PARTITION BY EMAIL_KEY ORDER BY d) AS prev_raw,
           LAG(is_g3)    OVER (PARTITION BY EMAIL_KEY ORDER BY d) AS prev_g3,
           LAG(is_grace) OVER (PARTITION BY EMAIL_KEY ORDER BY d) AS prev_grace
    FROM mem
)
SELECT
    d                                                                 AS "DATE",
    -- RAW
    SUM(COALESCE(prev_raw,0))                                          AS INITIAL_RAW,
    SUM(IFF(prev_raw = 1 AND is_raw = 0, 1, 0))                        AS CHURN_RAW,
    SUM(IFF(COALESCE(prev_raw,0) = 0 AND is_raw = 1, 1, 0))            AS ADDS_RAW,
    SUM(is_raw)                                                        AS FINAL_RAW,
    -- G3 = 3-day grace (FACADASH daily gross-adds panel)
    SUM(COALESCE(prev_g3,0))                                           AS INITIAL_G3,
    SUM(IFF(prev_g3 = 1 AND is_g3 = 0, 1, 0))                          AS CHURN_G3,
    SUM(IFF(COALESCE(prev_g3,0) = 0 AND is_g3 = 1, 1, 0))              AS ADDS_G3,
    SUM(is_g3)                                                         AS FINAL_G3,
    -- GRACE-ADJUSTED = 30-day grace, team standard (Study & Trend monthly chart)
    SUM(COALESCE(prev_grace,0))                                        AS INITIAL_GRACE,
    SUM(IFF(prev_grace = 1 AND is_grace = 0, 1, 0))                    AS CHURN_GRACE,
    SUM(IFF(COALESCE(prev_grace,0) = 0 AND is_grace = 1, 1, 0))        AS ADDS_GRACE,
    SUM(is_grace)                                                      AS FINAL_GRACE,
    -- how much of raw churn is renewal-lag noise
    SUM(IFF(prev_raw = 1 AND is_raw = 0, 1, 0))
      - SUM(IFF(prev_grace = 1 AND is_grace = 0, 1, 0))               AS CHURN_LAG_DIFF
FROM chg
WHERE d >= (SELECT D_START FROM params)
GROUP BY d
ORDER BY d;
