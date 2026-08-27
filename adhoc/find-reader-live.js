// AD-HOC (2026-08-27): is the terminal reader model really absent from the share?
//
// Felipe pointed at the Stripe dashboard: reader tmr_Gl5JrQjZdy1mQb on connected account
// acct_1TtuAL7C646Nqh7e is a "Stripe Reader S710", serial STR71Z1H611000106. Stripe plainly knows.
// My claim was narrower — that the SHARE does not expose it — and I based it on _discovery.json,
// a snapshot, plus one COUNT(*) on TERMINAL_READERS. That is not good enough to tell someone a
// thing cannot be done.
//
// This asks the warehouse directly:
//   1. Every view in the share whose NAME mentions terminal, reader or device — from
//      INFORMATION_SCHEMA, live, not from a snapshot that could be stale or partial.
//   2. Every view with a COLUMN mentioning reader or device, which catches a view whose name
//      gives no hint that it carries the field.
//   3. TERMINAL_READERS itself: how many rows, and whose.
//   4. That specific reader id, looked up wherever it might live.
//   5. The hardware-order fallback: which SKUs each merchant ordered, and for how many merchants
//      that is unambiguous enough to attribute their readers by elimination.
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
const DB = 'GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659';
const S = DB + '.STRIPE';
const q = (sql) => new Promise((res, rej) => conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));
const show = (label, rows) => {
  console.log('\n--- ' + label + ' ---');
  if (!rows || !rows.length) return console.log('  (no rows)');
  console.table(rows.slice(0, 40));
};

const READER = 'tmr_Gl5JrQjZdy1mQb';
const ACCT = 'acct_1TtuAL7C646Nqh7e';

conn.connect(async (err) => {
  if (err) { console.error('connect failed:', err.message); process.exit(1); }
  try {
    console.log('=== 1. views in the share whose NAME mentions terminal / reader / device ===');
    show('by name', await q(`
      SELECT TABLE_NAME, TABLE_TYPE
      FROM ${DB}.INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'STRIPE'
        AND (TABLE_NAME ILIKE '%TERMINAL%' OR TABLE_NAME ILIKE '%READER%' OR TABLE_NAME ILIKE '%DEVICE%')
      ORDER BY TABLE_NAME`));

    console.log('\n=== 2. views with a COLUMN mentioning reader / device / serial ===');
    show('by column', await q(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM ${DB}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'STRIPE'
        AND (COLUMN_NAME ILIKE '%READER%' OR COLUMN_NAME ILIKE '%DEVICE%' OR COLUMN_NAME ILIKE '%SERIAL%')
      ORDER BY TABLE_NAME, COLUMN_NAME`));

    console.log('\n=== 3. what is actually in TERMINAL_READERS ===');
    show('rows and owners', await q(`
      SELECT MERCHANT_ID, COUNT(*) AS READERS,
             COUNT(DISTINCT DEVICE_TYPE) AS DEVICE_TYPES,
             MIN(DEVICE_TYPE) AS EXAMPLE_TYPE
      FROM ${S}.TERMINAL_READERS GROUP BY 1 ORDER BY READERS DESC`));

    console.log('\n=== 4. the reader Felipe pointed at ===');
    show('in TERMINAL_READERS', await q(`
      SELECT * FROM ${S}.TERMINAL_READERS WHERE ID = '${READER}'`));
    show('does that account appear in TERMINAL_READERS at all', await q(`
      SELECT COUNT(*) AS N FROM ${S}.TERMINAL_READERS WHERE MERCHANT_ID = '${ACCT}'`));
    show('does it appear on charges', await q(`
      SELECT COUNT(*) AS CHARGES, MIN(d.CHARGE_ID) AS EXAMPLE
      FROM ${S}.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d
      WHERE d.TERMINAL_READER_ID = '${READER}'`));

    console.log('\n=== 5. the hardware-order fallback: what did each merchant buy? ===');
    show('SKUs ordered across all merchants', await q(`
      SELECT TERMINAL_HARDWARE_SKU_PRODUCT_TYPE AS SKU_TYPE,
             TERMINAL_HARDWARE_SKU_PRODUCT_ID   AS SKU_ID,
             COUNT(*) AS ORDER_LINES, SUM(QUANTITY) AS UNITS
      FROM ${S}.TERMINAL_HARDWARE_ORDER_ITEMS
      GROUP BY 1,2 ORDER BY UNITS DESC`));

    // If a merchant only ever bought one model, every reader of theirs is that model. This counts
    // how much of the transacting base that would settle, and how much would stay ambiguous.
    show('merchants by number of distinct SKUs ordered', await q(`
      WITH per_order AS (
        SELECT o.MERCHANT_ID AS PLATFORM, o.SHIPPING_EMAIL AS EMAIL,
               i.TERMINAL_HARDWARE_SKU_PRODUCT_TYPE AS SKU
        FROM ${S}.TERMINAL_HARDWARE_ORDERS o
        JOIN ${S}.TERMINAL_HARDWARE_ORDER_ITEMS i ON i.TERMINAL_HARDWARE_ORDER_ID = o.ID
      )
      SELECT N_SKUS, COUNT(*) AS MERCHANTS FROM (
        SELECT EMAIL, COUNT(DISTINCT SKU) AS N_SKUS FROM per_order GROUP BY EMAIL
      ) GROUP BY 1 ORDER BY 1`));
  } catch (e) {
    console.error('failed:', e.message);
    process.exitCode = 1;
  } finally { conn.destroy(() => {}); }
});
