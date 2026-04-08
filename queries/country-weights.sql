-- Country Weights: Percentage of total merchants per country
-- Used for regional distribution analysis on the CASE dashboard

WITH total AS (SELECT COUNT(*) AS cnt FROM LOYVERSE_MERCHANTS),
by_country AS (
  SELECT COUNTRY AS country_code, COUNT(*) AS cnt FROM LOYVERSE_MERCHANTS
  WHERE COUNTRY IS NOT NULL AND COUNTRY != '' GROUP BY COUNTRY
)
SELECT bc.country_code, ROUND(bc.cnt * 100.0 / t.cnt, 2) AS weight
FROM by_country bc, total t ORDER BY weight DESC LIMIT 30
