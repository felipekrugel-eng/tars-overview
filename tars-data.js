// ─── TARS DRILL-DOWN DATA ───────────────────────────────────────────────────
// Auto-synced from Action Tracker on 2026-03-26
const TARS_DATA = {

  initiatives: {
    payments: {
      name: "Payments — US Pilot",
      color: "#1D8FE1",
      owner: "Simon", ownerInitial: "S", ownerColor: "#1D8FE1",
      progress: 50, total: 14, done: 7, inProgress: 3, overdue: 4,
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
      { id: "A-260206-01", text: "Book time Mon–Thu to discuss Stripe Mexico preview launch", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Feb", status: "done" },
      { id: "A-260213-02", text: "Talk to Bevon to understand how yo-yo operates (vs payments model)", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done" },
      { id: "A-260213-04", text: "Report back on back-office processes at Payments after calls with People team, Flur, People Ops, Comp & TA", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done" },
      { id: "A-260213-08", text: "Visit Brazilian customer in London", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "21 Feb", status: "done" },
      { id: "A-260220-05", text: "Gather payment-side data on Milk No Milk customer", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "24 Feb", status: "done" },
      { id: "A-260306-06", text: "Add comments to strategy document via Google Docs", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Mar", status: "done" },
      { id: "A-260316-07", text: "Identify expert contacts with Google and Apple payment platform compliance experience", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue" },
      { id: "A-260316-14", text: "Support Snowflake data migration and historical/chargeback data transfer with Dimitri", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "23 Mar", status: "overdue" },
      { id: "A-260316-15", text: "Assist Simon and Felipe with Stripe/payment processing on UK and US accounts", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "23 Mar", status: "overdue" },
      { id: "A-260323-01", text: "Provide UK company details for Shopify contract setup to Simon", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue" },
      { id: "A-260324-01", text: "Sign amendment to include Loyverse US with the contracted pricing", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Mar", status: "in-progress" },
      { id: "A-260324-02", text: "Discussion on whether UK customers should be used for pilot due to US legal entity issues", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "in-progress" },
      { id: "A-260324-03", text: "Complete RFP for external legal counsel in US", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "1 Apr", status: "done" },
      { id: "A-260325-01", text: "Test Teya SIM-cards in Stripe devices to reduce Stripe costs of $10/month", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "7 Apr", status: "in-progress" }
      ]
    },
    pricing: {
      name: "Pricing Policy",
      color: "#E1A21D",
      owner: "Caio", ownerInitial: "C", ownerColor: "#E1A21D",
      progress: 0, total: 9, done: 0, inProgress: 2, overdue: 7,
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
      { id: "A-260306-01", text: "Finalize narrative proposal for new pricing model trial by end of week", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
      { id: "A-260306-02", text: "Share document on seven potential directions to evolve the S-curve", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "9 Mar", status: "overdue" },
      { id: "A-260306-03", text: "Prepare pricing options and positioning for Swiss pilot (include Kassensichv and other compliance aspects)", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
      { id: "A-260306-04", text: "Map Loyverse product to G60 tax compliance regulation for Swiss market", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
      { id: "A-260306-05", text: "Draft communication plan for pricing rollout: who to communicate to, in what sequence", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
      { id: "A-260306-09", text: "Design trust-building programme for app store ratings and reviews", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue" },
      { id: "A-260306-10", text: "Create landing pages and content for new pricing model and partnerships", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue" },
      { id: "A-260324-04", text: "Confirm final payment pricing proposal for US customers with the team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "in-progress" },
      { id: "A-260325-02", text: "Build out product list in Shopify with final pricing. Blocked by A-260324-04.", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "31 Mar", status: "in-progress" }
      ]
    },
    partnerships: {
      name: "New Partnership Model",
      color: "#7B61FF",
      owner: "Felipe", ownerInitial: "F", ownerColor: "#7B61FF",
      progress: 75, total: 4, done: 3, inProgress: 0, overdue: 1,
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
      { id: "A-260213-07", text: "Draft partnership proposal framework document", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done" },
      { id: "A-260220-07", text: "Share full list of partner payment inquiries with Simon for strategy research", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done" },
      { id: "A-260306-08", text: "Develop structured channel partnership framework (including criteria and responsibilities for Tier-1 partners)", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Mar", status: "done" },
      { id: "A-260316-06", text: "Develop and submit clear engagement proposal for Teya partnership", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue" }
      ]
    }
  },

  generalActions: [
    { id: "A-260316-01", text: "Finalise financial model (v3.1) and share with team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "16 Mar", status: "done", initiative: "General Strategy" },
    { id: "A-260130-01", text: "Research whether fiscalization is required to distribute software in Brazil", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260130-02", text: "Send notes to group, propose structure for the plan, consolidate documents and share ideas weekly", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260130-03", text: "Invite Felipe for Monday meeting with Alex to discuss working environment setup", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260130-04", text: "Send daily calendar invitations (2–3 PM UK time) for continuous strategy collaboration", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260206-02", text: "Research AI market analysis tools and alternatives to ChatGPT for internal strategy work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "13 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260206-03", text: "Define and draw out customer personas, clearly identifying their needs", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260206-04", text: "Prepare cashflow projections (monthly) for the first year of the plan", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260206-05", text: "Revise financial model to include NPV per new user in each of the top 10 markets", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260213-01", text: "Prepare one-slide summary of top 10 markets by revenue vs cost from financial model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260213-03", text: "Present Singapore and UK cohort analysis using local regulatory and financial context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260213-05", text: "Book call with marketing agency (Favoured) and prepare Loyverse onboarding context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260213-06", text: "Bring competitive landscape analysis (feature comparison + pricing) to next session", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260220-01", text: "Finalize 3-month execution budget aligned to cash flow model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260220-02", text: "Produce written document outlining the 5 prioritized personas with evidence and logic", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260220-03", text: "Assemble list of AI tools to be operationalized across teams", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260220-04", text: "Present competitive benchmarking data: Lightspeed and other POS players, including customer count and breakdown", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "27 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260220-06", text: "Share five customer personas, slide deck, and three merchant case summaries in group folder", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260227-01", text: "Finalize financial tool by adding new growth charts", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done", initiative: "General Strategy" },
    { id: "A-260227-02", text: "Share updated financial spreadsheet with group; update tool based on feedback", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "General Strategy" },
    { id: "A-260227-03", text: "Add cohort 25 baseline to the financial data", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Mar", status: "done", initiative: "General Strategy" },
    { id: "A-260227-04", text: "Prepare initial competitive product gap analysis vs top 3 competitors", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "6 Mar", status: "done", initiative: "General Strategy" },
    { id: "A-260227-05", text: "Set up Robert Walters as recruitment partner for UK operations role", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "6 Mar", status: "done", initiative: "General Strategy" },
    { id: "A-260227-06", text: "Confirm whether fixing Sep–Dec 2025 numbers will block upcoming execution work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Mar", status: "done", initiative: "General Strategy" },
    { id: "A-260227-07", text: "Compile exercises from Alex and Simon on customers; produce synthesis document", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done", initiative: "General Strategy" },
    { id: "A-260306-07", text: "Provide update on Brex card onboarding and new cards for team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260306-11", text: "Write first draft of SAP partnership proposal document", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-02", text: "Push for resolution on Snowflake migration timeline with data team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-03", text: "Continue competitive benchmarking and prepare summary of key gaps in product", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-04", text: "Draft terms of reference for Loyverse business plan project phase", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-05", text: "Draft initial product requirements document (PRD) for the new pricing module", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-08", text: "Coordinate Snowflake data migration and Claude AI integration meeting", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-09", text: "Continue developing AI-powered notes and task automation agent", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-10", text: "Manage procurement of additional corporate cards for team", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-11", text: "Confirm SAP entity integration approach; engage external contractor if required", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-12", text: "Add Dimitri to Claude AI team account", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "18 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260316-13", text: "Provide and validate budget figures and cost/revenue projections for Caio", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "18 Mar", status: "overdue", initiative: "General Strategy" },
    { id: "A-260324-05", text: "Prepare discussion topics for Friday: From POS to BOSS and From Integrations to Plug-Ins", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "27 Mar", status: "in-progress", initiative: "General Strategy" }
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
