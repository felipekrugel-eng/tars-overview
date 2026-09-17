#!/usr/bin/env node
/**
 * kpi-automation/pull_attribution.js — Snowflake → merchant attribution for the
 * Marketing dashboard.
 *
 * WHAT THIS ADDS THAT ads-data.js CANNOT
 * ads-data.js comes from Google Ads and stops at the click: impressions, cost, and
 * Google's own count of "conversions". It has no idea which Loyverse merchant, if any,
 * a click became. As of 2026-09-17 the lake carries merchant-level attribution
 * (PUBLIC.LOYVERSE_MERCHANT_ATTRIBUTION) and an hourly Airbyte sync of the Google Ads
 * API (the GOOGLE_ADS schema), so for the first time an ad click can be followed all the
 * way through to a real merchant and what that merchant went on to do:
 *
 *     spend -> click -> merchant -> sold anything -> opened payments -> passed KYC
 *
 * That chain is the whole point of this file. Cost per merchant is a different — and
 * much harsher — number than Google's cost per conversion, and cost per merchant who
 * actually passed KYC is different again.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not touch ads-data.js or the Google Ads export. The existing page keeps its
 * own spend series; this file carries its own, read from GOOGLE_ADS. The two agree to
 * ~1.4% (2026-09-17: $4,069.40 here against $4,013.02 in the sheet over the same
 * window) because Google restates cost for a few days after the fact and the sheet was
 * exported earlier. Rather than pick a winner, the page shows which source each figure
 * came from. Moving the whole page onto GOOGLE_ADS is the real fix and is a separate job.
 *
 * THE SHAPE OF THE DATA IS UNUSUALLY IMPORTANT HERE
 * Attribution is first-touch, written once at registration from the Play install referrer
 * or the web signup form, and never updated. It was backfilled by replaying Kafka, whose
 * retention is 60 days, so it covers ~127k of 5.05M merchants. A NULL referrer therefore
 * means "we do not know", NOT "organic" — anyone reading these shares as complete will be
 * badly wrong. Every count here is of the attributed sample only, and the page says so.
 *
 * Writes KPI Dashboard v2 (Caio)/attribution-data.js as window.ATTR_DATA.
 */

const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');

// ── Config — same service account and key as activated-payments/pull.js ──────
const ACCOUNT   = 'ORXEAZX-TC97659';
const USERNAME  = 'TARS_SERVICE_USER';
const KEY_PATH  = path.join(__dirname, '..', 'snowflake_tars_key.p8'); // written by CI at repo root
const DATABASE  = 'LOYVERSE_DATA_LAKE';
const SCHEMA    = 'PUBLIC';
const WAREHOUSE = 'COMPUTE_WH';
const ROLE      = 'DATA_VIEWER';

const P = 'LOYVERSE_DATA_LAKE.PUBLIC';
const G = 'LOYVERSE_DATA_LAKE.GOOGLE_ADS';
const STRIPE = 'GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE';

const OUT_FILE = path.join(__dirname, '..', 'KPI Dashboard v2 (Caio)', 'attribution-data.js');

snowflake.configure({ logLevel: 'ERROR' });

function createConnection() {
  return snowflake.createConnection({
    account: ACCOUNT, username: USERNAME, authenticator: 'SNOWFLAKE_JWT',
    privateKey: fs.readFileSync(KEY_PATH, 'utf8'),
    database: DATABASE, schema: SCHEMA, warehouse: WAREHOUSE, role: ROLE,
  });
}
function q(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.execute({ sqlText: sql, complete: (e, st, rows) => e ? reject(new Error(e.message)) : resolve(rows) });
  });
}
const num = v => (v == null ? null : Number(v));
const round2 = v => (v == null ? null : Math.round(Number(v) * 100) / 100);

// ── The paid-ads population ──────────────────────────────────────────────────
// "Came from an ad" means a real click identity — a gclid or a Google campaign id — or an
// explicitly paid medium. It deliberately excludes utm_medium='web', which is Loyverse's
// OWN site tagging its own links, and would otherwise dwarf the ad numbers with traffic we
// never paid Google for. RESOLVED_CAMPAIGN_ID is required as well, because a click we
// cannot tie to a campaign cannot be costed.
const PAID_WHERE = `(GCLID IS NOT NULL OR GAD_CAMPAIGNID IS NOT NULL)
                    AND RESOLVED_CAMPAIGN_ID IS NOT NULL`;

// Channel buckets for the mix card. Order matters — the first match wins, and paid is
// tested first so a tagged paid link cannot be miscounted as own-site.
//
// The Play Store default (utm_source=google-play&utm_medium=organic) is pulled out on its
// own rather than lumped into organic: it is 90.7% of all referrers in the source system
// and means nothing except "an untagged Android install", so leaving it in any comparison
// buries everything else.
const CHANNEL_CASE = `
  CASE
    WHEN GCLID IS NOT NULL OR GAD_CAMPAIGNID IS NOT NULL THEN 'Paid ads'
    WHEN LOWER(UTM_MEDIUM) IN ('ppc','paid_social','cpc','cpm','paidsearch') THEN 'Paid ads'
    WHEN REFERRER_URL = 'utm_source=google-play&utm_medium=organic' THEN 'Play Store default'
    WHEN LOWER(UTM_SOURCE) IN ('chatgpt.com','perplexity.ai','claude.ai','gemini.google.com','copilot.microsoft.com')
      OR LOWER(UTM_SOURCE) LIKE '%chatgpt%' OR LOWER(UTM_SOURCE) LIKE '%perplexity%' THEN 'AI referral'
    WHEN LOWER(UTM_SOURCE) LIKE 'loyverse.%' OR LOWER(UTM_SOURCE) LIKE 'cds%'
      OR LOWER(UTM_SOURCE) LIKE 'loyverse_pos_start%'
      OR LOWER(UTM_MEDIUM) IN ('web','back-office','terms_of_use','privacy_policy') THEN 'Own site'
    WHEN LOWER(UTM_MEDIUM) = 'organic' OR LOWER(UTM_MEDIUM) = 'referral' THEN 'Organic / referral'
    WHEN LOWER(UTM_SOURCE) = 'email' OR LOWER(UTM_MEDIUM) LIKE '%email%' OR LOWER(UTM_MEDIUM) = 'welcome' THEN 'Email'
    WHEN REFERRER_URL IS NULL THEN 'No referrer captured'
    ELSE 'Other tagged'
  END`;

// ── Queries ──────────────────────────────────────────────────────────────────
// Spend per campaign per day. GOOGLE_ADS.CAMPAIGN is a metrics REPORT whose grain is
// campaign × date × hour × network, so it must be aggregated, never joined on id alone —
// joining it raw fans out ~855x. Attributes come from CAMPAIGN_CURRENT, which is one row
// per campaign; its own METRICS.* columns are a single hour and must never be used.
// Money is in micros throughout the Google Ads API.
const SQL_SPEND_DAILY = `
SELECT c."CAMPAIGN.ID"                          AS campaign_id,
       c."CAMPAIGN.NAME"                        AS campaign,
       c."CAMPAIGN.STATUS"                      AS status,
       c."CAMPAIGN.ADVERTISING_CHANNEL_TYPE"    AS channel,
       k."SEGMENTS.DATE"::DATE                  AS d,
       SUM(k."METRICS.COST_MICROS") / 1e6       AS cost,
       SUM(k."METRICS.CLICKS")                  AS clicks,
       SUM(k."METRICS.IMPRESSIONS")             AS impressions,
       SUM(k."METRICS.CONVERSIONS")             AS conversions
FROM ${G}.CAMPAIGN k
JOIN ${G}.CAMPAIGN_CURRENT c ON c."CAMPAIGN.ID" = k."CAMPAIGN.ID"
GROUP BY 1,2,3,4,5
ORDER BY 5, 2`;

// Merchants acquired per campaign per signup day, carrying what each cohort went on to do.
//
// The outcome flags are LIFETIME states of merchants acquired on that date — a cohort read,
// not an event on that date. That is the only honest way to date them: a merchant acquired
// on 20 Aug who passed KYC in September belongs to the 20 Aug spend, because that is the
// spend that bought them.
//
// The receipts prune (MERCHANT_ID IN attributed) is load-bearing: LOYVERSE_RECEIPTS is
// ~9.6B rows and a scan without it will not finish.
const SQL_MERCHANTS_DAILY = `
WITH attr AS (
    SELECT LOYVERSE_ID, RESOLVED_CAMPAIGN_ID AS campaign_id, CREATED_AT::DATE AS d
    FROM ${P}.LOYVERSE_MERCHANT_ATTRIBUTION
    WHERE ${PAID_WHERE}
),
receipts AS (
    SELECT MERCHANT_ID, COUNT(*) AS n
    FROM ${P}.LOYVERSE_RECEIPTS
    WHERE MERCHANT_ID IN (SELECT LOYVERSE_ID FROM attr)
    GROUP BY 1
),
owners AS (
    SELECT ACCOUNT_ID,
           TRY_TO_NUMBER(MAX(CASE WHEN LOWER(KEY) = 'owner_id' THEN VALUE END)) AS oid
    FROM ${STRIPE}.CONNECTED_ACCOUNTS_METADATA
    GROUP BY 1
),
pay AS (
    SELECT o.oid,
           COUNT(*)                          AS accounts,
           COUNT_IF(ca.CHARGES_ENABLED)      AS enabled
    FROM owners o
    JOIN ${STRIPE}.CONNECTED_ACCOUNTS ca ON ca.ID = o.ACCOUNT_ID
    WHERE o.oid IS NOT NULL
    GROUP BY 1
)
SELECT a.campaign_id, a.d,
       COUNT(*)                                          AS merchants,
       COUNT_IF(COALESCE(r.n, 0) > 0)                    AS ever_sold,
       SUM(COALESCE(r.n, 0))                             AS receipts,
       COUNT_IF(COALESCE(p.accounts, 0) > 0)             AS opened_payments,
       COUNT_IF(COALESCE(p.enabled, 0) > 0)              AS passed_kyc
FROM attr a
LEFT JOIN receipts r ON r.MERCHANT_ID = a.LOYVERSE_ID
LEFT JOIN pay      p ON p.oid         = a.LOYVERSE_ID
GROUP BY 1,2
ORDER BY 2,1`;

// Keyword economics. KEYWORD_VIEW is Search-only — App campaigns have no keywords — so it
// covers ~60% of account spend. That is exactly the right table for cost per merchant at
// keyword level, and exactly the wrong one for an account total.
const SQL_KEYWORDS = `
WITH spend AS (
    SELECT "CAMPAIGN.ID"                           AS campaign_id,
           "AD_GROUP_CRITERION.KEYWORD.TEXT"       AS keyword,
           "AD_GROUP_CRITERION.KEYWORD.MATCH_TYPE" AS match_type,
           SUM("METRICS.COST_MICROS") / 1e6        AS cost,
           SUM("METRICS.CLICKS")                   AS clicks,
           SUM("METRICS.IMPRESSIONS")              AS impressions
    FROM ${G}.KEYWORD_VIEW
    GROUP BY 1,2,3
),
attr AS (
    SELECT LOYVERSE_ID, RESOLVED_CAMPAIGN_ID AS campaign_id,
           KEYWORD AS keyword, KEYWORD_MATCH_TYPE AS match_type
    FROM ${P}.LOYVERSE_MERCHANT_ATTRIBUTION
    WHERE KEYWORD IS NOT NULL AND RESOLVED_CAMPAIGN_ID IS NOT NULL
),
receipts AS (
    SELECT MERCHANT_ID, COUNT(*) AS n
    FROM ${P}.LOYVERSE_RECEIPTS
    WHERE MERCHANT_ID IN (SELECT LOYVERSE_ID FROM attr)
    GROUP BY 1
),
m AS (
    SELECT a.campaign_id, a.keyword, a.match_type,
           COUNT(*) AS merchants,
           COUNT_IF(COALESCE(r.n, 0) > 0) AS ever_sold
    FROM attr a LEFT JOIN receipts r ON r.MERCHANT_ID = a.LOYVERSE_ID
    GROUP BY 1,2,3
)
SELECT c."CAMPAIGN.NAME" AS campaign, s.campaign_id, s.keyword, s.match_type,
       s.clicks, s.impressions, s.cost,
       COALESCE(m.merchants, 0) AS merchants,
       COALESCE(m.ever_sold, 0) AS ever_sold
FROM spend s
JOIN ${G}.CAMPAIGN_CURRENT c ON c."CAMPAIGN.ID" = s.campaign_id
LEFT JOIN m ON m.campaign_id = s.campaign_id AND m.keyword = s.keyword AND m.match_type = s.match_type
WHERE s.cost > 0
ORDER BY s.cost DESC`;

// Channel mix across every attributed merchant, not just the paid ones. Same outcome
// columns as the campaign funnel so the two can be read against each other.
const SQL_CHANNELS = `
WITH base AS (
    SELECT LOYVERSE_ID, ${CHANNEL_CASE} AS channel, CREATED_AT::DATE AS d
    FROM ${P}.LOYVERSE_MERCHANT_ATTRIBUTION
    WHERE REFERRER_URL IS NOT NULL
),
receipts AS (
    SELECT MERCHANT_ID, COUNT(*) AS n
    FROM ${P}.LOYVERSE_RECEIPTS
    WHERE MERCHANT_ID IN (SELECT LOYVERSE_ID FROM base)
    GROUP BY 1
),
owners AS (
    SELECT ACCOUNT_ID,
           TRY_TO_NUMBER(MAX(CASE WHEN LOWER(KEY) = 'owner_id' THEN VALUE END)) AS oid
    FROM ${STRIPE}.CONNECTED_ACCOUNTS_METADATA
    GROUP BY 1
),
pay AS (
    SELECT o.oid, COUNT(*) AS accounts, COUNT_IF(ca.CHARGES_ENABLED) AS enabled
    FROM owners o JOIN ${STRIPE}.CONNECTED_ACCOUNTS ca ON ca.ID = o.ACCOUNT_ID
    WHERE o.oid IS NOT NULL GROUP BY 1
)
SELECT b.channel,
       COUNT(*)                               AS merchants,
       COUNT_IF(COALESCE(r.n, 0) > 0)         AS ever_sold,
       COUNT_IF(COALESCE(p.accounts, 0) > 0)  AS opened_payments,
       COUNT_IF(COALESCE(p.enabled, 0) > 0)   AS passed_kyc,
       MIN(b.d)                               AS first_seen,
       MAX(b.d)                               AS last_seen
FROM base b
LEFT JOIN receipts r ON r.MERCHANT_ID = b.LOYVERSE_ID
LEFT JOIN pay      p ON p.oid         = b.LOYVERSE_ID
GROUP BY 1
ORDER BY 2 DESC`;

// The honesty numbers. Shown on the page so nobody reads a share as complete.
const SQL_COVERAGE = `
SELECT COUNT(*)                                                                AS all_merchants,
       COUNT_IF(REFERRER_URL IS NOT NULL)                                      AS with_referrer,
       COUNT_IF(REFERRER_URL IS NOT NULL
                AND REFERRER_URL <> 'utm_source=google-play&utm_medium=organic') AS non_default,
       MIN(CASE WHEN REFERRER_URL IS NOT NULL THEN CREATED_AT::DATE END)        AS first_day,
       MAX(CASE WHEN REFERRER_URL IS NOT NULL THEN CREATED_AT::DATE END)        AS last_day
FROM ${P}.LOYVERSE_MERCHANT_ATTRIBUTION`;

async function main() {
  const conn = createConnection();
  await new Promise((res, rej) => conn.connect(e => e ? rej(new Error(e.message)) : res()));
  console.log('✓ Connected to Snowflake');

  const [spendRows, merchRows, kwRows, chRows, covRows] = await Promise.all([
    q(conn, SQL_SPEND_DAILY),
    q(conn, SQL_MERCHANTS_DAILY),
    q(conn, SQL_KEYWORDS),
    q(conn, SQL_CHANNELS),
    q(conn, SQL_COVERAGE),
  ]);
  console.log(`  spend rows ${spendRows.length} · merchant-days ${merchRows.length} · keywords ${kwRows.length} · channels ${chRows.length}`);

  const get = (r, k) => (r[k.toUpperCase()] !== undefined ? r[k.toUpperCase()] : r[k]);
  // Snowflake hands DATE columns back as JS Date objects, whose default toString is
  // "Wed Aug 05 2026 ..." — slicing that gives a weekday, not a date. Format from the UTC
  // parts rather than toISOString() so a Date built at local midnight cannot slip a day.
  const day = v => {
    if (v == null) return null;
    if (v instanceof Date) {
      return v.getUTCFullYear() + '-' + String(v.getUTCMonth() + 1).padStart(2, '0')
             + '-' + String(v.getUTCDate()).padStart(2, '0');
    }
    return String(v).slice(0, 10);
  };

  // Campaign attributes, one row each, from CAMPAIGN_CURRENT via the spend query.
  const campMeta = {};
  for (const r of spendRows) {
    const id = String(get(r, 'campaign_id'));
    if (!campMeta[id]) campMeta[id] = { campaignId: id, campaign: get(r, 'campaign'),
                                        status: get(r, 'status'), channel: get(r, 'channel') };
  }

  // Daily spend, and daily merchant cohorts, both keyed campaign × date so the page can
  // total either one over whatever range the filters are set to.
  const spendDaily = spendRows.map(r => ({
    d: day(get(r, 'd')), campaignId: String(get(r, 'campaign_id')),
    cost: round2(get(r, 'cost')), clicks: num(get(r, 'clicks')),
    impressions: num(get(r, 'impressions')), conversions: round2(get(r, 'conversions')),
  })).filter(r => r.d);

  const merchDaily = merchRows.map(r => ({
    d: day(get(r, 'd')), campaignId: String(get(r, 'campaign_id')),
    merchants: num(get(r, 'merchants')), everSold: num(get(r, 'ever_sold')),
    receipts: num(get(r, 'receipts')), openedPayments: num(get(r, 'opened_payments')),
    passedKyc: num(get(r, 'passed_kyc')),
  })).filter(r => r.d);

  const keywords = kwRows.map(r => ({
    campaignId: String(get(r, 'campaign_id')), campaign: get(r, 'campaign'),
    keyword: get(r, 'keyword'), matchType: get(r, 'match_type'),
    clicks: num(get(r, 'clicks')), impressions: num(get(r, 'impressions')),
    cost: round2(get(r, 'cost')), merchants: num(get(r, 'merchants')),
    everSold: num(get(r, 'ever_sold')),
  }));

  const channels = chRows.map(r => ({
    channel: get(r, 'channel'), merchants: num(get(r, 'merchants')),
    everSold: num(get(r, 'ever_sold')), openedPayments: num(get(r, 'opened_payments')),
    passedKyc: num(get(r, 'passed_kyc')),
    firstSeen: day(get(r, 'first_seen')), lastSeen: day(get(r, 'last_seen')),
  }));

  const c = covRows[0] || {};
  const coverage = {
    allMerchants: num(get(c, 'all_merchants')),
    withReferrer: num(get(c, 'with_referrer')),
    nonDefault: num(get(c, 'non_default')),
    firstDay: day(get(c, 'first_day')),
    lastDay: day(get(c, 'last_day')),
  };

  const days = [...spendDaily.map(r => r.d), ...merchDaily.map(r => r.d)].sort();
  const out = {
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: 'Snowflake — PUBLIC.LOYVERSE_MERCHANT_ATTRIBUTION + GOOGLE_ADS',
    currency: 'USD',
    dateMin: days[0] || null,
    dateMax: days[days.length - 1] || null,
    coverage, campaigns: Object.values(campMeta), spendDaily, merchDaily, keywords, channels,
  };

  const banner =
`// Merchant attribution for the Marketing dashboard — generated by kpi-automation/pull_attribution.js.
// Do NOT edit by hand; regenerated on every pull.
//
// window.ATTR_DATA = {
//   coverage    : {allMerchants, withReferrer, nonDefault, firstDay, lastDay} — the honesty
//                 numbers. withReferrer/allMerchants is ~7%: attribution was backfilled from
//                 Kafka, retention 60 days. A NULL referrer means UNKNOWN, never "organic".
//   campaigns[] : {campaignId, campaign, status, channel} — attributes only, from CAMPAIGN_CURRENT.
//   spendDaily[]: {d, campaignId, cost, clicks, impressions, conversions} — from GOOGLE_ADS.CAMPAIGN,
//                 aggregated off its campaign x date x hour x network grain. \`conversions\` is
//                 GOOGLE's count, kept only so the two definitions can be compared.
//   merchDaily[]: {d, campaignId, merchants, everSold, receipts, openedPayments, passedKyc} —
//                 merchants acquired that day, with LIFETIME outcomes. A cohort read: a merchant
//                 acquired on the 20th who passed KYC in September counts against the 20th, because
//                 that is the spend that bought them.
//   keywords[]  : {campaignId, campaign, keyword, matchType, clicks, impressions, cost, merchants,
//                 everSold} — Search only. KEYWORD_VIEW covers ~60% of account spend; App campaigns
//                 have no keywords. Right for keyword CPA, wrong for an account total.
//   channels[]  : {channel, merchants, everSold, openedPayments, passedKyc, firstSeen, lastSeen} —
//                 every attributed merchant, not just paid. "Play Store default" is broken out
//                 because it is 90.7% of referrers and means only "untagged Android install".
// }
//
// Spend here is GOOGLE_ADS, which restates for a few days; ads-data.js is the sheet export and
// runs ~1.4% lower on the same window. Same data, different read times.
`;
  fs.writeFileSync(OUT_FILE, banner + 'window.ATTR_DATA = ' + JSON.stringify(out) + ';\n', 'utf8');

  const tot = merchDaily.reduce((a, r) => ({
    m: a.m + r.merchants, s: a.s + r.everSold, p: a.p + r.openedPayments, k: a.k + r.passedKyc }),
    { m: 0, s: 0, p: 0, k: 0 });
  const spend = spendDaily.reduce((a, r) => a + (r.cost || 0), 0);
  console.log(`✓ Wrote ${OUT_FILE}`);
  console.log(`  spend $${spend.toFixed(2)} · merchants ${tot.m} · sold ${tot.s} · opened payments ${tot.p} · passed KYC ${tot.k}`);
  console.log(`  cost per merchant $${(spend / (tot.m || 1)).toFixed(2)} · per KYC $${tot.k ? (spend / tot.k).toFixed(2) : '—'}`);
  console.log(`  attribution coverage ${coverage.withReferrer} / ${coverage.allMerchants} merchants (${(coverage.withReferrer / coverage.allMerchants * 100).toFixed(1)}%), ${coverage.firstDay} → ${coverage.lastDay}`);
  conn.destroy(() => console.log('✓ Connection closed'));
}

main().catch(err => { console.error(`✗ ${err.message}`); console.error(err.stack); process.exit(1); });
