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
        -- RECONCILED 2026-10-12. This used to be written two different ways: a correlated
        -- NOT EXISTS in kpi-automation/*, and a MINUS in activated-payments/*, because the
        -- correlated form would not compile where the CTE is referenced from several derived
        -- tables. Both are now replaced by a single uncorrelated pre/post split, which
        -- returns exactly the same 4,594 rows as either predecessor (verified 2026-10-12)
        -- and compiles everywhere, so this block is byte-identical across all 14 files.
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        JOIN (
            SELECT NORM_NAME
            FROM (
                SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM_NAME,
                       COUNT_IF(CREATED_AT >= '2026-03-01') AS N_POST,
                       COUNT_IF(CREATED_AT <  '2026-03-01') AS N_PRE
                FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
                WHERE UPPER(TRIM(COUNTRY)) = 'US'
                  AND BUSINESS_NAME IS NOT NULL
                  AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
                GROUP BY 1
            )
            WHERE N_POST >= 3
              AND N_PRE  = 0
        ) c
          ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
        WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
          AND m.LOYVERSE_ID IS NOT NULL
          AND m.CREATED_AT >= '2026-03-01'
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
        UNION
        -- G4: HOMOGLYPH brand evasion (added 2026-10-12).
        -- S2b only normalises DIGIT-for-letter substitution ('P0shmark'). It cannot see
        -- LETTER-for-letter homoglyphs, so 'Vlnted' (lowercase L for i) passed every rule:
        -- TRANSLATE leaves it as 'vlnted', which never matches '.*vinted.*', and S2b's
        -- "name changed under normalisation" guard is false for an all-letter swap, so the
        -- rule short-circuits before the brand test. Three accounts evaded this way --
        -- 'Vlnted' US 2026-10-12, 'Vlnted' SE and 'VlNTED' AL, both 2026-09-13.
        -- The second factor here is structural rather than statistical: the brand name must
        -- appear ONLY AFTER homoglyph folding. If the plain leet normalisation already
        -- contains the brand, this rule stands down and leaves the account to S2/S2b/G3.
        -- That is what keeps genuine resellers -- 'Vinted Lumpeks', 'vinted laia',
        -- 'VINTED BOUTIQUE S.R.L.', 'Vinted louisehuart' -- out of it; without that clause
        -- the l->i fold alone flagged all four (verified 2026-10-12).
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        WHERE m.BUSINESS_NAME IS NOT NULL
          AND REGEXP_LIKE(
                  REPLACE(REPLACE(TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@l', 'oieasai'),
                          'rn', 'm'), 'vv', 'w'),
                  '(poshmark|vinted|depop|etsy|mercari)([[:space:]_#:.-].*)?')
          AND NOT REGEXP_LIKE(TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa'),
                  '.*(poshmark|vinted|depop|etsy|mercari).*')
    ),
    -- ----------------------------------------------------------------
    -- NAME-SHAPE BURST FILTER (N1, added 2026-10-12)
    --
    -- Why this exists. One operator has now run four waves and beaten a rule generation
    -- each time by varying ONE attribute of the business name:
    --     30-31 Jul 2026   8,001 accounts  'Sale#<hex>'          -> caught by S1
    --     10-16 Sep 2026   1,834 accounts  'Sale#<hex>'          -> caught by S1
    --        8 Oct 2026       78 accounts  '1209534143' repeated -> caught by S7/S8
    --     8-12 Oct 2026      819 accounts  unique 8-digit names  -> caught by NOTHING
    -- The fourth wave gave every account a DISTINCT name, which kills every cluster rule
    -- (S7, S8, G2 all need a repeated name), and used human-plausible persona mailboxes
    -- (michellejohnsonw795@gmail.com), which kills random_local -- only 10.6% of the 819
    -- match it. All nine per-account rules fire on 0 of 819 (verified 2026-10-12).
    --
    -- So this rule is deliberately NOT keyed to "8 digits". It keys on the SHAPE of the
    -- name -- digits folded to '9', lowercase to 'a', uppercase to 'A', length preserved --
    -- and asks whether a shape that is NEW for a country suddenly arrives in bulk. That
    -- survives a switch to 9 digits, to 12 digits, or to random letters, because any of
    -- those is simply a different novel shape.
    --
    -- Four conditions, and the second factor is mandatory as always:
    --   1. >= 20 accounts sharing (country, calendar day, name shape)
    --   2. that shape is genuinely new for that country: <= 10 accounts in the 180 days
    --      ending SEVEN DAYS BEFORE the burst. The seven-day lag is not cosmetic -- without
    --      it a multi-day wave feeds its own baseline and the rule never fires at all. The
    --      first draft used a simple prior-day-count ratio and caught 0 of 819.
    --   3. >= 90% of the burst on a dotless local part at a freemail domain. This is a
    --      SECOND factor confirming an already-suspicious set, never a selector -- mailbox
    --      shape alone had a 47% false-positive rate (July 2026).
    --   4. the shape is one unbroken machine-drawn token (no spaces, no punctuation).
    --
    -- WHAT THIS RULE DOES NOT CATCH, stated plainly:
    --   * A shape that already has history in that country. Eight-letter capitalised words
    --     ('Aaaaaaaa') have a real baseline everywhere, so condition 2 blocks them. This is
    --     the obvious next move for the operator and this rule will not see it.
    --   * Anything below 20 in a country-day. The 819th account of this very wave registered
    --     alone at 23:58 on 8 Oct and is correctly NOT flagged; recall is 818/819.
    --   * A wave spread thinly across many countries, or across a day at 19/country.
    --   * Mailboxes with dots inserted, or spread across non-freemail domains.
    -- The daily bot-screen alert exists because of these holes, not in spite of them.
    --
    -- FP sweep over all history (2026-10-12): 1,067 flagged, 249 already caught by the
    -- rules above, 818 incremental. Of all 1,067: 0 with >= 7 active receipt days, 0 with
    -- >= 30, 0 Chargebee customers, 0 rows from the real-merchant FP query. The only
    -- pre-October groups it fires on are known bot clusters -- 'P0SHMARK' (86, 10 Apr) and
    -- 'PoshmarkSupp' (59, 5 Jun).
    -- ----------------------------------------------------------------
    shape_daily AS (
        SELECT UPPER(TRIM(COUNTRY)) AS C,
               REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
                   TRIM(BUSINESS_NAME), '[0-9]', '9'), '[a-z]', 'a'), '[A-Z]', 'A') AS SHAPE,
               DATE(CREATED_AT) AS D,
               DATEDIFF(day, DATE '2020-01-01', DATE(CREATED_AT)) AS DN,
               COUNT(*) AS N,
               -- dotless local part on a freemail domain = the mandatory second factor
               COUNT_IF(NOT CONTAINS(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '.')
                        AND SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 2) IN
                            ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
                             'mail.com', 'icloud.com', 'aol.com', 'proton.me',
                             'protonmail.com', 'gmx.com', 'yandex.com')) AS N_DF
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE BUSINESS_NAME IS NOT NULL
          AND COUNTRY IS NOT NULL
          AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
        GROUP BY 1, 2, 3, 4
    ),
    shape_bursts AS (
        -- Window function over the aggregate, not a correlated subquery -- those time out
        -- on LOYVERSE_MERCHANTS (>2 min). RANGE is value-based on the day number, so days
        -- with no activity are handled without needing a dense calendar.
        --
        -- v4 (2026-11-10) -- THE BASELINE NO LONGER POISONS ITSELF.
        -- v3 asked whether the shape had <= 10 accounts in the 180 days ending a week
        -- before the burst, reading LOYVERSE_MERCHANTS raw. That counted the accounts
        -- THIS RULE HAD ALREADY FLAGGED. So the 819-account wave of 8-12 Oct made shape
        -- '99999999' an established US shape, and every later burst of the identical
        -- shape walked through untouched: 25 Oct 89, 29 Oct 156, 4 Nov 197, 7 Nov 297 --
        -- 1,008 accounts, caught by nothing. Canada shows the same decay inside 72
        -- hours: 324/361 excluded on 21 Oct, 66/76 on the 22nd, 0/23 on the 23rd.
        -- Catching a wave bought the operator 180 days of blindness to the shape he had
        -- just finished using.
        --
        -- Two changes. First, a day that was ITSELF burst-shaped contributes nothing to
        -- the baseline (N_BASE). That is self-contained: it re-applies the burst test to
        -- history rather than referencing this CTE's own output, which SQL cannot do.
        -- Second, the absolute "<= 10 ever" floor becomes a RATIO against the non-burst
        -- daily mean, so a low-volume drip cannot manufacture a baseline either --
        -- holding three accounts a day for six months would have re-armed the v3 floor.
        -- Genuinely common shapes stay protected: 'Aaaaaaaa' running 40/day would need a
        -- 400-account day to trip this, which is not a shape a real country produces.
        SELECT C, SHAPE, D, N
        FROM (
            SELECT C, SHAPE, D, DN, N, N_DF,
                   COALESCE(SUM(N_BASE) OVER (PARTITION BY C, SHAPE ORDER BY DN
                       RANGE BETWEEN 187 PRECEDING AND 7 PRECEDING), 0) AS BASE_180
            FROM (
                SELECT C, SHAPE, D, DN, N, N_DF,
                       IFF(N >= 20 AND N_DF >= 0.90 * N, 0, N) AS N_BASE
                FROM shape_daily
            )
        )
        WHERE N >= 20
          AND D >= '2026-03-01'
          AND (BASE_180 <= 10 OR N >= 10 * BASE_180 / 180.0)
          AND N_DF >= 0.90 * N
          AND REGEXP_LIKE(SHAPE, '[9aA]+')
    ),
    shape_bot_accounts AS (
        SELECT m.LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
        JOIN shape_bursts b
          ON UPPER(TRIM(m.COUNTRY)) = b.C
         AND REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
                 TRIM(m.BUSINESS_NAME), '[0-9]', '9'), '[a-z]', 'a'), '[A-Z]', 'A') = b.SHAPE
         AND DATE(m.CREATED_AT) = b.D
    ),
    -- ----------------------------------------------------------------
    -- BEHAVIOURAL FILTER (B1, B2) -- added 2026-11-10
    --
    -- Every rule above this line reads five columns of one table: BUSINESS_NAME, EMAIL,
    -- COUNTRY, CREATED_AT, LOYVERSE_ID. Not one of them can see a receipt. That is why
    -- account '92200603' -- registered 29 Oct, 1,863 receipts inside eleven days, one
    -- every nine minutes around the clock, median ticket exactly $35.00 -- was judged
    -- once, on the characters of its name, and never looked at again. The evidence that
    -- it was not a shop sat in LOYVERSE_RECEIPTS, and the shield had never opened that
    -- table.
    --
    -- The scope floor is a FIXED date, not a rolling window, on purpose: a flag once
    -- earned must be permanent, or published history silently un-flags itself as a wave
    -- ages out. Move the floor back only behind a historical sweep.
    behaviour_scope AS (
        SELECT LOYVERSE_ID,
               UPPER(TRIM(COUNTRY)) AS C,
               DATE(CREATED_AT)     AS SIGNUP_DAY
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE LOYVERSE_ID IS NOT NULL
          AND COUNTRY IS NOT NULL
          AND CREATED_AT >= '2026-10-01'
    ),
    dotless_freemail AS (
        -- The mandatory second factor for both behavioural rules, and the same test N1
        -- already uses. Mailbox shape NEVER selects on its own -- 47% false-positive
        -- rate, July 2026 -- it only confirms a set already suspicious for other reasons.
        SELECT LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE EMAIL IS NOT NULL
          AND NOT CONTAINS(SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 1), '.')
          AND SPLIT_PART(LOWER(TRIM(EMAIL)), '@', 2) IN
              ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'mail.com',
               'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
               'yandex.com')
    ),
    behaviour_receipts AS (
        -- Bounded scan. LOYVERSE_RECEIPTS is ~8.76bn rows, so this joins to the scope
        -- first and prunes on RECEIPT_DATE, which is the partition key and a VARCHAR --
        -- compared as text exactly the way the GTV queries already do it. Cleaning rules
        -- are the canonical ones: no refunds, no cancellations, no zero rows.
        SELECT r.MERCHANT_ID                                   AS LOYVERSE_ID,
               COUNT(*)                                        AS N_RECEIPTS,
               ROUND(APPROX_PERCENTILE(r.TOTAL_MONEY, 0.5), 2) AS MED_TICKET
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
        JOIN behaviour_scope s
          ON s.LOYVERSE_ID = r.MERCHANT_ID
        WHERE r.RECEIPT_DATE >= '2026-10-01'
          AND r.TOTAL_MONEY > 0
          AND r.CANCELLED_AT IS NULL
          AND r.REFUND_FOR IS NULL
        GROUP BY 1
    ),
    behaviour_facts AS (
        SELECT s.LOYVERSE_ID,
               s.C,
               s.SIGNUP_DAY,
               COALESCE(b.N_RECEIPTS, 0) AS N_RECEIPTS,
               b.MED_TICKET,
               GREATEST(DATEDIFF(day, s.SIGNUP_DAY, CURRENT_DATE()), 1) AS TENURE_DAYS,
               COALESCE(b.N_RECEIPTS, 0)
                   / GREATEST(DATEDIFF(day, s.SIGNUP_DAY, CURRENT_DATE()), 1)
                                         AS RECEIPTS_PER_DAY
        FROM behaviour_scope s
        LEFT JOIN behaviour_receipts b
          ON b.LOYVERSE_ID = s.LOYVERSE_ID
    ),
    day_counts AS (
        SELECT UPPER(TRIM(COUNTRY)) AS C,
               DATE(CREATED_AT)     AS D,
               DATEDIFF(day, DATE '2020-01-01', DATE(CREATED_AT)) AS DN,
               COUNT(*)             AS N
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE COUNTRY IS NOT NULL
          AND CREATED_AT >= '2026-06-01'
        GROUP BY 1, 2, 3
    ),
    anomalous_days AS (
        -- A country-day whose registration count is at least double the trailing median,
        -- on a window that stops seven days short so a running wave cannot lift its own
        -- baseline. Same shape of test the daily bot screen uses; it lives in here so B1
        -- can require that an account ARRIVED INSIDE A BURST. Without that condition a
        -- single genuine high-frequency merchant trips B1 on its own.
        --
        -- Written as a self-join, not a window: Snowflake rejects a sliding frame on
        -- MEDIAN outright ("Sliding window frame unsupported for function MEDIAN"), which
        -- is what failed the first compile. day_counts is one row per country-day since
        -- June, so joining it to itself is cheap. A mean would have compiled, but a prior
        -- burst drags a mean upward and this test exists precisely to survive prior bursts.
        SELECT d.C, d.D
        FROM day_counts d
        JOIN day_counts b
          ON b.C = d.C
         AND b.DN BETWEEN d.DN - 35 AND d.DN - 7
        WHERE d.D >= '2026-10-01'
          AND d.N >= 20
        GROUP BY d.C, d.D, d.N
        HAVING d.N >= 2.0 * MEDIAN(b.N)
    ),
    velocity_bot_accounts AS (
        -- B1: a new account trading at a rate no new merchant reaches, inside a day that
        -- is itself a burst, on a machine-shaped mailbox. Forty receipts a day sustained
        -- from a standing start is one every 36 minutes without a break; the observed
        -- wave runs at 140-170 and peaks at 170 (account 44650299, 2,037 receipts in
        -- twelve days). Three independent conditions deliberately: velocity alone
        -- flagged eight accounts in the local sweep that look like real high-frequency
        -- merchants, and requiring the burst day cut that to two.
        SELECT f.LOYVERSE_ID
        FROM behaviour_facts f
        JOIN anomalous_days a
          ON a.C = f.C AND a.D = f.SIGNUP_DAY
        WHERE f.TENURE_DAYS <= 45
          AND f.N_RECEIPTS >= 200
          AND f.RECEIPTS_PER_DAY >= 40
          AND f.LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM dotless_freemail)
    ),
    ticket_day AS (
        SELECT C, SIGNUP_DAY, COUNT(*) AS N_ACTIVE
        FROM behaviour_facts
        WHERE N_RECEIPTS >= 5
          AND MED_TICKET IS NOT NULL
        GROUP BY 1, 2
    ),
    ticket_mode AS (
        SELECT C, SIGNUP_DAY, MED_TICKET, COUNT(*) AS N_AT_TICKET
        FROM behaviour_facts
        WHERE N_RECEIPTS >= 5
          AND MED_TICKET IS NOT NULL
          AND MED_TICKET = ROUND(MED_TICKET, 0)
        GROUP BY 1, 2, 3
    ),
    ticket_bot_accounts AS (
        -- B2: cohort ticket degeneracy. A generator draws one price and every account it
        -- creates uses it. Of the 123 US accounts from 29 Oct that transacted, 54 had a
        -- median ticket of exactly $30.00 and 34 exactly $35.00 -- 72% of the cohort on
        -- two values. Organic merchants of the same tenure land on a whole dollar 64% of
        -- the time and spread over hundreds of values.
        --
        -- This is the rule that matters most. It needs no name at all, and it is the
        -- hardest of the three signals for the operator to vary: randomising the ticket
        -- per account means giving up the uniform, plausible price band that gets the
        -- fake volume past the GTV quality checks in the first place. 611 of the 639
        -- active wave accounts are flagged 'Clean' by those checks today.
        --
        -- Local sweep over the US base, 1 Oct - 10 Nov, at these thresholds: 212
        -- signature accounts flagged, ZERO non-signature accounts flagged.
        SELECT f.LOYVERSE_ID
        FROM behaviour_facts f
        JOIN ticket_mode m
          ON m.C = f.C AND m.SIGNUP_DAY = f.SIGNUP_DAY AND m.MED_TICKET = f.MED_TICKET
        JOIN ticket_day d
          ON d.C = f.C AND d.SIGNUP_DAY = f.SIGNUP_DAY
        WHERE d.N_ACTIVE >= 20
          AND m.N_AT_TICKET >= 10
          AND m.N_AT_TICKET >= 0.20 * d.N_ACTIVE
          AND f.LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM dotless_freemail)
    ),
    -- ----------------------------------------------------------------
    -- REAL-MERCHANT GUARD (P0) -- added 2026-11-10
    --
    -- Nothing below is ever excluded, whatever any rule above concludes. This exists
    -- because the 13 Oct deployment removed both accounts of 'La New Poblanita Car
    -- Service' -- one an active Chargebee subscriber with $188,713 of trailing
    -- twelve-month GTV and receipts as recent as the day it was removed -- as collateral
    -- of S7's "three accounts sharing a name" cluster test. That merchant has been
    -- missing from every dashboard since. Any rule can misfire; this is the floor that
    -- bounds what a misfire costs.
    --
    -- Both tests are chosen so the Oct/Nov wave cannot hide behind them: those accounts
    -- are days old, have never held a subscription, and compress their volume into one
    -- short burst, so neither test reaches them.
    protected_accounts AS (
        -- Anyone who has ever held a Chargebee subscription row.
        SELECT LOYVERSE_MERCHANT_ID AS LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V
        WHERE LOYVERSE_MERCHANT_ID IS NOT NULL
        UNION
        -- Anyone with a sustained trading history: receipts in three or more distinct
        -- calendar months. Read off the monthly aggregate, not the 8.76bn-row table.
        SELECT LOYVERSE_MERCHANT_ID AS LOYVERSE_ID
        FROM LOYVERSE_DATA_LAKE.PUBLIC.SALES_PER_ACCOUNT_MONTHLY
        WHERE LOYVERSE_MERCHANT_ID IS NOT NULL
          AND COALESCE(TOTAL_SALES_COUNT, 0) > 0
        GROUP BY 1
        HAVING COUNT(DISTINCT MONTH) >= 3
    ),
    bot_accounts AS (
        -- Single exclusion set consumed by the query below: the US-scoped signatures,
        -- the country-agnostic ones, the name-shape bursts and the two behavioural
        -- rules, MINUS anything the real-merchant guard protects. Every reference site
        -- uses this, never one part of it. The EXCEPT comes last on purpose -- the guard
        -- overrides every rule above it, including rules added after this comment.
        SELECT LOYVERSE_ID FROM (
            SELECT LOYVERSE_ID FROM us_bot_accounts
            UNION
            SELECT LOYVERSE_ID FROM global_bot_accounts
            UNION
            SELECT LOYVERSE_ID FROM shape_bot_accounts
            UNION
            SELECT LOYVERSE_ID FROM velocity_bot_accounts
            UNION
            SELECT LOYVERSE_ID FROM ticket_bot_accounts
        )
        EXCEPT
        SELECT LOYVERSE_ID FROM protected_accounts
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
