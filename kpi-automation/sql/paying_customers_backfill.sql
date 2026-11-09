-- =================================================================
-- PAYING CUSTOMERS — month-end history, reconstructed
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- A ONE-OFF. This was run once, on 2026-11-09, to fill
-- "KPI Dashboard v2 (Caio)/paying-snapshots.json" back to 2022-01. It is committed so the
-- reconstruction can be audited and, if the method is ever disputed, re-run — NOT because
-- the pipeline calls it. It does not run daily and must not: a month close that moves is
-- not a close.
--
-- WHY A RECONSTRUCTION IS NEEDED AT ALL. CHARGEBEE_SUBSCRIPTIONS_V carries CURRENT status
-- only — there is no as-of. Nobody was snapshotting the count before 2026-11, so the only
-- way to say how many merchants were paying at the end of, say, March 2023 is to infer it:
--   * the subscription must have STARTED before the month ended
--     (ACTIVATED_AT, falling back to CREATED_AT), and
--   * must not have been CANCELLED before the month ended, and
--   * an invoice line must actually have COVERED the month end — period start on or before
--     it, period end after it. Lifecycle dates alone would count subscriptions through
--     gaps they were not billed for.
-- 'future' is excluded: never started. 'paused' is left in deliberately — a subscription
-- paused TODAY may well have been billing in 2023, and current status says nothing about
-- what was true then.
--
-- THE -50. The caller subtracts 50 from every row of this query before storing it. That
-- offset is measured, not a plug. Extending this query over the months whose values were
-- already known and comparing:
--     2025-12, 2026-01, 2026-02, 2026-03, 2026-10  -> EXACT after -50 (gap 0 on all five)
--     2026-04 .. 2026-09, Alex's own figures       -> within -3 to +7, mean +0.2
-- So the raw count sits about 50 merchants above the reported definition across four
-- years, and removing it reproduces every month anyone had already measured. Checked
-- 2026-11-09; if this is ever re-run, re-measure the offset rather than trusting this
-- number, and record the result here.
--
-- THIS IS AN APPROXIMATION AND IS LABELLED AS ONE. Every month it produces is stored with
-- source "rebuilt", distinct from "Alex" (his own reporting) and "snapshot" (captured
-- live). Do not present a rebuilt month as a measurement.
--
-- Range: 47 month ends, 2022-01 through 2025-11. Months from 2025-12 onward already had
-- values and are never overwritten.
-- =================================================================

WITH months AS (
  SELECT LAST_DAY(DATEADD('month', SEQ4(), '2022-01-01'::DATE)) AS MEND,
         DATEADD('day', 1, LAST_DAY(DATEADD('month', SEQ4(), '2022-01-01'::DATE)))::TIMESTAMP AS NXT
  FROM TABLE(GENERATOR(ROWCOUNT => 47))
),
subs AS (
  SELECT LOWER(REGION) AS REGION, ID AS SUB_ID, LOYVERSE_MERCHANT_ID AS MID,
         COALESCE(ACTIVATED_AT, CREATED_AT) AS STARTED,
         IFF(LOWER(STATUS) = 'cancelled', CANCELLED_AT, NULL) AS CANCELLED
  FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
  WHERE LOYVERSE_MERCHANT_ID IS NOT NULL AND LOWER(STATUS) <> 'future'
),
lines AS (
  SELECT 'uk' AS REGION, li.value:subscription_id::STRING AS SUB_ID,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PS,
         TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS PE
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE i.DELETED = FALSE AND i.VOIDED_AT IS NULL
    AND li.value:entity_type::STRING IN ('plan','addon')
  UNION ALL
  SELECT 'eu', li.value:subscription_id::STRING,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE,
         TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE i.DELETED = FALSE AND i.VOIDED_AT IS NULL
    AND li.value:entity_type::STRING IN ('plan','addon')
),
covered AS (
  SELECT DISTINCT m.MEND, m.NXT, l.REGION, l.SUB_ID
  FROM months m JOIN lines l ON l.PS <= m.MEND AND l.PE > m.MEND
)
SELECT TO_CHAR(c.MEND, 'YYYY-MM') AS MONTH, COUNT(DISTINCT s.MID) AS REBUILT
FROM covered c
JOIN subs s ON s.REGION = c.REGION AND s.SUB_ID = c.SUB_ID
WHERE s.STARTED < c.NXT AND (s.CANCELLED IS NULL OR s.CANCELLED >= c.NXT)
GROUP BY 1 ORDER BY 1;
