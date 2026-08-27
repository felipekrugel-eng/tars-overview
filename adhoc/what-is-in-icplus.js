// AD-HOC (2026-08-27): what does ICPLUS_FEES actually contain?
//
// The dashboard's 239bp "cost of acceptance" sums ICPLUS_FEES.TOTAL_AMOUNT. Comparing that to a
// merchant's acquirer statement is only valid if we know whether it is PURE PASS-THROUGH
// (interchange + scheme assessments) or INTERCHANGE PLUS STRIPE'S MARKUP. The two map to
// completely different lines on a Comerica statement — third-party network fees, or the whole
// bill including the acquirer's own discount rate. Getting it backwards would make the two
// numbers look comparable when they are not.
const snowflake = require('snowflake-sdk');
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
function readPrivateKey() {
  const pk = crypto.createPrivateKey({ key: fs.readFileSync(path.join(__dirname, '..', 'snowflake_tars_key.p8'), 'utf8'), format: 'pem' });
  return pk.export({ type: 'pkcs8', format: 'pem' });
}
const conn = snowflake.createConnection({
  account: 'ORXEAZX-TC97659', username: 'TARS_SERVICE_USER', authenticator: 'SNOWFLAKE_JWT',
  privateKey: readPrivateKey(), database: 'LOYVERSE_DATA_LAKE', schema: 'PUBLIC',
  warehouse: 'COMPUTE_WH', role: 'DATA_VIEWER',
});
const S = 'GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE';
const q = (sql) => new Promise((res, rej) => conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));
conn.connect(async (err) => {
  if (err) { console.error(err.message); process.exit(1); }
  try {
    console.log('=== fee categories and names, by total amount ===');
    console.table(await q(`
      SELECT FEE_CATEGORY, FEE_NAME, PLAN_NAME,
             COUNT(*) AS ROWS_, ROUND(SUM(TOTAL_AMOUNT)/100, 2) AS AMOUNT
      FROM ${S}.ICPLUS_FEES
      GROUP BY 1,2,3 ORDER BY AMOUNT DESC LIMIT 25`));
    console.log('\n=== category totals, the share that matters ===');
    console.table(await q(`
      SELECT FEE_CATEGORY, ROUND(SUM(TOTAL_AMOUNT)/100, 2) AS AMOUNT,
             ROUND(100.0 * SUM(TOTAL_AMOUNT) / SUM(SUM(TOTAL_AMOUNT)) OVER (), 1) AS PCT
      FROM ${S}.ICPLUS_FEES GROUP BY 1 ORDER BY AMOUNT DESC`));
  } catch (e) { console.error('failed:', e.message); process.exitCode = 1; }
  finally { conn.destroy(() => {}); }
});
