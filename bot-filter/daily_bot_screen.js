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
 *      SLACK_BOT_SCREEN_WEBHOOK_URL (falls back to SLACK_WEBHOOK_URL; without either the
 *        report prints to stdout only). Point this somewhere that is NOT the shared
 *        pipeline-error channel - see WHY THE ALERT STOPPED WORKING below.
 *      SLACK_ESCALATION_WEBHOOK_URL (optional - a DM or a second channel; an unactioned
 *        flag is repeated here once, loudly, instead of quietly in the main channel).
 *      BOT_SCREEN_STATE_PATH (default .bot_screen_state.json beside this script),
 *      BOT_SCREEN_ESCALATE_HOURS (default 24), LOOKBACK_DAYS (default 3),
 *      DRY_RUN=1 to skip posting.
 *
 * WHY THE ALERT STOPPED WORKING (2026-11-10). This screen did its job. It flagged the US
 * on 26 Oct and on every anomalous day after, correctly, with the receipt totals attached,
 * labelled 'unexplained excess - nothing excluded'. Nobody acted for nineteen days, and
 * 1,008 bot accounts entered the published base while it kept posting.
 *
 * Three reasons, none of them detection:
 *   1. It posted into a channel shared with pipeline ERROR messages that were repeating
 *      hourly for a week at a time. The signal was true and invisible.
 *   2. It re-posted the SAME unresolved flag on every run - the 7 Nov flag went out three
 *      times, the 4 Nov flag four times. Worse, the only thing that changed between copies
 *      was the receipt total ticking up, so each repeat looked superficially new while
 *      saying nothing new. An alert that repeats itself teaches people to scroll past it.
 *   3. Nothing ever escalated. A flag outstanding for two weeks looked exactly like a flag
 *      raised five minutes ago.
 *
 * So: state is kept between runs, an unchanged flag is posted once and then suppressed, an
 * unactioned flag escalates once to a different destination, and a flag that goes away is
 * reported as resolved so the loop visibly closes. If the state file cannot be read or
 * written the script FAILS OPEN and posts exactly as it did before - a monitor that goes
 * quiet because its bookkeeping broke is worse than one that repeats itself.
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
  // Anchor on the LAST line of the block, not the shape rule. v4 nests the shape rule
  // inside a UNION subquery, so the ')' after it now closes that subquery and this would
  // silently hand Snowflake a truncated CTE. protected_accounts is the final line by
  // construction: the real-merchant guard is subtracted last and nothing follows it.
  const g = src.indexOf('SELECT LOYVERSE_ID FROM protected_accounts');
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

// ---- alert state ----------------------------------------------------------
// Keyed by country-day. The signature deliberately EXCLUDES the receipt money and the
// receipt merchant count: those tick up on every run, and including them is what made
// three identical 7 Nov alerts look like three different events.
const STATE_PATH = process.env.BOT_SCREEN_STATE_PATH
  || path.join(__dirname, '.bot_screen_state.json');
const ESCALATE_HOURS = Number(process.env.BOT_SCREEN_ESCALATE_HOURS || 24);
const HOUR = 3600 * 1000;

const sigOf = f => [f.country, f.day, f.n, f.median, f.alreadyFiltered].join('|');
const keyOf = f => `${f.country}|${f.day}`;

function readState() {
  try { return { ok: true, data: JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }; }
  catch (e) {
    // Missing file on a first run is normal. Anything else means we cannot dedupe, and
    // the safe failure is to post everything rather than to go quiet.
    if (e.code !== 'ENOENT') console.error('state unreadable, failing open:', e.message);
    return { ok: e.code === 'ENOENT', data: {} };
  }
}
function writeState(data) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('state not persisted, next run will repeat:', e.message); }
}

/** Split the run into what to say now, what to escalate, and what has resolved. */
function classify(flagged, state, nowMs) {
  const fresh = [], repeat = [], escalate = [];
  for (const f of flagged) {
    const k = keyOf(f), sig = sigOf(f), prev = state[k];
    if (!prev) { state[k] = { firstSeen: nowMs, lastSig: sig, posts: 1, escalated: false };
                 f.ageHours = 0; f.posts = 1; fresh.push(f); continue; }
    f.ageHours = Math.round((nowMs - prev.firstSeen) / HOUR);
    f.posts = prev.posts;
    if (prev.lastSig !== sig) {           // materially changed - worth saying again
      prev.lastSig = sig; prev.posts += 1; f.posts = prev.posts; f.changed = true;
      fresh.push(f);
    } else if (!prev.escalated && f.ageHours >= ESCALATE_HOURS) {
      prev.escalated = true; escalate.push(f);
    } else {
      repeat.push(f);
    }
  }
  const live = new Set(flagged.map(keyOf));
  const resolved = Object.keys(state).filter(k => !live.has(k));
  for (const k of resolved) delete state[k];
  return { fresh, repeat, escalate, resolved };
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
    // How long this has been outstanding, stated in the alert itself. The 7 Nov flag was
    // posted three times with no indication that it was the same unactioned flag each time.
    const age = !f.ageHours ? ''
      : f.ageHours >= 24 ? `  _(open ${Math.floor(f.ageHours / 24)}d, ${f.posts} posts)_`
                         : `  _(open ${f.ageHours}h)_`;
    return [
      `*${f.country} ${f.day}* — ${f.n} registrations vs median ${f.median} (${f.z} MAD)  ${verdict}${age}`,
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

async function post(hook, text, label) {
  if (!hook) { console.log(`(no webhook for ${label} — not posting)`); return; }
  if (process.env.DRY_RUN === '1') { console.log(`(DRY_RUN — would post ${label})`); return; }
  const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ text }) });
  if (!res.ok) { console.error(`Slack post failed (${label}):`, res.status, await res.text());
                 process.exit(1); }
  console.log(`posted ${label}`);
}

(async () => {
  const flagged = await main();
  const hook = process.env.SLACK_BOT_SCREEN_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  const escalationHook = process.env.SLACK_ESCALATION_WEBHOOK_URL;

  const { ok, data: state } = readState();
  if (!ok) {
    // Dedupe is unavailable. Behave exactly as the pre-2026-11-10 script did.
    const { text, quiet } = render(flagged);
    console.log(text);
    if (!quiet) await post(hook, text, 'digest (state unavailable — failing open)');
    return;
  }

  const { fresh, repeat, escalate, resolved } = classify(flagged, state, Date.now());
  writeState(state);

  const { text, quiet } = render(fresh);
  console.log(render(flagged).text);
  console.log(`new/changed ${fresh.length} · suppressed ${repeat.length} · ` +
              `escalating ${escalate.length} · resolved ${resolved.length}`);

  if (fresh.length && !quiet) await post(hook, text, 'digest');

  // An unactioned flag is not repeated in the main channel; it is said once, elsewhere,
  // in terms that make the age the headline rather than the registration count.
  for (const f of escalate) {
    const days = Math.max(Math.floor(f.ageHours / 24), 1);
    const line = `:rotating_light: *UNACTIONED ${days} day(s)* — bot screen flagged ` +
      `*${f.country} ${f.day}* (${f.n} registrations vs median ${f.median}, ` +
      `${f.alreadyFiltered}/${f.n} excluded) and nothing has changed since.\n` +
      `Either the filter needs a rule for it or the flag needs closing — it cannot stay open.`;
    await post(escalationHook || hook, line, `escalation ${f.country} ${f.day}`);
  }

  // Closing the loop matters as much as opening it: an alert you never see resolve is an
  // alert you stop believing. Posted to the main channel, quietly, once.
  if (resolved.length) {
    await post(hook, `:white_check_mark: Bot screen — no longer anomalous: ` +
      `${resolved.map(k => k.replace('|', ' ')).join(', ')}`, 'resolution');
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
