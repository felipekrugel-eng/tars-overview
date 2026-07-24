// AD-HOC v8 (2026-07-24): enabled (passed-KYC) merchants, transacting vs not,
// broken by origin bucket. New/Paying come from dashboard flags; ACTIVE is
// recomputed FRESH as any POS receipt in the last 30 days (the dashboard's
// pos_active flag is stale — monthly table only loaded through March).
// Priority: new > paying > active > dormant (matches the funnel origin split).
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
const vals = groups.map(g => `('${g.oid.replace(/'/g, "''")}',${g.is_new},${g.is_paying},'${g.grp}')`).join(',');

const sql = `
WITH g AS (
  SELECT column1 AS owner_id, column2 AS is_new, column3 AS is_paying, column4 AS grp
  FROM VALUES ${vals}
),
rcpt AS (
  SELECT MERCHANT_ID AS owner_id,
         COUNT(*) AS receipts_90d,
         SUM(TRY_TO_NUMBER(TOTAL_MONEY::string, 12, 2)) AS gmv_90d,
         MAX(TRY_TO_TIMESTAMP(RECEIPT_DATE::string)) AS last_receipt,
         COUNT(DISTINCT TO_DATE(TRY_TO_TIMESTAMP(RECEIPT_DATE::string))) AS active_days_90d
  FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
  WHERE CANCELLED_AT IS NULL AND (REFUND_FOR IS NULL OR REFUND_FOR = '')
    AND TRY_TO_TIMESTAMP(RECEIPT_DATE::string) >= DATEADD('day', -90, CURRENT_DATE)
    AND MERCHANT_ID IN (SELECT owner_id FROM g)
  GROUP BY 1
),
b AS (
  SELECT g.*, r.receipts_90d, r.gmv_90d, r.active_days_90d, r.last_receipt,
    CASE WHEN g.is_new = 1 THEN 'a. New'
         WHEN g.is_paying = 1 THEN 'b. Paying'
         WHEN r.last_receipt >= DATEADD('day', -30, CURRENT_DATE) THEN 'c. Active (POS last 30d)'
         ELSE 'd. Dormant/other' END AS bucket
  FROM g LEFT JOIN rcpt r ON r.owner_id = g.owner_id
)
SELECT bucket, grp,
  COUNT(*)                                        AS MERCHANTS,
  COUNT_IF(COALESCE(receipts_90d,0) > 0)          AS POS_ACTIVE_90D,
  COUNT_IF(DATEDIFF('day', last_receipt, CURRENT_DATE) <= 7) AS POS_LAST_7D,
  MEDIAN(IFF(receipts_90d>0, receipts_90d, NULL)) AS MED_RECEIPTS_90D,
  MEDIAN(IFF(receipts_90d>0, gmv_90d, NULL))      AS MED_GMV_90D,
  SUM(COALESCE(gmv_90d,0))                        AS TOTAL_GMV_90D,
  MEDIAN(IFF(receipts_90d>0, active_days_90d, NULL)) AS MED_ACTIVE_DAYS
FROM b GROUP BY 1,2 ORDER BY 1,2 DESC`;

(async () => {
  await new Promise((res, rej) => conn.connect((e, c) => e ? rej(e) : res(c)));
  console.log('=== RESULT ===');
  console.log(JSON.stringify(await q(sql), null, 1));
  console.log('=== END ===');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
