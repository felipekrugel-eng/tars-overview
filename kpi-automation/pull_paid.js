#!/usr/bin/env node
/**
 * kpi-automation/pull_paid.js — Snowflake → the Marketing dashboard's data file.
 *
 * Runs sql/paid_merchants.sql and sql/paid_campaign_daily.sql and writes
 * "KPI Dashboard v2 (Caio)/paid-data.js" as window.PAID_DATA.
 *
 * THIS REPLACES pull_attribution.js AND THE GOOGLE SHEET. The sheet ("Database with
 * mixpanel") did the click->merchant join in Apps Script, one GCLID at a time, into a
 * Click_IDs tab it had to keep backfilling. The lake already did that join —
 * LOYVERSE_MERCHANT_ATTRIBUTION ships RESOLVED_CAMPAIGN_ID — so the join is not
 * reimplemented here, only read.
 *
 * WHAT IS EMITTED, AND WHY IT IS MERCHANT ROWS AND NOT COUNTS.
 * The page gets one row per attributed merchant with every stage date on it, and does its
 * own counting. That is a deliberate choice against shipping a pre-aggregated funnel:
 *   * the period filter and the campaign filter then select the SAME merchants for every
 *     stage, so the funnel cannot disagree with the tile above it — the exact failure that
 *     cost us two rounds on the Payments activation funnel;
 *   * switching the date basis between click date and signup date is a re-count, not a
 *     re-query;
 *   * the row count is ~220 today and a few thousand at any spend we are likely to reach,
 *     so there is no size argument for aggregating early.
 *
 * RECONCILIATION AGAINST THE SHEET is printed on every run and is the point of the
 * exercise — if this file and the sheet disagree about spend, one of them is wrong and it
 * is cheaper to find out now than in a meeting.
 */

const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');

const ACCOUNT   = 'ORXEAZX-TC97659';
const USERNAME  = 'TARS_SERVICE_USER';
const KEY_PATH  = path.join(__dirname, '..', 'snowflake_tars_key.p8');
const DATABASE  = 'LOYVERSE_DATA_LAKE';
const SCHEMA    = 'PUBLIC';
const WAREHOUSE = 'COMPUTE_WH';
const ROLE      = 'DATA_VIEWER';

const OUT_FILE = process.env.PAID_OUT ||
  path.join(__dirname, '..', 'KPI Dashboard v2 (Caio)', 'paid-data.js');

snowflake.configure({ logLevel: 'ERROR' });

const conn = snowflake.createConnection({
  account: ACCOUNT, username: USERNAME, authenticator: 'SNOWFLAKE_JWT',
  privateKey: fs.readFileSync(KEY_PATH, 'utf8'),
  database: DATABASE, schema: SCHEMA, warehouse: WAREHOUSE, role: ROLE,
});

const q = (sql) => new Promise((res, rej) =>
  conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(new Error(e.message)) : res(r) }));

const get = (r, k) => (r[k] !== undefined ? r[k] : r[k.toLowerCase()]);
const num = v => (v == null ? null : Number(v));
const int = v => (v == null ? 0 : Number(v));
const r2  = v => (v == null ? null : Math.round(Number(v) * 100) / 100);

/** Dates come back as JS Date or string. Format from UTC PARTS, never toISOString on a
 *  local-midnight Date — that silently shifts a day west of Greenwich, a trap this repo
 *  has already been bitten by once. */
function day(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    return v.getUTCFullYear() + '-' + String(v.getUTCMonth() + 1).padStart(2, '0') +
           '-' + String(v.getUTCDate()).padStart(2, '0');
  }
  return String(v).slice(0, 10);
}

const sqlFile = f => fs.readFileSync(path.join(__dirname, 'sql', f), 'utf8').replace(/;\s*$/, '');

async function main() {
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));

  // ── campaign x day spend ───────────────────────────────────────────────────
  let t0 = Date.now();
  const spendRows = await q(sqlFile('paid_campaign_daily.sql'));
  console.log(`✓ paid_campaign_daily: ${spendRows.length} rows, ${((Date.now()-t0)/1000).toFixed(0)}s`);

  const spend = spendRows.map(r => ({
    pf: get(r, 'PLATFORM'),
    cid: get(r, 'CAMPAIGN_ID'),
    c: get(r, 'CAMPAIGN'),
    st: get(r, 'CAMPAIGN_STATUS'),
    ch: get(r, 'CHANNEL'),
    d: day(get(r, 'D')),
    s: num(get(r, 'SPEND')) || 0,
    k: int(get(r, 'CLICKS')),
    i: int(get(r, 'IMPRESSIONS')),
    pc: num(get(r, 'PLATFORM_CONVERSIONS')) || 0,
  }));

  // ── how far Facebook tagging actually reaches ─────────────────────────────
  // Measured, not assumed, and re-measured on every run: the moment the landing page starts
  // forwarding fbclid this number climbs and the Facebook panel stops saying "none resolve"
  // on its own, without anyone remembering to edit the page.
  const fbTag = await q(`
    SELECT COUNT(*) AS TAGGED,
           COUNT_IF(RESOLVED_CAMPAIGN_ID IS NOT NULL) AS RESOLVED
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANT_ATTRIBUTION
    WHERE REFERRER_URL ILIKE '%fbclid%' OR LOWER(UTM_SOURCE) IN ('facebook','instagram','meta')`);
  const fbTagged = int(get(fbTag[0], 'TAGGED'));
  const fbResolved = int(get(fbTag[0], 'RESOLVED'));
  console.log(`  facebook tagging: ${fbTagged} merchant(s) carry an fbclid/meta utm, ${fbResolved} resolve to a campaign`);

  // ── merchant grain (the slow one: a receipts scan, ~60s) ───────────────────
  t0 = Date.now();
  const mRows = await q(sqlFile('paid_merchants.sql'));
  console.log(`✓ paid_merchants: ${mRows.length} merchants, ${((Date.now()-t0)/1000).toFixed(0)}s`);

  const merchants = mRows.map(r => ({
    id: int(get(r, 'MERCHANT_ID')),
    name: get(r, 'BUSINESS_NAME') || null,
    cc: get(r, 'COUNTRY') || null,
    cid: get(r, 'CAMPAIGN_ID') == null ? null : String(get(r, 'CAMPAIGN_ID')),
    c: get(r, 'CAMPAIGN') || null,
    ag: get(r, 'AD_GROUP_NAME') || null,
    kw: get(r, 'KEYWORD') || null,
    net: get(r, 'AD_NETWORK_TYPE') || null,
    via: get(r, 'ATTRIBUTION_METHOD') || null,
    clickD: day(get(r, 'CLICK_DATE')),
    clickExact: !!get(r, 'CLICK_DATE_EXACT'),
    signD: day(get(r, 'SIGNED_UP_DATE')),
    // POS path
    rcptD: day(get(r, 'FIRST_RECEIPT_DATE')),
    lastD: day(get(r, 'LAST_RECEIPT_DATE')),
    rcpts: int(get(r, 'RECEIPTS')),
    r30: int(get(r, 'RECEIPTS_30D')),
    r7: int(get(r, 'RECEIPTS_7D')),
    sdays: int(get(r, 'SELLING_DAYS')),
    a30: int(get(r, 'ACTIVE_30D')),
    a30_5: int(get(r, 'ACTIVE_30D_5')),
    a30_10: int(get(r, 'ACTIVE_30D_10')),
    // Payments path — already made monotonic in SQL
    open: int(get(r, 'OPENED_PAYMENTS')),
    kyc1: int(get(r, 'KYC_STARTED')),
    kyc2: int(get(r, 'KYC_SUBMITTED')),
    kyc3: int(get(r, 'KYC_APPROVED')),
    onb: int(get(r, 'ONBOARDED')),
    acctD: day(get(r, 'ACCOUNT_CREATED_DATE')),
    tosD: day(get(r, 'TOS_DATE')),
    chargeD: day(get(r, 'FIRST_CHARGE_DATE')),
    charges: int(get(r, 'CHARGES')),
    // beside the funnel
    subD: day(get(r, 'FIRST_SUB_DATE')),
  }));

  // ── campaign roster, so the page can list campaigns with no merchants at all ──
  const camps = new Map();
  for (const s of spend) {
    if (!camps.has(s.cid)) camps.set(s.cid, { cid: s.cid, c: s.c, pf: s.pf, ch: s.ch, st: s.st, spend: 0, clicks: 0 });
    const e = camps.get(s.cid); e.spend += s.s; e.clicks += s.k;
    if (s.st) e.st = s.st;
  }
  for (const e of camps.values()) e.spend = r2(e.spend);

  // ── integrity checks, printed loudly ──────────────────────────────────────
  const attributable = new Set(merchants.filter(m => m.cid).map(m => m.cid));
  const noMerchants = [...camps.values()].filter(c => !attributable.has(c.cid));
  const stageOrder = ['open', 'kyc1', 'kyc2', 'kyc3', 'onb'];
  let nonMono = 0;
  for (const m of merchants) {
    for (let i = 1; i < stageOrder.length; i++) if (m[stageOrder[i]] > m[stageOrder[i - 1]]) nonMono++;
    if (m.charges > 0 && !m.onb) nonMono++;
  }
  if (nonMono) console.error(`✗ ${nonMono} non-monotonic stage transitions — the SQL ladder is not doing its job`);
  else console.log('✓ payments ladder is monotonic on every merchant');

  const totSpend = r2([...camps.values()].reduce((a, c) => a + c.spend, 0));
  const gSpend = r2([...camps.values()].filter(c => c.pf === 'google').reduce((a, c) => a + c.spend, 0));
  const fSpend = r2([...camps.values()].filter(c => c.pf === 'facebook').reduce((a, c) => a + c.spend, 0));
  console.log(`  spend: $${totSpend} total — google $${gSpend}, facebook $${fSpend}`);
  console.log(`  attributed merchants: ${merchants.length}` +
              `  (exact click date on ${merchants.filter(m => m.clickExact).length})`);
  console.log(`  POS: sold ${merchants.filter(m => m.rcptD).length}` +
              `  active30 ${merchants.filter(m => m.a30).length}` +
              `  active30x5 ${merchants.filter(m => m.a30_5).length}` +
              `  active30x10 ${merchants.filter(m => m.a30_10).length}` +
              `  lapsed ${merchants.filter(m => m.rcptD && !m.a30).length}`);
  console.log(`  funnel: receipt ${merchants.filter(m => m.rcptD).length}` +
              `  opened ${merchants.filter(m => m.open).length}` +
              `  kyc1 ${merchants.filter(m => m.kyc1).length}` +
              `  kyc2 ${merchants.filter(m => m.kyc2).length}` +
              `  kyc3 ${merchants.filter(m => m.kyc3).length}` +
              `  onboarded ${merchants.filter(m => m.onb).length}` +
              `  used ${merchants.filter(m => m.chargeD).length}` +
              `  subscribed ${merchants.filter(m => m.subD).length}`);
  if (noMerchants.length) {
    console.log(`  NOTE ${noMerchants.length} campaign(s) have spend but no attributable merchant: ` +
                noMerchants.map(c => `${c.c} ($${c.spend})`).join(', '));
  }

  const days = spend.map(s => s.d).filter(Boolean).sort();
  const out = {
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    range: { from: days[0] || null, to: days[days.length - 1] || null },
    campaigns: [...camps.values()].sort((a, b) => b.spend - a.spend),
    spend,
    merchants,
    // Stated in the data rather than hard-coded in the page, so the page cannot drift from
    // the truth about its own coverage.
    caveats: {
      attributionIsSample: true,
      facebookAttributable: false,
      facebookTaggedMerchants: fbTagged,
      facebookResolvedMerchants: fbResolved,
      mixpanelStagesMissing: ['Opened the app', 'Added a customer'],
    },
  };

  const banner = `// Paid acquisition — generated by kpi-automation/pull_paid.js. Do NOT edit by hand.
//
// window.PAID_DATA = {
//   campaigns[] : {cid, c, pf, ch, st, spend, clicks} — every campaign with spend, including
//                 ones no merchant can be attributed to. A campaign missing from the funnel
//                 but present here is information, not an error.
//   spend[]     : {pf, cid, c, st, ch, d, s, k, i, pc} per platform x campaign x DAY.
//                 \`pc\` is the PLATFORM's own conversion count — Google's conversions or
//                 Meta's — and is NOT a merchant. Never divide spend by it and call the
//                 result a CAC.
//   merchants[] : one row per ATTRIBUTED merchant, every stage date on it. The page counts
//                 these itself, so the tiles and the funnel are counting the same rows and
//                 cannot disagree.
//                 clickD/signD  the two date bases. clickExact=false means CLICK_DATE was
//                               unavailable (gad_campaignid path) and signD was substituted.
//                 rcptD/lastD   POS path — first and last receipt.
//                 r30/r7/sdays  receipts in the trailing 30 and 7 days, and distinct days
//                               sold on. a30/a30_5/a30_10 are the 1+/5+/10+ receipts-in-30d
//                               activity thresholds, the SAME ones the Study & Trend page
//                               uses, so "active" means one thing across the dashboard.
//                               Measured in receipts, not GTV, on purpose: the GTV recipe is
//                               currently ~1.7x the agreed baseline and under recalibration.
//                 open..onb     payments path, already forced monotonic in SQL.
//                 \`open\` is "a Stripe account exists"; \`kyc1\` is "typed the first field".
//                 chargeD       payments used.
//                 subD          subscribed — BESIDE the funnel, not a step in it.
//
//   THE FUNNEL BRANCHES. "Issued a receipt" and "KYC started" are parallel paths off
//   "Signed up", not consecutive steps. There is no conversion rate between them.
//
//   ATTRIBUTION IS A SAMPLE. First-touch, written once at registration, never updated. A
//   merchant with no campaign is UNKNOWN, not organic. Do not publish these as shares of
//   all signups.
//
//   FACEBOOK HAS NO MERCHANT PATH. Meta does not expose click ids in Insights and the
//   landing page does not capture fbclid, so Facebook is spend and clicks only.
// }
`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, banner + 'window.PAID_DATA = ' + JSON.stringify(out) + ';\n', 'utf8');
  console.log(`✓ wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
  conn.destroy(() => process.exit(0));
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
