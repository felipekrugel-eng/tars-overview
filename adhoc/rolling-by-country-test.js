// AD-HOC TEST (2026-07-28): validate rolling_30d_by_country_49days.sql before wiring
// it into kpi-pull. Runs ONLY the new per-country query (~9 min) and reconciles its
// rollup against the global reg30d/active30d/payingActive already committed in
// 'KPI Dashboard v2 (Caio)/daily-history.js' — no need to re-run the global query,
// which would blow the 15-min job cap. Read-only SELECT. Delete once verified.
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

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'kpi-automation', 'sql', 'rolling_30d_by_country_49days.sql'), 'utf8').replace(/;\s*$/, '');

// Snowflake DATE columns come back as JS Date objects — String(d).slice(0,10) yields
// "Fri Jul 03", which silently broke the join in the first run. Normalise to YYYY-MM-DD.
const dkey = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const p = new Date(v);
  return isNaN(p.getTime()) ? String(v).slice(0, 10) : p.toISOString().slice(0, 10);
};

// ---- global baseline straight from the committed dashboard data ----
function loadGlobal() {
  const src = fs.readFileSync(path.join(ROOT, 'KPI Dashboard v2 (Caio)', 'daily-history.js'), 'utf8');
  const m = src.match(/const\s+DAILY_HISTORY\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('could not parse DAILY_HISTORY out of daily-history.js');
  const rows = JSON.parse(m[1]);
  const by = {};
  for (const r of rows) by[r.date] = r;
  return by;
}

(async () => {
  const G = loadGlobal();
  console.log('global baseline rows parsed: ' + Object.keys(G).length);

  await new Promise((res, rej) => conn.connect((e) => e ? rej(e) : res()));
  console.log('connected; running per-country rolling query...');

  const t0 = Date.now();
  const rows = await q(SQL);
  console.log('country query: ' + rows.length + ' rows in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  const countries = new Set(rows.map(r => r.COUNTRY));
  console.log('distinct countries: ' + countries.size);
  const days = new Set(rows.map(r => dkey(r.SNAPSHOT_DATE)));
  console.log('distinct days: ' + days.size + '  (expect 49)');

  const up = {};
  for (const r of rows) {
    const d = dkey(r.SNAPSHOT_DATE);
    up[d] = up[d] || { reg30d: 0, active30d: 0, payingActive: 0 };
    up[d].reg30d       += Number(r.REG_30D || 0);
    up[d].active30d    += Number(r.ACTIVE_30D || 0);
    up[d].payingActive += Number(r.PAYING_ACTIVE || 0);
  }

  const F = ['reg30d', 'active30d', 'payingActive'];
  const worst = { reg30d: 0, active30d: 0, payingActive: 0 };
  const dates = Object.keys(up).sort();
  console.log('');
  console.log('date        metric          global   sum(country)      diff     diff%');
  for (const d of dates) {
    const g = G[d];
    if (!g) { console.log(d + '  (no global row in daily-history.js — skipped)'); continue; }
    for (const f of F) {
      if (g[f] == null) continue;
      const gv = Number(g[f]), cv = up[d][f];
      const pct = gv ? ((cv - gv) / gv) * 100 : 0;
      if (Math.abs(pct) > Math.abs(worst[f])) worst[f] = pct;
      const recent = dates.indexOf(d) >= dates.length - 5;
      if (recent || Math.abs(pct) > 1) {
        console.log(d + '  ' + f.padEnd(14) + String(gv).padStart(8) + String(cv).padStart(14) + String(cv - gv).padStart(10) + '   ' + pct.toFixed(2) + '%');
      }
    }
  }

  console.log('');
  console.log('WORST daily gap (country sum - global):');
  for (const f of F) console.log('  ' + f.padEnd(14) + worst[f].toFixed(2) + '%');
  console.log('');
  console.log('PASS looks like: reg30d and active30d within ~0.5% (every merchant has a');
  console.log('country); payingActive slightly NEGATIVE (Chargebee emails with no');
  console.log('LOYVERSE_MERCHANTS row have no country — known gap, same as the MRR-by-');
  console.log('country query). Positive gaps or large negatives mean double-counting.');

  const last = dates[dates.length - 1];
  const top = rows.filter(r => dkey(r.SNAPSHOT_DATE) === last)
                  .sort((a, b) => Number(b.ACTIVE_30D) - Number(a.ACTIVE_30D)).slice(0, 12);
  console.log('');
  console.log('Top 12 countries by active30d on ' + last + ':');
  for (const r of top) console.log('  ' + r.COUNTRY + '  active30d=' + r.ACTIVE_30D + '  payingActive=' + r.PAYING_ACTIVE + '  reg30d=' + r.REG_30D);

  conn.destroy(() => {});
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
