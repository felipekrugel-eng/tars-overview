-- =================================================================
-- CUSUM registrations — CURRENT cumulative counts (a poll snapshot).
-- READ-ONLY single SELECT (works with DATA_VIEWER). No timestamps used.
--
-- build_cusum_data.py runs this every hour and stamps the result with the
-- Action's own UTC run-time (GitHub cron is UTC), so the CUSUM hour axis is TRUE
-- UTC by construction — it never relies on CREATED_AT's (local, untrustworthy) zone.
-- Today's accumulation = (count now) - (count at the UTC-midnight baseline).
--
-- Output: one 'TOTAL' row + one row per country, each = cumulative distinct
-- (email-deduped) registrations as of right now.
--   COUNTRY : 'TOTAL' | ISO2
--   REGS    : cumulative distinct registrations
-- =================================================================
WITH first_reg AS (                                   -- one row per merchant (email-deduped) + its country
    SELECT LOWER(TRIM(EMAIL))        AS email,
           MAX(UPPER(TRIM(COUNTRY))) AS country
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL
    GROUP BY 1
)
SELECT 'TOTAL' AS country, COUNT(*) AS regs FROM first_reg
UNION ALL
SELECT country, COUNT(*) AS regs
FROM first_reg
WHERE country IS NOT NULL AND country <> ''
GROUP BY country;
