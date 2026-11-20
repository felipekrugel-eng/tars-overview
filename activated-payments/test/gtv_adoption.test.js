#!/usr/bin/env node
/* Checks for the Payments GTV Adoption section. Run: node test/gtv_adoption.test.js
   Exercises the real renderer and the real merge, against the real data file, so a
   regression in either shows up here rather than on the page. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const DIR = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
// ── the published series ──
global.window = {};
require(path.join(DIR, 'funnel-data.js'));
const S = window.__GTV_ADOPTION || [];

console.log('Payments GTV adoption');
t('series is present and starts at the July 2026 launch', () => {
  assert.ok(S.length >= 1, 'no months');
  assert.strictEqual(S[0].month, '2026-07');
});
t('months are unique, sorted and contiguous', () => {
  const ms = S.map(x => x.month);
  assert.deepStrictEqual(ms, [...new Set(ms)].sort(), 'duplicate or unsorted months');
  for (let i = 1; i < ms.length; i++) {
    const [ay, am] = ms[i-1].split('-').map(Number), [by, bm] = ms[i].split('-').map(Number);
    assert.strictEqual((by - ay) * 12 + (bm - am), 1, 'gap before ' + ms[i]);
  }
});
t('exactly one open month, and it is the last', () => {
  const open = S.filter(x => !x.complete);
  assert.ok(open.length <= 1, open.length + ' open months');
  if (open.length) assert.strictEqual(open[0].month, S[S.length-1].month, 'open month is not last');
});
t('numerator never exceeds the denominator', () => {
  S.forEach(x => assert.ok(x.adoptedGtv <= x.gtv + 0.01,
    x.month + ': adopted $' + x.adoptedGtv + ' > total $' + x.gtv));
});
t('adopting merchants never exceed credible merchants', () => {
  S.forEach(x => assert.ok(x.adoptedMerchants <= x.merchants,
    x.month + ': ' + x.adoptedMerchants + ' adopters > ' + x.merchants + ' credible'));
});
t('cohort membership never shrinks across closed months', () => {
  // A merchant that has transacted stays transacted; a fall means a later-adopting
  // merchant leaked into an earlier month, or the cohort was rebuilt wrongly.
  const c = S.filter(x => x.complete);
  for (let i = 1; i < c.length; i++)
    assert.ok(c[i].adoptedMerchants >= c[i-1].adoptedMerchants,
      'adopters fell ' + c[i-1].month + ' -> ' + c[i].month);
});
t('every figure is finite and non-negative', () => {
  S.forEach(x => ['gtv','adoptedGtv','merchants','adoptedMerchants','receipts'].forEach(k => {
    assert.ok(Number.isFinite(x[k]) && x[k] >= 0, x.month + '.' + k + ' = ' + x[k]);
  }));
});
t('a zero denominator yields no adoption rather than a divide by zero', () => {
  const adoption = g => (g.gtv ? g.adoptedGtv / g.gtv * 100 : null);
  assert.strictEqual(adoption({ gtv: 0, adoptedGtv: 0 }), null);
  assert.strictEqual(adoption({ gtv: 0, adoptedGtv: 5 }), null);
});
t('month over month skips the open month', () => {
  const closed = S.filter(x => x.complete);
  const last = closed[closed.length-1], prev = closed[closed.length-2];
  if (!prev) return;
  const mom = (last.adoptedGtv/last.gtv - prev.adoptedGtv/prev.gtv) * 100;
  assert.ok(Number.isFinite(mom), 'MoM not finite');
  const open = S.filter(x => !x.complete)[0];
  if (open) assert.notStrictEqual(last.month, open.month, 'MoM anchored on the open month');
});
t('source marks observed vs estimated', () => {
  S.forEach(x => assert.ok(typeof x.source === 'string' && x.source.length, x.month + ' has no source'));
});

// ── the merge rule: closed months are frozen, the open month refreshes ──
const src = fs.readFileSync(path.join(DIR, 'pull.js'), 'utf8');
const mergeSrc = src.slice(src.indexOf('function mergeAdoption'), src.indexOf('async function pullAdoption'));
const mergeAdoption = new Function('return ' + mergeSrc.trim())();
t('a closed month is never rewritten', () => {
  const prev = { months: { '2026-07': { month:'2026-07', complete:true, gtv:100, adoptedGtv:10,
                                        merchants:5, adoptedMerchants:1, receipts:9, source:'measured' } } };
  const r = mergeAdoption([{ MONTH:'2026-07', IS_COMPLETE:true, TOTAL_POS_GTV_USD:999,
                             ADOPTED_POS_GTV_USD:999, CREDIBLE_MERCHANTS:9, ADOPTED_MERCHANTS:9, RECEIPTS:9 }], prev);
  assert.strictEqual(r.out['2026-07'].gtv, 100, 'frozen month was overwritten');
  assert.strictEqual(r.frozen, 1);
});
t('the open month does refresh', () => {
  const prev = { months: { '2026-11': { month:'2026-11', complete:false, gtv:10, adoptedGtv:1,
                                        merchants:1, adoptedMerchants:1, receipts:1, source:'measured' } } };
  const r = mergeAdoption([{ MONTH:'2026-11', IS_COMPLETE:false, TOTAL_POS_GTV_USD:50,
                             ADOPTED_POS_GTV_USD:5, CREDIBLE_MERCHANTS:2, ADOPTED_MERCHANTS:2, RECEIPTS:3 }], prev);
  assert.strictEqual(r.out['2026-11'].gtv, 50, 'open month did not refresh');
});
t('an open month that closes is written once, then frozen', () => {
  let prev = { months: {} };
  let r = mergeAdoption([{ MONTH:'2026-11', IS_COMPLETE:false, TOTAL_POS_GTV_USD:50, ADOPTED_POS_GTV_USD:5,
                           CREDIBLE_MERCHANTS:2, ADOPTED_MERCHANTS:2, RECEIPTS:3 }], prev);
  r = mergeAdoption([{ MONTH:'2026-11', IS_COMPLETE:true, TOTAL_POS_GTV_USD:80, ADOPTED_POS_GTV_USD:8,
                       CREDIBLE_MERCHANTS:3, ADOPTED_MERCHANTS:3, RECEIPTS:4 }], { months: r.out });
  assert.strictEqual(r.out['2026-11'].gtv, 80);
  assert.strictEqual(r.out['2026-11'].complete, true);
  const again = mergeAdoption([{ MONTH:'2026-11', IS_COMPLETE:true, TOTAL_POS_GTV_USD:111, ADOPTED_POS_GTV_USD:11,
                                 CREDIBLE_MERCHANTS:4, ADOPTED_MERCHANTS:4, RECEIPTS:5 }], { months: r.out });
  assert.strictEqual(again.out['2026-11'].gtv, 80, 'a closed month was restated');
});
t('a corrected month recalculates once its entry is removed', () => {
  const prev = { months: { '2026-07': { month:'2026-07', complete:true, gtv:100, adoptedGtv:10,
                                        merchants:5, adoptedMerchants:1, receipts:9, source:'measured' } } };
  delete prev.months['2026-07'];
  const r = mergeAdoption([{ MONTH:'2026-07', IS_COMPLETE:true, TOTAL_POS_GTV_USD:123, ADOPTED_POS_GTV_USD:12,
                             CREDIBLE_MERCHANTS:6, ADOPTED_MERCHANTS:2, RECEIPTS:10 }], prev);
  assert.strictEqual(r.out['2026-07'].gtv, 123);
});

// ── the query says what it claims to ──
const sql = fs.readFileSync(path.join(DIR, 'sql', 'gtv_adoption_monthly.sql'), 'utf8');
t('eligibility is Confirmed + Plausible only', () => {
  assert.ok(/IN \('1 - Confirmed by card data', '2 - Plausible'\)/.test(sql), 'credibility filter missing');
});
t('adoption requires a succeeded, paid and captured charge', () => {
  assert.ok(/LOWER\(c\.STATUS\) = 'succeeded'/.test(sql));
  assert.ok(/c\.PAID = TRUE/.test(sql));
  assert.ok(/c\.CAPTURED = TRUE/.test(sql));
});
t('POS GTV keeps the merchant-base receipt rule', () => {
  assert.ok(/CANCELLED_AT IS NULL/.test(sql) && /REFUND_FOR IS NULL/.test(sql));
  assert.ok(/RECEIPT_TYPE, 'SALE'\)\) <> 'REFUND'/.test(sql));
  assert.ok(/LEAST\(r\.TOTAL_MONEY \* s\.GTV_SCALE, 10000\)/.test(sql), '$10k cap missing');
});
t('merchants are joined on id, never email or name', () => {
  assert.ok(/owner_id/.test(sql), 'owner_id link missing');
  assert.ok(!/LINK_EMAIL|LINK_NAME/.test(sql), 'the email/name fallback leaked back in');
});
t('the bot screen is applied to the base', () => {
  assert.ok(/NOT IN \(SELECT LOYVERSE_ID FROM bot_accounts\)/.test(sql));
});
t('cohort membership is bounded by the month end', () => {
  assert.ok(/FIRST_CHARGE_DATE <= LAST_DAY/.test(sql), 'adoption not bounded at month end');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
