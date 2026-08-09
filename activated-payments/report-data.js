// Loyverse Payments REPORT data — regenerated daily by activated-payments/pull.js.
// Monthly series behind report.html (the payments twin of the POS month-end report).
//   __PAY_MONTHLY : one row per calendar month. FLOW fields (initiated, passed, tpv, txns,
//                   revenue, cost, newTransacting) are sums over the month; liveCum /
//                   transactingCum are point-in-time at month end; rates are derived.
//   __PAY_REPORT_GROUPS : funnel-group snapshot (base + initiated/passed/transacting). NOTE:
//                   point-in-time only — there is no per-group history, so the report shows it
//                   as a current snapshot, not a month-over-month comparison.
// CAVEATS: volume history starts 13 Apr 2026 (first charge), so earlier months carry activation
// figures with zero TPV. Cost is dated by BALANCE_TRANSACTION_CREATED_AT, which can lag the
// charge by a day or two, so month-boundary costs may land in the following month.
// Do NOT edit by hand; overwritten each morning. Last pull: 2026-08-09 07:42 UTC
window.__PAY_REPORT_UPDATED = "2026-08-09 07:42 UTC";
window.__PAY_MONTHLY = [{"m":"2026-04","initiated":10,"passed":4,"passRate":40,"newTransacting":3,"activationRate":75,"tpv":4892.15,"txns":390,"avgTicket":12.54,"activeMerchants":3,"tpvPerActive":1630.72,"revenue":131.79,"takeRate":2.69,"cost":131.19,"netMargin":0.59,"netTakeRate":0.01,"liveCum":4,"transactingCum":3},{"m":"2026-05","initiated":23,"passed":2,"passRate":8.7,"newTransacting":1,"activationRate":50,"tpv":40768.32,"txns":2578,"avgTicket":15.81,"activeMerchants":4,"tpvPerActive":10192.08,"revenue":1082.61,"takeRate":2.66,"cost":1013.55,"netMargin":69.06,"netTakeRate":0.17,"liveCum":6,"transactingCum":4},{"m":"2026-06","initiated":5,"passed":0,"passRate":0,"newTransacting":1,"activationRate":null,"tpv":45463,"txns":3070,"avgTicket":14.81,"activeMerchants":4,"tpvPerActive":11365.75,"revenue":1306.85,"takeRate":2.87,"cost":1225.73,"netMargin":81.12,"netTakeRate":0.18,"liveCum":6,"transactingCum":5},{"m":"2026-07","initiated":419,"passed":109,"passRate":26.01,"newTransacting":27,"activationRate":24.77,"tpv":99408.32,"txns":4210,"avgTicket":23.61,"activeMerchants":31,"tpvPerActive":3206.72,"revenue":2816.82,"takeRate":2.83,"cost":2470.8,"netMargin":346.02,"netTakeRate":0.35,"liveCum":115,"transactingCum":32},{"m":"2026-08","initiated":118,"passed":43,"passRate":36.44,"newTransacting":12,"activationRate":27.91,"tpv":68353.75,"txns":2461,"avgTicket":27.77,"activeMerchants":30,"tpvPerActive":2278.46,"revenue":2007.24,"takeRate":2.94,"cost":1436.59,"netMargin":570.65,"netTakeRate":0.83,"liveCum":158,"transactingCum":44}];
window.__PAY_REPORT_GROUPS = [{"g":"new","label":"New merchants","base":2525,"initiated":332,"passed":98,"transacting":14},{"g":"paying","label":"Paying merchants","base":1283,"initiated":94,"passed":31,"transacting":20},{"g":"nonpaying","label":"Non paying","base":2403,"initiated":86,"passed":26,"transacting":8},{"g":"dormant","label":"Dormant / other","base":124464,"initiated":56,"passed":3,"transacting":0}];
window.__PAY_REPORT_BASES = {"asof":"2026-08-09","new_us":2525,"paying_base_us":1283,"nonpaying_us":2403,"dormant_us":124464,"total_us":130675,"active_us":4494,"paying_us":1291};
window.__PAY_REPORT_NOTES = {"volumeFrom":"2026-04","untaggedInitiators":7,"launch":"2026-07-01"};
