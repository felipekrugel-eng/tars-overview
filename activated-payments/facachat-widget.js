/* ============================================================================
   FACACHAT — embeddable query widget
   ----------------------------------------------------------------------------
   Floating "Ask FACACHAT" button + panel. Sends the user's question and the
   compact FACACHAT_CATALOG schema (metric names/units/date-ranges only — never
   actual figures) to a small Cloudflare Worker, which asks Claude to translate
   the question into a structured QuerySpec. That QuerySpec is then executed
   locally, in the browser, by FACACHAT_ENGINE against the real dashboard data
   already loaded on the page. No number ever comes from the model — the model
   only ever chooses WHICH series to read.

   Requires (load before this file, in this order):
     facachat-catalog.js, facachat-engine.js

   Configure the worker endpoint before this file loads:
     <script>window.FACACHAT_WORKER_URL = "https://facachat-worker.YOUR-SUBDOMAIN.workers.dev";</script>

   This same file is used on both facadash and activated-payments — it knows
   about both hosts and will lazily cross-load whichever data files aren't
   already present on the current page (so a POS question asked from the
   Payments dashboard, or vice versa, still works when the browser already has
   an active Cloudflare Access session for the other site).
   ========================================================================= */
(function () {
  'use strict';

  var FACADASH_HOST = 'https://facadash.pages.dev';
  var PAYMENTS_HOST = 'https://activated-payments.pages.dev';
  var WORKER_URL = window.FACACHAT_WORKER_URL || '';

  // ---- cross-domain data sources ------------------------------------------
  // One representative global per file is enough to know whether that file
  // is already loaded; loading it brings in whichever other globals it sets.
  var SOURCES = [
    { probe: 'KPI_DATA', file: 'kpi-data.js', host: FACADASH_HOST },
    { probe: 'DAILY_HISTORY', file: 'daily-history.js', host: FACADASH_HOST },
    { probe: 'FLOW_MONTHLY', file: 'flow-data.js', host: FACADASH_HOST },
    { probe: 'DAILY_FLOW', file: 'daily-flow.js', host: FACADASH_HOST },
    { probe: '__PAY_MONTHLY', file: 'report-data.js', host: PAYMENTS_HOST, windowProp: true },
    { probe: '__PAY_VOL_DAILY', file: 'overview-data.js', host: PAYMENTS_HOST, windowProp: true },
    { probe: 'MARGINS', file: 'margins-data.js', host: PAYMENTS_HOST, windowProp: true }
  ];

  // typeof on a bare identifier is the only safe way to detect a top-level
  // `const`/`let` from another classic <script> — const/let never attach to
  // window, so window['NAME'] is always undefined for those even when loaded.
  function probeValue(name) {
    try {
      switch (name) {
        case 'KPI_DATA': return (typeof KPI_DATA !== 'undefined') ? KPI_DATA : undefined;
        case 'DAILY_HISTORY': return (typeof DAILY_HISTORY !== 'undefined') ? DAILY_HISTORY : undefined;
        case 'FLOW_MONTHLY': return (typeof FLOW_MONTHLY !== 'undefined') ? FLOW_MONTHLY : undefined;
        case 'DAILY_FLOW': return (typeof DAILY_FLOW !== 'undefined') ? DAILY_FLOW : undefined;
        case '__PAY_MONTHLY': return window.__PAY_MONTHLY;
        case '__PAY_VOL_DAILY': return window.__PAY_VOL_DAILY;
        case 'MARGINS': return window.MARGINS;
        default: return undefined;
      }
    } catch (e) { return undefined; }
  }

  function loadScript(url, timeoutMs) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(false); } }, timeoutMs || 4000);
      s.src = url;
      s.onload = function () { if (!done) { done = true; clearTimeout(t); resolve(true); } };
      s.onerror = function () { if (!done) { done = true; clearTimeout(t); resolve(false); } };
      document.head.appendChild(s);
    });
  }

  var crossLoadDone = false;
  function ensureAllData() {
    if (crossLoadDone) return Promise.resolve();
    var missing = SOURCES.filter(function (s) { return probeValue(s.probe) === undefined; });
    if (!missing.length) { crossLoadDone = true; return Promise.resolve(); }
    return Promise.all(missing.map(function (s) {
      // Same-host files are relative (already the case for anything the page
      // itself needs); cross-host ones need the absolute URL.
      var sameHost = window.location.origin === s.host;
      var url = sameHost ? s.file : (s.host + '/' + s.file);
      return loadScript(url, 5000);
    })).then(function (results) {
      crossLoadDone = true;
      // facachat-catalog.js / facachat-engine.js each snapshot the data
      // globals once, at the moment they first run. Anything we just loaded
      // arrived AFTER that snapshot, so re-run both (idempotent — they just
      // reassign window.FACACHAT_CATALOG / window.FACACHAT_ENGINE) to pick it up.
      if (results.some(Boolean)) {
        return Promise.all([
          loadScript('facachat-catalog.js?rebuild=' + Date.now(), 4000),
          loadScript('facachat-engine.js?rebuild=' + Date.now(), 4000)
        ]);
      }
    });
  }

  // ---- styles --------------------------------------------------------------
  var CSS = '\n#facachat-fab{position:fixed;right:22px;bottom:22px;z-index:99999;width:56px;height:56px;border-radius:50%;background:#1a1d29;color:#fff;border:none;box-shadow:0 4px 14px rgba(0,0,0,.28);cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center;transition:transform .15s ease}\n#facachat-fab:hover{transform:scale(1.06)}\n#facachat-panel{position:fixed;right:22px;bottom:88px;z-index:99999;width:400px;max-width:92vw;height:560px;max-height:78vh;background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;border:1px solid rgba(0,0,0,.06)}\n#facachat-panel.open{display:flex}\n#facachat-head{background:#1a1d29;color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between}\n#facachat-head b{font-size:14px}\n#facachat-head span{font-size:11px;opacity:.65;display:block;margin-top:1px}\n#facachat-close{background:none;border:none;color:#fff;opacity:.7;font-size:18px;cursor:pointer;line-height:1}\n#facachat-close:hover{opacity:1}\n#facachat-body{flex:1;overflow-y:auto;padding:12px 14px;background:#f7f8fa}\n.facachat-msg{margin-bottom:14px}\n.facachat-q{background:#1D8FE1;color:#fff;padding:8px 12px;border-radius:12px 12px 3px 12px;display:inline-block;max-width:90%;font-size:13px}\n.facachat-a{background:#fff;border:1px solid #eceef1;padding:10px 12px;border-radius:3px 12px 12px 12px;font-size:13px;color:#20232b;line-height:1.45}\n.facachat-a.err{border-color:#f3c9c9;background:#fff6f6;color:#8a2b2b}\n.facachat-title{font-weight:600;margin-bottom:6px;font-size:13px}\n.facachat-warn{color:#a06a00;font-size:11.5px;margin-top:6px}\n.facachat-facts{margin:6px 0 0;padding-left:16px;font-size:12px}\n.facachat-facts li{margin-bottom:3px}\n.facachat-canvaswrap{margin-top:8px;background:#fff;border-radius:8px}\n.facachat-table{width:100%;border-collapse:collapse;margin-top:6px;font-size:11.5px}\n.facachat-table th,.facachat-table td{padding:4px 6px;border-bottom:1px solid #eee;text-align:left}\n.facachat-csv{display:inline-block;margin-top:8px;font-size:11.5px;color:#1D8FE1;text-decoration:none;cursor:pointer}\n.facachat-chip{display:inline-block;background:#eef2f7;border:1px solid #dde3ea;border-radius:14px;padding:5px 10px;font-size:11.5px;margin:0 6px 6px 0;cursor:pointer;color:#334}\n.facachat-chip:hover{background:#e2e8f0}\n#facachat-foot{padding:10px;border-top:1px solid #eceef1;background:#fff;display:flex;gap:6px}\n#facachat-input{flex:1;border:1px solid #dde1e6;border-radius:20px;padding:9px 14px;font-size:13px;outline:none}\n#facachat-input:focus{border-color:#1D8FE1}\n#facachat-send{background:#1D8FE1;color:#fff;border:none;border-radius:20px;padding:0 16px;font-size:13px;cursor:pointer}\n#facachat-send:disabled{opacity:.5;cursor:default}\n.facachat-fresh{font-size:10px;color:#8a93a3;padding:6px 14px 10px;background:#f7f8fa}\n.facachat-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#1D8FE1;margin:0 2px;animation:facachat-b 1s infinite}\n.facachat-dot:nth-child(2){animation-delay:.15s}.facachat-dot:nth-child(3){animation-delay:.3s}\n@keyframes facachat-b{0%,80%,100%{opacity:.25}40%{opacity:1}}\n';

  function injectStyles() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---- DOM scaffold ----------------------------------------------------------
  var els = {};
  function buildDom() {
    var fab = document.createElement('button');
    fab.id = 'facachat-fab';
    fab.title = 'Ask FACACHAT';
    fab.innerHTML = '&#128172;';

    var panel = document.createElement('div');
    panel.id = 'facachat-panel';
    panel.innerHTML =
      '<div id="facachat-head"><div><b>FACACHAT</b><span>Ask about Loyverse POS &amp; Payments</span></div>' +
      '<button id="facachat-close">&times;</button></div>' +
      '<div id="facachat-body"></div>' +
      '<div class="facachat-fresh" id="facachat-fresh"></div>' +
      '<div id="facachat-foot">' +
      '<input id="facachat-input" type="text" placeholder="e.g. TPV growth this year" autocomplete="off" />' +
      '<button id="facachat-send">Ask</button></div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    els.fab = fab; els.panel = panel;
    els.body = panel.querySelector('#facachat-body');
    els.input = panel.querySelector('#facachat-input');
    els.send = panel.querySelector('#facachat-send');
    els.close = panel.querySelector('#facachat-close');
    els.fresh = panel.querySelector('#facachat-fresh');

    fab.addEventListener('click', function () { openPanel(); });
    els.close.addEventListener('click', function () { panel.classList.remove('open'); });
    els.send.addEventListener('click', function () { submit(); });
    els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  var opened = false;
  function openPanel() {
    els.panel.classList.add('open');
    if (!opened) {
      opened = true;
      showWelcome();
      els.input.focus();
    }
  }

  function fmtFreshness() {
    ensureAllData().then(function () {
      var CAT = window.FACACHAT_CATALOG;
      if (!CAT) return;
      var f = CAT.freshness();
      var bits = [];
      if (f.posGeneratedAt) bits.push('POS data as of ' + f.posGeneratedAt);
      if (f.paymentsUpdated) bits.push('Payments as of ' + f.paymentsUpdated);
      els.fresh.textContent = bits.join(' · ') || '';
    });
  }

  var EXAMPLES = [
    'TPV growth over the last 6 months',
    'New registrations in the US, last 6 months',
    'Top 10 countries by active merchants',
    'MRR trend this year',
    'Payments take rate by month'
  ];

  function showWelcome() {
    var wrap = document.createElement('div');
    wrap.className = 'facachat-msg';
    var chips = EXAMPLES.map(function (e) {
      return '<span class="facachat-chip" data-q="' + e.replace(/"/g, '&quot;') + '">' + e + '</span>';
    }).join('');
    wrap.innerHTML = '<div class="facachat-a">Ask me things like TPV growth, new registrations by country, MRR trend, or top merchants. I only answer from the same numbers already on this dashboard — I\'ll tell you plainly if something isn\'t tracked yet.<div style="margin-top:8px">' + chips + '</div></div>';
    els.body.appendChild(wrap);
    Array.prototype.forEach.call(wrap.querySelectorAll('.facachat-chip'), function (chip) {
      chip.addEventListener('click', function () { els.input.value = chip.getAttribute('data-q'); submit(); });
    });
    fmtFreshness();
  }

  // ---- conversation state ----------------------------------------------------
  var history = []; // [{role, content}]

  function addUserBubble(text) {
    var d = document.createElement('div');
    d.className = 'facachat-msg';
    d.style.textAlign = 'right';
    d.innerHTML = '<div class="facachat-q"></div>';
    d.firstChild.textContent = text;
    els.body.appendChild(d);
    els.body.scrollTop = els.body.scrollHeight;
  }

  function addThinking() {
    var d = document.createElement('div');
    d.className = 'facachat-msg';
    d.id = 'facachat-thinking';
    d.innerHTML = '<div class="facachat-a"><span class="facachat-dot"></span><span class="facachat-dot"></span><span class="facachat-dot"></span></div>';
    els.body.appendChild(d);
    els.body.scrollTop = els.body.scrollHeight;
    return d;
  }

  var chartInstances = [];
  function destroyCharts() {
    chartInstances.forEach(function (c) { try { c.destroy(); } catch (e) {} });
    chartInstances = [];
  }

  function addAnswer(result, question) {
    var ENG = window.FACACHAT_ENGINE;
    var d = document.createElement('div');
    d.className = 'facachat-msg';
    var a = document.createElement('div');
    a.className = 'facachat-a';

    if (!result.ok) {
      a.classList.add('err');
      a.textContent = result.error || 'Something went wrong answering that.';
      d.appendChild(a); els.body.appendChild(d); els.body.scrollTop = els.body.scrollHeight;
      return;
    }
    if (result.kind === 'clarify') {
      a.innerHTML = '<div class="facachat-title">' + escapeHtml(result.question) + '</div>';
      (result.options || []).forEach(function (opt) {
        var chip = document.createElement('span');
        chip.className = 'facachat-chip';
        chip.textContent = opt;
        chip.addEventListener('click', function () { els.input.value = opt; submit(); });
        a.appendChild(chip);
      });
      d.appendChild(a); els.body.appendChild(d); els.body.scrollTop = els.body.scrollHeight;
      return;
    }

    var titleHtml = '<div class="facachat-title">' + escapeHtml(result.title || question) + '</div>';
    var narrative = ENG.narrate(result, question);
    a.innerHTML = titleHtml + '<div>' + escapeHtml(narrative) + '</div>';

    if (result.chart && result.chart.datasets && result.chart.datasets.length && window.Chart) {
      var wrap = document.createElement('div');
      wrap.className = 'facachat-canvaswrap';
      var canvas = document.createElement('canvas');
      canvas.height = 190;
      wrap.appendChild(canvas);
      a.appendChild(wrap);
      var chartData = {
        labels: result.chart.labels,
        datasets: result.chart.datasets
      };
      var scales = { y: { beginAtZero: false } };
      if (result.dualAxis) {
        scales.y = { position: 'left', title: { display: true, text: result.dualAxis.y } };
        scales.y1 = { position: 'right', title: { display: true, text: result.dualAxis.y1 }, grid: { drawOnChartArea: false } };
      }
      setTimeout(function () {
        try {
          var chart = new window.Chart(canvas.getContext('2d'), {
            type: result.chart.type,
            data: chartData,
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: chartData.datasets.length > 1, labels: { boxWidth: 10, font: { size: 10 } } } },
              scales: (result.chart.type === 'bar' && result.chart.indexAxis === 'y') ? {} : scales,
              indexAxis: result.chart.indexAxis || 'x'
            }
          });
          canvas.parentNode.style.height = '190px';
          chartInstances.push(chart);
        } catch (e) { /* chart render is best-effort */ }
      }, 0);
    }

    if (result.facts && result.facts.length > 1) {
      var ul = document.createElement('ul');
      ul.className = 'facachat-facts';
      result.facts.forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = f.series + ': ' + f.last + (f.total ? ' · total ' + f.total : '');
        ul.appendChild(li);
      });
      a.appendChild(ul);
    }

    if ((result.kind === 'table' || result.kind === 'ranking') && result.rows && result.rows.length) {
      var table = document.createElement('table');
      table.className = 'facachat-table';
      var thead = '<thead><tr>' + result.columns.map(function (c) { return '<th>' + escapeHtml(String(c)) + '</th>'; }).join('') + '</tr></thead>';
      var tbody = '<tbody>' + result.rows.slice(0, 25).map(function (r) {
        return '<tr>' + result.columns.map(function (c) { return '<td>' + escapeHtml(String(r[c] === undefined ? '' : r[c])) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
      table.innerHTML = thead + tbody;
      a.appendChild(table);
    }

    if (result.warnings && result.warnings.length) {
      var w = document.createElement('div');
      w.className = 'facachat-warn';
      w.textContent = result.warnings.join(' ');
      a.appendChild(w);
    }

    if (result.csv) {
      var link = document.createElement('a');
      link.className = 'facachat-csv';
      link.textContent = 'Download CSV';
      link.href = '#';
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var blob = new Blob([result.csv], { type: 'text/csv' });
        var url = URL.createObjectURL(blob);
        var t = document.createElement('a');
        t.href = url; t.download = (result.title || 'facachat').replace(/[^a-z0-9]+/gi, '_') + '.csv';
        document.body.appendChild(t); t.click(); document.body.removeChild(t);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      });
      a.appendChild(link);
    }

    d.appendChild(a);
    els.body.appendChild(d);
    els.body.scrollTop = els.body.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var busy = false;
  function submit() {
    var q = (els.input.value || '').trim();
    if (!q || busy) return;
    if (!WORKER_URL) {
      addUserBubble(q);
      var d = document.createElement('div'); d.className = 'facachat-msg';
      d.innerHTML = '<div class="facachat-a err">FACACHAT isn\'t configured yet — window.FACACHAT_WORKER_URL is not set on this page.</div>';
      els.body.appendChild(d);
      els.input.value = '';
      return;
    }
    els.input.value = '';
    addUserBubble(q);
    busy = true; els.send.disabled = true;
    var thinking = addThinking();

    ensureAllData().then(function () {
      var CAT = window.FACACHAT_CATALOG, ENG = window.FACACHAT_ENGINE;
      var catalog = CAT.compact();
      return fetch(WORKER_URL.replace(/\/$/, '') + '/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, catalog: catalog, history: history.slice(-6) })
      }).then(function (r) { return r.json(); }).then(function (resp) {
        thinking.remove();
        destroyCharts();
        if (!resp.ok) {
          addAnswer({ ok: false, error: resp.error || 'The query service returned an error.' }, q);
          return;
        }
        var result = ENG.run(resp.spec);
        addAnswer(result, q);
        history.push({ role: 'user', content: q });
        if (result.ok && result.kind !== 'clarify') {
          history.push({ role: 'assistant', content: ENG.narrate(result, q) || (result.title || '') });
        }
      });
    }).catch(function (err) {
      thinking.remove();
      addAnswer({ ok: false, error: 'Network error talking to FACACHAT: ' + (err && err.message ? err.message : err) }, q);
    }).then(function () {
      busy = false; els.send.disabled = false;
    });
  }

  function init() {
    if (document.getElementById('facachat-fab')) return; // already initialised
    injectStyles();
    buildDom();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
