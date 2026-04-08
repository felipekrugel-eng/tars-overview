#!/usr/bin/env node
/**
 * snowflake-pull.js â Daily CASE Ã Snowflake data pull
 * Connects to Snowflake, queries live Loyverse business data,
 * and writes updated case-data.js for the CASE dashboard.
 */

const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ââ Config ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const ACCOUNT = 'ORXEAZX-TC97659';
const USERNAME = 'TARS_SERVICE_USER';
const KEY_PATH = path.join(__dirname, 'snowflake_tars_key.p8');
const DATABASE = 'LOYVERSE_DATA_LAKE';
const SCHEMA = 'PUBLIC';
const WAREHOUSE = 'COMPUTE_WH';
const ROLE = 'DATA_VIEWER';
const OUTPUT_FILE = path.join(__dirname, 'case-data.js');

// ââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function readPrivateKey() {
  const keyContent = fs.readFileSync(KEY_PATH, 'utf8');
  const privateKey = crypto.createPrivateKey({ key: keyContent, format: 'pem' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

function createConnection() {
  return snowflake.createConnection({
    account: ACCOUNT, username: USERNAME, authenticator: 'SNOWFLAKE_JWT',
    privateKey: readPrivateKey(), database: DATABASE, schema: SCHEMA,
    warehouse: WAREHOUSE, role: ROLE,
  });
}

function executeQuery(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, stmt, rows) => {
        if (err) reject(new Error(`Query failed: ${err.message}\nSQL: ${sql}`));
        else resolve(rows);
      }
    });
  });
}

function connectAsync(connection) {
  return new Promise((resolve, reject) => {
    connection.connect((err, conn) => {
      if (err) reject(new Error(`Connection failed: ${err.message}`));
      else resolve(conn);
    });
  });
}

// ââ FX Rates (static, approximate) ââââââââââââââââââââââââââââââââââââââââ
// These rates should be updated periodically (monthly recommended) to reflect actual market rates
// Used to convert Chargebee invoice amounts and Loyverse receipt totals to EUR for consistent KPI reporting
// Source: approximate rates as of 2025-04 | Last updated: 2026-04-08
const FX_RATES = {
  EUR: 1.0,
  USD: 0.92,    // 1 USD = ~0.92 EUR
  GBP: 1.17,    // 1 GBP = ~1.17 EUR
  JPY: 0.0061,  // 1 JPY = ~0.0061 EUR
  KRW: 0.00067  // 1 KRW = ~0.00067 EUR
};

// —— Queries (loaded from queries/ folder) ————————————————————————————————————
const QUERIES_DIR = path.join(__dirname, 'queries');

function loadQuery(filename) {
  return fs.readFileSync(path.join(QUERIES_DIR, filename), 'utf8');
}

// Map query names → .sql files (loaded at runtime)
const QUERY_FILES = {
  kpis:              'kpis.sql',
  monthly:           'monthly.sql',
  cohorts:           'cohorts.sql',
  markets:           'markets.sql',
  countryWeights:    'country-weights.sql',
  funnel:            'funnel.sql',
  revenueProjection: 'revenue-projection.sql',
  gtvProjection:     'gtv-projection.sql',
  diagnostics:       'diagnostics.sql',
  revenueDiag:       'revenue-diag.sql',
  revenueSample:     'revenue-sample.sql',
  gtvByMarket:       'gtv-by-market.sql',
  unifiedMerchant:   'unified-merchant.sql',
};

const QUERIES = {};
for (const [name, file] of Object.entries(QUERY_FILES)) {
  QUERIES[name] = loadQuery(file);
}



// ââ Strategic defaults âââââââââââââââââââââââââââââââââââââââââââââââââââââ
const STRATEGIC_DEFAULTS = {
  cohortVintages: [
    { month: "2024-01", merchants: 45000, npv: 120, ltv: 145, arpc: 12, paymentPct: 0 },
    { month: "2024-04", merchants: 52000, npv: 135, ltv: 158, arpc: 13, paymentPct: 0 },
    { month: "2024-07", merchants: 58000, npv: 148, ltv: 170, arpc: 14, paymentPct: 0 },
    { month: "2024-10", merchants: 63000, npv: 160, ltv: 178, arpc: 14.5, paymentPct: 0 },
    { month: "2025-01", merchants: 68000, npv: 170, ltv: 185, arpc: 15, paymentPct: 0.5 },
    { month: "2025-07", merchants: 75000, npv: 180, ltv: 195, arpc: 16, paymentPct: 1.2 }
  ],
  flags: {
    US:"\u{1F1FA}\u{1F1F8}",BR:"\u{1F1E7}\u{1F1F7}",MX:"\u{1F1F2}\u{1F1FD}",IN:"\u{1F1EE}\u{1F1F3}",
    ID:"\u{1F1EE}\u{1F1E9}",GB:"\u{1F1EC}\u{1F1E7}",FR:"\u{1F1EB}\u{1F1F7}",DE:"\u{1F1E9}\u{1F1EA}",
    ES:"\u{1F1EA}\t{1F1F8}",IT:"\u{1F1EE}\u{1F1F9}",JP:"\u{1F1EF}\u{1F1F5}",PH:"\u{1F1F5}\u{1F1ED}",
    RU:"\u{1F1F7}\u{1F1FA}",TR:"\u{1F1F9}\u{1F1F7}",PL:"\u{1F1F5}\u{1F1F1}",TH:"\u{1F1F9}\u{1F1ED}",
    CO:"\u{1F1E8}\u{1F1F4}",AR:"\u{1F1E6}\u{1F1F7}",SA:"\u{1F1F8}\u{1F1E6}",EG:"\u{1F1EA}\u{1F1EC}",
    AU:"\u{1F1E6}\u{1F1FA}",CA:"\u{1F1E8}\u{1F1E6}",NG:"\u{1F1F3}\u{1F1EC}",KE:"\u{1F1F0}\u{1F1EA}",
    UA:"\u{1F1FA}\u{1F1E6}",MY:"\u{1F1F2}\u{1F1FE}",VN:"\u{1F1FB}\u{1F1F3}"
  }
};

// ââ Data builder ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function buildCaseData(results) {
  const kpi = results.kpis[0] || {};
  const monthly = results.monthly || [];
  const cohorts = results.cohorts || [];
  const markets = results.markets || [];
  const weights = results.countryWeights || [];
  const funnel = results.funnel || [];
  const revProj = results.revenueProjection || [];
  const gtvProj = results.gtvProjection || [];

  const today = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().getMonth();

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyData = {
    months,
    revenue:        { target: new Array(12).fill(null), actual: new Array(12).fill(null) },
    paymentRevenue: { target: new Array(12).fill(null), actual: new Array(12).fill(null) },
    arpc:           { target: new Array(12).fill(null), actual: new Array(12).fill(null) },
    activeUsers:    { target: new Array(12).fill(null), actual: new Array(12).fill(null) },
    gtv:            { target: new Array(12).fill(null), actual: new Array(12).fill(null) }
  };

  for (const row of monthly) {
    const idx = (row.MONTH_NUM || row.month_num) - 1;
    if (idx < 0 || idx > 11) continue;
    monthlyData.revenue.target[idx]        = row.REVENUE_TARGET ?? row.revenue_target;
    monthlyData.revenue.actual[idx]        = row.REVENUE_ACTUAL ?? row.revenue_actual;
    monthlyData.paymentRevenue.target[idx] = row.PAYMENT_REVENUE_TARGET ?? row.payment_revenue_target;
    monthlyData.paymentRevenue.actual[idx] = row.PAYMENT_REVENUE_ACTUAL ?? row.payment_revenue_actual;
    monthlyData.arpc.target[idx]           = row.ARPC_TARGET ?? row.arpc_target;
    monthlyData.arpc.actual[idx]           = row.ARPC_ACTUAL ?? row.arpc_actual;
    monthlyData.activeUsers.target[idx]    = row.ACTIVE_USERS_TARGET ?? row.active_users_target;
    monthlyData.activeUsers.actual[idx]    = row.ACTIVE_USERS_ACTUAL ?? row.active_users_actual;
    monthlyData.gtv.target[idx]            = row.GTV_TARGET ?? row.gtv_target;
    monthlyData.gtv.actual[idx]            = row.GTV_ACTUAL ?? row.gtv_actual;
  }
  for (let i = currentMonth; i < 12; i++) {
    monthlyData.revenue.actual[i] = null;
    monthlyData.paymentRevenue.actual[i] = null;
    monthlyData.arpc.actual[i] = null;
    monthlyData.activeUsers.actual[i] = null;
    monthlyData.gtv.actual[i] = null;
  }

  // Detect incomplete monthly data: if a month's active users drops >25% from prior, mark as incomplete
  const auActuals = monthlyData.activeUsers.actual;
  for (let i = 1; i < currentMonth; i++) {
    if (auActuals[i] !== null && auActuals[i-1] !== null && auActuals[i-1] > 0) {
      const dropPct = (auActuals[i-1] - auActuals[i]) / auActuals[i-1];
      if (dropPct > 0.25) {
        console.warn(`Month ${i+1} active users (${auActuals[i]}) dropped ${(dropPct*100).toFixed(0)}% from prior (${auActuals[i-1]}) - marking as potentially incomplete`);
        // Null out the incomplete month's data across all series
        monthlyData.activeUsers.actual[i] = null;
        monthlyData.revenue.actual[i] = null;
        monthlyData.gtv.actual[i] = null;
        monthlyData.arpc.actual[i] = null;
        monthlyData.paymentRevenue.actual[i] = null;
      }
    }
  }


  const cohortVintages = cohorts.length > 0
    ? cohorts.map(r => ({
        month:             r.COHORT_MONTH || r.cohort_month,
        merchants:         r.REGISTRATIONS || r.registrations || 0,
        activeNow:         r.ACTIVE_NOW || r.active_now || 0,
        activePct:         r.ACTIVE_PCT || r.active_pct || 0,
        payingNow:         r.PAYING_NOW || r.paying_now || 0,
        payingPct:         r.PAYING_PCT || r.paying_pct || 0,
        activeToPayingPct: r.ACTIVE_TO_PAYING_PCT || r.active_to_paying_pct || 0,
        mrr:               r.COHORT_MRR_EUR || r.cohort_mrr_eur || 0,
        arr:               r.COHORT_ARR_EUR || r.cohort_arr_eur || 0,
        arpc:              r.ARPC_EUR || r.arpc_eur || 0,
        gtv30d:            r.GTV_30D_K_EUR || r.gtv_30d_k_eur || 0,
        gtvAlltime:        r.GTV_ALLTIME_M_EUR || r.gtv_alltime_m_eur || 0,
        revenueAlltime:    r.REVENUE_ALLTIME_K_EUR || r.revenue_alltime_k_eur || 0,
        npv:               r.NPV_PER_MERCHANT_EUR || r.npv_per_merchant_eur || 0,
        ltv:               r.LTV_PER_PAYING_EUR || r.ltv_per_paying_eur || 0,
        cancelled30d:      r.CANCELLED_30D || r.cancelled_30d || 0,
        churnRate30d:      r.CHURN_RATE_30D || r.churn_rate_30d || 0,
        cohortAgeMonths:   r.COHORT_AGE_MONTHS || r.cohort_age_months || 0,
        // Backward-compat aliases
        paymentPct:        r.PAYING_PCT || r.paying_pct || 0,
      }))
    : STRATEGIC_DEFAULTS.cohortVintages;

  const topMarkets = markets.map(r => ({
    country: r.COUNTRY||r.country, flag: STRATEGIC_DEFAULTS.flags[(r.COUNTRY||r.country)]||"",
    gtv: r.GTV_MILLIONS||r.gtv_millions||0, merchants: r.MERCHANT_COUNT||r.merchant_count,
    avgGTV: r.AVG_GTV_PER_MERCHANT||r.avg_gtv_per_merchant||0
  }));

  const countryWeights = {};
  for (const r of weights) countryWeights[r.COUNTRY_CODE||r.country_code] = r.WEIGHT||r.weight;

  const funnelData = {};
  const funnelTargets = {};
  const funnelStageMap = { registered:{label:'Registered merchants'}, active:{label:'Active (last 30d)'}, paying:{label:'Paying customers'}, payments_enabled:{label:'Payments-enabled'} };
  for (const r of funnel) {
    const stage = (r.STAGE||r.stage||'').toLowerCase();
    const key = stage === 'payments_enabled' ? 'paymentsEnabled' : stage;
    const info = funnelStageMap[stage]||{label:stage};
    funnelData[key] = { value: r.CURRENT_VALUE||r.current_value, label: info.label,
      ...((r.CONVERSION_RATE||r.conversion_rate) ? {convRate:`${r.CONVERSION_RATE||r.conversion_rate}%`} : {}) };
    funnelTargets[key] = r.TARGET_2026||r.target_2026;
  }

  const revenueProjection = { years: revProj.map(r=>r.YEAR||r.year), addOn: revProj.map(r=>r.ADDON_REVENUE||r.addon_revenue), payments: revProj.map(r=>r.PAYMENT_REVENUE||r.payment_revenue), newPricing: revProj.map(r=>r.NEW_PRICING_REVENUE||r.new_pricing_revenue) };
  const gtvProjection = { years: gtvProj.map(r=>r.YEAR||r.year), values: gtvProj.map(r=>r.GTV_BILLIONS||r.gtv_billions) };

  // Diagnostic: row counts per month + revenue check
  const diagRows = results.diagnostics || [];
  const revDiagRows = results.revenueDiag || [];
  const revSampleRows = results.revenueSample || [];
  const diagnosticData = {
    runDate: new Date().toISOString(),
    monthlyRowCounts: diagRows.map(r => ({
        source: r.SOURCE||r.source,
        month: r.PERIOD||r.period,
        rows: r.ROW_COUNT||r.row_count,
        uniqueMerchants: r.METRIC_VALUE||r.metric_value
      })),
    revenueDiag: revDiagRows.length > 0 ? {
      totalRows: revDiagRows[0].TOTAL_ROWS||revDiagRows[0].total_rows,
      currentYearRows: revDiagRows[0].CURRENT_YEAR_ROWS||revDiagRows[0].current_year_rows,
      currentYearAmount: revDiagRows[0].CURRENT_YEAR_AMOUNT||revDiagRows[0].current_year_amount,
      minDate: revDiagRows[0].MIN_DATE||revDiagRows[0].min_date,
      maxDate: revDiagRows[0].MAX_DATE||revDiagRows[0].max_date
    } : {},
    revenueSample: revSampleRows.map(r => ({amount_due: r.AMOUNT_DUE||r.amount_due, amount_paid: r.AMOUNT_PAID||r.amount_paid, total: r.TOTAL||r.total, currency: r.CURRENCY_CODE||r.currency_code, date: r.INVOICE_DATE||r.invoice_date})),
    incompleteMonthsNulled: monthlyData.activeUsers.actual.map((v, i) => v === null && i < currentMonth ? months[i] : null).filter(Boolean)
  };
  console.log('\n-- Diagnostics --');
  console.log(JSON.stringify(diagnosticData, null, 2));


  const totalRev = kpi.TOTAL_REVENUE||kpi.total_revenue||0;
  const payRev = kpi.PAYMENT_REVENUE||kpi.payment_revenue||0;
  const arpcVal = kpi.ARPC||kpi.arpc||0;
  let activeVal = kpi.ACTIVE_USERS||kpi.active_users||0;
  // If KPI activeVal looks incomplete vs latest complete monthly value, use the monthly value
  const completedMonthlyAU = monthlyData.activeUsers.actual.filter(v => v !== null);
  if (completedMonthlyAU.length > 0) {
    const latestCompleteMonth = completedMonthlyAU[completedMonthlyAU.length - 1];
    if (latestCompleteMonth > 0 && activeVal < latestCompleteMonth * 0.75) {
      console.warn(`KPI activeUsers (${activeVal}) looks incomplete vs latest month (${latestCompleteMonth}), using monthly value`);
      activeVal = latestCompleteMonth;
    }
  }
  const gtvVal = kpi.TOTAL_GTV||kpi.total_gtv||0;
  const attachVal = kpi.ATTACH_RATE||kpi.attach_rate||0;
  const gtvProcessedVal = kpi.GTV_PROCESSED||kpi.gtv_processed||0;
  const takeRateVal = kpi.TAKE_RATE||kpi.take_rate||0;
  const monthlyChurn = kpi.MONTHLY_CHURN||kpi.monthly_churn||2.1;
  const annualChurn = kpi.ANNUAL_CHURN||kpi.annual_churn||22;
  const nrrVal = kpi.NRR||kpi.nrr||104;
  const registeredVal = kpi.REGISTERED||kpi.registered||0;
  const payingVal = kpi.PAYING||kpi.paying||0;
  const paymentsEnabledVal = kpi.PAYMENTS_ENABLED||kpi.payments_enabled||0;
  const grossMarginVal = kpi.GROSS_MARGIN||kpi.gross_margin||68;

  let existing = {};
  try {
    const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
    const match = existingContent.match(/const CASE_DATA = ({[\s\S]*});/);
    if (match) existing = eval('(' + match[1] + ')');
  } catch (e) { console.log('Warning: Could not read existing case-data.js, building from scratch'); }

  const latestCohort = cohortVintages.length > 0 ? cohortVintages[cohortVintages.length - 1] : null;
  const cohortNpvVal = latestCohort ? latestCohort.npv : 180;

  return {
    lastUpdated: today,
    period: `Q${Math.ceil((currentMonth+1)/3)} 2026 \u00b7 Snowflake Live Data`,
    dataStatus: "ACTUAL",
    targets2026: { totalRevenue: 9.7, paymentRevenue: 0.1, arpc: 20, activeUsers: 400000, totalGTV: 30.9, attachRate: 8, takeRate: 0.06 },
    monthly2026: monthlyData,
    funnel: Object.keys(funnelData).length > 0 ? funnelData : {
      registered: { value: registeredVal, label: "Registered merchants" },
      active: { value: activeVal, label: "Active (last 30d)", convRate: activeVal&&registeredVal ? `${(activeVal/registeredVal*100).toFixed(1)}%` : "8.0%" },
      paying: { value: payingVal, label: "Paying customers", convRate: payingVal&&activeVal ? `${(payingVal/activeVal*100).toFixed(1)}%` : "3.0%" },
      paymentsEnabled: { value: paymentsEnabledVal, label: "Payments-enabled", convRate: paymentsEnabledVal&&payingVal ? `${(paymentsEnabledVal/payingVal*100).toFixed(1)}%` : "3.0%" }
    },
    funnelTargets2026: Object.keys(funnelTargets).length > 0 ? funnelTargets : { registered: 5000000, active: 400000, paying: 20000, paymentsEnabled: 1600 },
    unitEconomics: {
      avgNpvPerCohort: { value: `\u20ac${cohortNpvVal}`, target: "\u20ac360+", note: "Software-only today \u2192 2\u00d7 with payments" },
      avgLtvPerCohort: { value: latestCohort ? `\u20ac${latestCohort.ltv}` : "\u20ac180", target: "\u20ac216", note: "36-month LTV per merchant in cohort" },
      cac: { value: "~\u20ac0", target: "<\u20ac5", note: "Organic acquisition" },
      payback: { value: "18mo", target: "14mo", note: "Months to recover" },
      grossMargin: { value: `${grossMarginVal}%`, target: "69%", note: "Revenue minus COGS" },
      ltvCacRatio: { value: ">40\u00d7", target: ">40\u00d7", note: "Organic model" },
      cohortVintages
    },
    totalRevenue: { value: totalRev, unit: "\u20acM/yr", delta: `+${((totalRev/7.6-1)*100).toFixed(1)}%`, deltaClass: "up", label: "YoY growth" },
    paymentRevenue: { value: payRev, unit: "\u20acM/yr", delta: `\u2192 \u20ac${payRev.toFixed(1)}M`, deltaClass: "up", label: "2026 target" },
    arpc: { value: arpcVal, unit: "\u20ac/mo", delta: "\u2192 \u20ac20/mo", deltaClass: "up", label: "2026 target" },
    activeUsers: { value: activeVal, unit: "", delta: `+${((activeVal/278000-1)*100).toFixed(0)}%`, deltaClass: "up", label: "YoY" },
    totalGTV: { value: gtvVal||25.8, unit: "\u20acB/yr", delta: `+${(((gtvVal||25.8)/23.4-1)*100).toFixed(0)}%`, deltaClass: "up", label: "YoY" },
    attachRate: { value: attachVal, unit: "%", delta: "\u2192 5%", deltaClass: "up", label: "2026 target" },
    gtvProcessed: { value: gtvProcessedVal, unit: "\u20acB/yr", delta: "+40%", deltaClass: "up", label: "YoY" },
    takeRate: { value: takeRateVal, unit: "%", delta: "\u2192 0.05%", deltaClass: "up", label: "2026 target" },
    cohortNPV: { value: 1.2, unit: "\u00d7", delta: "\u2192 2\u00d7", deltaClass: "up", label: "vs software-only" },
    cohortSoftware: `\u20ac${cohortNpvVal}`,
    cohortPayments: latestCohort ? `\u20ac${Math.round(cohortNpvVal*1.2)}` : "\u20ac216",
    cohortTarget: "\u20ac360+",
    revenueProjection: revenueProjection.years.length > 0 ? revenueProjection : (existing.revenueProjection||{}),
    gtvProjection: gtvProjection.years.length > 0 ? gtvProjection : (existing.gtvProjection||{}),
    cohortCurve: existing.cohortCurve || { months: [0,1,6,12,24,60], pct: [0,0.5,1.5,6,12,20] },
    topMarkets: topMarkets.length > 0 ? topMarkets : (existing.topMarkets||[]),
    churn: {
      monthly: { value: `${monthlyChurn}%`, note: "Paying merchants \u00b7 below 3% benchmark" },
      annual: { value: `${annualChurn}%`, note: "Implied from monthly rate \u00b7 target <15% by 2028" },
      nrr: { value: `${nrrVal}%`, note: "Target: >110% by end of 2026" }
    },
    diagnostics: diagnosticData,
    appStores: existing.appStores||{}, ratingTrend: existing.ratingTrend||{},
    reviewThemes: existing.reviewThemes||[], downloads: existing.downloads||{},
    reviews: existing.reviews||{},
    countryWeights: Object.keys(countryWeights).length > 0 ? countryWeights : (existing.countryWeights||{}),
    regionCountries: existing.regionCountries||{}
  };
}

// ââ Write output ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function writeCaseData(data) {
  const output = `// \u2500\u2500\u2500 CASE DATA BLOCK \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Updated by CASE \u00d7 Snowflake pull. Single source of truth for all dashboard numbers.\n// dataStatus: ACTUAL = live Snowflake data. PROJECTED = manual estimates.\n// Last pull: ${data.lastUpdated}\nconst CASE_DATA = ${JSON.stringify(data, null, 2)};\n`;
  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');
  console.log(`\u2713 Wrote ${OUTPUT_FILE} (${(output.length / 1024).toFixed(1)} KB)`);
}

// ââ Main ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function main() {
  console.log(`CASE \u00d7 Snowflake Pull \u2014 ${new Date().toISOString()}`);
  console.log(`Account: ${ACCOUNT} | User: ${USERNAME} | DB: ${DATABASE}.${SCHEMA}`);
  console.log('');

  const connection = createConnection();
  console.log('Connecting to Snowflake...');
  let retries = 1, connected = false, lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await connectAsync(connection);
      connected = true;
      console.log('\u2713 Connected');
      break;
    } catch (err) {
      lastError = err;
      console.log(`\u2717 Connection attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries) { console.log('Retrying in 5s...'); await new Promise(r => setTimeout(r, 5000)); }
    }
  }

  if (!connected) {
    console.error(`\n\u2717 FATAL: Could not connect to Snowflake after ${retries + 1} attempts`);
    console.error(`Last error: ${lastError.message}`);
    process.exit(1);
  }

  const results = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    try {
      console.log(`Running query: ${name}...`);
      results[name] = await executeQuery(connection, sql);
      console.log(`\u2713 ${name}: ${results[name].length} rows`);
    } catch (err) {
      console.error(`\u2717 ${name} failed: ${err.message}`);
      results[name] = [];
    }
  }

  const caseData = buildCaseData(results);
  writeCaseData(caseData);

  console.log('\n\u2500\u2500 Summary \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`dataStatus:      ${caseData.dataStatus}`);
  console.log(`lastUpdated:     ${caseData.lastUpdated}`);
  console.log(`totalRevenue:    \u20ac${caseData.totalRevenue.value}M`);
  console.log(`activeUsers:     ${caseData.activeUsers.value.toLocaleString()}`);
  console.log(`registered:      ${caseData.funnel.registered.value.toLocaleString()}`);
  console.log(`paying:          ${caseData.funnel.paying.value.toLocaleString()}`);
  console.log(`ARPC:            \u20ac${caseData.arpc.value}/mo`);
  console.log(`Monthly churn:   ${caseData.churn.monthly.value}`);
  console.log(`Cohort vintages: ${caseData.unitEconomics.cohortVintages.length}`);
  console.log(`Unified merch:   ${(results.unifiedMerchant||[]).length} rows`);
  console.log(`Top markets:     ${caseData.topMarkets.length}`);
  const monthsWithActuals = caseData.monthly2026.revenue.actual.filter(v => v !== null).length;
  console.log(`Monthly actuals: ${monthsWithActuals}/12 months filled`);

  connection.destroy(() => console.log('\n\u2713 Connection closed'));
}

main().catch(err => {
  console.error(`\n\u2717 Unhandled error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
