// AD-HOC (2026-08-07): US cohort economics, for the expected LTV of the July 2026 US cohort.
//
// The July cohort is ~5 weeks old, so its conversion is nowhere near complete — the dashboard's
// global cohort table shows Jul at 0.26% ever-paid against May at 1.26%, purely because May has
// had longer to convert. Any honest LTV therefore needs a MATURATION CURVE from older US cohorts,
// not just July's own to-date numbers.
//
// The bot filter block is read from the committed SQL at runtime rather than copy-pasted, so this
// can never silently drift from what the pipeline actually deploys.
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

// Pull the deployed us_bot_accounts CTE verbatim out of the pipeline SQL.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'kpi-automation', 'sql', 'cohort_country_snapshot.sql'), 'utf8');
const start = SRC.indexOf('us_bot_accounts AS (');
const endMark = '\n    ),\n';
const end = SRC.indexOf(endMark, start);
if (start < 0 || end < 0) { console.error('could not extract bot CTE'); process.exit(1); }
const BOT_CTE = SRC.slice(start, end + 6).replace(/,\s*$/, '');
console.log(`(bot filter CTE extracted: ${BOT_CTE.length} chars, S8 present: ${/S8/.test(BOT_CTE)})`);

// US merchants, deduped by email exactly as the KPI pipeline does, with cohort month and
// first/last paid month from Chargebee.
const BASE = `
WITH ${BOT_CTE},
us AS (
    SELECT LOWER(TRIM(m.EMAIL))                        AS EMAIL_KEY,
           MIN(DATE_TRUNC('MONTH', m.CREATED_AT)::DATE) AS COHORT_MONTH
    FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS m
    WHERE UPPER(TRIM(m.COUNTRY))='US' AND m.EMAIL IS NOT NULL AND m.CREATED_AT IS NOT NULL
      AND m.LOYVERSE_ID NOT IN (SELECT LOYVERSE_ID FROM us_bot_accounts)
    GROUP BY 1
),
subs AS (
    SELECT LOWER(TRIM(mm.EMAIL)) AS EMAIL_KEY,
           MIN(s.ACTIVATED_AT)   AS FIRST_PAID,
           MAX(IFF(s.CANCELLED_AT IS NULL, 1, 0)) AS STILL_ACTIVE
    FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V s
    JOIN LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS mm
      ON mm.LOYVERSE_ID = s.LOYVERSE_MERCHANT_ID
    WHERE s.ACTIVATED_AT IS NOT NULL AND mm.EMAIL IS NOT NULL
      AND UPPER(TRIM(mm.COUNTRY))='US'
    GROUP BY 1
)`;

// How US cohorts convert as they age: %ever-paid measured at a fixed number of months after
// registration, so cohorts of different ages are compared like for like.
const sqlCurve = `
${BASE},
j AS (
    SELECT u.COHORT_MONTH, u.EMAIL_KEY, s.FIRST_PAID,
           DATEDIFF('month', u.COHORT_MONTH, s.FIRST_PAID) AS MONTHS_TO_PAY,
           DATEDIFF('month', u.COHORT_MONTH, CURRENT_DATE()) AS COHORT_AGE
    FROM us u LEFT JOIN subs s ON s.EMAIL_KEY = u.EMAIL_KEY
)
SELECT COHORT_AGE AS AGE_MONTHS,
       COUNT(DISTINCT EMAIL_KEY) AS COHORT_SIZE,
       ROUND(100.0*COUNT(DISTINCT IFF(MONTHS_TO_PAY <= 0, EMAIL_KEY, NULL))/NULLIF(COUNT(DISTINCT EMAIL_KEY),0),3) AS PCT_BY_M0,
       ROUND(100.0*COUNT(DISTINCT IFF(MONTHS_TO_PAY <= 1, EMAIL_KEY, NULL))/NULLIF(COUNT(DISTINCT EMAIL_KEY),0),3) AS PCT_BY_M1,
       ROUND(100.0*COUNT(DISTINCT IFF(MONTHS_TO_PAY <= 3, EMAIL_KEY, NULL))/NULLIF(COUNT(DISTINCT EMAIL_KEY),0),3) AS PCT_BY_M3,
       ROUND(100.0*COUNT(DISTINCT IFF(MONTHS_TO_PAY <= 6, EMAIL_KEY, NULL))/NULLIF(COUNT(DISTINCT EMAIL_KEY),0),3) AS PCT_BY_M6,
       ROUND(100.0*COUNT(DISTINCT IFF(MONTHS_TO_PAY <= 12, EMAIL_KEY, NULL))/NULLIF(COUNT(DISTINCT EMAIL_KEY),0),3) AS PCT_BY_M12,
       ROUND(100.0*COUNT(DISTINCT IFF(MONTHS_TO_PAY IS NOT NULL, EMAIL_KEY, NULL))/NULLIF(COUNT(DISTINCT EMAIL_KEY),0),3) AS PCT_EVER
FROM j
WHERE COHORT_MONTH >= '2024-01-01'
GROUP BY COHORT_AGE HAVING COUNT(DISTINCT EMAIL_KEY) >= 200
ORDER BY AGE_MONTHS;`;

// The July 2026 US cohort as it stands today.
const sqlJuly = `
${BASE},
j AS (
    SELECT u.EMAIL_KEY, s.FIRST_PAID, s.STILL_ACTIVE
    FROM us u LEFT JOIN subs s ON s.EMAIL_KEY = u.EMAIL_KEY
    WHERE u.COHORT_MONTH = '2026-07-01'
)
SELECT COUNT(*) AS REGISTRATIONS,
       COUNT(FIRST_PAID) AS EVER_PAID,
       SUM(COALESCE(STILL_ACTIVE,0)) AS PAYING_NOW,
       ROUND(100.0*COUNT(FIRST_PAID)/NULLIF(COUNT(*),0),3) AS PCT_EVER_PAID
FROM j;`;

// US ARPC on the paying base, from the amortized Chargebee line items the pipeline uses.
const sqlArpc = `
SELECT TO_CHAR(DATE_TRUNC('MONTH', l.MONTH_START),'YYYY-MM') AS MTH,
       COUNT(DISTINCT l.LOYVERSE_MERCHANT_ID) AS PAYING,
       ROUND(SUM(l.MRR_USD),0) AS MRR_USD,
       ROUND(SUM(l.MRR_USD)/NULLIF(COUNT(DISTINCT l.LOYVERSE_MERCHANT_ID),0),2) AS ARPC_USD
FROM (
    SELECT s.LOYVERSE_MERCHANT_ID,
           DATE_TRUNC('MONTH', s.ACTIVATED_AT)::DATE AS MONTH_START,
           TRY_TO_NUMBER(s.MRR::string, 12, 2) AS MRR_USD
    FROM LOYVERSE_DATA_LAKE.PUBLIC.CHARGEBEE_SUBSCRIPTIONS_V s
    JOIN LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS mm ON mm.LOYVERSE_ID = s.LOYVERSE_MERCHANT_ID
    WHERE UPPER(TRIM(mm.COUNTRY))='US' AND s.ACTIVATED_AT IS NOT NULL
) l
WHERE l.MONTH_START >= '2025-08-01' AND l.MONTH_START < DATE_TRUNC('MONTH', CURRENT_DATE())
GROUP BY 1 ORDER BY 1;`;

// US paying survival: of merchants that ever started paying, how many are still active by
// months since first payment. This is the churn input to the LTV bridge.
const sqlSurvival = `
${BASE},
p AS (
    SELECT s.EMAIL_KEY, s.FIRST_PAID, s.STILL_ACTIVE,
           DATEDIFF('month', s.FIRST_PAID, CURRENT_DATE()) AS TENURE_M
    FROM subs s JOIN us u ON u.EMAIL_KEY = s.EMAIL_KEY
)
SELECT CASE WHEN TENURE_M < 6 THEN '0-5' WHEN TENURE_M < 12 THEN '6-11'
            WHEN TENURE_M < 24 THEN '12-23' WHEN TENURE_M < 36 THEN '24-35'
            ELSE '36+' END AS TENURE_BUCKET,
       COUNT(*) AS N, SUM(STILL_ACTIVE) AS STILL_PAYING,
       ROUND(100.0*SUM(STILL_ACTIVE)/NULLIF(COUNT(*),0),1) AS PCT_SURVIVING
FROM p GROUP BY 1 ORDER BY 1;`;

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
    table('L1. July 2026 US cohort, as it stands today', await q(sqlJuly));
    table('L2. US conversion maturation by cohort age', await q(sqlCurve));
    table('L3. US ARPC on the paying base', await q(sqlArpc));
    table('L4. US paying survival by tenure', await q(sqlSurvival));
  } catch (e) { console.error('QUERY FAILED:', e.message); process.exit(1); }
  finally { conn.destroy(() => {}); }
});
