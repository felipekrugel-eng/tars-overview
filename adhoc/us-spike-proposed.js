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


// PROPOSED S8 — an "explosive cluster" rule that does not depend on guessing brand names.
// A normalized US business name qualifies when the attack-era cohort is both large (>= 20)
// and dwarfs any pre-attack presence (>= 10x). That keeps S7's protection for genuinely
// long-standing duplicate names while removing the loophole where a handful of early
// accounts exempt a whole wave.
const S8_HAVING = `
    HAVING COUNT_IF(CREATED_AT >= '2026-03-01') >= 20
       AND COUNT_IF(CREATED_AT >= '2026-03-01') >= 10 * COUNT_IF(CREATED_AT < '2026-03-01')`;

// Every name S8 would newly flag, so false positives can be eyeballed before deploying.
const sqlCandidates = `
SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)),'01345@','oieasa') AS NORM_NAME,
       COUNT_IF(CREATED_AT >= '2026-03-01') AS N_ATTACK_ERA,
       COUNT_IF(CREATED_AT <  '2026-03-01') AS N_PRE_ATTACK,
       MIN(CREATED_AT)::DATE AS FIRST_SEEN,
       MAX(CREATED_AT)::DATE AS LAST_SEEN
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
WHERE UPPER(TRIM(COUNTRY))='US' AND BUSINESS_NAME IS NOT NULL
  AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
GROUP BY 1 ${S8_HAVING}
ORDER BY N_ATTACK_ERA DESC;`;

// Names that sit just under the bar, to sanity-check the threshold is not cutting through
// the middle of a real cluster.
const sqlNearMiss = `
SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)),'01345@','oieasa') AS NORM_NAME,
       COUNT_IF(CREATED_AT >= '2026-03-01') AS N_ATTACK_ERA,
       COUNT_IF(CREATED_AT <  '2026-03-01') AS N_PRE_ATTACK
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
WHERE UPPER(TRIM(COUNTRY))='US' AND BUSINESS_NAME IS NOT NULL
  AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
GROUP BY 1
HAVING COUNT_IF(CREATED_AT >= '2026-03-01') >= 10
   AND NOT (COUNT_IF(CREATED_AT >= '2026-03-01') >= 20
            AND COUNT_IF(CREATED_AT >= '2026-03-01') >= 10 * COUNT_IF(CREATED_AT < '2026-03-01'))
ORDER BY N_ATTACK_ERA DESC LIMIT 20;`;

// Restatement impact: US registrations per July day, as published now vs with S1 anchored + S8.
const sqlImpact = `
WITH ${BOT_CTE},
extra AS (
    SELECT m.LOYVERSE_ID
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    JOIN ( SELECT TRANSLATE(LOWER(TRIM(BUSINESS_NAME)),'01345@','oieasa') AS NORM_NAME
           FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
           WHERE UPPER(TRIM(COUNTRY))='US' AND BUSINESS_NAME IS NOT NULL
             AND LENGTH(TRIM(BUSINESS_NAME)) >= 4
           GROUP BY 1 ${S8_HAVING} ) c8
      ON TRANSLATE(LOWER(TRIM(m.BUSINESS_NAME)),'01345@','oieasa') = c8.NORM_NAME
    WHERE UPPER(TRIM(m.COUNTRY))='US' AND m.LOYVERSE_ID IS NOT NULL AND m.CREATED_AT >= '2026-03-01'
    UNION
    SELECT LOYVERSE_ID FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE UPPER(TRIM(COUNTRY))='US' AND BUSINESS_NAME IS NOT NULL AND LOYVERSE_ID IS NOT NULL
      AND REGEXP_LIKE(TRIM(BUSINESS_NAME),
          '.*(order|sale|invoice|receipt|payment|txn|transaction|cart|checkout)[[:space:]_#:.\\-]+[0-9a-fx]{6,}.*','i')
),
us AS (
    SELECT LOWER(TRIM(EMAIL)) AS EMAIL_KEY, MIN(CREATED_AT::DATE) AS REG_DATE,
           MAX(IFF(LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM us_bot_accounts),1,0)) AS OLD_BOT,
           MAX(IFF(LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM us_bot_accounts)
                OR LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM extra),1,0)) AS NEW_BOT
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
    WHERE UPPER(TRIM(COUNTRY))='US' AND EMAIL IS NOT NULL AND CREATED_AT IS NOT NULL
    GROUP BY 1
)
SELECT REG_DATE,
       COUNT(*) - SUM(OLD_BOT) AS PUBLISHED_NOW,
       COUNT(*) - SUM(NEW_BOT) AS AFTER_FIX
FROM us WHERE REG_DATE BETWEEN '2026-07-01' AND '2026-07-31'
GROUP BY REG_DATE ORDER BY REG_DATE;`;

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
    table('P1. Names S8 would newly flag', await q(sqlCandidates));
    table('P2. Near misses (>=10 attack-era, not flagged)', await q(sqlNearMiss));
    table('P3. US July registrations: published now vs after fix', await q(sqlImpact));
  } catch (e) { console.error('QUERY FAILED:', e.message); process.exit(1); }
  finally { conn.destroy(() => {}); }
});
