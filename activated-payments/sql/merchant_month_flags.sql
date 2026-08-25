-- LOYVERSE PAYMENTS — PER-MERCHANT MONTHLY PAYING / ACTIVE FLAGS (automation-safe)
--
-- WHY THIS EXISTS
-- The cohort triangle can already show how many merchants of a cohort were paying or active
-- in a given month, but those figures arrive from the KPI pipeline PRE-SUMMED. A total cannot
-- be intersected: knowing 1,000 merchants were active tells you nothing about which of them
-- also transacted on Loyverse Payments. This query returns the membership itself — one row per
-- merchant per month — so the dashboard can answer "active AND transacting" by counting the
-- overlap rather than guessing at it.
--
-- SCOPE
-- Deliberately narrow: only the merchants whose ids are injected below, which is the set that
-- holds a Stripe connected account. Every question this feeds involves at least one payments
-- KPI, and a merchant with no connected account can never satisfy one, so widening this to the
-- full merchant base would multiply the row count for rows that can only ever be discarded.
--
-- DEFINITIONS — these MIRROR the KPI pipeline on purpose, so a single-KPI view here agrees
-- with the cohort series the dashboard already shows:
--   PAYING in month M — the merchant has paid invoice line items whose billing period covers M
--     (kpi-automation/sql/cohort_unit_economics_daily_asof.sql, paying_per_cohort_month).
--     Chargebee bills annually as often as monthly, so a line item is SPREAD evenly across the
--     months it covers; without that, an annual payer would look like one paying month and
--     eleven churned ones.
--   ACTIVE in month M — the merchant issued at least one non-refund, non-cancelled receipt in M
--     (kpi-automation/sql/receipts_tpv_daily_asof.sql). Receipts, not logins.
--
-- Chargebee keys on customer EMAIL, not on the Loyverse merchant id, so paying is resolved
-- through the merchant's email. Where several merchant ids share one email — the same operator
-- with two businesses — the invoice belongs to the email, and each of that email's merchant ids
-- is marked paying. That matches the KPI pipeline, which counts DISTINCT email.
--
-- No snapshot dimension: this is the CURRENT picture (paid by today, not since voided).
-- The KPI cohort query carries 49 daily snapshots because it backfills history; here the
-- dashboard only ever renders "as it stands now", and a snapshot cross join would multiply
-- the cost for columns nobody reads.

WITH scope AS (
    SELECT
        LOYVERSE_ID                   AS merchant_id,
        LOWER(TRIM(EMAIL))            AS email_key
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE LOYVERSE_ID IN (/*MERCHANT_IDS*/)
      AND EMAIL IS NOT NULL
),
-- ── PAYING ────────────────────────────────────────────────────────────────────
-- Both Chargebee regions, flattened to line items. Only positive plan/addon lines on
-- non-deleted, actually-paid invoices count; a $0 line or a credit note is not revenue.
uk_lines AS (
    SELECT
        LOWER(TRIM(c.EMAIL))                            AS email_key,
        TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE  AS period_start,
        TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE    AS period_end,
        TO_TIMESTAMP(i.PAID_AT)::DATE                   AS paid_date,
        IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS void_date
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE
      AND i.PAID_AT IS NOT NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT
        LOWER(TRIM(c.EMAIL))                            AS email_key,
        TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE  AS period_start,
        TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE    AS period_end,
        TO_TIMESTAMP(i.PAID_AT)::DATE                   AS paid_date,
        IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS void_date
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE
      AND i.PAID_AT IS NOT NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
-- Restrict to our merchants BEFORE the spread, so the generator below runs over hundreds of
-- line items rather than the whole invoice history.
scoped_lines AS (
    SELECT
        l.email_key,
        l.period_start,
        GREATEST(DATEDIFF('MONTH', l.period_start, l.period_end), 1) AS months_in_period
    FROM (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines) l
    WHERE l.email_key IN (SELECT email_key FROM scope)
      AND l.paid_date <= CURRENT_DATE()
      AND (l.void_date IS NULL OR l.void_date > CURRENT_DATE())
),
-- One row per covered month. ROWCOUNT 24 caps a billing period at two years, matching the
-- KPI pipeline; longer periods do not exist in the catalogue and an uncapped generator would
-- be an open-ended cross join.
paying_months AS (
    SELECT DISTINCT
        s.merchant_id,
        DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', sl.period_start))::DATE AS month_start
    FROM scoped_lines sl
    JOIN scope s ON s.email_key = sl.email_key
    CROSS JOIN (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < sl.months_in_period
),
-- ── ACTIVE ────────────────────────────────────────────────────────────────────
-- Read from the PRE-AGGREGATED monthly sales table, the same source sales_monthly.sql uses,
-- not from LOYVERSE_RECEIPTS_UNIQUE.
--
-- WHY NOT THE RAW RECEIPTS TABLE: the KPI pipeline's receipts query scans it in full and has
-- already hit the 3,600s Snowflake timeout in production (2026-08-12). A merchant-id IN-list
-- does not reliably prune its micro-partitions, so filtering would not have saved it. This
-- table is one row per merchant-month and costs almost nothing.
--
-- THE DIFFERENCE THIS MAKES, stated plainly: the dashboard's own Active series counts merchants
-- issuing a non-refund, non-cancelled receipt in the month. This counts merchants with any
-- recorded sales in the month. The two agree for practically every merchant, but a merchant
-- whose only activity in a month was later refunded could show as active here and not there.
-- That is why a single-KPI Active view keeps reading the dashboard's own series; this column is
-- used only to intersect Active with a payments KPI, where the population is small and known.
active_months AS (
    SELECT DISTINCT
        LOYVERSE_MERCHANT_ID              AS merchant_id,
        DATE_TRUNC('MONTH', MONTH)::DATE  AS month_start
    FROM LOYVERSE_DATA_LAKE.PUBLIC.SALES_PER_ACCOUNT_MONTHLY
    WHERE LOYVERSE_MERCHANT_ID IN (/*MERCHANT_IDS*/)
      AND TOTAL_SALES_COUNT > 0
      AND MONTH IS NOT NULL
)
-- A merchant-month appears once, carrying whichever flags apply. A month where the merchant
-- was neither paying nor active produces no row at all — absence is the zero.
SELECT
    COALESCE(p.merchant_id, a.merchant_id)   AS MERCHANT_ID,
    COALESCE(p.month_start, a.month_start)   AS MONTH_START,
    IFF(p.merchant_id IS NULL, 0, 1)         AS IS_PAYING,
    IFF(a.merchant_id IS NULL, 0, 1)         AS IS_ACTIVE
FROM paying_months p
FULL OUTER JOIN active_months a
  ON a.merchant_id = p.merchant_id
 AND a.month_start = p.month_start
WHERE COALESCE(p.month_start, a.month_start) >= DATE '2019-01-01'
  AND COALESCE(p.month_start, a.month_start) <= DATE_TRUNC('MONTH', CURRENT_DATE())
ORDER BY MERCHANT_ID, MONTH_START;
