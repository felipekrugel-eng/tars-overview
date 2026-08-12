// AD-HOC (2026-08-12): where is the $5 -> $9 sales-history price rise in the billing data?
//
// WHY THIS EXISTS
// The pilot tracker was extended to read revenue from invoice amounts. Its built-in
// sanity check — average unit price on monthly SKUs, each side of the 16 Jul change —
// came back going the WRONG WAY in the pilot markets:
//
//     pilot   baseline $6.39  ->  since 30 Jul $5.70
//     control baseline $6.18  ->  since 30 Jul $5.91
//
// Product says the increase shipped on 16 Jul to AU/BE/CO/ID/IN/NG/SG. The invoices
// do not show it. One of these is wrong, and this query decides which. Candidates:
//
//   A. CURRENCY MIX. The tracker averaged amounts across currencies without
//      normalising. If pilot markets bill in AUD/EUR/SGD/INR/IDR/COP/NGN then the
//      average is meaningless, and a shift in the currency mix alone moves it.
//      Zero-decimal currencies (IDR, COP, KRW) make it worse: dividing by 100
//      is correct for USD/EUR and wrong for those.
//   B. NEW PLAN VARIANT. Chargebee price changes usually ship as a new item price
//      (..._V002). If $9 is a new SKU and only new subscriptions land on it, the
//      pooled average is diluted by everyone still on the old one. Splitting by
//      PLAN_ID makes this obvious.
//   C. TERM MIX. Annual SKUs (_12_*) bill ~12x a monthly line. The tracker's
//      revenue total mixed them; a change in monthly/annual mix moves revenue per
//      adopter with no price change at all.
//   D. DISCOUNTS / PRORATION. `amount` is post-discount and prorated mid-cycle
//      lines are partial, so a $9 plan can invoice for less than $9.
//   E. It genuinely has not shipped to billing.
//
// Read-only, single connection, four small aggregations over the Chargebee invoice
// tables (~1.5M line items total). DATA_VIEWER is sufficient.
//
// Run: Actions -> "ADHOC: Snowflake query" -> Run workflow -> script = pilot-price-probe.js
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
const q = (sql) => new Promise((res, rej) =>
  conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));

// Shared preamble: sales-history invoice lines with country, cohort and RAW amount.
// Deliberately keeps `amount` un-divided — whether /100 is correct is one of the
// things under test, so the raw integer is reported alongside.
const BASE = `
WITH pilot_countries AS (
    SELECT column1 AS COUNTRY FROM VALUES ('AU'),('BE'),('CO'),('ID'),('IN'),('NG'),('SG')
),
merchants_raw AS (
    SELECT LOWER(TRIM(m.EMAIL)) AS EMAIL_KEY, UPPER(TRIM(m.COUNTRY)) AS COUNTRY, m.CREATED_AT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
      AND m.COUNTRY IS NOT NULL AND m.COUNTRY <> ''
),
merchant_country AS (
    SELECT EMAIL_KEY, COUNTRY FROM (
      SELECT EMAIL_KEY, COUNTRY,
             ROW_NUMBER() OVER (PARTITION BY EMAIL_KEY ORDER BY CREATED_AT ASC) AS RN
      FROM merchants_raw)
    WHERE RN = 1
),
lines AS (
    SELECT LOWER(TRIM(c.EMAIL))          AS EMAIL_KEY,
           li.value:entity_id::STRING    AS PLAN_ID,
           TO_TIMESTAMP(i.PAID_AT)::DATE AS PAID_DATE,
           li.value:amount::NUMBER       AS RAW_AMOUNT,
           li.value:unit_amount::NUMBER  AS RAW_UNIT_AMOUNT,
           li.value:quantity::NUMBER     AS QTY,
           li.value:discount_amount::NUMBER AS RAW_DISCOUNT,
           UPPER(COALESCE(i.CURRENCY_CODE,'?'))::STRING AS CCY,
           'UK' AS SITE
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND i.VOIDED_AT IS NULL
      AND li.value:entity_type::STRING = 'plan'
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_id::STRING ILIKE 'S_SALESHISTORY%'
      AND c.EMAIL IS NOT NULL
    UNION ALL
    SELECT LOWER(TRIM(c.EMAIL)), li.value:entity_id::STRING,
           TO_TIMESTAMP(i.PAID_AT)::DATE, li.value:amount::NUMBER,
           li.value:unit_amount::NUMBER, li.value:quantity::NUMBER,
           li.value:discount_amount::NUMBER,
           UPPER(COALESCE(i.CURRENCY_CODE,'?'))::STRING, 'EU'
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND i.VOIDED_AT IS NULL
      AND li.value:entity_type::STRING = 'plan'
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_id::STRING ILIKE 'S_SALESHISTORY%'
      AND c.EMAIL IS NOT NULL
),
tagged AS (
    SELECT l.*, mc.COUNTRY,
           IFF(pc.COUNTRY IS NOT NULL,'PILOT','CONTROL') AS COHORT,
           IFF(l.PLAN_ID ILIKE 'S_SALESHISTORY_12%','ANNUAL','MONTHLY') AS TERM,
           IFF(l.PAID_DATE >= DATE '2026-07-16','POST','PRE') AS SIDE
    FROM lines l
    JOIN merchant_country mc ON mc.EMAIL_KEY = l.EMAIL_KEY
    LEFT JOIN pilot_countries pc ON pc.COUNTRY = mc.COUNTRY
    WHERE l.PAID_DATE >= DATE '2026-05-01'
)`;

// A + B: the decisive one. Every distinct sales-history plan id in the pilot markets,
// split before/after 16 Jul, with the currency it billed in. If $9 shipped as a new
// item price this table names it; if the mix is multi-currency this table shows that too.
const Q_PLAN = `${BASE}
SELECT PLAN_ID, CCY, TERM, SIDE,
       COUNT(*)                                   AS LINES,
       COUNT(DISTINCT EMAIL_KEY)                  AS MERCHANTS,
       MIN(RAW_AMOUNT)                            AS MIN_RAW,
       MEDIAN(RAW_AMOUNT)                         AS MED_RAW,
       MAX(RAW_AMOUNT)                            AS MAX_RAW,
       MEDIAN(RAW_UNIT_AMOUNT)                    AS MED_UNIT_RAW,
       SUM(COALESCE(RAW_DISCOUNT,0))              AS DISCOUNT_RAW
FROM tagged
WHERE COHORT = 'PILOT'
GROUP BY PLAN_ID, CCY, TERM, SIDE
ORDER BY TERM, PLAN_ID, CCY, SIDE`;

// C: monthly USD only, by month. Strips currency and term as explanations — if the
// price rose, THIS is where a clean $5 -> $9 step must appear.
const Q_MONTH = `${BASE}
SELECT COHORT,
       DATE_TRUNC('month', PAID_DATE)::DATE       AS MONTH,
       COUNT(*)                                   AS LINES,
       MIN(RAW_AMOUNT)                            AS MIN_RAW,
       MEDIAN(RAW_AMOUNT)                         AS MED_RAW,
       MAX(RAW_AMOUNT)                            AS MAX_RAW,
       MODE(RAW_AMOUNT)                           AS MODAL_RAW
FROM tagged
WHERE TERM = 'MONTHLY' AND CCY = 'USD'
GROUP BY COHORT, MONTH
ORDER BY COHORT, MONTH`;

// D: the distribution of distinct monthly USD amounts in the pilot markets since the
// change. A price rise shows up as a new modal value, not as a moved average — an
// average can drift for a dozen uninteresting reasons.
const Q_DIST = `${BASE}
SELECT SIDE, RAW_AMOUNT, COUNT(*) AS LINES, COUNT(DISTINCT EMAIL_KEY) AS MERCHANTS
FROM tagged
WHERE COHORT = 'PILOT' AND TERM = 'MONTHLY' AND CCY = 'USD'
GROUP BY SIDE, RAW_AMOUNT
ORDER BY SIDE, LINES DESC`;

// E: per-market, monthly only, any currency — which of the seven actually repriced.
const Q_COUNTRY = `${BASE}
SELECT COUNTRY, CCY, SIDE,
       COUNT(*) AS LINES, MEDIAN(RAW_AMOUNT) AS MED_RAW, MODE(RAW_AMOUNT) AS MODAL_RAW
FROM tagged
WHERE COHORT = 'PILOT' AND TERM = 'MONTHLY'
GROUP BY COUNTRY, CCY, SIDE
ORDER BY COUNTRY, CCY, SIDE`;

const show = (title, rows) => {
  console.log('\n=== ' + title + ' (' + rows.length + ' rows) ===');
  if (!rows.length) { console.log('(none)'); return; }
  const cols = Object.keys(rows[0]);
  console.log(cols.join(' | '));
  rows.forEach(r => console.log(cols.map(c => String(r[c])).join(' | ')));
};

(async () => {
  await new Promise((res, rej) => conn.connect((e) => e ? rej(e) : res()));
  console.log('RESULT_START');
  console.log('Probe: does the $5 -> $9 sales-history price rise appear in Chargebee invoices?');
  console.log('Window: paid 2026-05-01 onward. PRE/POST split at 2026-07-16 (launch date).');
  console.log('RAW_AMOUNT is the un-divided Chargebee integer — usually minor units, but that');
  console.log('is one of the things being tested, so no division is applied anywhere here.');

  show('A/B — pilot: every plan id x currency x term, before and after 16 Jul', await q(Q_PLAN));
  show('C — monthly USD only, by month and cohort (a clean price step should show here)', await q(Q_MONTH));
  show('D — pilot monthly USD: distribution of distinct amounts (look for a new mode)', await q(Q_DIST));
  show('E — per pilot market, monthly, any currency (which markets actually repriced)', await q(Q_COUNTRY));

  console.log('\nRESULT_END');
  conn.destroy(() => process.exit(0));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
