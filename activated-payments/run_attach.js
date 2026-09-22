#!/usr/bin/env node
/**
 * activated-payments/run_attach.js — runs sql/attach_rate_daily.sql and writes the CSV
 * that build_attach_data.py aggregates.
 *
 * Deliberately tiny and separate from pull.js. pull.js owns the payments data the whole
 * dashboard depends on and takes long enough already; this query is a full scan of
 * LOYVERSE_RECEIPTS (no clustering key, so filtering to ~100 merchants costs the same as
 * asking for everyone, about twelve minutes) and is wanted by exactly one tile. Keeping it
 * out means a slow or failing receipts scan can never delay or break the account layer.
 *
 * Same connection details as pull.js. If those ever move, they move in both.
 */

const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');

const ACCOUNT   = 'ORXEAZX-TC97659';
const USERNAME  = 'TARS_SERVICE_USER';
const KEY_PATH  = path.join(__dirname, '..', 'snowflake_tars_key.p8'); // written by CI at repo root
const DATABASE  = 'LOYVERSE_DATA_LAKE';
const SCHEMA    = 'PUBLIC';
const WAREHOUSE = 'COMPUTE_WH';
const ROLE      = 'DATA_VIEWER';

const SQL_FILE = path.join(__dirname, 'sql', 'attach_rate_daily.sql');
const OUT_CSV  = process.env.ATTACH_CSV || path.join(__dirname, 'work', 'attach_rate_daily.csv');

snowflake.configure({ logLevel: 'ERROR' });

function day(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    // Format from UTC parts rather than toISOString, so a Date built at local midnight
    // cannot slip a day — the same trap the marketing pull hit.
    return v.getUTCFullYear() + '-' + String(v.getUTCMonth() + 1).padStart(2, '0') +
           '-' + String(v.getUTCDate()).padStart(2, '0');
  }
  return String(v).slice(0, 10);
}

function main() {
  const conn = snowflake.createConnection({
    account: ACCOUNT, username: USERNAME, authenticator: 'SNOWFLAKE_JWT',
    privateKey: fs.readFileSync(KEY_PATH, 'utf8'),
    database: DATABASE, schema: SCHEMA, warehouse: WAREHOUSE, role: ROLE,
  });
  conn.connect(err => {
    if (err) { console.error('✗ connect:', err.message); process.exit(1); }
    const sql = fs.readFileSync(SQL_FILE, 'utf8').replace(/;\s*$/, '');
    const t0 = Date.now();
    conn.execute({
      sqlText: sql,
      complete: (e, stmt, rows) => {
        if (e) { console.error('✗ attach query:', e.message); process.exit(1); }
        const cols = ['MERCHANT_ID', 'D', 'LP_USD', 'LP_TXNS', 'POS_USD', 'POS_USD_UNCAPPED', 'POS_RECEIPTS'];
        const get = (r, k) => (r[k] !== undefined ? r[k] : r[k.toLowerCase()]);
        const body = rows.map(r => cols.map(c => (c === 'D' ? day(get(r, c)) : get(r, c))).join(',')).join('\n');
        fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
        fs.writeFileSync(OUT_CSV, cols.join(',') + '\n' + body + '\n', 'utf8');
        const merchants = new Set(rows.map(r => get(r, 'MERCHANT_ID'))).size;
        console.log(`✓ attach_rate_daily: ${rows.length} merchant-days, ${merchants} merchants, ` +
                    `${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT_CSV}`);
        conn.destroy(() => process.exit(0));
      },
    });
  });
}

main();
