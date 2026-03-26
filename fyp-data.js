// ─── 5YP DATA ────────────────────────────────────────────────────────────────
const FYP_DATA = {
  period: "Q1 2026 · 5YP v4 Projections",
  lastUpdated: "2026-03-25",

  // Phase 1 only baseline (current state without Phase 2)
  phase1Only: {
    revenue2026: 3200000,
    gtvProjection2026: 45000000,
    cohortNPV: 180
  },

  // Cohort economics by model variant
  cohortEconomics: {
    software: {
      description: "Subscription + POS Model",
      npv: 216,
      arpc: 45,
      paybackMonths: 18,
      grossMargin: 0.72
    },
    payments: {
      description: "Take Rate Model (2.9% + $0.30)",
      npv: 360,
      arpc: 180,
      paybackMonths: 12,
      grossMargin: 0.68
    },
    target: {
      description: "Target Blended (50/50 mix)",
      npv: 288,
      arpc: 112.50,
      paybackMonths: 15,
      grossMargin: 0.70
    }
  },

  // Revenue projection across timeline (€M) — from financial_model.md
  revenueProjection: {
    years:      [2025, 2026, 2027, 2028, 2029, 2030],
    addOn:      [7.6,  9.3,  11.3, 13.2, 14.8, 16.5],
    payments:   [0.2,  0.1,  1.5,  4.8,  9.4,  14.5],
    newPricing: [0.0,  0.3,  3.1,  11.0, 29.6, 47.4],
    total:      [7.6,  9.7,  15.9, 29.0, 53.8, 78.4],
    yoyGrowth:  ["26.0%","27.6%","63.9%","82.4%","85.5%","45.7%"]
  },

  // GTV projection across timeline (€B) — from financial_model.md
  gtvProjection: {
    years:  [2025, 2026, 2027, 2028, 2029, 2030],
    values: [26.9, 30.9, 38.7, 45.9, 52.8, 59.9]
  },

  // Cohort maturity curve (% of peak cohort size)
  cohortCurve: [
    { month: 0, retention: 100, contribution: 0 },
    { month: 3, retention: 92, contribution: 8 },
    { month: 6, retention: 85, contribution: 18 },
    { month: 12, retention: 78, contribution: 42 },
    { month: 18, retention: 72, contribution: 68 },
    { month: 24, retention: 68, contribution: 85 },
    { month: 36, retention: 65, contribution: 100 }
  ],

  // Phase milestones
  phases: [
    {
      id: "2A",
      name: "2A ACTIVE",
      status: "active",
      startDate: "Q2 2025",
      targetDate: "Q4 2025",
      description: "Multi-location inventory sync, advanced reporting, staff roles & permissions",
      investmentMM: 2.8,
      expectedArpc: 45,
      expectedAdoptionRate: 0.35,
      expectedNPV: 216,
      color: "#2DC46B"
    },
    {
      id: "2B",
      name: "2B UPCOMING",
      status: "upcoming",
      startDate: "Q1 2026",
      targetDate: "Q3 2026",
      description: "Payment integration framework, terminal partnerships, take rate economics",
      investmentMM: 4.2,
      expectedArpc: 180,
      expectedAdoptionRate: 0.22,
      expectedNPV: 360,
      color: "#1D8FE1"
    },
    {
      id: "2C",
      name: "2C PLANNED",
      status: "planned",
      startDate: "Q4 2026",
      targetDate: "Q2 2027",
      description: "Customer analytics platform, loyalty programs, vendor ecosystem",
      investmentMM: 5.1,
      expectedArpc: 95,
      expectedAdoptionRate: 0.18,
      expectedNPV: 280,
      color: "#1578C4"
    }
  ],

  // Benchmarks table
  benchmarks: [
    {
      metric: "Gross Margin",
      phase1: "68%",
      target2026: "69%",
      ytd: "67%",
      industry: "71%",
      delta: "-2%"
    },
    {
      metric: "CAC Payback",
      phase1: "16 mo",
      target2026: "14 mo",
      ytd: "17 mo",
      industry: "13 mo",
      delta: "+1 mo"
    },
    {
      metric: "NRR",
      phase1: "108%",
      target2026: "115%",
      ytd: "106%",
      industry: "118%",
      delta: "-3%"
    },
    {
      metric: "Churn Rate",
      phase1: "2.8%",
      target2026: "2.2%",
      ytd: "3.1%",
      industry: "2.5%",
      delta: "+0.6%"
    },
    {
      metric: "ARPC",
      phase1: "$45",
      target2026: "$67",
      ytd: "$52",
      industry: "$78",
      delta: "-$11"
    }
  ]
};
