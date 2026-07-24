// AD-HOC v9 (2026-07-24): the 43 enabled (passed-KYC) NEW-bucket merchants —
// how many emitted at least one POS receipt in July (active this month) vs not.
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

const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'newenabled.json'), 'utf8'));
const vals = list.map(m => `('${String(m.oid).replace(/'/g, "''")}','${String(m.name || '').replace(/'/g, "''").slice(0, 60)}')`).join(',');

const sql = `
WITH g AS (
  SELECT column1 AS owner_id, column2 AS name FROM VALUES ${vals}
),
r AS (
  SELECT MERCHANT_ID::string AS mid,
         COUNT(*) AS receipts_july,
         SUM(TRY_TO_NUMBER(TOTAL_MONEY::string, 12, 2)) AS gmv_july,
         MAX(TRY_TO_TIMESTAMP(RECEIPT_DATE::string)) AS last_receipt
  FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
  WHERE CANCELLED_AT IS NULL AND (REFUND_FOR IS NULL OR REFUND_FOR = '')
    AND TRY_TO_TIMESTAMP(RECEIPT_DATE::string) >= '2026-07-01'
    AND MERCHANT_ID::string IN (SELECT owner_id FROM g)
  GROUP BY 1
)
SELECT g.owner_id, g.name,
       COALESCE(r.receipts_july, 0) AS receipts_july,
       COALESCE(r.gmv_july, 0) AS gmv_july,
       r.last_receipt
FROM g LEFT JOIN r ON r.mid = g.owner_id
ORDER BY receipts_july DESC
`;

(async () => {
  await new Promise((res, rej) => conn.connect((e) => e ? rej(e) : res()));
  const rows = await q(sql);
  const active = rows.filter(r => Number(r.RECEIPTS_JULY) > 0);
  console.log('RESULT_START');
  console.log(JSON.stringify({
    total: rows.length,
    active_july: active.length,
    not_active_july: rows.length - active.length,
    rows: rows.map(r => ({ oid: r.OWNER_ID, name: r.NAME, receipts: Number(r.RECEIPTS_JULY), gmv: Number(r.GMV_JULY), last: r.LAST_RECEIPT })),
  }, null, 1));
  console.log('RESULT_END');
  conn.destroy(() => {});
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
