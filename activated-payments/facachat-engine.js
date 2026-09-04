/* ============================================================================
   FACACHAT — QUERY ENGINE
   ----------------------------------------------------------------------------
   Executes a validated QuerySpec against the semantic layer. Fully
   deterministic: the same spec always produces the same numbers, and those
   numbers come from the same arrays the dashboard tiles read. No model output
   ever becomes a number here — the model only chooses WHICH series to read.

   QuerySpec
   ---------
   {
     kind:      'series' | 'value' | 'ranking' | 'table' | 'clarify' | 'unsupported'
     title:     string
     grain:     'month' | 'day'
     metrics:   [ { metric:'payments.tpv', country:'US'|null, label?:string } ]
     range:     { from:'YYYY-MM[-DD]', to:'YYYY-MM[-DD]' }
               | { last:{ n:6, unit:'month'|'day'|'year' } }
               | { all:true }
     transform: 'none'|'cumulative'|'mom_pct'|'yoy_pct'|'index100'|'delta'|'rolling_avg'
     window:    number            // for rolling_avg
     compare:   null|'prev_period'|'prev_year'
     chart:     'line'|'bar'|'area'|'stacked_bar'|'none'
     agg:       'auto'|'sum'|'avg'|'last'|'min'|'max'   // for kind:'value'
     ranking:   { extra:'country_snapshot', field:'reg', period:'current',
                  n:10, direction:'desc' }
     table:     { extra:'cohorts', fields:[...], n:20, sortBy:'mrr', direction:'desc' }
     runRate:   boolean   // ask for the CURRENT, still-in-progress period's
                          // actual-so-far scaled up to a full period (e.g.
                          // "September TPV so far, considering the run rate").
                          // Different from `project`, which extrapolates into
                          // FUTURE periods that haven't started yet. Forces
                          // grain='month'. Works even for a single-period
                          // value question (normally the current partial
                          // period is only excluded from stats/trend when
                          // there is other history to fall back on).
     notes:     string
   }

   Result
   ------
   { ok, kind, title, subtitle, grain, series:[{id,label,unit,basis,points:[{t,v}]}],
     stats:{...}, chart:{type,labels,datasets}, rows, columns, csv, facts, warnings }
   ========================================================================= */
(function (global) {
  'use strict';

  var CAT = global.FACACHAT_CATALOG;

  /* ------------------------------------------------------------ date helpers */

  function isDay(t) { return /^\d{4}-\d{2}-\d{2}$/.test(t); }
  function monthOf(t) { return String(t).slice(0, 7); }

  function addMonths(m, n) {
    var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + n;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + String(mo + 1).padStart(2, '0');
  }
  function addDays(d, n) {
    var dt = new Date(d + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  function monthsBetween(a, b) {
    return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }

  /* --------------------------------------------------------- series plumbing */

  function seriesFor(ref, grain) {
    var m = CAT.get(ref.metric);
    if (!m) return { error: 'Unknown metric "' + ref.metric + '".' };
    if (m.unavailable) return { error: m.desc };

    var cc = ref.country ? CAT.resolveCountry(ref.country) : null;
    if (ref.country && !cc) return { error: 'I could not match the country "' + ref.country + '" to a country code.' };

    var warnings = [];
    var pts = null;

    if (cc) {
      var fn = grain === 'day' ? m.dailyByCountry : m.monthlyByCountry;
      if (!fn) {
        // Fall back to the 2-month all-country snapshot if the metric has one.
        if (grain === 'month' && m.funnelField && CAT.extras.country_snapshot) {
          var snap = CAT.extras.country_snapshot, row = null;
          snap.rows().forEach(function (r) { if (r.c === cc) row = r; });
          if (row) {
            pts = [
              { t: snap.months.previous, v: row[m.funnelField + 'P'] != null ? row[m.funnelField + 'P'] : null },
              { t: snap.months.current, v: row[m.funnelField] != null ? row[m.funnelField] : null }
            ];
            warnings.push('Only the current and previous month are available per country for ' + m.label.toLowerCase() + ' in ' + CAT.countryLabel(cc) + '.');
          }
        }
        if (!pts) return { error: m.label + ' is not broken down by country at ' + grain + ' grain.' };
      } else {
        pts = fn(cc);
        if (!pts.length && grain === 'month' && m.funnelField && CAT.extras.country_snapshot) {
          var s2 = CAT.extras.country_snapshot, r2 = null;
          s2.rows().forEach(function (r) { if (r.c === cc) r2 = r; });
          if (r2) {
            pts = [
              { t: s2.months.previous, v: r2[m.funnelField + 'P'] },
              { t: s2.months.current, v: r2[m.funnelField] }
            ];
            warnings.push(CAT.countryLabel(cc) + ' is outside the long-history country set, so only the last two months are available.');
          }
        }
      }
    } else {
      var fn2 = grain === 'day' ? m.daily : m.monthly;
      if (!fn2) return { error: m.label + ' is not available at ' + grain + ' grain. Available: ' + (CAT.grainsFor(ref.metric).join(', ') || 'none') + '.' };
      pts = fn2();
    }

    if (!pts || !pts.length) return { error: 'No data points for ' + m.label + (cc ? ' in ' + CAT.countryLabel(cc) : '') + ' at ' + grain + ' grain.' };

    if (grain === 'day' && m.dailyNote) warnings.push(m.label + ' — ' + m.dailyNote);
    if (m.note) warnings.push(m.label + ' — ' + m.note);

    return {
      id: ref.metric + (cc ? '|' + cc : ''),
      metric: ref.metric,
      country: cc,
      label: ref.label || (m.short || m.label) + (cc ? ' — ' + CAT.countryLabel(cc) : ''),
      unit: m.unit, basis: m.basis, domain: m.domain,
      fullLabel: m.label + (cc ? ' — ' + CAT.countryLabel(cc) : ''),
      points: pts.slice(),
      warnings: warnings
    };
  }

  /* ----------------------------------------------------------- range solving */

  function resolveRange(range, grain, allSeries) {
    // Widest extent across the requested series, so "last 6 months" means the
    // last 6 months that actually have data, not 6 months of empty axis.
    var lo = null, hi = null;
    allSeries.forEach(function (s) {
      s.points.forEach(function (p) {
        if (p.v === null) return;
        if (lo === null || p.t < lo) lo = p.t;
        if (hi === null || p.t > hi) hi = p.t;
      });
    });
    if (lo === null) return { from: null, to: null };
    if (!range || range.all) return { from: lo, to: hi };

    if (range.last && range.last.n) {
      var n = Math.max(1, Math.round(range.last.n));
      var unit = range.last.unit || grain;
      var from;
      if (grain === 'month') {
        var months = unit === 'year' ? n * 12 : n;
        from = addMonths(monthOf(hi), -(months - 1));
      } else {
        var days = unit === 'year' ? n * 365 : unit === 'month' ? n * 30 : n;
        from = addDays(hi.length === 7 ? hi + '-01' : hi, -(days - 1));
      }
      return { from: from < lo ? lo : from, to: hi, clampedFrom: from < lo };
    }

    var f = range.from || lo, t = range.to || hi;
    // Tolerate a month given for a daily query and vice versa.
    if (grain === 'day' && f.length === 7) f = f + '-01';
    if (grain === 'day' && t.length === 7) t = endOfMonth(t);
    if (grain === 'month' && f.length === 10) f = monthOf(f);
    if (grain === 'month' && t.length === 10) t = monthOf(t);
    var clampedFrom = f < lo, clampedTo = t > hi;
    return { from: f < lo ? lo : f, to: t > hi ? hi : t, clampedFrom: clampedFrom, clampedTo: clampedTo };
  }

  function endOfMonth(m) {
    var y = +m.slice(0, 4), mo = +m.slice(5, 7);
    var d = new Date(Date.UTC(y, mo, 0));
    return d.toISOString().slice(0, 10);
  }

  function clip(points, from, to) {
    if (!from) return points.slice();
    return points.filter(function (p) { return p.t >= from && p.t <= to; });
  }

  /* -------------------------------------------------------------- transforms */

  function applyTransform(points, transform, basis, window_) {
    var v = points.map(function (p) { return p.v; });
    var out;
    switch (transform) {
      case 'cumulative': {
        var run = 0; out = v.map(function (x) { if (x === null) return null; run += x; return run; });
        break;
      }
      case 'delta':
        out = v.map(function (x, i) { return (i === 0 || x === null || v[i - 1] === null) ? null : x - v[i - 1]; });
        break;
      case 'mom_pct':
        out = v.map(function (x, i) {
          if (i === 0 || x === null || v[i - 1] === null || v[i - 1] === 0) return null;
          return ((x - v[i - 1]) / Math.abs(v[i - 1])) * 100;
        });
        break;
      case 'yoy_pct': {
        var lag = 12;
        out = v.map(function (x, i) {
          var p = v[i - lag];
          if (i < lag || x === null || p === null || p === 0) return null;
          return ((x - p) / Math.abs(p)) * 100;
        });
        break;
      }
      case 'index100': {
        var base = null;
        for (var i = 0; i < v.length; i++) if (v[i] !== null && v[i] !== 0) { base = v[i]; break; }
        out = v.map(function (x) { return (x === null || base === null) ? null : (x / base) * 100; });
        break;
      }
      case 'rolling_avg': {
        var w = Math.max(2, Math.round(window_ || 7));
        out = v.map(function (_, i) {
          if (i < w - 1) return null;
          var s = 0, c = 0;
          for (var j = i - w + 1; j <= i; j++) if (v[j] !== null) { s += v[j]; c++; }
          return c === w ? s / c : null;
        });
        break;
      }
      default:
        return { points: points.slice(), unitOverride: null };
    }
    var pts = points.map(function (p, i) { return { t: p.t, v: out[i] }; });
    var unitOverride = (transform === 'mom_pct' || transform === 'yoy_pct') ? 'pct'
      : transform === 'index100' ? 'index' : null;
    return { points: pts, unitOverride: unitOverride };
  }

  /* ------------------------------------------------------------------- stats */

  function summarise(pts, unit, basis) {
    var nn = pts.filter(function (p) { return p.v !== null; });
    if (!nn.length) return null;
    var vals = nn.map(function (p) { return p.v; });
    var sum = vals.reduce(function (a, b) { return a + b; }, 0);
    var first = nn[0], last = nn[nn.length - 1];
    var min = nn[0], max = nn[0];
    nn.forEach(function (p) { if (p.v < min.v) min = p; if (p.v > max.v) max = p; });
    var change = last.v - first.v;
    var pct = (first.v !== 0) ? (change / Math.abs(first.v)) * 100 : null;
    var s = {
      n: nn.length, first: first, last: last, min: min, max: max,
      sum: sum, avg: sum / nn.length, change: change, changePct: pct,
      // The headline number for a "how many / how much" question depends on basis.
      headline: (basis === 'flow') ? sum : last.v,
      headlineKind: (basis === 'flow') ? 'sum' : 'last'
    };
    if (nn.length >= 3 && first.v > 0 && last.v > 0) {
      var periods = nn.length - 1;
      s.cagrPerPeriod = (Math.pow(last.v / first.v, 1 / periods) - 1) * 100;
    }
    return s;
  }

  /* ------------------------------------------------------------- formatting */

  function fmt(v, unit) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (unit === 'usd') {
      var a = Math.abs(v);
      if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'bn';
      if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'm';
      if (a >= 10000) return '$' + Math.round(v).toLocaleString('en-US');
      return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (unit === 'pct') return (v >= 0 ? '' : '') + v.toFixed(2) + '%';
    if (unit === 'index') return v.toFixed(1);
    var ab = Math.abs(v);
    if (ab >= 1e9) return (v / 1e9).toFixed(2) + 'bn';
    if (ab >= 1e6) return (v / 1e6).toFixed(2) + 'm';
    if (ab % 1 !== 0) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return Math.round(v).toLocaleString('en-US');
  }

  function prettyPeriod(t) {
    if (isDay(t)) {
      var d = new Date(t + 'T00:00:00Z');
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
    var y = t.slice(0, 4), m = +t.slice(5, 7);
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + y;
  }

  /* ------------------------------------------------------------- chart build */

  var PALETTE = ['#1D8FE1', '#E8A317', '#1F9D6B', '#D2495B', '#7E5BD6', '#0FA3B1', '#B25E00', '#5B6B7E'];

  function buildChart(spec, out) {
    var type = spec.chart || 'line';
    if (type === 'none' || !out.series.length) return null;
    var labels = out.axis.map(prettyPeriod);
    var cjsType = (type === 'bar' || type === 'stacked_bar') ? 'bar' : 'line';
    var datasets = out.series.map(function (s, i) {
      var c = PALETTE[i % PALETTE.length];
      var ds = {
        label: s.label,
        data: out.axis.map(function (t) { var p = s.byT[t]; return p === undefined ? null : p; }),
        borderColor: c,
        backgroundColor: (type === 'area') ? c + '22' : (cjsType === 'bar' ? c : c),
        borderWidth: 2, pointRadius: out.axis.length > 45 ? 0 : 2.5, pointHoverRadius: 4,
        tension: 0.25, spanGaps: true, fill: type === 'area',
        yAxisID: s.axisId || 'y'
      };
      if (s.dashed) ds.borderDash = [5, 4];
      return ds;
    });
    return {
      type: cjsType,
      stacked: type === 'stacked_bar',
      labels: labels,
      datasets: datasets,
      units: out.series.map(function (s) { return s.unit; })
    };
  }

  /* ------------------------------------------------------------------ facts */

  function buildFacts(out) {
    var facts = [];
    out.series.forEach(function (s) {
      if (!s.stats) return;
      var u = s.unit, st = s.stats;
      var f = {
        series: s.label,
        unit: u,
        first: prettyPeriod(st.first.t) + ' = ' + fmt(st.first.v, u),
        last: prettyPeriod(st.last.t) + ' = ' + fmt(st.last.v, u),
        peak: prettyPeriod(st.max.t) + ' = ' + fmt(st.max.v, u),
        trough: prettyPeriod(st.min.t) + ' = ' + fmt(st.min.v, u),
        change: fmt(st.change, u) + (st.changePct === null ? '' : ' (' + (st.changePct >= 0 ? '+' : '') + st.changePct.toFixed(1) + '%)'),
        total: (s.basis === 'flow') ? fmt(st.sum, u) : null,
        average: fmt(st.avg, u)
      };
      if (st.cagrPerPeriod !== undefined) {
        f.avgGrowthPerPeriod = (st.cagrPerPeriod >= 0 ? '+' : '') + st.cagrPerPeriod.toFixed(2) + '% per ' + out.grain;
      }
      facts.push(f);
    });
    return facts;
  }

  /* -------------------------------------------------------------------- CSV */

  function toCSV(columns, rows) {
    var esc = function (v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [columns.map(esc).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return esc(r[c]); }).join(',')); });
    return lines.join('\n');
  }

  /* =========================================================== run a series */

  function runSeries(spec) {
    var warnings = [], grain = spec.grain === 'day' ? 'day' : 'month';
    var refs = (spec.metrics || []).slice(0, 6);
    if (!refs.length) return { ok: false, error: 'The query did not name a metric.' };

    var built = [], errors = [];
    refs.forEach(function (r) {
      var s = seriesFor(r, grain);
      if (s.error) {
        // If the metric only exists at the other grain, retry there rather than fail.
        var alt = grain === 'day' ? 'month' : 'day';
        var s2 = seriesFor(r, alt);
        if (!s2.error) {
          warnings.push(s.error + ' Answered at ' + alt + ' grain instead.');
          grain = alt; built.push(s2); return;
        }
        errors.push(s.error);
      } else built.push(s);
    });
    if (!built.length) return { ok: false, error: errors.join(' ') || 'No series could be resolved.' };
    built.forEach(function (s) { s.warnings.forEach(function (w) { if (warnings.indexOf(w) < 0) warnings.push(w); }); });
    errors.forEach(function (e) { if (warnings.indexOf(e) < 0) warnings.push(e); });

    var range = resolveRange(spec.range, grain, built);
    if (range.clampedFrom) warnings.push('The requested start is before the data begins, so the chart starts at ' + prettyPeriod(range.from) + '.');
    if (range.clampedTo) warnings.push('The requested end is after the latest data, so the chart ends at ' + prettyPeriod(range.to) + '.');

    var transform = spec.transform || 'none';
    var out = { grain: grain, series: [], axis: [], range: range };
    var axisSet = {};
    var partialMonthById = {};

    built.forEach(function (s) {
      var pts = clip(s.points, range.from, range.to);

      // Current-month partial-data guard: if the most recent point is the
      // real, still-in-progress calendar month, its value is just
      // accumulated-so-far (see mtdToMonthly's "last non-null reading of the
      // month" logic), not a finished total. Charted or narrated next to
      // complete historical months, that produces a misleading cliff-drop
      // and a false "down X%" change. For plain (transform:'none') monthly
      // flow metrics, exclude it from the "real" points/stats here — but
      // only when there's other history left to show, so a query
      // specifically about this one current month (e.g. "registrations this
      // month so far") is left untouched UNLESS the user explicitly asked
      // for the run-rate (spec.runRate), in which case a single-point
      // current-month query is exactly the case this exists to serve — the
      // "actual" point is still excluded from stats and a run-rate estimate
      // takes its place below. A dashed run-rate estimate is always added
      // back as a separate overlay point.
      if (transform === 'none' && grain === 'month' && s.basis === 'flow' &&
          (pts.length > 1 || spec.runRate)) {
        var lastP = pts[pts.length - 1];
        var curMonth = new Date().toISOString().slice(0, 7);
        if (lastP && lastP.t === curMonth && lastP.v !== null) {
          var dayOfMonth = new Date().getUTCDate();
          var daysInMonth = +endOfMonth(curMonth).slice(8, 10);
          if (dayOfMonth < daysInMonth) {
            partialMonthById[s.id] = {
              t: lastP.t, actual: lastP.v, dayOfMonth: dayOfMonth, daysInMonth: daysInMonth,
              runRate: lastP.v * (daysInMonth / dayOfMonth),
              prevPoint: pts[pts.length - 2] || null
            };
            pts = pts.slice(0, pts.length - 1);
          }
        }
      }

      // yoy_pct and rolling_avg need lead-in points from before the window.
      if (transform === 'yoy_pct' || transform === 'rolling_avg') {
        var lead = transform === 'yoy_pct' ? (grain === 'month' ? 12 : 365) : (spec.window || 7);
        var startIdx = s.points.findIndex(function (p) { return p.t >= range.from; });
        var from = Math.max(0, (startIdx < 0 ? 0 : startIdx) - lead);
        var extended = s.points.slice(from).filter(function (p) { return p.t <= range.to; });
        var tr = applyTransform(extended, transform, s.basis, spec.window);
        pts = tr.points.filter(function (p) { return p.t >= range.from; });
        s.unitOverride = tr.unitOverride;
      } else {
        var tr2 = applyTransform(pts, transform, s.basis, spec.window);
        pts = tr2.points;
        s.unitOverride = tr2.unitOverride;
      }
      var unit = s.unitOverride || s.unit;
      var byT = {};
      pts.forEach(function (p) { byT[p.t] = p.v; axisSet[p.t] = 1; });
      out.series.push({
        id: s.id, metric: s.metric, country: s.country, label: s.label, fullLabel: s.fullLabel,
        unit: unit, basis: (transform === 'none' ? s.basis : (transform === 'cumulative' ? 'stock' : 'ratio')),
        domain: s.domain, points: pts, byT: byT,
        stats: summarise(pts, unit, transform === 'none' ? s.basis : 'ratio')
      });
    });

    // Current-month run-rate overlay: add the excluded partial month back as
    // a single dashed, clearly-labelled estimate (actual-so-far scaled up to
    // a full month at the same pace) rather than silently dropping it — same
    // dashed/projected rendering path as the trend-projection and
    // prev_period/prev_year overlays (buildChart() already renders any
    // series with dashed:true as a dashed line, no widget changes needed).
    (function () {
      var runRateOverlays = [];
      out.series.slice().forEach(function (s) {
        var pm = partialMonthById[s.id];
        if (!pm) return;
        var pts3 = pm.prevPoint ? [{ t: pm.prevPoint.t, v: pm.prevPoint.v }] : [];
        pts3.push({ t: pm.t, v: pm.runRate, projected: true });
        var byT3 = {};
        pts3.forEach(function (p) { byT3[p.t] = p.v; axisSet[p.t] = 1; });
        runRateOverlays.push({
          id: s.id + '|runrate', metric: s.metric, country: s.country,
          label: s.label + ' (run-rate est.)',
          fullLabel: s.fullLabel + ' — ' + prettyPeriod(pm.t) + ' run-rate estimate',
          unit: s.unit, basis: s.basis, domain: s.domain,
          points: pts3, byT: byT3, dashed: true, projected: true,
          stats: null, comparisonOf: s.id,
          runRateMeta: { actual: pm.actual, dayOfMonth: pm.dayOfMonth, daysInMonth: pm.daysInMonth, estimate: pm.runRate }
        });
        warnings.push(prettyPeriod(pm.t) + ' is still in progress (day ' + pm.dayOfMonth + ' of ' + pm.daysInMonth +
          ') for ' + s.label + ', so its actual-so-far (' + fmt(pm.actual, s.unit) + ') is excluded from the totals/' +
          'trend/change above to avoid a false drop. At the current pace that projects to roughly ' +
          fmt(pm.runRate, s.unit) + ' for the full month (the dashed chart point) — a run-rate estimate, not a final reported figure.');
      });
      if (runRateOverlays.length) out.series = out.series.concat(runRateOverlays);
    })();

    // Trend projection ("if this continues, what will X be in N months").
    // Fully deterministic and computed here from the already-clipped/transformed
    // historical points — the model only ever asks for a projection, it never
    // supplies or sees the projected numbers themselves. Rendered as a dashed
    // continuation of each series (same visual mechanism as the prev_period/
    // prev_year comparison overlay below) and always paired with a warning
    // that it is a model estimate, not a reported figure.
    if (spec.project && spec.project.n) {
      var projN = spec.project.n;
      var projMethod = spec.project.method === 'linear' ? 'linear' : 'cagr';
      var forecasts = [];
      out.series.slice().forEach(function (s) {
        var nn = s.points.filter(function (p) { return p.v !== null; });
        if (nn.length < 2) { warnings.push('Not enough history to project ' + s.label + '.'); return; }
        var last = nn[nn.length - 1];
        var futureTs = [];
        var t = last.t;
        for (var k = 0; k < projN; k++) {
          t = (grain === 'day') ? addDays(t, 1) : addMonths(t, 1);
          futureTs.push(t);
        }
        var futureVals;
        if (projMethod === 'linear') {
          var xs = nn.map(function (_, i) { return i; });
          var ys = nn.map(function (p) { return p.v; });
          var nCount = xs.length;
          var sx = xs.reduce(function (a, b) { return a + b; }, 0);
          var sy = ys.reduce(function (a, b) { return a + b; }, 0);
          var sxx = xs.reduce(function (a, x) { return a + x * x; }, 0);
          var sxy = xs.reduce(function (a, x, i) { return a + x * ys[i]; }, 0);
          var denom = (nCount * sxx - sx * sx);
          var slope = denom !== 0 ? (nCount * sxy - sx * sy) / denom : 0;
          var intercept = (sy - slope * sx) / nCount;
          var lastIdx = nCount - 1;
          futureVals = futureTs.map(function (_, k2) { return intercept + slope * (lastIdx + k2 + 1); });
        } else {
          var first = nn[0];
          var periods = nn.length - 1;
          var rate = (periods > 0 && first.v > 0 && last.v > 0) ? Math.pow(last.v / first.v, 1 / periods) - 1 : 0;
          futureVals = futureTs.map(function (_, k2) { return last.v * Math.pow(1 + rate, k2 + 1); });
        }
        if (s.unit === 'usd' || s.unit === 'count') {
          futureVals = futureVals.map(function (v) { return Math.max(0, v); });
        }
        var fpts = [{ t: last.t, v: last.v }].concat(futureTs.map(function (t2, i2) { return { t: t2, v: futureVals[i2], projected: true }; }));
        var byT2 = {};
        fpts.forEach(function (p) { byT2[p.t] = p.v; axisSet[p.t] = 1; });
        forecasts.push({
          id: s.id + '|forecast', metric: s.metric, country: s.country,
          label: s.label + ' (projected)', fullLabel: s.fullLabel + ' — projected (' + projMethod + ')',
          unit: s.unit, basis: s.basis, domain: s.domain,
          points: fpts, byT: byT2, dashed: true, projected: true,
          stats: null, comparisonOf: s.id
        });
      });
      if (forecasts.length) {
        out.series = out.series.concat(forecasts);
        warnings.push('Projected values (dashed) extrapolate the recent trend using a ' +
          (projMethod === 'linear' ? 'linear regression' : 'compound growth rate') +
          ' fit to the historical data shown. They are a model estimate, not a reported figure, and get less reliable the further out they go.');
      }
    }

    out.axis = Object.keys(axisSet).sort();

    // Comparison overlay.
    if (spec.compare === 'prev_year' || spec.compare === 'prev_period') {
      var extra = [];
      out.series.forEach(function (s, i) {
        var src = built[i];
        if (!src) return;
        var shift;
        if (spec.compare === 'prev_year') shift = grain === 'month' ? 12 : 365;
        else shift = out.axis.length;
        var pf, pt2;
        if (grain === 'month') { pf = addMonths(range.from, -shift); pt2 = addMonths(range.to, -shift); }
        else { pf = addDays(range.from, -shift); pt2 = addDays(range.to, -shift); }
        var prev = clip(src.points, pf, pt2);
        if (!prev.filter(function (p) { return p.v !== null; }).length) return;
        var trp = applyTransform(prev, transform, src.basis, spec.window);
        var byT2 = {};
        trp.points.forEach(function (p, idx) {
          var t = out.axis[idx];
          if (t !== undefined) byT2[t] = p.v;
        });
        extra.push({
          id: s.id + '|prev', metric: s.metric, country: s.country,
          label: s.label + (spec.compare === 'prev_year' ? ' (a year earlier)' : ' (previous period)'),
          fullLabel: s.fullLabel, unit: s.unit, basis: s.basis, domain: s.domain,
          points: out.axis.map(function (t) { return { t: t, v: byT2[t] === undefined ? null : byT2[t] }; }),
          byT: byT2, dashed: true,
          stats: summarise(trp.points, s.unit, src.basis),
          comparisonOf: s.id
        });
      });
      out.series = out.series.concat(extra);
    }

    // Second y-axis when units disagree.
    var units = {};
    out.series.forEach(function (s) { units[s.unit] = 1; });
    var uks = Object.keys(units);
    if (uks.length > 1) {
      out.series.forEach(function (s) { s.axisId = (s.unit === uks[0]) ? 'y' : 'y1'; });
      out.dualAxis = { y: uks[0], y1: uks[1] };
    }

    // Long tables get flattened into rows for display and CSV.
    var columns = ['period'].concat(out.series.map(function (s) { return s.label; }));
    var rows = out.axis.map(function (t) {
      var r = { period: t };
      out.series.forEach(function (s) { r[s.label] = (s.byT[t] === undefined ? '' : s.byT[t]); });
      return r;
    });

    return {
      ok: true, kind: spec.kind === 'value' ? 'value' : 'series',
      title: spec.title || out.series.map(function (s) { return s.fullLabel; }).join(' vs '),
      grain: grain, range: range, transform: transform, compare: spec.compare || null,
      series: out.series, axis: out.axis, dualAxis: out.dualAxis || null,
      chart: buildChart(spec, out),
      facts: buildFacts(out),
      columns: columns, rows: rows, csv: toCSV(columns, rows),
      warnings: warnings, notes: spec.notes || null
    };
  }

  /* ========================================================== run a ranking */

  function runRanking(spec) {
    var r = spec.ranking || {};
    var extraKey = r.extra || 'country_snapshot';
    var ex = CAT.extras[extraKey];
    if (!ex) return { ok: false, error: 'No ranking source called "' + extraKey + '".' };
    var rows = ex.rows().slice();
    var field = r.field;
    if (!field) return { ok: false, error: 'The ranking did not name a field.' };
    if (rows.length && rows[0][field] === undefined) {
      return { ok: false, error: 'Field "' + field + '" is not in ' + extraKey + '. Available: ' + Object.keys(rows[0]).join(', ') + '.' };
    }
    var dir = (r.direction === 'asc') ? 1 : -1;
    rows = rows.filter(function (x) { return typeof x[field] === 'number' && isFinite(x[field]); });
    rows.sort(function (a, b) { return (a[field] - b[field]) * dir; });
    var n = Math.min(Math.max(1, r.n || 10), 250);
    var top = rows.slice(0, n);

    var labelKey = ('c' in (rows[0] || {})) ? 'c' : ('country' in (rows[0] || {})) ? 'country'
      : ('cohort' in (rows[0] || {})) ? 'cohort' : ('name' in (rows[0] || {})) ? 'name' : Object.keys(rows[0] || {})[0];

    var showFields = (r.fields && r.fields.length) ? r.fields : (ex.fields || [field]);
    var columns = ['#', 'name'].concat(showFields.filter(function (f) { return f !== labelKey; }));
    var outRows = top.map(function (x, i) {
      var o = { '#': i + 1, name: (labelKey === 'c') ? (CAT.countryLabel(x.c) + ' (' + x.c + ')') : x[labelKey] };
      columns.slice(2).forEach(function (f) { o[f] = x[f]; });
      return o;
    });

    var chart = {
      type: 'bar', stacked: false,
      labels: outRows.map(function (x) { return String(x.name).replace(/\s*\(..\)$/, ''); }),
      datasets: [{
        label: field, data: top.map(function (x) { return x[field]; }),
        backgroundColor: '#1D8FE1', borderColor: '#1D8FE1', borderWidth: 0
      }],
      units: ['count'], indexAxis: 'y'
    };

    return {
      ok: true, kind: 'ranking',
      title: spec.title || ('Top ' + n + ' by ' + field),
      subtitle: ex.label,
      columns: columns, rows: outRows, csv: toCSV(columns, outRows),
      chart: chart, facts: [], warnings: [], notes: spec.notes || null
    };
  }

  /* ============================================ run a per-country growth ranking */
  // Not backed by a static CAT.extras entry — computed on the fly from any
  // metric's own monthlyByCountry/dailyByCountry series, so it works for
  // arbitrary metrics and date windows ("which country grew fastest this
  // quarter") rather than only the fixed current-vs-previous-month snapshot
  // that country_snapshot provides.

  function runMetricGrowthRanking(spec) {
    var r = spec.ranking || {};
    var m = CAT.get(r.metric);
    if (!m) return { ok: false, error: 'Unknown metric "' + r.metric + '" for a growth ranking.' };
    var grain = spec.grain === 'day' ? 'day' : 'month';
    var countries = CAT.dimValues(r.metric, 'country');
    if (!countries.length) return { ok: false, error: m.label + ' is not broken down by country, so it cannot be ranked by country growth.' };

    var built = [];
    countries.forEach(function (cc) {
      var s = seriesFor({ metric: r.metric, country: cc }, grain);
      if (!s.error && s.points && s.points.length) built.push(s);
    });
    if (!built.length) return { ok: false, error: 'No per-country data available for ' + m.label + ' at ' + grain + ' grain.' };

    var range = resolveRange(spec.range, grain, built);
    var dir = (r.direction === 'asc') ? 1 : -1;
    var rows = [];
    built.forEach(function (s) {
      var pts = clip(s.points, range.from, range.to).filter(function (p) { return p.v !== null; });
      if (pts.length < 2) return;
      var first = pts[0], last = pts[pts.length - 1];
      if (!first.v) return; // zero or null base — % change is undefined
      var changePct = ((last.v - first.v) / Math.abs(first.v)) * 100;
      rows.push({
        c: s.country, name: CAT.countryLabel(s.country) + ' (' + s.country + ')',
        from: first.v, to: last.v, change: last.v - first.v,
        changePct: Math.round(changePct * 100) / 100
      });
    });
    if (!rows.length) return { ok: false, error: 'Not enough per-country history for ' + m.label + ' in that window to compute growth.' };

    rows.sort(function (a, b) { return (a.changePct - b.changePct) * dir; });
    var n = Math.min(Math.max(1, r.n || 10), 250);
    var top = rows.slice(0, n);
    var columns = ['#', 'name', 'from', 'to', 'change', 'changePct'];
    var outRows = top.map(function (x, i) { return { '#': i + 1, name: x.name, from: x.from, to: x.to, change: x.change, changePct: x.changePct }; });

    var chart = {
      type: 'bar', stacked: false,
      labels: outRows.map(function (x) { return String(x.name).replace(/\s*\(..\)$/, ''); }),
      datasets: [{
        label: 'Growth %', data: top.map(function (x) { return x.changePct; }),
        backgroundColor: '#1D8FE1', borderColor: '#1D8FE1', borderWidth: 0
      }],
      units: ['pct'], indexAxis: 'y'
    };

    return {
      ok: true, kind: 'ranking',
      title: spec.title || ('Top ' + n + ' countries by ' + m.label + ' growth (' + prettyPeriod(range.from) + ' to ' + prettyPeriod(range.to) + ')'),
      subtitle: m.label + ' % change, ' + prettyPeriod(range.from) + ' to ' + prettyPeriod(range.to),
      columns: columns, rows: outRows, csv: toCSV(columns, outRows),
      chart: chart, facts: [],
      warnings: ['Growth ranking compares the first vs. last available value per country within the window; countries with fewer than two data points in that window are excluded.'],
      notes: spec.notes || null
    };
  }

  /* ============================================================ run a table */

  function runTable(spec) {
    var t = spec.table || {};
    var ex = CAT.extras[t.extra];
    if (!ex) return { ok: false, error: 'No table source called "' + t.extra + '". Available: ' + Object.keys(CAT.extras).join(', ') + '.' };
    var rows = ex.rows().slice();
    if (t.sortBy && rows.length && rows[0][t.sortBy] !== undefined) {
      var dir = (t.direction === 'asc') ? 1 : -1;
      rows.sort(function (a, b) {
        var av = a[t.sortBy], bv = b[t.sortBy];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av) < String(bv) ? dir : String(av) > String(bv) ? -dir : 0;
      });
    }
    if (t.n) rows = rows.slice(0, Math.min(t.n, 500));
    var columns = (t.fields && t.fields.length) ? t.fields : (ex.fields || Object.keys(rows[0] || {}));
    var outRows = rows.map(function (r) {
      var o = {}; columns.forEach(function (c) { o[c] = r[c]; }); return o;
    });
    return {
      ok: true, kind: 'table',
      title: spec.title || ex.label, subtitle: ex.label,
      columns: columns, rows: outRows, csv: toCSV(columns, outRows),
      chart: null, facts: [], warnings: [], notes: spec.notes || null
    };
  }

  /* ------------------------------------------------------- spec validation */

  var VALID_TRANSFORMS = ['none', 'cumulative', 'mom_pct', 'yoy_pct', 'index100', 'delta', 'rolling_avg'];
  var VALID_CHARTS = ['line', 'bar', 'area', 'stacked_bar', 'none'];

  function validate(spec) {
    if (!spec || typeof spec !== 'object') return 'Empty query plan.';
    var kinds = ['series', 'value', 'ranking', 'table', 'clarify', 'unsupported'];
    if (kinds.indexOf(spec.kind) < 0) spec.kind = 'series';
    if (spec.grain !== 'day' && spec.grain !== 'month') spec.grain = 'month';
    if (VALID_TRANSFORMS.indexOf(spec.transform) < 0) spec.transform = 'none';
    if (VALID_CHARTS.indexOf(spec.chart) < 0) spec.chart = (spec.kind === 'value' ? 'line' : 'line');
    if (spec.compare !== 'prev_period' && spec.compare !== 'prev_year') spec.compare = null;
    if (spec.project && typeof spec.project === 'object') {
      var pn = Math.round(Number(spec.project.n));
      if (!pn || pn < 1) spec.project = null;
      else {
        spec.project = { n: Math.min(60, Math.max(1, pn)), method: (spec.project.method === 'linear') ? 'linear' : 'cagr' };
      }
    } else {
      spec.project = null;
    }
    spec.runRate = !!spec.runRate;
    // Run-rate math (actual-so-far scaled by day-of-month/days-in-month) only
    // makes sense against month-grain data, which is where that context lives.
    if (spec.runRate) spec.grain = 'month';
    if (spec.metrics && !Array.isArray(spec.metrics)) spec.metrics = [spec.metrics];
    (spec.metrics || []).forEach(function (m) {
      if (m && typeof m.metric === 'string' && !CAT.get(m.metric)) {
        // Tolerate a near-miss id (pos.tpv -> payments.tpv, payment.tpv etc.)
        var tail = m.metric.split('.').pop();
        var hit = CAT.ids().filter(function (id) { return id.split('.').pop() === tail; })[0];
        if (hit) m.metric = hit;
      }
    });
    return null;
  }

  /* --------------------------------------------------------------------- run */

  function run(spec) {
    var err = validate(spec);
    if (err) return { ok: false, error: err };
    try {
      if (spec.kind === 'clarify') return { ok: true, kind: 'clarify', question: spec.title || 'Could you narrow that down?', options: spec.options || [], notes: spec.notes || null };
      if (spec.kind === 'unsupported') return { ok: false, kind: 'unsupported', error: spec.notes || spec.title || 'That is not in the dashboard data.' };
      if (spec.kind === 'ranking') {
        if (spec.ranking && spec.ranking.extra === 'metric_growth') return runMetricGrowthRanking(spec);
        return runRanking(spec);
      }
      if (spec.kind === 'table') return runTable(spec);
      return runSeries(spec);
    } catch (e) {
      return { ok: false, error: 'The query engine hit an error: ' + (e && e.message ? e.message : String(e)) };
    }
  }

  /* ----------------------------------------- deterministic narrative fallback */

  function narrate(result, question) {
    if (!result || !result.ok) return '';
    if (result.kind === 'ranking' || result.kind === 'table') {
      var top = result.rows[0];
      if (!top) return 'No rows matched.';
      return 'Top of the list is ' + top.name + '. ' + result.rows.length + ' rows shown; use Download CSV for the full set.';
    }
    var parts = [];
    result.series.filter(function (s) { return !s.comparisonOf; }).forEach(function (s) {
      var st = s.stats;
      if (!st) {
        // No historical points left to summarise — this happens for a
        // runRate query about a single current-in-progress period, where the
        // only point was intentionally excluded from stats (see runSeries).
        // The answer lives on its run-rate overlay instead; speak from that.
        var overlay = result.series.filter(function (o) { return o.comparisonOf === s.id && o.runRateMeta; })[0];
        if (overlay) {
          var rm = overlay.runRateMeta, ru = overlay.unit;
          var lastPt = overlay.points[overlay.points.length - 1];
          parts.push(s.fullLabel + ' — ' + prettyPeriod(lastPt.t) + ' run-rate estimate: ' +
            fmt(rm.estimate, ru) + ' for the full month, based on ' + fmt(rm.actual, ru) + ' actual so far ' +
            '(day ' + rm.dayOfMonth + ' of ' + rm.daysInMonth + '). This is a projection at the current pace, ' +
            'not a final total — the month is still in progress.');
        }
        return;
      }
      var u = s.unit;
      var head = s.fullLabel + ': ';
      if (s.basis === 'flow') {
        head += fmt(st.sum, u) + ' in total across ' + st.n + ' ' + result.grain + (st.n === 1 ? '' : 's') +
          ' (' + prettyPeriod(st.first.t) + ' to ' + prettyPeriod(st.last.t) + '), averaging ' + fmt(st.avg, u) + ' per ' + result.grain + '.';
      } else {
        head += fmt(st.last.v, u) + ' as at ' + prettyPeriod(st.last.t) + '.';
      }
      var dirWord = st.change > 0 ? 'up' : st.change < 0 ? 'down' : 'flat';
      head += ' It went from ' + fmt(st.first.v, u) + ' to ' + fmt(st.last.v, u) + ' — ' + dirWord +
        (st.changePct === null ? '' : ' ' + Math.abs(st.changePct).toFixed(1) + '%') + '.';
      if (st.max.t !== st.last.t) head += ' Peak was ' + fmt(st.max.v, u) + ' in ' + prettyPeriod(st.max.t) + '.';
      parts.push(head);
    });
    return parts.join(' ');
  }

  global.FACACHAT_ENGINE = {
    run: run,
    narrate: narrate,
    fmt: fmt,
    prettyPeriod: prettyPeriod,
    toCSV: toCSV,
    validate: validate,
    _internals: { seriesFor: seriesFor, resolveRange: resolveRange, applyTransform: applyTransform, summarise: summarise, addMonths: addMonths, addDays: addDays }
  };
})(typeof window !== 'undefined' ? window : globalThis);
