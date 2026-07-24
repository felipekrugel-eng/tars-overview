// AD-HOC v5 (2026-07-24): WHY is KYC completion low for July new merchants?
// Cohort = dashboard New bucket with a connected Stripe account (the "initiated KYC" 181).
// Breaks down: charges_enabled, details_submitted, disabled_reason, top requirements
// currently due, and account age — to separate form abandonment from review friction.
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

const fd = fs.readFileSync(path.join(__dirname, '..', 'activated-payments', 'funnel-data.js'), 'utf8');
const merchants = JSON.parse(fd.match(/__FUNNEL_MERCHANTS = (\[[\s\S]*?\]);/)[1]);
const cohort = merchants.filter(r => (r.registered_at || '') >= '2026-07-01' && r.oid != null && r.connected_at);
const ids = [...new Set(cohort.map(r => String(r.oid)))];
console.log(`initiated-KYC cohort: ${ids.length} unique owner ids`);
const idList = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(',');

const base = `SELECT * FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS WHERE MERCHANT_ID IN (${idList})`;

const queries = {
  STATUS_SPLIT: `
    SELECT CHARGES_ENABLED, DETAILS_SUBMITTED,
           COALESCE(NULLIF(TRIM(VERIFICATION_DISABLED_REASON),''),'(none)') AS DISABLED_REASON,
           COUNT(*) AS N
    FROM (${base}) GROUP BY 1,2,3 ORDER BY N DESC`,
  TOP_REQUIREMENTS_DUE: `
    SELECT TRIM(f.value::string) AS REQUIREMENT, COUNT(DISTINCT a.ID) AS ACCOUNTS
    FROM (${base}) a,
         LATERAL FLATTEN(input => SPLIT(COALESCE(a.REQUIREMENTS_CURRENTLY_DUE,''), ',')) f
    WHERE NOT a.CHARGES_ENABLED AND TRIM(f.value::string) <> ''
    GROUP BY 1 ORDER BY ACCOUNTS DESC LIMIT 15`,
  AGE_OF_NOT_ENABLED: `
    SELECT CASE WHEN DATEDIFF('day', CREATED, CURRENT_TIMESTAMP) <= 3 THEN 'a. 0-3 days'
                WHEN DATEDIFF('day', CREATED, CURRENT_TIMESTAMP) <= 7 THEN 'b. 4-7 days'
                WHEN DATEDIFF('day', CREATED, CURRENT_TIMESTAMP) <= 14 THEN 'c. 8-14 days'
                ELSE 'd. 15+ days' END AS ACCOUNT_AGE,
           COUNT(*) AS N,
           COUNT_IF(DETAILS_SUBMITTED) AS SUBMITTED
    FROM (${base}) WHERE NOT CHARGES_ENABLED GROUP BY 1 ORDER BY 1`,
};

(async () => {
  await new Promise((res, rej) => conn.connect((e, c) => e ? rej(e) : res(c)));
  console.log('=== RESULT ===');
  for (const [name, sql] of Object.entries(queries)) {
    try { console.log(`--- ${name} ---`); console.log(JSON.stringify(await q(sql), null, 1)); }
    catch (e) { console.log(`--- ${name} FAILED: ${e.message}`); }
  }
  console.log('=== END ===');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
