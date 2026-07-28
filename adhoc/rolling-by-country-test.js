// AD-HOC TEST (2026-07-28): validate rolling_30d_by_country_49days.sql before wiring
// it into kpi-pull. Runs BOTH the global and the new per-country rolling queries and
// reconciles them day by day. Read-only SELECTs. Delete this file once verified.
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

const SQL_DIR = path.join(__dirname, '..', 'kpi-automation', 'sql');
const read = (f) => fs.readFileSync(path.join(SQL_DIR, f), 'utf8').replace(/;\s*$/, '');

(async () => {
  await new Promise((res, rej) => conn.connect((e) => e ? rej(e) : res()));
  console.log('connected');

  const t0 = Date.now();
  const globalRows = await q(read('rolling_30d_active_paying_49days.sql'));
  console.log('global query: ' + globalRows.length + ' rows in ' + ((Date.now()-t0)/1000).toFixed(1) + 's');

  const t1 = Date.now();
  const cRows = await q(read('rolling_30d_by_country_49days.sql'));
  console.log('country query: ' + cRows.length + ' rows in ' + ((Date.now()-t1)/1000).toFixed(1) + 's');

  const countries = new Set(cRows.map(r => r.COUNTRY));
  console.log('distinct countries: ' + countries.size);

  // roll the per-country result up to a global total per day and compare
  const up = {};
  for (const r of cRows) {
    const d = String(r.SNAPSHOT_DATE).slice(0, 10);
    up[d] = up[d] || { REG_30D: 0, ACTIVE_30D: 0, PAYING_ACTIVE: 0 };
    up[d].REG_30D       += Number(r.REG_30D || 0);
    up[d].ACTIVE_30D    += Number(r.ACTIVE_30D || 0);
    up[d].PAYING_ACTIVE += Number(r.PAYING_ACTIVE || 0);
  }

  const F = ['REG_30D', 'ACTIVE_30D', 'PAYING_ACTIVE'];
  const worst = { REG_30D: 0, ACTIVE_30D: 0, PAYING_ACTIVE: 0 };
  console.log('');
  console.log('date        metric          global    sum(country)     diff      diff%');
  for (const g of globalRows) {
    const d = String(g.SNAPSHOT_DATE).slice(0, 10);
    const u = up[d];
    if (!u) { console.log(d + '  MISSING from country result'); continue; }
    for (const f of F) {
      const gv = Number(g[f] || 0), cv = u[f];
      const pct = gv ? ((cv - gv) / gv) * 100 : 0;
      if (Math.abs(pct) > Math.abs(worst[f])) worst[f] = pct;
      // print the last 5 days in full; flag any day off by >1%
      const recent = globalRows.indexOf(g) >= globalRows.length - 5;
      if (recent || Math.abs(pct) > 1) {
        console.log(d + '  ' + f.padEnd(15) + String(gv).padStart(8) + String(cv).padStart(15) + String(cv - gv).padStart(10) + '   ' + pct.toFixed(2) + '%');
      }
    }
  }

  console.log('');
  console.log('WORST daily gap vs global (country sum - global):');
  for (const f of F) console.log('  ' + f.padEnd(15) + worst[f].toFixed(2) + '%');
  console.log('');
  console.log('Expected: REG_30D and ACTIVE_30D ~0% (every merchant has a country).');
  console.log('PAYING_ACTIVE may sit slightly NEGATIVE — Chargebee emails with no');
  console.log('LOYVERSE_MERCHANTS row have no country and drop out (known gap, same as');
  console.log('country_month_mrr_daily_asof.sql). A large gap means something is wrong.');

  // top countries on the latest day, as an eyeball check
  const last = String(globalRows[globalRows.length - 1].SNAPSHOT_DATE).slice(0, 10);
  const top = cRows.filter(r => String(r.SNAPSHOT_DATE).slice(0,10) === last)
                   .sort((a, b) => Number(b.ACTIVE_30D) - Number(a.ACTIVE_30D)).slice(0, 12);
  console.log('');
  console.log('Top 12 countries by ACTIVE_30D on ' + last + ':');
  for (const r of top) console.log('  ' + r.COUNTRY + '  active30d=' + r.ACTIVE_30D + '  payingActive=' + r.PAYING_ACTIVE + '  reg30d=' + r.REG_30D);

  conn.destroy(() => {});
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
