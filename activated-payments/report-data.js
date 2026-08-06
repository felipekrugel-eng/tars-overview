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
// Do NOT edit by hand; overwritten each morning. Last pull: 2026-08-06 04:01 UTC
window.__PAY_REPORT_UPDATED = "2026-08-06 04:01 UTC";
window.__PAY_MONTHLY = [{"m":"2026-04","initiated":10,"passed":4,"passRate":40,"newTransacting":3,"activationRate":75,"tpv":4892.15,"txns":390,"avgTicket":12.54,"activeMerchants":3,"tpvPerActive":1630.72,"revenue":131.79,"takeRate":2.69,"cost":131.19,"netMargin":0.59,"netTakeRate":0.01,"liveCum":4,"transactingCum":3},{"m":"2026-05","initiated":23,"passed":2,"passRate":8.7,"newTransacting":1,"activationRate":50,"tpv":40768.32,"txns":2578,"avgTicket":15.81,"activeMerchants":4,"tpvPerActive":10192.08,"revenue":1082.61,"takeRate":2.66,"cost":1013.55,"netMargin":69.06,"netTakeRate":0.17,"liveCum":6,"transactingCum":4},{"m":"2026-06","initiated":5,"passed":0,"passRate":0,"newTransacting":1,"activationRate":null,"tpv":45463,"txns":3070,"avgTicket":14.81,"activeMerchants":4,"tpvPerActive":11365.75,"revenue":1306.85,"takeRate":2.87,"cost":1225.73,"netMargin":81.12,"netTakeRate":0.18,"liveCum":6,"transactingCum":5},{"m":"2026-07","initiated":419,"passed":110,"passRate":26.25,"newTransacting":27,"activationRate":24.55,"tpv":99408.32,"txns":4210,"avgTicket":23.61,"activeMerchants":31,"tpvPerActive":3206.72,"revenue":2816.82,"takeRate":2.83,"cost":2470.8,"netMargin":346.02,"netTakeRate":0.35,"liveCum":116,"transactingCum":32},{"m":"2026-08","initiated":62,"passed":28,"passRate":45.16,"newTransacting":8,"activationRate":28.57,"tpv":39864.41,"txns":1399,"avgTicket":28.49,"activeMerchants":26,"tpvPerActive":1533.25,"revenue":1171.85,"takeRate":2.94,"cost":778.64,"netMargin":393.21,"netTakeRate":0.99,"liveCum":144,"transactingCum":40}];
window.__PAY_REPORT_GROUPS = [{"g":"new","label":"New merchants","base":3102,"initiated":294,"passed":88,"transacting":12},{"g":"paying","label":"Paying merchants","base":1284,"initiated":92,"passed":31,"transacting":19},{"g":"nonpaying","label":"Non paying","base":2440,"initiated":75,"passed":21,"transacting":7},{"g":"dormant","label":"Dormant / other","base":124525,"initiated":51,"passed":3,"transacting":0}];
window.__PAY_REPORT_BASES = {"asof":"2026-08-06","new_us":3102,"paying_base_us":1284,"nonpaying_us":2440,"dormant_us":124525,"total_us":131351,"active_us":4932,"paying_us":1289};
window.__PAY_REPORT_NOTES = {"volumeFrom":"2026-04","untaggedInitiators":7,"launch":"2026-07-01"};
