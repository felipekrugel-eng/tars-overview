/* ============================================================================
   FACACHAT — SEMANTIC LAYER (catalog)
   ----------------------------------------------------------------------------
   Turns the raw dashboard data files into a registry of well-defined metrics.

   Why a semantic layer instead of letting an LLM write SQL against Snowflake?
     1. Trust. Every FACADASH tile has an agreed methodology (email-dedup,
        Chargebee-invoice MRR, device-clock-filtered receipts). Re-deriving
        those in ad-hoc SQL would produce numbers that quietly disagree with
        the dashboard. Reading the same precomputed series guarantees they
        agree, always.
     2. Speed. The Snowflake queries behind these files take 25-90 minutes.
        The answers here are instant because the data is already in the page.
     3. Safety. No credentials in the browser, no generated code executed.
        The LLM only ever emits a JSON spec that this layer validates.

   Every metric declares its BASIS, which is the thing that is easy to get
   wrong in this dataset:
     'flow'  additive over time      (registrations, new payers, TPV, txns)
     'stock' point-in-time level     (paying merchants, enabled accounts)
     'mtd'   accumulates within a calendar month and resets  (regMTD, receipts,
             and the invoice-based paying / mrr / active columns in
             DAILY_HISTORY). Daily value = intra-month difference; monthly
             value = last reading of the month.
     'ratio' cannot be summed at all (arpc, take rate, pass rate)

   Depends on (loaded before this file):
     KPI_DATA, DAILY_HISTORY, DAILY_HISTORY_BY_COUNTRY, COUNTRY_FUNNEL,
     DAILY_FLOW, FLOW_MONTHLY                                    [POS]
     window.__PAY_MONTHLY, __PAY_VOL_DAILY, __PAY_ACT_DAILY,
     __PAY_ENABLED_DAILY, __PAY_ENABLED_SNAP, window.MARGINS     [payments]
   Payments globals are optional; metrics that need a missing global are
   simply not registered, and FACACHAT says so rather than guessing.
   ========================================================================= */
(function (global) {
  'use strict';

  // NOTE: kpi-data.js / daily-history.js / flow-data.js / daily-flow.js declare
  // their exports as top-level `const`, which — unlike `var` — does NOT attach
  // to window in a real browser. So `global[name]` (i.e. window[name]) is
  // always undefined for these even when the data is fully loaded and usable.
  // `typeof NAME !== 'undefined'` is the correct check here because classic
  // (non-module) <script> tags share one global lexical environment, so a
  // later script can see an earlier script's top-level const/let by name.
  // We keep the global[name] fallback too, in case a data file is ever
  // refactored to `window.NAME = ...` style like the payments files already are.
  var has = function (name) { return typeof global[name] !== 'undefined' && global[name] !== null; };
  var K = (typeof KPI_DATA !== 'undefined' && KPI_DATA !== null) ? KPI_DATA : (has('KPI_DATA') ? global.KPI_DATA : null);
  var DH = (typeof DAILY_HISTORY !== 'undefined' && DAILY_HISTORY !== null) ? DAILY_HISTORY : (has('DAILY_HISTORY') ? global.DAILY_HISTORY : null);
  var DHC = (typeof DAILY_HISTORY_BY_COUNTRY !== 'undefined' && DAILY_HISTORY_BY_COUNTRY !== null) ? DAILY_HISTORY_BY_COUNTRY : (has('DAILY_HISTORY_BY_COUNTRY') ? global.DAILY_HISTORY_BY_COUNTRY : null);
  var CF = (typeof COUNTRY_FUNNEL !== 'undefined' && COUNTRY_FUNNEL !== null) ? COUNTRY_FUNNEL : (has('COUNTRY_FUNNEL') ? global.COUNTRY_FUNNEL : null);
  var DF = (typeof DAILY_FLOW !== 'undefined' && DAILY_FLOW !== null) ? DAILY_FLOW : (has('DAILY_FLOW') ? global.DAILY_FLOW : null);
  var FLOW = (typeof FLOW_MONTHLY !== 'undefined' && FLOW_MONTHLY !== null) ? FLOW_MONTHLY : (has('FLOW_MONTHLY') ? global.FLOW_MONTHLY : null);

  var PM = global.__PAY_MONTHLY || null;
  var PVOL = global.__PAY_VOL_DAILY || null;
  var PACT = global.__PAY_ACT_DAILY || null;
  var PENA = global.__PAY_ENABLED_DAILY || null;
  var PSNAP = global.__PAY_ENABLED_SNAP || null;
  var PMERCH = global.__PAY_TXN_MERCHANTS || null;
  var MARG = global.MARGINS || null;

  /* ---------------------------------------------------------------- helpers */

  function monthOf(d) { return String(d).slice(0, 7); }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  // Series are always [{t, v}] sorted ascending by t. t is 'YYYY-MM' or 'YYYY-MM-DD'.
  function pt(t, v) { return { t: t, v: num(v) }; }
  function sortSeries(s) { return s.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; }); }

  // Turn an {'YYYY-MM': value} map into a series, dropping the junk months
  // that exist in some country maps (1926-03, 1970-xx device-clock artefacts).
  function fromMonthMap(map, minMonth) {
    if (!map) return [];
    var out = [], floor = minMonth || '2015-01';
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (!/^\d{4}-\d{2}$/.test(k) || k < floor) continue;
      out.push(pt(k, map[k]));
    }
    return sortSeries(out);
  }

  // Intra-month difference of an MTD-cumulative daily column.
  // The first day of a month is already the day's own value.
  function mtdToDaily(rows, field, precomputed) {
    var out = [], prevMonth = null, prevVal = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], m = r.month || monthOf(r.date);
      var cur = num(r[field]);
      var v;
      if (precomputed && num(r[precomputed]) !== null && m === prevMonth) {
        v = num(r[precomputed]);                  // trust the generator's own diff
      } else if (m !== prevMonth) {
        v = cur;                                  // first row of the month
      } else {
        v = (cur === null || prevVal === null) ? null : cur - prevVal;
      }
      out.push(pt(r.date, v));
      prevMonth = m;
      if (cur !== null) prevVal = cur;
    }
    return out;
  }

  // Last non-null reading of each month — the correct monthly value for an
  // MTD-accumulating column.
  function mtdToMonthly(rows, field) {
    var byMonth = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], m = r.month || monthOf(r.date), v = num(r[field]);
      if (v === null) continue;
      if (!byMonth[m] || r.date >= byMonth[m].date) byMonth[m] = { date: r.date, v: v };
    }
    var out = [];
    for (var k in byMonth) if (Object.prototype.hasOwnProperty.call(byMonth, k)) out.push(pt(k, byMonth[k].v));
    return sortSeries(out);
  }

  function dailyPlain(rows, field) {
    var out = [];
    for (var i = 0; i < rows.length; i++) out.push(pt(rows[i].date, rows[i][field]));
    return sortSeries(out);
  }

  // Sum a per-day list into months (for 'flow' basis metrics).
  function rollupSum(series) {
    var byMonth = {};
    for (var i = 0; i < series.length; i++) {
      var m = monthOf(series[i].t), v = series[i].v;
      if (v === null) continue;
      byMonth[m] = (byMonth[m] || 0) + v;
    }
    var out = [];
    for (var k in byMonth) if (Object.prototype.hasOwnProperty.call(byMonth, k)) out.push(pt(k, byMonth[k]));
    return sortSeries(out);
  }

  // Last value of each month (for 'stock' basis metrics).
  function rollupLast(series) {
    var byMonth = {};
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      if (s.v === null) continue;
      var m = monthOf(s.t);
      if (!byMonth[m] || s.t >= byMonth[m].t) byMonth[m] = s;
    }
    var out = [];
    for (var k in byMonth) if (Object.prototype.hasOwnProperty.call(byMonth, k)) out.push(pt(k, byMonth[k].v));
    return sortSeries(out);
  }

  /* ------------------------------------------------------- country handling */

  var CC_NAMES = (K && K.countryNames) ? K.countryNames : {};
  var ALIASES = {
    'usa': 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'us': 'US', 'america': 'US',
    'united states': 'US', 'united states of america': 'US', 'the us': 'US', 'stateside': 'US',
    'uk': 'GB', 'u.k.': 'GB', 'britain': 'GB', 'great britain': 'GB',
    'united kingdom': 'GB', 'england': 'GB', 'gb': 'GB',
    'uae': 'AE', 'emirates': 'AE', 'united arab emirates': 'AE',
    'holland': 'NL', 'the netherlands': 'NL', 'netherlands': 'NL',
    'south korea': 'KR', 'korea': 'KR', 'philippines': 'PH', 'the philippines': 'PH',
    'saudi': 'SA', 'saudi arabia': 'SA', 'viet nam': 'VN', 'vietnam': 'VN',
    'czechia': 'CZ', 'czech republic': 'CZ', 'ivory coast': 'CI', 'russia': 'RU',
    'turkey': 'TR', 'turkiye': 'TR', 'south africa': 'ZA', 'new zealand': 'NZ',
    'hong kong': 'HK', 'dominican republic': 'DO', 'costa rica': 'CR',
    'puerto rico': 'PR', 'el salvador': 'SV', 'trinidad and tobago': 'TT'
  };
  var NAME_TO_CC = (function () {
    var m = {};
    for (var cc in CC_NAMES) if (Object.prototype.hasOwnProperty.call(CC_NAMES, cc)) m[String(CC_NAMES[cc]).toLowerCase()] = cc;
    for (var a in ALIASES) if (Object.prototype.hasOwnProperty.call(ALIASES, a)) m[a] = ALIASES[a];
    return m;
  })();

  function resolveCountry(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (/^[A-Za-z]{2}$/.test(s)) {
      var up = s.toUpperCase();
      if (CC_NAMES[up] || NAME_TO_CC[s.toLowerCase()]) return NAME_TO_CC[s.toLowerCase()] || up;
      return up;
    }
    return NAME_TO_CC[s.toLowerCase()] || null;
  }
  function countryLabel(cc) { return CC_NAMES[cc] || cc; }

  /* ------------------------------------------------------- metric registry */

  var METRICS = {};

  function reg(def) {
    if (def.requires && def.requires.some(function (x) { return !x; })) return;   // data file absent
    METRICS[def.id] = def;
  }

  /* ===== POS: monthly totals (authority = KPI_DATA.monthly / activeMonthly) */

  function monthlyField(field) {
    return function () { return sortSeries((K.monthly || []).map(function (r) { return pt(r.month, r[field]); })); };
  }

  if (K) {
    reg({
      id: 'pos.registrations', domain: 'pos', label: 'New POS registrations', short: 'Registrations',
      unit: 'count', basis: 'flow', dims: ['country'], countryCoverage: 'top25+funnel',
      desc: 'Merchant sign-ups (deduped by email). Monthly back to 2015; daily for the last ~60 days.',
      monthly: monthlyField('registrations'),
      daily: function () { return mtdToDaily(DH || [], 'regMTD', 'newReg'); },
      monthlyByCountry: function (cc) { return fromMonthMap((K.countryRegistrationsByMonth || {})[cc], '2016-01'); },
      dailyByCountry: function (cc) { return mtdToDaily((DHC || {})[cc] || [], 'regMTD', 'newReg'); },
      funnelField: 'reg'
    });

    reg({
      id: 'pos.paying', domain: 'pos', label: 'Paying merchants', short: 'Paying',
      unit: 'count', basis: 'stock', dims: ['country'], countryCoverage: 'top25+funnel',
      desc: 'Merchants with a paid invoice in the month (Chargebee methodology).',
      monthly: monthlyField('paying'),
      // DAILY_HISTORY.paying accumulates within the month (invoice-date based),
      // so the daily view is a month-to-date curve, not a daily level.
      daily: function () { return dailyPlain(DH || [], 'paying'); },
      dailyNote: 'Month-to-date basis: invoiced payers so far this month, resets each month.',
      monthlyByCountry: function (cc) { return fromMonthMap((K.payingByCountryByMonth || {})[cc], '2016-01'); },
      dailyByCountry: function (cc) { return dailyPlain((DHC || {})[cc] || [], 'paying'); },
      funnelField: 'paying'
    });

    reg({
      id: 'pos.mrr', domain: 'pos', label: 'POS MRR', short: 'MRR',
      unit: 'usd', basis: 'stock', dims: ['country'], countryCoverage: 'full',
      desc: 'Subscription MRR in USD. Paid plan/add-on invoice lines spread across the billing period (GBP x1.34, EUR x1.16).',
      monthly: monthlyField('mrr'),
      daily: function () { return dailyPlain(DH || [], 'mrr'); },
      dailyNote: 'Month-to-date basis: MRR invoiced so far this month, resets each month.',
      monthlyByCountry: function (cc) { return fromMonthMap((K.mrrByCountryByMonth || {})[cc], '2016-01'); }
    });

    reg({
      id: 'pos.arpc', domain: 'pos', label: 'ARPC (revenue per paying merchant)', short: 'ARPC',
      unit: 'usd', basis: 'ratio', dims: ['country'], countryCoverage: 'full',
      desc: 'MRR divided by paying merchants. A ratio — never sum it across periods or countries.',
      monthly: monthlyField('arpc'),
      daily: function () { return dailyPlain(DH || [], 'arpc'); },
      dailyNote: 'Month-to-date basis, so it climbs through the month as more invoices land.',
      monthlyByCountry: function (cc) { return fromMonthMap((K.arpcByCountryByMonth || {})[cc], '2016-01'); }
    });

    reg({
      id: 'pos.new_payers', domain: 'pos', label: 'New paying merchants', short: 'New payers',
      unit: 'count', basis: 'flow', dims: [],
      desc: 'Merchants paying for the first time in the period (gross adds to the paying base).',
      monthly: monthlyField('newPayers'),
      daily: function () { return mtdToDaily(DH || [], 'newPayersMTD', 'newPayers'); }
    });

    reg({
      id: 'pos.cum_ever_paid', domain: 'pos', label: 'Cumulative merchants who ever paid', short: 'Ever paid',
      unit: 'count', basis: 'stock', dims: [],
      desc: 'Running total of merchants that have ever had a paid invoice.',
      monthly: monthlyField('cumEverPaid')
    });

    reg({
      id: 'pos.active', domain: 'pos', label: 'Active merchants', short: 'Active',
      unit: 'count', basis: 'mtd', dims: ['country'], countryCoverage: 'top25+funnel',
      desc: 'Merchants with at least one valid receipt in the month (device-clock filtered). A distinct count per month, so it cannot be summed across months.',
      monthly: function () { return sortSeries((K.activeMonthly || []).map(function (r) { return pt(r.month, r.active); })); },
      daily: function () { return dailyPlain(DH || [], 'active'); },
      dailyNote: 'Month-to-date distinct count: merchants active so far this month, resets each month.',
      monthlyByCountry: function (cc) { return fromMonthMap((K.activeByCountryByMonth || {})[cc], '2016-01'); },
      dailyByCountry: function (cc) { return dailyPlain((DHC || {})[cc] || [], 'active'); },
      funnelField: 'active'
    });

    reg({
      id: 'pos.receipts', domain: 'pos', label: 'POS receipts (transaction count)', short: 'Receipts',
      unit: 'count', basis: 'flow', dims: ['country'], countryCoverage: 'top25+funnel',
      desc: 'Number of receipts rung up on the POS. This is a COUNT of transactions, not a money value.',
      monthly: function () { return mtdToMonthly(DH || [], 'receipts'); },
      daily: function () { return mtdToDaily(DH || [], 'receipts', null); },
      monthlyByCountry: function (cc) { return fromMonthMap((K.receiptsByCountryByMonth || {})[cc], '2016-01'); },
      dailyByCountry: function (cc) { return mtdToDaily((DHC || {})[cc] || [], 'receipts', null); },
      funnelField: 'receipts',
      note: 'Monthly totals only cover the DAILY_HISTORY window (~2 months). Longer history exists per country.'
    });

    reg({
      id: 'pos.conversion', domain: 'pos', label: 'POS registration-to-paying conversion', short: 'Conversion',
      unit: 'pct', basis: 'ratio', dims: [],
      desc: 'Cumulative merchants who ever paid, as a share of all-time registrations.',
      monthly: function () {
        var cum = 0, regs = {}, out = [];
        (K.monthly || []).forEach(function (r) { regs[r.month] = r.registrations; });
        var months = (K.monthly || []).map(function (r) { return r.month; });
        for (var i = 0; i < months.length; i++) {
          cum += (regs[months[i]] || 0);
          var e = (K.monthly[i] || {}).cumEverPaid;
          out.push(pt(months[i], (cum > 0 && e != null) ? (e / cum) * 100 : null));
        }
        return out;
      }
    });

    // POS GTV (receipt value), all countries, USD-approximated via the fixed FX table in
    // receipts_tpv_daily_asof.sql. Same MTD/DAILY_HISTORY plumbing as pos.receipts for the
    // GLOBAL monthly/daily series (~2-month window) — see that metric for the shape.
    // monthlyByCountry, unlike global monthly, has full history: receipts_tpv_daily_asof.sql
    // already computes country x calendar-month TPV_USD_APPROX going back years, and
    // build_kpi_data.py now surfaces it as gtvByCountryByMonth the same way it already does
    // for receiptsByCountryByMonth/activeByCountryByMonth. funnelField is still omitted: the
    // COUNTRY_FUNNEL rows built by backfill_daily.py have no gtv field.
    reg({
      id: 'pos.gtv', domain: 'pos', label: 'POS GTV / transaction value', short: 'POS GTV',
      unit: 'usd', basis: 'flow', dims: ['country'], countryCoverage: 'top25+funnel',
      desc: 'Total value of receipts rung up on the POS, in USD (non-USD currencies converted with a fixed FX table, not daily live rates). For payment volume through Loyverse Payments specifically, use payments.tpv instead.',
      monthly: function () { return mtdToMonthly(DH || [], 'gtv'); },
      daily: function () { return mtdToDaily(DH || [], 'gtv', null); },
      monthlyByCountry: function (cc) { return fromMonthMap((K.gtvByCountryByMonth || {})[cc], '2016-01'); },
      dailyByCountry: function (cc) { return mtdToDaily((DHC || {})[cc] || [], 'gtv', null); },
      dailyNote: 'Month-to-date basis: receipt value rung up so far this month, resets each month.',
      note: 'Global monthly/daily totals only cover the DAILY_HISTORY window (~2 months). Per-country monthly history goes back further (see monthlyByCountry). USD conversion uses a fixed FX table, so figures are approximate for non-USD countries.'
    });
  }

  if (FLOW) {
    reg({
      id: 'pos.paying_adds', domain: 'pos', label: 'Paying-base gross adds', short: 'Adds',
      unit: 'count', basis: 'flow', dims: [],
      desc: 'Merchants joining the paying base in the month (complete months only).',
      monthly: function () { return sortSeries(FLOW.map(function (r) { return pt(r.m, r.adds); })); },
      daily: DF ? function () { return sortSeries(DF.map(function (r) { return pt(r.date, r.adds); })); } : undefined
    });
    reg({
      id: 'pos.paying_churn', domain: 'pos', label: 'Paying-base churn', short: 'Churn',
      unit: 'count', basis: 'flow', dims: [],
      desc: 'Merchants leaving the paying base in the month (complete months only).',
      monthly: function () { return sortSeries(FLOW.map(function (r) { return pt(r.m, r.churn); })); }
    });
    reg({
      id: 'pos.paying_net', domain: 'pos', label: 'Paying-base net change', short: 'Net',
      unit: 'count', basis: 'flow', dims: [],
      desc: 'Gross adds minus churn in the month.',
      monthly: function () { return sortSeries(FLOW.map(function (r) { return pt(r.m, r.net); })); }
    });
    reg({
      id: 'pos.paying_growth_pct', domain: 'pos', label: 'Paying-base growth rate', short: 'Growth %',
      unit: 'pct', basis: 'ratio', dims: [],
      desc: 'Net paying-base growth as a percentage, per the flow model.',
      monthly: function () { return sortSeries(FLOW.map(function (r) { return pt(r.m, r.g); })); }
    });
  }

  /* ===== PAYMENTS (Loyverse Payments / Stripe embedded) ==================== */

  function payMonthly(field) {
    return function () { return sortSeries(PM.map(function (r) { return pt(r.m, r[field]); })); };
  }
  function payMonthlyByCountry(field) {
    return function (cc) {
      return sortSeries(PM.map(function (r) {
        var b = (r.by || {})[cc];
        return pt(r.m, b ? b[field] : null);
      }));
    };
  }

  if (PM) {
    var PAY_MONTHLY_METRICS = [
      ['payments.tpv', 'Payments TPV (total payment volume)', 'TPV', 'usd', 'flow',
        'Total payment volume processed through Loyverse Payments, in USD. This is THE payments volume metric — use it for any "TPV", "payment volume", "GTV processed" or "how much are we processing" question.', 'tpv'],
      ['payments.txns', 'Payments transactions', 'Transactions', 'count', 'flow',
        'Count of succeeded card transactions processed through Loyverse Payments.', 'txns'],
      ['payments.avg_ticket', 'Payments average ticket', 'Avg ticket', 'usd', 'ratio',
        'Average value of a processed transaction (TPV / transactions).', 'avgTicket'],
      ['payments.revenue', 'Payments revenue (gross captured)', 'Payments revenue', 'usd', 'flow',
        'Gross fee revenue captured by Loyverse on processed volume.', 'revenue'],
      ['payments.take_rate', 'Payments take rate', 'Take rate', 'pct', 'ratio',
        'Gross revenue as a percentage of TPV.', 'takeRate'],
      ['payments.cost', 'Payments processing cost', 'Cost', 'usd', 'flow',
        'True cost of processing (network interchange + scheme fees + Stripe fees).', 'cost'],
      ['payments.net_margin', 'Payments net margin', 'Net margin', 'usd', 'flow',
        'Revenue minus true processing cost, in USD.', 'netMargin'],
      ['payments.net_take_rate', 'Payments net take rate', 'Net take rate', 'pct', 'ratio',
        'Net margin as a percentage of TPV.', 'netTakeRate'],
      ['payments.initiated', 'Payments onboardings initiated', 'Initiated', 'count', 'flow',
        'Merchants who started Stripe onboarding for Loyverse Payments.', 'initiated'],
      ['payments.passed_kyc', 'Payments onboardings passed KYC', 'Passed KYC', 'count', 'flow',
        'Merchants who completed onboarding and passed KYC.', 'passed'],
      ['payments.pass_rate', 'Payments KYC pass rate', 'Pass rate', 'pct', 'ratio',
        'Passed KYC as a percentage of onboardings initiated.', 'passRate'],
      ['payments.new_transacting', 'New transacting payments merchants', 'New transacting', 'count', 'flow',
        'Merchants taking their first payment in the period.', 'newTransacting'],
      ['payments.activation_rate', 'Payments activation rate', 'Activation rate', 'pct', 'ratio',
        'New transacting merchants as a percentage of merchants that passed KYC.', 'activationRate'],
      ['payments.active_merchants', 'Transacting payments merchants', 'Active merchants', 'count', 'mtd',
        'Merchants that processed at least one payment in the period. A distinct count — do not sum across months.', 'activeMerchants'],
      ['payments.tpv_per_active', 'TPV per transacting merchant', 'TPV per active', 'usd', 'ratio',
        'Average TPV per transacting merchant in the period.', 'tpvPerActive'],
      ['payments.live_cum', 'Cumulative payments accounts connected', 'Live (cum)', 'count', 'stock',
        'Running total of Stripe connected accounts created.', 'liveCum'],
      ['payments.transacting_cum', 'Cumulative transacting merchants', 'Transacting (cum)', 'count', 'stock',
        'Running total of merchants that have ever taken a payment.', 'transactingCum']
    ];
    PAY_MONTHLY_METRICS.forEach(function (m) {
      reg({
        id: m[0], domain: 'payments', label: m[1], short: m[2], unit: m[3], basis: m[4],
        desc: m[5], dims: ['country'], countryCoverage: 'payments-markets',
        monthly: payMonthly(m[6]),
        monthlyByCountry: payMonthlyByCountry(m[6])
      });
    });
  }

  if (PVOL) {
    // Daily TPV / txns come from their own file and are more granular than
    // __PAY_MONTHLY, so they override the monthly-only registration above.
    var tpvDaily = function () { return sortSeries(PVOL.map(function (r) { return pt(r.d, r.usd); })); };
    var txnDaily = function () { return sortSeries(PVOL.map(function (r) { return pt(r.d, r.cnt); })); };
    var tpvDailyCC = function (cc) {
      return sortSeries(PVOL.map(function (r) { var b = (r.by || {})[cc]; return pt(r.d, b ? b.usd : 0); }));
    };
    var txnDailyCC = function (cc) {
      return sortSeries(PVOL.map(function (r) { var b = (r.by || {})[cc]; return pt(r.d, b ? b.cnt : 0); }));
    };
    if (METRICS['payments.tpv']) {
      METRICS['payments.tpv'].daily = tpvDaily;
      METRICS['payments.tpv'].dailyByCountry = tpvDailyCC;
    } else {
      reg({
        id: 'payments.tpv', domain: 'payments', label: 'Payments TPV (total payment volume)', short: 'TPV',
        unit: 'usd', basis: 'flow', dims: ['country'],
        desc: 'Total payment volume processed through Loyverse Payments, in USD.',
        daily: tpvDaily, dailyByCountry: tpvDailyCC,
        monthly: function () { return rollupSum(tpvDaily()); }
      });
    }
    if (METRICS['payments.txns']) {
      METRICS['payments.txns'].daily = txnDaily;
      METRICS['payments.txns'].dailyByCountry = txnDailyCC;
    }
  }

  if (PACT) {
    reg({
      id: 'payments.accounts_connected', domain: 'payments', label: 'New payments accounts connected', short: 'Connected',
      unit: 'count', basis: 'flow', dims: ['country'],
      desc: 'Stripe connected accounts newly created for Loyverse Payments (start of onboarding).',
      daily: function () { return sortSeries(PACT.map(function (r) { return pt(r.d, r.n); })); },
      dailyByCountry: function (cc) { return sortSeries(PACT.map(function (r) { return pt(r.d, (r.by || {})[cc] || 0); })); },
      monthly: function () { return rollupSum(sortSeries(PACT.map(function (r) { return pt(r.d, r.n); }))); }
    });
  }

  if (PENA) {
    reg({
      id: 'payments.newly_enabled', domain: 'payments', label: 'Payments accounts newly enabled', short: 'Newly enabled',
      unit: 'count', basis: 'flow', dims: ['country'],
      desc: 'Accounts that became charge-enabled (cleared KYC) on that day.',
      daily: function () { return sortSeries(PENA.map(function (r) { return pt(r.d, r.n); })); },
      dailyByCountry: function (cc) { return sortSeries(PENA.map(function (r) { return pt(r.d, (r.by || {})[cc] || 0); })); },
      monthly: function () { return rollupSum(sortSeries(PENA.map(function (r) { return pt(r.d, r.n); }))); }
    });
  }

  if (PSNAP) {
    reg({
      id: 'payments.enabled', domain: 'payments', label: 'Payments accounts enabled (level)', short: 'Enabled',
      unit: 'count', basis: 'stock', dims: ['country'],
      desc: 'Charge-enabled connected accounts as at that date.',
      daily: function () { return sortSeries(PSNAP.map(function (r) { return pt(r.d, r.enabled); })); },
      dailyByCountry: function (cc) {
        return sortSeries(PSNAP.map(function (r) { var b = (r.by || {})[cc]; return pt(r.d, b ? b.enabled : null); }));
      },
      monthly: function () { return rollupLast(sortSeries(PSNAP.map(function (r) { return pt(r.d, r.enabled); }))); }
    });
    reg({
      id: 'payments.accounts_total', domain: 'payments', label: 'Payments accounts total (level)', short: 'Accounts',
      unit: 'count', basis: 'stock', dims: ['country'],
      desc: 'All connected accounts as at that date, enabled or not.',
      daily: function () { return sortSeries(PSNAP.map(function (r) { return pt(r.d, r.total); })); },
      dailyByCountry: function (cc) {
        return sortSeries(PSNAP.map(function (r) { var b = (r.by || {})[cc]; return pt(r.d, b ? b.total : null); }));
      },
      monthly: function () { return rollupLast(sortSeries(PSNAP.map(function (r) { return pt(r.d, r.total); }))); }
    });
  }

  /* -------------------------------------------- cross-dashboard availability */
  // FACACHAT is embedded on two separate pages that each load only half the
  // data: the POS dashboard (kpi-data.js/daily-history.js/flow-data.js -> K/
  // DH/DHC/CF/FLOW) and the activated-payments dashboard (activation-data.js
  // et al -> the __PAY_* globals / PM/PVOL/etc.). Without a stub, asking for
  // "TPV" on the POS-only page (or POS metrics on the payments-only page)
  // means the metric is simply absent from the catalog sent to the model —
  // which can still guess the id anyway, and the engine then fails with a
  // bare "Unknown metric" error instead of the normal, helpful NOT AVAILABLE
  // explanation. Registering an explicit unavailable stub for the metrics
  // people are most likely to ask for on the "wrong" page fixes that: the
  // model sees it in AVAILABLE METRICS marked NOT AVAILABLE, with a pointer
  // to the real alternative, and answers with kind=unsupported instead.
  if (!PM && !PVOL && !METRICS['payments.tpv']) {
    reg({
      id: 'payments.tpv', domain: 'payments', unavailable: true,
      unit: 'usd', basis: 'flow', label: 'Payments TPV (total payment volume)',
      desc: 'Not available on this dashboard — Loyverse Payments data isn\'t loaded here. ' +
        'For POS receipt value on this dashboard, use pos.gtv instead. For Loyverse Payments TPV, ask on the payments dashboard.'
    });
  }
  if (!K) {
    if (!METRICS['pos.gtv']) {
      reg({
        id: 'pos.gtv', domain: 'pos', unavailable: true,
        unit: 'usd', basis: 'flow', label: 'POS GTV / transaction value',
        desc: 'Not available on this dashboard — POS data isn\'t loaded here. ' +
          'For Loyverse Payments volume on this dashboard, use payments.tpv instead. For POS GTV, ask on the main KPI dashboard.'
      });
    }
    if (!METRICS['pos.registrations']) {
      reg({
        id: 'pos.registrations', domain: 'pos', unavailable: true,
        unit: 'count', basis: 'flow', label: 'New POS registrations',
        desc: 'Not available on this dashboard — POS data isn\'t loaded here. Ask on the main KPI dashboard instead.'
      });
    }
  }

  /* --------------------------------------------------- dimension inventories */

  function dimValues(metricId, dim) {
    var m = METRICS[metricId];
    if (!m || dim !== 'country') return [];
    var out = {};
    if (m.domain === 'payments') {
      if (PM) PM.forEach(function (r) { Object.keys(r.by || {}).forEach(function (c) { out[c] = 1; }); });
      if (PVOL) PVOL.forEach(function (r) { Object.keys(r.by || {}).forEach(function (c) { out[c] = 1; }); });
    } else {
      if (m.monthlyByCountry) {
        var src = null;
        if (/registrations/.test(metricId)) src = K.countryRegistrationsByMonth;
        else if (/\.paying$/.test(metricId)) src = K.payingByCountryByMonth;
        else if (/\.active$/.test(metricId)) src = K.activeByCountryByMonth;
        else if (/receipts/.test(metricId)) src = K.receiptsByCountryByMonth;
        else if (/mrr/.test(metricId)) src = K.mrrByCountryByMonth;
        else if (/arpc/.test(metricId)) src = K.arpcByCountryByMonth;
        if (src) Object.keys(src).forEach(function (c) { out[c] = 1; });
      }
      if (m.funnelField && CF && CF.rows) CF.rows.forEach(function (r) { out[r.c] = 1; });
    }
    return Object.keys(out).sort();
  }

  /* ------------------------------------------------------ coverage / extent */

  function extent(metricId, grain) {
    var m = METRICS[metricId];
    if (!m) return null;
    var fn = grain === 'day' ? m.daily : m.monthly;
    if (!fn) return null;
    var s;
    try { s = fn(); } catch (e) { return null; }
    var nn = s.filter(function (p) { return p.v !== null; });
    if (!nn.length) return null;
    return { from: nn[0].t, to: nn[nn.length - 1].t, points: nn.length };
  }

  function grainsFor(metricId) {
    var m = METRICS[metricId], g = [];
    if (!m) return g;
    if (m.monthly && extent(metricId, 'month')) g.push('month');
    if (m.daily && extent(metricId, 'day')) g.push('day');
    return g;
  }

  /* ------------------------------------------------------------- freshness */

  function freshness() {
    var f = {};
    if (K && K.meta) { f.posGeneratedAt = K.meta.generatedAt; f.posLatestMonth = K.meta.latestMonth; f.posSnapshotMonth = K.meta.snapshotMonth; }
    if (DH && DH.length) f.posLatestDay = DH[DH.length - 1].date;
    if (global.__PAY_OVERVIEW_UPDATED) f.paymentsUpdated = global.__PAY_OVERVIEW_UPDATED;
    if (global.__PAY_REPORT_UPDATED) f.paymentsReportUpdated = global.__PAY_REPORT_UPDATED;
    if (PVOL && PVOL.length) f.paymentsLatestDay = PVOL[PVOL.length - 1].d;
    if (MARG && MARG.updated) f.marginsUpdated = MARG.updated;
    return f;
  }

  /* --------------------------------------------- compact catalog for the LLM */

  function compact() {
    var out = { generated: new Date().toISOString().slice(0, 10), freshness: freshness(), metrics: [] };
    Object.keys(METRICS).sort().forEach(function (id) {
      var m = METRICS[id];
      var e = {
        id: id, domain: m.domain, label: m.label, unit: m.unit, basis: m.basis,
        grains: grainsFor(id), desc: m.desc
      };
      if (m.unavailable) { e.unavailable = true; e.grains = []; }
      var em = extent(id, 'month'), ed = extent(id, 'day');
      if (em) e.monthRange = em.from + '..' + em.to;
      if (ed) e.dayRange = ed.from + '..' + ed.to;
      if (m.dims && m.dims.length) {
        e.dims = m.dims;
        var cvs = dimValues(id, 'country');
        if (cvs.length) {
          e.countries = cvs.length <= 12 ? cvs.join(',') : (cvs.length + ' countries incl. ' + cvs.slice(0, 10).join(','));
        }
      }
      if (m.note) e.note = m.note;
      if (m.dailyNote) e.dailyNote = m.dailyNote;
      out.metrics.push(e);
    });
    out.extras = Object.keys(EXTRAS);
    return out;
  }

  /* ------------------------- non-time-series extras (snapshots and rankings) */

  var EXTRAS = {};

  if (CF && CF.rows) {
    EXTRAS['country_snapshot'] = {
      label: 'Per-country snapshot for the current and previous month, all ' + CF.rows.length + ' countries',
      months: { current: CF.current, previous: CF.previous, asOf: CF.asOf },
      fields: ['reg', 'active', 'paying', 'receipts'],
      rows: function () { return CF.rows; }
    };
  }
  if (K && K.countries) {
    EXTRAS['country_alltime'] = {
      label: 'All-time per-country totals (registrations, ever-paid, active) for ' + K.countries.length + ' countries',
      fields: ['registrations', 'everPaid', 'pctEverPaid', 'active'],
      rows: function () { return K.countries; }
    };
  }
  if (K && K.cohorts) {
    EXTRAS['cohorts'] = {
      label: 'Sign-up cohorts by month: registrations, paying now, ever paid, MRR, ARPC, active, conversion %',
      fields: ['cohort', 'registrations', 'payingNow', 'everPaid', 'mrr', 'arpc', 'active', 'pctEverPaid', 'pctPayingNow'],
      rows: function () { return K.cohorts; }
    };
  }
  if (K && K.retention) {
    EXTRAS['retention_curve'] = {
      label: 'Retention / survival curve by months since registration',
      fields: ['age', 'registrationPct', 'momPct', 'activatedProxyPct'],
      rows: function () {
        var r = K.retention, out = [];
        for (var i = 0; i < (r.age || []).length; i++) {
          out.push({ age: r.age[i], registrationPct: (r.registrationPct || [])[i], momPct: (r.momPct || [])[i], activatedProxyPct: (r.activatedProxyPct || [])[i] });
        }
        return out;
      }
    };
  }
  if (PMERCH) {
    EXTRAS['payments_merchants'] = {
      label: 'Per-merchant payments performance: transactions, volume, revenue captured, take rate, cost, margin',
      fields: ['name', 'country', 'started', 'txns', 'volume', 'captured', 'take', 'cost', 'margin'],
      rows: function () { return PMERCH; }
    };
  }
  if (MARG) {
    EXTRAS['payments_true_cost'] = {
      label: 'Payments true-cost and margin summary for the whole period to date (' + (MARG.subtitle || '') + ')',
      fields: Object.keys(MARG.kpis || {}),
      rows: function () {
        var out = [], k = MARG.kpis || {};
        Object.keys(k).forEach(function (f) { out.push({ metric: f, value: k[f] }); });
        return out;
      },
      byCountry: MARG.byCountry || null
    };
  }

  /* ------------------------------------------------------------------ export */

  global.FACACHAT_CATALOG = {
    metrics: METRICS,
    extras: EXTRAS,
    get: function (id) { return METRICS[id] || null; },
    ids: function () { return Object.keys(METRICS).sort(); },
    grainsFor: grainsFor,
    extent: extent,
    dimValues: dimValues,
    resolveCountry: resolveCountry,
    countryLabel: countryLabel,
    countryNames: CC_NAMES,
    freshness: freshness,
    compact: compact,
    helpers: {
      monthOf: monthOf, rollupSum: rollupSum, rollupLast: rollupLast,
      fromMonthMap: fromMonthMap, sortSeries: sortSeries
    },
    availability: {
      pos: !!K, posDaily: !!DH, posDailyByCountry: !!DHC, countryFunnel: !!CF,
      payments: !!PM, paymentsDaily: !!PVOL, margins: !!MARG
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
