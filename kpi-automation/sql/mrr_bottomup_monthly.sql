-- =================================================================
-- MRR — COMMITTED, CURRENT-STATE, per COUNTRY x CALENDAR MONTH
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- The dashboard's source of truth for MRR.
--
--   - amortized: each Chargebee plan+addon line item spread evenly across its
--     billing period (annual plan = 1/12 per month), USD-normalized
--     (GBP x1.34, EUR x1.16)
--   - CURRENT state of all invoices: excludes hard-deleted and currently voided
--     invoices (VOID_DATE IS NULL) -> the complete, latest-known figure.
--
-- COMMITTED, NOT COLLECTED (changed 2026-11-06, Felipe, to match how Alex reports it).
-- This query used to require PAID_AT IS NOT NULL, so MRR was the money that had
-- actually been collected. That is a cash measure wearing an MRR label, and it
-- understated every recent month because invoices still in dunning had not landed
-- yet: +0.98% for August, +1.69% September, +3.40% October, and rising toward the
-- present. It also changed the SHAPE of the trend — collected MRR read flat from
-- August to October while committed MRR was still climbing. Closed months older
-- than ~3 months are unaffected (every invoice has since resolved one way or the
-- other), so history does not move.
--
-- Written-off and credit-settled invoices are therefore counted, which is correct
-- for a committed measure and is NOT the same as revenue received. Over the 13
-- months to Nov 2026 the gap was ~4%: $408k written off and $201k settled with
-- account credits. If a collected figure is ever wanted it is a different metric
-- and belongs in its own column, not in this one.
--
-- THE CURRENT-MONTH TOP-UP, and why it has to exist.
-- Chargebee issues each subscription's invoice on its own renewal date, so a month
-- in progress has only the invoices cut so far: on 6 Nov 2026 just 9,746 of the
-- usual ~59,000 monthly lines existed. Invoice-based MRR therefore reads about a
-- third of normal for the current month, and dropping the paid filter does NOT fix
-- that — the missing invoices do not exist yet to be unpaid. November read $366k
-- collected, $392k committed, against a true run-rate near $1.0M.
--
-- So for the CURRENT MONTH ONLY, every active or non-renewing subscription that has
-- not yet been billed into this month contributes its contracted monthly amount.
-- The "not yet billed" test is an anti-join against the spread itself rather than a
-- re-derived date rule, so a subscription cannot be both invoiced and topped up.
-- Pointing the top-up at a COMPLETE month is the test that it is not double-counting:
-- aimed at October it adds $9,678 of $1,069,752 (0.9%), all of it subscriptions that
-- only started in November.
--
-- Past months are never topped up. Only current subscription state is available, so
-- applying it backwards would rewrite history with today's book.
--
-- Output is small (per country x month), safe to run daily in the pipeline.
--   PAYING_MERCHANTS = distinct merchants contributing MRR that month
--   MRR_USD          = SUM of their amortized monthly amounts  ("therefore the MRR")
--   ARPC_USD         = MRR_USD / PAYING_MERCHANTS
-- Global monthly MRR = SUM(MRR_USD) over countries for that month.
-- NOTE: includes forward months (annual plans amortized ahead); the build step
--       should cap at the current calendar month for display.
--
-- KNOWN BUG, deliberately NOT fixed here so this change can be read on its own:
-- the FX CASE below ends in ELSE AMOUNT_RAW, so KRW and JPY are treated as 1:1 with
-- the dollar, and /100.0 is wrong for them because they are zero-decimal currencies.
-- Net effect is ~1.2% overstatement overall and ~13x on Korea. Fixed separately.
-- =================================================================

WITH merchants_raw AS (
    SELECT LOWER(TRIM(m.EMAIL))    AS EMAIL_KEY,
           UPPER(TRIM(m.COUNTRY))  AS COUNTRY,
           m.CREATED_AT            AS CREATED_AT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
),
merchant_country AS (
    SELECT EMAIL_KEY, COUNTRY FROM (
        SELECT EMAIL_KEY, COUNTRY,
               ROW_NUMBER() OVER (PARTITION BY EMAIL_KEY ORDER BY CREATED_AT ASC) AS RN
        FROM merchants_raw
    ) WHERE RN = 1
),
cur AS (SELECT DATE_TRUNC('MONTH', CURRENT_DATE())::DATE AS MSTART),
uk_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                                       AS EMAIL_KEY,
           li.value:subscription_id::STRING                           AS SUB_ID,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE            AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE              AS PERIOD_END,
           li.value:amount::NUMBER / 100.0                           AS AMOUNT_RAW,
           i.CURRENCY_CODE                                           AS CURRENCY,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                                       AS EMAIL_KEY,
           li.value:subscription_id::STRING                           AS SUB_ID,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE            AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE              AS PERIOD_END,
           li.value:amount::NUMBER / 100.0                           AS AMOUNT_RAW,
           i.CURRENCY_CODE                                           AS CURRENCY,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
all_lines AS (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines),
lines_usd AS (
    SELECT EMAIL_KEY, SUB_ID, PERIOD_START,
           CASE CURRENCY
               WHEN 'USD' THEN AMOUNT_RAW
               WHEN 'GBP' THEN AMOUNT_RAW * 1.34
               WHEN 'EUR' THEN AMOUNT_RAW * 1.16
               ELSE AMOUNT_RAW
           END AS AMOUNT_USD,
           GREATEST(DATEDIFF('MONTH', PERIOD_START, PERIOD_END), 1) AS MONTHS_IN_PERIOD
    FROM all_lines
    WHERE VOID_DATE IS NULL
),
spread AS (
    SELECT l.EMAIL_KEY, l.SUB_ID,
           DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', l.PERIOD_START))::DATE AS MONTH_START,
           l.AMOUNT_USD / l.MONTHS_IN_PERIOD AS MONTHLY_AMOUNT_USD
    FROM lines_usd l,
         (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < l.MONTHS_IN_PERIOD
),
-- Which subscriptions already carry billing INTO the current month, judged by the
-- spread itself. Deriving this from invoice dates instead would be a second rule
-- that could disagree with the first, which is how a top-up double-counts.
billed_this_month AS (
    SELECT DISTINCT s.SUB_ID FROM spread s, cur WHERE s.MONTH_START = cur.MSTART
),
live_subs AS (
    SELECT s.ID AS SUB_ID, LOWER(TRIM(c.EMAIL)) AS EMAIL_KEY, s.MRR, s.CURRENCY_CODE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-SUBSCRIPTION" s
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = s.CUSTOMER_ID
    WHERE s.DELETED = FALSE AND s.STATUS IN ('active','non_renewing')
      AND s.MRR > 0 AND c.EMAIL IS NOT NULL
    UNION ALL
    SELECT s.ID, LOWER(TRIM(c.EMAIL)), s.MRR, s.CURRENCY_CODE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-SUBSCRIPTION" s
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = s.CUSTOMER_ID
    WHERE s.DELETED = FALSE AND s.STATUS IN ('active','non_renewing')
      AND s.MRR > 0 AND c.EMAIL IS NOT NULL
),
-- non_renewing is included on purpose: the subscription is still inside a paid term
-- and still owes this month's revenue. It stops contributing when its term ends.
topup AS (
    SELECT s.EMAIL_KEY, cur.MSTART AS MONTH_START,
           CASE s.CURRENCY_CODE
               WHEN 'USD' THEN s.MRR / 100.0
               WHEN 'GBP' THEN s.MRR / 100.0 * 1.34
               WHEN 'EUR' THEN s.MRR / 100.0 * 1.16
               ELSE s.MRR / 100.0
           END AS MONTHLY_AMOUNT_USD
    FROM live_subs s, cur
    WHERE s.SUB_ID NOT IN (SELECT SUB_ID FROM billed_this_month)
),
combined AS (
    SELECT EMAIL_KEY, MONTH_START, MONTHLY_AMOUNT_USD FROM spread
    UNION ALL
    SELECT EMAIL_KEY, MONTH_START, MONTHLY_AMOUNT_USD FROM topup
),
merchant_month AS (
    SELECT EMAIL_KEY, MONTH_START, SUM(MONTHLY_AMOUNT_USD) AS MRR_USD
    FROM combined
    GROUP BY EMAIL_KEY, MONTH_START
    HAVING SUM(MONTHLY_AMOUNT_USD) > 0
)
SELECT
    COALESCE(mc.COUNTRY, 'XX')                          AS COUNTRY,
    mm.MONTH_START                                      AS MONTH,
    COUNT(DISTINCT mm.EMAIL_KEY)                        AS PAYING_MERCHANTS,
    ROUND(SUM(mm.MRR_USD), 2)                           AS MRR_USD,
    ROUND(SUM(mm.MRR_USD) / NULLIF(COUNT(DISTINCT mm.EMAIL_KEY),0), 2) AS ARPC_USD
FROM merchant_month mm
LEFT JOIN merchant_country mc ON mc.EMAIL_KEY = mm.EMAIL_KEY
GROUP BY COALESCE(mc.COUNTRY, 'XX'), mm.MONTH_START
ORDER BY mm.MONTH_START, MRR_USD DESC;
