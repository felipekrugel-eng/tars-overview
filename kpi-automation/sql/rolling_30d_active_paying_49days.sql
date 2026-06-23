-- =================================================================
-- Rolling 30-day KPI series — one row per day, 49 days ending YESTERDAY.
-- Output: SNAPSHOT_DATE, REG_30D, ACTIVE_30D, PAYING_ACTIVE
--
--   REG_30D       — distinct merchants (email) first registered in [D-29, D].
--                   Registration is one-time, so an additive distinct count is correct.
--   ACTIVE_30D    — distinct merchants with >=1 valid receipt in [D-29, D] (trailing 30d).
--                   Same receipts source + validity filter as the active-merchants series.
--   PAYING_ACTIVE — POINT-IN-TIME active subscriptions: distinct customers with a paid
--                   plan/addon invoice line whose billing period COVERS day D
--                   (date_from <= D <= date_to). Smooth across annual terms — no billing pulse.
--
-- Spine ends on the last COMPLETE day (CURRENT_DATE-1) so the final point isn't a partial-day dip.
-- All windows reach >=29 days before the first output day, so every window is complete.
-- Email dedup throughout: LOWER(TRIM(EMAIL)).
-- =================================================================
WITH spine AS (                                   -- 49 days, ending yesterday (CURRENT_DATE-1)
    SELECT DATEADD('day', SEQ4(), DATEADD('day', -49, CURRENT_DATE()))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 49))
),
-- ---------- REG_30D ----------
reg_email AS (                                    -- one registration day per merchant email (first account)
    SELECT LOWER(TRIM(EMAIL)) AS EMAIL_KEY,
           MIN(CREATED_AT::DATE) AS REG_DAY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
    GROUP BY LOWER(TRIM(EMAIL))
),
reg_counts AS (
    SELECT s.SNAPSHOT_DATE, COUNT(DISTINCT re.EMAIL_KEY) AS REG_30D
    FROM spine s
    JOIN reg_email re
      ON re.REG_DAY BETWEEN DATEADD('day', -29, s.SNAPSHOT_DATE) AND s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE
),
-- ---------- ACTIVE_30D (unchanged) ----------
merchant_email AS (                               -- one email per account (prevents receipt join fan-out)
    SELECT LOYVERSE_ID, MIN(LOWER(TRIM(EMAIL))) AS EMAIL_KEY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL
    GROUP BY LOYVERSE_ID
),
receipt_days AS (                                 -- distinct (email, active day) from valid receipts
    SELECT DISTINCT me.EMAIL_KEY,
                    TRY_TO_TIMESTAMP(r.RECEIPT_DATE)::DATE AS ACT_DAY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE r
    JOIN merchant_email me ON me.LOYVERSE_ID = r.MERCHANT_ID
    WHERE r.TOTAL_MONEY IS NOT NULL AND r.TOTAL_MONEY > 0
      AND r.CANCELLED_AT IS NULL
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
      AND TRY_TO_TIMESTAMP(r.RECEIPT_DATE)::DATE
            BETWEEN DATEADD('day', -78, CURRENT_DATE()) AND DATEADD('day', -1, CURRENT_DATE())
      -- OPTIONAL pruning aid (only if CREATED_AT tracks RECEIPT_DATE closely):
      -- AND r.CREATED_AT >= DATEADD('day', -110, CURRENT_DATE())
),
active_counts AS (
    SELECT s.SNAPSHOT_DATE, COUNT(DISTINCT rd.EMAIL_KEY) AS ACTIVE_30D
    FROM spine s
    JOIN receipt_days rd
      ON rd.ACT_DAY BETWEEN DATEADD('day', -29, s.SNAPSHOT_DATE) AND s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE
),
-- ---------- PAYING_ACTIVE (point-in-time subscription coverage) ----------
sub_periods AS (                                  -- distinct (email, billing period) for paid plan/addon lines
    SELECT DISTINCT LOWER(TRIM(c.EMAIL)) AS EMAIL_KEY,
                    TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS P_START,
                    TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS P_END
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.STATUS = 'paid' AND i.DELETED = FALSE AND i.VOIDED_AT IS NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:entity_type::STRING IN ('plan','addon')
      AND TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   >= DATEADD('day', -49, CURRENT_DATE())
      AND TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE <= DATEADD('day', -1,  CURRENT_DATE())
    UNION
    SELECT DISTINCT LOWER(TRIM(c.EMAIL)),
                    TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE,
                    TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.STATUS = 'paid' AND i.DELETED = FALSE AND i.VOIDED_AT IS NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:entity_type::STRING IN ('plan','addon')
      AND TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   >= DATEADD('day', -49, CURRENT_DATE())
      AND TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE <= DATEADD('day', -1,  CURRENT_DATE())
),
paying_active AS (
    SELECT s.SNAPSHOT_DATE, COUNT(DISTINCT sp.EMAIL_KEY) AS PAYING_ACTIVE
    FROM spine s
    JOIN sub_periods sp
      ON s.SNAPSHOT_DATE BETWEEN sp.P_START AND sp.P_END   -- subscription covers day D
    GROUP BY s.SNAPSHOT_DATE
)
SELECT s.SNAPSHOT_DATE,
       COALESCE(r.REG_30D,        0) AS REG_30D,
       COALESCE(a.ACTIVE_30D,     0) AS ACTIVE_30D,
       COALESCE(p.PAYING_ACTIVE,  0) AS PAYING_ACTIVE
FROM spine s
LEFT JOIN reg_counts    r ON r.SNAPSHOT_DATE = s.SNAPSHOT_DATE
LEFT JOIN active_counts a ON a.SNAPSHOT_DATE = s.SNAPSHOT_DATE
LEFT JOIN paying_active p ON p.SNAPSHOT_DATE = s.SNAPSHOT_DATE
ORDER BY s.SNAPSHOT_DATE;
