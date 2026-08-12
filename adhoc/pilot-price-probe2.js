// AD-HOC (2026-08-12): what did the NEW sales-history adopters actually get charged?
//
// WHY probe 1 WAS NOT ENOUGH
// pilot-price-probe.js aggregated every sales-history invoice line in the pilot markets
// and reported medians and modes. Those came back at $5 and $7 either side of 16 Jul, and
// I read that as "the price rise is not in billing". That inference does not hold: a price
// rise applies to NEW subscriptions, and after 16 Jul the pilot markets billed ~1,324
// sales-history lines of which only ~35 are new adopters. Existing merchants renewing at
// their old price swamp the statistic 38:1. A median cannot see 2.6% of a population.
//
// So this probe restricts to each merchant's FIRST EVER sales-history line — the same
// definition the tracker uses for NEW_PAYER — and prints every distinct unit price with
// counts, rather than a summary statistic that can hide the thing being looked for.
//
// It also reports the SUBSCRIPTION side (part D). Invoices only show what has been billed;
// a merchant who subscribed at a new price and is still inside the 14-day trial, or whose
// first invoice lands after the last data date, is invisible to any invoice query. If a $9
// item price shipped, the subscription items are where it appears first.
//
// Read-only. DATA_VIEWER is sufficient.
// Run: Actions -> "ADHOC: Snowflake query" -> Run workflow -> script = pilot-price-probe2.js
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
sh_lines AS (
    SELECT LOWER(TRIM(c.EMAIL))             AS EMAIL_KEY,
           li.value:entity_id::STRING       AS PLAN_ID,
           TO_TIMESTAMP(i.PAID_AT)::DATE    AS PAID_DATE,
           li.value:amount::NUMBER          AS RAW_AMOUNT,
           li.value:unit_amount::NUMBER     AS RAW_UNIT,
           COALESCE(li.value:quantity::NUMBER,1) AS QTY,
           UPPER(COALESCE(i.CURRENCY_CODE,'?'))::STRING AS CCY
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
           li.value:unit_amount::NUMBER, COALESCE(li.value:quantity::NUMBER,1),
           UPPER(COALESCE(i.CURRENCY_CODE,'?'))::STRING
    FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
    JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
    CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
    WHERE i.DELETED = FALSE AND i.PAID_AT IS NOT NULL AND i.VOIDED_AT IS NULL
      AND li.value:entity_type::STRING = 'plan'
      AND li.value:amount::NUMBER > 0
      AND li.value:entity_id::STRING ILIKE 'S_SALESHISTORY%'
      AND c.EMAIL IS NOT NULL
),
first_sh AS (
    SELECT EMAIL_KEY, MIN(PAID_DATE) AS FIRST_DATE
    FROM sh_lines GROUP BY EMAIL_KEY
),
first_line AS (
    SELECT s.*, mc.COUNTRY,
           IFF(pc.COUNTRY IS NOT NULL,'PILOT','CONTROL') AS COHORT,
           IFF(s.PLAN_ID ILIKE 'S_SALESHISTORY_12%','ANNUAL','MONTHLY') AS TERM,
           CASE WHEN s.PAID_DATE >= DATE '2026-07-30' THEN '3_SIGNAL'
                WHEN s.PAID_DATE >= DATE '2026-07-16' THEN '2_LAUNCH_LAG'
                ELSE '1_BASELINE' END AS PERIOD
    FROM sh_lines s
    JOIN first_sh f ON f.EMAIL_KEY = s.EMAIL_KEY AND f.FIRST_DATE = s.PAID_DATE
    JOIN merchant_country mc ON mc.EMAIL_KEY = s.EMAIL_KEY
    LEFT JOIN pilot_countries pc ON pc.COUNTRY = mc.COUNTRY
    WHERE s.PAID_DATE >= DATE '2026-06-01'
)`;

// A — THE question. Every distinct unit price paid by a merchant on their FIRST EVER
// sales-history line, pilot markets, by period. No medians: raw counts per price, so a
// handful of $9 lines is visible instead of averaged away.
const Q_FIRST = `${BASE}
SELECT PERIOD, TERM, CCY, PLAN_ID, RAW_UNIT, QTY,
       COUNT(*) AS MERCHANTS, MIN(PAID_DATE) AS FIRST_SEEN, MAX(PAID_DATE) AS LAST_SEEN
FROM first_line
WHERE COHORT = 'PILOT'
GROUP BY PERIOD, TERM, CCY, PLAN_ID, RAW_UNIT, QTY
ORDER BY PERIOD, TERM, CCY, RAW_UNIT`;

// B — same, control markets. If a new price shows up in BOTH cohorts it is a global
// catalogue change, not this pilot; if only in pilot, it is the pilot.
const Q_FIRST_CTRL = `${BASE}
SELECT PERIOD, TERM, CCY, RAW_UNIT, COUNT(*) AS MERCHANTS
FROM first_line
WHERE COHORT = 'CONTROL'
GROUP BY PERIOD, TERM, CCY, RAW_UNIT
ORDER BY PERIOD, TERM, CCY, RAW_UNIT`;

// C — every distinct unit price ANYWHERE in the sales-history family since 1 Jun, both
// cohorts, all lines. Purely: does the integer 900 (or any new value) exist at all?
const Q_ALL_PRICES = `${BASE}
SELECT CCY, TERM, RAW_UNIT, COUNT(*) AS LINES, COUNT(DISTINCT EMAIL_KEY) AS MERCHANTS,
       MIN(PAID_DATE) AS FIRST_SEEN, MAX(PAID_DATE) AS LAST_SEEN
FROM (
  SELECT s.*, IFF(s.PLAN_ID ILIKE 'S_SALESHISTORY_12%','ANNUAL','MONTHLY') AS TERM
  FROM sh_lines s WHERE s.PAID_DATE >= DATE '2026-06-01'
)
GROUP BY CCY, TERM, RAW_UNIT
ORDER BY CCY, TERM, RAW_UNIT`;

// D — the SUBSCRIPTION side. Invoices lag: a merchant inside a 14-day trial, or whose
// first invoice falls after the last data date, has no invoice line yet. UK is Product
// Catalog 2.0 so item_price_id lives in SUBSCRIPTION_ITEMS. If a new price shipped, this
// is where it surfaces first. (EU populates neither array — Belgium is blind here.)
const Q_SUBS = `
SELECT 'UK' AS SITE,
       si.value:item_price_id::STRING  AS ITEM_PRICE_ID,
       si.value:unit_price::NUMBER     AS UNIT_PRICE,
       si.value:item_type::STRING      AS ITEM_TYPE,
       COUNT(*)                        AS SUBSCRIPTIONS,
       MIN(TO_TIMESTAMP(s.CREATED_AT)::DATE) AS FIRST_CREATED,
       MAX(TO_TIMESTAMP(s.CREATED_AT)::DATE) AS LAST_CREATED
FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-SUBSCRIPTION" s
CROSS JOIN LATERAL FLATTEN(input => s.SUBSCRIPTION_ITEMS) si
WHERE s.DELETED = FALSE
  AND si.value:item_price_id::STRING ILIKE '%SALESHISTORY%'
GROUP BY 1,2,3,4
ORDER BY UNIT_PRICE, ITEM_PRICE_ID`;

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
  console.log('CORRECTION TO PROBE 1: that probe pooled all sales-history lines, so 35 new');
  console.log('adopters sat inside ~1,324 renewals and any new price was averaged away.');
  console.log('This probe looks only at FIRST-EVER sales-history purchases, and lists raw');
  console.log('unit prices with counts instead of medians. RAW_UNIT is minor units: 500 = $5.');
  console.log('A $9 monthly price would appear as RAW_UNIT = 900.');

  show('A — PILOT: unit price on each merchant\'s FIRST sales-history line, by period', await q(Q_FIRST));
  show('B — CONTROL: same, to tell a pilot change from a global catalogue change', await q(Q_FIRST_CTRL));
  show('C — every distinct unit price in the family since 1 Jun (does 900 exist at all?)', await q(Q_ALL_PRICES));
  show('D — SUBSCRIPTIONS (UK site): item prices in use, incl. not-yet-invoiced trials', await q(Q_SUBS));

  console.log('\nRESULT_END');
  conn.destroy(() => process.exit(0));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
