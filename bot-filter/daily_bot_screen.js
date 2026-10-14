#!/usr/bin/env node
/**
 * daily_bot_screen.js — all-country daily registration anomaly screen.
 *
 * WHY THIS EXISTS. Three registration-bot waves reached production before anyone noticed,
 * and all three were caught the same way: a human looked at a chart.
 *     30-31 Jul 2026   8,001 accounts
 *     10-16 Sep 2026   1,834 accounts   ~32 hours before anyone noticed
 *      8-12 Oct 2026     819 accounts   ~3.5 days before anyone noticed
 * The 250-per-15-minute CloudWatch alarm does not close this gap. It is a RATE alarm, so a
 * wave spread thinly across a day never trips it, and it fires on bursts that are organic --
 * it went off on 12 Oct 2026 for an unrelated Philippine burst that turned out to be real.
 * This screen is a VOLUME-vs-BASELINE test per country per day, which is the shape these
 * waves actually have.
 *
 * WHAT IT DOES NOT DO. It does not decide what is a bot. It flags a country-day as unusual
 * and characterises who arrived, then says whether the deployed filter already catches them.
 * The judgement stays with a person; the point is that the person is now told.
 *
 * Env: SNOWFLAKE_PRIVATE_KEY (PEM), SNOWFLAKE_ACCOUNT/USER/WAREHOUSE/ROLE/DATABASE/SCHEMA,
 *      SLACK_WEBHOOK_URL (optional - without it the report prints to stdout only),
 *      LOOKBACK_DAYS (default 3), DRY_RUN=1 to skip posting.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const snowflake = require('snowflake-sdk');
snowflake.configure({ logLevel: 'ERROR' });

const CFG = {
  account:   process.env.SNOWFLAKE_ACCOUNT   || 'ORXEAZX-TC97659',
  username:  process.env.SNOWFLAKE_USER      || 'TARS_SERVICE_USER',
  warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
  role:      process.env.SNOWFLAKE_ROLE      || 'DATA_VIEWER',
  database:  process.env.SNOWFLAKE_DATABASE  || 'LOYVERSE_DATA_LAKE',
  schema:    process.env.SNOWFLAKE_SCHEMA    || 'PUBLIC',
};
const LOOKBACK = parseInt(process.env.LOOKBACK_DAYS || '3', 10);

// ---- detection thresholds -------------------------------------------------
// A country-day is flagged when ALL of these hold. They are deliberately conservative:
// this posts to a human channel, so a false alarm costs attention, which is the scarce thing.
const MIN_ABS      = 20;   // absolute floor. Small countries are noisy in relative terms.
const MIN_RATIO    = 1.5;  // at least 50% above the rolling median
const MIN_ROBUST_Z = 4.0;  // and at least 4 scaled-MAD above it
const BASE_DAYS    = 28;   // rolling baseline window...
const BASE_LAG     = 2;    // ...ending 2 days before the day under test, so a wave that has
                           // been running for a day or two cannot raise its own baseline.
                           // This is the mistake that made the first draft of the Oct filter
                           // catch 0 of 819: an unlagged baseline absorbs the attack.

function privateKey() {
  const pem = process.env.SNOWFLAKE_PRIVATE_KEY
    ? process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : fs.readFileSync(process.env.SNOWFLAKE_KEY_PATH, 'utf8');
  return crypto.createPrivateKey({ key: pem, format: 'pem' })
               .export({ type: 'pkcs8', format: 'pem' });
}
const connect = c => new Promise((res, rej) => c.connect((e, x) => e ? rej(e) : res(x)));
const q = (c, sqlText) => new Promise((res, rej) =>
  c.execute({ sqlText, complete: (e, s, r) => e ? rej(e) : res(r) }));

/** The deployed exclusion set, read from the reference SQL so it can never drift from it. */
function botAccountsCTE() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'kpi-automation', 'sql', 'country_registrations_daily_asof.sql'), 'utf8');
  const i = src.indexOf('us_bot_accounts AS (');
  const g = src.indexOf('SELECT LOYVERSE_ID FROM shape_bot_accounts');
  if (i < 0 || g < 0) throw new Error('bot CTE not found in reference SQL');
  return src.slice(i, src.indexOf(')', g) + 1);
}

const median = a => { if (!a.length) return 0; const s=[...a].sort((x,y)=>x-y), m=s.length>>1;
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; };

async function main() {
  const conn = snowflake.createConnection({ ...CFG, authenticator: 'SNOWFLAKE_JWT', privateKey: privateKey() });
  await connect(conn);

  // 1. Per-country daily registrations. CREATED_AT's timezone is not trustworthy for an
  //    instant, but it is fine for bucketing into days, which is all this needs.
  const daily = await q(conn, `
    SELECT UPPER(TRIM(COUNTRY)) AS C, TO_CHAR(DATE(CREATED_AT),'YYYY-MM-DD') AS D, COUNT(*) AS N
    FROM ${CFG.database}.${CFG.schema}.LOYVERSE_MERCHANTS
    WHERE COUNTRY IS NOT NULL
      AND CREATED_AT >= DATEADD(day, -${BASE_DAYS + BASE_LAG + LOOKBACK + 2}, CURRENT_DATE())
    GROUP BY 1, 2`);

  const byCountry = {};
  for (const r of daily) (byCountry[r.C] ||= {})[r.D] = Number(r.N);

  const today = new Date();
  const days = [];
  for (let k = 1; k <= LOOKBACK; k++) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - k);
    days.push(d.toISOString().slice(0, 10));
  }

  const flagged = [];
  for (const [c, series] of Object.entries(byCountry)) {
    for (const day of days) {
      const n = series[day] || 0;
      if (n < MIN_ABS) continue;
      const base = [];
      for (let k = BASE_LAG; k < BASE_LAG + BASE_DAYS; k++) {
        const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - k);
        base.push(series[d.toISOString().slice(0, 10)] || 0);
      }
      const med = median(base);
      const mad = median(base.map(v => Math.abs(v - med)));
      const spread = Math.max(1.4826 * mad, 1);      // floor keeps a flat series from dividing by 0
      const z = (n - med) / spread;
      if (n >= med * MIN_RATIO && z >= MIN_ROBUST_Z) {
        flagged.push({ country: c, day, n, median: med, z: +z.toFixed(1) });
      }
    }
  }
  flagged.sort((a, b) => b.z - a.z);

  // 2. Characterise each flagged country-day, and say whether the filter already has it.
  const CTE = botAccountsCTE();
  for (const f of flagged) {
    const [row] = await q(conn, `
      WITH ${CTE},
      coh AS (
        SELECT LOYVERSE_ID, BUSINESS_NAME, EMAIL, REFERRER_URL,
               REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
                   TRIM(BUSINESS_NAME),'[0-9]','9'),'[a-z]','a'),'[A-Z]','A') AS SHAPE
        FROM ${CFG.database}.${CFG.schema}.LOYVERSE_MERCHANTS
        WHERE UPPER(TRIM(COUNTRY)) = '${f.country}' AND DATE(CREATED_AT) = '${f.day}')
      SELECT
        COUNT(*)                                                            AS N,
        COUNT(DISTINCT TRIM(BUSINESS_NAME))                                 AS DISTINCT_NAMES,
        MAX(SHARE)                                                          AS TOP_SHAPE_SHARE,
        ROUND(100 * COUNT_IF(NOT CONTAINS(SPLIT_PART(LOWER(TRIM(EMAIL)),'@',1),'.')) / NULLIF(COUNT(*),0),1) AS PCT_DOTLESS,
        ROUND(100 * COUNT_IF(SPLIT_PART(LOWER(TRIM(EMAIL)),'@',2)='gmail.com') / NULLIF(COUNT(*),0),1)       AS PCT_GMAIL,
        ROUND(100 * COUNT_IF(REFERRER_URL IS NOT NULL) / NULLIF(COUNT(*),0),1)                               AS PCT_ATTRIB,
        COUNT_IF(LOYVERSE_ID IN (SELECT LOYVERSE_ID FROM bot_accounts))      AS ALREADY_FILTERED,
        (SELECT COUNT(DISTINCT r.MERCHANT_ID) FROM ${CFG.database}.${CFG.schema}.LOYVERSE_RECEIPTS r
          WHERE r.MERCHANT_ID IN (SELECT LOYVERSE_ID FROM coh))              AS WITH_RECEIPTS,
        -- Receipt totals are reported PER CURRENCY, never summed across them. The first
        -- live run of this screen reported SN as "$3,920,791" when the figure was XOF -
        -- about $6,500. A number that wrong on a fraud alert is how people learn to
        -- distrust the alert, so the currency travels with the number or the number does
        -- not get shown.
        (SELECT LISTAGG(x, ' + ') WITHIN GROUP (ORDER BY x) FROM (
            SELECT TO_VARCHAR(ROUND(SUM(r.TOTAL_MONEY), 0), '999,999,999,999') || ' ' || r.CURRENCY AS x
            FROM ${CFG.database}.${CFG.schema}.LOYVERSE_RECEIPTS r
            WHERE r.MERCHANT_ID IN (SELECT LOYVERSE_ID FROM coh)
            GROUP BY r.CURRENCY ORDER BY SUM(r.TOTAL_MONEY) DESC LIMIT 3))   AS RECEIPT_MONEY
      FROM (SELECT c.*, COUNT(*) OVER (PARTITION BY SHAPE) / COUNT(*) OVER () AS SHARE FROM coh c)`);
    Object.assign(f, {
      distinctNames: Number(row.DISTINCT_NAMES),
      topShapeShare: Math.round(100 * Number(row.TOP_SHAPE_SHARE)),
      pctDotless: Number(row.PCT_DOTLESS), pctGmail: Number(row.PCT_GMAIL),
      alreadyFiltered: Number(row.ALREADY_FILTERED),
      withReceipts: Number(row.WITH_RECEIPTS), receiptMoney: row.RECEIPT_MONEY || "none",
    });
  }
  conn.destroy(() => {});
  return flagged;
}

function render(flagged) {
  if (!flagged.length) return { text: `:white_check_mark: Bot screen — no anomalous country-days in the last ${LOOKBACK}.`, quiet: true };
  const lines = flagged.map(f => {
    // Judge the rule against the EXCESS over baseline, not against the day's total. A day
    // can stay above its median purely because the organic residual is unchanged underneath
    // a wave that has been fully excluded -- calling that "not caught" is how an alert
    // trains people to ignore it.
    const excess = Math.max(f.n - f.median, 1);
    const verdict = f.alreadyFiltered >= 0.9 * excess ? ':shield: excess already excluded by the filter'
                  : f.alreadyFiltered > 0            ? ':eyes: *excess only partly excluded*'
                                                     : ':rotating_light: *unexplained excess — nothing excluded*';
    return [
      `*${f.country} ${f.day}* — ${f.n} registrations vs median ${f.median} (${f.z} MAD)  ${verdict}`,
      `    ${f.alreadyFiltered}/${f.n} already excluded · ${f.distinctNames} distinct names · top name-shape ${f.topShapeShare}%`,
      `    mailbox: ${f.pctDotless}% dotless, ${f.pctGmail}% gmail · receipts: ${f.withReceipts} merchants, ${String(f.receiptMoney).trim()}`,
    ].join('\n');
  });
  const urgent = flagged.some(f => f.alreadyFiltered < 0.9 * Math.max(f.n - f.median, 1));
  return {
    text: `${urgent ? ':rotating_light:' : ':mag:'} Bot screen — ${flagged.length} anomalous country-day(s)\n\n${lines.join('\n\n')}`,
    quiet: !urgent,
  };
}

(async () => {
  const flagged = await main();
  const { text, quiet } = render(flagged);
  console.log(text);
  const hook = process.env.SLACK_WEBHOOK_URL;
  // Stay quiet on a clean run: an alert that posts every day stops being read.
  if (!hook || process.env.DRY_RUN === '1' || quiet) {
    console.log(quiet ? '(nothing actionable — not posting)' : '(no SLACK_WEBHOOK_URL — not posting)');
    return;
  }
  const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ text }) });
  if (!res.ok) { console.error('Slack post failed:', res.status, await res.text()); process.exit(1); }
  console.log('posted to Slack');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
