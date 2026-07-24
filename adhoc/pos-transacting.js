// AD-HOC (2026-07-24): of the July-2026 US new-merchant cohort (same bot-filtered
// definition as activated-payments/sql/us_registrations.sql, pilot excluded),
// how many have emitted >=1 Loyverse POS receipt (SALES_PER_ACCOUNT_MONTHLY)?
// Run via .github/workflows/adhoc-query.yml (workflow_dispatch only). Prints to logs.
const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_PATH = path.join(__dirname, '..', 'snowflake_tars_key.p8');
function readPrivateKey() {
  const privateKey = crypto.createPrivateKey({ key: fs.readFileSync(KEY_PATH, 'utf8'), format: 'pem' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}
const conn = snowflake.createConnection({
  account: 'ORXEAZX-TC97659', username: 'TARS_SERVICE_USER', authenticator: 'SNOWFLAKE_JWT',
  privateKey: readPrivateKey(), database: 'LOYVERSE_DATA_LAKE', schema: 'PUBLIC',
  warehouse: 'COMPUTE_WH', role: 'DATA_VIEWER',
});
const q = (sql) => new Promise((res, rej) => conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));

// July cohort = us_registrations.sql with the pilot injection emptied (pure July signups).
let regSql = fs.readFileSync(path.join(__dirname, '..', 'activated-payments', 'sql', 'us_registrations.sql'), 'utf8');
regSql = regSql.replace('/*PILOT_IDS*/', 'NULL').replace(/;\s*(--[^\n]*)?\s*$/m, '');

const sql = `
WITH july AS (${regSql}),
pos AS (
  SELECT LOYVERSE_MERCHANT_ID AS owner_id,
         SUM(TOTAL_SALES_COUNT) AS receipts,
         MAX(MONTH) AS last_month
  FROM LOYVERSE_DATA_LAKE.PUBLIC.SALES_PER_ACCOUNT_MONTHLY
  GROUP BY 1
)
SELECT
  COUNT(*)                                        AS JULY_NEW_MERCHANTS,
  COUNT_IF(COALESCE(p.receipts,0) > 0)            AS POS_TRANSACTING,
  SUM(COALESCE(p.receipts,0))                     AS TOTAL_RECEIPTS,
  MEDIAN(IFF(COALESCE(p.receipts,0) > 0, p.receipts, NULL)) AS MEDIAN_RECEIPTS_PER_TRANSACTOR
FROM july j
LEFT JOIN pos p ON p.owner_id = j.owner_id`;

(async () => {
  await new Promise((res, rej) => conn.connect((e, c) => e ? rej(e) : res(c)));
  const rows = await q(sql);
  console.log('=== RESULT ===');
  console.log(JSON.stringify(rows, null, 2));
  console.log('=== END ===');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
