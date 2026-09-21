-- =================================================================
-- COUNTRY x MONTH: qualified active merchants, and GTV in USD
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- One scan of LOYVERSE_RECEIPTS_UNIQUE (9.6B rows, 2.7TB, NO clustering key, so nothing
-- prunes and every row is read) producing everything the page needs from the till:
--   * active merchants at 1+ / 5+ / 10+ receipts, per country per month
--   * GTV converted to USD, per country per month
-- The global qualified-active series is the SUM over countries, which is exact: a merchant
-- has exactly one country, so none can be double-counted or lost. That is why this replaced
-- a separate global-only query — one scan of 2.7TB instead of two.
--
-- GTV: THE MONEY COLUMN IS THE DANGEROUS ONE, and both pre-existing GTV paths get it wrong.
-- The dashboard's per-country GTV reads $63m per merchant per month in Korea and $0 in
-- Bangladesh, totalling $75bn a month across a base of 400k tills. Three faults, none of
-- them guessed at here — each was measured:
--
--   1. TOTAL_MONEY IS IN MAJOR UNITS. Not cents. Both existing paths divide by minor units
--      — the as-of query by a per-merchant DECIMAL_PLACES column, gtv-by-market.sql by ISO
--      decimals — so both are ~100x low wherever they divide at all. MEASURED: a 0.1%
--      sample gives the median receipt per currency, and for all 44 currencies that had a
--      rate, reading TOTAL_MONEY as major units puts the median ticket between $1.62 and
--      $10.99. Not one lands anywhere else. PHP median 149 = $2.51, THB 100 = $3.13,
--      IDR 32,000 = $1.88, USD 7.48 = $7.48.
--
--   2. OUTLIERS NEED CAPPING. Japan showed a $194,000 AVERAGE ticket against a plausible
--      median — a handful of absurd receipts dragging a mean. The $10k per-receipt cap is
--      the canonical rule from merchant-base-automation/queries/q1_base.sql, and as there
--      it goes in a SEPARATE column: if GTV_USD and GTV_USD_UNCAPPED diverge, a whale or a
--      fat-finger is in there and you can SEE it rather than wonder about it.
--
--   3. THE RATE TABLE MUST COVER EVERY CURRENCY. The 48-currency list in gtv-by-market.sql
--      left 79 currencies and 8.4% of receipts with no rate, contributing nothing, which is
--      why 164 countries read near $0. All 160 currencies below, from open.er-api.com
--      captured 2026-09-20. Anything still unmatched contributes nothing and is counted out
--      separately, so the gap stays measurable rather than invisible.
--
-- Rates are a dated snapshot, so GTV is comparable ACROSS countries but is not a
-- historical-FX reconstruction: a month from 2022 converts at today's rate. Right for a
-- country ranking, wrong for a finance restatement.
--
-- The active columns copy their filters from receipts_tpv_daily_asof.sql — same table, same
-- receipt tests, same bot exclusion (lifted verbatim below) — because the 1+ column is
-- reconciled against the activeMonthly series the page already publishes and the build
-- fails if they drift. Two different "active" numbers on one page would discredit both.
-- =================================================================

WITH -- ----------------------------------------------------------------
    -- US BOT/FAKE-ACCOUNT FILTER (added 2026-07-21)
    -- Excludes the US registration bot campaign quantified in the July 2026
    -- fraud investigation (Mem note 08de7ff9 / July_2026_US_bot_fraud_full_report.xlsx).
    -- Signature-based on BUSINESS_NAME, US rows only, applied ALL-TIME.
    -- Deliberately does NOT use email randomness (47% false-positive rate).
    -- Keep this block IDENTICAL across all kpi-automation/sql files.
    us_bot_accounts AS (
        -- S1-S6: per-account business-name signatures
        SELECT LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE UPPER(TRIM(COUNTRY)) = 'US'
          AND LOYVERSE_ID IS NOT NULL
          AND BUSINESS_NAME IS NOT NULL
          AND (
               -- S1: transaction-ID business names (Order_/Sale#/... + hex id) - July flood
               REGEXP_LIKE(TRIM(BUSINESS_NAME),
                   '.*(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\-]+[0-9a-fx]{6,}.*', 'i')
               -- S2: marketplace-brand impersonation (leet-normalized) + lure keyword
            OR (    REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                        '.*(poshmark|posh|vinted|depop|etsy).*')
                AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                        '.*(sold|order|support|helper|security|verify|wallet|aml|compliance|team|info).*'))
               -- S2b: leet-evaded brand name (e.g. 'P0shmark', 'V1nted') = flag outright
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
        -- S7 exempts any name that also existed in the US before the attack, on the reasoning
        -- that it is an organic duplicate. That protection was load-bearing in the wrong
        -- direction: 7 US "Poshmark" accounts dating from 2025-11 exempted the entire 787-account
        -- attack-era cluster, leaving 374 registrations on 2 July and 216 on 30 July in the
        -- published figures. S8 restores the catch for names whose attack-era cohort is both
        -- large (>= 20) and dwarfs any pre-attack presence (>= 10x), which is the shape of a
        -- scripted wave rather than a popular name. Genuinely long-standing duplicates are left
        -- alone by the ratio test: depop (85 attack-era vs 129 before), test (57 vs 906) and
        -- walmart (14 vs 132) are all untouched. Brand-agnostic on purpose, so the next wave
        -- does not need a new signature.
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
        -- S7: bulk clusters - same normalized name >= 3x among US signups in the
        -- attack era (>= 2026-03-01). Names already established in the US before
        -- the attack are treated as organic duplicates and NOT flagged.
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
    -- ----------------------------------------------------------------
    -- GLOBAL BOT/FAKE-ACCOUNT FILTER (added 2026-09-07)
    -- The us_bot_accounts block above is hard-scoped to COUNTRY = 'US'. That scope was set
    -- on the July 2026 finding that the campaign was US-only. It is no longer true: the
    -- Sep 5-7 2026 Vinted/Mercari wave hit NL/CH/AT/DK/CZ/NO/FI/SE and never touched the US,
    -- and a re-screen found unfiltered Poshmark clusters in GB (44 on 2026-05-31) and a
    -- disposable-mail cluster in LT (34 on 2026-03-21) that have been in the published
    -- numbers all along. These three signatures are country-agnostic.
    --
    -- G1 and G2 both require a machine-generated email mailbox as a SECOND factor. Email
    -- randomness on its own has a ~47% false-positive rate (July 2026 investigation) and
    -- must never be used alone -- but inside an already-suspicious set it is what separates
    -- a scripted wave from a real cohort. Two false positives it demonstrably prevents:
    --   * @loyverse.com accounts that are genuine merchants onboarded by staff, e.g. PH
    --     'Sabunan Point' (13,850 receipts over 148 days) and PH 'KUAN UA' (7,087 receipts).
    --   * PH 'EXPO2026', 31 same-name same-day signups on individual human gmail addresses
    --     minutes apart -- a real event cohort, not a burst.
    -- Every account these three rules add has ZERO receipts, all-time (verified 2026-09-07).
    --
    -- Keep this block IDENTICAL across every file that uses it.
    -- ----------------------------------------------------------------
    random_local AS (
        -- Machine-generated mailbox: 8-12 chars, alphanumeric only, containing BOTH letters
        -- and digits. Human addresses carry dots, plus-addressing, or are all letters.
        -- NOTE: Snowflake REGEXP_LIKE is implicitly anchored -- the '.*' wrappers are required.
        SELECT LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE EMAIL IS NOT NULL
          AND REGEXP_LIKE(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '^[a-z0-9]{8,12}$')
          AND REGEXP_LIKE(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '.*[0-9].*')
          AND REGEXP_LIKE(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '.*[a-z].*')
    ),
    global_bot_accounts AS (
        -- G1: signup on Loyverse's OWN email domain with a machine-generated mailbox.
        -- Verification mail for these goes nowhere real; staff accounts are left alone by
        -- the random_local test.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        WHERE SPLIT_PART(LOWER(TRIM(m.EMAIL)), '@', 2) = 'loyverse.com'
          AND m.CREATED_AT >= '2026-03-01'
          AND m.LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM random_local)
        UNION
        -- G2: scripted burst -- same normalised business name, same country, same calendar
        -- day, >= 20 accounts, prior all-time presence of that name in that country under a
        -- tenth of the burst (the S8 ratio test, generalised off the US), and >= 90% of the
        -- burst on machine-generated mailboxes.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        JOIN (
            SELECT C, NORM, D
            FROM (
                SELECT UPPER(TRIM(COUNTRY)) AS C,
                       TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM,
                       DATE(CREATED_AT) AS D,
                       COUNT(*) AS N,
                       COUNT_IF(LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM random_local)) AS N_RANDOM
                FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
                WHERE BUSINESS_NAME IS NOT NULL
                  AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
                  AND COUNTRY IS NOT NULL
                GROUP BY 1, 2, 3
            )
            QUALIFY N >= 20
                AND D >= '2026-03-01'
                AND N_RANDOM >= 0.90 * N
                AND COALESCE(SUM(N) OVER (PARTITION BY C, NORM ORDER BY D
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) < N / 10.0
        ) b
          ON UPPER(TRIM(m.COUNTRY)) = b.C
         AND TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = b.NORM
         AND DATE(m.CREATED_AT) = b.D
        UNION
        -- G3: marketplace-brand impersonation using the brand's OWN email domain. The
        -- business name is exactly the brand (optionally with a suffix) and the mailbox sits
        -- on that same brand's domain. No plausible merchant reads this way.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        WHERE m.BUSINESS_NAME IS NOT NULL
          AND m.CREATED_AT >= '2026-03-01'
          AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa'),
                  '(vinted|mercari|poshmark|depop|etsy)([[:space:]_#:.-].*)?')
          AND SPLIT_PART(LOWER(TRIM(m.EMAIL)), '@', 2) IN
                  ('vinted.com', 'mercari.com', 'poshmark.com', 'depop.com', 'etsy.com')
    ),
    bot_accounts AS (
        -- Single exclusion set consumed by the query below: the US-scoped signatures plus
        -- the country-agnostic ones. Every reference site uses this, not either half.
        SELECT LOYVERSE_ID FROM us_bot_accounts
        UNION
        SELECT LOYVERSE_ID FROM global_bot_accounts
    ),
fx_rates AS (
    -- USD per one unit of currency. From open.er-api.com (USD base) captured 2026-09-20,
    -- inverted from its units-per-USD quoting. Refresh quarterly; the build prints the
    -- share of receipts that found no rate, so staleness shows up as coverage loss.
    SELECT currency, usd_per_unit FROM (
    SELECT 'AED' AS currency, 0.2722940776 AS usd_per_unit UNION ALL
    SELECT 'AFN' AS currency, 0.0154036301 AS usd_per_unit UNION ALL
    SELECT 'ALL' AS currency, 0.01246973486 AS usd_per_unit UNION ALL
    SELECT 'AMD' AS currency, 0.002736355872 AS usd_per_unit UNION ALL
    SELECT 'ANG' AS currency, 0.5586592179 AS usd_per_unit UNION ALL
    SELECT 'AOA' AS currency, 0.001078393608 AS usd_per_unit UNION ALL
    SELECT 'ARS' AS currency, 0.0006612299459 AS usd_per_unit UNION ALL
    SELECT 'AUD' AS currency, 0.711782781 AS usd_per_unit UNION ALL
    SELECT 'AWG' AS currency, 0.5586592179 AS usd_per_unit UNION ALL
    SELECT 'AZN' AS currency, 0.5839729784 AS usd_per_unit UNION ALL
    SELECT 'BAM' AS currency, 0.586953319 AS usd_per_unit UNION ALL
    SELECT 'BBD' AS currency, 0.5 AS usd_per_unit UNION ALL
    SELECT 'BDT' AS currency, 0.008108701753 AS usd_per_unit UNION ALL
    SELECT 'BGN' AS currency, 0.586953319 AS usd_per_unit UNION ALL
    SELECT 'BHD' AS currency, 2.659574468 AS usd_per_unit UNION ALL
    SELECT 'BIF' AS currency, 0.0003315491448 AS usd_per_unit UNION ALL
    SELECT 'BMD' AS currency, 1 AS usd_per_unit UNION ALL
    SELECT 'BND' AS currency, 0.7833141552 AS usd_per_unit UNION ALL
    SELECT 'BOB' AS currency, 0.09034143461 AS usd_per_unit UNION ALL
    SELECT 'BRL' AS currency, 0.1947759152 AS usd_per_unit UNION ALL
    SELECT 'BSD' AS currency, 1 AS usd_per_unit UNION ALL
    SELECT 'BTN' AS currency, 0.01042218945 AS usd_per_unit UNION ALL
    SELECT 'BWP' AS currency, 0.06998070562 AS usd_per_unit UNION ALL
    SELECT 'BYN' AS currency, 0.3281751852 AS usd_per_unit UNION ALL
    SELECT 'BZD' AS currency, 0.5 AS usd_per_unit UNION ALL
    SELECT 'CAD' AS currency, 0.7147314004 AS usd_per_unit UNION ALL
    SELECT 'CDF' AS currency, 0.0004292669703 AS usd_per_unit UNION ALL
    SELECT 'CHF' AS currency, 1.214429364 AS usd_per_unit UNION ALL
    SELECT 'CLP' AS currency, 0.001040759486 AS usd_per_unit UNION ALL
    SELECT 'CNH' AS currency, 0.1493110267 AS usd_per_unit UNION ALL
    SELECT 'CNY' AS currency, 0.1488448523 AS usd_per_unit UNION ALL
    SELECT 'COP' AS currency, 0.0003184386506 AS usd_per_unit UNION ALL
    SELECT 'CRC' AS currency, 0.002214800097 AS usd_per_unit UNION ALL
    SELECT 'CUP' AS currency, 0.04166666667 AS usd_per_unit UNION ALL
    SELECT 'CVE' AS currency, 0.01041110909 AS usd_per_unit UNION ALL
    SELECT 'CZK' AS currency, 0.04715785058 AS usd_per_unit UNION ALL
    SELECT 'DJF' AS currency, 0.005626797058 AS usd_per_unit UNION ALL
    SELECT 'DKK' AS currency, 0.153409009 AS usd_per_unit UNION ALL
    SELECT 'DOP' AS currency, 0.01679576564 AS usd_per_unit UNION ALL
    SELECT 'DZD' AS currency, 0.007411521351 AS usd_per_unit UNION ALL
    SELECT 'EGP' AS currency, 0.01918022381 AS usd_per_unit UNION ALL
    SELECT 'ERN' AS currency, 0.06666666667 AS usd_per_unit UNION ALL
    SELECT 'ETB' AS currency, 0.006182031233 AS usd_per_unit UNION ALL
    SELECT 'EUR' AS currency, 1.147722173 AS usd_per_unit UNION ALL
    SELECT 'FJD' AS currency, 0.447059644 AS usd_per_unit UNION ALL
    SELECT 'FKP' AS currency, 1.337431223 AS usd_per_unit UNION ALL
    SELECT 'FOK' AS currency, 0.1535132898 AS usd_per_unit UNION ALL
    SELECT 'GBP' AS currency, 1.337000279 AS usd_per_unit UNION ALL
    SELECT 'GEL' AS currency, 0.3818378083 AS usd_per_unit UNION ALL
    SELECT 'GGP' AS currency, 1.337431223 AS usd_per_unit UNION ALL
    SELECT 'GHS' AS currency, 0.0863696736 AS usd_per_unit UNION ALL
    SELECT 'GIP' AS currency, 1.337431223 AS usd_per_unit UNION ALL
    SELECT 'GMD' AS currency, 0.0133963232 AS usd_per_unit UNION ALL
    SELECT 'GNF' AS currency, 0.0001133204642 AS usd_per_unit UNION ALL
    SELECT 'GTQ' AS currency, 0.1298186408 AS usd_per_unit UNION ALL
    SELECT 'GYD' AS currency, 0.004734181575 AS usd_per_unit UNION ALL
    SELECT 'HKD' AS currency, 0.1274649491 AS usd_per_unit UNION ALL
    SELECT 'HNL' AS currency, 0.03691627297 AS usd_per_unit UNION ALL
    SELECT 'HRK' AS currency, 0.1523632608 AS usd_per_unit UNION ALL
    SELECT 'HTG' AS currency, 0.007605092665 AS usd_per_unit UNION ALL
    SELECT 'HUF' AS currency, 0.003152938722 AS usd_per_unit UNION ALL
    SELECT 'IDR' AS currency, 5.628144944e-05 AS usd_per_unit UNION ALL
    SELECT 'ILS' AS currency, 0.329607668 AS usd_per_unit UNION ALL
    SELECT 'IMP' AS currency, 1.337431223 AS usd_per_unit UNION ALL
    SELECT 'INR' AS currency, 0.01042315052 AS usd_per_unit UNION ALL
    SELECT 'IQD' AS currency, 0.0007561435409 AS usd_per_unit UNION ALL
    SELECT 'ISK' AS currency, 0.008228306543 AS usd_per_unit UNION ALL
    SELECT 'JEP' AS currency, 1.337431223 AS usd_per_unit UNION ALL
    SELECT 'JMD' AS currency, 0.00628656419 AS usd_per_unit UNION ALL
    SELECT 'JOD' AS currency, 1.410437236 AS usd_per_unit UNION ALL
    SELECT 'JPY' AS currency, 0.006363716228 AS usd_per_unit UNION ALL
    SELECT 'KES' AS currency, 0.007721105635 AS usd_per_unit UNION ALL
    SELECT 'KGS' AS currency, 0.01135805801 AS usd_per_unit UNION ALL
    SELECT 'KHR' AS currency, 0.000244661471 AS usd_per_unit UNION ALL
    SELECT 'KMF' AS currency, 0.002333447556 AS usd_per_unit UNION ALL
    SELECT 'KRW' AS currency, 0.0007211135335 AS usd_per_unit UNION ALL
    SELECT 'KWD' AS currency, 3.234068976 AS usd_per_unit UNION ALL
    SELECT 'KYD' AS currency, 1.20000048 AS usd_per_unit UNION ALL
    SELECT 'KZT' AS currency, 0.002238705332 AS usd_per_unit UNION ALL
    SELECT 'LAK' AS currency, 4.432836472e-05 AS usd_per_unit UNION ALL
    SELECT 'LBP' AS currency, 1.117318436e-05 AS usd_per_unit UNION ALL
    SELECT 'LKR' AS currency, 0.003018658546 AS usd_per_unit UNION ALL
    SELECT 'LRD' AS currency, 0.005714960276 AS usd_per_unit UNION ALL
    SELECT 'LSL' AS currency, 0.06148269957 AS usd_per_unit UNION ALL
    SELECT 'LYD' AS currency, 0.1559453948 AS usd_per_unit UNION ALL
    SELECT 'MAD' AS currency, 0.1053007447 AS usd_per_unit UNION ALL
    SELECT 'MDL' AS currency, 0.05688258519 AS usd_per_unit UNION ALL
    SELECT 'MGA' AS currency, 0.0002290454647 AS usd_per_unit UNION ALL
    SELECT 'MKD' AS currency, 0.01856238349 AS usd_per_unit UNION ALL
    SELECT 'MMK' AS currency, 0.0004718444469 AS usd_per_unit UNION ALL
    SELECT 'MNT' AS currency, 0.0002768945688 AS usd_per_unit UNION ALL
    SELECT 'MOP' AS currency, 0.1237683655 AS usd_per_unit UNION ALL
    SELECT 'MRU' AS currency, 0.02459525919 AS usd_per_unit UNION ALL
    SELECT 'MUR' AS currency, 0.0209675976 AS usd_per_unit UNION ALL
    SELECT 'MVR' AS currency, 0.06417163911 AS usd_per_unit UNION ALL
    SELECT 'MWK' AS currency, 0.0005711083676 AS usd_per_unit UNION ALL
    SELECT 'MXN' AS currency, 0.05809799819 AS usd_per_unit UNION ALL
    SELECT 'MYR' AS currency, 0.2450079628 AS usd_per_unit UNION ALL
    SELECT 'MZN' AS currency, 0.01559670295 AS usd_per_unit UNION ALL
    SELECT 'NAD' AS currency, 0.06148269957 AS usd_per_unit UNION ALL
    SELECT 'NGN' AS currency, 0.000748674066 AS usd_per_unit UNION ALL
    SELECT 'NIO' AS currency, 0.02693471521 AS usd_per_unit UNION ALL
    SELECT 'NOK' AS currency, 0.1061516584 AS usd_per_unit UNION ALL
    SELECT 'NPR' AS currency, 0.006513868423 AS usd_per_unit UNION ALL
    SELECT 'NZD' AS currency, 0.5716951447 AS usd_per_unit UNION ALL
    SELECT 'OMR' AS currency, 2.600800526 AS usd_per_unit UNION ALL
    SELECT 'PAB' AS currency, 1 AS usd_per_unit UNION ALL
    SELECT 'PEN' AS currency, 0.2958253424 AS usd_per_unit UNION ALL
    SELECT 'PGK' AS currency, 0.2195758936 AS usd_per_unit UNION ALL
    SELECT 'PHP' AS currency, 0.01591355477 AS usd_per_unit UNION ALL
    SELECT 'PKR' AS currency, 0.003588972597 AS usd_per_unit UNION ALL
    SELECT 'PLN' AS currency, 0.2630142059 AS usd_per_unit UNION ALL
    SELECT 'PYG' AS currency, 0.000167462764 AS usd_per_unit UNION ALL
    SELECT 'QAR' AS currency, 0.2747252747 AS usd_per_unit UNION ALL
    SELECT 'RON' AS currency, 0.2179824158 AS usd_per_unit UNION ALL
    SELECT 'RSD' AS currency, 0.009768217012 AS usd_per_unit UNION ALL
    SELECT 'RUB' AS currency, 0.01185862916 AS usd_per_unit UNION ALL
    SELECT 'RWF' AS currency, 0.0006749659973 AS usd_per_unit UNION ALL
    SELECT 'SAR' AS currency, 0.2666666667 AS usd_per_unit UNION ALL
    SELECT 'SBD' AS currency, 0.1249018116 AS usd_per_unit UNION ALL
    SELECT 'SCR' AS currency, 0.06889316991 AS usd_per_unit UNION ALL
    SELECT 'SDG' AS currency, 0.001688991221 AS usd_per_unit UNION ALL
    SELECT 'SEK' AS currency, 0.1016717479 AS usd_per_unit UNION ALL
    SELECT 'SGD' AS currency, 0.7833135416 AS usd_per_unit UNION ALL
    SELECT 'SHP' AS currency, 1.337431223 AS usd_per_unit UNION ALL
    SELECT 'SLE' AS currency, 0.04014654452 AS usd_per_unit UNION ALL
    SELECT 'SOS' AS currency, 0.001733062531 AS usd_per_unit UNION ALL
    SELECT 'SRD' AS currency, 0.02626491364 AS usd_per_unit UNION ALL
    SELECT 'SSP' AS currency, 0.0001761789721 AS usd_per_unit UNION ALL
    SELECT 'STN' AS currency, 0.04685636435 AS usd_per_unit UNION ALL
    SELECT 'SYP' AS currency, 0.008124645979 AS usd_per_unit UNION ALL
    SELECT 'SZL' AS currency, 0.06148269957 AS usd_per_unit UNION ALL
    SELECT 'THB' AS currency, 0.02997947365 AS usd_per_unit UNION ALL
    SELECT 'TJS' AS currency, 0.107584179 AS usd_per_unit UNION ALL
    SELECT 'TMT' AS currency, 0.2831644305 AS usd_per_unit UNION ALL
    SELECT 'TND' AS currency, 0.3405628005 AS usd_per_unit UNION ALL
    SELECT 'TOP' AS currency, 0.4175271205 AS usd_per_unit UNION ALL
    SELECT 'TRY' AS currency, 0.02049022368 AS usd_per_unit UNION ALL
    SELECT 'TTD' AS currency, 0.1463989304 AS usd_per_unit UNION ALL
    SELECT 'TWD' AS currency, 0.03141032418 AS usd_per_unit UNION ALL
    SELECT 'TZS' AS currency, 0.0003760366942 AS usd_per_unit UNION ALL
    SELECT 'UAH' AS currency, 0.02237328715 AS usd_per_unit UNION ALL
    SELECT 'UGX' AS currency, 0.0002564714877 AS usd_per_unit UNION ALL
    SELECT 'USD' AS currency, 1 AS usd_per_unit UNION ALL
    SELECT 'UYU' AS currency, 0.02462802326 AS usd_per_unit UNION ALL
    SELECT 'UZS' AS currency, 8.414762318e-05 AS usd_per_unit UNION ALL
    SELECT 'VES' AS currency, 0.001177074358 AS usd_per_unit UNION ALL
    SELECT 'VND' AS currency, 3.827367578e-05 AS usd_per_unit UNION ALL
    SELECT 'VUV' AS currency, 0.008477589983 AS usd_per_unit UNION ALL
    SELECT 'WST' AS currency, 0.3654074604 AS usd_per_unit UNION ALL
    SELECT 'XAF' AS currency, 0.001750085667 AS usd_per_unit UNION ALL
    SELECT 'XCD' AS currency, 0.3703703704 AS usd_per_unit UNION ALL
    SELECT 'XCG' AS currency, 0.5586592179 AS usd_per_unit UNION ALL
    SELECT 'XOF' AS currency, 0.001750085667 AS usd_per_unit UNION ALL
    SELECT 'XPF' AS currency, 0.009620059502 AS usd_per_unit UNION ALL
    SELECT 'YER' AS currency, 0.004188513429 AS usd_per_unit UNION ALL
    SELECT 'ZAR' AS currency, 0.0614732885 AS usd_per_unit UNION ALL
    SELECT 'ZMW' AS currency, 0.0506854292 AS usd_per_unit UNION ALL
    SELECT 'ZWG' AS currency, 0.03752655003 AS usd_per_unit UNION ALL
    SELECT 'ZWL' AS currency, 0.03752655003 AS usd_per_unit
    )
),
merchant_master AS (
    -- The population the published active series is drawn from: real merchants, bots out.
    SELECT LOYVERSE_ID, UPPER(TRIM(COUNTRY)) AS COUNTRY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
      AND COUNTRY IS NOT NULL AND COUNTRY <> ''
      AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM bot_accounts)   -- [bot-filter]
),
-- The only pass over the big table.
--
-- AGGREGATE FIRST, JOIN THE BIG TABLE AFTER. Joining merchant_master inside this scan makes
-- Snowflake shuffle billions of receipt rows against 5M merchants before anything reduces:
-- measured at 53 minutes without finishing usefully, against 12.6 for collapsing to
-- merchant-month first and filtering that. fx_rates is different — 160 rows, broadcast, so
-- it can live inside the scan, which it must, because the $10k cap is per RECEIPT and needs
-- the rate to know what $10k is in local money.
--
-- DATES COMPARED AS TEXT. RECEIPT_DATE is TEXT holding ISO-8601 with a Z suffix
-- ("2026-05-06T06:25:05.000Z"), which sorts in date order, and its first seven characters
-- ARE the calendar month. So the filter is a string range and the bucketing a substring
-- rather than TRY_TO_TIMESTAMP on 9.6 billion rows. Nothing prunes either way; what this
-- saves is the parsing.
receipts_per_merchant_month AS (
    SELECT r.MERCHANT_ID,
           LEFT(r.RECEIPT_DATE, 7)                            AS CALENDAR_MONTH,
           COUNT(*)                                           AS N_RECEIPTS,
           SUM(LEAST(r.TOTAL_MONEY * fx.usd_per_unit, 10000)) AS GTV_USD,
           SUM(r.TOTAL_MONEY * fx.usd_per_unit)               AS GTV_USD_UNCAPPED,
           COUNT_IF(fx.usd_per_unit IS NULL)                  AS RECEIPTS_NO_RATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE r
    LEFT JOIN fx_rates fx ON fx.currency = UPPER(TRIM(r.CURRENCY))
    WHERE r.TOTAL_MONEY IS NOT NULL AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
      -- Device-clock rows. Loyverse tills stamp receipts from the device and a handful carry
      -- dates centuries out (one reads 2152-01-02), so the window is bounded at both ends.
      -- The upper bound is the FIRST DAY OF NEXT MONTH, not a month from today:
      -- today-plus-a-month let rows dated early next month create a phantom trailing bar.
      AND r.RECEIPT_DATE >= '2021-01-01'
      AND r.RECEIPT_DATE <  TO_VARCHAR(DATE_TRUNC('MONTH', DATEADD('month', 1, CURRENT_DATE())), 'YYYY-MM-DD')
    GROUP BY 1, 2
)
SELECT m.COUNTRY                                        AS COUNTRY,
       mm.CALENDAR_MONTH                                AS MONTH,
       COUNT(*)                                         AS ACTIVE_1,
       COUNT_IF(mm.N_RECEIPTS >= 5)                     AS ACTIVE_5,
       COUNT_IF(mm.N_RECEIPTS >= 10)                    AS ACTIVE_10,
       ROUND(SUM(COALESCE(mm.GTV_USD, 0)), 2)           AS GTV_USD,
       ROUND(SUM(COALESCE(mm.GTV_USD_UNCAPPED, 0)), 2)  AS GTV_USD_UNCAPPED,
       SUM(mm.N_RECEIPTS)                               AS RECEIPTS,
       SUM(mm.RECEIPTS_NO_RATE)                         AS RECEIPTS_NO_RATE
FROM receipts_per_merchant_month mm
JOIN merchant_master m ON m.LOYVERSE_ID = mm.MERCHANT_ID
GROUP BY 1, 2
ORDER BY 2, 6 DESC;
