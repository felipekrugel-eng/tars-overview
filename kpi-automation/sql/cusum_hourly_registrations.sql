-- =================================================================
-- CUSUM hourly registrations — feeds the FACADASH "registrations today" CUSUM widget.
-- READ-ONLY single SELECT (works with DATA_VIEWER). Registrations only — cheap, no receipts.
-- DRAFT: validate the dedup + column names against the canonical registration query on first run.
--
-- Registration = a merchant's FIRST account creation (email-deduped), bucketed in TRUE UTC:
--   reg_day  = DATE of MIN(CREATED_AT), converted to UTC
--   reg_hour = HOUR of MIN(CREATED_AT), converted to UTC
-- CREATED_AT is TIMESTAMP_LTZ, so HOUR()/::DATE would otherwise render in the session
-- timezone (not reliably UTC on the runner). CONVERT_TIMEZONE('UTC', ts) pins it to UTC.
--
-- Output (long/tidy — build_cusum_data.py pivots it):
--   SERIES   : 'today' | 'best' | 'lastweek' | 'country'
--   REF_DATE : the calendar date the hourly series belongs to (NULL for 'country')
--   HOUR     : 0..23 for the hourly series (NULL for 'country')
--   COUNTRY  : ISO2 for SERIES='country' (NULL otherwise)
--   REGS     : registrations in that hour (hourly series) / today (country series)
-- =================================================================
WITH first_reg AS (                                   -- one row per merchant: their first registration moment
    SELECT LOWER(TRIM(EMAIL))            AS email,
           MIN(CREATED_AT)               AS first_ts,
           MAX(UPPER(TRIM(COUNTRY)))     AS country     -- ISO2 uppercase, matches the rest of the dashboard
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL
    GROUP BY 1
),
reg AS (                                              -- decorate with day/hour, in TRUE UTC
    SELECT email, country,
           CONVERT_TIMEZONE('UTC', first_ts)::DATE  AS reg_day,
           HOUR(CONVERT_TIMEZONE('UTC', first_ts))  AS reg_hour
    FROM first_reg
),
best_day AS (                                         -- the single highest-registration day, all-time
    SELECT reg_day FROM reg GROUP BY reg_day ORDER BY COUNT(*) DESC LIMIT 1
),
anchors AS (                                          -- the three dates we chart (TRUE UTC "today")
    SELECT 'today'    AS series, CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP())::DATE                     AS ref_date UNION ALL
    SELECT 'lastweek',           DATEADD('day', -7, CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP())::DATE)             UNION ALL
    SELECT 'best',     (SELECT reg_day FROM best_day)
),
hours AS ( SELECT SEQ4() AS hour FROM TABLE(GENERATOR(ROWCOUNT => 24)) ),
hourly AS (                                           -- registrations per (series-date, hour); 0 where none
    SELECT a.series, a.ref_date, h.hour AS hour,
           COUNT(r.email) AS regs
    FROM anchors a
    CROSS JOIN hours h
    LEFT JOIN reg r ON r.reg_day = a.ref_date AND r.reg_hour = h.hour
    GROUP BY a.series, a.ref_date, h.hour
),
by_country AS (                                       -- today's registrations by country (for the side panel)
    SELECT 'country' AS series, NULL::DATE AS ref_date, NULL::INT AS hour,
           country, COUNT(*) AS regs
    FROM reg WHERE reg_day = CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP())::DATE AND country IS NOT NULL AND country <> ''
    GROUP BY country
)
SELECT series, ref_date, hour, NULL::STRING AS country, regs FROM hourly
UNION ALL
SELECT series, ref_date, hour, country, regs FROM by_country
ORDER BY series, hour, regs DESC;
