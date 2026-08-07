// AD-HOC (2026-08-07): why are 2026-07-02, 07-27 and 07-30 still spiking for US
// registrations after the 2026-07-21 bot filter?
//
// The per-country daily history shows US newReg of 445 / 232 / 271 on those days against a
// July median of 65, while every other country sits at ~1x. The filter IS applied to
// country_month_registrations_daily_asof.sql, so whatever created those accounts is getting
// through the existing signatures.
//
// This prints, per day: total US registrations (deduped by email the same way the KPI SQL
// does), how many the CURRENT filter catches, and what is left over — plus the most common
// leftover business names and email domains, which is what a new signature has to key on.
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

// Verbatim copy of the filter block from kpi-automation/sql/*.sql. Kept identical on purpose —
// the point is to measure what the DEPLOYED rule catches, not an improved variant.
const BOT_CTE = `
us_bot_accounts AS (
    SELECT LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE UPPER(TRIM(COUNTRY)) = 'US'
      AND LOYVERSE_ID IS NOT NULL
      AND BUSINESS_NAME IS NOT NULL
      AND (
           REGEXP_LIKE(TRIM(BUSINESS_NAME),
               '(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\\\-]+[0-9a-fx]{6,}.*', 'i')
        OR (    REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                    '.*(poshmark|posh|vinted|depop|etsy).*')
            AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                    '.*(sold|order|support|helper|security|verify|wallet|aml|compliance|team|info).*'))
        OR (    LOWER(TRIM(BUSINESS_NAME)) <> TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa')
            AND REGEXP_LIKE(TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa'),
                    '.*(poshmark|vinted|depop|etsy).*'))
        OR TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') LIKE '%seller kyc%'
        OR REGEXP_LIKE(TRIM(BUSINESS_NAME), '[A-Z][a-z]{2,}[A-Z][a-z]{2,}[0-9]{1,3}')
        OR REGEXP_LIKE(BUSINESS_NAME, '.*[\\u200B\\u200C\\u200D\\u2060\\uFEFF].*')
        OR REGEXP_LIKE(BUSINESS_NAME, '.*[\\u0400-\\u04FF].*')
      )
    UNION
    SELECT m.LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    JOIN (
        SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)), '01345@', 'oieasa') AS NORM_NAME
        FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
        WHERE UPPER(TRIM(COUNTRY)) = 'US'
          AND BUSINESS_NAME IS NOT NULL
          AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
          AND CREATED_AT >= '2026-03-01'
        GROUP BY 1
        HAVING COUNT(*) >= 3
    ) c
      ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
    WHERE UPPER(TRIM(m.COUNTRY)) = 'US'
      AND m.LOYVERSE_ID IS NOT NULL
      AND m.CREATED_AT >= '2026-03-01'
      AND NOT EXISTS (
          SELECT 1
          FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS p
          WHERE UPPER(TRIM(p.COUNTRY)) = 'US'
            AND p.BUSINESS_NAME IS NOT NULL
            AND p.CREATED_AT < '2026-03-01'
            AND TRANSLATE(LOWER(TRIM(p.BUSINESS_NAME)), '01345@', 'oieasa') = c.NORM_NAME
      )
)`;

// Suspect days plus two ordinary controls, so the leftover profile can be compared against
// what a normal US day looks like rather than judged in isolation.
const DAYS = "'2026-07-02','2026-07-27','2026-07-30','2026-07-15','2026-07-22'";


// HYPOTHESIS 1 — S1 is unanchored-left. Snowflake REGEXP_LIKE is a FULL-STRING match, and the
// S1 pattern starts with the keyword group but ends with '.*'. So it only matches names that
// BEGIN with order/sale/etc. "Activation - Sale#6860157d4ca0e902" starts with "Activation".
const sqlS1 = `
SELECT
  COUNT(*) AS US_SINCE_MAR,
  SUM(IFF(REGEXP_LIKE(TRIM(BUSINESS_NAME),
      '(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\-]+[0-9a-fx]{6,}.*','i'),1,0)) AS CURRENT_S1,
  SUM(IFF(REGEXP_LIKE(TRIM(BUSINESS_NAME),
      '.*(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\-]+[0-9a-fx]{6,}.*','i'),1,0)) AS ANCHORED_S1
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
WHERE UPPER(TRIM(COUNTRY))='US' AND BUSINESS_NAME IS NOT NULL AND CREATED_AT >= '2026-03-01';`;

// HYPOTHESIS 2 — S7's pre-attack exemption. One US "Poshmark" created before 2026-03-01 would
// exempt the entire 374-account cluster from the bulk-duplicate rule.
const sqlS7 = `
SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)),'01345@','oieasa') AS NORM,
       COUNT(*) AS N_TOTAL,
       SUM(IFF(CREATED_AT < '2026-03-01',1,0)) AS N_PRE_ATTACK,
       SUM(IFF(CREATED_AT >= '2026-03-01',1,0)) AS N_ATTACK_ERA,
       MIN(CREATED_AT)::DATE AS FIRST_SEEN
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
WHERE UPPER(TRIM(COUNTRY))='US' AND BUSINESS_NAME IS NOT NULL
  AND TRANSLATE(LOWER(TRIM(BUSINESS_NAME)),'01345@','oieasa')
      IN ('poshmark','vinted','depop','etsy','mercari')
GROUP BY 1 ORDER BY N_TOTAL DESC;`;

// What is actually left over on 30 July, which the 200-row cap hid last time.
const sql30 = `
WITH ${BOT_CTE}
SELECT TRIM(m.BUSINESS_NAME) AS BUSINESS_NAME, COUNT(*) AS N
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
WHERE UPPER(TRIM(m.COUNTRY))='US' AND m.CREATED_AT::DATE = '2026-07-30'
  AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)
GROUP BY 1 ORDER BY N DESC, BUSINESS_NAME LIMIT 25;`;

function table(title, rows) {
  console.log(`\n===== ${title} =====`);
  if (!rows || !rows.length) return console.log('(no rows)');
  const cols = Object.keys(rows[0]);
  console.log(cols.join(' | '));
  rows.forEach(r => console.log(cols.map(c => String(r[c])).join(' | ')));
}

conn.connect(async (err) => {
  if (err) { console.error('connect failed', err.message); process.exit(1); }
  try {
    table('H1. S1 left-anchoring: names caught now vs with a leading .*', await q(sqlS1));
    table('H2. S7 pre-attack exemption on marketplace names', await q(sqlS7));
    table('H3. Leftover names on 2026-07-30', await q(sql30));
  } catch (e) { console.error('QUERY FAILED:', e.message); process.exit(1); }
  finally { conn.destroy(() => {}); }
});
