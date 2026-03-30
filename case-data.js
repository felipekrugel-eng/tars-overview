// ─── CASE DATA BLOCK ────────────────────────────────────────────────────────
// Updated weekly by CASE. Single source of truth for all dashboard numbers.
// To update: replace values below and push to GitHub. Netlify redeploys in ~30s.
const CASE_DATA = {
  lastUpdated: "2026-03-30",
  period: "Q1 2026 · 5YP v4 Projections",
  dataStatus: "PROJECTED",

  // ── 2026 Targets ────────────────────────────────────────────────────────
  targets2026: {
    totalRevenue: 9.7,    // €M
    paymentRevenue: 0.1,  // €M
    arpc: 20,             // €/mo
    activeUsers: 400000,
    totalGTV: 30.9,       // €B
    attachRate: 8,        // %
    takeRate: 0.06,       // %
  },

  // ── Monthly 2026 data (targets + simulated actuals Jan-Mar) ────────────────
  monthly2026: {
    months: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    revenue: {
      target:  [0.70, 0.72, 0.75, 0.78, 0.80, 0.82, 0.84, 0.86, 0.88, 0.90, 0.92, 0.95],
      actual:  [0.68, 0.71, 0.74, null, null, null, null, null, null, null, null, null]
    },
    paymentRevenue: {
      target:  [0.005, 0.006, 0.007, 0.008, 0.008, 0.009, 0.009, 0.010, 0.010, 0.011, 0.011, 0.012],
      actual:  [0.004, 0.005, 0.006, null, null, null, null, null, null, null, null, null]
    },
    arpc: {
      target:  [17.5, 17.8, 18.0, 18.3, 18.5, 18.8, 19.0, 19.3, 19.5, 19.8, 20.0, 20.0],
      actual:  [17.2, 17.4, 17.6, null, null, null, null, null, null, null, null, null]
    },
    activeUsers: {
      target:  [355000, 360000, 365000, 370000, 375000, 380000, 385000, 390000, 393000, 396000, 398000, 400000],
      actual:  [352000, 358000, 362000, null, null, null, null, null, null, null, null, null]
    },
    gtv: {
      target:  [2.40, 2.45, 2.50, 2.55, 2.58, 2.60, 2.62, 2.64, 2.66, 2.68, 2.70, 2.72],
      actual:  [2.38, 2.43, 2.48, null, null, null, null, null, null, null, null, null]
    }
  },

  // ── Conversion funnel ───────────────────────────────────────────────────────
  funnel: {
    registered:       { value: 4350000, label: "Registered merchants" },
    active:           { value: 350000,  label: "Active (last 30d)", convRate: "8.0%" },
    paying:           { value: 10500,   label: "Paying customers", convRate: "3.0%" },
    paymentsEnabled:  { value: 315,     label: "Payments-enabled", convRate: "3.0%" }
  },
  funnelTargets2026: {
    registered: 5000000,
    active: 400000,
    paying: 20000,
    paymentsEnabled: 1600
  },

  // ── Unit economics ──────────────────────────────────────────────────────────
  unitEconomics: {
    avgNpvPerCohort:  { value: "€180", target: "€360+", note: "Software-only today → 2× with payments" },
    avgLtvPerCohort:  { value: "€180", target: "€216", note: "36-month LTV per merchant in cohort" },
    cac:              { value: "~€0", target: "<€5", note: "Organic acquisition" },
    payback:          { value: "18mo", target: "14mo", note: "Months to recover" },
    grossMargin:      { value: "68%", target: "69%", note: "Revenue minus COGS" },
    ltvCacRatio:      { value: ">40×", target: ">40×", note: "Organic model" },
    cohortVintages: [
      { month: "Apr 2025", merchants: 4200, npv: 165, ltv: 168, arpc: 16.2, paymentPct: 2.1 },
      { month: "May 2025", merchants: 4350, npv: 168, ltv: 170, arpc: 16.4, paymentPct: 2.3 },
      { month: "Jun 2025", merchants: 4100, npv: 170, ltv: 172, arpc: 16.5, paymentPct: 2.5 },
      { month: "Jul 2025", merchants: 4500, npv: 172, ltv: 174, arpc: 16.7, paymentPct: 2.8 },
      { month: "Aug 2025", merchants: 4300, npv: 175, ltv: 176, arpc: 16.8, paymentPct: 3.0 },
      { month: "Sep 2025", merchants: 4600, npv: 178, ltv: 178, arpc: 16.9, paymentPct: 3.1 },
      { month: "Oct 2025", merchants: 4400, npv: 180, ltv: 180, arpc: 17.0, paymentPct: 3.2 },
      { month: "Nov 2025", merchants: 4250, npv: 178, ltv: 179, arpc: 17.0, paymentPct: 3.0 },
      { month: "Dec 2025", merchants: 3900, npv: 176, ltv: 177, arpc: 16.9, paymentPct: 2.9 },
      { month: "Jan 2026", merchants: 4700, npv: 182, ltv: 183, arpc: 17.2, paymentPct: 3.4 },
      { month: "Feb 2026", merchants: 4800, npv: 185, ltv: 186, arpc: 17.4, paymentPct: 3.5 },
      { month: "Mar 2026", merchants: 5100, npv: 188, ltv: 189, arpc: 17.6, paymentPct: 3.7 }
    ]
  },

  // ── Revenue ─────────────────────────────────────────────────────────────
  totalRevenue:    { value: 7.6,  unit: "€M/yr",   delta: "+26.0%",  deltaClass: "up",   label: "YoY growth" },
  paymentRevenue:  { value: 0.2,  unit: "€M/yr",   delta: "→ €0.1M",  deltaClass: "up",  label: "2026 target" },
  arpc:            { value: 17,   unit: "€/mo",    delta: "→ €20/mo", deltaClass: "up",  label: "2026 target" },

  // ── Scale ───────────────────────────────────────────────────────────────
  activeUsers:     { value: 350000, unit: "",       delta: "+26%",    deltaClass: "up",   label: "YoY" },
  totalGTV:        { value: 26.9,  unit: "€B/yr",  delta: "+15%",    deltaClass: "up",   label: "YoY" },

  // ── Payments ────────────────────────────────────────────────────────────
  attachRate:      { value: 3,    unit: "%",       delta: "→ 5%",    deltaClass: "up",   label: "2026 target" },
  gtvProcessed:    { value: 0.54, unit: "€B/yr",   delta: "+40%",    deltaClass: "up",   label: "YoY" },
  takeRate:        { value: 0.03, unit: "%",       delta: "→ 0.05%", deltaClass: "up",   label: "2026 target" },
  cohortNPV:       { value: 1.2,  unit: "×",       delta: "→ 2×",    deltaClass: "up",   label: "vs software-only" },

  // ── Cohort NPV detail ────────────────────────────────────────────────────
  cohortSoftware:  "€180",
  cohortPayments:  "€216",
  cohortTarget:    "€360+",

  // ── Revenue trend (2025–2030) ─────────────────────────────────────────
  revenueProjection: {
    years:      [2025, 2026, 2027, 2028, 2029, 2030],
    addOn:      [7.6,  9.3,  11.3, 13.2, 14.8, 16.5],
    payments:   [0.2,  0.1,  1.5,  4.8,  9.4,  14.5],
    newPricing: [0.0,  0.3,  3.1,  11.0, 29.6, 47.4]
  },

  // ── GTV trend ──────────────────────────────────────────────────────────
  gtvProjection: {
    years: [2025, 2026, 2027, 2028, 2029, 2030],
    values:[26.9, 30.9, 38.7, 45.9, 52.8, 59.9]
  },

  // ── Cohort penetration curve ────────────────────────────────────────────
  cohortCurve: {
    months: [0, 1, 6, 12, 24, 60],
    pct:    [0, 0.5, 1.5, 6, 12, 20]
  },

  // ── Top 10 markets ─────────────────────────────────────────────────────
  topMarkets: [
    { country: "Thailand",     flag: "🇹🇭", gtv: 349, merchants: 53252, avgGTV: 6559 },
    { country: "Philippines",  flag: "🇵🇭", gtv: 250, merchants: 50356, avgGTV: 4968 },
    { country: "Mexico",       flag: "🇲🇽", gtv: 216, merchants: 38319, avgGTV: 5639 },
    { country: "Malaysia",     flag: "🇲🇾", gtv: 158, merchants: 38006, avgGTV: 4153 },
    { country: "Saudi Arabia", flag: "🇸🇦", gtv: 134, merchants: 10945, avgGTV: 12219 },
    { country: "USA",          flag: "🇺🇸", gtv: 125, merchants: 3658,  avgGTV: 34062 },
    { country: "Myanmar",      flag: "🇲🇲", gtv: 78,  merchants: 6469,  avgGTV: 12086 },
    { country: "UK",           flag: "🇬🇧", gtv: 75,  merchants: 4890,  avgGTV: 15276 },
    { country: "Spain",        flag: "🇪🇸", gtv: 66,  merchants: 7195,  avgGTV: 9152  },
    { country: "Singapore",    flag: "🇸🇬", gtv: 36,  merchants: 1899,  avgGTV: 19063 }
  ],

  // ── Churn & Retention ────────────────────────────────────────────────────
  churn: {
    monthly:  { value: "2.1%",  note: "Paying merchants · below 3% benchmark" },
    annual:   { value: "22%",   note: "Implied from monthly rate · target <15% by 2028" },
    nrr:      { value: "104%",  note: "Target: >110% by end of 2026" }
  },

  // ── App Store Sentiment ──────────────────────────────────────────────────
  appStores: {
    googlePlay: {
      rating:     4.8,
      reviewCount: "492K",
      positive:   85,
      neutral:    9,
      negative:   6,
      tags: [
        { label: "Easy to use", type: "pos" },
        { label: "Great for small biz", type: "pos" },
        { label: "Free POS", type: "pos" },
        { label: "Quick setup", type: "pos" },
        { label: "Support slow", type: "neg" },
        { label: "Add-on costs", type: "neg" }
      ]
    },
    appStore: {
      rating:     4.8,
      reviewCount: "127K",
      positive:   88,
      neutral:    7,
      negative:   5,
      tags: [
        { label: "Simple & clean", type: "pos" },
        { label: "Works offline", type: "pos" },
        { label: "Multi-location", type: "pos" },
        { label: "Reports useful", type: "pos" },
        { label: "Payment integration", type: "neg" },
        { label: "Add-on pricing", type: "neg" }
      ]
    }
  },

  // ── Rating trend (last 6 months) ─────────────────────────────────────────
  ratingTrend: {
    months:     ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"],
    googlePlay: [4.68, 4.70, 4.72, 4.74, 4.76, 4.80],
    appStore:   [4.75, 4.76, 4.77, 4.78, 4.79, 4.80]
  },

  // ── Top review themes ─────────────────────────────────────────────────────
  reviewThemes: [
    { name: "Ease of use",         mentions: 2910, type: "pos", key: "ease-of-use" },
    { name: "Free / value",        mentions: 1985, type: "pos", key: "free-value" },
    { name: "Inventory features",  mentions: 1580, type: "pos", key: "inventory" },
    { name: "Reporting",           mentions: 1255, type: "pos", key: "reporting" },
    { name: "Customer support",    mentions: 920,  type: "neg", key: "customer-support" },
    { name: "Payment integration", mentions: 670,  type: "neg", key: "payment-integration" },
    { name: "Sync / connectivity", mentions: 495,  type: "neg", key: "sync" }
  ],

  // ── App Store Downloads (monthly installs trend) ──────────────────────────
  downloads: {
    googlePlay: { total: "10M+", trend: [850000, 890000, 920000, 960000, 1010000, 1045000] },
    appStore:   { total: "2M+",  trend: [185000, 192000, 198000, 205000, 215000, 222000] }
  },

  // ── Individual Reviews (representative sample · last 30 days) ──────────────
  reviews: {
    googlePlay: [
      { author: "StallOwner_TH",  country: "TH", region: "asia", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["ease-of-use","free-value"],           text: "Life saver for my food stall. Free, no ads, no contracts. Got up and running in under an hour. Inventory tracking is exactly what a small vendor needs." },
      { author: "BakeryPOS_PH",   country: "PH", region: "asia", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["ease-of-use","inventory"],             text: "My staff learned the app in 20 minutes. Barcode scanning works great and real-time stock updates mean I never run out of key ingredients anymore." },
      { author: "JuiceBarUS",     country: "US", region: "north_america", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["free-value","reporting"],              text: "Tried Square, Toast, and Clover. Loyverse is the only one truly free with useful reports. Daily sales breakdown by payment type is a game changer." },
      { author: "GadgetsMY",      country: "MY", region: "asia", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["ease-of-use","inventory"],             text: "Set up 350 SKUs in an afternoon using the back office. The app is incredibly intuitive and my part-time staff have zero issues with it." },
      { author: "GiftShopSA",     country: "SA", region: "middle_east", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["reporting","free-value"],              text: "Reports are detailed enough for my accountant. Best-selling items, hourly trends, and profit margins all free. Cannot believe this costs nothing." },
      { author: "PubOwnerUK",     country: "GB", region: "europe", rating: 4, date: "Mar 2026", sentiment: "neutral",  themes: ["ease-of-use"],                        text: "Clean interface, works reliably. Would love more receipt customization and table management features but solid for the price point." },
      { author: "TiendaMX",       country: "MX", region: "north_america", rating: 4, date: "Mar 2026", sentiment: "neutral",  themes: ["inventory"],                          text: "Inventory management is good but low-stock notifications could be smarter. Would like automatic reorder suggestions. Still the best free option." },
      { author: "NoodleBarSG",    country: "SG", region: "asia", rating: 3, date: "Mar 2026", sentiment: "neutral",  themes: ["sync"],                               text: "Works well most of the time. Occasional sync delays between tablet and phone during lunch rush. Restarting the app fixes it but costs time." },
      { author: "WineshopDE",     country: "DE", region: "europe", rating: 2, date: "Mar 2026", sentiment: "negative", themes: ["customer-support"],                   text: "Emailed support twice about a receipt printing issue. First reply took 9 days with a generic link. Still unresolved after 3 weeks." },
      { author: "PharmacyMM",     country: "MM", region: "asia", rating: 2, date: "Mar 2026", sentiment: "negative", themes: ["customer-support","sync"],             text: "Inventory sync between two registers keeps breaking. Support ticket open for 12 days with no meaningful response. Very frustrating." },
      { author: "TapasBarES",     country: "ES", region: "europe", rating: 1, date: "Mar 2026", sentiment: "negative", themes: ["payment-integration"],                text: "Spent three weeks trying to set up card payments. Documentation is outdated and support responses are copy-paste templates. Gave up." },
      { author: "DeliUS",         country: "US", region: "north_america", rating: 2, date: "Mar 2026", sentiment: "negative", themes: ["payment-integration","customer-support"], text: "Adding employees costs $300 per year which is ridiculous for a small deli. Payment fees not transparent. Support took a week to respond." },
      { author: "StreetFoodTH",   country: "TH", region: "asia", rating: 1, date: "Mar 2026", sentiment: "negative", themes: ["sync","customer-support"],             text: "Kitchen display sync failed during dinner service. Lost orders and had angry customers. Support acknowledged the bug but no fix in sight." }
    ],
    appStore: [
      { author: "BoutiqueBK",    country: "US", region: "north_america", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["ease-of-use","reporting"],             text: "Switched from Square last month. Interface is cleaner, reports make more sense, and my accountant loves the export options. Wish I had switched sooner." },
      { author: "CafeSydney",    country: "AU", region: "oceania", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["free-value","ease-of-use"],            text: "Running my coffee shop entirely on Loyverse for 2 years now. Free, reliable, and my staff picks it up instantly. Absolutely incredible value." },
      { author: "ChainMY",       country: "MY", region: "asia", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["inventory","reporting"],               text: "Managing 4 locations seamlessly. Multi-store inventory sync and per-location reports are brilliant. This would cost hundreds elsewhere." },
      { author: "HealthFoodCA",  country: "CA", region: "north_america", rating: 5, date: "Mar 2026", sentiment: "positive", themes: ["ease-of-use","free-value"],            text: "Simple, clean, and genuinely free. Set up my organic shop in 45 minutes. Cannot understand why anyone would pay for basic POS." },
      { author: "BrunchATX",     country: "US", region: "north_america", rating: 4, date: "Mar 2026", sentiment: "positive", themes: ["reporting"],                          text: "Sales reports are great and training new hires takes 15 minutes. Would be 5 stars but advanced analytics require a paid add-on." },
      { author: "FruitStandPH",  country: "PH", region: "asia", rating: 4, date: "Mar 2026", sentiment: "neutral",  themes: ["inventory"],                          text: "Good overall but bulk product import from spreadsheets would save me hours. Entering 500 items one by one was painful." },
      { author: "BarberUK",      country: "GB", region: "europe", rating: 3, date: "Mar 2026", sentiment: "neutral",  themes: ["payment-integration"],                text: "POS works great for tracking appointments and sales. Setting up integrated payments was confusing — clearer in-app guidance would help." },
      { author: "NightMktTH",    country: "TH", region: "asia", rating: 3, date: "Mar 2026", sentiment: "neutral",  themes: ["sync"],                               text: "Mostly good but items sometimes take a minute to sync across devices. During busy market nights this causes double entries." },
      { author: "BistroLyon",    country: "FR", region: "europe", rating: 2, date: "Mar 2026", sentiment: "negative", themes: ["customer-support"],                   text: "Email-only support with 5 to 7 day response times is not acceptable for a business tool. Had a register issue on a Friday, resolved the next Thursday." },
      { author: "FarmStandUS",   country: "US", region: "north_america", rating: 1, date: "Mar 2026", sentiment: "negative", themes: ["payment-integration","customer-support"], text: "Card reader stopped pairing on a busy Saturday. No way to reach anyone. Lost a full day of card sales. Completely unacceptable for a business." },
      { author: "HawkerSG",     country: "SG", region: "asia", rating: 2, date: "Mar 2026", sentiment: "negative", themes: ["sync","customer-support"],             text: "Menu updates do not always push to the kitchen display. Had to manually restart 3 times this week. Support ticket still open after 10 days." },
      { author: "TacosMX",      country: "MX", region: "north_america", rating: 1, date: "Mar 2026", sentiment: "negative", themes: ["payment-integration"],                text: "Payment setup guide references screens that no longer exist in the app. Support sent me a 2024 PDF. Gave up on integrated payments." }
    ]
  },

  // ── Country weights (% of total metrics attributable to each market) ────────
  // Used by filters to approximate per-region metrics from aggregate data.
  // Will be replaced by real per-country data when Snowflake is connected.
  countryWeights: {
    TH: 0.152, PH: 0.138, MX: 0.105, MY: 0.104, SA: 0.058, US: 0.054,
    MM: 0.034, GB: 0.033, ES: 0.029, SG: 0.016, ID: 0.042, VN: 0.035,
    IN: 0.038, DE: 0.022, FR: 0.018, IT: 0.015, PT: 0.008, NL: 0.007,
    PL: 0.006, CA: 0.012, BR: 0.025, AR: 0.010, CO: 0.008, CL: 0.005,
    PE: 0.004, AE: 0.012, QA: 0.004, KW: 0.003, BH: 0.002,
    ZA: 0.008, NG: 0.006, KE: 0.004, EG: 0.005,
    AU: 0.010, NZ: 0.003
  },

  // ── Region-to-country mapping (mirrors REGION_COUNTRIES in index.html) ──────
  regionCountries: {
    asia:          ["TH","PH","MY","MM","SG","ID","VN","IN"],
    europe:        ["GB","ES","DE","FR","IT","PT","NL","PL"],
    north_america: ["US","MX","CA"],
    south_america: ["BR","AR","CO","CL","PE"],
    middle_east:   ["SA","AE","QA","KW","BH"],
    africa:        ["ZA","NG","KE","EG"],
    oceania:       ["AU","NZ"]
  }
};
