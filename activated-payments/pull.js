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

// ── Runtime-parameterized lookups (linkage / subscription / POS) ──────────────
// owner_id values are numeric Loyverse merchant ids; keep only digit strings so the
// IN-lists are safe and automation-derived (never hardcoded).
function sanitizeIds(ids) {
  return [...new Set(ids.map(v => String(v == null ? '' : v).trim()).filter(v => /^\d+$/.test(v)))];
}
async function fetchAccountMeta(conn) {
  // acct -> { owner_id (real Loyverse merchant id), environment ('prod'|'test'), release_date }
  const rows = await executeQuery(conn, loadSql('account_metadata.sql'));
  const by = {};
  for (const r of rows) {
    const acct = r.ACCT !== undefined ? r.ACCT : r.acct;
    by[acct] = {
      owner_id: (r.OWNER_ID != null && String(r.OWNER_ID).trim() !== '') ? String(r.OWNER_ID).trim() : null,
      environment: (r.ENVIRONMENT ? String(r.ENVIRONMENT).toLowerCase() : null),
      release_date: r.RELEASE_DATE || null,
    };
  }
  return by;
}
async function fetchSubscriptions(conn, merchantIds) {
  const ids = sanitizeIds(merchantIds);
  if (!ids.length) return {};
  const sql = loadSql('subscriptions.sql').replace('/*MERCHANT_IDS*/', ids.join(','));
  const rows = await executeQuery(conn, sql);
  const rank = s => { const x = String(s || '').toLowerCase(); return x === 'active' ? 3 : x === 'non_renewing' ? 2 : x === 'in_trial' ? 1 : 0; };
  const by = {};
  for (const r of rows) {
    const m = String(r.MERCHANT_ID);
    // Chargebee MRR is stored in the currency's minor unit (cents); convert to major
    // unit for display (e.g. 417 → 4.17). Values remain per-merchant in each
    // subscription's own currency (see CURRENCY_CODE) — cross-currency totals need FX.
    const cand = { status: r.STATUS || null, plan: r.PLAN_ID || null, mrr: r.MRR != null ? Math.round(Number(r.MRR)) / 100 : null };
    const cur = by[m];
    if (!cur || rank(cand.status) > rank(cur.status) ||
        (rank(cand.status) === rank(cur.status) && (cand.mrr || 0) > (cur.mrr || 0))) by[m] = cand;
  }
  return by;
}
async function fetchSales(conn, merchantIds) {
  const ids = sanitizeIds(merchantIds);
  if (!ids.length) return {};
  const sql = loadSql('sales_monthly.sql').replace('/*MERCHANT_IDS*/', ids.join(','));
  const rows = await executeQuery(conn, sql);
  const by = {};
  for (const r of rows) {
    const m = String(r.MERCHANT_ID);
    by[m] = {
      receipts: r.RECEIPTS != null ? Number(r.RECEIPTS) : null,
      active_months: r.ACTIVE_MONTHS != null ? Number(r.ACTIVE_MONTHS) : null,
      last_month: r.LAST_MONTH != null ? r.LAST_MONTH : null,
    };
  }
  return by;
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
  // The Stripe share exposes VIEWS (not tables), so build the object universe from both.
  const stripeObjs = [...out.stripeShare.tables.map(t => t.name), ...out.stripeShare.views.map(v => v.name)];
  const lakeObjs   = [...out.loyverseLake.tables.map(t => t.name), ...out.loyverseLake.views.map(v => v.name)];

  // Confirm CONNECTED_ACCOUNTS columns actually exist as referenced
  const cols = await safe('describe CONNECTED_ACCOUNTS',
    `DESCRIBE VIEW ${STRIPE_SHARE_DB}.${STRIPE_SCHEMA}.CONNECTED_ACCOUNTS`);
  out.connectedAccountsColumns = cols.map(c => c.name);

  // Helper: describe an object (view or table) in a given db.schema and record its columns.
  out.describe = {};
  async function describeObj(db, schema, name) {
    const c = await safe(`describe ${name}`, `DESCRIBE VIEW ${db}.${schema}."${name}"`);
    out.describe[name] = c.map(x => x.name);
    return out.describe[name];
  }
  // Helper: sample a few rows (guarded LIMIT) so we can see key names / value shapes.
  out.samples = {};
  async function sampleObj(label, db, schema, name, cols, limit) {
    const collist = cols ? cols.map(c => `"${c}"`).join(', ') : '*';
    const rows = await safe(`sample ${name}`, `SELECT ${collist} FROM ${db}.${schema}."${name}" LIMIT ${limit || 5}`);
    out.samples[label] = rows;
    return rows;
  }

  // ── LINKAGE candidates ──────────────────────────────────────────────────────
  // MERCHANT_ID on CONNECTED_ACCOUNTS is a platform-level constant (same for every
  // row), so it is NOT a per-merchant Loyverse id. The real linkage is likely in the
  // account metadata (a loyverse merchant/owner id key) or via an email join to the
  // LOYVERSE_MERCHANTS view. Describe + sample both to decide.
  if (stripeObjs.includes('CONNECTED_ACCOUNTS_METADATA')) {
    await describeObj(STRIPE_SHARE_DB, STRIPE_SCHEMA, 'CONNECTED_ACCOUNTS_METADATA');
    await sampleObj('CONNECTED_ACCOUNTS_METADATA', STRIPE_SHARE_DB, STRIPE_SCHEMA, 'CONNECTED_ACCOUNTS_METADATA', null, 25);
  }
  if (lakeObjs.includes('LOYVERSE_MERCHANTS')) {
    await describeObj(DATABASE, SCHEMA, 'LOYVERSE_MERCHANTS');
    await sampleObj('LOYVERSE_MERCHANTS', DATABASE, SCHEMA, 'LOYVERSE_MERCHANTS', null, 3);
  }

  // ── VOLUME (real vs test) candidates ────────────────────────────────────────
  for (const name of ['CONNECTED_ACCOUNT_CHARGES', 'CONNECTED_ACCOUNT_SUMMARIZED_BALANCE_TRANSACTIONS',
                       'CONNECTED_ACCOUNT_BALANCE_TRANSACTIONS', 'CONNECTED_ACCOUNT_PAYMENT_INTENTS']) {
    if (stripeObjs.includes(name)) await describeObj(STRIPE_SHARE_DB, STRIPE_SCHEMA, name);
  }

  // ── POS GTV / receipts candidates ───────────────────────────────────────────
  for (const name of ['SALES_PER_ACCOUNT_MONTHLY', 'LOYVERSE_RECEIPTS']) {
    if (lakeObjs.includes(name)) await describeObj(DATABASE, SCHEMA, name);
  }

  // ── SUBSCRIPTION / MRR candidates (Chargebee) ───────────────────────────────
  for (const name of ['CHARGEBEE_SUBSCRIPTIONS_V', 'CHARGEBEE_CUSTOMERS_V']) {
    if (lakeObjs.includes(name)) await describeObj(DATABASE, SCHEMA, name);
  }

  fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ Wrote ${DISCOVERY_FILE} — stripe views: ${out.stripeShare.views.length}, lake objs: ${lakeObjs.length}, described: ${Object.keys(out.describe).length}, sampled: ${Object.keys(out.samples).length}`);
}

// ── Build activation-data.js from account rows ────────────────────────────────
function buildData(accountRows, existingByAcct, meta, subs, sales) {
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  meta = meta || {}; subs = subs || {}; sales = sales || {};

  const act = [];
  const kyc = {};
  let linked = 0, enabled = 0, prodN = 0, testN = 0, withSub = 0, withPos = 0;

  const today = new Date();
  const daysSince = (ym) => {
    // SALES_PER_ACCOUNT_MONTHLY.MONTH may be a Date or 'YYYY-MM'/'YYYY-MM-DD' string.
    if (!ym) return null;
    let d = (ym instanceof Date) ? ym : new Date(/^\d{4}-\d{2}$/.test(String(ym)) ? `${ym}-01` : String(ym));
    if (isNaN(d.getTime())) return null;
    return Math.max(0, Math.round((today - d) / 86400000));
  };
  const fmtMonth = (ym) => {
    if (!ym) return null;
    if (ym instanceof Date) return ym.toISOString().slice(0, 10);
    return /^\d{4}-\d{2}$/.test(String(ym)) ? `${ym}-01` : String(ym).slice(0, 10);
  };

  for (const r of accountRows) {
    const acct   = get(r, 'stripe_account_id');
    const name   = get(r, 'business_name') || get(r, 'contact_name') || get(r, 'email') || acct;
    const email  = get(r, 'email') || '';
    const country = get(r, 'country') || '';
    const chargesEnabled = get(r, 'charges_enabled');
    const disabledReason = get(r, 'disabled_reason');
    const status = statusOf(chargesEnabled, disabledReason);
    if (status === 'Enabled') enabled++;

    // Real per-merchant linkage comes from account metadata owner_id, NOT the
    // platform-constant CONNECTED_ACCOUNTS.MERCHANT_ID.
    const m = meta[acct] || {};
    const midStr = m.owner_id || null;
    const env = m.environment || null;
    if (midStr) linked++;
    if (env === 'prod') prodN++; else if (env === 'test') testN++;

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
      match: midStr ? 'stripe-metadata-owner_id' : '',
      env, // 'prod' | 'test' | null  (real-vs-test signal)
    };
    // start from preserved values, then overlay any live layers we now compute
    for (const k of PRESERVE_KEYS) rec[k] = (prev[k] !== undefined ? prev[k] : defaultFor(k));

    // subscription / MRR layer (live from Chargebee, keyed by Loyverse merchant id)
    const sub = midStr ? subs[midStr] : null;
    if (sub) {
      withSub++;
      rec.sub_status = sub.status;
      rec.plan = sub.plan;
      rec.mrr = sub.mrr;
      rec.is_paying = String(sub.status || '').toLowerCase() === 'active' && (sub.mrr || 0) > 0;
    }

    // POS receipts layer (live from SALES_PER_ACCOUNT_MONTHLY; monthly granularity)
    const sal = midStr ? sales[midStr] : null;
    if (sal) {
      withPos++;
      rec.pos_receipts = sal.receipts;
      rec.last_sale = fmtMonth(sal.last_month);
      rec.days_since_sale = daysSince(sal.last_month);
      rec.pos_active = (sal.receipts || 0) > 0 && (daysSince(sal.last_month) == null || daysSince(sal.last_month) <= 90);
      // NOTE: pos_gtv_usd (money) and pos_active_days (daily granularity) still pending
      // the heavier LOYVERSE_RECEIPTS per-receipt query.
    }

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
  return { act, kyc, linked, enabled, prodN, testN, withSub, withPos };
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
// LIVE: account/status/KYC (CONNECTED_ACCOUNTS), linkage + real-vs-test (CONNECTED_ACCOUNTS_METADATA
//       owner_id/environment), subscription/MRR (CHARGEBEE_SUBSCRIPTIONS_V), POS receipts
//       (SALES_PER_ACCOUNT_MONTHLY, monthly granularity).
// PENDING: payment volume $ (CONNECTED_ACCOUNT_CHARGES + FX) and per-receipt POS GTV.
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

  // Real per-merchant linkage (owner_id) + real-vs-test (environment) from metadata.
  let meta = {};
  try {
    meta = await fetchAccountMeta(conn);
    const owners = Object.values(meta).filter(x => x.owner_id).length;
    console.log(`✓ account_metadata: ${Object.keys(meta).length} accounts (${owners} with owner_id)`);
  } catch (e) { console.error(`✗ account_metadata query failed (linkage will be empty): ${e.message}`); }

  // Merchant ids drive the subscription + POS lookups (runtime-derived, never hardcoded).
  const merchantIds = Object.values(meta).map(x => x.owner_id).filter(Boolean);

  let subs = {}, sales = {};
  const [subsR, salesR] = await Promise.allSettled([
    fetchSubscriptions(conn, merchantIds),
    fetchSales(conn, merchantIds),
  ]);
  if (subsR.status === 'fulfilled') { subs = subsR.value; console.log(`✓ subscriptions: ${Object.keys(subs).length} merchants`); }
  else console.error(`✗ subscriptions query failed: ${subsR.reason && subsR.reason.message}`);
  if (salesR.status === 'fulfilled') { sales = salesR.value; console.log(`✓ sales_monthly: ${Object.keys(sales).length} merchants`); }
  else console.error(`✗ sales_monthly query failed: ${salesR.reason && salesR.reason.message}`);

  const { act, kyc, linked, enabled, prodN, testN, withSub, withPos } = buildData(accountRows, existingByAcct, meta, subs, sales);
  writeData(act, kyc);

  // Discovery refresh for the remaining volume layer (non-fatal)
  try { await discover(conn); } catch (e) { console.log('discovery skipped:', e.message); }

  console.log('\n── Summary ──────────────────────────────');
  console.log(`accounts:        ${act.length}`);
  console.log(`enabled:         ${enabled}`);
  console.log(`environment:     prod=${prodN}  test=${testN}  unknown=${act.length - prodN - testN}`);
  console.log(`linked (mid):    ${linked}  |  unlinked: ${act.length - linked}`);
  console.log(`with subscription: ${withSub}  |  with POS receipts: ${withPos}`);
  console.log(`KYC pending map: ${Object.keys(kyc).length} merchants`);

  conn.destroy(() => console.log('✓ Connection closed'));
}

main().catch(err => { console.error(`✗ Unhandled: ${err.message}`); console.error(err.stack); process.exit(1); });
