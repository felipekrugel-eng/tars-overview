#!/usr/bin/env node
/**
 * v4_sweep.js — the false-positive sweep for bot-filter v4, as one query.
 *
 * Reads the live block out of bot-filter/cte_block.sql, so it can never drift from what
 * is about to be deployed. Reports the five numbers that decide whether v4 ships:
 *
 *   1. What each rule catches, and what the new rules add over v3.
 *   2. What the P0 guard RELEASES — the only change that can make the base worse.
 *   3. Recall against the known wave (8-digit numeric names, US, 24 Oct onward).
 *   4. Every account newly flagged that has a subscription or real trading history,
 *      listed in full, because those are the candidate false positives.
 *   5. Every account released by P0, listed in full.
 *
 * Read-only. Runs EXPLAIN-free SELECTs against Snowflake and writes nothing.
 *
 * Env: same as the other scripts — SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_KEY_PATH,
 *      SNOWFLAKE_ACCOUNT/USER/WAREHOUSE/ROLE/DATABASE/SCHEMA.
 * Usage: node bot-filter/v4_sweep.js
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const snowflake = require('snowflake-sdk');
snowflake.configure({ logLevel: 'ERROR' });

const REPO = path.join(__dirname, '..');
const CFG = {
  account:   process.env.SNOWFLAKE_ACCOUNT   || 'ORXEAZX-TC97659',
  username:  process.env.SNOWFLAKE_USER      || 'TARS_SERVICE_USER',
  warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
  role:      process.env.SNOWFLAKE_ROLE      || 'DATA_VIEWER',
  database:  process.env.SNOWFLAKE_DATABASE  || 'LOYVERSE_DATA_LAKE',
  schema:    process.env.SNOWFLAKE_SCHEMA    || 'PUBLIC',
};
function privateKey() {
  const pem = process.env.SNOWFLAKE_PRIVATE_KEY
    ? process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : fs.readFileSync(process.env.SNOWFLAKE_KEY_PATH, 'utf8');
  return crypto.createPrivateKey({ key: pem, format: 'pem' })
               .export({ type: 'pkcs8', format: 'pem' });
}
const conn = () => snowflake.createConnection(
  { ...CFG, authenticator: 'SNOWFLAKE_JWT', privateKey: privateKey() });
const connect = c => new Promise((res, rej) => c.connect((e, x) => e ? rej(e) : res(x)));
const q = (c, sqlText) => new Promise((res, rej) =>
  c.execute({ sqlText, complete: (e, s, r) => e ? rej(e) : res(r) }));

const BLOCK = fs.readFileSync(path.join(REPO, 'bot-filter', 'cte_block.sql'), 'utf8')
                .replace(/\s*$/, '').replace(/,\s*$/, '');
const DB = `${CFG.database}.${CFG.schema}`;

// Known wave: the signature this operator has used since 24 Oct. Used only to MEASURE
// recall, never to flag — an 8-digit name is not on its own evidence of anything.
const WAVE = `
  wave AS (
      SELECT LOYVERSE_ID FROM ${DB}.LOYVERSE_MERCHANTS
      WHERE UPPER(TRIM(COUNTRY)) = 'US'
        AND CREATED_AT >= '2026-10-24'
        AND REGEXP_LIKE(TRIM(BUSINESS_NAME), '[0-9]{8}')
  )`;

// Everything the rules flag, before the guard, with which rule did it.
const ALLRULES = `
  all_rules AS (
      SELECT LOYVERSE_ID, 'name'      AS RULE FROM us_bot_accounts
      UNION ALL SELECT LOYVERSE_ID, 'name'      FROM global_bot_accounts
      UNION ALL SELECT LOYVERSE_ID, 'shape'     FROM shape_bot_accounts
      UNION ALL SELECT LOYVERSE_ID, 'velocity'  FROM velocity_bot_accounts
      UNION ALL SELECT LOYVERSE_ID, 'ticket'    FROM ticket_bot_accounts
  ),
  rolled AS (
      SELECT LOYVERSE_ID,
             MAX(IFF(RULE IN ('name','shape'), 1, 0))         AS BY_V3,
             MAX(IFF(RULE IN ('velocity','ticket'), 1, 0))    AS BY_V4,
             LISTAGG(DISTINCT RULE, '+') WITHIN GROUP (ORDER BY RULE) AS RULES
      FROM all_rules GROUP BY 1
  )`;

// Trading history, for judging a candidate false positive by eye.
const FACTS = `
  facts AS (
      SELECT m.LOYVERSE_ID, m.BUSINESS_NAME, m.EMAIL, m.COUNTRY, DATE(m.CREATED_AT) AS JOINED,
             COALESCE(s.N_RECEIPTS, 0) AS N_RECEIPTS, s.N_MONTHS, s.LAST_MONTH,
             cb.STATUS AS SUB_STATUS, cb.MRR
      FROM ${DB}.LOYVERSE_MERCHANTS m
      LEFT JOIN (
          SELECT LOYVERSE_MERCHANT_ID,
                 SUM(COALESCE(TOTAL_SALES_COUNT, 0))  AS N_RECEIPTS,
                 COUNT(DISTINCT MONTH)                AS N_MONTHS,
                 MAX(MONTH)                           AS LAST_MONTH
          FROM ${DB}.SALES_PER_ACCOUNT_MONTHLY GROUP BY 1
      ) s ON s.LOYVERSE_MERCHANT_ID = m.LOYVERSE_ID
      LEFT JOIN (
          SELECT LOYVERSE_MERCHANT_ID, STATUS, MRR
          FROM ${DB}.CHARGEBEE_SUBSCRIPTIONS_V
          QUALIFY ROW_NUMBER() OVER (PARTITION BY LOYVERSE_MERCHANT_ID
                  ORDER BY IFF(LOWER(STATUS)='active',0,1), COALESCE(MRR,0) DESC) = 1
      ) cb ON cb.LOYVERSE_MERCHANT_ID = m.LOYVERSE_ID
  )`;

const HEADLINE = `WITH ${BLOCK},${WAVE},${ALLRULES},${FACTS}
SELECT 'flagged after guard'            AS METRIC, COUNT(*) AS N FROM bot_accounts
UNION ALL SELECT 'flagged before guard',          COUNT(*) FROM rolled
UNION ALL SELECT '  by v3 rules (name/shape)',    COUNT(*) FROM rolled WHERE BY_V3 = 1
UNION ALL SELECT '  by v4 rules only (NEW)',      COUNT(*) FROM rolled WHERE BY_V4 = 1 AND BY_V3 = 0
UNION ALL SELECT 'RELEASED by P0 guard',          COUNT(*) FROM rolled r
          WHERE EXISTS (SELECT 1 FROM protected_accounts p WHERE p.LOYVERSE_ID = r.LOYVERSE_ID)
UNION ALL SELECT 'known wave (24 Oct+)',          COUNT(*) FROM wave
UNION ALL SELECT '  caught by v4',                COUNT(*) FROM wave w
          WHERE EXISTS (SELECT 1 FROM bot_accounts b WHERE b.LOYVERSE_ID = w.LOYVERSE_ID)
UNION ALL SELECT '  MISSED by v4',                COUNT(*) FROM wave w
          WHERE NOT EXISTS (SELECT 1 FROM bot_accounts b WHERE b.LOYVERSE_ID = w.LOYVERSE_ID)
ORDER BY 1`;

// Candidate false positives: newly flagged AND showing signs of being a real business.
const NEWFP = `WITH ${BLOCK},${WAVE},${ALLRULES},${FACTS}
SELECT r.RULES, f.LOYVERSE_ID, f.BUSINESS_NAME, f.JOINED, f.N_RECEIPTS, f.N_MONTHS,
       f.SUB_STATUS, f.MRR,
       IFF(EXISTS (SELECT 1 FROM wave w WHERE w.LOYVERSE_ID = f.LOYVERSE_ID),
           'matches wave signature', 'NO wave signature') AS SIGNATURE
FROM rolled r JOIN facts f ON f.LOYVERSE_ID = r.LOYVERSE_ID
WHERE r.BY_V4 = 1 AND r.BY_V3 = 0
  AND EXISTS (SELECT 1 FROM bot_accounts b WHERE b.LOYVERSE_ID = r.LOYVERSE_ID)
  AND (f.SUB_STATUS IS NOT NULL OR f.N_MONTHS >= 2)
ORDER BY f.N_MONTHS DESC, f.N_RECEIPTS DESC
LIMIT 200`;

// Everything the guard pulls back out. Each one re-enters the published base.
const RELEASED = `WITH ${BLOCK},${WAVE},${ALLRULES},${FACTS}
SELECT r.RULES, f.LOYVERSE_ID, f.BUSINESS_NAME, f.COUNTRY, f.JOINED, f.N_RECEIPTS,
       f.N_MONTHS, f.LAST_MONTH, f.SUB_STATUS,
       IFF(EXISTS (SELECT 1 FROM wave w WHERE w.LOYVERSE_ID = f.LOYVERSE_ID),
           'WAVE SIGNATURE - look closely', 'no wave signature') AS SIGNATURE
FROM rolled r JOIN facts f ON f.LOYVERSE_ID = r.LOYVERSE_ID
WHERE EXISTS (SELECT 1 FROM protected_accounts p WHERE p.LOYVERSE_ID = r.LOYVERSE_ID)
ORDER BY SIGNATURE, f.N_RECEIPTS DESC
LIMIT 200`;

const table = rows => {
  if (!rows.length) return '    (none)';
  const cols = Object.keys(rows[0]);
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const line = r => '    ' + cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  ');
  return [line(Object.fromEntries(cols.map(c => [c, c]))),
          '    ' + w.map(n => '-'.repeat(n)).join('  '),
          ...rows.map(line)].join('\n');
};

(async () => {
  const c = conn();
  await connect(c);
  console.log('\n=== 1. HEADLINE ===');
  console.log(table(await q(c, HEADLINE)));

  const fps = await q(c, NEWFP);
  console.log(`\n=== 2. NEWLY FLAGGED WITH A SUBSCRIPTION OR 2+ MONTHS OF TRADING (${fps.length}) ===`);
  console.log('    Every row is a candidate false positive. Anything marked "NO wave');
  console.log('    signature" needs a human decision before this merges.');
  console.log(table(fps));

  const rel = await q(c, RELEASED);
  console.log(`\n=== 3. RELEASED BY THE P0 GUARD (${rel.length}) ===`);
  console.log('    These re-enter the published base. Any row marked "WAVE SIGNATURE"');
  console.log('    means the guard is protecting an account from the attack itself —');
  console.log('    if that appears, tighten P0 before merging.');
  console.log(table(rel));

  const bad = rel.filter(r => String(r.SIGNATURE).startsWith('WAVE'));
  const unknown = fps.filter(r => String(r.SIGNATURE).startsWith('NO'));
  console.log('\n=== VERDICT ===');
  console.log(bad.length ? `    STOP — P0 releases ${bad.length} wave account(s).`
    : unknown.length ? `    REVIEW — ${unknown.length} newly flagged account(s) look like real businesses.`
    : '    CLEAR — no wave account released, no newly flagged account looks real.');
  c.destroy(() => {});
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
