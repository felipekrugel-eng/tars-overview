-- =================================================================
-- RECEIPTS / TPV COHORT x COUNTRY x MONTH — DAILY "AS-OF", OPTIMIZED v2
-- READ-ONLY single statement (no CREATE — works with DATA_VIEWER)
-- =================================================================
-- v2 change vs v1: the three ROW_NUMBER window passes were 70% of the
-- runtime and were spilling to remote disk. They're replaced by ONE
-- GROUP BY GROUPING SETS pass (hash aggregation, no sorts), which
-- produces the daily additive totals AND each entity's first-appearance
-- day in a single pass over the one table scan.
--
-- Pipeline (LOYVERSE_RECEIPTS_UNIQUE is scanned exactly once, in rsrc):
--    rsrc -> flagged -> agg (grouping sets) -> events -> metrics -> final
--
-- AS-OF MODEL: a sale is visible from RECEIPT_DATE (<= snapshot);
--   cancellation/refund use current status (matches your original),
--   keeping "active" monotonic so cumulative counts are EXACT.
--
-- TESTING: the scan cost is independent of the snapshot range. To
--   validate cheaply, uncomment the date floor in rsrc (limits the scan
--   to 2026), confirm output, then re-comment for the full run.
-- =================================================================

WITH -- ----------------------------------------------------------------
    -- US BOT/FAKE-ACCOUNT FILTER (added 2026-07-21)
    -- Excludes the US registration bot campaign quantified in the July 2026
    -- fraud investigation (Mem note 08de7ff9 / July_2026_US_bot_fraud_full_report.xlsx).
    -- Signature-based on BUSINESS_NAME, US rows only, applied ALL-TIME.
    -- Deliberately does NOT use email randomness (47% false-positive rate).
    --
    -- Keep this block BYTE-IDENTICAL across all 14 reference files. It genuinely is, as of
    -- 2026-10-12: the previous "local divergence" in activated-payments/* (a MINUS form of
    -- S7, needed because the correlated NOT EXISTS would not compile there) is gone, because
    -- S7 no longer uses a correlated subquery at all. See the note on S7 below.
    -- Verify with: python3 bot-filter/verify_cte.py
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
snapshots AS (
    SELECT DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 70))
    WHERE DATEADD('day', SEQ4(), DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())))::DATE <= CURRENT_DATE()
),
account_meta AS (
    SELECT LOYVERSE_ID,
           UPPER(TRIM(COUNTRY))                 AS COUNTRY,
           COALESCE(CURRENCY_DECIMAL_PLACES, 2) AS DECIMAL_PLACES,
           MIN(DATE_TRUNC('MONTH', CREATED_AT)::DATE)
               OVER (PARTITION BY LOWER(TRIM(EMAIL))) AS COHORT_MONTH
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
      AND COUNTRY IS NOT NULL AND COUNTRY <> ''
      AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM bot_accounts)   -- [bot-filter]
),
-- ===== the ONLY pass over the big table =====
rsrc AS (
    SELECT MERCHANT_ID, TOTAL_MONEY,
           UPPER(TRIM(CURRENCY))            AS RECEIPT_CURRENCY,
           TRY_TO_TIMESTAMP(RECEIPT_DATE)   AS RECEIPT_TS    -- parsed ONCE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
    WHERE TOTAL_MONEY IS NOT NULL AND TOTAL_MONEY > 0
      AND CANCELLED_AT IS NULL
      AND REFUND_FOR IS NULL
      AND UPPER(COALESCE(RECEIPT_TYPE, 'SALE')) <> 'REFUND'
      -- TEST ONLY: uncomment to validate cheaply on recent data, then re-comment
      -- AND TRY_TO_TIMESTAMP(RECEIPT_DATE) >= DATE '2026-01-01'
),
flagged AS (
    SELECT
        mm.COHORT_MONTH,
        mm.COUNTRY,
        DATE_TRUNC('MONTH', r.RECEIPT_TS)::DATE AS CALENDAR_MONTH,
        r.RECEIPT_TS::DATE                      AS VIS_DATE,
        r.MERCHANT_ID,
        (r.TOTAL_MONEY / POWER(10, COALESCE(mm.DECIMAL_PLACES, 2))) *
            CASE r.RECEIPT_CURRENCY
                WHEN 'USD' THEN 1.0      WHEN 'EUR' THEN 1.16
                WHEN 'GBP' THEN 1.34     WHEN 'CAD' THEN 0.74
                WHEN 'AUD' THEN 0.66     WHEN 'NZD' THEN 0.60
                WHEN 'CHF' THEN 1.12     WHEN 'JPY' THEN 0.0066
                WHEN 'KRW' THEN 0.00072  WHEN 'CNY' THEN 0.14
                WHEN 'HKD' THEN 0.128    WHEN 'SGD' THEN 0.74
                WHEN 'INR' THEN 0.012    WHEN 'IDR' THEN 0.000063
                WHEN 'PHP' THEN 0.018    WHEN 'MYR' THEN 0.21
                WHEN 'THB' THEN 0.028    WHEN 'VND' THEN 0.000040
                WHEN 'BRL' THEN 0.17     WHEN 'MXN' THEN 0.058
                WHEN 'ARS' THEN 0.00081  WHEN 'CLP' THEN 0.0010
                WHEN 'COP' THEN 0.00023  WHEN 'PEN' THEN 0.27
                WHEN 'ZAR' THEN 0.054    WHEN 'AED' THEN 0.27
                WHEN 'SAR' THEN 0.27     WHEN 'TRY' THEN 0.029
                WHEN 'PLN' THEN 0.25     WHEN 'SEK' THEN 0.094
                WHEN 'NOK' THEN 0.093    WHEN 'DKK' THEN 0.15
                ELSE NULL
            END AS AMOUNT_USD
    FROM rsrc r
    JOIN account_meta mm ON mm.LOYVERSE_ID = r.MERCHANT_ID
    WHERE r.RECEIPT_TS IS NOT NULL
      AND r.RECEIPT_TS::DATE <= CURRENT_DATE()
),
-- ONE hash-aggregation pass, TWO grains at once (no window sorts):
--   GID = GROUPING_ID(VIS_DATE, MERCHANT_ID)
--     1 -> per (bucket, VIS_DATE)   : daily receipts + TPV
--     2 -> per (bucket, MERCHANT_ID): merchant's first day = MIN(VIS_DATE)
-- The STORE_ID / EMPLOYEE_ID grains (ACTIVE_STORES / ACTIVE_EMPLOYEES) were
-- removed: nothing downstream (run.py, build_kpi_data.py, backfill_daily.py)
-- consumes them, yet they DOUBLED this GROUPING SETS pass — which the live
-- query profile showed was 72.6% of total runtime. Halving the grains is the
-- single biggest win, with zero change to any dashboard number.
agg AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        MERCHANT_ID,
        GROUPING_ID(VIS_DATE, MERCHANT_ID) AS GID,
        MIN(VIS_DATE)   AS DAY,        -- = VIS_DATE for set 1; first-appearance for merchant set
        COUNT(*)        AS CNT,
        SUM(AMOUNT_USD) AS AMT
    FROM flagged
    GROUP BY GROUPING SETS (
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, VIS_DATE),
        (COHORT_MONTH, COUNTRY, CALENDAR_MONTH, MERCHANT_ID)
    )
),
-- Normalize every grain to one event stream, clamping pre-window days to May 1.
events AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH,
        CASE WHEN DAY < DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) THEN DATE_TRUNC('MONTH', DATEADD('month', -1, CURRENT_DATE())) ELSE DAY END AS EFF_DAY,
        CASE WHEN GID = 1 THEN CNT ELSE 0 END                            AS INCR_RECEIPTS,
        CASE WHEN GID = 1 THEN AMT ELSE 0 END                            AS INCR_TPV_USD,
        CASE WHEN GID = 2 AND MERCHANT_ID IS NOT NULL THEN 1 ELSE 0 END  AS NEW_MERCHANTS
    FROM agg
),
-- Collapse the per-ENTITY event stream down to per-bucket DAILY increments
-- BEFORE fanning out across snapshots. THIS IS THE TIMEOUT FIX: previously the
-- snapshot range-join saw one row per (bucket, merchant) + (bucket, store) +
-- (bucket, employee) and multiplied each by up to ~54 snapshot dates — hundreds
-- of millions of intermediate rows. Now it sees only (bucket, EFF_DAY) rows
-- (≤ ~54 days per bucket), so the fan-out shrinks by orders of magnitude.
-- SUM is associative, so the result is byte-identical to the old query.
daily_incr AS (
    SELECT
        COHORT_MONTH, COUNTRY, CALENDAR_MONTH, EFF_DAY,
        SUM(INCR_RECEIPTS) AS D_RECEIPTS,
        SUM(INCR_TPV_USD)  AS D_TPV_USD,
        SUM(NEW_MERCHANTS) AS D_MERCHANTS
    FROM events
    GROUP BY COHORT_MONTH, COUNTRY, CALENDAR_MONTH, EFF_DAY
),
-- Cumulative (exact) state per bucket per snapshot.
-- PRUNED FAN-OUT: nothing downstream consumes the full historical triangle for
-- every snapshot. run.py only reads (a) the LATEST snapshot's full grid
-- [receipts.csv + "TPV and Receipts DB2"] and (b) for EVERY snapshot, only the
-- rows whose CALENDAR_MONTH is the snapshot's own month [the "49 days 1"
-- current-month slice]. Every other (snapshot, bucket) pair is computed,
-- transferred, then discarded. We therefore keep ONLY those two slices in the
-- snapshot join condition. This prunes the range-join fan-out (the slow step)
-- by ~an order of magnitude. The cumulative SUM for each SURVIVING (snapshot,
-- bucket) pair is unchanged — all of that bucket's daily increments with
-- EFF_DAY <= SNAPSHOT_DATE still contribute — so output is byte-identical to
-- what downstream would have used.
metrics AS (
    SELECT
        s.SNAPSHOT_DATE,
        d.COHORT_MONTH, d.COUNTRY, d.CALENDAR_MONTH,
        SUM(d.D_RECEIPTS)  AS RECEIPT_COUNT,
        SUM(d.D_TPV_USD)   AS TPV_USD_APPROX,
        SUM(d.D_MERCHANTS) AS ACTIVE_MERCHANTS
    FROM daily_incr d
    JOIN snapshots s
      ON d.EFF_DAY <= s.SNAPSHOT_DATE
     AND (
            s.SNAPSHOT_DATE = (SELECT MAX(SNAPSHOT_DATE) FROM snapshots)
         OR DATE_TRUNC('MONTH', d.CALENDAR_MONTH) = DATE_TRUNC('MONTH', s.SNAPSHOT_DATE)
         )
    GROUP BY s.SNAPSHOT_DATE, d.COHORT_MONTH, d.COUNTRY, d.CALENDAR_MONTH
),
-- Cohort x country size, as of each snapshot (small; merchants table only).
merchant_country_meta AS (
    SELECT EMAIL_KEY, COUNTRY, COHORT_MONTH, MIN(CREATED_DATE) AS FIRST_CREATED_DATE
    FROM (
        SELECT LOWER(TRIM(EMAIL))   AS EMAIL_KEY,
               UPPER(TRIM(COUNTRY)) AS COUNTRY,
               CREATED_AT::DATE     AS CREATED_DATE,
               MIN(DATE_TRUNC('MONTH', CREATED_AT)::DATE)
                   OVER (PARTITION BY LOWER(TRIM(EMAIL))) AS COHORT_MONTH
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
          AND COUNTRY IS NOT NULL AND COUNTRY <> ''
    AND LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM bot_accounts)   -- [bot-filter]
    )
    GROUP BY EMAIL_KEY, COUNTRY, COHORT_MONTH
),
-- Same collapse for cohort sizing. Each EMAIL_KEY is already unique per
-- (cohort, country) in merchant_country_meta, so the old COUNT(DISTINCT) over a
-- 54x snapshot fan-out is equivalent to a cumulative SUM of per-day new-merchant
-- counts. Pre-aggregate to (cohort, country, NEW_DATE) first, then fan out.
cohort_country_new AS (
    SELECT COHORT_MONTH, COUNTRY,
           FIRST_CREATED_DATE AS NEW_DATE,
           COUNT(*)           AS NEW_MERCHANTS
    FROM merchant_country_meta
    GROUP BY COHORT_MONTH, COUNTRY, FIRST_CREATED_DATE
),
cohort_country_size AS (
    SELECT s.SNAPSHOT_DATE, n.COHORT_MONTH, n.COUNTRY,
           SUM(n.NEW_MERCHANTS) AS COHORT_COUNTRY_SIZE
    FROM cohort_country_new n
    JOIN snapshots s ON n.NEW_DATE <= s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE, n.COHORT_MONTH, n.COUNTRY
)
SELECT
    m.SNAPSHOT_DATE,
    m.COHORT_MONTH,
    EXTRACT(YEAR FROM m.COHORT_MONTH)                       AS COHORT_YEAR,
    m.COUNTRY,
    m.CALENDAR_MONTH,
    EXTRACT(YEAR FROM m.CALENDAR_MONTH)                     AS CALENDAR_YEAR,
    DATEDIFF('MONTH', m.COHORT_MONTH, m.CALENDAR_MONTH)     AS MONTH_NUMBER,
    cs.COHORT_COUNTRY_SIZE,
    m.ACTIVE_MERCHANTS,
    m.RECEIPT_COUNT,
    ROUND(m.TPV_USD_APPROX, 2)                              AS TPV_USD_APPROX,
    ROUND(m.TPV_USD_APPROX / NULLIF(m.ACTIVE_MERCHANTS, 0), 2) AS AVG_TPV_PER_MERCHANT_USD,
    ROUND(m.TPV_USD_APPROX / NULLIF(m.RECEIPT_COUNT, 0), 2)    AS AVG_TICKET_USD,
    ROUND(100.0 * m.ACTIVE_MERCHANTS / NULLIF(cs.COHORT_COUNTRY_SIZE, 0), 4) AS PCT_COHORT_ACTIVE
FROM metrics m
LEFT JOIN cohort_country_size cs
       ON cs.SNAPSHOT_DATE = m.SNAPSHOT_DATE
      AND cs.COHORT_MONTH  = m.COHORT_MONTH
      AND cs.COUNTRY       = m.COUNTRY;
-- NOTE: the final ORDER BY was removed on purpose. Nothing downstream relies on
-- row order — run.py writes the result straight to CSV and build_kpi_data.py /
-- backfill_daily.py both groupby + sort in pandas. Sorting the full historical
-- grid (all ~130 calendar months x 54 snapshots) was a heavy, needless final
-- step that dominated the back half of the run.
