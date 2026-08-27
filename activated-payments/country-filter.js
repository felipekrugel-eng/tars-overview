// ===========================================================================
// LOYVERSE PAYMENTS — COUNTRY FILTER (shared by index.html and report.html)
// ---------------------------------------------------------------------------
// Added 17 Aug 2026 for the UK launch. Loyverse Payments now runs in more than one
// market, so every Payments page needs to be readable per market as well as blended.
//
// THE ONE RULE THIS FILE ENFORCES: selecting "All countries" must reproduce, to the
// digit, the numbers the page showed before the filter existed. That is why the data
// files were changed ADDITIVELY — each row keeps its original blended field(s) and
// gains a `by` object keyed by ISO-2 country — and why every projection below reads
// the original field when nothing is selected, rather than summing `by` back up.
// Summing would be arithmetically equivalent but not textually identical, and would
// silently start restating the moment a row's `by` were incomplete.
//
// COUNTRY MEANS THE MERCHANT'S COUNTRY — Stripe CONNECTED_ACCOUNTS.COUNTRY, i.e. where
// the business is registered. It is NOT the card's issuing country (CARD_COUNTRY),
// which is a property of the shopper and answers a completely different question.
//
// Rows whose country could not be determined are bucketed as 'ZZ' and shown as
// "Unknown" rather than being quietly folded into a real market.
// ===========================================================================
(function () {
  'use strict';

  var ALL = '';                 // sentinel for "All countries"
  var UNKNOWN = 'ZZ';

  // Only markets Loyverse actually operates in need friendly names; anything else
  // falls back to its ISO code, which is still perfectly readable in a picker.
  var NAMES = {
    US: 'United States', GB: 'United Kingdom', NL: 'Netherlands',
    IE: 'Ireland', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand',
    DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', PT: 'Portugal',
    MX: 'Mexico', BR: 'Brazil', ZZ: 'Unknown'
  };
  var FLAGS = { US: '\uD83C\uDDFA\uD83C\uDDF8', GB: '\uD83C\uDDEC\uD83C\uDDE7', NL: '\uD83C\uDDF3\uD83C\uDDF1' };

  var cc = ALL;
  var subs = [];

  function norm(v) {
    var s = String(v == null ? '' : v).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(s) ? s : UNKNOWN;
  }
  function label(code) { return NAMES[code] || code; }

  // ---- market discovery ---------------------------------------------------
  // The picker lists every market that appears ANYWHERE in the loaded data, not a
  // hardcoded list, so launching a third country needs no front-end change at all.
  // Declared markets (__FUNNEL_MARKETS / __PAY_REPORT_MARKETS) come first and in
  // launch order; anything else observed in the data is appended alphabetically, with
  // Unknown always last because it is a data-quality bucket, not a place.
  function markets() {
    var order = [], seen = {};
    function push(code) {
      code = norm(code);
      if (code === UNKNOWN || seen[code]) return;
      seen[code] = 1; order.push(code);
    }
    (window.__FUNNEL_MARKETS || []).forEach(function (m) { push(m && m.cc); });
    (window.__PAY_REPORT_MARKETS || []).forEach(function (m) { push(m && m.cc); });

    var extra = {}, hasUnknown = false;
    function observe(code) {
      code = norm(code);
      if (code === UNKNOWN) { hasUnknown = true; return; }
      if (!seen[code]) extra[code] = 1;
    }
    (window.__ACT || []).forEach(function (r) { observe(r.country); });
    (window.__FUNNEL_MERCHANTS || []).forEach(function (r) { observe(r.cc); });
    (window.__PAY_TXN_MERCHANTS || []).forEach(function (r) { observe(r.country); });
    (window.__PROFILE_MIX || []).forEach(function (r) { observe(r.cc); });
    Object.keys((window.MARGINS && window.MARGINS.byCountry) || {}).forEach(observe);
    Object.keys(window.__FUNNEL_BASES_BY_CC || {}).forEach(observe);

    order = order.concat(Object.keys(extra).sort());
    if (hasUnknown) order.push(UNKNOWN);
    return order;
  }

  // ---- projections --------------------------------------------------------
  // Each returns what the page should DISPLAY for the current selection.

  // {n, by:{CC:n}} -> a count. Used by the daily activation / enabled series.
  function n(row) {
    if (!row) return 0;
    if (cc === ALL) return Number(row.n) || 0;
    return Number((row.by || {})[cc]) || 0;
  }
  // {usd, cnt, by:{CC:{usd,cnt}}} -> {usd, cnt}. Used by the daily volume series.
  function money(row) {
    if (!row) return { usd: 0, cnt: 0 };
    if (cc === ALL) return { usd: Number(row.usd) || 0, cnt: Number(row.cnt) || 0 };
    var s = (row.by || {})[cc];
    return { usd: s ? Number(s.usd) || 0 : 0, cnt: s ? Number(s.cnt) || 0 : 0 };
  }
  // Generic: read `field` from a row, or from that row's country slice.
  // `missing` is what to return when the selected country has no slice — 0 for flows,
  // but null for ratios and for point-in-time values that have no meaningful zero.
  function pick(row, field, missing) {
    if (!row) return missing === undefined ? 0 : missing;
    if (cc === ALL) return row[field];
    var s = (row.by || {})[cc];
    if (!s) return missing === undefined ? 0 : missing;
    return s[field];
  }
  // Whole-row projection: returns the country's slice, or the row itself for "All".
  function slice(row) {
    if (!row) return null;
    if (cc === ALL) return row;
    return (row.by || {})[cc] || null;
  }
  // Row-level predicate for per-merchant tables. Accepts either field name, because
  // the funnel writes `cc` and the account/txn layers write `country`.
  function keep(row) {
    if (cc === ALL) return true;
    if (!row) return false;
    var v = row.cc != null ? row.cc : row.country;
    return norm(v) === cc;
  }
  // Pick a country's entry out of a plain {CC: value} map (bases, group snapshots).
  function fromMap(map, fallback) {
    if (cc === ALL) return fallback === undefined ? null : fallback;
    return (map || {})[cc] || null;
  }

  // ---- the picker ---------------------------------------------------------
  var els = [];
  function optionsHtml() {
    var list = markets();
    var h = '<option value="">All countries</option>';
    for (var i = 0; i < list.length; i++) {
      var code = list[i], flag = FLAGS[code] ? FLAGS[code] + ' ' : '';
      h += '<option value="' + code + '">' + flag + label(code) + '</option>';
    }
    return h;
  }
  // Mount a picker into a container. Safe to call from several pages; each mounted
  // select is kept in sync with the others and with the shared state.
  function mount(container) {
    if (!container) return null;
    var wrap = document.createElement('div');
    wrap.className = 'ccpick';
    var lab = document.createElement('span');
    lab.className = 'ccpick-lbl';
    lab.textContent = 'Country';
    var sel = document.createElement('select');
    sel.className = 'ccpick-sel';
    sel.setAttribute('aria-label', 'Filter by merchant country');
    sel.innerHTML = optionsHtml();
    sel.value = cc;
    sel.addEventListener('change', function () { set(sel.value); });
    wrap.appendChild(lab); wrap.appendChild(sel);
    container.appendChild(wrap);
    els.push(sel);
    return sel;
  }

  // ---- state --------------------------------------------------------------
  function set(v) {
    var next = (v === ALL || v == null || v === '') ? ALL : norm(v);
    if (next === cc) return;
    cc = next;
    els.forEach(function (s) { if (s.value !== cc) s.value = cc; });
    subs.forEach(function (f) { try { f(cc); } catch (e) { console.error('country filter subscriber failed', e); } });
  }
  // Subscribe AND fire immediately, so a page never has to render twice on load: the
  // subscriber is the page's only render path, rather than an extra one bolted beside it.
  function on(f) {
    if (typeof f !== 'function') return;
    subs.push(f);
    try { f(cc); } catch (e) { console.error('country filter subscriber failed', e); }
  }

  // Human-readable suffix for headings and notes, e.g. " — United Kingdom".
  function suffix() { return cc === ALL ? '' : ' \u2014 ' + label(cc); }

  window.LVCC = {
    ALL: ALL, UNKNOWN: UNKNOWN,
    get cc() { return cc; },
    isAll: function () { return cc === ALL; },
    set: set, on: on, mount: mount, markets: markets, label: label,
    norm: norm, suffix: suffix,
    n: n, money: money, pick: pick, slice: slice, keep: keep, fromMap: fromMap
  };
})();
