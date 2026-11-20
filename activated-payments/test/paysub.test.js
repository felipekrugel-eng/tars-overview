/* Payments sub-navigation — the four pages must show the same bar.
 *
 * The bar used to be hand-written in index.html, profile.html, report.html and
 * risk-health.html, and had drifted: Cohorts existed only on index, Fraud Health was
 * injected at runtime by country-filter.js, and risk-health still advertised a Pilot
 * tab that no longer exists. Tabs therefore came and went as you moved between pages.
 * paysub.js is now the single definition; this test is what stops it drifting again.
 *
 * Run: node activated-payments/test/paysub.test.js
 * Needs jsdom. If it is not installed the test skips rather than fails, so CI without
 * node_modules does not go red on a missing dev dependency.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let jsdom;
try {
  jsdom = require('jsdom');
} catch (e) {
  console.log('SKIP paysub.test.js — jsdom not installed');
  process.exit(0);
}
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

// The canonical bar, in order. Change it here and in paysub.js, nowhere else.
const EXPECT = ['Overview', 'Summary of Margins', 'Funnel', 'Cohorts',
                'Payment Profile', 'Fraud Health', 'Report'];

const CASES = [
  ['index.html',       '',          'overview',    1],
  ['index.html',       '#margins',  'margins',     1],
  ['index.html',       '#funnel',   'funnel',      1],
  ['index.html',       '#cohorts',  'cohorts',     1],
  ['profile.html',     '',          'profile',     1],
  ['report.html',      '',          'report',      1],
  // risk-health.html does not load country-filter.js, so it has no country picker.
  ['risk-health.html', '',          'risk-health', 0]
];

// Leaflet, Chart.js and SheetJS come from a CDN, which the test does not reach. A
// permissive stub keeps the page's own scripts running so the hash-driven active tab
// is genuinely exercised; an empty stub would make them throw and the test vacuous.
const STUB = `
(function(){
  var P = new Proxy(function(){ return P; }, {
    get: function (t, k) {
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return function(){ return 'stub'; };
      if (k === Symbol.iterator) return function*(){};
      return P;
    },
    apply: function(){ return P; },
    construct: function(){ return P; }
  });
  window.L = window.L || P; window.Chart = window.Chart || P; window.XLSX = window.XLSX || P;
})();
`;

const fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); }

(async () => {
  for (const [file, hash, active, wantPickers] of CASES) {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
      url: 'file://' + ROOT + '/' + file + hash,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      resources: { interceptors: [requestInterceptor(req => {
        if (!req.url.startsWith('file:')) {
          return new Response(STUB, { headers: { 'Content-Type': 'application/javascript' } });
        }
      })] }
    });
    await new Promise(r => setTimeout(r, 2500));

    const tag = file + hash;
    const nav = dom.window.document.querySelector('.paysub');
    if (!nav) { fails.push(tag + ': no .paysub bar'); dom.window.close(); continue; }

    const as = [...nav.querySelectorAll('a')];
    const labels = as.map(a => a.textContent.trim());
    const on = as.filter(a => a.classList.contains('on')).map(a => a.id);
    const hrefs = as.map(a => a.getAttribute('href'));

    check(JSON.stringify(labels) === JSON.stringify(EXPECT),
          tag + ': items are ' + JSON.stringify(labels));
    check(on.length === 1 && on[0] === 'paysub-' + active,
          tag + ': active item is ' + JSON.stringify(on) + ', expected paysub-' + active);
    check(nav.querySelectorAll('select').length === wantPickers,
          tag + ': ' + nav.querySelectorAll('select').length + ' country pickers, expected ' + wantPickers);
    check(!hrefs.some(h => /pilot/i.test(h)), tag + ': still links to the removed Pilot tab');
    // On index the first four are in-page tabs; elsewhere they point back into index.
    const inlineExpected = file === 'index.html';
    check(hrefs[0] === (inlineExpected ? '#payments' : 'index.html#payments'),
          tag + ': first href is ' + hrefs[0]);

    console.log('  ' + tag.padEnd(22) + ' ' + labels.length + ' items, active ' + on.join(',') +
                ', pickers ' + nav.querySelectorAll('select').length);
    dom.window.close();
  }

  if (fails.length) {
    console.error('\nFAILED (' + fails.length + '):');
    fails.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('\npaysub.test.js: all ' + CASES.length + ' pages render the same bar.');
})();
