// AD-HOC v3 (2026-07-24): POS receipts for the EXACT dashboard "New" cohort.
// Reads the checked-out activated-payments/funnel-data.js, takes merchants with
// registered_at >= 2026-07-01 (the dashboard's bot-filtered July cohort), and
// matches them against LOYVERSE_RECEIPTS_UNIQUE (cancelled/refund rows excluded).
const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_PATH = path.join(__dirname, '..', 'snowflake_tars_key.p8');
function readPrivateKey() {
  const pk = crypto.createPrivateKey({ key: fs.readFileSync(KEY_PATH, 'utf8'), format: 'pem' });
  return pk.export({ type: 'pkcs8', format: 'pem' });
}
const conn = snowflake.createConnection({
  account: 'ORXEAZX-TC97659', username: 'TARS_SERVICE_USER', authenticator: 'SNOWFLAKE_JWT',
  privateKey: readPrivateKey(), database: 'LOYVERSE_DATA_LAKE', schema: 'PUBLIC',
  warehouse: 'COMPUTE_WH', role: 'DATA_VIEWER',
});
const q = (sql) => new Promise((res, rej) => conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));

// Extract the dashboard cohort from funnel-data.js
const fd = fs.readFileSync(path.join(__dirname, '..', 'activated-payments', 'funnel-data.js'), 'utf8');
const m = fd.match(/__FUNNEL_MERCHANTS = (\[[\s\S]*?\]);/);
const merchants = JSON.parse(m[1]);
const cohort = merchants.filter(r => (r.registered_at || '') >= '2026-07-01' && r.oid != null && r.connected_at);
const ids = [...new Set(cohort.map(r => String(r.oid)))];
console.log(`dashboard July "New" + initiated-KYC cohort: ${cohort.length} rows, ${ids.length} unique owner ids`);
const idList = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(',');

const sql = `
WITH rcpt AS (
  SELECT MERCHANT_ID AS owner_id,
         COUNT(*) AS receipts,
         MIN(RECEIPT_DATE) AS first_receipt
  FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
  WHERE CANCELLED_AT IS NULL
    AND RECEIPT_DATE >= '2026-07-01'
    AND (REFUND_FOR IS NULL OR REFUND_FOR = '')
    AND MERCHANT_ID IN (${idList})
  GROUP BY 1
)
SELECT
  COUNT(*)                          AS POS_TRANSACTING,
  COUNT_IF(receipts >= 5)           AS POS_5_PLUS_RECEIPTS,
  COUNT_IF(receipts >= 20)          AS POS_20_PLUS_RECEIPTS,
  SUM(receipts)                     AS TOTAL_RECEIPTS,
  MEDIAN(receipts)                  AS MEDIAN_RECEIPTS
FROM rcpt`;

(async () => {
  await new Promise((res, rej) => conn.connect((e, c) => e ? rej(e) : res(c)));
  const rows = await q(sql);
  console.log('=== RESULT ===');
  console.log(JSON.stringify({ COHORT: ids.length, ...rows[0] }, null, 2));
  console.log('=== END ===');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
