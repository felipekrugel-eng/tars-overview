-- =================================================================
-- PAID ACQUISITION — COHORT ECONOMICS, one row per attributed merchant per MONTH
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- paid_merchants.sql answers "where is this merchant now". This answers "what has this
-- merchant done, month by month, since the month they signed up" — which is the only way to
-- read investment against return, because the investment lands in one month and the return
-- arrives over the following ones.
--
-- THE POPULATION IS IDENTICAL TO paid_merchants.sql BY CONSTRUCTION. The paid_campaigns and
-- attributed CTEs below are spliced from that file verbatim, including the internal/QA screen.
-- If the two ever disagree about who was acquired, the Marketing tab would show a CAC whose
-- numerator and denominator came from different populations, which is worse than no CAC.
--
-- M0 IS THE SIGN-UP MONTH, not the click month. A merchant can click in August and register in
-- September; the cohort follows the registration, because that is the thing being bought and
-- the thing every other cohort view on this dashboard is keyed on.
--
-- WHAT IS HERE AND WHAT IS DELIBERATELY NOT.
--   POS side      receipts, selling days and subscription revenue — computed here.
--   Payments side NOT computed here. The Payments Cohorts page already publishes per-merchant
--                 monthly TPV, application fees and interchange-plus cost in
--                 activated-payments/funnel-data.js, converted to USD with the canonical FX
--                 map. pull_paid.js joins that file on the Loyverse owner id rather than
--                 recomputing it, so the two pages cannot drift apart on payments margin.
--
-- SUBSCRIPTION REVENUE IS AMORTISED PAID INVOICE VALUE, not live MRR. For a payback question
-- what matters is money actually collected, spread across the period it covers: an annual plan
-- paid in September is not $120 of September revenue. This is the same invoice-line spread the
-- KPI pipeline's bottom-up MRR uses, so a cohort's months sum to what the merchant really paid.
WITH
-- ── The paid campaign roster, from both ad platforms ───────────────────────────────
-- WHY THIS EXISTS, AND WHY ITS ABSENCE WAS A BUG. This query used to select merchants with
-- `RESOLVED_CAMPAIGN_ID IS NOT NULL`. That column is populated ONLY by Google's click
-- archive, so it silently defined "paid acquisition" as "whatever Google can resolve" and
-- excluded every Facebook merchant on the platform — 28 of them by 2026-10-08, the entire
-- c7-facebook-lead-usa-pos and c5-facebook-lead-usa-payments intake. The dashboard reported
-- zero Facebook merchants and carried a confident note saying Facebook was unattributable,
-- which was false: those merchants carry utm_campaign, utm_source=facebook,
-- utm_medium=paid_social AND an fbclid. The signal was always there; this query was not
-- looking at it.
--
-- The roster is read from the ad platforms themselves rather than hard-coded, so a campaign
-- launched tomorrow is attributable the moment it spends, with no edit here. Matching on
-- NAME is safe because the campaigns are deliberately named (c3-gads-..., c7-facebook-...)
-- and the same string is what the landing page puts in utm_campaign.
paid_campaigns AS (
    SELECT NAME, MAX(PLATFORM) AS PLATFORM, MAX(CID) AS CID
    FROM (
        SELECT "CAMPAIGN.NAME" AS NAME, 'google' AS PLATFORM, TO_VARCHAR("CAMPAIGN.ID") AS CID
        FROM LOYVERSE_DATA_LAKE.GOOGLE_ADS.CAMPAIGN
        WHERE "CAMPAIGN.NAME" IS NOT NULL
        UNION ALL
        SELECT NAME, 'facebook', TO_VARCHAR(ID)
        FROM LOYVERSE_DATA_LAKE.FACEBOOK_MARKETING.CAMPAIGNS
        WHERE NAME IS NOT NULL
    )
    GROUP BY NAME
),

-- ── Who came from a paid click ──────────────────────────────────────────────────────
attributed AS (
    SELECT a.LOYVERSE_ID                                  AS MERCHANT_ID,
           a.BUSINESS_NAME,
           a.COUNTRY,
           a.CREATED_AT                                   AS SIGNED_UP_AT,
           -- Google's resolved id wins where it exists: it is exact and carries the ad group
           -- and keyword. The utm_campaign match is the fallback, and it is the ONLY path
           -- available to Facebook, where Meta exposes no click id in the Insights API.
           COALESCE(TO_VARCHAR(a.RESOLVED_CAMPAIGN_ID), pc.CID)        AS CAMPAIGN_ID,
           COALESCE(a.RESOLVED_CAMPAIGN_NAME, a.UTM_CAMPAIGN)          AS CAMPAIGN,
           COALESCE(pc.PLATFORM, 'google')                             AS PLATFORM,
           a.CAMPAIGN_STATUS,
           a.ADVERTISING_CHANNEL_TYPE,
           a.AD_GROUP_NAME,
           a.KEYWORD,
           a.KEYWORD_MATCH_TYPE,
           a.AD_NETWORK_TYPE,
           -- Three ways in now, and they are not equally good, so the method travels with the
           -- row: gclid (exact, with ad group and keyword), gad_campaignid (right campaign,
           -- no click date), utm_campaign (right campaign, no click id at all).
           COALESCE(a.ATTRIBUTION_METHOD, 'utm_campaign')              AS ATTRIBUTION_METHOD,
           -- CLICK_DATE is only populated on the gclid path. Fall back to the signup date so
           -- a gad_campaignid merchant still lands in a period rather than vanishing from
           -- every date filter — flagged by CLICK_DATE_EXACT so the page can say which.
           COALESCE(TRY_TO_DATE(a.CLICK_DATE), TO_DATE(a.CREATED_AT))  AS CLICK_DATE,
           IFF(TRY_TO_DATE(a.CLICK_DATE) IS NOT NULL, TRUE, FALSE)     AS CLICK_DATE_EXACT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANT_ATTRIBUTION a
    LEFT JOIN paid_campaigns pc ON pc.NAME = a.UTM_CAMPAIGN
    -- Only for the email, which the attribution table does not carry and the internal-test
    -- screen below needs.
    LEFT JOIN LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS lm ON lm.LOYVERSE_ID = a.LOYVERSE_ID
    -- Either Google resolved the click, OR the merchant's utm_campaign names a campaign that
    -- actually exists and spends. The second clause is what admits Facebook. It cannot admit
    -- organic traffic: utm_campaign values like 'homeEN' or 'download-site' are Loyverse's own
    -- site tagging and match no campaign in either ad account, so they are not in the roster.
    WHERE (a.RESOLVED_CAMPAIGN_ID IS NOT NULL OR pc.NAME IS NOT NULL)
      -- INTERNAL AND QA ACCOUNTS ARE EXCLUDED, with the SAME two patterns
      -- activated-payments/pull.js uses (TEST_EMAIL_DOMAIN and TEST_NAME_WORD). Keeping the
      -- rule identical matters: a merchant screened out of the payments funnel and counted
      -- in the marketing funnel would make the two pages disagree about the same person.
      -- It is not cosmetic here. Of the six merchants c5-facebook-lead-usa-payments appeared
      -- to buy, FIVE are internal tests — "DBA CTO test", "test", "Demo", "UTM test" — so
      -- the campaign really bought one merchant, and its cost per merchant was out by 6x.
      AND NOT REGEXP_LIKE(COALESCE(lm.EMAIL, ''),
            '.*@(loyverse\\.(com|io)|mailinator\\..*|yopmail\\..*|guerrillamail\\..*|sharklasers\\.com|10minutemail\\..*|tempmail\\..*|temp-mail\\..*|trashmail\\..*|example\\.(com|org|net)|test\\.com)\\s*', 'i')
      AND NOT REGEXP_LIKE(COALESCE(a.BUSINESS_NAME, ''),
            '.*(^|[^a-zA-Z])(test|tests|testing|teste|demo|dummy|sandbox|prueba)([^a-zA-Z]|$).*', 'i')
),

-- ── The merchants, with their cohort ────────────────────────────────────────────────
cohort AS (
    SELECT MERCHANT_ID,
           TO_VARCHAR(SIGNED_UP_AT, 'YYYY-MM') AS COHORT_MONTH,
           CAMPAIGN_ID, CAMPAIGN, PLATFORM, COUNTRY
    FROM attributed
),
-- Email, for the Chargebee join. Chargebee knows merchants by email, not by Loyverse id, and
-- the KPI pipeline dedupes on email for the same reason.
email_scope AS (
    SELECT c.MERCHANT_ID, LOWER(TRIM(lm.EMAIL)) AS EMAIL_KEY
    FROM cohort c
    JOIN LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS lm ON lm.LOYVERSE_ID = c.MERCHANT_ID
    WHERE lm.EMAIL IS NOT NULL
),

-- ── POS: receipts per merchant per month ────────────────────────────────────────────
-- Raw receipts rather than SALES_PER_ACCOUNT_MONTHLY, because the counts matter: a merchant
-- ringing 3 receipts in a month and one ringing 300 are not the same outcome, and the page
-- offers a 10-receipt threshold. The merchant set is small and RECEIPT_DATE is ISO-8601 TEXT,
-- so the lower bound prunes partitions the same way paid_merchants.sql relies on.
rcpt_month AS (
    SELECT r.MERCHANT_ID,
           LEFT(r.RECEIPT_DATE, 7)                   AS M,
           COUNT(*)                                  AS RECEIPTS,
           COUNT(DISTINCT LEFT(r.RECEIPT_DATE, 10))  AS SELLING_DAYS
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
    JOIN cohort t ON t.MERCHANT_ID = r.MERCHANT_ID
    WHERE r.RECEIPT_DATE >= '2026-08-01'
      AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
    GROUP BY 1, 2
),

-- ── POS: subscription revenue per merchant per month ────────────────────────────────
-- Both Chargebee regions, flattened to line items, exactly as merchant_month_flags.sql does
-- it: only positive plan/addon lines on non-deleted, actually-paid, non-voided invoices. The
-- amount and currency travel with the line here, because this needs revenue and not just a flag.
uk_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                            AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE  AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE    AS PERIOD_END,
           li.value:amount::NUMBER                         AS AMOUNT_MINOR,
           UPPER(TRIM(COALESCE(i.CURRENCY_CODE, 'USD')))   AS CCY,
           TO_TIMESTAMP(i.PAID_AT)::DATE                   AS PAID_DATE,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
eu_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))                            AS EMAIL_KEY,
           TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE  AS PERIOD_START,
           TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE    AS PERIOD_END,
           li.value:amount::NUMBER                         AS AMOUNT_MINOR,
           UPPER(TRIM(COALESCE(i.CURRENCY_CODE, 'EUR')))   AS CCY,
           TO_TIMESTAMP(i.PAID_AT)::DATE                   AS PAID_DATE,
           IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND c.EMAIL IS NOT NULL
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_type::STRING IN ('plan','addon')
),
-- Restrict to our merchants BEFORE the spread, so the generator runs over a handful of line
-- items rather than the whole invoice history.
scoped_lines AS (
    SELECT es.MERCHANT_ID,
           l.PERIOD_START,
           GREATEST(DATEDIFF('MONTH', l.PERIOD_START, l.PERIOD_END), 1) AS MONTHS_IN_PERIOD,
           -- Minor units, except where the minor unit IS the major one. Same list as
           -- paid_merchants.sql first_sub; getting this wrong reads 100x in Korea and Japan.
           l.AMOUNT_MINOR / IFF(l.CCY IN ('JPY','KRW','VND','CLP','ISK','PYG','UGX','RWF',
                                          'XAF','XOF','KMF','DJF','GNF','VUV'), 1, 100)
               / NULLIF(fx.RATE, 0)                                     AS AMOUNT_USD
    FROM (SELECT * FROM uk_lines UNION ALL SELECT * FROM eu_lines) l
    JOIN email_scope es ON es.EMAIL_KEY = l.EMAIL_KEY
    LEFT JOIN (SELECT CURRENCY_NAME, RATE
               FROM LOYVERSE_DATA_LAKE.PUBLIC.CURRENCY_RATES
               WHERE DATE = (SELECT MAX(DATE) FROM LOYVERSE_DATA_LAKE.PUBLIC.CURRENCY_RATES)
              ) fx ON fx.CURRENCY_NAME = l.CCY
    WHERE l.PAID_DATE <= CURRENT_DATE()
      AND (l.VOID_DATE IS NULL OR l.VOID_DATE > CURRENT_DATE())
),
-- One row per covered month, carrying that month's share of the invoice. ROWCOUNT 24 caps a
-- billing period at two years, matching the KPI pipeline.
sub_month AS (
    SELECT sl.MERCHANT_ID,
           TO_VARCHAR(DATEADD('MONTH', g.SEQ, DATE_TRUNC('MONTH', sl.PERIOD_START)), 'YYYY-MM') AS M,
           SUM(sl.AMOUNT_USD / sl.MONTHS_IN_PERIOD) AS SUB_USD
    FROM scoped_lines sl
    CROSS JOIN (SELECT SEQ4() AS SEQ FROM TABLE(GENERATOR(ROWCOUNT => 24))) g
    WHERE g.SEQ < sl.MONTHS_IN_PERIOD
    GROUP BY 1, 2
),

-- The union of the months in which anything happened, so a merchant who subscribed without
-- selling and one who sold without subscribing both appear.
merchant_months AS (
    SELECT MERCHANT_ID, M FROM rcpt_month
    UNION
    SELECT MERCHANT_ID, M FROM sub_month
)

-- A merchant-month appears only if something happened in it. Absence is the zero, and the
-- page fills the gaps — shipping explicit zero rows for every merchant x month would be
-- mostly zeros and several times the payload.
--
-- Months BEFORE the sign-up month are dropped. They exist only as device-clock backdating,
-- they have no valid cohort age, and the age axis has nowhere to put them.
SELECT c.MERCHANT_ID                    AS MERCHANT_ID,
       c.COHORT_MONTH                   AS COHORT_MONTH,
       mm.M                             AS M,
       COALESCE(r.RECEIPTS, 0)          AS RECEIPTS,
       COALESCE(r.SELLING_DAYS, 0)      AS SELLING_DAYS,
       ROUND(COALESCE(s.SUB_USD, 0), 2) AS SUB_USD
FROM merchant_months mm
JOIN cohort c      ON c.MERCHANT_ID = mm.MERCHANT_ID
LEFT JOIN rcpt_month r ON r.MERCHANT_ID = mm.MERCHANT_ID AND r.M = mm.M
LEFT JOIN sub_month  s ON s.MERCHANT_ID = mm.MERCHANT_ID AND s.M = mm.M
WHERE mm.M >= c.COHORT_MONTH
ORDER BY 1, 3;
