-- LOYVERSE PAYMENTS — PAYMENT PROFILE: the mix of TPV (automation-safe, NO hardcoded ids)
--
-- One row per (MONTH x DIMENSION x SEGMENT x ACCOUNT), so the dashboard can show what share of
-- TPV runs through each card brand, funding type, wallet, read method and card country — and can
-- filter that by month and by merchant country without a second query.
--
-- BASE POPULATION: exactly the charges the rest of the dashboard already counts as TPV —
-- succeeded, paid, captured, from the 2026-04 window floor used by every other payments query.
-- Verified 2026-08-27: 18,999 charges, $424,163, and CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS
-- joins 100% of them, so no charge is lost to the attribute join and every share sums to the
-- same total.
--
-- NOT USED HERE: ANALYTICS_ACCEPTANCE_ITEMIZED. It is attempt-level — 18,826 attempts against
-- 18,999 captured charges — and mixing an attempt population into a captured-TPV denominator
-- produces shares that do not add up. Acceptance gets its own query.
--
-- DEVICE MODEL IS NOT AVAILABLE, and this is worth stating plainly rather than approximating in
-- silence. Charges DO carry TERMINAL_READER_ID: 127 distinct readers appear across 99.9% of TPV.
-- But TERMINAL_READERS holds exactly ONE row, belonging to the platform account, so ZERO of those
-- 127 resolve to a DEVICE_TYPE. The share simply does not expose connected accounts' readers.
-- CARD_READ_METHOD is emitted instead — contactless / chip / swipe, which is exact — and the
-- page says what it is and is not. Getting M2 vs S710 vs Tap to Phone properly needs Stripe to
-- add connected-account terminal readers to the share.
--
-- EVERY SHARE IS BY TPV, and by transaction count alongside it. They differ: debit is 61.6% of
-- transactions but 55.5% of money, because debit tickets run smaller. Cost follows the money.

WITH base AS (
    SELECT
        c.ID                                                        AS CHARGE_ID,
        c.ACCOUNT                                                   AS ACCT,
        TO_VARCHAR(TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED))), 'YYYY-MM') AS MONTH,
        c.AMOUNT                                                    AS AMOUNT_MINOR,
        UPPER(TRIM(c.CURRENCY))                                     AS CCY
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES c
    WHERE c.ACCOUNT IN (/*ACCOUNT_IDS*/)
      AND LOWER(c.STATUS) = 'succeeded'
      AND c.PAID = TRUE
      AND c.CAPTURED = TRUE
      AND TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)) IS NOT NULL
      AND TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)) >= '2026-04-01'
),
-- One row per charge. The view is charge-grained already, but DISTINCT guards the arithmetic:
-- a duplicate here would double-count a charge's money in every single share on the page.
attrs AS (
    SELECT
        d.CHARGE_ID,
        LOWER(NULLIF(TRIM(d.CARD_BRAND), ''))       AS BRAND,
        LOWER(NULLIF(TRIM(d.CARD_FUNDING), ''))     AS FUNDING,
        LOWER(NULLIF(TRIM(d.CARD_WALLET_TYPE), '')) AS WALLET,
        LOWER(NULLIF(TRIM(d.CARD_READ_METHOD), '')) AS READ_METHOD,
        UPPER(NULLIF(TRIM(d.CARD_COUNTRY), ''))     AS CARD_COUNTRY,
        LOWER(NULLIF(TRIM(d.TYPE), ''))             AS PM_TYPE,
        d.TERMINAL_READER_ID                        AS READER_ID
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d
    QUALIFY ROW_NUMBER() OVER (PARTITION BY d.CHARGE_ID ORDER BY d.BATCH_TIMESTAMP DESC NULLS LAST) = 1
),
joined AS (
    SELECT b.*, a.BRAND, a.FUNDING, a.WALLET, a.READ_METHOD, a.CARD_COUNTRY, a.PM_TYPE, a.READER_ID
    FROM base b
    LEFT JOIN attrs a ON a.CHARGE_ID = b.CHARGE_ID
),
-- Unpivot to (dimension, segment) so one query feeds every breakdown and the dashboard needs no
-- per-dimension code. A NULL attribute becomes 'unknown' rather than vanishing — a share that
-- silently drops rows is how a mix stops summing to the total.
tall AS (
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'brand'        AS DIM, COALESCE(BRAND, 'unknown')        AS SEG FROM joined
    UNION ALL
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'funding',            COALESCE(FUNDING, 'unknown')             FROM joined
    UNION ALL
    -- No wallet is a real answer, not a missing one: the card was dipped or tapped directly.
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'wallet',             COALESCE(WALLET, 'none')                 FROM joined
    UNION ALL
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'read_method',        COALESCE(READ_METHOD, 'not_present')     FROM joined
    UNION ALL
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'card_country',       COALESCE(CARD_COUNTRY, 'unknown')        FROM joined
    UNION ALL
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'presence',           COALESCE(PM_TYPE, 'unknown')             FROM joined
    UNION ALL
    -- Reader coverage, so the page can state how much TPV came through a terminal at all.
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'reader',
           IFF(READER_ID IS NULL, 'no_reader', 'via_reader')                                        FROM joined
    UNION ALL
    -- The reader ID itself. Snowflake cannot turn this into a device model — the share carries
    -- the id on every charge but replicates only the PLATFORM's reader objects, so the 127
    -- connected-account readers behind this volume resolve to nothing here. pull.js maps these
    -- ids to models from the Stripe API and rolls them up into a 'device' dimension; these raw
    -- rows are the input to that and are not shown on the page.
    SELECT MONTH, ACCT, CCY, AMOUNT_MINOR, 'reader_id',
           COALESCE(READER_ID, 'no_reader')                                                         FROM joined
)
SELECT
    MONTH,
    DIM,
    SEG,
    ACCT,
    CCY,
    COUNT(*)          AS TXNS,
    SUM(AMOUNT_MINOR) AS AMOUNT_MINOR
FROM tall
GROUP BY MONTH, DIM, SEG, ACCT, CCY
ORDER BY MONTH, DIM, AMOUNT_MINOR DESC;
