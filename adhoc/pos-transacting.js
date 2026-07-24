// AD-HOC v2 (2026-07-24): July-2026 US new-merchant cohort (bot-filtered, deduped,
// pilot excluded) vs Loyverse POS receipts (LOYVERSE_RECEIPTS per-receipt table).
// Also reports SALES_PER_ACCOUNT_MONTHLY coverage (suspected to lag July).
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

let regSql = fs.readFileSync(path.join(__dirname, '..', 'activated-payments', 'sql', 'us_registrations.sql'), 'utf8');
regSql = regSql.replace('/*PILOT_IDS*/', 'NULL').replace(/;\s*(--[^\n]*)?\s*$/m, '');

const main = (receiptsTable) => `
WITH regs AS (${regSql}),
july AS (SELECT DISTINCT owner_id FROM regs),
rcpt AS (
  SELECT MERCHANT_ID AS owner_id,
         COUNT(*) AS receipts,
         MIN(RECEIPT_DATE) AS first_receipt,
         MAX(RECEIPT_DATE) AS last_receipt
  FROM LOYVERSE_DATA_LAKE.PUBLIC.${receiptsTable}
  WHERE CANCELLED_AT IS NULL
    AND (REFUND_FOR IS NULL OR REFUND_FOR = '')
  GROUP BY 1
)
SELECT
  COUNT(*)                              AS JULY_NEW_MERCHANTS,
  COUNT_IF(COALESCE(r.receipts,0) > 0)  AS POS_TRANSACTING,
  COUNT_IF(COALESCE(r.receipts,0) >= 5) AS POS_5_PLUS_RECEIPTS,
  SUM(COALESCE(r.receipts,0))           AS TOTAL_RECEIPTS,
  MEDIAN(IFF(COALESCE(r.receipts,0) > 0, r.receipts, NULL)) AS MEDIAN_RECEIPTS_PER_TRANSACTOR,
  MAX(r.last_receipt)                   AS MOST_RECENT_RECEIPT
FROM july j
LEFT JOIN rcpt r ON r.owner_id = j.owner_id`;

(async () => {
  await new Promise((res, rej) => conn.connect((e, c) => e ? rej(e) : res(c)));
  console.log('=== DIAG: SALES_PER_ACCOUNT_MONTHLY coverage ===');
  try {
    console.log(JSON.stringify(await q(
      `SELECT MAX(MONTH) AS MAX_MONTH, COUNT(*) AS ROWS_TOTAL FROM LOYVERSE_DATA_LAKE.PUBLIC.SALES_PER_ACCOUNT_MONTHLY`)));
  } catch (e) { console.log('diag failed:', e.message); }
  console.log('=== DIAG: LOYVERSE_RECEIPTS coverage ===');
  try {
    console.log(JSON.stringify(await q(
      `SELECT MAX(RECEIPT_DATE) AS MAX_DATE, COUNT(*) AS ROWS_TOTAL FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS WHERE RECEIPT_DATE >= '2026-07-01'`)));
  } catch (e) { console.log('diag failed:', e.message); }
  let rows;
  try { rows = await q(main('LOYVERSE_RECEIPTS_UNIQUE')); console.log('source: LOYVERSE_RECEIPTS_UNIQUE'); }
  catch (e) { console.log('UNIQUE view failed (' + e.message + '), falling back'); rows = await q(main('LOYVERSE_RECEIPTS')); console.log('source: LOYVERSE_RECEIPTS'); }
  console.log('=== RESULT ===');
  console.log(JSON.stringify(rows, null, 2));
  console.log('=== END ===');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
