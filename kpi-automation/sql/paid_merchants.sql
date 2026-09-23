-- =================================================================
-- PAID ACQUISITION — one row per attributed merchant, every funnel stage on it
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- This is the spine of the Marketing dashboard and it replaces the Google Sheet's
-- Click_IDs + Signups + Attribution + Funnel_Daily tabs with one query.
--
-- WHY MERCHANT GRAIN AND NOT DAY GRAIN. The sheet ships Funnel_Daily — date x campaign x
-- stage counts — and the Dashboard tab sums it. That works until you ask a cohort question,
-- and every interesting question here is a cohort question: of the merchants whose click we
-- paid for in the last two weeks, how many have passed KYC yet? A pre-aggregated daily table
-- cannot answer that, because a merchant clicks in one week and passes KYC in another, and
-- summing both into their own day double-counts the merchant into two different periods.
-- Keeping merchant grain means the page picks the date basis (click, or signup) at read time
-- and the stage counts follow the SAME merchants. Funnel_Daily is derivable from this; the
-- reverse is not true.
--
-- THE FUNNEL BRANCHES, IT DOES NOT DESCEND. The sheet gets this right and it is worth
-- restating because the shape is unusual:
--
--                              Signed up
--                              /        \
--            Issued a receipt            KYC started
--              (POS path)                 (Payments path)
--                                              |
--                                        KYC submitted
--                                              |
--                                        KYC approved
--                                              |
--                                     Payments onboarded
--                                              |
--                                       Payments used
--
-- "Issued a receipt" is NOT a step above "KYC started" — they are two different things a
-- merchant can do, and a merchant can do both, either or neither. Anything that renders
-- these as one descending bar chart is lying about the product. Hence the two `% of
-- previous in path` chains in the output and no single conversion rate between rows 2 and 3.
--
-- ATTRIBUTION IS FIRST-TOUCH AND INCOMPLETE — READ THIS BEFORE QUOTING A SHARE.
-- LOYVERSE_MERCHANT_ATTRIBUTION is written once at registration from the web signup form or
-- the Play install referrer, and never updated. A NULL campaign means WE DO NOT KNOW, not
-- "organic". Every count here is of the ATTRIBUTED SAMPLE, and the page must say so. Two
-- resolution methods are present and they are not equally good:
--   gclid           the click id itself, joined to GOOGLE_ADS.CLICK_VIEW. Exact.
--   gad_campaignid  only the campaign id survived on the landing URL. Right campaign,
--                   no ad group, no keyword, no click date.
-- The method is carried through to the output so the page can show what it is standing on.
--
-- FACEBOOK IS ABSENT FROM THIS QUERY ON PURPOSE. Five merchants carry an fbclid, against
-- 195 resolvable through Google, and nothing joins an fbclid to FACEBOOK_MARKETING because
-- Meta does not expose click ids in the Insights API. Facebook is a spend-and-clicks panel
-- until the landing page captures fbclid the way it captures gclid. Putting a 5-merchant
-- Facebook funnel beside a 195-merchant Google one would invite exactly the comparison the
-- data cannot support.
--
-- WHAT THE LAKE CANNOT GIVE US. The sheet's "Opened the app" and "Added a customer" are
-- Mixpanel product events. There is no Mixpanel table in LOYVERSE_DATA_LAKE, so those two
-- rows are not reproduced here. "Subscribed" IS reproduced, from Chargebee.
-- =================================================================

WITH
-- ── Who came from a paid click ──────────────────────────────────────────────────────
attributed AS (
    SELECT a.LOYVERSE_ID                                  AS MERCHANT_ID,
           a.BUSINESS_NAME,
           a.COUNTRY,
           a.CREATED_AT                                   AS SIGNED_UP_AT,
           a.RESOLVED_CAMPAIGN_ID                         AS CAMPAIGN_ID,
           a.RESOLVED_CAMPAIGN_NAME                       AS CAMPAIGN,
           a.CAMPAIGN_STATUS,
           a.ADVERTISING_CHANNEL_TYPE,
           a.AD_GROUP_NAME,
           a.KEYWORD,
           a.KEYWORD_MATCH_TYPE,
           a.AD_NETWORK_TYPE,
           a.ATTRIBUTION_METHOD,
           -- CLICK_DATE is only populated on the gclid path. Fall back to the signup date so
           -- a gad_campaignid merchant still lands in a period rather than vanishing from
           -- every date filter — flagged by CLICK_DATE_EXACT so the page can say which.
           COALESCE(TRY_TO_DATE(a.CLICK_DATE), TO_DATE(a.CREATED_AT))  AS CLICK_DATE,
           IFF(TRY_TO_DATE(a.CLICK_DATE) IS NOT NULL, TRUE, FALSE)     AS CLICK_DATE_EXACT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANT_ATTRIBUTION a
    WHERE a.RESOLVED_CAMPAIGN_ID IS NOT NULL
),

-- ── POS path: did the till ever ring ────────────────────────────────────────────────
-- LOYVERSE_RECEIPTS has no clustering key, but RECEIPT_DATE is TEXT holding ISO-8601, which
-- sorts in date order, so a string floor prunes micro-partitions well: this runs in ~60s
-- against the ~13 min a TRY_TO_TIMESTAMP predicate would cost. The floor is safe because no
-- attributed merchant existed before the attribution backfill window.
--
-- Cleaning rules are the canonical ones used everywhere else in this repo: no refunds, no
-- cancellations, no zero-value rows.
-- The POS side is measured in RECEIPTS AND RECENCY, deliberately not in GTV. Our GTV recipe
-- is currently running ~1.7x above the agreed business baseline and that recalibration is
-- open; hanging an activation funnel off a number we know to be wrong would make the funnel
-- wrong too. Receipt counts need no currency conversion, no per-receipt cap and no
-- judgement call, so they are the honest way to say how alive a merchant is.
first_receipt AS (
    SELECT r.MERCHANT_ID,
           MIN(LEFT(r.RECEIPT_DATE, 10))  AS FIRST_RECEIPT_DATE,
           MAX(LEFT(r.RECEIPT_DATE, 10))  AS LAST_RECEIPT_DATE,
           COUNT(*)                       AS RECEIPTS,
           -- Trailing windows, for "is this merchant still alive" rather than "did they ever
           -- ring once". A merchant who sold twice in August and vanished is a different
           -- outcome from one selling daily, and a lifetime count cannot tell them apart.
           COUNT_IF(r.RECEIPT_DATE >= TO_VARCHAR(DATEADD('day', -30, CURRENT_DATE())))  AS RECEIPTS_30D,
           COUNT_IF(r.RECEIPT_DATE >= TO_VARCHAR(DATEADD('day',  -7, CURRENT_DATE())))  AS RECEIPTS_7D,
           COUNT(DISTINCT LEFT(r.RECEIPT_DATE, 10))  AS SELLING_DAYS
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
    JOIN attributed t ON t.MERCHANT_ID = r.MERCHANT_ID
    WHERE r.RECEIPT_DATE >= '2026-08-01'
      AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
    GROUP BY 1
),

-- ── Payments path: the Stripe connected account ─────────────────────────────────────
-- CONNECTED_ACCOUNTS.MERCHANT_ID is a PLATFORM-LEVEL CONSTANT — the same value on every
-- row, identifying Loyverse to Stripe. The merchant is in the metadata pivot, and using the
-- column instead would silently join every account to one merchant.
acct_owner AS (
    SELECT ACCOUNT_ID,
           TRY_TO_NUMBER(MAX(CASE WHEN LOWER(KEY) = 'owner_id' THEN VALUE END)) AS MERCHANT_ID
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS_METADATA
    GROUP BY 1
),
-- Ever took a charge. Used both as the "Payments used" stage and, below, to rescue accounts
-- that are demonstrably approved but whose current-state flags have since been switched off.
first_charge AS (
    SELECT o.MERCHANT_ID,
           MIN(TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)))) AS FIRST_CHARGE_DATE,
           COUNT(*)                                              AS CHARGES
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES c
    JOIN acct_owner o ON o.ACCOUNT_ID = c.ACCOUNT
    WHERE LOWER(c.STATUS) = 'succeeded' AND c.PAID = TRUE AND c.CAPTURED = TRUE
      AND o.MERCHANT_ID IS NOT NULL
    GROUP BY 1
),
-- One row per merchant. A merchant with two accounts takes the furthest-along of them:
-- MAX over booleans is "ever", which is the right reading of a stage a merchant has reached.
--
-- CONNECTED_ACCOUNTS IS A CURRENT-STATE SNAPSHOT WITH NO HISTORY. There is no
-- "kyc_started_at". So the stage flags below are "is, today", and the dates attached to them
-- are the best available proxies, named honestly:
--   KYC started    account exists AND the first meaningful field is no longer outstanding
--                  (legal_entity.first_name absent from the due list) or a name is present.
--   KYC submitted  DETAILS_SUBMITTED — the merchant pressed submit.
--   KYC approved   CHARGES_ENABLED, or has ever taken a charge. The second clause matters:
--                  an account approved in April and restricted in July is still a merchant
--                  who passed KYC, and without it the funnel goes non-monotonic.
--   Onboarded      PAYOUTS_ENABLED — approved AND able to be paid, which is the point.
stripe_stage AS (
    SELECT o.MERCHANT_ID,
           MIN(TO_DATE(ca.CREATED))                                      AS ACCOUNT_CREATED_DATE,
           -- REQUIREMENTS_CURRENTLY_DUE is a comma-joined TEXT list, not an array, so this is
           -- a substring test rather than ARRAY_CONTAINS. The field names Stripe uses are
           -- dotted and unique enough that a substring cannot collide with another field.
           MAX(IFF(
               COALESCE(ca.REQUIREMENTS_CURRENTLY_DUE, '') NOT LIKE '%legal_entity.first_name%'
               OR COALESCE(TRIM(ca.LEGAL_ENTITY_FIRST_NAME), '') <> '', 1, 0))  AS KYC_STARTED,
           MAX(IFF(COALESCE(ca.DETAILS_SUBMITTED, FALSE), 1, 0))         AS KYC_SUBMITTED,
           MAX(IFF(COALESCE(ca.CHARGES_ENABLED,   FALSE), 1, 0))         AS KYC_APPROVED,
           MAX(IFF(COALESCE(ca.PAYOUTS_ENABLED,   FALSE), 1, 0))         AS ONBOARDED,
           -- TOS acceptance is the moment onboarding completed — the practical KYC-pass date.
           MIN(TO_DATE(ca.TOS_ACCEPTANCE_DATE))                          AS TOS_DATE
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS ca
    JOIN acct_owner o ON o.ACCOUNT_ID = ca.ID
    WHERE o.MERCHANT_ID IS NOT NULL
    GROUP BY 1
),

-- ── Beside the funnel: paid us a subscription ───────────────────────────────────────
-- Not a funnel step. A merchant can subscribe without ever touching Payments, and most do.
first_sub AS (
    SELECT LOYVERSE_MERCHANT_ID AS MERCHANT_ID,
           MIN(TO_DATE(ACTIVATED_AT)) AS FIRST_SUB_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
    WHERE ACTIVATED_AT IS NOT NULL AND LOYVERSE_MERCHANT_ID IS NOT NULL
    GROUP BY 1
)

SELECT t.MERCHANT_ID,
       t.BUSINESS_NAME,
       t.COUNTRY,
       t.CAMPAIGN_ID,
       t.CAMPAIGN,
       t.CAMPAIGN_STATUS,
       t.ADVERTISING_CHANNEL_TYPE,
       t.AD_GROUP_NAME,
       t.KEYWORD,
       t.KEYWORD_MATCH_TYPE,
       t.AD_NETWORK_TYPE,
       t.ATTRIBUTION_METHOD,
       t.CLICK_DATE,
       t.CLICK_DATE_EXACT,
       TO_DATE(t.SIGNED_UP_AT)                                   AS SIGNED_UP_DATE,

       -- POS path
       f.FIRST_RECEIPT_DATE,
       f.LAST_RECEIPT_DATE,
       COALESCE(f.RECEIPTS, 0)                                   AS RECEIPTS,
       COALESCE(f.RECEIPTS_30D, 0)                               AS RECEIPTS_30D,
       COALESCE(f.RECEIPTS_7D, 0)                                AS RECEIPTS_7D,
       COALESCE(f.SELLING_DAYS, 0)                               AS SELLING_DAYS,
       IFF(f.FIRST_RECEIPT_DATE IS NOT NULL, 1, 0)               AS ISSUED_RECEIPT,
       -- The qualified-activity thresholds the Study & Trend page already uses, so "active"
       -- means the same thing on both pages. One receipt is a merchant pressing buttons;
       -- five and ten are a merchant trading.
       IFF(COALESCE(f.RECEIPTS_30D, 0) >= 1,  1, 0)              AS ACTIVE_30D,
       IFF(COALESCE(f.RECEIPTS_30D, 0) >= 5,  1, 0)              AS ACTIVE_30D_5,
       IFF(COALESCE(f.RECEIPTS_30D, 0) >= 10, 1, 0)              AS ACTIVE_30D_10,

       -- Payments path. Each stage is forced to imply the ones before it, IN THE DATA rather
       -- than by clamping in the page: a merchant who has taken a charge has necessarily
       -- passed KYC, submitted and started, whatever the current-state flags now say. Doing
       -- this per-view instead would make the stage counts stop summing across periods.
       s.ACCOUNT_CREATED_DATE,
       -- OPENED PAYMENTS — a connected account exists at all. This is its own row because the
       -- Google Sheet's "KYC started" is really this (31 merchants) while the stricter
       -- field-level test gives 21, and the 10 merchants between them are the most
       -- interesting people on the page: they asked for Payments and then typed nothing.
       -- Collapsing the two would hide that drop-off entirely.
       IFF(s.MERCHANT_ID IS NOT NULL OR c.FIRST_CHARGE_DATE IS NOT NULL, 1, 0)  AS OPENED_PAYMENTS,
       GREATEST(COALESCE(s.KYC_STARTED, 0), COALESCE(s.KYC_SUBMITTED, 0),
                COALESCE(s.KYC_APPROVED, 0), COALESCE(s.ONBOARDED, 0),
                IFF(c.FIRST_CHARGE_DATE IS NOT NULL, 1, 0))      AS KYC_STARTED,
       GREATEST(COALESCE(s.KYC_SUBMITTED, 0), COALESCE(s.KYC_APPROVED, 0),
                COALESCE(s.ONBOARDED, 0),
                IFF(c.FIRST_CHARGE_DATE IS NOT NULL, 1, 0))      AS KYC_SUBMITTED,
       GREATEST(COALESCE(s.KYC_APPROVED, 0), COALESCE(s.ONBOARDED, 0),
                IFF(c.FIRST_CHARGE_DATE IS NOT NULL, 1, 0))      AS KYC_APPROVED,
       GREATEST(COALESCE(s.ONBOARDED, 0),
                IFF(c.FIRST_CHARGE_DATE IS NOT NULL, 1, 0))      AS ONBOARDED,
       s.TOS_DATE,
       c.FIRST_CHARGE_DATE,
       COALESCE(c.CHARGES, 0)                                    AS CHARGES,
       IFF(c.FIRST_CHARGE_DATE IS NOT NULL, 1, 0)                AS PAYMENTS_USED,

       -- Beside the funnel
       b.FIRST_SUB_DATE,
       IFF(b.FIRST_SUB_DATE IS NOT NULL, 1, 0)                   AS SUBSCRIBED

FROM attributed t
LEFT JOIN first_receipt f ON f.MERCHANT_ID = t.MERCHANT_ID
LEFT JOIN stripe_stage  s ON s.MERCHANT_ID = t.MERCHANT_ID
LEFT JOIN first_charge  c ON c.MERCHANT_ID = t.MERCHANT_ID
LEFT JOIN first_sub     b ON b.MERCHANT_ID = t.MERCHANT_ID
ORDER BY t.CLICK_DATE, t.CAMPAIGN, t.MERCHANT_ID;
