// Same-realm harness for the Funnel sub-tab month filter.
// CRITICAL: the data files and the page script must run in ONE realm where window === globalThis.
// A harness that pre-sets global.window = {...} masks the exact class of bug that left the Pilot
// page blank for a week (const at top level is not a property of window). So: vm.createContext,
// ctx.window = ctx, and the page script is extracted verbatim from index.html.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;
const HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

// ---- extract the funnel IIFE verbatim ----
const START = '// ===== Activation Funnel (Payments sub-tab)';
const END = '// ===== Summary of Margins page';
const a = HTML.indexOf(START), b = HTML.indexOf(END);
if (a < 0 || b < 0 || b < a) throw new Error('could not locate the funnel block in index.html');
const FUNNEL_SRC = HTML.slice(a, b);

// ---- minimal DOM ----
function makeEl(id) {
  const el = {
    id, _html: '', _text: '', disabled: false, value: '', title: '',
    style: { display: '', opacity: '', cursor: '' },
    _cls: new Set(), _listeners: {}, children: [], attrs: {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    classList: {
      add: n => el._cls.add(n), remove: n => el._cls.delete(n),
      contains: n => el._cls.has(n),
      toggle: (n, on) => { if (on === undefined) { el._cls.has(n) ? el._cls.delete(n) : el._cls.add(n); } else { on ? el._cls.add(n) : el._cls.delete(n); } }
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    fire(ev, arg) { (this._listeners[ev] || []).forEach(fn => fn.call(this, arg || { target: this })); },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelectorAll(sel) { return this.children.filter(c => matches(c, sel)); },
    querySelector(sel) { return this.children.filter(c => matches(c, sel))[0] || null; },
    closest() { return this; }
  };
  return el;
}
function matches(el, sel) {
  if (sel === 'button') return el.tag === 'button';
  const m = /^button\[data-m="([^"]+)"\]$/.exec(sel);
  if (m) return el.tag === 'button' && el.attrs['data-m'] === m[1];
  return false;
}
const els = {};
function el(id) { return (els[id] = els[id] || makeEl(id)); }
function btn(parentId, attr, val, on) {
  const p = el(parentId), b = makeEl(parentId + ':' + val);
  b.tag = 'button'; b.attrs[attr] = val; if (on) b._cls.add('on');
  p.children.push(b); return b;
}
// Every id the funnel block touches
['fnKpis','fnCompare','fnBest','fnSingle','fnOriginBar','fnOriginLegend','fnOriginTable',
 'fnDeepKpis','fnDeepSearch','fnDeepExport','fnDeepTable','fnDeepNote','fnFootnote',
 'funnelUpdated','fnMonth','fnModeNote','fnPick','fnMode','fnDeepPick'].forEach(el);
btn('fnMode','data-m','all',true); btn('fnMode','data-m','month');
['compare','new','paying','active','dormant'].forEach((g,i)=>btn('fnPick','data-g',g,i===0));
['new','paying','activefree','dormant'].forEach((g,i)=>btn('fnDeepPick','data-b',g,i===0));

// ---- realm ----
const ctx = {};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.console = console;
ctx.document = {
  getElementById: id => (els[id] || null),
  querySelectorAll: () => [],
  createElement: () => ({ click(){}, set href(v){}, set download(v){} })
};
ctx.URL = { createObjectURL: () => 'blob:' };
ctx.Blob = function(){};
vm.createContext(ctx);

// data files, in the same realm, exactly as the browser loads them
for (const f of ['activation-data.js', 'funnel-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
}

// Inject a synthetic monthly-bases series so the EXACT path is exercised too (the committed
// funnel-data.js has none until pull.js next runs). Shape must match us_bases_monthly.sql.
const MODE = process.argv[2] || 'nobases';
if (MODE === 'bases') {
  ctx.__FUNNEL_BASES_MONTHLY = [
    { month:'2026-04', asof:'2026-04-30', partial:false, new_us:0,    paying_base_us:1180, nonpaying_us:2300, dormant_us:118000, total_us:121480, active_us:4500, paying_us:1180 },
    { month:'2026-05', asof:'2026-05-31', partial:false, new_us:0,    paying_base_us:1210, nonpaying_us:2350, dormant_us:120500, total_us:124060, active_us:4600, paying_us:1210 },
    { month:'2026-06', asof:'2026-06-30', partial:false, new_us:0,    paying_base_us:1240, nonpaying_us:2380, dormant_us:122400, total_us:126020, active_us:4700, paying_us:1240 },
    { month:'2026-07', asof:'2026-07-31', partial:false, new_us:2610, paying_base_us:1270, nonpaying_us:2410, dormant_us:123900, total_us:130190, active_us:4820, paying_us:1275 },
    { month:'2026-08', asof:'2026-08-05', partial:true,  new_us:3063, paying_base_us:1286, nonpaying_us:2430, dormant_us:124533, total_us:131312, active_us:4896, paying_us:1290 }
  ];
}

let threw = null;
try { vm.runInContext(FUNNEL_SRC, ctx, { filename: 'funnel-block' }); }
catch (e) { threw = e; }

// ---- report ----
const strip = s => String(s).replace(/<[^>]*>/g, '|').replace(/&middot;/g,'·').replace(/&mdash;/g,'-').replace(/&rarr;/g,'->').replace(/&nbsp;/g,' ').replace(/\|+/g,' | ').replace(/\s+/g,' ').trim();
function snapshot(label) {
  console.log('\n============ ' + label + ' ============');
  console.log('KPIs      :', strip(el('fnKpis').innerHTML));
  console.log('ModeNote  :', el('fnModeNote').textContent);
  console.log('Cards vis :', 'compare=' + (el('fnCompare').style.display !== 'none') + ' single=' + (el('fnSingle').style.display !== 'none'));
  console.log('Origin tbl:', strip(el('fnOriginTable').innerHTML));
  console.log('Leaderbd  :', strip(el('fnBest').innerHTML));
  console.log('DeepKpis  :', strip(el('fnDeepKpis').innerHTML));
  console.log('DeepNote  :', el('fnDeepNote').textContent);
  console.log('Footnote  :', el('fnFootnote').textContent);
  const cards = el('fnCompare').innerHTML;
  const bases = [...cards.matchAll(/class="n">([\d,]+)<\/span><span class="l">([^<]*)</g)].map(m => m[1] + ' (' + m[2].replace(/&middot;/g,'·') + ')');
  console.log('Card bases:', bases.join('  |  ') || '(none)');
}

console.log('MODE:', MODE, '| threw:', threw ? threw.message : 'no');
if (threw) { console.error(threw.stack); process.exit(1); }
if (!el('fnKpis').innerHTML) { console.error('FAIL: fnKpis empty — the block rendered nothing'); process.exit(1); }
snapshot('ALL TIME (default)');

// switch to Monthly
el('fnMode').children.find(c => c.attrs['data-m'] === 'month').fire('click');
snapshot('MONTHLY — default month (newest)');
console.log('month select visible:', el('fnMonth').style.display !== 'none');
console.log('month options      :', strip(el('fnMonth').innerHTML));

// pick July
el('fnMonth').value = '2026-07';
el('fnMonth').fire('change');
snapshot('MONTHLY — July 2026');

// single-group view survives a month change.
// NOTE: fnPick / fnDeepPick use a DELEGATED listener on the container, so the click must be
// fired on the container with target = the button. Firing on the button itself does nothing
// (this harness does not simulate bubbling) and silently reports a false failure.
const clickChild = (parentId, attr, val) =>
  el(parentId).fire('click', { target: el(parentId).children.find(c => c.attrs[attr] === val) });
clickChild('fnPick', 'data-g', 'new');
console.log('\nafter selecting "New merchants":', 'single visible=' + (el('fnSingle').style.display !== 'none'), '| single card:', strip(el('fnSingle').innerHTML).slice(0, 200));
el('fnMonth').value = '2026-08'; el('fnMonth').fire('change');
console.log('after switching to August, single still visible:', el('fnSingle').style.display !== 'none');

// deep-dive bucket switch under a month
clickChild('fnDeepPick', 'data-b', 'paying');
console.log('\ndeep dive, paying bucket, August:', el('fnDeepNote').textContent);

// back to All time
el('fnMode').children.find(c => c.attrs['data-m'] === 'all').fire('click');
snapshot('BACK TO ALL TIME');
console.log('month select hidden again:', el('fnMonth').style.display === 'none');

// ---- reconciliation ----
const M = ctx.__FUNNEL_MERCHANTS, book = M.filter(m => m.connected_at);
const ym = d => d ? String(d).slice(0, 7) : null;
const months = [...new Set(book.flatMap(r => [ym(r.connected_at), ym(r.enabled_at), ym(r.first_txn_at)]).filter(Boolean))].sort();
// Mirror the page's OWN predicates, not the raw dates: the page counts a month's "passed" as
// (counts as passed today) AND (its pass date is in that month). A date-only reconciliation
// would report OK while the UI months quietly summed to 145 against an all-time 141.
const isPassed = r => r.stage === 'enabled' || r.stage === 'transacting' || r.enabled;
const isTxn = r => r.stage === 'transacting' || !!r.first_txn_at;
const sum = (dateKey, pred) =>
  months.reduce((t, mo) => t + book.filter(r => pred(r) && ym(r[dateKey]) === mo).length, 0);
const allInit = book.length;
const allPassed = book.filter(isPassed).length;
const allTxn = book.filter(isTxn).length;
const noPassDate = book.filter(r => isPassed(r) && !r.enabled_at).length;
const noTxnDate = book.filter(r => isTxn(r) && !r.first_txn_at).length;
const sInit = sum('connected_at', () => true);
const sPassed = sum('enabled_at', isPassed);
const sTxn = sum('first_txn_at', isTxn);
const line = (label, got, want) =>
  console.log(label.padEnd(42), got, 'vs', want, got === want ? 'OK' : 'MISMATCH');
console.log('\n============ RECONCILIATION ============');
console.log('months on file            :', months.join(' '));
line('initiated  months sum vs all-time', sInit, allInit);
line('passed     months sum vs all-time - undated', sPassed, allPassed - noPassDate);
line('transacting months sum vs all-time - undated', sTxn, allTxn - noTxnDate);
console.log('undated residual (reported in the Monthly footnote): passed', noPassDate, ' transacting', noTxnDate);
if (sInit !== allInit || sPassed !== allPassed - noPassDate || sTxn !== allTxn - noTxnDate) process.exit(1);

// ---- pre-launch month (new_us = 0): the "New merchants" base is a legitimate zero, so every
// ratio against it must degrade gracefully rather than render NaN/Infinity.
el('fnMode').children.find(c => c.attrs['data-m'] === 'month').fire('click');
el('fnMonth').value = '2026-04'; el('fnMonth').fire('change');
const apr = [el('fnKpis').innerHTML, el('fnCompare').innerHTML, el('fnBest').innerHTML,
             el('fnSingle').innerHTML, el('fnOriginTable').innerHTML, el('fnDeepKpis').innerHTML].join(' ');
const bad = (apr.match(/NaN|Infinity|undefined|null%/g) || []);
console.log('\nApril 2026 (zero New base) — bad tokens:', bad.length ? bad.join(',') : 'none');
console.log('April KPIs:', strip(el('fnKpis').innerHTML));
console.log('April cards:', strip(el('fnCompare').innerHTML).slice(0, 260));
if (bad.length) process.exit(1);
