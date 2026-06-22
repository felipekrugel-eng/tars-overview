-- =================================================================
-- COUNTRY x MONTH REGISTRATIONS (+ CUMULATIVE) — DAILY "AS-OF" VERSION
-- READ-ONLY (single SELECT, no CREATE — works with DATA_VIEWER)
-- =================================================================
-- One row per (SNAPSHOT_DATE x COUNTRY x CALENDAR_MONTH), rebuilt for
-- each calendar day 2026-05-01 .. 2026-06-18.
--   - A merchant counts only if CREATED_AT <= SNAPSHOT_DATE
--   - Country lifecycle grid runs first-registration-month (as of the
--     snapshot) -> the snapshot's own month (replaces CURRENT_DATE())
-- No invoices involved, so there's no void/delete caveat here — this is
-- an exact reconstruction from merchant CREATED_AT.
-- TEST: set ROWCOUNT => 3 in "snapshots" first, then switch back to 49.
-- =================================================================

WITH snapshots AS (
    SELECT DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 70))          -- TEST: set to 3 first
    WHERE DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE <= CURRENT_DATE()
),
-- Dedup by email x country; registration month = earliest account (OUTPUT-A convention).
merchants AS (
    SELECT LOWER(TRIM(m.EMAIL))                         AS EMAIL_KEY,
           UPPER(TRIM(m.COUNTRY))                       AS COUNTRY,
           MIN(DATE_TRUNC('MONTH', m.CREATED_AT)::DATE) AS REG_MONTH,
           MIN(m.CREATED_AT::DATE)                      AS FIRST_CREATED_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL
      AND m.CREATED_AT IS NOT NULL
      AND m.COUNTRY IS NOT NULL AND m.COUNTRY <> ''
    GROUP BY LOWER(TRIM(m.EMAIL)), UPPER(TRIM(m.COUNTRY))
),
-- Registrations per country x month, counting only merchants that existed by the snapshot day.
reg_per_month AS (
    SELECT s.SNAPSHOT_DATE, m.COUNTRY, m.REG_MONTH, COUNT(*) AS REGISTRATIONS
    FROM merchants m
    JOIN snapshots s ON m.FIRST_CREATED_DATE <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, m.COUNTRY, m.REG_MONTH
),
-- Each country's lifecycle span (per snapshot): first registration -> snapshot month.
country_span AS (
    SELECT SNAPSHOT_DATE,
           COUNTRY,
           MIN(REG_MONTH)                          AS FIRST_MONTH,
           DATE_TRUNC('MONTH', SNAPSHOT_DATE)::DATE AS LAST_MONTH   -- was CURRENT_DATE()
    FROM reg_per_month
    GROUP BY SNAPSHOT_DATE, COUNTRY
),
month_spine AS (
    SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 600))
),
-- Every (country x month) from that country's first registration onward, per snapshot.
country_month_grid AS (
    SELECT cs.SNAPSHOT_DATE,
           cs.COUNTRY,
           DATEADD('MONTH', s.SEQ, cs.FIRST_MONTH)::DATE AS CALENDAR_MONTH
    FROM country_span cs
    CROSS JOIN month_spine s
    WHERE DATEADD('MONTH', s.SEQ, cs.FIRST_MONTH)::DATE <= cs.LAST_MONTH
)
SELECT
    g.SNAPSHOT_DATE,
    g.COUNTRY,
    g.CALENDAR_MONTH,
    YEAR(g.CALENDAR_MONTH)                               AS CALENDAR_YEAR,
    DATEDIFF('MONTH',
             MIN(g.CALENDAR_MONTH) OVER (PARTITION BY g.SNAPSHOT_DATE, g.COUNTRY),
             g.CALENDAR_MONTH)                           AS MONTH_NUMBER,   -- 0 = country's first month
    COALESCE(r.REGISTRATIONS, 0)                         AS REGISTRATIONS,
    SUM(COALESCE(r.REGISTRATIONS, 0))
        OVER (PARTITION BY g.SNAPSHOT_DATE, g.COUNTRY ORDER BY g.CALENDAR_MONTH) AS CUM_REGISTRATIONS
FROM country_month_grid g
LEFT JOIN reg_per_month r
       ON r.SNAPSHOT_DATE = g.SNAPSHOT_DATE
      AND r.COUNTRY       = g.COUNTRY
      AND r.REG_MONTH     = g.CALENDAR_MONTH
ORDER BY g.SNAPSHOT_DATE, g.COUNTRY, g.CALENDAR_MONTH;
