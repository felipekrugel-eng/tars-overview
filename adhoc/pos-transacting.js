// AD-HOC v7 (2026-07-24): profile enabled (passed-KYC) merchants — payments transactors
// vs not-yet — by their Loyverse POS activity and GMV (LOYVERSE_RECEIPTS_UNIQUE, last 90d).
// Groups precomputed from funnel-data.js into adhoc/enabled-groups.json.
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

const groups = JSON.parse(fs.readFileSync(path.join(__dirname, 'enabled-groups.json'), 'utf8'));
const lit = (ids) => ids.map(id => `('${String(id).replace(/'/g, "''")}')`).join(',');

const sql = `
WITH g AS (
  SELECT column1 AS owner_id, 'transacting' AS grp FROM VALUES ${lit(groups.txn)}
  UNION ALL
  SELECT column1, 'not_yet' FROM VALUES ${lit(groups.non)}
),
rcpt AS (
  SELECT MERCHANT_ID AS owner_id,
         COUNT(*) AS receipts_90d,
         SUM(TRY_TO_NUMBER(TOTAL_MONEY::string, 12, 2)) AS gmv_90d,
         MAX(RECEIPT_DATE) AS last_receipt,
         COUNT(DISTINCT DATE_TRUNC('day', RECEIPT_DATE)) AS active_days_90d
  FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
  WHERE CANCELLED_AT IS NULL AND (REFUND_FOR IS NULL OR REFUND_FOR = '')
    AND RECEIPT_DATE >= DATEADD('day', -90, CURRENT_DATE)
    AND MERCHANT_ID IN (SELECT owner_id FROM g)
  GROUP BY 1
)
SELECT g.grp,
  COUNT(*)                                       AS MERCHANTS,
  COUNT_IF(COALESCE(r.receipts_90d,0) > 0)       AS POS_ACTIVE_90D,
  COUNT_IF(DATEDIFF('day', r.last_receipt, CURRENT_DATE) <= 7) AS POS_ACTIVE_LAST_7D,
  MEDIAN(IFF(r.receipts_90d>0, r.receipts_90d, NULL))     AS MEDIAN_RECEIPTS_90D,
  MEDIAN(IFF(r.receipts_90d>0, r.gmv_90d, NULL))          AS MEDIAN_GMV_90D,
  AVG(IFF(r.receipts_90d>0, r.gmv_90d, NULL))             AS AVG_GMV_90D,
  MEDIAN(IFF(r.receipts_90d>0, r.active_days_90d, NULL))  AS MEDIAN_ACTIVE_DAYS_90D,
  MEDIAN(IFF(r.receipts_90d>0, r.gmv_90d / NULLIF(r.receipts_90d,0), NULL)) AS MEDIAN_TICKET
FROM g LEFT JOIN rcpt r ON r.owner_id = g.owner_id
GROUP BY 1 ORDER BY 1 DESC`;

(async () => {
  await new Promise((res, rej) => conn.connect((e, c) => e ? rej(e) : res(c)));
  console.log('=== RESULT ===');
  console.log(JSON.stringify(await q(sql), null, 1));
  console.log('=== END ===');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
