/* Payments sub-navigation — one definition, rendered by every Payments page.
 *
 * The bar used to be hand-written in four documents (index, profile, report,
 * risk-health) and had drifted: Cohorts existed only on index, Fraud Health was
 * bolted on at runtime by country-filter.js, and risk-health still advertised a
 * Pilot tab that had been removed. Tabs therefore appeared and disappeared as you
 * moved between pages. This file is now the only place the bar is defined.
 *
 * Usage, in each page:
 *   <div class="paysub" id="paysub" data-paysub="overview" data-paysub-mode="inline"></div>
 *   ...
 *   <script src="paysub.js"></script>        <!-- AFTER country-filter.js -->
 *
 *   data-paysub       key of the item that starts active ('' for none)
 *   data-paysub-mode  "inline" on index.html, where the first four items are
 *                     in-page tabs addressed by hash. Omitted on the standalone
 *                     pages, where those four link back into index.html.
 *
 * index.html keeps driving the active item as its hash changes, by toggling the
 * `on` class on #paysub-overview / -margins / -funnel / -cohorts. The ids below
 * are what that code expects, so they must not change.
 */
(function () {
  var ITEMS = [
    { key: 'overview',    label: 'Overview',           hash: '#payments' },
    { key: 'margins',     label: 'Summary of Margins', hash: '#margins' },
    { key: 'funnel',      label: 'Funnel',             hash: '#funnel' },
    { key: 'cohorts',     label: 'Cohorts',            hash: '#cohorts' },
    { key: 'profile',     label: 'Payment Profile',    page: 'profile.html' },
    { key: 'risk-health', label: 'Fraud Health',       page: 'risk-health.html' },
    { key: 'report',      label: 'Report',             page: 'report.html' }
  ];

  // Seven tabs plus the country picker need ~940px. Rather than clip the right-hand
  // end silently — which is how the picker used to vanish on a narrow window — let
  // the bar wrap onto a second line. Injected here so all four pages get it from the
  // one place, whatever their own stylesheet says.
  function ensureStyle() {
    if (document.getElementById('paysub-style')) return;
    var s = document.createElement('style');
    s.id = 'paysub-style';
    s.textContent =
      '.paysub{flex-wrap:wrap;overflow-x:visible;}' +
      '.paysub a{white-space:nowrap;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function render(nav) {
    var inline = nav.getAttribute('data-paysub-mode') === 'inline';
    var active = nav.getAttribute('data-paysub') || '';
    var html = '';
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      var href = it.page ? it.page : (inline ? it.hash : 'index.html' + it.hash);
      html += '<a id="paysub-' + it.key + '"' +
              (it.key === active ? ' class="on"' : '') +
              ' href="' + href + '">' + it.label + '</a>';
    }
    nav.innerHTML = html;
    // The country picker lives at the right-hand end of the bar. Mounted here, after
    // the links, because rendering replaces the bar's contents — a picker mounted by
    // the page beforehand would be thrown away.
    if (window.LVCC && window.LVCC.mount) window.LVCC.mount(nav);
  }

  function init() {
    ensureStyle();
    var navs = document.querySelectorAll('.paysub');
    for (var i = 0; i < navs.length; i++) render(navs[i]);
    return navs.length;
  }

  // Render as early as the bar exists, not merely at DOMContentLoaded: index.html sets
  // the active tab from the hash in an inline script further down the body, and that has
  // to find the links already there. On index.html this script sits below the bar, so the
  // first call does the work; on the standalone pages it is in <head>, so it falls through
  // to DOMContentLoaded.
  if (!init()) {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
