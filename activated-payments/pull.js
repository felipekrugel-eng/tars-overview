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
const OVERVIEW_FILE  = path.join(__dirname, 'overview-data.js');
const FUNNEL_FILE    = path.join(__dirname, 'funnel-data.js');
const PILOT_FILE     = path.join(__dirname, 'pilot500-data.js');
const DISCOVERY_FILE = path.join(__dirname, '_discovery.json');
const REPORT_FILE    = path.join(__dirname, 'report-data.js');
const PROFILE_FILE   = path.join(__dirname, 'profile-data.js');
// The cohort triangle lives on the KPI dashboard, which is a SEPARATE Cloudflare Pages site.
// A cross-origin fetch between the two would have to survive Cloudflare Access, so the payments
// pull writes the cohort membership straight into the other site's folder instead. Same repo,
// same deploy, no network hop.
const PAY_COHORT_FILE = path.join(__dirname, '..', 'KPI Dashboard v2 (Caio)', 'payments-cohort.json');
const SQL_DIR        = path.join(__dirname, 'sql');
// Loyverse Payments launch — start of the funnel entry cohort (US registrations on/after).
const LAUNCH_START   = '2026-07-01';

// ── LIVE MARKETS ──────────────────────────────────────────────────────────────
// Every market Loyverse Payments has launched in, in launch order. Adding a market here is
// the ONLY change needed to give it a full funnel: its entry cohort, its four group bases,
// its month-end base series and its slice of every Overview / Report series all follow.
//   cc         ISO-2 country as Stripe writes it on CONNECTED_ACCOUNTS.COUNTRY
//   launch     first day of the entry cohort — merchants registering on/after this date
//              count as "new" for that market
//   firstMonth earliest month the Funnel page's month filter can offer for this market
// NOTE — the UK launch date below is provisional. The first UK connected account appeared
// on 2026-08-11; 2026-08-01 is used so no August registrant is missed, which errs towards a
// slightly larger "new" group rather than silently dropping merchants. Confirm the real
// go-live date and correct it here; nothing else needs to change.
const MARKETS = [
  { cc: 'US', launch: '2026-07-01', firstMonth: '2026-04-01' },
  { cc: 'GB', launch: '2026-08-01', firstMonth: '2026-08-01' },
];
const MARKET_CCS = MARKETS.map(m => m.cc);
function marketFor(cc) { return MARKETS.find(m => m.cc === cc) || null; }

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

// ── FX / currency conversion (fixed map — mirrors the FACADASH TPV layer) ──────
// Stripe AMOUNT is in each currency's minor unit; ZERO_DECIMAL currencies have no
// minor unit (amount is already whole). Convert minor→major→USD for a single,
// comparable daily volume number.
const USD_RATE = {
  USD: 1.0, EUR: 1.16, GBP: 1.34, CAD: 0.74, AUD: 0.66, NZD: 0.60, CHF: 1.12,
  JPY: 0.0066, KRW: 0.00072, CNY: 0.14, HKD: 0.128, SGD: 0.74, INR: 0.012,
  IDR: 0.000063, PHP: 0.018, MYR: 0.21, THB: 0.028, VND: 0.000040, BRL: 0.17,
  MXN: 0.058, ARS: 0.00081, CLP: 0.0010, COP: 0.00023, PEN: 0.27, ZAR: 0.054,
  AED: 0.27, SAR: 0.27, TRY: 0.029, PLN: 0.25, SEK: 0.094, NOK: 0.093, DKK: 0.15,
};
const ZERO_DECIMAL = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG',
  'RWF','UGX','VND','VUV','XAF','XOF','XPF']);
function minorToUsd(amountMinor, ccy) {
  const c = String(ccy || '').toUpperCase().trim();
  const rate = USD_RATE[c];
  if (rate == null) return null; // unknown currency — excluded (logged in summary)
  const major = ZERO_DECIMAL.has(c) ? Number(amountMinor) : Number(amountMinor) / 100;
  return major * rate;
}
// Stripe connected-account ids look like acct_XXXX — keep only those so the IN-list
// is safe and fully runtime-derived (never hardcoded).
function sanitizeAccts(ids) {
  return [...new Set(ids.map(v => String(v == null ? '' : v).trim())
    .filter(v => /^acct_[A-Za-z0-9]+$/.test(v)))];
}
// ── COUNTRY DIMENSION (added 2026-08-17, UK launch) ───────────────────────────
// Loyverse Payments went live in the UK in August 2026, so every Overview / Funnel /
// Report series now carries a per-country breakdown alongside its blended total.
// The country is the MERCHANT's country of incorporation as Stripe holds it on the
// connected account (CONNECTED_ACCOUNTS.COUNTRY) — NOT the card's issuing country.
// Shape convention: each row keeps its existing blended field(s) untouched and gains
// a `by` object keyed by ISO-2 country, e.g. { d:'2026-08-17', n:9, by:{US:7,GB:2} }.
// Any consumer that ignores `by` therefore behaves exactly as it did before.
const CC_UNKNOWN = 'ZZ';   // account with no usable country on the Stripe record
function normCountry(v) {
  const c = String(v == null ? '' : v).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : CC_UNKNOWN;
}
// acct_XXXX -> 'US' | 'GB' | ... built once from connected_accounts.sql.
function buildCountryByAcct(accountRows) {
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const byAcct = {};
  for (const r of accountRows) {
    const acct = get(r, 'stripe_account_id');
    if (!acct) continue;
    byAcct[acct] = normCountry(get(r, 'country'));
  }
  return byAcct;
}
// Loyverse owner id -> country, via the account-metadata linkage. Used by the funnel,
// whose rows are keyed on owner id rather than on the Stripe account id.
function buildCountryByMid(countryByAcct, meta) {
  const byMid = {};
  for (const acct of Object.keys(countryByAcct)) {
    const oid = meta[acct] && meta[acct].owner_id;
    if (oid) byMid[String(oid)] = countryByAcct[acct];
  }
  return byMid;
}
// Add `v` to bucket `cc` of a `by` map, creating the bucket on first sight.
function bump(by, cc, v) { by[cc] = (by[cc] || 0) + v; }

async function fetchDailyVolume(conn, acctIds, countryByAcct) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return { byDay: {}, unknownCcy: {} };
  const inList = ids.map(a => `'${a}'`).join(',');
  const sql = loadSql('charges_daily.sql').replace('/*ACCOUNT_IDS*/', inList);
  const rows = await executeQuery(conn, sql);
  const cba = countryByAcct || {};
  const byDay = {};        // 'YYYY-MM-DD' -> { usd, cnt, by:{ CC:{usd,cnt} } }
  const unknownCcy = {};   // ccy -> count of skipped day-rows
  for (const r of rows) {
    const d = r.D != null ? String(r.D) : (r.d != null ? String(r.d) : null);
    if (!d) continue;
    const ccy = r.CCY != null ? r.CCY : r.ccy;
    const amt = r.AMOUNT_MINOR != null ? r.AMOUNT_MINOR : r.amount_minor;
    const cnt = r.CNT != null ? Number(r.CNT) : Number(r.cnt || 0);
    const usd = minorToUsd(amt, ccy);
    if (usd == null) { unknownCcy[String(ccy).toUpperCase()] = (unknownCcy[String(ccy).toUpperCase()] || 0) + 1; continue; }
    if (!byDay[d]) byDay[d] = { usd: 0, cnt: 0, by: {} };
    byDay[d].usd += usd;
    byDay[d].cnt += cnt;
    // charges_daily.sql now also groups by ACCOUNT so each day can be split by country.
    // If that column is ever absent the whole day lands in ZZ — the blended total stays
    // exact, the page simply cannot split that day, which is the safe failure mode.
    const acct = r.ACCOUNT != null ? r.ACCOUNT : r.account;
    const cc = acct ? (cba[acct] || CC_UNKNOWN) : CC_UNKNOWN;
    if (!byDay[d].by[cc]) byDay[d].by[cc] = { usd: 0, cnt: 0 };
    byDay[d].by[cc].usd += usd;
    byDay[d].by[cc].cnt += cnt;
  }
  return { byDay, unknownCcy };
}

// Per-account transacting aggregation (started / txns / volume) for the merchants table.
async function fetchTxnByAccount(conn, acctIds) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return {};
  const inList = ids.map(a => `'${a}'`).join(',');
  const sql = loadSql('charges_by_account.sql').replace('/*ACCOUNT_IDS*/', inList);
  const rows = await executeQuery(conn, sql);
  const by = {}; // acct -> { started, cnt, usd, usdKnown }
  for (const r of rows) {
    const acct = r.ACCOUNT != null ? r.ACCOUNT : r.account;
    if (!acct) continue;
    const ccy = r.CCY != null ? r.CCY : r.ccy;
    const cnt = Number(r.CNT != null ? r.CNT : r.cnt || 0);
    const amt = r.AMOUNT_MINOR != null ? r.AMOUNT_MINOR : r.amount_minor;
    const usd = minorToUsd(amt, ccy);
    if (!by[acct]) by[acct] = { started: null, cnt: 0, usd: 0, usdKnown: true };
    by[acct].cnt += cnt;
    if (usd == null) by[acct].usdKnown = false; else by[acct].usd += usd;
    const sd = toDate(r.STARTED != null ? r.STARTED : r.started);
    if (sd && (!by[acct].started || sd < by[acct].started)) by[acct].started = sd;
  }
  return by;
}

// Per-account captured application-fee revenue (Loyverse's take). Sourced from the
// balance-transaction fee-detail lines (TYPE='application_fee') — the dedicated
// APPLICATION_FEES view is empty in this share. AMOUNT is in the currency's minor unit.
async function fetchAppFeesByAccount(conn, acctIds) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return {};
  const inList = ids.map(a => `'${a}'`).join(',');
  const sql = loadSql('app_fees_by_account.sql').replace('/*ACCOUNT_IDS*/', inList);
  const rows = await executeQuery(conn, sql);
  const by = {}; // acct -> { capturedUsd, feeCnt, usdKnown }
  for (const r of rows) {
    const acct = r.ACCOUNT != null ? r.ACCOUNT : r.account;
    if (!acct) continue;
    const ccy = r.CCY != null ? r.CCY : r.ccy;
    const feeMinor = r.FEE_MINOR != null ? r.FEE_MINOR : r.fee_minor;
    const feeCnt = Number(r.FEE_CNT != null ? r.FEE_CNT : r.fee_cnt || 0);
    const usd = minorToUsd(feeMinor, ccy);
    if (!by[acct]) by[acct] = { capturedUsd: 0, feeCnt: 0, usdKnown: true };
    by[acct].feeCnt += feeCnt;
    if (usd == null) by[acct].usdKnown = false; else by[acct].capturedUsd += usd;
  }
  return by;
}

// Per-account Stripe cost (interchange++). ICPLUS TOTAL_AMOUNT is in the fee currency's
// MAJOR unit; convert straight to USD. Netted against captured fees to get margin.
async function fetchIcplusCostByAccount(conn, acctIds) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return {};
  const inList = ids.map(a => `'${a}'`).join(',');
  const sql = loadSql('icplus_cost_by_account.sql').replace('/*ACCOUNT_IDS*/', inList);
  const rows = await executeQuery(conn, sql);
  const by = {}; // acct -> { costUsd, costCnt, usdKnown }
  for (const r of rows) {
    const acct = r.ACCOUNT != null ? r.ACCOUNT : r.account;
    if (!acct) continue;
    const ccy = r.CCY != null ? r.CCY : r.ccy;
    const costMinor = r.COST_MINOR != null ? r.COST_MINOR : r.cost_minor;
    const costCnt = Number(r.COST_CNT != null ? r.COST_CNT : r.cost_cnt || 0);
    const usd = minorToUsd(costMinor, ccy);
    if (!by[acct]) by[acct] = { costUsd: 0, costCnt: 0, usdKnown: true };
    by[acct].costCnt += costCnt;
    if (usd == null) by[acct].usdKnown = false; else by[acct].costUsd += usd;
  }
  return by;
}

// ── Read existing data file to preserve transaction / POS / subscription fields ─
// last_sale / pos_receipts / pos_gtv_usd are OBSERVATIONS — safe to carry forward when a
// day's query returns no row for a merchant. days_since_sale and pos_active are DERIVED from
// last_sale and must NOT be preserved: doing so froze them at whatever they were on the run
// that last saw a sales row, so a merchant stayed "active" indefinitely (48 of 193 accounts
// had a days_since_sale that contradicted their own last_sale — e.g. 2 days since a 12 Jul
// sale, read on 3 Aug). They are recomputed from the preserved last_sale on every run below.
const PRESERVE_KEYS = ['vol_gbp', 'bal_gbp', 'processing', 'pos_gtv_usd', 'pos_receipts',
  'pos_active_days', 'last_sale', 'card_vol_usd',
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

// ── Overview page (FACADASH-style daily report) ───────────────────────────────
// Read the previously-committed enabled snapshot so the "enabled per day" curve
// grows forward from the first run (Stripe has NO historical KYC-pass timestamp,
// so it cannot be backfilled — we snapshot the as-of enabled count each morning).
function readExistingSnapshot() {
  try {
    const txt = fs.readFileSync(OVERVIEW_FILE, 'utf8');
    const m = txt.match(/window\.__PAY_ENABLED_SNAP\s*=\s*(\[[\s\S]*?\]);/);
    if (m) { const a = JSON.parse(m[1]); if (Array.isArray(a)) return a; }
  } catch (e) { console.log('No existing overview-data.js snapshot (first run) —', e.message); }
  return [];
}

// Prod-only daily activations from the account population (CONNECTED_ACCOUNTS.CREATED).
// All accounts are Loyverse-Payments activations; env='prod' excludes test accounts.
function buildActivationsDaily(accountRows, meta) {
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const byDay = {};
  const byDayC = {};   // d -> { CC: n }  (country split, added for the UK launch)
  for (const r of accountRows) {
    const acct = get(r, 'stripe_account_id');
    const env = (meta[acct] && meta[acct].environment) || null;
    if (env === 'test') continue; // prod + unknown counted as real activations
    const d = toDate(get(r, 'stripe_connected_at'));
    if (!d) continue;
    byDay[d] = (byDay[d] || 0) + 1;
    if (!byDayC[d]) byDayC[d] = {};
    bump(byDayC[d], normCountry(get(r, 'country')), 1);
  }
  return Object.keys(byDay).sort().map(d => ({ d, n: byDay[d], by: byDayC[d] || {} }));
}

// Prod-only ENABLED-per-day, BACKFILLED from the "Terms accepted" date.
// Stripe has no explicit "charges_enabled_at" timestamp, but for accounts that are
// currently Enabled (passed KYC), TOS_ACCEPTANCE_DATE is the moment the merchant
// completed onboarding — the practical KYC-pass date Felipe pointed to. Fall back to
// the connected date when TOS is null. This replaces the forward-only snapshot with a
// true historical curve.
function buildEnabledDaily(accountRows, meta) {
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const byDay = {};
  const byDayC = {};   // d -> { CC: n }  (country split, added for the UK launch)
  for (const r of accountRows) {
    const acct = get(r, 'stripe_account_id');
    const env = (meta[acct] && meta[acct].environment) || null;
    if (env === 'test') continue;
    const status = statusOf(get(r, 'charges_enabled'), get(r, 'disabled_reason'));
    if (status !== 'Enabled') continue;
    const d = toDate(get(r, 'tos_accepted_at')) || toDate(get(r, 'stripe_connected_at'));
    if (!d) continue;
    byDay[d] = (byDay[d] || 0) + 1;
    if (!byDayC[d]) byDayC[d] = {};
    bump(byDayC[d], normCountry(get(r, 'country')), 1);
  }
  return Object.keys(byDay).sort().map(d => ({ d, n: byDay[d], by: byDayC[d] || {} }));
}

// Per-merchant "transacting through Loyverse Payments" table rows. Joins the account
// name/linkage with the charge aggregation (started / txns / volume) and the captured
// application-fee revenue (captured / effective take-rate). margin (net after Stripe
// cost) is left null until the fee-detail columns are confirmed via _discovery.json.
function buildTxnMerchants(accountRows, meta, txnByAcct, feeByAcct, costByAcct, countryByAcct) {
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const cba = countryByAcct || {};
  const nameByAcct = {};
  for (const r of accountRows) {
    const acct = get(r, 'stripe_account_id');
    nameByAcct[acct] = get(r, 'business_name') || get(r, 'contact_name') || get(r, 'email') || acct;
  }
  const out = [];
  for (const acct of Object.keys(txnByAcct)) {
    const t = txnByAcct[acct];
    if (!t || !t.cnt) continue;
    const f = (feeByAcct && feeByAcct[acct]) || null;
    const c = (costByAcct && costByAcct[acct]) || null;
    const volume = Math.round(t.usd * 100) / 100;
    const captured = (f && f.usdKnown) ? Math.round(f.capturedUsd * 100) / 100 : null;
    const cost = (c && c.usdKnown) ? Math.round(c.costUsd * 100) / 100 : null;
    const take = (captured != null && volume > 0) ? Math.round((captured / volume) * 10000) / 100 : null;
    const margin = (captured != null && cost != null) ? Math.round((captured - cost) * 100) / 100 : null;
    out.push({
      acct,
      name: String(nameByAcct[acct] || acct),
      country: cba[acct] || CC_UNKNOWN,   // merchant country (Stripe account), for the page filter
      mid: (meta[acct] && meta[acct].owner_id) || null,
      started: t.started,       // 'YYYY-MM-DD' — first successful charge
      txns: t.cnt,              // number of successful charges
      volume,                   // gross processed, USD
      captured,                 // application fees, USD ("amount we captured")
      take,                     // effective take-rate %, captured/volume ("fee applied")
      cost,                     // Stripe interchange++ cost, USD
      margin,                   // captured − cost, USD ("our margin")
    });
  }
  out.sort((a, b) => b.volume - a.volume);
  return out;
}

// Densify a sparse per-day map into a continuous daily series between min→max date,
// filling gaps with zeros so bars/lines render an honest calendar (no skipped days).
function denseDailyVolume(byDay) {
  const days = Object.keys(byDay).sort();
  if (!days.length) return [];
  const out = [];
  const start = new Date(days[0] + 'T00:00:00Z');
  const end = new Date(days[days.length - 1] + 'T00:00:00Z');
  for (let t = new Date(start); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
    const d = t.toISOString().slice(0, 10);
    const v = byDay[d];
    // `by` carries the same {usd,cnt} shape per country so the page can re-derive an
    // exact filtered series. Zero-filled days get an empty map, not a fabricated split.
    const by = {};
    if (v && v.by) {
      for (const cc of Object.keys(v.by)) {
        by[cc] = { usd: Math.round(v.by[cc].usd * 100) / 100, cnt: v.by[cc].cnt };
      }
    }
    out.push({ d, usd: v ? Math.round(v.usd * 100) / 100 : 0, cnt: v ? v.cnt : 0, by });
  }
  return out;
}

// Append (or replace) today's enabled snapshot. Prod-only, monotonic history.
function buildEnabledSnapshot(prevSnap, act) {
  const today = new Date().toISOString().slice(0, 10);
  const prod = act.filter(r => r.env !== 'test');
  const enabled = prod.filter(r => r.status === 'Enabled').length;
  const total = prod.length;
  // Country split, added 2026-08-17. This series is forward-only by construction —
  // rows banked before today CANNOT be retro-split, so they simply have no `by` and the
  // page falls back to the blended value for them rather than inventing a breakdown.
  const by = {};
  for (const r of prod) {
    const cc = normCountry(r.country);
    if (!by[cc]) by[cc] = { enabled: 0, total: 0 };
    by[cc].total += 1;
    if (r.status === 'Enabled') by[cc].enabled += 1;
  }
  const snap = prevSnap.filter(s => s.d !== today);
  snap.push({ d: today, enabled, total, by });
  snap.sort((a, b) => a.d.localeCompare(b.d));
  return snap;
}

function writeOverview(actDaily, volDaily, enabledSnap, enabledDaily, txnMerchants) {
  const today = new Date().toISOString().slice(0, 10);
  // Date + hour (UTC) of this pull, e.g. "2026-07-17 13:56 UTC" — shown as the "Updated" stamp.
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  enabledDaily = enabledDaily || [];
  txnMerchants = txnMerchants || [];
  const out =
`// Payments Activation OVERVIEW (first page) — regenerated daily by activated-payments/pull.js.
// FACADASH-style daily report for Loyverse Payments.
//   __PAY_ACT_DAILY     : prod activations per day (CONNECTED_ACCOUNTS.CREATED), all-time, backfilled.
//   __PAY_ENABLED_DAILY : prod enabled (passed-KYC) per day, BACKFILLED from TOS_ACCEPTANCE_DATE
//                         (fallback CREATED) for currently-Enabled accounts — a true historical curve.
//   __PAY_VOL_DAILY     : prod terminal volume in USD per day (CONNECTED_ACCOUNT_CHARGES, succeeded/paid/
//                         captured + fixed FX map), zero-filled calendar, all-time, backfilled.
//   __PAY_TXN_MERCHANTS : per-merchant transacting table — name, started, txns, volume(USD),
//                         captured(USD, application fees net of refunds), take-rate %,
//                         cost(USD, ICPLUS interchange++ Stripe bills us), margin = captured − cost.
//   __PAY_ENABLED_SNAP  : legacy forward-only snapshot (kept for continuity; UI prefers __PAY_ENABLED_DAILY).
//
// COUNTRY SPLIT (added 2026-08-17 for the UK launch): every row above keeps its blended
// value AND carries a \`by\` map keyed by the merchant's ISO-2 country from Stripe
// (CONNECTED_ACCOUNTS.COUNTRY — the merchant's country, not the card's). Counts use
// { CC: n }; money uses { CC: {usd,cnt} }. \`by\` always sums to the blended value for the
// same row, except on __PAY_ENABLED_SNAP rows banked before 2026-08-17, which are
// forward-only and have no \`by\` at all. __PAY_TXN_MERCHANTS carries a scalar \`country\`.
// Do NOT edit by hand; overwritten each morning (snapshot array is preserved + appended). Last pull: ${today}
window.__PAY_OVERVIEW_UPDATED = ${JSON.stringify(stamp)};
window.__PAY_ACT_DAILY = ${JSON.stringify(actDaily)};
window.__PAY_ENABLED_DAILY = ${JSON.stringify(enabledDaily)};
window.__PAY_VOL_DAILY = ${JSON.stringify(volDaily)};
window.__PAY_TXN_MERCHANTS = ${JSON.stringify(txnMerchants)};
window.__PAY_ENABLED_SNAP = ${JSON.stringify(enabledSnap)};
`;
  fs.writeFileSync(OVERVIEW_FILE, out, 'utf8');
  console.log(`✓ Wrote ${OVERVIEW_FILE} (${(out.length / 1024).toFixed(1)} KB) — act days: ${actDaily.length}, enabled days: ${enabledDaily.length}, vol days: ${volDaily.length}, txn merchants: ${txnMerchants.length}, snapshots: ${enabledSnap.length}`);
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

  // ── TERMINAL / hardware acquisition (for the enablement / terminal drill-down) ──
  for (const name of ['TERMINAL_HARDWARE_ORDERS', 'TERMINAL_HARDWARE_ORDER_ITEMS', 'TERMINAL_HARDWARE_ORDER_METADATA']) {
    if (stripeObjs.includes(name)) {
      await describeObj(STRIPE_SHARE_DB, STRIPE_SCHEMA, name);
      await sampleObj(name, STRIPE_SHARE_DB, STRIPE_SCHEMA, name, null, 8);
    }
  }

  // ── FEE / CAPTURED-REVENUE / COST candidates (for the transacting-merchants table) ──
  // APPLICATION_FEES = Loyverse's captured take; ITEMIZED_FEES / ICPLUS / BALANCE_TXN_FEE_DETAILS
  // = Stripe's cost to Loyverse, needed to compute the true net margin. Describe + sample so the
  // exact column names are confirmed and the margin math can be wired in a fast follow.
  for (const name of ['CONNECTED_ACCOUNT_APPLICATION_FEES', 'CONNECTED_ACCOUNT_APPLICATION_FEE_REFUNDS',
                       'CONNECTED_ACCOUNT_ITEMIZED_FEES', 'ICPLUS_FEES',
                       'CONNECTED_ACCOUNT_BALANCE_TRANSACTION_FEE_DETAILS']) {
    if (stripeObjs.includes(name)) {
      await describeObj(STRIPE_SHARE_DB, STRIPE_SCHEMA, name);
      await sampleObj(name, STRIPE_SHARE_DB, STRIPE_SCHEMA, name, null, 5);
    }
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
  const POS_ACTIVE_WINDOW_DAYS = 30;   // must match sql/us_bases.sql's trailing-30-day rule
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
      // NOTE: pos_gtv_usd (money) and pos_active_days (daily granularity) still pending
      // the heavier LOYVERSE_RECEIPTS per-receipt query.
    }
    // Recency is ALWAYS derived from whatever last_sale we ended up with (fresh this run or
    // preserved from an earlier one), never carried over. POS_ACTIVE_WINDOW_DAYS is 30 to match
    // the "receipt in the trailing 30 days" definition used by sql/us_bases.sql — the funnel
    // group bases and this flag have to mean the same thing or the ratios are nonsense.
    // CAVEAT: last_sale comes from a MONTHLY table, so for merchants without the daily layer it
    // is a month-start and this flag is only accurate to within a month. The funnel UI therefore
    // derives group membership from the SQL bases, not from this flag.
    rec.days_since_sale = daysSince(rec.last_sale);
    rec.pos_active = (rec.pos_receipts || 0) > 0 &&
                     rec.days_since_sale != null &&
                     rec.days_since_sale <= POS_ACTIVE_WINDOW_DAYS;

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

// ── Funnel: entry cohort (US-since-launch + pilot 500) → stage progression ──────
// Reads the chosen pilot cohort (owner ids) from pilot500-data.js — a selected list,
// not hardcoded infrastructure — so the entry query can also pull their registration dates.
function readPilot() {
  try {
    const txt = fs.readFileSync(PILOT_FILE, 'utf8');
    const m = txt.match(/window\.__PILOT500\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return [];
    return JSON.parse(m[1]);
  } catch (e) { console.error(`✗ readPilot failed: ${e.message}`); return []; }
}
async function fetchTerminalOrders(conn) {
  // Attributed by shipping email (orders are placed platform-side; see terminal_orders.sql).
  const rows = await executeQuery(conn, loadSql('terminal_orders.sql'));
  const by = {};
  for (const r of rows) {
    const email = String(r.SHIP_EMAIL != null ? r.SHIP_EMAIL : r.ship_email || '').trim().toLowerCase();
    if (!email) continue;
    by[email] = {
      first_order: toDate(r.FIRST_ORDER != null ? r.FIRST_ORDER : r.first_order),
      orders: Number(r.ORDERS != null ? r.ORDERS : r.orders || 0),
      status: r.LAST_STATUS != null ? r.LAST_STATUS : r.last_status,
    };
  }
  return by;
}
// ── MONTHLY series for the Report page ────────────────────────────────────────
// Three monthly twins of existing queries. The per-account fee/cost queries group by ACCOUNT
// only and carry NO time dimension, so revenue/cost/margin previously existed as all-time
// totals only — these give them a month grain without touching the originals (the margins tab
// keeps reading those unchanged).
// Country split (added 2026-08-17, UK launch): each month keeps its blended tpv/txns/accounts
// exactly as before and gains `by`, keyed by the MERCHANT's ISO-2 country from
// CONNECTED_ACCOUNTS.COUNTRY. `by` always sums back to the blended figure, so nothing restates.
// activeMerchants is counted from a Set per country AND a Set for the month, because a distinct
// count is not additive — summing per-country distincts would double-count a merchant only if it
// somehow appeared under two countries, which cannot happen, but the month Set is what the
// blended figure has always been and is kept as the authority.
async function fetchChargesMonthly(conn, acctIds, countryByAcct) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return { byMonth: {}, unknownCcy: {} };
  const cba = countryByAcct || {};
  const inList = ids.map(a => `'${a}'`).join(',');
  const rows = await executeQuery(conn, loadSql('charges_monthly.sql').replace('/*ACCOUNT_IDS*/', inList));
  const byMonth = {}, unknownCcy = {};
  const acctSets = {};                       // m -> { all:Set, cc:{ CC:Set } }
  // acct -> [months it transacted in]. The sets below are collapsed to counts, and a count
  // cannot say WHICH merchants transacted, which is exactly what the cohort triangle needs to
  // intersect "transacting" with "active". Same rows, kept rather than discarded.
  const acctMonths = {};
  const g = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const slot = (o, cc) => (o.by[cc] || (o.by[cc] = { tpv: 0, txns: 0, accounts: 0 }));
  for (const r of rows || []) {
    const m = g(r, 'month'); if (!m) continue;
    if (!byMonth[m]) byMonth[m] = { tpv: 0, txns: 0, accounts: null, by: {} };
    const acct = g(r, 'acct');
    const cc = acct ? (cba[acct] || CC_UNKNOWN) : CC_UNKNOWN;
    if (String(g(r, 'row_kind')) === 'accts') {
      // One row per (month, account) since 2026-08-17 — pull.js does the distinct count itself.
      const s = acctSets[m] || (acctSets[m] = { all: new Set(), cc: {} });
      if (acct) {
        s.all.add(acct);
        (s.cc[cc] || (s.cc[cc] = new Set())).add(acct);
        (acctMonths[acct] || (acctMonths[acct] = [])).push(m);
      }
      continue;
    }
    const ccy = g(r, 'ccy');
    const usd = minorToUsd(g(r, 'amount_minor'), ccy);
    if (usd == null) { unknownCcy[String(ccy).toUpperCase()] = (unknownCcy[String(ccy).toUpperCase()] || 0) + 1; continue; }
    const cnt = Number(g(r, 'cnt')) || 0;
    byMonth[m].tpv  += usd;
    byMonth[m].txns += cnt;
    const b = slot(byMonth[m], cc);
    b.tpv += usd; b.txns += cnt;
  }
  Object.keys(acctSets).forEach(m => {
    const s = acctSets[m], o = byMonth[m];
    if (!o) return;
    o.accounts = s.all.size;
    Object.keys(s.cc).forEach(cc => { slot(o, cc).accounts = s.cc[cc].size; });
  });
  return { byMonth, unknownCcy, acctMonths };
}

// Per-merchant monthly paying / active membership, for the merchants holding a connected
// account. Returns { [merchantId]: { pay:[months], act:[months] } } with months as 'YYYY-MM'.
// Absence of a month means the merchant was neither paying nor active in it — the query emits
// no row for an empty month, so nothing here has to represent a zero.
async function fetchMerchantMonthFlags(conn, merchantIds) {
  const ids = sanitizeIds(merchantIds);
  if (!ids.length) return {};
  const sql = loadSql('merchant_month_flags.sql').split('/*MERCHANT_IDS*/').join(ids.join(','));
  const rows = await executeQuery(conn, sql);
  const g = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const by = {};
  for (const r of rows || []) {
    const mid = String(g(r, 'merchant_id') || '');
    // The query returns MONTH_START as a 'YYYY-MM' string, deliberately: the lake stores the
    // monthly sales month as VARCHAR, so both sides of the join are normalised to that shape.
    const m = String(g(r, 'month_start') || '').slice(0, 7);
    if (!mid || !/^\d{4}-\d{2}$/.test(m)) continue;
    const rec = by[mid] || (by[mid] = { pay: [], act: [] });
    if (Number(g(r, 'is_paying'))) rec.pay.push(m);
    if (Number(g(r, 'is_active')))  rec.act.push(m);
  }
  return by;
}

// The monthly sales table lags — on 2026-08-25 it ended at 2026-03, while Loyverse Payments has
// only existed since 2026-04. Reading it alone would have shown zero active merchants in every
// month the payments KPIs cover, which looks like a finding rather than a gap. This fills the
// tail from the raw receipts table and merges it in, bounded to the connected-account merchants
// and to months from `from` onward so the scan stays small.
async function fetchRecentActive(conn, merchantIds, from) {
  const ids = sanitizeIds(merchantIds);
  if (!ids.length) return {};
  const sql = loadSql('merchant_month_active_recent.sql')
    .split('/*MERCHANT_IDS*/').join(ids.join(','))
    .split('/*RECENT_FROM*/').join(from);
  const rows = await executeQuery(conn, sql);
  const g = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const by = {};
  for (const r of rows || []) {
    const mid = String(g(r, 'merchant_id') || '');
    const m = String(g(r, 'month_start') || '').slice(0, 7);
    if (!mid || !/^\d{4}-\d{2}$/.test(m)) continue;
    (by[mid] || (by[mid] = [])).push(m);
  }
  return by;
}
// Fold the recent receipts months into the flags map. The monthly table keeps ownership of every
// month up to its own last one; the receipts query owns everything after. Where the two overlap
// the union is harmless — a merchant active by either reading was active.
function mergeRecentActive(flags, recent) {
  Object.keys(recent || {}).forEach(mid => {
    const rec = flags[mid] || (flags[mid] = { pay: [], act: [] });
    const seen = new Set(rec.act);
    recent[mid].forEach(m => { if (!seen.has(m)) { rec.act.push(m); seen.add(m); } });
    rec.act.sort();
  });
  return flags;
}
// Generic minor-unit monthly roll-up used by both the revenue and cost queries.
// Same additive convention: `usd`/`cnt` unchanged, plus `by` keyed by merchant country.
async function fetchMinorMonthly(conn, acctIds, sqlFile, amtCol, cntCol, countryByAcct) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return {};
  const cba = countryByAcct || {};
  const inList = ids.map(a => `'${a}'`).join(',');
  const rows = await executeQuery(conn, loadSql(sqlFile).replace('/*ACCOUNT_IDS*/', inList));
  const byMonth = {};
  const g = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  for (const r of rows || []) {
    const m = g(r, 'month'); if (!m) continue;
    const usd = minorToUsd(g(r, amtCol), g(r, 'ccy'));
    if (usd == null) continue;              // unknown currency — excluded, same as the daily layer
    if (!byMonth[m]) byMonth[m] = { usd: 0, cnt: 0, by: {} };
    const cnt = Number(g(r, cntCol)) || 0;
    byMonth[m].usd += usd;
    byMonth[m].cnt += cnt;
    const acct = g(r, 'acct');
    const cc = acct ? (cba[acct] || CC_UNKNOWN) : CC_UNKNOWN;
    const b = byMonth[m].by[cc] || (byMonth[m].by[cc] = { usd: 0, cnt: 0 });
    b.usd += usd; b.cnt += cnt;
  }
  return byMonth;
}

// Assemble the monthly report series. Everything is per calendar month; the Report page adds
// the since-launch column by summing flows and taking the last point-in-time value.
//   FLOW  (sum over the month): initiated, passed, tpv, txns, revenue, cost, newTransacting
//   RATIO (derived, never stored pre-rounded): passRate, avgTicket, takeRate, netTakeRate
//   POINT-IN-TIME (end of month): liveCum, transactingCum
// activeMerchants = COUNT(DISTINCT ACCOUNT) that charged in the month (not just first charge).
// COUNTRY SPLIT (added 2026-08-17, UK launch): every month row keeps its existing fields exactly
// as they were and gains `by`, an object keyed by ISO-2 merchant country whose values have the
// IDENTICAL shape as the row itself. Ratios are recomputed from that country's own numerator and
// denominator — never apportioned from the blended rate — and liveCum / transactingCum run their
// own per-country cumulative. Summing the FLOW fields across `by` reproduces the blended figure;
// the RATIO fields deliberately do not sum, which is why they are recomputed rather than split.
function buildPaymentsMonthly(actDaily, enabledDaily, chargesByMonth, revByMonth, costByMonth, txnMerchants) {
  const ym = d => String(d || '').slice(0, 7);
  const months = {};
  const blank = () => ({ initiated: 0, passed: 0, tpv: 0, txns: 0, activeMerchants: null,
                         revenue: 0, cost: 0, newTransacting: 0 });
  const touch = m => (months[m] = months[m] || Object.assign({ m }, blank(), { by: {} }));
  // Country slot for a month. Created lazily so a month with no activity in a market simply has
  // no key for it, rather than a row of fabricated zeros.
  const cslot = (o, cc) => (o.by[cc] || (o.by[cc] = blank()));
  // Daily rows carry `by` as {CC: n}; a row with no `by` (e.g. a zero-filled day) contributes to
  // the blended total only, which is the honest thing to do — its country is genuinely unknown.
  const addDaily = (rows, field) => (rows || []).forEach(r => {
    const m = ym(r.d); if (!m) return;
    const o = touch(m), n = Number(r.n) || 0;
    o[field] += n;
    Object.keys(r.by || {}).forEach(cc => { cslot(o, cc)[field] += Number(r.by[cc]) || 0; });
  });
  addDaily(actDaily, 'initiated');
  addDaily(enabledDaily, 'passed');

  Object.keys(chargesByMonth || {}).forEach(m => {
    const o = touch(m), c = chargesByMonth[m];
    o.tpv = c.tpv; o.txns = c.txns; o.activeMerchants = c.accounts;
    Object.keys(c.by || {}).forEach(cc => {
      const b = cslot(o, cc), s = c.by[cc];
      b.tpv = s.tpv; b.txns = s.txns; b.activeMerchants = s.accounts;
    });
  });
  const addMinor = (src, field) => Object.keys(src || {}).forEach(m => {
    const o = touch(m), s = src[m];
    o[field] = s.usd;
    Object.keys(s.by || {}).forEach(cc => { cslot(o, cc)[field] = s.by[cc].usd; });
  });
  addMinor(revByMonth, 'revenue');
  addMinor(costByMonth, 'cost');

  (txnMerchants || []).forEach(t => {
    const m = ym(t.started); if (!m) return;
    const o = touch(m);
    o.newTransacting += 1;
    cslot(o, t.country || CC_UNKNOWN).newTransacting += 1;
  });

  const keys = Object.keys(months).sort();
  const r2 = v => Math.round(v * 100) / 100;
  // Derive one month's presentation row from one accumulator, given that market's running totals.
  const derive = (o, cum) => {
    cum.live += o.passed;
    cum.tx   += o.newTransacting;
    return {
      initiated: o.initiated,
      passed: o.passed,
      // Null rather than 0 when there is nothing to divide by — the report renders "—".
      passRate: o.initiated ? r2(o.passed / o.initiated * 100) : null,
      newTransacting: o.newTransacting,
      activationRate: o.passed ? r2(o.newTransacting / o.passed * 100) : null,
      tpv: r2(o.tpv),
      txns: o.txns,
      avgTicket: o.txns ? r2(o.tpv / o.txns) : null,
      activeMerchants: o.activeMerchants,
      tpvPerActive: (o.activeMerchants ? r2(o.tpv / o.activeMerchants) : null),
      revenue: r2(o.revenue),
      takeRate: o.tpv ? r2(o.revenue / o.tpv * 100) : null,
      cost: r2(o.cost),
      netMargin: r2(o.revenue - o.cost),
      netTakeRate: o.tpv ? r2((o.revenue - o.cost) / o.tpv * 100) : null,
      liveCum: cum.live, transactingCum: cum.tx
    };
  };
  // Running cumulatives: merchants live (passed KYC) and merchants ever transacting, at month end.
  const cumAll = { live: 0, tx: 0 };
  const cumCc = {};                          // one independent cumulative pair per market
  return keys.map(m => {
    const o = months[m];
    const row = Object.assign({ m }, derive(o, cumAll));
    const by = {};
    // Every market seen so far gets a row each month, even a month it was inactive, so its
    // cumulative columns keep advancing correctly instead of resetting to null.
    Object.keys(o.by).forEach(cc => { cumCc[cc] = cumCc[cc] || { live: 0, tx: 0 }; });
    Object.keys(cumCc).sort().forEach(cc => {
      by[cc] = derive(o.by[cc] || blank(), cumCc[cc]);
    });
    row.by = by;
    return row;
  });
}

function writeReport(monthly, groups, bases, notes, groupsBy, basesByCc, markets) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const out =
`// Loyverse Payments REPORT data — regenerated daily by activated-payments/pull.js.
// Monthly series behind report.html (the payments twin of the POS month-end report).
//   __PAY_MONTHLY : one row per calendar month. FLOW fields (initiated, passed, tpv, txns,
//                   revenue, cost, newTransacting) are sums over the month; liveCum /
//                   transactingCum are point-in-time at month end; rates are derived.
//   __PAY_REPORT_GROUPS : funnel-group snapshot (base + initiated/passed/transacting). NOTE:
//                   point-in-time only — there is no per-group history, so the report shows it
//                   as a current snapshot, not a month-over-month comparison.
// COUNTRY FILTER (added 2026-08-17, UK launch). Every __PAY_MONTHLY row gained a "by" object
// keyed by ISO-2 merchant country (from Stripe CONNECTED_ACCOUNTS.COUNTRY, i.e. where the
// business is incorporated — NOT the card's issuing country) whose values have the same shape as
// the row. The top-level fields are untouched and still all-countries, so any reader that ignores
// "by" sees exactly the numbers it saw before. Companions:
//   __PAY_REPORT_GROUPS_BY : per-country group snapshot, each against its OWN country bases.
//   __PAY_REPORT_BASES_BY_CC : the group bases per market.
//   __PAY_REPORT_MARKETS : the live markets, in launch order, for the selector.
// CAVEATS: volume history starts 13 Apr 2026 (first charge), so earlier months carry activation
// figures with zero TPV. Cost is dated by BALANCE_TRANSACTION_CREATED_AT, which can lag the
// charge by a day or two, so month-boundary costs may land in the following month.
// Do NOT edit by hand; overwritten each morning. Last pull: ${stamp}
window.__PAY_REPORT_UPDATED = ${JSON.stringify(stamp)};
window.__PAY_MONTHLY = ${JSON.stringify(monthly || [])};
window.__PAY_REPORT_GROUPS = ${JSON.stringify(groups || [])};
window.__PAY_REPORT_BASES = ${JSON.stringify(bases || null)};
window.__PAY_REPORT_NOTES = ${JSON.stringify(notes || {})};
window.__PAY_REPORT_GROUPS_BY = ${JSON.stringify(groupsBy || {})};
window.__PAY_REPORT_BASES_BY_CC = ${JSON.stringify(basesByCc || {})};
window.__PAY_REPORT_MARKETS = ${JSON.stringify(markets || [])};
`;
  fs.writeFileSync(REPORT_FILE, out, 'utf8');
  const ccs = Object.keys(groupsBy || {});
  console.log(`\u2713 report-data.js written — ${(monthly || []).length} months` +
              (ccs.length ? `, split across ${ccs.length} countries (${ccs.join(', ')})` : ''));
}

// ── US funnel bases (one base per funnel group) ────────────────────────────────
// One-row query (sql/us_bases.sql). Returns FOUR disjoint group bases — new_us,
// paying_base_us, nonpaying_us, dormant_us — each scoped to exactly the population its
// numerator on the Funnel page draws from, plus total_us and the two legacy reference
// counts (active_us / paying_us, which are NOT group bases). Bot filter applied.
// Before 2026-08-03 the page used active_us as the "Non paying" denominator; that count
// includes paying and post-launch merchants, which the numerator excludes, so the group's
// conversion rate read several times too low.
// `market` is a MARKETS entry; omitted means US, which is what the raw SQL already says.
// The substitution is deliberately narrow — only the population clause and the launch date
// carry tokens, so the US-specific bot CTE can never be rewritten by accident.
function applyMarket(sql, market) {
  if (!market || market.cc === 'US') return sql;
  return sql
    .replace("/*COUNTRY*/'US'", `/*COUNTRY*/'${market.cc}'`)
    .replace("/*LAUNCH*/DATE '2026-07-01'", `/*LAUNCH*/DATE '${market.launch}'`)
    .replace("/*FIRST_MONTH*/DATE '2026-04-01'", `/*FIRST_MONTH*/DATE '${market.firstMonth}'`);
}
async function fetchUsBases(conn, market) {
  const rows = await executeQuery(conn, applyMarket(loadSql('us_bases.sql'), market));
  if (!rows || !rows.length) return null;
  const r = rows[0];
  const g = k => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const n = k => { const v = Number(g(k)); return isFinite(v) ? v : null; };
  const out = { asof: new Date().toISOString().slice(0, 10) };
  for (const k of ['new_us', 'paying_base_us', 'nonpaying_us', 'dormant_us',
                   'total_us', 'active_us', 'paying_us']) {
    const v = n(k);
    if (v !== null) out[k] = v;
  }
  // The four group bases are the contract with the UI; without them there is nothing to render.
  if (out.nonpaying_us == null || out.paying_base_us == null || out.dormant_us == null) return null;
  // Disjoint groups must account for every genuine US merchant. A mismatch means the CASE
  // ladder and the counts have drifted apart — log loudly rather than ship a silent error.
  if (out.total_us != null) {
    const sum = (out.new_us || 0) + out.paying_base_us + out.nonpaying_us + out.dormant_us;
    if (sum !== out.total_us) {
      console.error(`✗ us_bases: group bases sum to ${sum} but total_us is ${out.total_us} — groups are not disjoint`);
    }
  }
  return out;
}
// ── US funnel bases AT EACH MONTH END (sql/us_bases_monthly.sql) ──────────────
// The same four disjoint groups as fetchUsBases, evaluated as of a series of month ends so
// the Funnel page's month filter has a denominator belonging to the month on screen rather
// than to today. One row per month; the newest row is the month in progress (as_of = today,
// is_partial = true). GUARDED at the call site — this must never be able to break a page
// that rendered fine before it existed.
async function fetchUsBasesMonthly(conn, market) {
  const rows = await executeQuery(conn, applyMarket(loadSql('us_bases_monthly.sql'), market));
  if (!rows || !rows.length) return null;
  const out = [];
  for (const r of rows) {
    const g = k => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
    const n = k => { const v = Number(g(k)); return isFinite(v) ? v : null; };
    const month = String(g('month') || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const row = { month, asof: toDate(g('as_of')), partial: g('is_partial') === true || String(g('is_partial')).toLowerCase() === 'true' };
    for (const k of ['new_us', 'paying_base_us', 'nonpaying_us', 'dormant_us',
                     'total_us', 'active_us', 'paying_us']) {
      const v = n(k);
      if (v !== null) row[k] = v;
    }
    // Same contract as the all-time bases: without the group bases there is nothing to divide by.
    if (row.nonpaying_us == null || row.paying_base_us == null || row.dormant_us == null) continue;
    // Disjointness is the whole point of these four numbers — a mismatch means the CASE ladder
    // and the counts have drifted apart for that month. Log loudly, keep the row.
    if (row.total_us != null) {
      const sum = (row.new_us || 0) + row.paying_base_us + row.nonpaying_us + row.dormant_us;
      if (sum !== row.total_us) {
        console.error(`✗ us_bases_monthly ${month}: group bases sum to ${sum} but total_us is ${row.total_us} — groups are not disjoint`);
      }
    }
    out.push(row);
  }
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out.length ? out : null;
}
// The monthly file reconstructs paying status from ACTIVATED_AT / CANCELLED_AT, while
// us_bases.sql reads LOWER(STATUS) = 'active'. Those are close but not identical (paused and
// non-renewing subscriptions differ), so compare the newest monthly row against the live
// all-time row on every run and report the gap. A small, stable gap is expected; a widening
// one means the reconstruction needs revisiting.
function reportMonthlyBaseGap(bases, monthly) {
  if (!bases || !monthly || !monthly.length) return;
  const cur = monthly[monthly.length - 1];
  const keys = ['new_us', 'paying_base_us', 'nonpaying_us', 'dormant_us', 'total_us'];
  const diffs = keys
    .filter(k => bases[k] != null && cur[k] != null && bases[k] !== cur[k])
    .map(k => `${k} ${cur[k]} vs ${bases[k]} (${cur[k] - bases[k] >= 0 ? '+' : ''}${cur[k] - bases[k]})`);
  if (!diffs.length) { console.log(`✓ us_bases_monthly: newest row ${cur.month} matches us_bases exactly`); return; }
  console.log(`  us_bases_monthly: newest row ${cur.month} differs from live us_bases — ${diffs.join(', ')} (expected: paying status is reconstructed from ACTIVATED_AT/CANCELLED_AT)`);
}
// If the monthly query fails, carry the previously-committed series forward so the month
// filter keeps working on yesterday's denominators rather than losing them entirely.
function readExistingBasesMonthly() {
  try {
    const txt = fs.readFileSync(FUNNEL_FILE, 'utf8');
    const m = txt.match(/window\.__FUNNEL_BASES_MONTHLY\s*=\s*(\[[\s\S]*?\]);/);
    if (m) return JSON.parse(m[1]);
  } catch (e) { /* first run, or no monthly series committed yet */ }
  return null;
}
// ── Group tag per merchant (sql/us_group_tags.sql) ────────────────────────────
// Same CASE ladder as us_bases.sql, evaluated per merchant, so the Funnel page's group
// numerators are drawn with the exact rule that sizes the group bases. Replaces deciding
// membership from activation-data.js's monthly-granularity `pos_active` flag.
async function fetchUsGroupTags(conn, merchantIds, market) {
  const ids = sanitizeIds(merchantIds);
  if (!ids.length) return {};
  const sql = applyMarket(loadSql('us_group_tags.sql'), market)
    .replace('/*MERCHANT_IDS*/', ids.join(','));
  const rows = await executeQuery(conn, sql);
  const by = {};
  for (const r of rows || []) {
    const g = k => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
    const mid = g('merchant_id');
    if (mid == null) continue;
    by[String(mid)] = { grp: String(g('grp') || ''),
                        pos30: g('pos_active_30d') === true || String(g('pos_active_30d')) === 'true' };
  }
  return by;
}
// If the bases query fails, carry the previously-committed bases forward so the
// Funnel page never renders without denominators.
function readExistingBases() {
  try {
    const txt = fs.readFileSync(FUNNEL_FILE, 'utf8');
    const m = txt.match(/window\.__FUNNEL_BASES\s*=\s*(\{[\s\S]*?\});/);
    if (m) return JSON.parse(m[1]);
  } catch (e) { /* first run */ }
  return null;
}
// Entry cohort across EVERY live market. The /*MARKETS*/ token expands to one OR-ed
// (country, launch date) pair per MARKETS entry, so a market goes live on the funnel purely
// by being added to that list. Each row carries its own country, which becomes the `cc` the
// Funnel page filters on.
async function fetchUsRegistrations(conn, extraIds) {
  const ids = sanitizeIds(extraIds);
  const inList = ids.length ? ids.join(',') : '0';
  const marketClause = MARKETS
    .map(m => `(UPPER(TRIM(COUNTRY)) = '${m.cc}' AND CREATED_AT >= '${m.launch}')`)
    .join('\n   OR ');
  const sql = loadSql('us_registrations.sql')
    .replace("/*MARKETS*/(UPPER(TRIM(COUNTRY)) = 'US' AND CREATED_AT >= '2026-07-01')",
             `/*MARKETS*/${marketClause}`)
    .replace('/*PILOT_IDS*/', inList);
  const rows = await executeQuery(conn, sql);
  const by = {};
  for (const r of rows) {
    const oid = String(r.OWNER_ID != null ? r.OWNER_ID : (r.owner_id != null ? r.owner_id : '')).trim();
    if (!oid) continue;
    const country = String(r.COUNTRY || r.country || '').trim().toUpperCase();
    by[oid] = {
      oid,
      name: r.NAME || r.name || '',
      email: String(r.EMAIL || r.email || '').trim().toLowerCase(),
      country,
      cc: normCountry(country),
      registered_at: toDate(r.REGISTERED_AT != null ? r.REGISTERED_AT : r.registered_at),
    };
  }
  return by;
}
// ── Bot / fraud exclusion ──────────────────────────────────────────────────────
// US-only bot campaign (confirmed Apr–Jul 2026; see Second Brain note). Detect on the
// BUSINESS NAME using the documented high-confidence signatures. Applied ONLY to
// registration-only accounts (never to accounts that actually connected Stripe or to the
// chosen pilot) so genuine merchants are never dropped.
const ZW = /[​‌‍⁠﻿]/g;
function normName(s) { return String(s || '').toLowerCase().replace(ZW, '').replace(/\s+/g, ' ').trim(); }
function leet(s) { return s.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/@/g, 'a'); }
function isBotName(nameRaw, freqMap) {
  const s = String(nameRaw || '');
  if (!s.trim()) return false;
  if (/[​‌‍⁠﻿]/.test(s)) return true;                          // zero-width chars
  if (/[Ѐ-ӿ]/.test(s)) return true;                                            // Cyrillic homoglyphs (US context)
  if (/^(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[\s_#:.\-]+[0-9a-fx]{6,}/i.test(s)) return true; // transaction-id names
  const L = leet(s.toLowerCase());
  if (/(poshmark|posh|vinted|depop|etsy)/.test(L)) return true;                                   // marketplace impersonation
  if (/seller\s*kyc/.test(L)) return true;                                                        // placeholder
  if (/^[A-Z][a-z]{2,}[A-Z][a-z]{2,}\d{1,3}$/.test(s)) return true;                               // template FirstLastNN
  if (freqMap && freqMap[normName(s)] >= 3) return true;                                          // bulk cluster (same name >=3x)
  return false;
}
// Build the funnel population: (genuine US registrations since launch) ∪ (all prod connected
// accounts = the payments book) ∪ (pilot 500), with bots excluded from the registration mass.
// Every merchant carries its stage timestamps so the UI can slice by date range / pilot and
// recompute stages, timings, and the KYC / terminal drill-downs entirely client-side.
function buildFunnel(accountRows, meta, txnByAcct, regs, pilot, termByEmail, groupTags, countryByAcct) {
  groupTags = groupTags || {};
  termByEmail = termByEmail || {};
  const cba = countryByAcct || {};
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const pilotByOid = {}; pilot.forEach(p => { if (p.oid) pilotByOid[String(p.oid)] = p; });

  const acctToOwner = {};
  Object.keys(meta || {}).forEach(a => { if (meta[a] && meta[a].owner_id) acctToOwner[a] = String(meta[a].owner_id); });
  // One record per PROD connected account (the payments book). NOT deduped by owner — signed_up
  // counts accounts (matches the book: a merchant with two Stripe accounts shows both). MERCHANT_ID
  // on CONNECTED_ACCOUNTS is a platform-level constant, so linkage is via metadata owner_id only.
  const connAccts = [];
  const connectedOwners = new Set();
  for (const r of accountRows) {
    const acct = get(r, 'stripe_account_id');
    if (!acct) continue;
    if (meta[acct] && meta[acct].environment && meta[acct].environment !== 'prod') continue; // prod only
    const owner = acctToOwner[acct] || null;
    const status = statusOf(get(r, 'charges_enabled'), get(r, 'disabled_reason'));
    const connected_at = toDate(get(r, 'stripe_connected_at'));
    // Real KYC/Terms-acceptance timestamp — may be null. Do NOT fall back to connected_at,
    // or the Signed-up→Enabled timing collapses to a fake 0 days. The Enabled STAGE is driven
    // by status (charges_enabled), independent of whether this timestamp exists.
    const enabled_at = toDate(get(r, 'tos_accepted_at'));
    const email = String(get(r, 'email') || '').trim().toLowerCase();
    const codes = [...parseReqList(get(r, 'requirements_currently_due')), ...parseReqList(get(r, 'requirements_past_due'))];
    const blockers = [...new Set(codes.map(labelFor).filter(Boolean))];
    const first_txn_at = (txnByAcct[acct] && txnByAcct[acct].started) ? toDate(txnByAcct[acct].started) : null;
    const bname = get(r, 'business_name') || get(r, 'contact_name') || '';
    if (owner) connectedOwners.add(owner);
    connAccts.push({ acct, owner, status, connected_at, enabled_at, first_txn_at, blockers, bname, email,
                     cc: cba[acct] || normCountry(get(r, 'country')) });
  }

  // Name-frequency map for bulk-cluster detection over the registration mass.
  const freq = {};
  Object.keys(regs).forEach(oid => { const n = normName(regs[oid].name); if (n) freq[n] = (freq[n] || 0) + 1; });

  const merchants = [];
  const stages = { entered: 0, signed_up: 0, enabled: 0, transacting: 0 };
  // Per-country stage counts, e.g. stagesBy.GB = { entered, signed_up, enabled, transacting }.
  // Added 2026-08-17 so the Funnel headline can be filtered without the page having to
  // re-derive stages from the merchant rows (it still can — these must agree).
  const stagesBy = {};
  const stg = cc => (stagesBy[cc] || (stagesBy[cc] = { entered: 0, signed_up: 0, enabled: 0, transacting: 0 }));
  let botsExcluded = 0;

  // 1) Signed-up onward: one funnel row per connected account.
  connAccts.forEach(c => {
    const reg = c.owner ? (regs[c.owner] || null) : null;
    const p = c.owner ? (pilotByOid[c.owner] || null) : null;
    let stage = 'signed_up'; if (c.status === 'Enabled') stage = 'enabled'; if (c.first_txn_at) stage = 'transacting';
    const cc = c.cc || CC_UNKNOWN;
    stages.entered++; stages.signed_up++;
    stg(cc).entered++; stg(cc).signed_up++;
    if (c.status === 'Enabled') { stages.enabled++; stg(cc).enabled++; }
    if (c.first_txn_at) { stages.transacting++; stg(cc).transacting++; }
    const email = c.email || (reg && reg.email) || (p && p.email) || '';
    const term = termByEmail[email] || null;
    merchants.push({
      grp: (groupTags[String(c.owner)] || {}).grp || null,
      cc,                                   // merchant country — drives the page's country filter
      oid: c.owner || ('acct:' + c.acct),
      name: c.bname || (reg && reg.name) || (p && p.name) || (c.owner || c.acct),
      email: email,
      coh: p ? p.coh : '', pilot: p ? 1 : 0, stage,
      enabled: (c.status === 'Enabled') ? 1 : 0,
      registered_at: reg ? reg.registered_at : null,
      connected_at: c.connected_at, enabled_at: c.enabled_at, first_txn_at: c.first_txn_at,
      kyc: (c.status !== 'Enabled') ? c.blockers : [],
      terminal_at: term ? term.first_order : null,
      terminal_status: term ? (term.status || null) : null,
    });
  });

  // 2) Entered-only: everyone in (registrations ∪ pilot) who did NOT connect. Bots excluded here
  //    (registration-only, not pilot, matching the US fraud signatures).
  const enteredOnly = new Set([...Object.keys(regs), ...Object.keys(pilotByOid)]);
  enteredOnly.forEach(oid => {
    if (connectedOwners.has(oid)) return;         // already emitted as a connected account
    const reg = regs[oid] || null;
    const p = pilotByOid[oid] || null;
    if (!p && isBotName(reg && reg.name, freq)) { botsExcluded++; return; }
    // Entered-only rows have no Stripe account, so their country comes from the
    // registration row. The pilot 500 is a US cohort by construction, so a pilot row with
    // no registration record falls back to US rather than to unknown.
    const cc = (reg && reg.cc) ? reg.cc : (p ? 'US' : CC_UNKNOWN);
    stages.entered++;
    stg(cc).entered++;
    merchants.push({
      grp: (groupTags[String(oid)] || {}).grp || null,
      cc,
      oid,
      name: (reg && reg.name) || (p && p.name) || oid,
      email: (reg && reg.email) || (p && p.email) || '',
      coh: p ? p.coh : '', pilot: p ? 1 : 0, stage: 'entered', enabled: 0,
      registered_at: reg ? reg.registered_at : null,
      connected_at: null, enabled_at: null, first_txn_at: null, kyc: [], terminal_at: null, terminal_status: null,
    });
  });
  return { entered_total: stages.entered, stages, stagesBy, merchants, botsExcluded, launch_start: LAUNCH_START };
}
// ── PAYMENT PROFILE: the mix of TPV, what it costs, and what gets declined ───
// Three queries because they are three populations, and blurring them is the easy mistake:
// the mix is captured charges, cost is fee rows collapsed to one per charge, acceptance is
// authorisation ATTEMPTS. Only the first two share a denominator.
async function fetchProfileMix(conn, acctIds, countryByAcct) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return [];
  const cba = countryByAcct || {};
  const rows = await executeQuery(conn, loadSql('profile_mix.sql')
    .replace('/*ACCOUNT_IDS*/', ids.map(a => `'${a}'`).join(',')));
  const g = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const out = [];
  for (const r of rows || []) {
    const usd = minorToUsd(g(r, 'amount_minor'), g(r, 'ccy'));
    if (usd == null) continue;                 // unknown currency — excluded, as everywhere else
    const acct = g(r, 'acct');
    out.push({
      m: g(r, 'month'), d: g(r, 'dim'), s: g(r, 'seg'),
      cc: acct ? (cba[acct] || CC_UNKNOWN) : CC_UNKNOWN,
      n: Number(g(r, 'txns')) || 0,
      usd,
    });
  }
  return out;
}
async function fetchProfileCost(conn, acctIds, countryByAcct) {
  const ids = sanitizeAccts(acctIds);
  if (!ids.length) return [];
  const cba = countryByAcct || {};
  const rows = await executeQuery(conn, loadSql('profile_cost.sql')
    .replace('/*ACCOUNT_IDS*/', ids.map(a => `'${a}'`).join(',')));
  const g = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  const out = [];
  for (const r of rows || []) {
    const ccy = g(r, 'ccy');
    const usd = minorToUsd(g(r, 'amount_minor'), ccy);
    if (usd == null) continue;
    const acct = g(r, 'acct');
    // Cost is billed in the fee currency, which need not be the charge currency.
    const cost = minorToUsd(g(r, 'cost_minor'), g(r, 'fee_ccy') || ccy);
    out.push({
      m: g(r, 'month'),
      cc: acct ? (cba[acct] || CC_UNKNOWN) : CC_UNKNOWN,
      brand: g(r, 'brand'), funding: g(r, 'funding'), presence: g(r, 'presence'),
      n: Number(g(r, 'txns')) || 0,
      priced: Number(g(r, 'charges_priced')) || 0,
      usd,
      pricedUsd: minorToUsd(g(r, 'amount_priced_minor'), ccy) || 0,
      cost: cost == null ? 0 : cost,
    });
  }
  return out;
}
async function fetchProfileAcceptance(conn) {
  const rows = await executeQuery(conn, loadSql('profile_acceptance.sql'));
  const g = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  return (rows || []).map(r => ({
    m: g(r, 'month'), o: g(r, 'outcome'), r: g(r, 'reason') || '',
    brand: g(r, 'brand'), funding: g(r, 'funding'), input: g(r, 'input_method'),
    retry: g(r, 'retry_status'), fin: !!g(r, 'is_final_attempt'),
    n: Number(g(r, 'attempts')) || 0,
    // AMOUNT_IN_USD is already USD in the minor unit; Stripe's own conversion, not our FX map.
    usd: Math.round((Number(g(r, 'usd_minor')) || 0)) / 100,
  }));
}
function writeProfile(mix, cost, acceptance) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const tpv = mix.filter(r => r.d === 'brand').reduce((s, r) => s + r.usd, 0);
  const out =
`// Loyverse Payments PAYMENT PROFILE — regenerated daily by activated-payments/pull.js.
//
// __PROFILE_MIX   share of TPV by segment. One row per {m month, d dimension, s segment,
//                 cc merchant market, n transactions, usd}. Dimensions: brand, funding, wallet,
//                 read_method, card_country, presence, reader. Every dimension covers the SAME
//                 charges, so each one sums to the same total — that is the check to run first
//                 if a number looks wrong.
// __PROFILE_COST  cost per segment, from ICPLUS_FEES collapsed to ONE ROW PER CHARGE before
//                 joining. Without that collapse the charge amount repeats once per fee row and
//                 inflates the denominator roughly fourfold, which is what a first pass did.
//                 \`priced\`/\`pricedUsd\` are the charges that actually carry a cost row yet;
//                 interchange posts on Stripe's schedule, so the newest month is never fully
//                 priced and bps must be taken over pricedUsd, not usd.
// __PROFILE_ACCEPT authorisation ATTEMPTS — a different population from the captured charges
//                 above. Do not divide one by the other and do not add its volume into a TPV
//                 share; it exists to show what was offered and refused.
//
// DEVICE MODEL IS NOT IN THE SHARE. Charges carry TERMINAL_READER_ID and 127 distinct readers
// cover 99.9% of TPV, but TERMINAL_READERS holds one row — the platform's own — so none of them
// resolve to a DEVICE_TYPE. M2 vs S710 vs Tap to Phone therefore cannot be split today. The
// read_method dimension (contactless / chip / swipe) is exact and is what the page shows instead.
// Generated ${stamp}
window.__PROFILE_MIX    = ${JSON.stringify(mix)};
window.__PROFILE_COST   = ${JSON.stringify(cost)};
window.__PROFILE_ACCEPT = ${JSON.stringify(acceptance)};
window.__PROFILE_META   = ${JSON.stringify({ generatedAt: stamp, tpv: Math.round(tpv * 100) / 100 })};
`;
  fs.writeFileSync(PROFILE_FILE, out);
  console.log(`✓ profile-data.js: ${mix.length} mix rows, ${cost.length} cost rows, `
            + `${acceptance.length} acceptance rows — TPV $${Math.round(tpv).toLocaleString()}`);
}

// ── COHORT MEMBERSHIP FOR THE KPI DASHBOARD TRIANGLE ─────────────────────────
// The triangle needs to answer questions like "of the July cohort, how many were active AND
// transacting in month M?". A pre-summed total cannot answer that, so this ships the MEMBERSHIP:
// one compact record per merchant holding a connected account, from which the dashboard counts
// any intersection it likes, at any cohort age, for any country selection.
//
// SHAPE. `months` is the month axis; every other month reference is an INDEX into it, so the
// file stays small as history grows. Per merchant:
//   o    Loyverse owner id      n  business name      e  email
//   c    ISO-2 market (CONNECTED_ACCOUNTS.COUNTRY, the same field the payments pages filter on)
//   h    registration cohort, as an index into `months`
//   d    registration date, as written — the cohort index only carries the month
//   k    month index the merchant INITIATED KYC (connected a Stripe account)
//   f    month index the merchant FINALIZED KYC — see the proxy caveat below
//   p    months the merchant was PAYING          (sorted indices)
//   a    months the merchant was ACTIVE          (sorted indices)
//   t    months the merchant TRANSACTED on Loyverse Payments (sorted indices)
//
// KYC steps are one-way doors and are stored as the single month they were crossed; the
// dashboard reads them cumulatively (reached by month M). Paying, active and transacting are
// in-month states and are stored as the explicit set of months they held.
//
// CAVEAT, carried into the file itself so nobody has to come here to find it: Stripe exposes
// no `charges_enabled_at`, so FINALIZED KYC is dated by TOS_ACCEPTANCE_DATE — the moment the
// merchant accepted terms, which is the same proxy the payments funnel already uses. A merchant
// enabled weeks after accepting terms is booked at the earlier month.
function buildPayCohort(funnel, flags, acctMonths, meta, accountRows) {
  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  // Transacting months are keyed by STRIPE ACCOUNT; everything else is keyed by owner. Fold the
  // account months onto the owner, so a merchant with two accounts transacting in the same month
  // counts once rather than twice.
  const acctToOwner = {};
  Object.keys(meta || {}).forEach(a => { if (meta[a] && meta[a].owner_id) acctToOwner[a] = String(meta[a].owner_id); });
  const txnByOwner = {};
  Object.keys(acctMonths || {}).forEach(a => {
    const o = acctToOwner[a]; if (!o) return;
    const s = txnByOwner[o] || (txnByOwner[o] = new Set());
    acctMonths[a].forEach(m => s.add(m));
  });

  const rows = (funnel.merchants || []).filter(m => m.connected_at);
  const mo = d => (d ? String(d).slice(0, 7) : null);

  // The month axis spans every month any record references, so no index can fall outside it.
  const seen = new Set();
  const note = m => { if (m) seen.add(m); };
  rows.forEach(m => {
    note(mo(m.registered_at)); note(mo(m.connected_at)); note(mo(m.enabled_at));
    const f = flags[String(m.oid)] || {};
    (f.pay || []).forEach(note); (f.act || []).forEach(note);
    (txnByOwner[String(m.oid)] ? [...txnByOwner[String(m.oid)]] : []).forEach(note);
  });
  const months = [...seen].sort();
  const idx = {}; months.forEach((m, i) => { idx[m] = i; });
  const ix = m => (m && idx[m] !== undefined ? idx[m] : null);
  const ixs = arr => [...new Set((arr || []).map(ix).filter(v => v !== null))].sort((x, y) => x - y);

  // Identity travels with the record so a triangle cell can name the merchants behind its count.
  // Roughly 50 KB across the file — worth it: without it a cell reading 10 is a number nobody can
  // check, and checking one was how the off-POS payment case got explained.
  const merchants = rows.map(m => {
    const f = flags[String(m.oid)] || {};
    const t = txnByOwner[String(m.oid)] ? [...txnByOwner[String(m.oid)]] : [];
    return {
      o: String(m.oid), n: m.name || '', e: m.email || '',
      c: m.cc || CC_UNKNOWN,
      h: ix(mo(m.registered_at)),
      d: m.registered_at || null,
      k: ix(mo(m.connected_at)),
      f: ix(mo(m.enabled_at)),
      p: ixs(f.pay), a: ixs(f.act), t: ixs(t),
    };
  }).filter(r => r.h !== null);   // no registration month = no cohort to sit in

  const withFlags = merchants.filter(r => r.p.length || r.a.length).length;
  return {
    months, merchants,
    coverage: {
      connected: rows.length,
      placed: merchants.length,
      withMonthlyFlags: withFlags,
      transacting: merchants.filter(r => r.t.length).length,
    },
  };
}
function writePayCohort(pc) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  // JSON, fetched by the dashboard with cache:'no-cache' rather than loaded as a <script src>.
  // As a script tag the browser served an eleven-minute-old copy inside an otherwise current
  // page, which reads exactly like wrong numbers rather than like a stale file.
  //
  // JSON carries no comments, so what the fields mean travels in the payload itself. That is
  // deliberate: this file is read by people debugging a number that looks wrong, and the
  // caveats are the first thing they need.
  const out = {
    _readme: {
      what: 'Loyverse Payments cohort membership — one record per merchant holding a PROD Stripe '
          + 'connected account. Regenerated by activated-payments/pull.js.',
      whyHere: 'Written into the KPI dashboard folder because the cohort triangle is a different '
             + 'Cloudflare Pages site, and a cross-origin fetch would have to clear Cloudflare Access.',
      fields: {
        o: 'Loyverse owner id', n: 'business name', e: 'email',
        c: 'market (ISO-2), from CONNECTED_ACCOUNTS.COUNTRY',
        h: 'registration cohort — index into months[]',
        d: 'registration date as written; h carries only the month',
        k: 'month KYC was INITIATED (account connected) — index into months[]',
        f: 'month KYC was FINALIZED — index into months[]; see caveats.finalizedKyc',
        p: 'months the merchant was PAYING — indices into months[]',
        a: 'months the merchant was ACTIVE — indices into months[]',
        t: 'months the merchant TRANSACTED on Loyverse Payments — indices into months[]',
      },
      reading: 'k and f are one-way doors: read them as "had reached this step by month M". '
             + 'p, a and t are in-month states: the merchant held them in exactly the months listed.',
      caveats: {
        finalizedKyc: 'Stripe publishes no charges_enabled_at, so this is TOS_ACCEPTANCE_DATE — the '
                    + 'moment terms were accepted, the same proxy the payments funnel uses. A merchant '
                    + 'enabled weeks after accepting terms is booked at the earlier month, so these '
                    + 'counts lead reality rather than lagging it.',
        population: 'Only merchants with a connected account. This can never stand in for the '
                  + "dashboard's own Paying / Active series, which cover every merchant; it exists to "
                  + 'make intersections with the payments funnel countable.',
        active: 'Months up to the monthly sales table\'s last month come from that table; later months '
              + 'come from raw receipts, because the monthly table lags and covers none of the '
              + 'payments window.',
      },
    },
    generatedAt: stamp,
    months: pc.months,
    merchants: pc.merchants,
    coverage: pc.coverage,
  };
  fs.writeFileSync(PAY_COHORT_FILE, JSON.stringify(out));
  console.log(`✓ payments-cohort.json: ${pc.merchants.length} merchants over ${pc.months.length} months `
            + `(${pc.coverage.withMonthlyFlags} with paying/active history, ${pc.coverage.transacting} transacting)`);
}
function writeFunnel(funnel, terminalReady, bases, basesMonthly, basesByCc, basesMonthlyByCc) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const out =
`// Loyverse Payments FUNNEL — regenerated daily by activated-payments/pull.js.
// Population = genuine registrations in every live market since that market's launch
// (${MARKETS.map(m => m.cc + ' ' + m.launch).join(', ')}; LOYVERSE_MERCHANTS, BOTS EXCLUDED)
// ∪ all prod connected accounts (the payments book) ∪ pilot 500.
// Stages: entered -> initiated KYC (connected) -> passed KYC -> transacting. Each merchant
// carries its stage timestamps; the UI recomputes the group funnels + origin split client-side.
// __FUNNEL_BASES = per-group US denominators from sql/us_bases.sql (new / paying / nonpaying /
// dormant, disjoint and summing to total_us; active_us + paying_us are reference-only).
// __FUNNEL_BASES_MONTHLY = the same four bases AS OF each month end (sql/us_bases_monthly.sql),
// so the Funnel page's month filter divides a month's numerators by that month's denominators.
// Newest row is the month in progress (partial:true, asof = pull date). Paying status in past
// months is reconstructed from ACTIVATED_AT/CANCELLED_AT, so it can differ slightly from the
// all-time row above — pull.js logs the gap on every run.
//
// COUNTRY (added 2026-08-17, UK launch):
//   __FUNNEL_MERCHANTS[].cc      the merchant's ISO-2 market
//   __FUNNEL_STAGES_BY           stage counts per market; each market's stages sum to __FUNNEL_STAGES
//   __FUNNEL_BASES_BY_CC         the four group bases per market (US entry is identical to __FUNNEL_BASES)
//   __FUNNEL_BASES_MONTHLY_BY_CC the month-end series per market
//   __FUNNEL_MARKETS             the live markets and their launch dates, in launch order
// __FUNNEL_BASES / __FUNNEL_BASES_MONTHLY still hold the US series unchanged, so anything
// that read this file before the UK launch reads exactly the same numbers it read then.
// Bots removed via documented US business-name fraud signatures (Second Brain: US Registration Bot).
// Do NOT edit by hand; overwritten each morning. Last pull: ${stamp}
window.__FUNNEL_UPDATED = ${JSON.stringify(stamp)};
window.__FUNNEL_STAGES = ${JSON.stringify(funnel.stages)};
window.__FUNNEL_STAGES_BY = ${JSON.stringify(funnel.stagesBy || {})};
window.__FUNNEL_ENTERED_TOTAL = ${JSON.stringify(funnel.entered_total)};
window.__FUNNEL_BOTS_EXCLUDED = ${JSON.stringify(funnel.botsExcluded)};
window.__FUNNEL_LAUNCH_START = ${JSON.stringify(funnel.launch_start)};
window.__FUNNEL_MARKETS = ${JSON.stringify(MARKETS)};
window.__FUNNEL_TERMINAL_READY = ${JSON.stringify(!!terminalReady)};
window.__FUNNEL_BASES = ${JSON.stringify(bases || null)};
window.__FUNNEL_BASES_MONTHLY = ${JSON.stringify(basesMonthly || [])};
window.__FUNNEL_BASES_BY_CC = ${JSON.stringify(basesByCc || {})};
window.__FUNNEL_BASES_MONTHLY_BY_CC = ${JSON.stringify(basesMonthlyByCc || {})};
window.__FUNNEL_MERCHANTS = ${JSON.stringify(funnel.merchants)};
`;
  fs.writeFileSync(FUNNEL_FILE, out, 'utf8');
  const sb = funnel.stagesBy || {};
  const perCc = Object.keys(sb).sort().map(cc => `${cc} ${sb[cc].entered}/${sb[cc].signed_up}/${sb[cc].enabled}/${sb[cc].transacting}`).join('  ');
  console.log(`✓ Wrote ${FUNNEL_FILE} — entered ${funnel.entered_total} (bots excluded ${funnel.botsExcluded}), signed_up ${funnel.stages.signed_up}, enabled ${funnel.stages.enabled}, transacting ${funnel.stages.transacting}, rows ${funnel.merchants.length}`);
  console.log(`  by market (entered/signed_up/enabled/transacting): ${perCc || 'none'}`);
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

  // Prod Stripe account ids drive the daily terminal-volume layer (runtime-derived).
  const prodAccts = Object.keys(meta).filter(a => meta[a] && meta[a].environment === 'prod');

  // Country dimension (UK launch, Aug 2026). Built once from connected_accounts.sql and
  // threaded into every downstream layer so there is exactly one answer to "what country
  // is this merchant" across Overview, Funnel and Report.
  const countryByAcct = buildCountryByAcct(accountRows);
  const countryByMid = buildCountryByMid(countryByAcct, meta);
  {
    const tally = {};
    for (const a of prodAccts) bump(tally, countryByAcct[a] || CC_UNKNOWN, 1);
    console.log(`✓ country map: ${Object.keys(countryByAcct).length} accounts, ${Object.keys(countryByMid).length} owner ids — prod split ${JSON.stringify(tally)}`);
  }

  let subs = {}, sales = {}, vol = { byDay: {}, unknownCcy: {} }, txnByAcct = {}, feeByAcct = {}, costByAcct = {};
  const [subsR, salesR, volR, txnR, feeR, costR] = await Promise.allSettled([
    fetchSubscriptions(conn, merchantIds),
    fetchSales(conn, merchantIds),
    fetchDailyVolume(conn, prodAccts, countryByAcct),
    fetchTxnByAccount(conn, prodAccts),
    fetchAppFeesByAccount(conn, prodAccts),
    fetchIcplusCostByAccount(conn, prodAccts),
  ]);
  if (subsR.status === 'fulfilled') { subs = subsR.value; console.log(`✓ subscriptions: ${Object.keys(subs).length} merchants`); }
  else console.error(`✗ subscriptions query failed: ${subsR.reason && subsR.reason.message}`);
  if (salesR.status === 'fulfilled') { sales = salesR.value; console.log(`✓ sales_monthly: ${Object.keys(sales).length} merchants`); }
  else console.error(`✗ sales_monthly query failed: ${salesR.reason && salesR.reason.message}`);
  if (volR.status === 'fulfilled') { vol = volR.value; console.log(`✓ daily_volume: ${Object.keys(vol.byDay).length} days${Object.keys(vol.unknownCcy).length ? '  (unknown ccy skipped: ' + JSON.stringify(vol.unknownCcy) + ')' : ''}`); }
  else console.error(`✗ daily_volume query failed: ${volR.reason && volR.reason.message}`);
  if (txnR.status === 'fulfilled') { txnByAcct = txnR.value; console.log(`✓ txn_by_account: ${Object.keys(txnByAcct).length} transacting merchants`); }
  else console.error(`✗ txn_by_account query failed: ${txnR.reason && txnR.reason.message}`);
  if (feeR.status === 'fulfilled') { feeByAcct = feeR.value; console.log(`✓ app_fees_by_account: ${Object.keys(feeByAcct).length} merchants with captured fees`); }
  else console.error(`✗ app_fees_by_account query failed (captured/take-rate will be blank): ${feeR.reason && feeR.reason.message}`);
  if (costR.status === 'fulfilled') { costByAcct = costR.value; console.log(`✓ icplus_cost_by_account: ${Object.keys(costByAcct).length} merchants with Stripe cost`); }
  else console.error(`✗ icplus_cost_by_account query failed (margin will be blank): ${costR.reason && costR.reason.message}`);

  const { act, kyc, linked, enabled, prodN, testN, withSub, withPos } = buildData(accountRows, existingByAcct, meta, subs, sales);
  writeData(act, kyc);

  // Overview (first page) — daily activations, backfilled enabled curve, daily volume, txn table.
  // Hoisted out of the try: the Report step below reuses these three daily series rather than
  // rebuilding them, and must still get them if a later part of the overview write fails.
  let actDaily = [], enabledDaily = [], txnMerchants = [];
  try {
    actDaily = buildActivationsDaily(accountRows, meta);
    enabledDaily = buildEnabledDaily(accountRows, meta);
    const volDaily = denseDailyVolume(vol.byDay);
    const enabledSnap = buildEnabledSnapshot(readExistingSnapshot(), act);
    txnMerchants = buildTxnMerchants(accountRows, meta, txnByAcct, feeByAcct, costByAcct, countryByAcct);
    writeOverview(actDaily, volDaily, enabledSnap, enabledDaily, txnMerchants);
  } catch (e) { console.error(`✗ overview build failed: ${e.message}`); }

  // Funnel (Payments sub-tab) — entry cohort (US-since-launch ∪ pilot) → stage progression.
  try {
    const pilot = readPilot();
    // Registration dates for the pilot AND every connected owner (so pre-launch signups still
    // get a registered_at for the timing clock + date-range slicing), plus all US-since-launch regs.
    const connOwners = Object.values(meta).map(x => x.owner_id).filter(Boolean).map(String);
    const regIds = [...pilot.map(p => p.oid), ...connOwners];
    const regs = await fetchUsRegistrations(conn, regIds);
    {
      const rt = {}; Object.values(regs).forEach(r => bump(rt, r.cc || CC_UNKNOWN, 1));
      console.log(`✓ us_registrations: ${Object.keys(regs).length} rows (${MARKETS.map(m => m.cc + ' since ' + m.launch).join(' + ')} + pilot + connected owners) — by market ${JSON.stringify(rt)}`);
    }
    let termByEmail = {}, terminalReady = false;
    try { termByEmail = await fetchTerminalOrders(conn); terminalReady = true; console.log(`✓ terminal_orders: ${Object.keys(termByEmail).length} merchant emails with a terminal order`); }
    catch (e) { console.error(`✗ terminal_orders query failed (terminal drill-down will be empty): ${e.message}`); }

    // ── Group bases, ONE SET PER LIVE MARKET (2026-08-17) ──────────────────────
    // basesByCc / basesMonthlyByCc are keyed by ISO-2 country. `bases` / `basesMonthly`
    // stay bound to the US so every existing consumer — including the previously-committed
    // file the failure path falls back to — is untouched by the UK going live.
    // Each market is fetched independently and guarded independently: a market whose query
    // fails must not be able to take down a market whose query succeeded.
    const basesByCc = {}, basesMonthlyByCc = {};
    for (const mkt of MARKETS) {
      try {
        const b = await fetchUsBases(conn, mkt);
        if (b) {
          basesByCc[mkt.cc] = b;
          console.log(`✓ us_bases[${mkt.cc}]: new=${b.new_us}  paying=${b.paying_base_us}  nonpaying=${b.nonpaying_us}  dormant=${b.dormant_us}  total=${b.total_us}`);
        } else {
          console.error(`✗ us_bases[${mkt.cc}] returned no usable row`);
        }
      } catch (e) { console.error(`✗ us_bases[${mkt.cc}] query failed: ${e.message}`); }
      // Month-end bases for the Funnel page's month filter. GUARDED: an extra Snowflake
      // round-trip added after the page was already working must not be able to break it —
      // on failure the previously-committed series is carried forward, and if there is none
      // the UI falls back to the all-time bases and says so.
      try {
        const bm = await fetchUsBasesMonthly(conn, mkt);
        if (bm) {
          basesMonthlyByCc[mkt.cc] = bm;
          console.log(`✓ us_bases_monthly[${mkt.cc}]: ${bm.length} months (${bm[0].month} → ${bm[bm.length - 1].month})`);
          reportMonthlyBaseGap(basesByCc[mkt.cc], bm);
        } else {
          console.error(`✗ us_bases_monthly[${mkt.cc}] returned no usable rows`);
        }
      } catch (e) { console.error(`✗ us_bases_monthly[${mkt.cc}] query failed: ${e.message}`); }
    }
    // US remains the file's primary series; if its query failed, carry yesterday's forward
    // exactly as before rather than shipping a page with no denominators.
    let bases = basesByCc.US || null;
    if (!bases) { bases = readExistingBases(); if (bases) { basesByCc.US = bases; console.error('  us_bases[US]: carrying previously-committed bases forward'); } }
    let basesMonthly = basesMonthlyByCc.US || null;
    if (!basesMonthly) { basesMonthly = readExistingBasesMonthly(); if (basesMonthly) { basesMonthlyByCc.US = basesMonthly; console.error('  us_bases_monthly[US]: carrying previously-committed series forward'); } }

    // Group tags for every owner in the book, drawn with the same rule that sizes the bases.
    // Non-fatal: without them the UI falls back to the legacy pos_active/is_paying split.
    // Tagged per market and merged — a merchant only ever matches its own market's query,
    // so the merge cannot produce a conflicting tag for the same owner id.
    let groupTags = {};
    for (const mkt of MARKETS) {
      try {
        const t = await fetchUsGroupTags(conn, connOwners, mkt);
        Object.assign(groupTags, t);
        const tally = {};
        Object.values(t).forEach(function(x){ tally[x.grp] = (tally[x.grp] || 0) + 1; });
        console.log(`✓ us_group_tags[${mkt.cc}]: ${Object.keys(t).length} owners tagged ${JSON.stringify(tally)}`);
      } catch (e) { console.error(`✗ us_group_tags[${mkt.cc}] query failed (that market's funnel groups fall back to pos_active): ${e.message}`); }
    }
    console.log(`✓ us_group_tags: ${Object.keys(groupTags).length} of ${connOwners.length} book owners tagged across ${MARKETS.length} markets`);
    const funnel = buildFunnel(accountRows, meta, txnByAcct, regs, pilot, termByEmail, groupTags, countryByAcct);
    writeFunnel(funnel, terminalReady, bases, basesMonthly, basesByCc, basesMonthlyByCc);

    // ---- Report page (monthly series) ----
    // GUARDED: three extra Snowflake round-trips for a page that did not exist before must never
    // be able to break activation-data.js / overview-data.js / funnel-data.js, all already written.
    try {
      const [cmR, revR, costR2, flagsR, recentR] = await Promise.allSettled([
        fetchChargesMonthly(conn, prodAccts, countryByAcct),
        fetchMinorMonthly(conn, prodAccts, 'app_fees_monthly.sql', 'fee_minor', 'fee_cnt', countryByAcct),
        fetchMinorMonthly(conn, prodAccts, 'icplus_cost_monthly.sql', 'cost_minor', 'cost_cnt', countryByAcct),
        fetchMerchantMonthFlags(conn, connOwners),
        // Start one month BEFORE the launch window so the two sources overlap and the seam can
        // be inspected rather than merely trusted.
        fetchRecentActive(conn, connOwners, '2026-01-01'),
      ]);
      const cm = cmR.status === 'fulfilled' ? cmR.value : { byMonth: {}, unknownCcy: {} };
      const rev = revR.status === 'fulfilled' ? revR.value : {};
      const cst = costR2.status === 'fulfilled' ? costR2.value : {};
      if (cmR.status !== 'fulfilled')   console.error(`✗ charges_monthly failed: ${cmR.reason && cmR.reason.message}`);
      if (revR.status !== 'fulfilled')  console.error(`✗ app_fees_monthly failed (revenue/take rate blank): ${revR.reason && revR.reason.message}`);
      if (costR2.status !== 'fulfilled') console.error(`✗ icplus_cost_monthly failed (cost/margin blank): ${costR2.reason && costR2.reason.message}`);
      if (Object.keys(cm.unknownCcy || {}).length) console.log(`  charges_monthly: unknown ccy skipped ${JSON.stringify(cm.unknownCcy)}`);

      // Payment profile. Guarded on its own: three more Snowflake round-trips for a new page
      // must never cost the Report or the cohort file, which are already written by now.
      try {
        const [mixR, costR, accR] = await Promise.allSettled([
          fetchProfileMix(conn, prodAccts, countryByAcct),
          fetchProfileCost(conn, prodAccts, countryByAcct),
          fetchProfileAcceptance(conn),
        ]);
        const mix = mixR.status === 'fulfilled' ? mixR.value : [];
        const cost = costR.status === 'fulfilled' ? costR.value : [];
        const acc = accR.status === 'fulfilled' ? accR.value : [];
        if (mixR.status !== 'fulfilled')  console.error(`✗ profile_mix failed: ${mixR.reason && mixR.reason.message}`);
        if (costR.status !== 'fulfilled') console.error(`✗ profile_cost failed (cost per segment blank): ${costR.reason && costR.reason.message}`);
        if (accR.status !== 'fulfilled')  console.error(`✗ profile_acceptance failed (acceptance blank): ${accR.reason && accR.reason.message}`);
        if (mix.length) {
          // Every dimension covers the same charges, so they must agree on the total. A mismatch
          // means a segment was dropped or double-counted, and the shares on the page would be
          // wrong in a way nobody would notice — so it is checked here, once, out loud.
          const byDim = {};
          mix.forEach(r => { byDim[r.d] = (byDim[r.d] || 0) + r.usd; });
          const totals = Object.entries(byDim).map(([d, v]) => `${d} $${Math.round(v).toLocaleString()}`);
          const vals = Object.values(byDim);
          const spread = Math.max(...vals) - Math.min(...vals);
          console.log(`  profile dimensions: ${totals.join(' · ')}`);
          if (spread > 1) console.error(`  ✗ dimensions disagree by $${spread.toFixed(2)} — a segment is being dropped or duplicated`);
        }
        writeProfile(mix, cost, acc);
      } catch (e) { console.error(`✗ profile-data.js not written: ${e.message}`); }

      // Cohort membership for the KPI dashboard's triangle. Written from data already in hand,
      // and guarded separately: a failure here must not cost the Report page its monthly series.
      // If the flags query failed we still write the file — KYC and transacting membership are
      // intact and useful on their own; only intersections WITH paying/active go quiet.
      try {
        const flags = flagsR.status === 'fulfilled' ? flagsR.value : {};
        if (flagsR.status !== 'fulfilled') console.error(`✗ merchant_month_flags failed (paying/active intersections unavailable): ${flagsR.reason && flagsR.reason.message}`);
        else console.log(`✓ merchant_month_flags: ${Object.keys(flags).length} of ${connOwners.length} connected owners have paying/active history`);
        // Taken BEFORE the receipts months are merged in, so the reconciliation below compares
        // the monthly table against itself rather than against a union that includes another
        // source and would always look inflated.
        const flagMerchants = Object.keys(flags).filter(m => (flags[m].act || []).length).length;
        if (recentR.status !== 'fulfilled') console.error(`✗ merchant_month_active_recent failed — Active will stop at the monthly table's lagged last month, which covers NONE of the payments window: ${recentR.reason && recentR.reason.message}`);
        else {
          const rec = recentR.value;
          mergeRecentActive(flags, rec);
          const months = new Set(); Object.values(rec).forEach(a => a.forEach(m => months.add(m)));
          const ms = [...months].sort();
          console.log(`✓ merchant_month_active_recent: ${Object.keys(rec).length} merchants active in ${ms.length} recent months (${ms[0] || '-'} → ${ms[ms.length - 1] || '-'})`);
        }
        // Standing reconciliation against the collapsed read of the SAME monthly sales table that
        // activation-data.js uses. The two counts should agree closely; a widening gap means the
        // month-level query is dropping merchants the collapsed one keeps, which is exactly the
        // kind of silent loss a cohort view would render as a wall of honest-looking zeros.
        const salesMerchants = Object.keys(sales).filter(m => (sales[m] || {}).receipts > 0).length;
        console.log(`  active-month coverage (monthly table only): ${flagMerchants} merchants vs ${salesMerchants} in the collapsed sales read`
                  + (salesMerchants && flagMerchants < salesMerchants * 0.95 ? '  ← GAP, investigate' : ''));
        writePayCohort(buildPayCohort(funnel, flags, cm.acctMonths || {}, meta, accountRows));
      } catch (e) { console.error(`✗ payments-cohort.js not written (the KPI triangle keeps its previous file): ${e.message}`); }

      const monthly = buildPaymentsMonthly(actDaily, enabledDaily, cm.byMonth, rev, cst, txnMerchants);
      // Funnel-group snapshot: base + numerators, straight from the tagged book.
      const GRP_LABEL = { new: 'New merchants', paying: 'Paying merchants',
                          nonpaying: 'Non paying', dormant: 'Dormant / other' };
      const GRP_BASE  = { new: 'new_us', paying: 'paying_base_us',
                          nonpaying: 'nonpaying_us', dormant: 'dormant_us' };
      const bk = (funnel.merchants || []).filter(m => m.connected_at);
      // One group snapshot from an arbitrary slice of the book against an arbitrary bases object.
      // Factored out so the per-country snapshots are computed by the SAME code as the blended
      // one — a country's rate can then never drift from the all-countries rate by construction.
      const groupsFrom = (rows, bs) => Object.keys(GRP_LABEL).map(g => {
        const rs = rows.filter(m => m.grp === g);
        return {
          g, label: GRP_LABEL[g],
          base: (bs && bs[GRP_BASE[g]] != null) ? bs[GRP_BASE[g]] : null,
          initiated: rs.length,
          passed: rs.filter(m => m.stage === 'enabled' || m.stage === 'transacting' || m.enabled).length,
          transacting: rs.filter(m => m.stage === 'transacting' || m.first_txn_at).length
        };
      });
      const groups = groupsFrom(bk, bases);
      // Per-market snapshots, each against ITS OWN bases (basesByCc), so a UK numerator is never
      // divided by a US denominator — the defect that adding the filter exists to remove.
      const groupsBy = {};
      Array.from(new Set(bk.map(m => m.cc).filter(Boolean).concat(MARKET_CCS))).sort()
        .forEach(cc => { groupsBy[cc] = groupsFrom(bk.filter(m => m.cc === cc), (basesByCc || {})[cc] || null); });
      const untagged = bk.filter(m => !m.grp).length;
      writeReport(monthly, groups, bases, {
        volumeFrom: (monthly.find(x => x.tpv > 0) || {}).m || null,
        untaggedInitiators: untagged,
        launch: LAUNCH_START
      }, groupsBy, basesByCc, MARKETS);
    } catch (e) { console.error(`✗ report build skipped this run: ${e.message}`); }
  } catch (e) { console.error(`✗ funnel build failed: ${e.message}`); }

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
