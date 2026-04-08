# CASE Dashboard — Snowflake Queries

SQL queries used by `snowflake-pull.js` to pull live data from the Loyverse Data Lake.

| File | Purpose |
|------|---------|
| `kpis.sql` | Core KPIs: ARR, ARPC, active users, GTV, churn |
| `monthly.sql` | Month-by-month revenue, active users, GTV vs targets |
| `cohorts.sql` | Cohort analysis (placeholder) |
| `markets.sql` | Top 10 countries by merchant count + GTV |
| `country-weights.sql` | Merchant distribution by country (%) |
| `funnel.sql` | Registered → Active → Paying → Payments conversion |
| `revenue-projection.sql` | 5-year revenue forecast by stream |
| `gtv-projection.sql` | 5-year GTV forecast |
| `gtv-by-market.sql` | GTV breakdown by country (last 30d) |
| `diagnostics.sql` | Data completeness checks |
| `revenue-diag.sql` | Invoice data summary stats |
| `revenue-sample.sql` | Sample invoices for spot-checking |

## Key conventions

- **FX rates**: Static CTE at top of each query (EUR base). Update monthly.
- **Chargebee amounts**: Always in cents → divide by 100.0
- **Chargebee regions**: EU (`CHARGEBEE-EU-*`) and UK (`CHARGEBEE-UK-*`), both multi-currency
- **GTV source**: `LOYVERSE_RECEIPTS.TOTAL_MONEY` (base currency, not cents)
- **Merchant join key**: `LOYVERSE_MERCHANTS.LOYVERSE_ID` (not `ID`)
- **Database context**: `LOYVERSE_DATA_LAKE.PUBLIC` with role `DATA_VIEWER`
