-- q1_base.sql
-- ONE QUERY PER FILE. Split out of US_Merchant_Base_Refresh_Snowflake.sql,
-- which stacked Q0-Q4 in a single file against the standing rule
-- 'never stack two queries in one file'.
--
-- Shared run context (from the original preamble):
--   account ORXEAZX-TC97659 · user TARS_SERVICE_USER · role DATA_VIEWER
--   warehouse COMPUTE_WH (statement timeout 3600s)
--   database LOYVERSE_DATA_LAKE · schema PUBLIC
-- Run order: q0 once (cheap) -> q1 (the base) -> q2 (receipts, slow)
--            -> q3 + q4 to reconcile. q1 is the only one the pipeline needs.
-- ============================================================================

-- Q1 — THE BASE. One row per live US merchant, all ~131,217 of them.
--      Runs in minutes. Export to CSV -> build_full_base.py.
-- ============================================================================
WITH us_bot_accounts AS (
    -- Copy of activated-payments/sql/us_registrations.sql — keep IDENTICAL.
    -- Signature-based on BUSINESS_NAME, US rows only, applied ALL-TIME.
    -- Deliberately does NOT use email randomness (47% false-positive rate).
    -- S1-S6: per-account business-name signatures
    SELECT LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE UPPER(TRIM(COUNTRY)) = 'US'
      AND LOYVERSE_ID IS NOT NULL
      AND BUSINESS_NAME IS NOT NULL
      AND (
           -- S1: transaction-ID business names (Order_/Sale#/... + hex id)
           REGEXP_LIKE(TRIM(BUSINESS_NAME),
               '.*(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\-]+[0-9a-fx]{6,}.*', 'i')
           -- S2: marketplace-brand impersonation (leet-normalized) + lure keyword
        OR (    REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                    '.*(poshmark|posh|vinted|depop|etsy).*')
            AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                    '.*(sold|order|support|helper|security|verify|wallet|aml|compliance|team|info).*'))
           -- S2b: leet-evaded brand name (e.g. 'P0shmark') = flag outright
        OR (    LOWER(TRIM(BUSINESS_NAME)) <> TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa')
            AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                    '.*(poshmark|vinted|depop|etsy).*'))
           -- S3: 'seller kyc' placeholder cluster
        OR TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') LIKE '%seller kyc%'
           -- S4: template persona names (WordWord##)
        OR REGEXP_LIKE(TRIM(BUSINESS_NAME), '[A-Z][a-z]{2,}[A-Z][a-z]{2,}[0-9]{1,3}')
           -- S5: zero-width character evasion
        OR REGEXP_LIKE(BUSINESS_NAME, '.*[\u200B\u200C\u200D\u2060\uFEFF].*')
           -- S6: Cyrillic homoglyphs in a US business name
        OR REGEXP_LIKE(BUSINESS_NAME, '.*[\u0400-\u04FF].*')
      )
    UNION
    -- S8: explosive name clusters (added 2026-08-07)
    SELECT m.LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    JOIN (
        SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM_NAME
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE UPPER(TRIM(COUNTRY)) = 'US'
          AND BUSINESS_NAME IS NOT NULL
          AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
        GROUP BY 1
        HAVING COUNT_IF(CREATED_AT >= '2026-03-01') >= 20
           AND COUNT_IF(CREATED_AT >= '2026-03-01') >= 10 * COUNT_IF(CREATED_AT < '2026-03-01')
    ) c8
      ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = c8.NORM_NAME
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
      AND m.LOYVERSE_ID IS NOT NULL
      AND m.CREATED_AT >= '2026-03-01'
    UNION
    -- S7: bulk clusters, excluding names established in the US pre-attack
    SELECT m.LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    JOIN (
        SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM_NAME
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE UPPER(TRIM(COUNTRY)) = 'US'
          AND BUSINESS_NAME IS NOT NULL
          AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
          AND CREATED_AT >= '2026-03-01'
        GROUP BY 1
        HAVING COUNT(*) >= 3
    ) c
      ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
      AND m.LOYVERSE_ID IS NOT NULL
      AND m.CREATED_AT >= '2026-03-01'
      AND NOT EXISTS (
          SELECT 1
          FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS p
          WHERE UPPER(TRIM(p.COUNTRY)) = 'US'
            AND p.BUSINESS_NAME IS NOT NULL
            AND p.CREATED_AT < '2026-03-01'
            AND TRANSLATE(LOWER(TRIM(p.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
      )
),

params AS (
    SELECT DATE '2026-07-01' AS LAUNCH          -- Loyverse Payments US launch
),

-- EVERY live US merchant. No activity filter, no POS filter. The only exclusion
-- is the bot screen, which is a data-integrity call rather than a targeting one.
us AS (
    SELECT
        m.LOYVERSE_ID,
        m.BUSINESS_NAME,
        m.EMAIL,
        -- CONFIRMED columns only: LOYVERSE_ID, ID, EMAIL, BUSINESS_NAME, COUNTRY,
        -- CREATED_AT, CURRENCY_CODE. LOYVERSE_MERCHANTS has NO phone/address
        -- block — that was an assumption in loyverse_merchants_columns_discovery.sql
        -- which was never answered. Run Q0b before adding anything here.
        m.CURRENCY_CODE,
        m.CREATED_AT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
      AND m.LOYVERSE_ID IS NOT NULL
      AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)   -- [US-bot-filter]
),

-- One subscription row per merchant. A merchant can carry several Chargebee
-- rows (upgrades, re-subs); pull.js picks "active first, else highest MRR" —
-- QUALIFY reproduces that deterministically.
sub AS (
    SELECT
        LOYVERSE_MERCHANT_ID,
        STATUS,
        PLAN_ID,
        MRR,
        CURRENCY_CODE AS SUB_CURRENCY,
        ACTIVATED_AT,
        CANCELLED_AT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LOYVERSE_MERCHANT_ID
        ORDER BY IFF(LOWER(STATUS) = 'active', 0, 1),
                 COALESCE(MRR, 0) DESC,
                 ACTIVATED_AT DESC
    ) = 1
),

-- Trailing-30-day activity. Canonical "active" definition, same as us_bases.sql.
-- Date filter first so the receipts scan prunes to one month of micro-partitions.
active_ids AS (
    SELECT DISTINCT MERCHANT_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS
    WHERE CREATED_AT >= DATEADD('day', -30, CURRENT_DATE())
),

-- Lifetime POS shape, cheap. Avoids the 8.76bn-row receipts table for the
-- columns that only need counts and a last-seen month.
pos AS (
    SELECT
        LOYVERSE_MERCHANT_ID    AS MERCHANT_ID,
        SUM(TOTAL_SALES_COUNT)  AS RECEIPTS_LIFETIME,
        COUNT(DISTINCT MONTH)   AS ACTIVE_MONTHS,
        MAX(MONTH)              AS LAST_ACTIVE_MONTH
    FROM LOYVERSE_DATA_LAKE.PUBLIC.SALES_PER_ACCOUNT_MONTHLY
    GROUP BY 1
),

/* -------------------------------------------------------------- POS GTV ----
   Money across the till, as distinct from money across Loyverse Payments.
   Everything above this point counts RECEIPTS; none of it counts DOLLARS, so a
   merchant running $40k a month through somebody else's card reader looked
   identical to one running $400. GTV is the number the campaign is actually
   aiming at: the prize is till volume not yet on our rails.

   SALES_PER_ACCOUNT_MONTHLY carries counts only, so this has to come from
   LOYVERSE_RECEIPTS (8.76bn rows). Cost control: the window is the trailing 12
   full months, USD only, and the date predicate is written first so the scan
   prunes by micro-partition. This block is why rev 7 runs in minutes where
   rev 6 ran in seconds.
   ------------------------------------------------------------------------ */
gtv_window AS (
    SELECT
        DATEADD('month', -12, DATE_TRUNC('MONTH', CURRENT_DATE()))::DATE AS GTV_FROM,
        DATE_TRUNC('MONTH', CURRENT_DATE())::DATE                        AS GTV_TO,
        DATEADD('day', -30, CURRENT_DATE())::DATE                        AS L30_FROM
),

-- UNIT SAFEGUARD. The library disagrees with itself about TOTAL_MONEY:
-- us_paying_merchants_gtv.sql sums it as dollars ($10k per-receipt cap, >$200
-- median = suspicious), while the dashboard's monthly.sql divides it by
-- 10^minor_units, i.e. reads it as cents. Both cannot be right, and a silent
-- 100x error in a campaign file is exactly the kind of mistake that survives
-- into a board deck. So the scale is MEASURED, not assumed: a median card
-- ticket above $1,000 is not credible for this base, so if the observed median
-- clears that bar the column is in minor units and gets divided by 100. The
-- factor and the raw median are both carried out as columns, so the decision
-- is visible on every row instead of buried in a comment.
gtv_unit AS (
    SELECT
        APPROX_PERCENTILE(r.TOTAL_MONEY, 0.5)                            AS MEDIAN_TICKET_RAW,
        -- COALESCE matters: if the probe window came back empty the median
        -- would be NULL, NULL > 1000 is NULL, and every GTV column in the file
        -- would quietly multiply by NULL and export as blank. Default to 1.0.
        COALESCE(IFF(APPROX_PERCENTILE(r.TOTAL_MONEY, 0.5) > 1000, 0.01, 1.0),
                 1.0)                                                    AS GTV_SCALE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
    CROSS JOIN gtv_window w
    WHERE r.RECEIPT_DATE >= TO_VARCHAR(w.L30_FROM)
      AND UPPER(TRIM(r.CURRENCY)) = 'USD'
      AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
),

-- Per-merchant GTV. Cleaning rules are the canonical ones from the TPV queries
-- (no refunds, no cancellations, no zero rows, USD only). The $10k per-receipt
-- cap is applied to a SEPARATE column rather than to the only column, so the
-- capping is auditable: if GTV_12M and GTV_12M_UNCAPPED diverge, a whale or a
-- fat-finger is in there and you can see it rather than wonder about it.
gtv AS (
    SELECT
        r.MERCHANT_ID,
        -- The scan spans BOTH windows and each measure picks its own days.
        -- Caught in the dry run: an earlier draft ended the scan at GTV_TO (the
        -- first of the current month) because the 12-month measure wants full
        -- months. That silently made "last 30 days" unable to see the current
        -- month, so every merchant's recent volume was understated and, in the
        -- first days of a month, would have read zero across the whole base.
        SUM(IFF(TRY_TO_DATE(r.RECEIPT_DATE) >= w.GTV_FROM
                AND TRY_TO_DATE(r.RECEIPT_DATE) < w.GTV_TO,
                LEAST(r.TOTAL_MONEY * gu.GTV_SCALE, 10000), 0)) AS GTV_12M,
        SUM(IFF(TRY_TO_DATE(r.RECEIPT_DATE) >= w.GTV_FROM
                AND TRY_TO_DATE(r.RECEIPT_DATE) < w.GTV_TO,
                r.TOTAL_MONEY * gu.GTV_SCALE, 0))               AS GTV_12M_UNCAPPED,
        SUM(IFF(TRY_TO_DATE(r.RECEIPT_DATE) >= w.L30_FROM,
                LEAST(r.TOTAL_MONEY * gu.GTV_SCALE, 10000), 0)) AS GTV_L30D,
        COUNT_IF(TRY_TO_DATE(r.RECEIPT_DATE) >= w.GTV_FROM
                 AND TRY_TO_DATE(r.RECEIPT_DATE) < w.GTV_TO)    AS RECEIPTS_12M,
        COUNT_IF(TRY_TO_DATE(r.RECEIPT_DATE) >= w.L30_FROM)     AS RECEIPTS_L30D,
        APPROX_PERCENTILE(r.TOTAL_MONEY * gu.GTV_SCALE, 0.5)    AS MEDIAN_TICKET,
        COUNT_IF(r.TOTAL_MONEY * gu.GTV_SCALE > 10000)          AS RECEIPTS_OVER_10K,
        MAX(TRY_TO_DATE(r.RECEIPT_DATE))                        AS LAST_RECEIPT_DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
    CROSS JOIN gtv_window w
    CROSS JOIN gtv_unit   gu
    -- Semi-join to the US base: prunes the scan and keeps bot accounts out of
    -- GTV for free, since `us` has already had the bot screen applied.
    JOIN us u2 ON u2.LOYVERSE_ID = r.MERCHANT_ID
    WHERE r.RECEIPT_DATE >= TO_VARCHAR(LEAST(w.GTV_FROM, w.L30_FROM))
      AND r.RECEIPT_DATE <  TO_VARCHAR(DATEADD('day', 1, CURRENT_DATE()))
      AND UPPER(TRIM(r.CURRENCY)) = 'USD'
      AND r.TOTAL_MONEY IS NOT NULL AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
    GROUP BY 1
),

-- Stripe connected accounts = the payments layer. This part of the old file was
-- NOT stale; it already tied exactly at 681 / 202 / 473 / 6 / 52.
--
-- ===========================================================================
-- REV 3 (18 Aug, after the first export came back with EVERY Stripe column
-- empty across all 131,240 rows). Root cause, from Q0c:
--
--   CONNECTED_ACCOUNT_CHARGES has 15,763 rows, 58 distinct ACCOUNT values and
--   exactly ONE distinct MERCHANT_ID. MERCHANT_ID is the PLATFORM account —
--   Loyverse's own Stripe account — a constant, not a per-merchant key. Rev 2
--   joined on it, so it matched nothing and every payments column came back
--   null. 58 charging accounts vs 52 transacting on the dashboard confirms the
--   underlying data is fine; only the key was wrong.
--
--   The per-account key is CONNECTED_ACCOUNTS.ID ('acct_...'). Nothing in the
--   Stripe share carries a LOYVERSE_ID, and no query in the existing library
--   (stripe_merchants_master, stripe_kyc_blockers, stripe_call_contacts_final)
--   has ever joined the two — they all read CONNECTED_ACCOUNTS standalone, and
--   the dashboard's 682 / 202 / 52 are row counts of that table, not join
--   results. So the link below is a RECONSTRUCTION, not a restoration.
-- ===========================================================================
stripe_acct AS (
    SELECT
        a.ID                                        AS STRIPE_ACCOUNT_ID,
        a.CREATED                                   AS CONNECTED_AT,
        a.CHARGES_ENABLED,
        a.PAYOUTS_ENABLED,
        a.DETAILS_SUBMITTED,
        a.VERIFICATION_DISABLED_REASON              AS DISABLED_REASON,
        a.REQUIREMENTS_CURRENTLY_DUE,
        -- CONNECTED_ACCOUNTS has no BUSINESS_TYPE column; the equivalent is
        -- LEGAL_ENTITY_TYPE ('individual' / 'company'). Aliased to BUSINESS_TYPE
        -- so the workbook column order is unchanged.
        a.LEGAL_ENTITY_TYPE                         AS BUSINESS_TYPE,
        a.BUSINESS_PROFILE_MCC                      AS MCC,
        -- Individual (sole-trader) accounts leave the business address null and
        -- fill the personal one instead. COALESCE lifts City/State coverage.
        COALESCE(a.LEGAL_ENTITY_ADDRESS_CITY,
                 a.LEGAL_ENTITY_PERSONAL_ADDRESS_CITY)  AS CITY,
        COALESCE(a.LEGAL_ENTITY_ADDRESS_STATE,
                 a.LEGAL_ENTITY_PERSONAL_ADDRESS_STATE) AS STATE,
        COALESCE(a.LEGAL_ENTITY_ADDRESS_LINE1,
                 a.LEGAL_ENTITY_PERSONAL_ADDRESS_LINE1) AS ADDRESS,
        COALESCE(a.SUPPORT_PHONE, a.LEGAL_ENTITY_PHONE_NUMBER) AS PHONE,
        TRIM(COALESCE(a.LEGAL_ENTITY_FIRST_NAME, '') || ' ' ||
             COALESCE(a.LEGAL_ENTITY_LAST_NAME,  '')) AS CONTACT_NAME,
        -- Link candidates, resolved in stripe_link below.
        -- BOTH email fields are carried separately rather than COALESCEd. A
        -- Stripe account can hold a login email and a different support email;
        -- collapsing them to one picks a winner arbitrarily and loses a real
        -- match if the OTHER address is the one Loyverse knows.
        LOWER(TRIM(a.EMAIL))                            AS LINK_EMAIL,
        LOWER(TRIM(a.SUPPORT_EMAIL))                    AS LINK_EMAIL_ALT,
        LOWER(TRIM(COALESCE(a.BUSINESS_NAME,
                            a.LEGAL_ENTITY_BUSINESS_NAME,
                            a.DISPLAY_NAME)))           AS LINK_NAME
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS a
    WHERE UPPER(TRIM(a.COUNTRY)) = 'US'
    -- No QUALIFY: ID is the primary key of CONNECTED_ACCOUNTS, already one row
    -- per account. Deduplication now happens per LOYVERSE_ID, in `stripe`.
),

-- US merchant emails, collapsed to one row per address so the link below can
-- never fan out. n_merchants exposes shared addresses instead of hiding them.
loyverse_email AS (
    SELECT
        LOWER(TRIM(m.EMAIL))    AS LINK_EMAIL,
        COUNT(*)                AS N_MERCHANTS,
        MIN(m.LOYVERSE_ID)      AS LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
      AND m.EMAIL IS NOT NULL
      AND TRIM(m.EMAIL) <> ''
    GROUP BY 1
),

-- Same collapse on business name, used only where email fails.
loyverse_name AS (
    SELECT
        LOWER(TRIM(m.BUSINESS_NAME))    AS LINK_NAME,
        COUNT(*)                        AS N_MERCHANTS,
        MIN(m.LOYVERSE_ID)              AS LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
      AND m.BUSINESS_NAME IS NOT NULL
      AND TRIM(m.BUSINESS_NAME) <> ''
    GROUP BY 1
),

-- >>> THE ONLY PLACE THE STRIPE <-> LOYVERSE LINK IS DEFINED <<<
-- Q0d (18 Aug) confirmed the Stripe share carries NO Loyverse identifier: the
-- only merchant-shaped columns are BUSINESS_URL, MERCHANT_ID (the platform
-- constant), PAYOUT_STATEMENT_DESCRIPTOR, PRODUCT_DESCRIPTION and
-- STATEMENT_DESCRIPTOR. So this link is INFERRED from human-entered fields, and
-- every inference is stamped with LINK_METHOD so the workbook can show HOW each
-- merchant was matched rather than presenting a fuzzy join as fact.
--
-- Waterfall, strongest signal first. Email beats name because a merchant can
-- rename a business but rarely re-registers the address.
--   Email (exact)            - one Loyverse merchant holds that address. Trust it.
--   Email (shared address)   - several merchants share it; oldest id taken. REVIEW.
--   Business name (exact)    - unique name on both sides. Reasonable.
--   Business name (shared)   - generic name e.g. 'Store'. WEAK, review before use.
--
-- If a Loyverse id is ever stamped into Stripe account metadata at creation
-- time, replace the body of THIS CTE and nothing else in the query changes.
-- Manual overrides. An account lands here when its identity was confirmed by a
-- human and no automatic rule can find it. Reviewed 18 Aug: of the 7 unmatched
-- accounts, 5 are internal demo/test accounts (mailinator addresses, 'demo' in
-- the name) that SHOULD stay out of the base, 1 is a brand-new signup with no
-- charges, and 1 — Chilakings — is the missing 52nd transacting merchant.
-- Add rows as (stripe_account_id, loyverse_id) once confirmed.
--
-- CONFIRMED 18 Aug 2026 — Chilakings. The restaurant registered on Loyverse
-- twice under one email (chilakings661@gmail.com): 5011946 on 22 Jul and
-- 5017724 on 24 Jul. The Stripe account connected 25 Jul, the day after the
-- second registration. Email cannot split them (both hold it) and neither can
-- name, so Felipe confirmed the live till is 5017724. Pinned here permanently.
link_override AS (
    SELECT * FROM (VALUES
        ('acct_1TxAQjG6iUrq4DFX'::VARCHAR, 5017724::NUMBER),  -- Chilakings, confirmed by Felipe 18 Aug 2026
        (NULL::VARCHAR, NULL::NUMBER)   -- type anchor; filtered out below
    ) AS t(STRIPE_ACCOUNT_ID, LOYVERSE_ID)
    WHERE STRIPE_ACCOUNT_ID IS NOT NULL
),

stripe_link AS (
    SELECT
        sa.STRIPE_ACCOUNT_ID,
        COALESCE(ov.LOYVERSE_ID, le.LOYVERSE_ID, le2.LOYVERSE_ID, ln.LOYVERSE_ID) AS LOYVERSE_ID,
        CASE
            WHEN ov.LOYVERSE_ID  IS NOT NULL                         THEN 'Manual override'
            WHEN le.LOYVERSE_ID  IS NOT NULL AND le.N_MERCHANTS  = 1 THEN 'Email (exact)'
            WHEN le.LOYVERSE_ID  IS NOT NULL                         THEN 'Email (shared address)'
            WHEN le2.LOYVERSE_ID IS NOT NULL AND le2.N_MERCHANTS = 1 THEN 'Support email (exact)'
            WHEN le2.LOYVERSE_ID IS NOT NULL                         THEN 'Support email (shared)'
            ELSE 'Business name (exact)'
        END                                         AS LINK_METHOD
    FROM stripe_acct sa
    LEFT JOIN link_override ov ON ov.STRIPE_ACCOUNT_ID = sa.STRIPE_ACCOUNT_ID
    LEFT JOIN loyverse_email le  ON le.LINK_EMAIL  = sa.LINK_EMAIL
    LEFT JOIN loyverse_email le2 ON le2.LINK_EMAIL = sa.LINK_EMAIL_ALT
    LEFT JOIN loyverse_name  ln  ON ln.LINK_NAME   = sa.LINK_NAME
    -- MEASURED 18 Aug across 684 US accounts: 667 email-exact (97.5%),
    -- 10 email-shared, 4 name-shared, 3 unlinked.
    --
    -- Name-shared matches are DELIBERATELY NOT LINKED. A generic business name
    -- ('Store', 'Restaurant') matches several Loyverse merchants, and picking
    -- one via MIN(LOYVERSE_ID) is a coin flip that would attach real payment
    -- volume to a merchant that may not have earned it. Four accounts is not
    -- worth corrupting the base for — they surface in Q4 for a human instead.
    --
    -- Email-shared IS linked: one owner running several stores is the normal
    -- explanation, so the oldest id is defensible. Still flagged in the column.
    WHERE ov.LOYVERSE_ID IS NOT NULL
       OR le.LOYVERSE_ID IS NOT NULL
       OR le2.LOYVERSE_ID IS NOT NULL
       OR (ln.LOYVERSE_ID IS NOT NULL AND ln.N_MERCHANTS = 1)
),

-- One row per LOYVERSE_ID. If a merchant somehow has two connected accounts we
-- keep the most recent, and the charges CTE still counts BOTH accounts' volume
-- because it aggregates via stripe_link rather than via this deduped row.
stripe AS (
    SELECT
        sl.LOYVERSE_ID,
        sl.LINK_METHOD,
        sa.*
    FROM stripe_acct sa
    JOIN stripe_link sl ON sl.STRIPE_ACCOUNT_ID = sa.STRIPE_ACCOUNT_ID
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY sl.LOYVERSE_ID
        ORDER BY sa.CONNECTED_AT DESC
    ) = 1
),

-- Payments volume actually processed. AMOUNT is in minor units -> /100.
--
-- REV 3: keyed on ACCOUNT, which is the real per-merchant key, then rolled up to
-- LOYVERSE_ID through stripe_link. Rev 2 grouped by MERCHANT_ID — a constant —
-- which collapsed all 15,763 charges into a single unjoinable row.
--
-- CREATED is TIMESTAMP_NTZ, not an epoch integer.
-- AMOUNT_REFUNDED lets us report net as well as gross.
charges AS (
    SELECT
        sl.LOYVERSE_ID                              AS CHARGES_LOYVERSE_ID,
        MIN(c.CREATED)                              AS FIRST_CHARGE_AT,
        MAX(c.CREATED)                              AS LAST_CHARGE_AT,
        COUNT(*)                                    AS CHARGE_COUNT,
        SUM(c.AMOUNT) / 100.0                       AS PAYMENTS_VOLUME_USD,
        SUM(COALESCE(c.AMOUNT_REFUNDED, 0)) / 100.0 AS PAYMENTS_REFUNDED_USD,
        (SUM(c.AMOUNT) - SUM(COALESCE(c.AMOUNT_REFUNDED, 0))) / 100.0 AS PAYMENTS_NET_USD,
        -- Same 30-day window as GTV_L30D. Attach rate is only meaningful when
        -- both sides cover the same days: payments volume runs from the July
        -- launch, GTV runs 12 months, so dividing one by the other would
        -- understate attach by roughly 4x on any merchant that predates launch.
        SUM(IFF(c.CREATED >= DATEADD('day', -30, CURRENT_DATE()), c.AMOUNT, 0)) / 100.0
                                                    AS PAYMENTS_L30D_USD
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES c
    JOIN stripe_link sl ON sl.STRIPE_ACCOUNT_ID = c.ACCOUNT
    WHERE LOWER(c.STATUS) = 'succeeded'
      AND c.PAID = TRUE
      AND c.CAPTURED = TRUE
      AND UPPER(TRIM(c.CURRENCY)) = 'USD'
    GROUP BY 1
),

base AS (
    SELECT
        u.LOYVERSE_ID                               AS MERCHANT_ID,
        u.BUSINESS_NAME,
        -- EMAIL comes from LOYVERSE_MERCHANTS, populated for essentially every
        -- registration. This alone lifts contactability from 4% to ~100% and is
        -- the single highest-value column in this query.
        u.EMAIL,
        -- Phone/address are Stripe-only, so they cover the 682 payments signups
        -- and nobody else. That is a real limitation, not a bug: EMAIL is the
        -- only channel that reaches the whole base. If Q0b turns up a contact
        -- table elsewhere in the lake, join it here and COALESCE it in front.
        st.PHONE,
        st.CONTACT_NAME,
        u.CURRENCY_CODE                             AS REPORTED_CURRENCY,
        st.BUSINESS_TYPE,
        st.MCC,
        st.CITY,
        st.STATE,
        st.ADDRESS,

        -- >>> COLUMN AA. Text, in the workbook's YYYY-MM shape. <<<
        TO_CHAR(u.CREATED_AT, 'YYYY-MM')            AS MONTH_JOINED_POS,
        CAST(u.CREATED_AT AS DATE)                  AS JOINED_LOYVERSE,
        DATEDIFF('day', u.CREATED_AT, CURRENT_DATE()) AS TENURE_DAYS,
        TO_CHAR(YEAR(u.CREATED_AT)) || '-Q' || TO_CHAR(QUARTER(u.CREATED_AT))
                                                    AS COHORT_QUARTER,

        -- Mutually exclusive base group. Reproduces __FUNNEL_BASES exactly.
        -- THIS is the column that replaces the old file's silent row filter.
        CASE
            WHEN u.CREATED_AT >= p.LAUNCH                   THEN 'new'
            WHEN LOWER(sb.STATUS) = 'active'                THEN 'paying'
            WHEN ai.MERCHANT_ID IS NOT NULL                 THEN 'nonpaying'
            ELSE 'dormant'
        END                                         AS BASE_GROUP,

        IFF(ai.MERCHANT_ID IS NOT NULL, 'Yes', 'No') AS ACTIVE_ON_POS,
        IFF(LOWER(sb.STATUS) = 'active', 'Yes', 'No') AS IS_PAYING,
        sb.PLAN_ID                                  AS SOFTWARE_PLAN,
        sb.MRR                                      AS SOFTWARE_MRR,   -- [VERIFY grain]
        sb.SUB_CURRENCY                             AS MRR_CURRENCY,
        sb.STATUS                                   AS SUBSCRIPTION_STATUS,
        sb.ACTIVATED_AT                             AS SUBSCRIPTION_STARTED,
        sb.CANCELLED_AT                             AS SUBSCRIPTION_CANCELLED,

        COALESCE(ps.RECEIPTS_LIFETIME, 0)           AS RECEIPTS_LIFETIME,
        COALESCE(ps.ACTIVE_MONTHS, 0)               AS ACTIVE_MONTHS,
        ps.LAST_ACTIVE_MONTH,

        -- POS GTV. Trailing 12 full months, USD receipts, canonical cleaning.
        -- Zero means "no clean USD receipts in the window", which is true of
        -- the dormant majority — it does not mean the merchant never sold.
        ROUND(COALESCE(g.GTV_12M, 0), 2)            AS POS_GTV_12M_USD,
        ROUND(COALESCE(g.GTV_12M_UNCAPPED, 0), 2)   AS POS_GTV_12M_UNCAPPED_USD,
        ROUND(COALESCE(g.GTV_L30D, 0), 2)           AS POS_GTV_L30D_USD,
        COALESCE(g.RECEIPTS_12M, 0)                 AS POS_RECEIPTS_12M,
        COALESCE(g.RECEIPTS_L30D, 0)                AS POS_RECEIPTS_L30D,
        ROUND(g.MEDIAN_TICKET, 2)                   AS POS_MEDIAN_TICKET_USD,
        g.LAST_RECEIPT_DATE                         AS POS_LAST_RECEIPT_DATE,
        -- Read this before you trust the GTV columns on any given row.
        CASE
            WHEN g.MERCHANT_ID IS NULL          THEN 'No USD receipts in window'
            WHEN g.MEDIAN_TICKET > 200          THEN 'Check - median ticket over $200, likely non-USD data'
            WHEN g.RECEIPTS_OVER_10K > 0        THEN 'Capped - one or more receipts over $10k'
            ELSE 'Clean'
        END                                         AS GTV_DATA_FLAG,
        gu.GTV_SCALE                                AS GTV_UNIT_SCALE,

        -- Payments funnel stage, MUTUALLY EXCLUSIVE — one merchant, one stage.
        -- NOT the same shape as __FUNNEL_STAGES_BY on the dashboard, which is
        -- CUMULATIVE (entered 3,721 > signed_up 682 > enabled 202 > txn 52).
        -- Exclusive 'Enabled' reads 150, not 202, because the 52 transacting
        -- merchants move up. Use the flags below to reconcile, this to segment.
        CASE
            WHEN st.STRIPE_ACCOUNT_ID IS NULL       THEN 'Entered'
            WHEN ch.CHARGE_COUNT > 0                THEN 'Transacting'
            WHEN st.CHARGES_ENABLED = TRUE          THEN 'Enabled'
            WHEN LOWER(COALESCE(st.DISABLED_REASON,'')) LIKE 'rejected%'
                                                    THEN 'Rejected'
            ELSE 'Restricted'
        END                                         AS FUNNEL_STAGE,

        -- Cumulative flags: SUM these to get 3,721 / 682 / 202 / 52.
        1                                           AS IS_ENTERED,
        IFF(st.STRIPE_ACCOUNT_ID IS NOT NULL, 1, 0) AS IS_SIGNED_UP,
        IFF(st.CHARGES_ENABLED = TRUE, 1, 0)        AS IS_ENABLED,
        IFF(COALESCE(ch.CHARGE_COUNT, 0) > 0, 1, 0) AS IS_TRANSACTING,
        -- Compliance flag: KYC rejected yet money is moving. Two such merchants
        -- existed at 18 Aug (2391296 Towers Arms LLC, 1672779 ICLOUD SMOKE &
        -- TOBACCO). This surfaces them automatically on every run.
        IFF(LOWER(COALESCE(st.DISABLED_REASON,'')) LIKE 'rejected%'
            AND COALESCE(ch.CHARGE_COUNT, 0) > 0, 1, 0) AS REJECTED_BUT_TRANSACTING,

        st.STRIPE_ACCOUNT_ID,
        -- How this merchant was tied to its Stripe account. NULL for the ~130k
        -- with no payments account at all. Anything other than 'Email (exact)'
        -- should be eyeballed before it drives money decisions.
        st.LINK_METHOD                              AS PAYMENTS_LINK_METHOD,
        st.CONNECTED_AT                             AS JOINED_PAYMENTS,
        st.CHARGES_ENABLED,
        st.DISABLED_REASON,
        st.REQUIREMENTS_CURRENTLY_DUE,
        COALESCE(ch.PAYMENTS_VOLUME_USD, 0)         AS PAYMENTS_VOLUME_USD,
        COALESCE(ch.PAYMENTS_REFUNDED_USD, 0)       AS PAYMENTS_REFUNDED_USD,
        COALESCE(ch.PAYMENTS_NET_USD, 0)            AS PAYMENTS_NET_USD,
        COALESCE(ch.CHARGE_COUNT, 0)                AS PAYMENTS_TXNS,
        COALESCE(ch.PAYMENTS_L30D_USD, 0)           AS PAYMENTS_L30D_USD,
        ch.FIRST_CHARGE_AT,
        ch.LAST_CHARGE_AT                           AS LAST_PAYMENTS_CHARGE,

        -- THE TWO COLUMNS THE CAMPAIGN IS ACTUALLY FOR.
        -- Attach rate: of the money crossing this till in the last 30 days, how
        -- much came through Loyverse Payments. NULL where there is no recent
        -- till volume to divide by — a rate of 0% and a rate of "unknowable"
        -- are different answers and should not be allowed to look the same.
        CASE
            WHEN COALESCE(g.GTV_L30D, 0) <= 0 THEN NULL
            ELSE ROUND(LEAST(COALESCE(ch.PAYMENTS_L30D_USD, 0)
                             / g.GTV_L30D, 1), 4)
        END                                         AS PAYMENTS_ATTACH_RATE_L30D,
        -- Opportunity: 30-day till volume NOT running through us. This is the
        -- prize per merchant, and the honest way to rank a campaign list.
        ROUND(GREATEST(COALESCE(g.GTV_L30D, 0)
                       - COALESCE(ch.PAYMENTS_L30D_USD, 0), 0), 2)
                                                    AS GTV_OFF_PAYMENTS_L30D_USD

    FROM us u
    CROSS JOIN params p
    CROSS JOIN gtv_unit gu
    LEFT JOIN sub        sb ON sb.LOYVERSE_MERCHANT_ID = u.LOYVERSE_ID
    LEFT JOIN active_ids ai ON ai.MERCHANT_ID          = u.LOYVERSE_ID
    LEFT JOIN pos        ps ON ps.MERCHANT_ID          = u.LOYVERSE_ID
    LEFT JOIN gtv        g  ON g.MERCHANT_ID           = u.LOYVERSE_ID
    -- REV 3: both Stripe joins now land on LOYVERSE_ID, resolved once in
    -- stripe_link. No casting needed — both sides are numeric. The earlier
    -- "Numeric value 'acct_...' is not recognized" error was the symptom of
    -- joining an account key to a merchant key; TO_VARCHAR silenced the error
    -- without fixing the mismatch, which is why the export came back empty.
    LEFT JOIN stripe     st ON st.LOYVERSE_ID         = u.LOYVERSE_ID
    LEFT JOIN charges    ch ON ch.CHARGES_LOYVERSE_ID = u.LOYVERSE_ID
)

-- DERIVED block. Everything the old workbook computed in-sheet is computed here
-- so the 131k-row file carries static values and no formulas.
SELECT
    b.*,

    -- Contactability. The old file could reach 4% of its rows; this makes the
    -- constraint explicit per row instead of leaving blanks to be discovered.
    IFF(b.EMAIL IS NOT NULL OR b.PHONE IS NOT NULL, 'Yes', 'No') AS IS_CONTACTABLE,
    CASE WHEN b.EMAIL IS NOT NULL AND b.PHONE IS NOT NULL THEN 'Email + phone'
         WHEN b.EMAIL IS NOT NULL                         THEN 'Email only'
         WHEN b.PHONE IS NOT NULL                         THEN 'Phone only'
         ELSE 'No contact details' END                            AS CONTACT_CHANNEL,

    -- Targetability. Replaces the old file's implicit "if it is not a row, do
    -- not call it". Every merchant is present; this says whether to work it and,
    -- if not, why not — so the exclusion is auditable rather than invisible.
    CASE
        WHEN b.IS_TRANSACTING = 1                      THEN 'No'
        WHEN b.EMAIL IS NULL AND b.PHONE IS NULL       THEN 'No'
        WHEN b.BASE_GROUP = 'dormant'                  THEN 'No'
        ELSE 'Yes'
    END                                                           AS IS_TARGETABLE,
    CASE
        WHEN b.IS_TRANSACTING = 1                      THEN 'Already processing payments'
        WHEN b.EMAIL IS NULL AND b.PHONE IS NULL       THEN 'No contact details'
        WHEN b.BASE_GROUP = 'dormant'                  THEN 'Dormant - no POS signal in 30d, no subscription'
        ELSE NULL
    END                                                           AS EXCLUSION_REASON,

    -- Priority band, computed across the FULL base so the ranking is honest.
    -- Paying + active merchants who have not yet signed up for payments are the
    -- warmest; new registrations are next; dormant is explicitly last, not absent.
    CASE
        WHEN b.IS_SIGNED_UP = 1 AND b.IS_TRANSACTING = 0 THEN '1 - Signed up, not processing'
        WHEN b.BASE_GROUP = 'paying'                     THEN '2 - Paying subscriber'
        WHEN b.BASE_GROUP = 'nonpaying'                  THEN '3 - Active, no subscription'
        WHEN b.BASE_GROUP = 'new'                        THEN '4 - New registration'
        ELSE '5 - Dormant'
    END                                                           AS PRIORITY_BAND,

    -- Size band on 30-day till volume. PRIORITY_BAND says who is warm;
    -- this says who is worth the call. A dormant merchant doing $30k a month
    -- somewhere else is a better hour of somebody's time than a warm merchant
    -- doing $200, and until now the file could not tell you which was which.
    CASE
        WHEN b.POS_GTV_L30D_USD >= 50000 THEN 'A - $50k+ / 30d'
        WHEN b.POS_GTV_L30D_USD >= 20000 THEN 'B - $20-50k / 30d'
        WHEN b.POS_GTV_L30D_USD >= 5000  THEN 'C - $5-20k / 30d'
        WHEN b.POS_GTV_L30D_USD >  0     THEN 'D - under $5k / 30d'
        ELSE 'E - no recent till volume'
    END                                                           AS GTV_BAND,

    -- How much of this merchant's till figure can be believed.
    --
    -- Summing POS_GTV_L30D_USD raw gives ~$620m over 30 days, and that number is
    -- not real: 555 merchants report CURRENCY = 'USD' while posting median
    -- tickets of $2,000-$34,000, and they carry 89% of the total between them.
    -- Their names (Bodeguita, Ferreteria, ... SURL) and their addresses -- 23 of
    -- the 555 have a US state on file -- say these are local-currency tills
    -- labelled USD. The credible total is ~$49m across ~3,500 merchants.
    --
    -- Note this is NOT the dollars-vs-cents question. That one is settled:
    -- across the 52 merchants who also process on Stripe -- the only place we
    -- hold volume in known-real dollars -- the POS median ticket tracks the
    -- settled card ticket at 0.83x, so TOTAL_MONEY is in DOLLARS and
    -- GTV_UNIT_SCALE reads 1. The unit is right; the currency label is wrong.
    --
    -- Nobody is dropped. The judgement goes in a column where it can be argued
    -- with, rather than being applied silently by leaving rows out. Order of
    -- tests matters: card corroboration is the strongest evidence we have and
    -- deliberately outranks both heuristics, so a genuine high-ticket US
    -- merchant is not demoted merely for having a large average.
    CASE
        WHEN COALESCE(b.POS_GTV_L30D_USD, 0) <= 0
            THEN 'No recent till volume'
        -- At least 5 charges: one $1 test charge is not evidence of anything.
        WHEN COALESCE(b.PAYMENTS_TXNS, 0) >= 5
             AND COALESCE(b.PAYMENTS_VOLUME_USD, 0) > 0
             AND COALESCE(b.POS_MEDIAN_TICKET_USD, 0) > 0
             AND b.POS_MEDIAN_TICKET_USD
                 / (b.PAYMENTS_VOLUME_USD / b.PAYMENTS_TXNS) BETWEEN 0.2 AND 5
            THEN '1 - Confirmed by card data'
        WHEN b.GTV_DATA_FLAG LIKE 'Check%'
            THEN '3 - Check: ticket size suggests another currency'
        -- $250k in 30 days is roughly $3m a year through a Loyverse till. Real
        -- merchants do reach it, so this downgrades rather than excludes.
        WHEN b.POS_GTV_L30D_USD > 250000
            THEN '4 - Check: volume too large to take on trust'
        ELSE '2 - Plausible'
    END                                                           AS GTV_CONFIDENCE,

    CURRENT_TIMESTAMP()                                           AS PULLED_AT
FROM base b
ORDER BY b.BASE_GROUP, b.JOINED_LOYVERSE DESC;


