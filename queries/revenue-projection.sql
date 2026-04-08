-- Revenue Projection: 5-year revenue forecast by stream (static targets)
-- Update these VALUES when the business plan is revised

SELECT column1 AS year, column2 AS addon_revenue, column3 AS payment_revenue, column4 AS new_pricing_revenue
FROM VALUES (2025,7.6,0.0,0.0),(2026,8.5,0.1,1.1),(2027,9.5,1.5,3.0),(2028,10.5,5.0,5.5),(2029,11.5,12.0,8.0),(2030,12.5,25.0,11.0)
ORDER BY year
