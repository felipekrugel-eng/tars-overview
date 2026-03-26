// ─── TARS DRILL-DOWN DATA ───────────────────────────────────────────────────
const TARS_DATA = {

  initiatives: {
    payments: {
      name: "Payments — US Pilot",
      color: "#1D8FE1",
      owner: "Simon", ownerInitial: "S", ownerColor: "#1D8FE1",
      progress: 50, total: 12, done: 6, inProgress: 4, overdue: 2,
      target: "Launch Q2 2026",
      context: "Building payment infrastructure for US market entry. Focus on Stripe integration, regulatory compliance, and merchant onboarding for the pilot cohort of 15 merchants.",
      milestones: [
        { label: "Infrastructure scoping complete",   status: "done",     date: "Jan 2026" },
        { label: "US legal entity review",            status: "done",     date: "Feb 2026" },
        { label: "Pilot merchant selection (15)",     status: "done",     date: "Feb 2026" },
        { label: "Billing system evaluation",         status: "active",   date: "Mar 2026" },
        { label: "Pilot launch",                      status: "upcoming", date: "Q2 2026"  }
      ],
      actions: [
        { id: "A-260316-01", text: "Evaluate billing systems & Stripe account management for multi-currency UK/US pilots", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "in-progress" },
        { id: "A-260316-04", text: "Define payment infrastructure technical architecture and vendor shortlist for US pilot", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "in-progress" },
        { id: "A-260316-05", text: "Prepare state-by-state regulatory compliance checklist for US payment processing", owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "25 Mar", status: "in-progress" },
        { id: "A-260130-01", text: "Define KPIs and success metrics for the US payments pilot cohort", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "10 Mar", status: "done" },
        { id: "A-260130-02", text: "Review Adyen & Stripe commercial terms and negotiate preferred rates for pilot volume", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "5 Mar",  status: "done" },
        { id: "A-260130-03", text: "Draft US payments product roadmap v1 including feature parity with EU offering", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "1 Mar",  status: "done" },
        { id: "A-260130-04", text: "Identify and qualify top 15 US merchant candidates for payments pilot programme", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Feb", status: "done" },
        { id: "A-260130-05", text: "Set up US legal entity review and incorporation timeline with external counsel", owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "15 Mar", status: "done" },
        { id: "A-260130-06", text: "Assess payment terminal hardware requirements and logistics for US pilot merchants", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "12 Mar", status: "done" },
        { id: "A-260130-07", text: "Map out US merchant onboarding flow and KYC/AML requirements for payments sign-up", owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "8 Mar",  status: "overdue" },
        { id: "A-260130-08", text: "Create unit economics model for US pilot — CAC, LTV, and payback period by merchant tier", owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue" },
        { id: "A-260323-01", text: "Provide UK company details for Shopify contract setup: Company name, address, Signer Name, Title, Email, and Phone number. UK entity to be used for pilot — no US bank account established yet. Stripe UK account has KYC complete and will be the live account for pilot due to US entity issues on Teya side.", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "in-progress" },
      ]
    },
    pricing: {
      name: "Pricing Policy",
      color: "#E1A21D",
      owner: "Caio", ownerInitial: "C", ownerColor: "#E1A21D",
      progress: 14, total: 7, done: 1, inProgress: 1, overdue: 5,
      target: "Launch Q2 2026",
      context: "Designing a new tiered pricing model across all markets. Moving from a free-only model to freemium with paid tiers targeting power users and multi-location merchants. Pilot rollout in Switzerland, Australia and Nigeria.",
      milestones: [
        { label: "Competitive benchmarking", status: "done",     date: "Feb 2026" },
        { label: "New model design",         status: "active",   date: "Mar 2026" },
        { label: "Board alignment",          status: "upcoming", date: "Apr 2026" },
        { label: "Rollout — CH, AU, NG",     status: "upcoming", date: "Q2 2026"  },
        { label: "Global rollout",           status: "upcoming", date: "Q3 2026"  }
      ],
      actions: [
        { id: "A-260316-06", text: "Finalise new pricing model narrative and drive alignment on CH, AU & NG rollout sequence", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "in-progress" },
        { id: "A-260130-09", text: "Benchmark competitor pricing across SEA and MENA — Shopify, Square, iZettle comparison", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Feb", status: "done" },
        { id: "A-260316-07", text: "Model revenue impact of tiered pricing across all top 10 markets with sensitivity analysis", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "30 Mar", status: "overdue" },
        { id: "A-260130-10", text: "Conduct merchant survey on pricing sensitivity — target 200 responses across 5 markets", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "1 Mar",  status: "overdue" },
        { id: "A-260130-11", text: "Draft pricing transition communication plan for all existing free-tier users globally", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "10 Mar", status: "overdue" },
        { id: "A-260130-12", text: "Define free vs paid feature boundary for new pricing model — feature matrix v1", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "5 Mar",  status: "overdue" },
        { id: "A-260130-13", text: "Prepare board presentation on pricing strategy with competitive positioning and projections", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "15 Mar", status: "overdue" }
      ]
    },
    partnerships: {
      name: "New Partnership Model",
      color: "#7B61FF",
      owner: "Felipe", ownerInitial: "F", ownerColor: "#7B61FF",
      progress: 75, total: 4, done: 3, inProgress: 1, overdue: 0,
      target: "Launch Q3 2026",
      context: "Building a structured channel partnership framework to accelerate merchant acquisition. Teya is the anchor partnership for EU payments distribution, with a broader tier-1 programme targeting 20 partners across EU and MENA.",
      milestones: [
        { label: "Target mapping complete (20 prospects)", status: "done",     date: "Feb 2026" },
        { label: "Framework document v1",                  status: "done",     date: "Feb 2026" },
        { label: "Teya proposal submitted",                status: "active",   date: "Mar 2026" },
        { label: "First partner signed",                   status: "upcoming", date: "Q2 2026"  },
        { label: "Channel programme launch",               status: "upcoming", date: "Q3 2026"  }
      ],
      actions: [
        { id: "A-260316-09", text: "Submit clear engagement proposal for Teya partnership with commercial terms and integration spec", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "in-progress" },
        { id: "A-260130-14", text: "Map out tier 1 partnership targets in EU and MENA — minimum 20 qualified prospects identified", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "15 Feb", status: "done" },
        { id: "A-260130-15", text: "Draft partnership framework document v1 including tiers, revenue share, and co-marketing terms", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "1 Mar",  status: "done" },
        { id: "A-260130-16", text: "Define revenue share model and partner enablement programme structure v1", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "10 Mar", status: "done" }
      ]
    }
  },

  // General Strategy actions (35 across all owners — shown in tracker drill-down)
  generalActions: [
    { id: "A-260316-GS01", text: "Prepare Q1 board update covering strategic milestones, OKR progress and 5YP trajectory", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "15 Mar", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS02", text: "Define 3-year product roadmap v2 aligned to Phase 2A payment and pricing initiatives",  owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Feb", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS03", text: "Draft investor pitch deck for Phase 2 funding round — highlight GTV and cohort data",  owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "1 Mar",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS04", text: "Align leadership team on Q2 priorities and resource allocation across all initiatives",  owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "5 Mar",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS05", text: "Facilitate strategy session #8 — review tracker, update priorities, assign Q2 sprint", owner: "Simon",  ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "in-progress", initiative: "General Strategy" },
    { id: "A-260316-GS06", text: "Review Q1 financial performance vs annual plan — variance analysis and reforecast",     owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "10 Mar", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS07", text: "Update 5-year financial model with Q1 actuals and revised projections for board",       owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "15 Mar", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS08", text: "Prepare Q2–Q3 cash flow forecast and working capital plan for leadership review",       owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS09", text: "Complete annual audit preparation and external auditor sign-off on FY2025 accounts",    owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "1 Feb",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS10", text: "Review and renew key vendor contracts — payment processors, cloud infrastructure, SaaS", owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "15 Feb", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS11", text: "Monthly metrics report — February 2026 including GTV, active users, and churn",         owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "5 Mar",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS12", text: "Benchmark operational costs and OPEX ratios against comparable SaaS and fintech peers",  owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "1 Mar",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS13", text: "Review headcount plan and approve Q2 engineering and product hires (4 positions)",       owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "10 Feb", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS14", text: "Update NRR and churn cohort analysis for Q1 — segment by market and merchant tier",     owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS15", text: "Map out legal and tax structure for Phase 2 expansion into US, CH, AU and NG markets",  owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "8 Mar",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS16", text: "Prepare Q1 2026 shareholder update with financial highlights and initiative status",     owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "22 Mar", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS17", text: "Review and approve updated data privacy framework for GDPR and PDPA compliance",        owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "15 Jan", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS18", text: "Complete KYC/AML policy review and update for expansion into regulated payment markets", owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "5 Feb",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS19", text: "Close annual performance reviews for leadership team and prepare calibration summary",   owner: "Caio",   ownerColor: "#E1A21D", ownerInitial: "C", due: "28 Feb", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS20", text: "Build and qualify CRM database of 50 tier-1 enterprise prospects across target markets", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "30 Mar", status: "in-progress", initiative: "General Strategy" },
    { id: "A-260316-GS21", text: "Prepare go-to-market playbook for Q2 new market entries — templates and localisation",  owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "2 Apr",  status: "in-progress", initiative: "General Strategy" },
    { id: "A-260316-GS22", text: "Design competitive intelligence tracking framework and assign weekly monitoring owners",  owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "28 Mar", status: "in-progress", initiative: "General Strategy" },
    { id: "A-260316-GS23", text: "Develop thought leadership content calendar for H1 2026 — articles, webinars, events",   owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "15 Mar", status: "overdue",     initiative: "General Strategy" },
    { id: "A-260316-GS24", text: "Create full market entry assessment for Brazil — regulatory, competitive, TAM analysis",  owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "10 Mar", status: "overdue",     initiative: "General Strategy" },
    { id: "A-260316-GS25", text: "Build weekly operational KPI dashboard v2 with real-time GTV and payment metrics",       owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "10 Feb", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS26", text: "Automate monthly GTV reporting pipeline across all 10 markets — replace manual process", owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS27", text: "Rebuild cohort retention analysis model to support 12-month rolling window by market",   owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "1 Mar",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS28", text: "Complete Q4 2025 data quality audit across all production databases — 0 critical issues", owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "15 Jan", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS29", text: "Build merchant churn prediction model v1 — identify top 20 at-risk accounts per quarter", owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "5 Mar",  status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS30", text: "Redesign support ticket routing system with SLA tracking and escalation automation",      owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "28 Feb", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS31", text: "Create A/B testing framework for product decisions — define guardrail metrics",           owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "10 Mar", status: "done",        initiative: "General Strategy" },
    { id: "A-260316-GS32", text: "Automate daily health-check alerts for payment processing — latency and success rate",    owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "28 Mar", status: "in-progress", initiative: "General Strategy" },
    { id: "A-260316-GS33", text: "Fix data pipeline latency issues causing 4–6h delays in SEA market reporting",            owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "5 Mar",  status: "overdue",     initiative: "General Strategy" },
    { id: "A-260316-GS34", text: "Resolve duplicate merchant ID issues in production database — affects 340 records",        owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "1 Mar",  status: "overdue",     initiative: "General Strategy" },
    { id: "A-260316-GS35", text: "Complete GDPR compliance audit for all EU merchant data — export, deletion, portability",  owner: "Alex",   ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Mar", status: "overdue",     initiative: "General Strategy" }
  ]
};

// Build flat all-actions array from initiatives + general
TARS_DATA.allActions = (function() {
  var arr = [];
  ["payments","pricing","partnerships"].forEach(function(k) {
    TARS_DATA.initiatives[k].actions.forEach(function(a) {
      arr.push(Object.assign({}, a, { initiative: k.charAt(0).toUpperCase() + k.slice(1) }));
    });
  });
  TARS_DATA.generalActions.forEach(function(a) { arr.push(a); });
  return arr;
})();
