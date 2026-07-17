#!/usr/bin/env node
/**
 * activated-payments/pull.js — Daily Snowflake → Payments Activation data pull.
 *
 * Connects to Snowflake with the shared TARS service key, pulls the complete
 * payments-activated merchant population from the Stripe data share
 * (STRIPE.CONNECTED_ACCOUNTS), derives the account/status/KYC/linkage layer,
 * and regenerates activated-payments/activation-data.js. Netlify auto-deploys
 * on push. Volume / POS / subscription fields are preserved from the existing
 * data file until those layers are wired (schema is discovered below).
 *
 * ACCOUNT LAYER = fully live from Snowflake (this file).
 * TRANSACTION / POS / SUBSCRIPTION LAYER = preserved for now; the discovery
 * step writes _discovery.json so the exact charge/POS/subscription tables can
 * be wired in a fast follow.
 */

const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────────
const ACCOUNT   = 'ORXEAZX-TC97659';
const USERNAME  = 'TARS_SERVICE_USER';
const KEY_PATH  = path.join(__dirname, '..', 'snowflake_tars_key.p8'); // written by CI at repo root
const DATABASE  = 'LOYVERSE_DATA_LAKE';
const SCHEMA    = 'PUBLIC';
const WAREHOUSE = 'COMPUTE_WH';
const ROLE      = 'DATA_VIEWER';

const STRIPE_SHARE_DB = 'GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659';
const STRIPE_SCHEMA   = 'STRIPE';

const OUTPUT_FILE    = path.join(__dirname, 'activation-data.js');
const DISCOVERY_FILE = path.join(__dirname, '_discovery.json');
const SQL_DIR        = path.join(__dirname, 'sql');

// ── Snowflake helpers (mirrors snowflake-pull.js) ─────────────────────────────
function readPrivateKey() {
  const keyContent = fs.readFileSync(KEY_PATH, 'utf8');
  const privateKey = crypto.createPrivateKey({ key: keyContent, format: 'pem' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}
function createConnection() {
  return snowflake.createConnection({
    account: ACCOUNT, username: USERNAME, authenticator: 'SNOWFLAKE_JWT',
    privateKey: readPrivateKey(), database: DATABASE, schema: SCHEMA,
    warehouse: WAREHOUSE, role: ROLE,
  });
}
function executeQuery(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, stmt, rows) => err ? reject(new Error(`${err.message}`)) : resolve(rows),
    });
  });
}
function connectAsync(connection) {
  return new Promise((resolve, reject) => {
    connection.connect((err, conn) => err ? reject(new Error(err.message)) : resolve(conn));
  });
}
function loadSql(file) { return fs.readFileSync(path.join(SQL_DIR, file), 'utf8'); }

// ── Field mapping helpers ─────────────────────────────────────────────────────
function truthy(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return ['true', 't', 'yes', 'y', '1'].includes(v.trim().toLowerCase());
  return false;
}
function toDate(v) {
  if (v == null || v === '') return null;
  // Stripe share CREATED can be a JS Date, ISO string, or unix seconds.
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else {
    const n = Number(v);
    d = (!isNaN(n) && String(v).trim() !== '') ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  }
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function btypeOf(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'company') return 'Company';
  if (s === 'individual') return 'Individual';
  if (s === 'non_profit' || s === 'nonprofit') return 'Non-profit';
  return '';
}
function statusOf(chargesEnabled, disabledReason) {
  if (truthy(chargesEnabled)) return 'Enabled';
  if (String(disabledReason || '').toLowerCase().startsWith('rejected')) return 'Rejected';
  return 'Restricted';
}

// requirement code → human label (extend as new codes appear)
const KYC_MAP = [
  [/^business_profile\.url/, 'Business website URL'],
  [/^business_profile\.mcc/, 'Business category'],
  [/^business_profile\.product_description/, 'Product description'],
  [/^external_account/, 'Bank account for payouts'],
  [/^individual\.dob/, 'Date of birth'],
  [/^individual\.address/, 'Home address'],
  [/^individual\.verification\.document/, 'ID document'],
  [/^individual\.id_number/, 'ID/Tax number'],
  [/^individual\.(first_name|last_name)/, 'Legal name'],
  [/^individual\.email/, 'Email'],
  [/^individual\.phone/, 'Phone number'],
  [/^company\.tax_id/, 'Company tax ID'],
  [/^company\.name/, 'Legal company name'],
  [/^company\.address/, 'Company address'],
  [/^company\.verification\.document/, 'Company document'],
  [/^tos_acceptance/, 'Terms of Service acceptance'],
  [/(representative|owners|directors|executives)/, 'Business representatives'],
];
function labelFor(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  for (const [re, label] of KYC_MAP) if (re.test(c)) return label;
  return null; // unknown codes ignored (logged in discovery)
}
function parseReqList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  const s = String(v).trim();
  if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(String); } catch (e) {} }
  return s.replace(/^[\[{]|[\]}]$/g, '').split(',').map(x => x.replace(/^["'\s]+|["'\s]+$/g, '')).filter(Boolean);
}

// ── Read existing data file to preserve transaction / POS / subscription fields ─
const PRESERVE_KEYS = ['vol_gbp', 'bal_gbp', 'processing', 'pos_gtv_usd', 'pos_receipts',
  'pos_active_days', 'last_sale', 'days_since_sale', 'pos_active', 'card_vol_usd',
  'sub_status', 'plan', 'mrr', 'is_paying'];
function readExisting() {
  const byAcct = {};
  try {
    const txt = fs.readFileSync(OUTPUT_FILE, 'utf8');
    const m = txt.match(/window\.__ACT\s*=\s*(\[[\s\S]*?\]);\s*\n\s*window\.__ACT_KYC/);
    if (m) { for (const r of JSON.parse(m[1])) byAcct[r.acct] = r; }
  } catch (e) { console.log('No existing activation-data.js to merge (first run) —', e.message); }
  return byAcct;
}

// ── Schema discovery (self-committing, so we can wire volume/POS/subs next) ────
async function discover(conn) {
  const out = { ranAt: new Date().toISOString(), stripeShare: {}, loyverseLake: {}, connectedAccountsColumns: [], notes: [] };
  async function safe(label, sql) {
    try { const rows = await executeQuery(conn, sql); return rows; }
    catch (e) { out.notes.push(`${label}: ${e.message}`); return []; }
  }
  const stTables = await safe('stripe SHOW TABLES', `SHOW TABLES IN SCHEMA ${STRIPE_SHARE_DB}.${STRIPE_SCHEMA}`);
  const stViews  = await safe('stripe SHOW VIEWS',  `SHOW VIEWS IN SCHEMA ${STRIPE_SHARE_DB}.${STRIPE_SCHEMA}`);
  out.stripeShare.tables = stTables.map(t => ({ name: t.name, rows: t.rows }));
  out.stripeShare.views  = stViews.map(v => ({ name: v.name }));
  const lkTables = await safe('lake SHOW TABLES', `SHOW TABLES IN SCHEMA ${DATABASE}.${SCHEMA}`);
  const lkViews  = await safe('lake SHOW VIEWS',  `SHOW VIEWS IN SCHEMA ${DATABASE}.${SCHEMA}`);
  out.loyverseLake.tables = lkTables.map(t => ({ name: t.name, rows: t.rows }));
  out.loyverseLake.views  = lkViews.map(v => ({ name: v.name }));
  // Confirm CONNECTED_ACCOUNTS columns actually exist as referenced
  const cols = await safe('describe CONNECTED_ACCOUNTS',
    `DESCRIBE TABLE ${STRIPE_SHARE_DB}.${STRIPE_SCHEMA}.CONNECTED_ACCOUNTS`);
  out.connectedAccountsColumns = cols.map(c => c.name);
  // Peek at charge-like tables' columns to plan the volume layer
  const chargeLike = out.stripeShare.tables
    .map(t => t.name)
    .filter(n => /CHARGE|PAYMENT_INTENT|BALANCE_TRANSACTION|TRANSFER|PAYOUT/i.test(n));
  out.chargeCandidates = {};
  for (const name of chargeLike.slice(0, 8)) {
    const c = await safe(`describe ${name}`, `DESCRIBE TABLE ${STRIPE_SHARE_DB}.${STRIPE_SCHEMA}.${name}`);
    out.chargeCandidates[name] = c.map(x => x.name);
  }
  fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ Wrote ${DISCOVERY_FILE} — stripe tables: ${out.stripeShare.tables.length}, lake tables: ${out.loyverseLake.tables.length}, charge candidates: ${chargeLike.length}`);
}

// ── Build activation-data.js from account rows ────────────────────────────────
function buildData(accountRows, existingByAcct) {
  const G = k => r => r[k] !== undefined ? r[k] : r[k.toLowerCase()];
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);

  const act = [];
  const kyc = {};
  let linked = 0, enabled = 0;

  for (const r of accountRows) {
    const acct   = get(r, 'stripe_account_id');
    const mid    = get(r, 'merchant_id');
    const name   = get(r, 'business_name') || get(r, 'contact_name') || get(r, 'email') || acct;
    const email  = get(r, 'email') || '';
    const country = get(r, 'country') || '';
    const chargesEnabled = get(r, 'charges_enabled');
    const disabledReason = get(r, 'disabled_reason');
    const status = statusOf(chargesEnabled, disabledReason);
    if (status === 'Enabled') enabled++;

    const midStr = (mid !== null && mid !== undefined && String(mid).trim() !== '') ? String(mid).trim() : null;
    if (midStr) linked++;

    const prev = existingByAcct[acct] || {};
    const rec = {
      acct,
      name: String(name),
      email: String(email),
      country: String(country),
      status,
      connected: toDate(get(r, 'stripe_connected_at')),
      btype: btypeOf(get(r, 'legal_entity_type')),
      mid: midStr,
      match: midStr ? 'stripe-metadata' : '',
    };
    // preserve transaction / POS / subscription layer from existing file (until wired)
    for (const k of PRESERVE_KEYS) rec[k] = (prev[k] !== undefined ? prev[k] : defaultFor(k));

    act.push(rec);

    // KYC pending (only for non-enabled)
    if (status !== 'Enabled') {
      const codes = [...parseReqList(get(r, 'requirements_currently_due')),
                     ...parseReqList(get(r, 'requirements_past_due'))];
      const labels = [...new Set(codes.map(labelFor).filter(Boolean))];
      if (labels.length) {
        const key = email ? email.toLowerCase() : acct;
        kyc[key] = labels;
      }
    }
  }
  return { act, kyc, linked, enabled };
}
function defaultFor(k) {
  if (k === 'vol_gbp' || k === 'bal_gbp' || k === 'card_vol_usd') return 0;
  if (k === 'processing' || k === 'pos_active' || k === 'is_paying') return false;
  return null; // pos_gtv_usd, pos_receipts, pos_active_days, last_sale, days_since_sale, sub_status, plan, mrr
}

function writeData(act, kyc) {
  const today = new Date().toISOString().slice(0, 10);
  const out =
`// Payments Activation data — regenerated daily by activated-payments/pull.js (Snowflake → CI → Netlify).
// Account/status/KYC/linkage layer is LIVE from STRIPE.CONNECTED_ACCOUNTS.
// Volume/POS/subscription fields are preserved pending the transaction-layer wiring.
// Do NOT edit by hand; changes are overwritten each morning. Last pull: ${today}
window.__ACT_LAST_UPDATED = ${JSON.stringify(today)};
window.__ACT = ${JSON.stringify(act)};
window.__ACT_KYC = ${JSON.stringify(kyc)};
`;
  fs.writeFileSync(OUTPUT_FILE, out, 'utf8');
  console.log(`✓ Wrote ${OUTPUT_FILE} (${(out.length / 1024).toFixed(1)} KB)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Payments Activation × Snowflake pull — ${new Date().toISOString()}`);
  const conn = createConnection();
  await connectAsync(conn);
  console.log('✓ Connected to Snowflake');

  const existingByAcct = readExisting();
  console.log(`Existing records to merge: ${Object.keys(existingByAcct).length}`);

  let accountRows = [];
  try {
    accountRows = await executeQuery(conn, loadSql('connected_accounts.sql'));
    console.log(`✓ connected_accounts: ${accountRows.length} rows`);
  } catch (e) {
    console.error(`✗ connected_accounts query failed: ${e.message}`);
    process.exit(1);
  }

  const { act, kyc, linked, enabled } = buildData(accountRows, existingByAcct);
  writeData(act, kyc);

  // Discovery for the next layer (non-fatal)
  try { await discover(conn); } catch (e) { console.log('discovery skipped:', e.message); }

  console.log('\n── Summary ──────────────────────────────');
  console.log(`accounts:        ${act.length}`);
  console.log(`enabled:         ${enabled}`);
  console.log(`linked (mid):    ${linked}  |  unlinked: ${act.length - linked}`);
  console.log(`KYC pending map: ${Object.keys(kyc).length} merchants`);

  conn.destroy(() => console.log('✓ Connection closed'));
}

main().catch(err => { console.error(`✗ Unhandled: ${err.message}`); console.error(err.stack); process.exit(1); });
