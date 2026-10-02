-- =================================================================
-- RECEIPTS FEED HEALTH — is the receipts feed actually still arriving
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- WHY THIS EXISTS. On 2026-09-29 at about 12:30 UTC the receipts feed stopped. Ingestion
-- went from ~470,000 receipts an hour to under 700, and stayed there. Nothing in this repo
-- broke; the lake simply stopped being fed. But every downstream build carried on, read the
-- near-empty days as real, and published them — so the dashboard showed qualified active
-- merchants falling from 332,105 in August to 76 in October, and kept showing it for three
-- days before anyone said anything.
--
-- The lesson is not "add an alert". It is that a build which cannot tell SILENCE from ZERO
-- will always eventually publish a catastrophe. An empty day and a missing day look
-- identical in a COUNT(*) unless something is explicitly asked to tell them apart. That is
-- the only job of this query.
--
-- WHY IT IS ITS OWN QUERY AND NOT A COLUMN ON country_month_activity.sql. The guard has to
-- be able to run and be believed even when the big scan fails, times out, or is skipped —
-- those are exactly the circumstances where the data is most likely to be wrong. It also
-- has to be cheap enough that there is never an argument about running it: the date floor
-- prunes LOYVERSE_RECEIPTS to a few recent micro-partitions, so this returns in well under
-- a second against the ~13 minutes the full scan costs.
--
-- MONTH GRAIN WOULD NOT HAVE CAUGHT THIS. September was 97.8% complete when the feed died,
-- which is invisible in a monthly total but still wrong. Only a DAILY count can say which
-- calendar months are whole, so this is deliberately day grain and the completeness
-- decision is made in build_subs_data.py from these rows.
--
-- 45 days is enough to establish a trailing median for a normal week and to cover an outage
-- that has been running for over a month, and short enough to stay cheap.
-- =================================================================

SELECT LEFT(r.RECEIPT_DATE, 10)          AS D,
       COUNT(*)                          AS RECEIPTS,
       COUNT(DISTINCT r.MERCHANT_ID)     AS MERCHANTS
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS r
-- String comparison on purpose. RECEIPT_DATE is TEXT holding ISO-8601, which sorts in date
-- order, so this prunes micro-partitions. TRY_TO_TIMESTAMP here would defeat pruning and
-- turn a sub-second probe into a full scan of 9.7 billion rows.
WHERE r.RECEIPT_DATE >= TO_VARCHAR(DATEADD('day', -45, CURRENT_DATE()))
  AND r.RECEIPT_DATE <  TO_VARCHAR(DATEADD('day',   1, CURRENT_DATE()))
GROUP BY 1
ORDER BY 1;
