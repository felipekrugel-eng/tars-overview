-- =================================================================
-- OUTPUT A — COUNTRIES RANKED BY REGISTRATIONS, DAILY "AS-OF" VERSION
-- READ-ONLY (single SELECT, no CREATE — works with DATA_VIEWER)
-- =================================================================
-- One row per (SNAPSHOT_DATE x COUNTRY), rebuilt for each calendar day
-- 2026-05-01 .. 2026-06-18.
--   - Registrations: merchants with CREATED_AT <= SNAPSHOT_DATE
--   - Ever paid:     merchants with an invoice PAID_AT <= SNAPSHOT_DATE
--                    and not yet voided as of then (AMOUNT_PAID > 0)
-- Caveat: hard-deleted invoices can't be time-placed and are excluded
--   from all snapshots; voids/payments are reconstructed exactly.
-- TEST: set ROWCOUNT => 3 in "snapshots" first, then switch back to 49.
-- =================================================================

WITH snapshots AS (
    SELECT DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 70))          -- TEST: set to 3 first
    WHERE DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE <= CURRENT_DATE()
),
merchants AS (
    SELECT LOWER(TRIM(m.EMAIL))                         AS EMAIL_KEY,
           UPPER(TRIM(m.COUNTRY))                       AS COUNTRY,
           MIN(DATE_TRUNC('MONTH', m.CREATED_AT)::DATE) AS COHORT_MONTH,
           MIN(m.CREATED_AT::DATE)                      AS FIRST_CREATED_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
    GROUP BY LOWER(TRIM(m.EMAIL)), UPPER(TRIM(m.COUNTRY))
),
-- Invoice-level paid markers (gated as-of per snapshot below)
paid_invoices AS (
    SELECT LOWER(TRIM(c.EMAIL))                          AS EMAIL_KEY,
           TO_TIMESTAMP(i.PAID_AT)::DATE                  AS PAID_DATE,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND i.AMOUNT_PAID > 0 AND c.EMAIL IS NOT NULL
    UNION ALL
    SELECT LOWER(TRIM(c.EMAIL)),
           TO_TIMESTAMP(i.PAID_AT)::DATE,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE)
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND i.AMOUNT_PAID > 0 AND c.EMAIL IS NOT NULL
),
-- Emails that had paid (and not-yet-voided) by each snapshot day
ever_paid_emails AS (
    SELECT DISTINCT s.SNAPSHOT_DATE, pi.EMAIL_KEY
    FROM paid_invoices pi
    JOIN snapshots s
      ON pi.PAID_DATE <= s.SNAPSHOT_DATE
     AND (pi.VOID_DATE IS NULL OR pi.VOID_DATE > s.SNAPSHOT_DATE)
),
-- Merchants registered by each snapshot day
merchants_asof AS (
    SELECT s.SNAPSHOT_DATE, m.EMAIL_KEY, m.COUNTRY, m.COHORT_MONTH
    FROM merchants m
    JOIN snapshots s ON m.FIRST_CREATED_DATE <= s.SNAPSHOT_DATE
)
SELECT
    m.SNAPSHOT_DATE,
    m.COUNTRY,
    COUNT(DISTINCT m.EMAIL_KEY)                                                AS REGISTRATIONS,
    COUNT(DISTINCT ep.EMAIL_KEY)                                               AS EVER_PAID,
    ROUND(100.0 * COUNT(DISTINCT ep.EMAIL_KEY) / NULLIF(COUNT(DISTINCT m.EMAIL_KEY), 0), 2) AS PCT_EVER_PAID,
    MIN(m.COHORT_MONTH)                                                        AS FIRST_REGISTRATION_MONTH,
    MAX(m.COHORT_MONTH)                                                        AS LAST_REGISTRATION_MONTH
FROM merchants_asof m
LEFT JOIN ever_paid_emails ep
       ON ep.SNAPSHOT_DATE = m.SNAPSHOT_DATE
      AND ep.EMAIL_KEY     = m.EMAIL_KEY
WHERE m.COUNTRY IS NOT NULL AND m.COUNTRY <> ''
GROUP BY m.SNAPSHOT_DATE, m.COUNTRY
ORDER BY m.SNAPSHOT_DATE, REGISTRATIONS DESC;
