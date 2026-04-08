-- GTV Projection: 5-year GTV forecast in billions EUR (static targets)
-- Update these VALUES when the business plan is revised

SELECT column1 AS year, column2 AS gtv_billions
FROM VALUES (2025,23.4),(2026,30.9),(2027,40.0),(2028,52.0),(2029,67.0),(2030,85.0)
ORDER BY year
