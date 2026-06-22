-- =================================================================
-- Rolling 30-day ACTIVE & PAYING distinct merchants — one row per day, last 49 days.
-- For each output day D, window = [D-29, D] inclusive (30 days), email-deduped.
-- True rolling distinct counts (range join + COUNT DISTINCT per day) — NOT month-to-date.
--
-- "dated" for PAYING = invoice DATE (charge date). To key off when payment cleared
-- instead, swap TO_TIMESTAMP(i.DATE) for TO_TIMESTAMP(i.PAID_AT) in both paid_days blocks.
-- =================================================================
WITH spine AS (                                   -- 49 output days ending today
    SELECT DATEADD('day', SEQ4(), DATEADD('day', -48, CURRENT_DATE()))::DATE AS SNAPSHOT_DATE
    FROM TABLE(GENERATOR(ROWCOUNT => 49))
),
merchant_email AS (                               -- one email per account (prevents join fan-out)
    SELECT LOYVERSE_ID, MIN(LOWER(TRIM(EMAIL))) AS EMAIL_KEY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE EMAIL IS NOT NULL
    GROUP BY LOYVERSE_ID
),
-- distinct (merchant email, active day) from VALID receipts; reaches 29 days before the first
-- output day (CURRENT_DATE-48-29 = CURRENT_DATE-77) so every window is complete.
receipt_days AS (
    SELECT DISTINCT me.EMAIL_KEY,
                    TRY_TO_TIMESTAMP(r.RECEIPT_DATE)::DATE AS ACT_DAY
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE r
    JOIN merchant_email me ON me.LOYVERSE_ID = r.MERCHANT_ID
    WHERE r.TOTAL_MONEY IS NOT NULL AND r.TOTAL_MONEY > 0     -- same validity filter as the
      AND r.CANCELLED_AT IS NULL                              -- active-merchants series
      AND r.REFUND_FOR IS NULL
      AND UPPER(COALESCE(r.RECEIPT_TYPE, 'SALE')) <> 'REFUND'
      AND TRY_TO_TIMESTAMP(r.RECEIPT_DATE)::DATE
            BETWEEN DATEADD('day', -77, CURRENT_DATE()) AND CURRENT_DATE()
),
-- distinct (merchant email, paid day) from paid plan/addon invoice lines (UK + EU)
paid_days AS (
    SELECT DISTINCT LOWER(TRIM(c.EMAIL)) AS EMAIL_KEY,
                    TO_TIMESTAMP(i.DATE)::DATE AS PAY_DAY
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.STATUS = 'paid' AND i.DELETED = FALSE AND i.VOIDED_AT IS NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:entity_type::STRING IN ('plan','addon')
      AND TO_TIMESTAMP(i.DATE)::DATE
            BETWEEN DATEADD('day', -77, CURRENT_DATE()) AND CURRENT_DATE()
    UNION
    SELECT DISTINCT LOWER(TRIM(c.EMAIL)),
                    TO_TIMESTAMP(i.DATE)::DATE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.STATUS = 'paid' AND i.DELETED = FALSE AND i.VOIDED_AT IS NULL
      AND c.EMAIL IS NOT NULL
      AND li.value:entity_type::STRING IN ('plan','addon')
      AND TO_TIMESTAMP(i.DATE)::DATE
            BETWEEN DATEADD('day', -77, CURRENT_DATE()) AND CURRENT_DATE()
),
active_counts AS (
    SELECT s.SNAPSHOT_DATE, COUNT(DISTINCT rd.EMAIL_KEY) AS ACTIVE_30D
    FROM spine s
    JOIN receipt_days rd
      ON rd.ACT_DAY BETWEEN DATEADD('day', -29, s.SNAPSHOT_DATE) AND s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE
),
paying_counts AS (
    SELECT s.SNAPSHOT_DATE, COUNT(DISTINCT pd.EMAIL_KEY) AS PAYING_30D
    FROM spine s
    JOIN paid_days pd
      ON pd.PAY_DAY BETWEEN DATEADD('day', -29, s.SNAPSHOT_DATE) AND s.SNAPSHOT_DATE
    GROUP BY s.SNAPSHOT_DATE
)
SELECT s.SNAPSHOT_DATE,
       COALESCE(a.ACTIVE_30D, 0) AS ACTIVE_30D,
       COALESCE(p.PAYING_30D, 0) AS PAYING_30D
FROM spine s
LEFT JOIN active_counts a ON a.SNAPSHOT_DATE = s.SNAPSHOT_DATE
LEFT JOIN paying_counts p ON p.SNAPSHOT_DATE = s.SNAPSHOT_DATE
ORDER BY s.SNAPSHOT_DATE;
