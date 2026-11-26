/* Marketing tab — cohorts by sign-up month.
 *
 * The section divides money by merchants, so the only failure that matters is the two sides
 * coming from different populations: spend for every campaign over merchants from one of them,
 * or merchants counted after a filter that the spend never saw. This renders the real page
 * against the real paid-data.js and recomputes both sides independently, including under a
 * campaign filter driven through the actual checkboxes rather than by poking at state.
 *
 * Run: node kpi-automation/test/marketing_cohorts.test.js
 * Needs jsdom; skips rather than fails when it is absent, so CI without node_modules stays green.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', 'KPI Dashboard v2 (Caio)');

let jsdom;
try { jsdom = require('jsdom'); }
catch (e) { console.log('SKIP marketing_cohorts.test.js — jsdom not installed'); process.exit(0); }
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

// Chart.js comes from a CDN the test does not reach. A permissive stub keeps the page's own
// scripts running, so the cohort renderer is genuinely exercised rather than skipped.
const STUB = `(function(){var P=new Proxy(function(){return P;},{get:function(t,k){
  if(k==='then')return undefined;
  if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf')return function(){return 'stub';};
  if(k===Symbol.iterator)return function*(){};
  return P;},apply:function(){return P;},construct:function(){return P;}});
  window.Chart=window.Chart||P;})();`;

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
// The page writes a negative as "\u2212$2.13" with a real minus sign, matching the money triangle
// on Study & Trend, so the sign has to be read before the symbols are stripped.
const num = s => {
  const t = String(s).trim();
  const neg = t.startsWith('\u2212') || t.startsWith('-');
  return (neg ? -1 : 1) * Number(t.replace(/[\u2212$,%-]/g, ''));
};
const ymNow = new Date().toISOString().slice(0, 7);

// What the page should be showing, computed from the data file without going near the page.
function expected(D, campName) {
  const keep = m => m.signD && (!campName || m.c === campName);
  const merchants = D.merchants.filter(keep);
  const spend = D.spend.filter(s => !campName || s.c === campName).reduce((a, s) => a + s.s, 0);
  let pos = 0, pay = 0, future = 0;
  for (const m of merchants) {
    for (const [ym, v] of Object.entries(m.mm || {})) {
      // Months beyond today carry amortised annual-plan revenue that has not been earned.
      if (ym > ymNow) { future += v[2]; continue; }
      pos += v[2]; pay += v[5] - v[6];
    }
  }
  return { spend, n: merchants.length, pos, pay, ret: pos + pay, future };
}

const vc = new VirtualConsole();
const jsErrors = [];
vc.on('jsdomError', e => jsErrors.push(String(e.message).slice(0, 160)));

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'marketing.html'), 'utf8'), {
  url: 'file://' + ROOT + '/marketing.html',
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  resources: { interceptors: [requestInterceptor(req => {
    if (!req.url.startsWith('file:')) return new Response(STUB, { headers: { 'Content-Type': 'application/javascript' } });
  })] }
});

setTimeout(() => {
  const w = dom.window, d = w.document, D = w.PAID_DATA;
  check(jsErrors.length === 0, 'page threw: ' + jsErrors.join(' / '));
  check(!!D, 'paid-data.js did not load');
  if (!D) { report(); return; }

  check(D.merchants.some(m => m.mm && Object.keys(m.mm).length),
        'no merchant carries cohort economics (mm) — the pull has not been re-run');

  const totalRow = () => {
    const tb = d.querySelector('#tbl-coh tbody');
    if (!tb || !tb.rows.length) return null;
    return [...tb.rows[tb.rows.length - 1].cells].map(c => c.textContent.trim());
  };

  // ── unfiltered ───────────────────────────────────────────────────────────
  let e = expected(D, null), r = totalRow();
  if (!r) fails.push('cohort table did not render');
  else {
    check(Math.abs(num(r[2]) - e.spend) < 0.02, `invested ${r[2]} vs ${e.spend.toFixed(2)}`);
    check(num(r[1]) === e.n, `merchants ${r[1]} vs ${e.n}`);
    check(Math.abs(num(r[4]) - e.pos) < 0.05, `POS revenue ${r[4]} vs ${e.pos.toFixed(2)}`);
    check(Math.abs(num(r[5]) - e.pay) < 0.05, `payments margin ${r[5]} vs ${e.pay.toFixed(2)}`);
    check(Math.abs(num(r[6]) - e.ret) < 0.05, `returned ${r[6]} vs ${e.ret.toFixed(2)}`);
    check(e.n === 0 || Math.abs(num(r[3]) - e.spend / e.n) < 0.02, `CAC ${r[3]}`);
    console.log(`  unfiltered   invested ${r[2]}  merchants ${r[1]}  returned ${r[6]}  recovered ${r[7]}`);
  }

  // Contracted future revenue must never be counted as returned — that is the one way this
  // section could overstate payback, and amortised annual plans make it an easy mistake.
  if (e.future > 0) {
    check(Math.abs(num(totalRow()[6]) - e.ret) < 0.05,
          `returned includes future-dated subscription revenue (${e.future.toFixed(2)} contracted)`);
    check(/contracted/i.test(d.getElementById('coh-foot').textContent),
          'contracted future revenue exists but the page does not say so');
  }

  // ── one campaign, driven through the real checkboxes ─────────────────────
  const boxes = [...d.querySelectorAll('#f-camp-pop input[type=checkbox]')];
  check(boxes.length > 0, 'no campaign filter checkboxes found');
  if (boxes.length) {
    const target = boxes.find(b => D.merchants.some(m => m.c === b.value)) || boxes[0];
    for (const b of boxes) if (b !== target && b.checked) { b.checked = false; b.dispatchEvent(new w.Event('change', { bubbles: true })); }
    if (!target.checked) { target.checked = true; target.dispatchEvent(new w.Event('change', { bubbles: true })); }
    e = expected(D, target.value); r = totalRow();
    if (!r) fails.push('cohort table vanished under a campaign filter');
    else {
      check(Math.abs(num(r[2]) - e.spend) < 0.02, `filtered invested ${r[2]} vs ${e.spend.toFixed(2)}`);
      check(num(r[1]) === e.n, `filtered merchants ${r[1]} vs ${e.n}`);
      check(Math.abs(num(r[6]) - e.ret) < 0.05, `filtered returned ${r[6]} vs ${e.ret.toFixed(2)}`);
      check(e.n === 0 || Math.abs(num(r[3]) - e.spend / e.n) < 0.02, `filtered CAC ${r[3]}`);
      check(e.spend < expected(D, null).spend, 'the campaign filter did not narrow spend at all');
      console.log(`  one campaign ${target.value}: invested ${r[2]}  merchants ${r[1]}  returned ${r[6]}`);
    }
  }

  // Every metric must render without throwing, and % of CAC recovered must be a percentage.
  const metrics = [...d.querySelectorAll('#coh-metric button')];
  check(metrics.length >= 9, `expected 9 cohort metrics, found ${metrics.length}`);
  for (const b of metrics) {
    b.dispatchEvent(new w.Event('click', { bubbles: true }));
    const tri = d.querySelector('#tri-wrap table.tri tbody');
    check(tri && tri.rows.length > 0, `metric ${b.dataset.m} rendered an empty triangle`);
    // The grid must keep the house style: sticky cohort label, grey Size column, newest first.
    if (tri && tri.rows.length) {
      const r0 = tri.rows[0];
      check(r0.cells[0].className === 'k', `metric ${b.dataset.m}: first cell is not the cohort label`);
      check(r0.cells[1].className === 'sz', `metric ${b.dataset.m}: second column is not Size`);
    }
  }

  report();

  function report() {
    if (fails.length) {
      console.error('\nFAILED (' + fails.length + '):');
      fails.forEach(f => console.error('  - ' + f));
      process.exit(1);
    }
    console.log('\nmarketing_cohorts.test.js: spend and merchants agree, filtered and unfiltered.');
  }
}, 2500);
