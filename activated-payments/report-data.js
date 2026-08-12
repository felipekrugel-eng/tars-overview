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
// Do NOT edit by hand; overwritten each morning. Last pull: 2026-08-12 16:36 UTC
window.__PAY_REPORT_UPDATED = "2026-08-12 16:36 UTC";
window.__PAY_MONTHLY = [{"m":"2026-04","initiated":10,"passed":4,"passRate":40,"newTransacting":3,"activationRate":75,"tpv":4892.15,"txns":390,"avgTicket":12.54,"activeMerchants":3,"tpvPerActive":1630.72,"revenue":131.79,"takeRate":2.69,"cost":131.19,"netMargin":0.59,"netTakeRate":0.01,"liveCum":4,"transactingCum":3},{"m":"2026-05","initiated":23,"passed":2,"passRate":8.7,"newTransacting":1,"activationRate":50,"tpv":40768.32,"txns":2578,"avgTicket":15.81,"activeMerchants":4,"tpvPerActive":10192.08,"revenue":1082.61,"takeRate":2.66,"cost":1013.55,"netMargin":69.06,"netTakeRate":0.17,"liveCum":6,"transactingCum":4},{"m":"2026-06","initiated":5,"passed":0,"passRate":0,"newTransacting":1,"activationRate":null,"tpv":45463,"txns":3070,"avgTicket":14.81,"activeMerchants":4,"tpvPerActive":11365.75,"revenue":1306.85,"takeRate":2.87,"cost":1225.73,"netMargin":81.12,"netTakeRate":0.18,"liveCum":6,"transactingCum":5},{"m":"2026-07","initiated":419,"passed":109,"passRate":26.01,"newTransacting":27,"activationRate":24.77,"tpv":99408.32,"txns":4210,"avgTicket":23.61,"activeMerchants":31,"tpvPerActive":3206.72,"revenue":2816.82,"takeRate":2.83,"cost":2470.8,"netMargin":346.02,"netTakeRate":0.35,"liveCum":115,"transactingCum":32},{"m":"2026-08","initiated":157,"passed":53,"passRate":33.76,"newTransacting":14,"activationRate":26.42,"tpv":89739.67,"txns":3250,"avgTicket":27.61,"activeMerchants":33,"tpvPerActive":2719.38,"revenue":2634.61,"takeRate":2.94,"cost":2060.23,"netMargin":574.38,"netTakeRate":0.64,"liveCum":168,"transactingCum":46}];
window.__PAY_REPORT_GROUPS = [{"g":"new","label":"New merchants","base":2698,"initiated":353,"passed":104,"transacting":14},{"g":"paying","label":"Paying merchants","base":1277,"initiated":94,"passed":32,"transacting":20},{"g":"nonpaying","label":"Non paying","base":2386,"initiated":96,"passed":27,"transacting":9},{"g":"dormant","label":"Dormant / other","base":124487,"initiated":59,"passed":5,"transacting":1}];
window.__PAY_REPORT_BASES = {"asof":"2026-08-12","new_us":2698,"paying_base_us":1277,"nonpaying_us":2386,"dormant_us":124487,"total_us":130848,"active_us":4500,"paying_us":1288};
window.__PAY_REPORT_NOTES = {"volumeFrom":"2026-04","untaggedInitiators":12,"launch":"2026-07-01"};
