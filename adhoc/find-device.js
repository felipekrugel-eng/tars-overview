// AD-HOC (2026-08-27): find the device behind each card-present charge — M2, S710, Tap to Phone.
//
// CONNECTED_ACCOUNT_CHARGES has no reader or device column, and neither does the payment intent
// view, so a first pass concluded the split was not available. That was wrong: _discovery.json
// only lists COLUMNS for 18 of the 331 views in the share, and the search was run against those
// 18. The share also carries CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS, TERMINAL_READERS and
// TERMINAL_LOCATIONS, none of which had been described.
//
// This describes the candidates and samples them, so the next step is decided by what the columns
// actually are rather than by what seems likely.
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
const SHARE = 'GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE';
const q = (sql) => new Promise((res, rej) => conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));

const CANDIDATES = [
  'CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS',
  'TERMINAL_READERS',
  'TERMINAL_LOCATIONS',
  'ANALYTICS_ACCEPTANCE_ITEMIZED',
];

conn.connect(async (err) => {
  if (err) { console.error('connect failed:', err.message); process.exit(1); }
  try {
    for (const v of CANDIDATES) {
      console.log('\n================ ' + v + ' ================');
      let cols = [];
      try {
        const rows = await q(`DESCRIBE VIEW ${SHARE}.${v}`);
        cols = rows.map(r => r.name || r.NAME);
        console.log('columns (' + cols.length + '):');
        console.log('  ' + cols.join(', '));
      } catch (e) { console.log('  describe failed: ' + e.message); continue; }

      // Anything that could name a device, a reader or a payment-method type.
      const interesting = cols.filter(c => /DEVICE|READER|MODEL|TYPE|SERIAL|LABEL|PRESENT|BRAND|WALLET|LOCATION/i.test(c));
      console.log('  device/type-ish columns: ' + (interesting.join(', ') || '(none)'));

      try {
        const n = await q(`SELECT COUNT(*) AS N FROM ${SHARE}.${v}`);
        console.log('  rows: ' + (n[0].N ?? n[0].n));
      } catch (e) { console.log('  count failed: ' + e.message); }

      // One row, so the shape is concrete rather than guessed.
      try {
        const s = await q(`SELECT * FROM ${SHARE}.${v} LIMIT 1`);
        if (s.length) {
          const r = s[0];
          const shown = Object.keys(r).filter(k => r[k] !== null).slice(0, 24);
          console.log('  sample (non-null fields): ' + JSON.stringify(Object.fromEntries(
            shown.map(k => [k, String(r[k]).slice(0, 40)]))));
        } else console.log('  sample: (view is empty)');
      } catch (e) { console.log('  sample failed: ' + e.message); }

      // If a device-ish column exists, what values does it actually take?
      for (const c of interesting.filter(c => /DEVICE|READER|MODEL|TYPE/i.test(c)).slice(0, 4)) {
        try {
          const vals = await q(`SELECT ${c} AS V, COUNT(*) AS N FROM ${SHARE}.${v}
                                GROUP BY 1 ORDER BY N DESC LIMIT 12`);
          console.log(`  ${c}: ` + vals.map(x => `${x.V}=${x.N}`).join('  '));
        } catch (e) { console.log(`  ${c}: group-by failed (${e.message})`); }
      }
    }
  } catch (e) {
    console.error('failed:', e.message);
    process.exitCode = 1;
  } finally { conn.destroy(() => {}); }
});
