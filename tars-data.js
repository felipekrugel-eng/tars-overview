const TARS_DATA = {
  lastUpdated: "2026-04-22",

  // LAYER 1: Strategic Initiatives
  initiatives: [
    {
      id: "payments"
      name: "Embedded Payments â US Launch",
      owner: "Simon Perry",
      ownerInitial: "S",
      ownerColor: "#1D8FE1",
      phase: "Pilot â Pre-Launch",
      health: "at-risk",
      healthReason: "Working demo complete but security and tip issues flagged as pre-launch blockers. US pricing not finalized. US Deepdive meeting scheduled Wed 1 Apr.",
      milestones: [
        { id: "m1", name: "Stripe terminal integration demonstrated", status: "complete", date: "27 Mar 2026", notes: "Pay Demo 27 Mar â functional but issues flagged" },
        { id: "m2", name: "Pre-launch blockers resolved (security, tps)", status: "in-progress", date: "15 Apr 2026", notes: "Oleksandr: export validation. Dmytro: tip handling investigation" },
        { id: "m3", name: "US pricing model validated", status: "not-started", date: null, notes: "3% flat rate proposed (Session 09). Dedicated meeting TBD." },
        { id: "m4", name: "First merchant processing payment", status: "not-started", date: null, notes: "Pending KYC + pricing + billing infrastructure" },
        { id: "m5", name: "5,000 customers on payments + software", status: "not-started", date: "Dec 2026", notes: "Caio's headline proof point for scaling and capital raise" }
      ],
      latestDecision: "US pricing: 3% flat rate with surcharging options recommended (Session 09, 27 Mar)",
      nextDecisionPoint: "Confirm US pricing approach â Loyverse US Deepdive scheduled Tue 1 Apr, 4 PM BST (5 attendees)",
      context: "Caio proposed 100% US focus until 5K customers proven. Simon suggested 3% flat rate. Alex prefers Mexico given 50% organic growth. Debit card issuance feasible but needs US legal entity (~2-3 months).",
      actions: [
        { id: "A-260206-01", text: "Book time MonâThu to discuss Stripe Mexico preview launch", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Feb", status: "done", initiative: "payments" },
        { id: "A-260213-02", text: "Talk to Bevon to understand how yo-yo operates (vs payments model)", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done", initiative: "payments" },
        { id: "A-260213-04", text: "Report back on back-office processes at Payments", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done", initiative: "payments" },
        { id: "A-260213-08", text: "Visit Brazilian customer in London", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "21 Feb", status: "done", initiative: "payments" },
        { id: "A-260220-05", text: "Gather payment-side data on Milk No Milk customer", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "24 Feb", status: "done", initiative: "payments" },
        { id: "A-260306-06", text: "Add comments to strategy document via Google Docs", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Mar", status: "done", initiative: "payments" },
        { id: "A-260316-07", text: "Identify expert contacts with Google and Apple payment platform compliance experience", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260316-14", text: "Support Snowflake data migration and historical/chargeback data transfer with Dimitri", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260316-15", text: "Assist Simon and Felipe with Stripe/payment processing on UK and US accounts", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260323-01", text: "Provide UK company details for Shopify contract setup to Simon", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260324-01", text: "Sign amendment to include Loyverse US with the contracted pricing", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Mar", status: "done", initiative: "payments" },
        { id: "A-260324-02", text: "Discussion on whether UK customers should be used for pilot due to US legal entity issues", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260324-03", text: "Complete RFP for external legal counsel in US", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "1 Apr", status: "done", initiative: "payments" },
        { id: "A-260325-01", text: "Test Teya SIM-cards in Stripe devices to reduce Stripe costs of $10/month", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "7 Apr", status: "overdue", initiative: "payments" },
        { id: "A-260327-06", text: "Book dedicated US payments strategy meeting (next week)", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "31 Mar", status: "done", initiative: "payments" },
        { id: "A-260327-07", text: "Provide real-world US receipts (Toast, Square) for tip/tax validation", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "7 Apr", status: "overdue", initiative: "payments" },
        { id: "A-260409-01", text: "Shape communication strategy for Loyverse payments launch with Simon", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "16 Apr", status: "overdue", initiative: "payments" },
        { id: "A-260409-02", text: "Build country launch playbook \u2014 US as version one", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "30 Apr", status: "in-progress", initiative: "payments" },
        { id: "A-260417-01", text: "Set up US legal entity (bank accounts, compliance, Stripe integration) — operational by July 1", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "1 Jul", status: "in-progress", initiative: "payments" },
        { id: "A-260417-02", text: "Resolve hardware procurement process (in-house or agile partners, corporate credit cards)", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "30 Apr", status: "overdue", initiative: "payments" },
        { id: "A-260417-03", text: "Validate metrics pipeline (Stripe Sigma + Snowflake dashboards)", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "25 Apr", status: "in-progress", initiative: "payments" }
      ]
    },
    {
      id: "pricing",
      name: "New Pricing Policy",
      owner: "Caio Fiuza",
      ownerInitial: "C",
      ownerColor: "#E1A21D",
      phase: "Design",
      health: "at-risk",
      healthReason: "Swiss analysis complete but no execution started. Pilot markets may shift based on US-first discussion. No pricing engine scoped yet.",
      milestones: [
        { id: "p1", name: "Swiss market analysis complete", status: "complete", date: "25 Mar 2026", notes: "Dashboard live at loyverse-pricing-ch.netlify.app" },
        { id: "p2", name: "Pilot markets confirmed", status: "not-started", date: null, notes: "Previously CH/AU/NG â may shift to US-first after dedicated meeting" },
        { id: "p3", name: "Pricing/billing engine built", status: "not-started", date: null, notes: "Simon owns billing infrastructure" },
        { id: "p4", name: "First cohort on new pricing model", status: "not-started", date: null, notes: "" },
        { id: "p5", name: "Cohort NPV validated at 2x+", status: "not-started", date: null, notes: "Core Phase 2A proof point" }
      ],
      latestDecision: "Pricing pilots in CH, AU, NG approved (Session 08, 20 Mar) â may be revised",
      nextDecisionPoint: "Whether to couple pricing rollout with US payments launch or keep separate pilot markets",
      context: "0.2% of GTV above $3,000/month threshold with hard cap. Swiss analysis shows competitive positioning. Execution blocked on billing engine and market confirmation.",
      actions: [
        { id: "A-260306-01", text: "Finalize narrative proposal for new pricing model trial by end of week", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-02", text: "Share document on seven potential directions to evolve the S-curve", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "9 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-03", text: "Prepare pricing options and positioning for Swiss pilot", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-04", text: "Map Loyverse product to G60 tax compliance regulation for Swiss market", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-05", text: "Draft communication plan for pricing rollout", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-09", text: "Design trust-building programme for app store ratings and reviews", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-10", text: "Create landing pages and content for new pricing model and partnerships", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260324-04", text: "Confirm final payment pricing proposal for US customers with the team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260325-02", text: "Build out product list in Shopify with final pricing. Blocked by A-260324-04.", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "31 Mar", status: "overdue", initiative: "pricing" }
      ]
    },
    {
      id: "partnerships",
      name: "Partnerships Reloaded",
      owner: "TBD",
      ownerInitial: "?",
      ownerColor: "#7B61FF",
      phase: "Not Started",
      health: "blocked",
      healthReason: "No owner assigned. No programme design started. Teya integration confirmed for Q3 but no visible progress or plan shared.",
      milestones: [
        { id: "r1", name: "Partner programme design complete", status: "not-started", date: null, notes: "Three partner types: local solution, marketplace/software, infrastructure" },
        { id: "r2", name: "First local solution partners onboarded", status: "not-started", date: null, notes: "" },
        { id: "r3", name: "Teya integration live", status: "not-started", date: "Q3 2026", notes: "Q3 2026 target confirmed Session 08" },
        { id: "r4", name: "Partner-sourced merchant activation >30%", status: "not-started", date: null, notes: "Phase 2B target" }
      ],
      latestDecision: "Q3 2026 partnership engine launch with Teya confirmed (Session 08, 20 Mar)",
      nextDecisionPoint: "Assign owner and define scope â no one is currently driving this",
      context: "Three-layer ecosystem: local solution partners (resellers/integrators), marketplace/software partners, infrastructure partners (PSPs/acquirers). Strategic role: scalable growth and monetisation engine without proportional headcount.",
      actions: [
        { id: "A-260213-07", text: "Draft partnership proposal framework document", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done", initiative: "partnerships" },
        { id: "A-260220-07", text: "Share full list of partner payment inquiries with Simon for strategy research", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "partnerships" },
        { id: "A-260306-08", text: "Develop structured channel partnership framework", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Mar", status: "done", initiative: "partnerships" },
        { id: "A-260316-06", text: "Develop and submit clear engagement proposal for Teya partnership", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue", initiative: "partnerships" },
        { id: "A-260409-03", text: "Book and conduct Teya Spain meeting with Pedro re: joint go-to-market", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "16 Apr", status: "done", initiative: "partnerships" }
      ]
    }
  ],

  // LAYER 2: General Backlog (non-initiative actions)
  generalBacklog: [
    { id: "A-260316-01", text: "Finalise financial model (v3.1) and share with team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "16 Mar", status: "done", initiative: "general" },
    { id: "A-260130-01", text: "Research whether fiscalization is required to distribute software in Brazil", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Feb", status: "done", initiative: "general" },
    { id: "A-260130-02", text: "Send notes to group, propose structure for the plan, consolidate documents and share ideas weekly", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Feb", status: "done", initiative: "general" },
    { id: "A-260130-03", text: "Invite Felipe for Monday meeting with Alex to discuss working environment setup", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done", initiative: "general" },
    { id: "A-260130-04", text: "Send daily calendar invitations (2â3 PM UK time) for continuous strategy collaboration", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done", initiative: "general" },
    { id: "A-260206-02", text: "Research AI market analysis tools and alternatives to ChatGPT for internal strategy work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260206-03", text: "Define and draw out customer personas, clearly identifying their needs", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260206-04", text: "Prepare cashflow projections (monthly) for the first year of the plan", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260206-05", text: "Revise financial model to include NPV per new user in each of the top 10 markets", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260213-01", text: "Prepare one-slide summary of top 10 markets by revenue vs cost from financial model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260213-03", text: "Present Singapore and UK cohort analysis using local regulatory and financial context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260213-05", text: "Book call with marketing agency (Favoured) and prepare Loyverse onboarding context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260213-06", text: "Bring competitive landscape analysis (feature comparison + pricing) to next session", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260220-01", text: "Finalize 3-month execution budget aligned to cash flow model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-02", text: "Produce written document outlining the 5 prioritized personas with evidence and logic", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-03", text: "Assemble list of AI tools to be operationalized across teams", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-04", text: "Present competitive benchmarking data: Lightspeed and other POS players", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-06", text: "Share five customer personas, slide deck, and three merchant case summaries", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260227-01", text: "Finalize financial tool by adding new growth charts", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-02", text: "Share updated financial spreadsheet with group; update tool based on feedback", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260227-03", text: "Add cohort 25 baseline to the financial data", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Mar", status: "done", initiative: "general" },
    { id: "A-260227-04", text: "Prepare initial competitive product gap analysis vs top 3 competitors", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-05", text: "Set up Robert Walters as recruitment partner for UK operations role", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-06", text: "Confirm whether fixing SepâDec 2025 numbers will block upcoming execution work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-07", text: "Compile exercises from Alex and Simon on customers; produce synthesis document", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260306-07", text: "Provide update on Brex card onboarding and new cards for team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Mar", status: "overdue", initiative: "general" },
    { id: "A-260306-11", text: "Write first draft of SAP partnership proposal document", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-02", text: "Push for resolution on Snowflake migration timeline with data team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-03", text: "Continue competitive benchmarking and prepare summary of key gaps in product", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-04", text: "Draft terms of reference for Loyverse business plan project phase", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-05", text: "Draft initial product requirements document (PRD) for the new pricing module", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-08", text: "Coordinate Snowflake data migration and Claude AI integration meeting", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-09", text: "Continue developing AI-powered notes and task automation agent", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-10", text: "Manage procurement of additional corporate cards for team", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-11", text: "Confirm SAP entity integration approach; engage external contractor if required", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-12", text: "Add Dimitri to Claude AI team account", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "18 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-13", text: "Provide and validate budget figures and cost/revenue projections for Caio", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "18 Mar", status: "overdue", initiative: "general" },
    { id: "A-260324-05", text: "Prepare discussion topics for Friday: From POS to BOSS and From Integrations to Plug-Ins", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "27 Mar", status: "overdue", initiative: "general" },
    { id: "A-260327-01", text: "Upgrade Netlify plan for security layer", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "7 Apr", status: "overdue", initiative: "general" },
    { id: "A-260327-02", text: "Refine TARS for main 2026 initiatives with clearer project steps", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "31 Mar", status: "done", initiative: "general" },
    { id: "A-260327-03", text: "Connect Confluence to TARS memory system", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "14 Apr", status: "overdue", initiative: "general" },
    { id: "A-260327-04", text: "Develop Snowflake-to-CASE dashboard integration", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "14 Apr", status: "done", initiative: "general" },
    { id: "A-260327-05", text: "Provide Snowflake access to Felipe and Caio", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "31 Mar", status: "overdue", initiative: "general" },
    { id: "A-260330-01", text: "Enable the Mixpanel MCP for Claude", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "7 Apr", status: "overdue", initiative: "general" },
    { id: "A-260330-02", text: "Enable data pipelines addon for Mixpanel to Snowflake", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "7 Apr", status: "overdue", initiative: "general" },
    { id: "A-260330-03", text: "Unlock the n8n connector in Claude", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "7 Apr", status: "overdue", initiative: "general" }
  ],

  // LAYER 3: Operations
  operations: {
    scheduledTasks: [
      { id: "daily-completion-check", purpose: "Monitor #strategy-feed for completed actions, update tracker", frequency: "Daily 5 PM (Mon-Fri)", owner: "TARS", status: "Active" },
      { id: "sync-tracker-to-html", purpose: "Regenerate tars-data.js, deploy to GitHub/Netlify", frequency: "Daily 5:53 PM", owner: "TARS", status: "Active" },
      { id: "monday-strategic-pulse", purpose: "Initiative health, pending decisions, strategic tensions, leadership focus", frequency: "Monday 10 AM", owner: "TARS", status: "Active" },
      { id: "drive-session-naming-audit", purpose: "Verify Strategic Sessions folder naming conventions", frequency: "Monday 9 AM", owner: "TARS", status: "Active" },
      { id: "thursday-strategic-preview", purpose: "The one question worth leadership's time, initiative shifts, unresolved tensions", frequency: "Thursday 4 PM", owner: "TARS", status: "Active" },
      { id: "thursday-strategy-deck", purpose: "Branded PPTX briefing with CASE metrics, 5YP context, initiative health, agenda", frequency: "Thursday 4:32 PM", owner: "TARS", status: "Active" },
      { id: "friday-meeting-briefing", purpose: "Process Fireflies transcripts, extract decisions and initiative impact", frequency: "Friday 4:39 PM", owner: "TARS", status: "Active" },
      { id: "weekly-strategy-tracker-update", purpose: "Extract decisions and milestones from strategy sessions, update initiatives + backlog", frequency: "Friday 7 PM", owner: "TARS", status: "Active" },
      { id: "weekly-memory-maintenance", purpose: "Consolidate working memory from Slack into Mem reference files", frequency: "Sunday 8 PM", owner: "Second Brain", status: "Active" },
      { id: "weekly-mem-update", purpose: "Fetch new Fireflies meetings, create/update Mem briefing notes", frequency: "Friday 8 PM", owner: "Second Brain", status: "Active" },
      { id: "appstore-data-pull", purpose: "Weekly pull of Loyverse app store ratings and reviews", frequency: "Monday 9 AM", owner: "CASE", status: "Active" },
      { id: "hiagent-monitor", purpose: "Monitor all scheduled tasks, update dashboard, alert on failures", frequency: "Every 4 hours", owner: "HIAgent", status: "Active" }
    ],
    weeklyRhythm: "Monday: Strategic Pulse (initiative health + decisions) â Daily: Completion checks + health signal scan â Thursday: Strategic Preview (meeting framing) â Friday: Meeting briefing + tracker update â Sunday: Memory maintenance",
    connectedPlatforms: [
      "Google Drive â strategy documents, tracker, session archives",
      "Slack â #strategy-feed, #cowork-memory, DMs",
      "Fireflies.ai â meeting capture and transcript processing",
      "Gmail â briefing drafts to leadership team",
      "Google Calendar â session scheduling",
      "Netlify â tars-overview.netlify.app (Command Centre)",
      "GitHub â felipekrugel-eng/tars-overview (auto-deploys to Netlify)",
      "Mem â Second Brain reference notes"
    ],
    howToInteract: "Post in #strategy-feed for natural language inputs. Use Slack DMs for status updates. Check tars-overview.netlify.app for the strategic overview. TARS processes Fireflies transcripts automatically every Friday."
  }
};

// âââ Build flat allActions from initiatives + generalBacklog ââââââââââââââ
(function() {
  var all = [];
  TARS_DATA.initiatives.forEach(function(init) {
    if (init.actions) {
      init.actions.forEach(function(a) { all.push(a); });
    }
  });
  TARS_DATA.generalBacklog.forEach(function(a) { all.push(a); });
  TARS_DATA.allActions = all;
})();

// âââ Initiative color/label helpers ââââââââââââââââââââââââââââââââââââââââââ
function _initiativeColor(key) {
  return key === "payments" ? "#1D8FE1" : key === "pricing" ? "#E1A21D" : key === "partnerships" ? "#7B61FF" : "#888";
}
function _initiativeLabel(key) {
  return key === "payments" ? "Payments" : key === "pricing" ? "Pricing" : key === "partnerships" ? "Partnerships" : "Gen. Strategy";
}

// âââ Action row renderer (old drill-down style) ââââââââââââââââââââââââââââââ
function _actionRow(a) {
  var statusLabel = a.status === "done" ? "Done" : a.status === "in-progress" ? "In Progress" : "Overdue";
  var iColor = _initiativeColor(a.initiative);
  var iLabel = _initiativeLabel(a.initiative);
  return '<div class="td-action-row">' +
    '<div>' +
      '<div class="td-action-id">' + a.id + '</div>' +
      '<div style="width:6px;height:6px;border-radius:50%;background:' + iColor + ';margin-top:8px;"></div>' +
    '</div>' +
    '<div style="flex:1;">' +
      '<div class="td-action-text">' + a.text + '</div>' +
      '<div class="td-action-meta">' +
        '<div class="td-action-avatar" style="background:' + a.ownerColor + '">' + a.ownerInitial + '</div>' +
        '<div class="td-action-owner-name">' + a.owner + '</div>' +
        '<div class="td-action-due">Â· due ' + a.due + '</div>' +
        '<span style="margin-left:auto;font-size:10px;color:' + iColor + ';font-weight:600;">' + iLabel + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="td-status-chip ' + a.status + '">' + statusLabel + '</div>' +
  '</div>';
}

// âââ Tab helper ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function _tab(filter, current, label, extraClass) {
  var cls = "td-tab" + (extraClass ? " " + extraClass : "") + (filter === current ? " active" : "");
  return '<div class="' + cls + '" data-filter="' + filter + '">' + label + '</div>';
}

// âââ RENDERING âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
document.addEventListener('DOMContentLoaded', function() {
  renderTARS();
});

function renderTARS() {
  // Initialize tab switching
  var tabButtons = document.querySelectorAll('.tars-tab-btn');
  tabButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tabName = this.getAttribute('data-tab');
      showTab(tabName);
    });
  });

  renderInitiatives();
  renderBacklog();

  // Sync KPI numbers and owner bars
  syncDashboard();

  // Dynamic hub tile numbers â count from actual data
  updateHubStats();
}

function updateHubStats() {
  // TARS: count task cards on the Operations tab (the meaningful weekly rhythm tasks)
  var taskCards = document.querySelectorAll('#tars-operations .task-card');
  var hubTars = document.getElementById('hub-tars-stat');
  if (hubTars && taskCards.length > 0) {
    hubTars.textContent = taskCards.length;
  }

  // Also update the section subtitle text to match
  var taskCountEl = document.getElementById('tars-ops-task-count');
  if (taskCountEl && taskCards.length > 0) {
    var numWords = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve'];
    var word = numWords[taskCards.length] || taskCards.length;
    taskCountEl.textContent = word + ' scheduled tasks covering the full weekly strategy cycle \u2014 from strategic pulse to session briefings. Click any card to see details.';
  }

  // TARS initiatives count from data
  var initCount = TARS_DATA.initiatives ? TARS_DATA.initiatives.length : 0;
  if (initCount > 0) {
    var liveSubEl = document.getElementById('tars-ops-live-sub');
    if (liveSubEl) {
      liveSubEl.textContent = initCount + ' active initiatives running in parallel. Progress reflects live data from the Action Tracker. Last sync: ' + TARS_DATA.lastUpdated + '.';
    }
  }

  // âââ TARS Hero "Last updated" badge (matches CASE pattern) âââââââââââââââââ
  var tarsUpdatedLabel = document.getElementById('tars-updated-label');
  if (tarsUpdatedLabel && TARS_DATA.lastUpdated) {
    tarsUpdatedLabel.textContent = 'Last updated: ' + TARS_DATA.lastUpdated;
  }
}

function showTab(tabName) {
  var tabButtons = document.querySelectorAll('.tars-tab-btn');
  var tabContents = document.querySelectorAll('.tars-tab-content');

  tabButtons.forEach(function(btn) { btn.classList.remove('active'); });
  tabContents.forEach(function(c) { c.classList.remove('active'); });

  document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
  document.getElementById('tars-' + tabName).classList.add('active');
}

// âââ INITIATIVES TAB âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function renderInitiatives() {
  var container = document.getElementById('tars-initiatives-grid');
  if (!container) return;
  _renderInitiativeGrid(container);
}

function _renderInitiativeGrid(container) {
  container.innerHTML = '';

  var grid = document.createElement('div');
  grid.className = 'tars-grid';

  TARS_DATA.initiatives.forEach(function(initiative) {
    var completedMilestones = initiative.milestones.filter(function(m) { return m.status === 'complete'; }).length;
    var totalMilestones = initiative.milestones.length;
    var milestoneProgress = completedMilestones + '/' + totalMilestones + ' milestones';

    var healthColor = initiative.health === 'blocked' ? '#CC3333' :
                      initiative.health === 'at-risk' ? '#E1A21D' : '#2DC46B';

    var card = document.createElement('div');
    card.className = 'tars-initiative-card';
    card.setAttribute('data-initiative', initiative.id);
    card.innerHTML =
      '<div class="tars-card-top-bar"></div>' +
      '<div class="tars-card-content">' +
        '<div class="tars-card-header">' +
          '<div class="tars-card-title">' + initiative.name + '</div>' +
          '<div class="tars-health-indicator" style="background-color: ' + healthColor + ';" title="' + initiative.healthReason + '"></div>' +
        '</div>' +
        '<div class="tars-card-meta">' +
          '<div class="tars-owner-badge" style="background-color: ' + initiative.ownerColor + ';">' + initiative.ownerInitial + '</div>' +
          '<div class="tars-phase-badge">' + initiative.phase + '</div>' +
          '<div class="tars-phase-badge" style="font-weight:700;">' + milestoneProgress + '</div>' +
        '</div>' +
        '<div class="tars-health-reason">' + initiative.healthReason + '</div>' +
      '</div>';

    // Click card â drill down
    (function(init) {
      card.addEventListener('click', function() {
        _renderInitiativeDrilldown(container, init);
      });
    })(initiative);

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

function _renderInitiativeDrilldown(container, initiative) {
  container.innerHTML = '';

  var barColor = initiative.id === 'payments' ? '#1D8FE1' : initiative.id === 'pricing' ? '#C47B10' : '#7B3FA0';
  var healthColor = initiative.health === 'blocked' ? '#CC3333' :
                    initiative.health === 'at-risk' ? '#E1A21D' : '#2DC46B';
  var completedMilestones = initiative.milestones.filter(function(m) { return m.status === 'complete'; }).length;
  var totalMilestones = initiative.milestones.length;

  var view = document.createElement('div');
  view.className = 'tars-drilldown';
  view.innerHTML =
    '<button class="tars-drilldown-back" id="tars-drill-back">&larr; All initiatives</button>' +

    '<div class="tars-drilldown-header">' +
      '<div class="tars-card-top-bar" style="background:' + barColor + ';"></div>' +
      '<div class="tars-drilldown-body">' +
        '<div class="tars-drilldown-meta">' +
          '<div class="tars-owner-badge" style="background-color:' + initiative.ownerColor + ';">' + initiative.ownerInitial + '</div>' +
          '<div class="tars-phase-badge">' + initiative.phase + '</div>' +
          '<div class="tars-health-indicator" style="background-color:' + healthColor + ';" title="Health"></div>' +
          '<span style="font-size:12px;color:#888;font-weight:600;">' + completedMilestones + '/' + totalMilestones + ' milestones complete</span>' +
        '</div>' +
        '<div class="tars-drilldown-title">' + initiative.name + '</div>' +
        '<div class="tars-drilldown-reason">' + initiative.healthReason + '</div>' +
        '<div class="tars-drilldown-decisions">' +
          '<div class="tars-decision-box">' +
            '<div class="tars-decision-label">Latest Decision</div>' +
            '<div class="tars-decision-text">' + initiative.latestDecision + '</div>' +
          '</div>' +
          '<div class="tars-decision-box">' +
            '<div class="tars-decision-label">Next Decision Point</div>' +
            '<div class="tars-decision-text">' + initiative.nextDecisionPoint + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="tars-drilldown-sections">' +
      '<div class="tars-drilldown-section">' +
        '<div class="tars-drilldown-section-title">Context</div>' +
        '<div style="font-size:14px;color:#444;line-height:1.6;">' + initiative.context + '</div>' +
      '</div>' +
      '<div class="tars-drilldown-section">' +
        '<div class="tars-drilldown-section-title">Milestones</div>' +
        '<div class="tars-milestones-list">' +
          initiative.milestones.map(function(m) {
            var statusColor = m.status === 'complete' ? '#2DC46B' : m.status === 'in-progress' ? '#E1A21D' : '#CCC';
            return '<div class="tars-milestone-item" style="margin-bottom:8px;">' +
              '<div class="tars-milestone-checkbox ' + (m.status === "complete" ? "checked" : "") + '" style="border-color:' + statusColor + ';"></div>' +
              '<div class="tars-milestone-content">' +
                '<div style="font-size:13px;color:#333;font-weight:600;">' + m.name + '</div>' +
                '<div style="display:flex;gap:8px;margin-top:4px;">' +
                  '<span style="font-size:11px;color:' + statusColor + ';font-weight:700;text-transform:uppercase;">' + m.status + '</span>' +
                  (m.date ? '<span style="font-size:11px;color:#999;">' + m.date + '</span>' : '') +
                '</div>' +
                (m.notes ? '<div style="font-size:12px;color:#888;margin-top:4px;line-height:1.4;">' + m.notes + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>';

  container.appendChild(view);

  // Back button
  document.getElementById('tars-drill-back').addEventListener('click', function() {
    _renderInitiativeGrid(container);
  });
}

// âââ BACKLOG TAB (old drill-down style with project + owner + status filters) â
var __backlogFilter = { owner: "all", project: "all", status: "all" };

function renderBacklog() {
  var container = document.getElementById('tars-backlog-list');
  if (!container) return;
  container.innerHTML = '';
  _renderBacklogBody(container);
}

function _renderBacklogBody(container) {
  var all = TARS_DATA.allActions;
  var f = __backlogFilter;

  // Owner chips
  var ownersDef = [
    { name: "Simon",  color: "#1D8FE1", initial: "S" },
    { name: "Caio",   color: "#E1A21D", initial: "C" },
    { name: "Felipe", color: "#7B61FF", initial: "F" },
    { name: "Alex",   color: "#2DC46B", initial: "A" }
  ];

  var ownerChips = '<div class="td-owner-chips">' +
    ownersDef.map(function(o) {
      var isActive = f.owner === o.name;
      return '<div class="td-owner-chip' + (isActive ? ' active' : '') + '" ' +
        (isActive ? 'style="background:' + o.color + ';border-color:' + o.color + ';"' : '') +
        ' data-owner="' + o.name + '">' +
        '<div class="td-owner-chip-av" style="background:' + o.color + '">' + o.initial + '</div>' +
        o.name + '</div>';
    }).join('') +
    '</div>';

  // Project filter tabs
  var projectTabs = '<div class="tars-section-label" style="margin-top:4px;">Filter by project</div>' +
    '<div class="td-filter-tabs td-project-tabs">' +
    '<div class="td-tab' + (f.project === "all" ? ' active' : '') + '" data-project="all">All Projects</div>' +
    '<div class="td-tab' + (f.project === "payments" ? ' active' : '') + '" data-project="payments" style="' + (f.project === "payments" ? 'background:#1D8FE1;border-color:#1D8FE1;color:#fff;' : '') + '">Payments</div>' +
    '<div class="td-tab' + (f.project === "pricing" ? ' active' : '') + '" data-project="pricing" style="' + (f.project === "pricing" ? 'background:#E1A21D;border-color:#E1A21D;color:#fff;' : '') + '">Pricing</div>' +
    '<div class="td-tab' + (f.project === "partnerships" ? ' active' : '') + '" data-project="partnerships" style="' + (f.project === "partnerships" ? 'background:#7B61FF;border-color:#7B61FF;color:#fff;' : '') + '">Partnerships</div>' +
    '<div class="td-tab' + (f.project === "general" ? ' active' : '') + '" data-project="general">Gen. Strategy</div>' +
    '</div>';

  // Apply filters
  var filtered = all;
  if (f.owner !== "all") {
    filtered = filtered.filter(function(a) { return a.owner === f.owner; });
  }
  if (f.project !== "all") {
    filtered = filtered.filter(function(a) { return a.initiative === f.project; });
  }

  // Status counts for filtered set
  var totalN = filtered.length;
  var doneN = filtered.filter(function(a) { return a.status === "done"; }).length;
  var ipN   = filtered.filter(function(a) { return a.status === "in-progress"; }).length;
  var ovN   = filtered.filter(function(a) { return a.status === "overdue"; }).length;

  // Status filter tabs
  var statusTabs = '<div class="tars-section-label" style="margin-top:16px;">Filter by status</div>' +
    '<div class="td-filter-tabs td-status-tabs">' +
    _tab("all",         f.status, "All (" + totalN + ")") +
    _tab("done",        f.status, "Done (" + doneN + ")", "done-tab") +
    _tab("in-progress", f.status, "In Progress (" + ipN + ")", "prog-tab") +
    _tab("overdue",     f.status, "Overdue (" + ovN + ")", "over-tab") +
    '</div>';

  // Apply status filter
  var display = filtered;
  if (f.status !== "all") {
    display = display.filter(function(a) { return a.status === f.status; });
  }

  var count = display.length;
  var actionsHtml = count === 0
    ? '<div style="text-align:center;color:#CCC;padding:24px;font-size:13px;">No actions found.</div>'
    : display.map(_actionRow).join('');

  container.innerHTML =
    ownerChips +
    projectTabs +
    statusTabs +
    '<div class="td-count-summary">' + count + ' action' + (count !== 1 ? 's' : '') + ' shown</div>' +
    actionsHtml;

  // Wire up owner chip clicks
  container.querySelectorAll('.td-owner-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var owner = this.getAttribute('data-owner');
      __backlogFilter.owner = (__backlogFilter.owner === owner) ? "all" : owner;
      __backlogFilter.status = "all";
      _renderBacklogBody(container);
    });
  });

  // Wire up project tab clicks
  container.querySelectorAll('.td-project-tabs .td-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      __backlogFilter.project = this.getAttribute('data-project');
      __backlogFilter.status = "all";
      _renderBacklogBody(container);
    });
  });

  // Wire up status tab clicks
  container.querySelectorAll('.td-status-tabs .td-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      __backlogFilter.status = this.getAttribute('data-filter');
      _renderBacklogBody(container);
    });
  });
}

// Operations tab is now static HTML in index.html â no JS rendering needed

// âââ Dashboard sync â populates KPIs and owner bars in Backlog + Ops tabs ââââ
function syncDashboard() {
  var all = TARS_DATA.allActions;

  var totalN   = all.length;
  var doneN    = all.filter(function(a) { return a.status === "done"; }).length;
  var ipN      = all.filter(function(a) { return a.status === "in-progress"; }).length;
  var overdueN = all.filter(function(a) { return a.status === "overdue"; }).length;

  // KPI tiles
  var kpiNums = document.querySelectorAll(".action-kpi-num");
  kpiNums.forEach(function(el) {
    if (el.classList.contains("total")) el.textContent = totalN;
    else if (el.classList.contains("done"))  el.textContent = doneN;
    else if (el.classList.contains("prog"))  el.textContent = ipN;
    else if (el.classList.contains("over"))  el.textContent = overdueN;
  });

  // Date string
  var today = new Date();
  var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var dateStr = today.getDate() + " " + months[today.getMonth()] + " " + today.getFullYear();
  var sessions = new Set(all.map(function(a) { return a.id.substring(0, 9); }));

  // Subtitles
  var stripSubs = document.querySelectorAll(".action-strip-sub");
  stripSubs.forEach(function(el) {
    el.textContent = totalN + " actions logged across " + sessions.size + " sessions. Last updated: " + dateStr;
  });

  // Ops live sub
  var liveSub = document.getElementById("tars-ops-live-sub");
  if (liveSub) {
    liveSub.textContent = "Three active initiatives running in parallel. Progress reflects live data from the Action Tracker (" + totalN + " actions across " + sessions.size + " sessions). Last sync: " + dateStr + ".";
  }

  // Owner breakdown bars â find by data-backlog-owner attribute
  var owners = ["Simon", "Caio", "Felipe", "Alex"];
  var ownerRows = document.querySelectorAll(".owner-row-item");
  ownerRows.forEach(function(row) {
    var name = row.getAttribute("data-backlog-owner");
    if (!name) return;
    var mine = all.filter(function(a) { return a.owner === name; });
    var t = mine.length || 1;
    var d = mine.filter(function(a) { return a.status === "done"; }).length;
    var p = mine.filter(function(a) { return a.status === "in-progress"; }).length;
    var o = mine.filter(function(a) { return a.status === "overdue"; }).length;

    var barDone = row.querySelector(".owner-bar-done");
    var barProg = row.querySelector(".owner-bar-prog");
    var barOver = row.querySelector(".owner-bar-over");
    if (barDone) barDone.style.width = Math.round((d / t) * 100) + "%";
    if (barProg) barProg.style.width = Math.round((p / t) * 100) + "%";
    if (barOver) barOver.style.width = Math.round((o / t) * 100) + "%";

    var cDone = row.querySelector(".c-done");
    var cProg = row.querySelector(".c-prog");
    var cOver = row.querySelector(".c-over");
    if (cDone) cDone.textContent = d + "\u2713";
    if (cProg) cProg.textContent = p + "\u25CF";
    if (cOver) cOver.textContent = o > 0 ? o + "!" : "\u2014";
  });

  // Wire up backlog KPI tiles as filter shortcuts
  document.querySelectorAll("[data-backlog-filter]").forEach(function(kpi) {
    kpi.style.cursor = "pointer";
    kpi.addEventListener("click", function() {
      var filter = this.getAttribute("data-backlog-filter");
      __backlogFilter = { owner: "all", project: "all", status: filter };
      showTab("backlog");
      var container = document.getElementById("tars-backlog-list");
      if (container) _renderBacklogBody(container);
    });
  });

  // Wire up backlog owner rows as filter shortcuts
  document.querySelectorAll("[data-backlog-owner]").forEach(function(row) {
    row.style.cursor = "pointer";
    row.addEventListener("click", function() {
      var owner = this.getAttribute("data-backlog-owner");
      __backlogFilter = { owner: owner, project: "all", status: "all" };
      var container = document.getElementById("tars-backlog-list");
      if (container) _renderBacklogBody(container);
    });
  });
}
const TARS_DATA = {
  lastUpdated: "2026-04-08",

  // LAYER 1: Strategic Initiatives
  initiatives: [
    {
      id: "payments",
      name: "Embedded Payments — US Launch",
      owner: "Simon Perry",
      ownerInitial: "S",
      ownerColor: "#1D8FE1",
      phase: "Pilot — Pre-Launch",
      health: "at-risk",
      healthReason: "Working demo complete but security and tip issues flagged as pre-launch blockers. US pricing not finalized. US Deepdive meeting scheduled Wed 1 Apr.",
      milestones: [
        { id: "m1", name: "Stripe terminal integration demonstrated", status: "complete", date: "27 Mar 2026", notes: "Pay Demo 27 Mar — functional but issues flagged" },
        { id: "m2", name: "Pre-launch blockers resolved (security, tips)", status: "in-progress", date: "15 Apr 2026", notes: "Oleksandr: export validation. Dmytro: tip handling investigation" },
        { id: "m3", name: "US pricing model validated", status: "not-started", date: null, notes: "3% flat rate proposed (Session 09). Dedicated meeting TBD." },
        { id: "m4", name: "First merchant processing payment", status: "not-started", date: null, notes: "Pending KYC + pricing + billing infrastructure" },
        { id: "m5", name: "5,000 customers on payments + software", status: "not-started", date: "Dec 2026", notes: "Caio's headline proof point for scaling and capital raise" }
      ],
      latestDecision: "US pricing: 3% flat rate with surcharging options recommended (Session 09, 27 Mar)",
      nextDecisionPoint: "Confirm US pricing approach — Loyverse US Deepdive scheduled Tue 1 Apr, 4 PM BST (5 attendees)",
      context: "Caio proposed 100% US focus until 5K customers proven. Simon suggested 3% flat rate. Alex prefers Mexico given 50% organic growth. Debit card issuance feasible but needs US legal entity (~2-3 months).",
      actions: [
        { id: "A-260206-01", text: "Book time Mon–Thu to discuss Stripe Mexico preview launch", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Feb", status: "done", initiative: "payments" },
        { id: "A-260213-02", text: "Talk to Bevon to understand how yo-yo operates (vs payments model)", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done", initiative: "payments" },
        { id: "A-260213-04", text: "Report back on back-office processes at Payments", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done", initiative: "payments" },
        { id: "A-260213-08", text: "Visit Brazilian customer in London", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "21 Feb", status: "done", initiative: "payments" },
        { id: "A-260220-05", text: "Gather payment-side data on Milk No Milk customer", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "24 Feb", status: "done", initiative: "payments" },
        { id: "A-260306-06", text: "Add comments to strategy document via Google Docs", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Mar", status: "done", initiative: "payments" },
        { id: "A-260316-07", text: "Identify expert contacts with Google and Apple payment platform compliance experience", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260316-14", text: "Support Snowflake data migration and historical/chargeback data transfer with Dimitri", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260316-15", text: "Assist Simon and Felipe with Stripe/payment processing on UK and US accounts", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260323-01", text: "Provide UK company details for Shopify contract setup to Simon", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260324-01", text: "Sign amendment to include Loyverse US with the contracted pricing", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Mar", status: "done", initiative: "payments" },
        { id: "A-260324-02", text: "Discussion on whether UK customers should be used for pilot due to US legal entity issues", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "overdue", initiative: "payments" },
        { id: "A-260324-03", text: "Complete RFP for external legal counsel in US", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "1 Apr", status: "done", initiative: "payments" },
        { id: "A-260325-01", text: "Test Teya SIM-cards in Stripe devices to reduce Stripe costs of $10/month", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "7 Apr", status: "overdue", initiative: "payments" },
        { id: "A-260327-06", text: "Book dedicated US payments strategy meeting (next week)", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "31 Mar", status: "done", initiative: "payments" },
        { id: "A-260327-07", text: "Provide real-world US receipts (Toast, Square) for tip/tax validation", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "7 Apr", status: "overdue", initiative: "payments" }
      ]
    },
    {
      id: "pricing",
      name: "New Pricing Policy",
      owner: "Caio Fiuza",
      ownerInitial: "C",
      ownerColor: "#E1A21D",
      phase: "Design",
      health: "at-risk",
      healthReason: "Swiss analysis complete but no execution started. Pilot markets may shift based on US-first discussion. No pricing engine scoped yet.",
      milestones: [
        { id: "p1", name: "Swiss market analysis complete", status: "complete", date: "25 Mar 2026", notes: "Dashboard live at loyverse-pricing-ch.netlify.app" },
        { id: "p2", name: "Pilot markets confirmed", status: "not-started", date: null, notes: "Previously CH/AU/NG — may shift to US-first after dedicated meeting" },
        { id: "p3", name: "Pricing/billing engine built", status: "not-started", date: null, notes: "Simon owns billing infrastructure" },
        { id: "p4", name: "First cohort on new pricing model", status: "not-started", date: null, notes: "" },
        { id: "p5", name: "Cohort NPV validated at 2x+", status: "not-started", date: null, notes: "Core Phase 2A proof point" }
      ],
      latestDecision: "Pricing pilots in CH, AU, NG approved (Session 08, 20 Mar) — may be revised",
      nextDecisionPoint: "Whether to couple pricing rollout with US payments launch or keep separate pilot markets",
      context: "0.2% of GTV above $3,000/month threshold with hard cap. Swiss analysis shows competitive positioning. Execution blocked on billing engine and market confirmation.",
      actions: [
        { id: "A-260306-01", text: "Finalize narrative proposal for new pricing model trial by end of week", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-02", text: "Share document on seven potential directions to evolve the S-curve", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "9 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-03", text: "Prepare pricing options and positioning for Swiss pilot", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-04", text: "Map Loyverse product to G60 tax compliance regulation for Swiss market", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-05", text: "Draft communication plan for pricing rollout", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-09", text: "Design trust-building programme for app store ratings and reviews", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260306-10", text: "Create landing pages and content for new pricing model and partnerships", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260324-04", text: "Confirm final payment pricing proposal for US customers with the team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "overdue", initiative: "pricing" },
        { id: "A-260325-02", text: "Build out product list in Shopify with final pricing. Blocked by A-260324-04.", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "31 Mar", status: "overdue", initiative: "pricing" }
      ]
    },
    {
      id: "partnerships",
      name: "Partnerships Reloaded",
      owner: "TBD",
      ownerInitial: "?",
      ownerColor: "#7B61FF",
      phase: "Not Started",
      health: "blocked",
      healthReason: "No owner assigned. No programme design started. Teya integration confirmed for Q3 but no visible progress or plan shared.",
      milestones: [
        { id: "r1", name: "Partner programme design complete", status: "not-started", date: null, notes: "Three partner types: local solution, marketplace/software, infrastructure" },
        { id: "r2", name: "First local solution partners onboarded", status: "not-started", date: null, notes: "" },
        { id: "r3", name: "Teya integration live", status: "not-started", date: "Q3 2026", notes: "Q3 2026 target confirmed Session 08" },
        { id: "r4", name: "Partner-sourced merchant activation >30%", status: "not-started", date: null, notes: "Phase 2B target" }
      ],
      latestDecision: "Q3 2026 partnership engine launch with Teya confirmed (Session 08, 20 Mar)",
      nextDecisionPoint: "Assign owner and define scope — no one is currently driving this",
      context: "Three-layer ecosystem: local solution partners (resellers/integrators), marketplace/software partners, infrastructure partners (PSPs/acquirers). Strategic role: scalable growth and monetisation engine without proportional headcount.",
      actions: [
        { id: "A-260213-07", text: "Draft partnership proposal framework document", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done", initiative: "partnerships" },
        { id: "A-260220-07", text: "Share full list of partner payment inquiries with Simon for strategy research", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "partnerships" },
        { id: "A-260306-08", text: "Develop structured channel partnership framework", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Mar", status: "done", initiative: "partnerships" },
        { id: "A-260316-06", text: "Develop and submit clear engagement proposal for Teya partnership", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue", initiative: "partnerships" }
      ]
    }
  ],

  // LAYER 2: General Backlog (non-initiative actions)
  generalBacklog: [
    { id: "A-260316-01", text: "Finalise financial model (v3.1) and share with team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "16 Mar", status: "done", initiative: "general" },
    { id: "A-260130-01", text: "Research whether fiscalization is required to distribute software in Brazil", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Feb", status: "done", initiative: "general" },
    { id: "A-260130-02", text: "Send notes to group, propose structure for the plan, consolidate documents and share ideas weekly", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Feb", status: "done", initiative: "general" },
    { id: "A-260130-03", text: "Invite Felipe for Monday meeting with Alex to discuss working environment setup", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done", initiative: "general" },
    { id: "A-260130-04", text: "Send daily calendar invitations (2–3 PM UK time) for continuous strategy collaboration", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done", initiative: "general" },
    { id: "A-260206-02", text: "Research AI market analysis tools and alternatives to ChatGPT for internal strategy work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260206-03", text: "Define and draw out customer personas, clearly identifying their needs", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260206-04", text: "Prepare cashflow projections (monthly) for the first year of the plan", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260206-05", text: "Revise financial model to include NPV per new user in each of the top 10 markets", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done", initiative: "general" },
    { id: "A-260213-01", text: "Prepare one-slide summary of top 10 markets by revenue vs cost from financial model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260213-03", text: "Present Singapore and UK cohort analysis using local regulatory and financial context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260213-05", text: "Book call with marketing agency (Favoured) and prepare Loyverse onboarding context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260213-06", text: "Bring competitive landscape analysis (feature comparison + pricing) to next session", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Feb", status: "done", initiative: "general" },
    { id: "A-260220-01", text: "Finalize 3-month execution budget aligned to cash flow model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-02", text: "Produce written document outlining the 5 prioritized personas with evidence and logic", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-03", text: "Assemble list of AI tools to be operationalized across teams", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-04", text: "Present competitive benchmarking data: Lightspeed and other POS players", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260220-06", text: "Share five customer personas, slide deck, and three merchant case summaries", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260227-01", text: "Finalize financial tool by adding new growth charts", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-02", text: "Share updated financial spreadsheet with group; update tool based on feedback", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done", initiative: "general" },
    { id: "A-260227-03", text: "Add cohort 25 baseline to the financial data", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Mar", status: "done", initiative: "general" },
    { id: "A-260227-04", text: "Prepare initial competitive product gap analysis vs top 3 competitors", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-05", text: "Set up Robert Walters as recruitment partner for UK operations role", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-06", text: "Confirm whether fixing Sep–Dec 2025 numbers will block upcoming execution work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260227-07", text: "Compile exercises from Alex and Simon on customers; produce synthesis document", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done", initiative: "general" },
    { id: "A-260306-07", text: "Provide update on Brex card onboarding and new cards for team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Mar", status: "overdue", initiative: "general" },
    { id: "A-260306-11", text: "Write first draft of SAP partnership proposal document", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-02", text: "Push for resolution on Snowflake migration timeline with data team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-03", text: "Continue competitive benchmarking and prepare summary of key gaps in product", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-04", text: "Draft terms of reference for Loyverse business plan project phase", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-05", text: "Draft initial product requirements document (PRD) for the new pricing module", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-08", text: "Coordinate Snowflake data migration and Claude AI integration meeting", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-09", text: "Continue developing AI-powered notes and task automation agent", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-10", text: "Manage procurement of additional corporate cards for team", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-11", text: "Confirm SAP entity integration approach; engage external contractor if required", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-12", text: "Add Dimitri to Claude AI team account", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "18 Mar", status: "overdue", initiative: "general" },
    { id: "A-260316-13", text: "Provide and validate budget figures and cost/revenue projections for Caio", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "18 Mar", status: "overdue", initiative: "general" },
    { id: "A-260324-05", text: "Prepare discussion topics for Friday: From POS to BOSS and From Integrations to Plug-Ins", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "27 Mar", status: "overdue", initiative: "general" },
    { id: "A-260327-01", text: "Upgrade Netlify plan for security layer", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "7 Apr", status: "overdue", initiative: "general" },
    { id: "A-260327-02", text: "Refine TARS for main 2026 initiatives with clearer project steps", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "31 Mar", status: "done", initiative: "general" },
    { id: "A-260327-03", text: "Connect Confluence to TARS memory system", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "14 Apr", status: "overdue", initiative: "general" },
    { id: "A-260327-04", text: "Develop Snowflake-to-CASE dashboard integration", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "14 Apr", status: "done", initiative: "general" },
    { id: "A-260327-05", text: "Provide Snowflake access to Felipe and Caio", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "31 Mar", status: "overdue", initiative: "general" },
    { id: "A-260330-01", text: "Enable the Mixpanel MCP for Claude", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "7 Apr", status: "overdue", initiative: "general" },
    { id: "A-260330-02", text: "Enable data pipelines addon for Mixpanel to Snowflake", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "7 Apr", status: "overdue", initiative: "general" },
    { id: "A-260330-03", text: "Unlock the n8n connector in Claude", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "7 Apr", status: "overdue", initiative: "general" }
  ],

  // LAYER 3: Operations
  operations: {
    scheduledTasks: [
      { id: "daily-completion-check", purpose: "Monitor #strategy-feed for completed actions, update tracker", frequency: "Daily 5 PM (Mon-Fri)", owner: "TARS", status: "Active" },
      { id: "sync-tracker-to-html", purpose: "Regenerate tars-data.js, deploy to GitHub/Netlify", frequency: "Daily 5:53 PM", owner: "TARS", status: "Active" },
      { id: "monday-strategic-pulse", purpose: "Initiative health, pending decisions, strategic tensions, leadership focus", frequency: "Monday 10 AM", owner: "TARS", status: "Active" },
      { id: "drive-session-naming-audit", purpose: "Verify Strategic Sessions folder naming conventions", frequency: "Monday 9 AM", owner: "TARS", status: "Active" },
      { id: "thursday-strategic-preview", purpose: "The one question worth leadership's time, initiative shifts, unresolved tensions", frequency: "Thursday 4 PM", owner: "TARS", status: "Active" },
      { id: "thursday-strategy-deck", purpose: "Branded PPTX briefing with CASE metrics, 5YP context, initiative health, agenda", frequency: "Thursday 4:32 PM", owner: "TARS", status: "Active" },
      { id: "friday-meeting-briefing", purpose: "Process Fireflies transcripts, extract decisions and initiative impact", frequency: "Friday 4:39 PM", owner: "TARS", status: "Active" },
      { id: "weekly-strategy-tracker-update", purpose: "Extract decisions and milestones from strategy sessions, update initiatives + backlog", frequency: "Friday 7 PM", owner: "TARS", status: "Active" },
      { id: "weekly-memory-maintenance", purpose: "Consolidate working memory from Slack into Mem reference files", frequency: "Sunday 8 PM", owner: "Second Brain", status: "Active" },
      { id: "weekly-mem-update", purpose: "Fetch new Fireflies meetings, create/update Mem briefing notes", frequency: "Friday 8 PM", owner: "Second Brain", status: "Active" },
      { id: "appstore-data-pull", purpose: "Weekly pull of Loyverse app store ratings and reviews", frequency: "Monday 9 AM", owner: "CASE", status: "Active" },
      { id: "hiagent-monitor", purpose: "Monitor all scheduled tasks, update dashboard, alert on failures", frequency: "Every 4 hours", owner: "HIAgent", status: "Active" }
    ],
    weeklyRhythm: "Monday: Strategic Pulse (initiative health + decisions) → Daily: Completion checks + health signal scan → Thursday: Strategic Preview (meeting framing) → Friday: Meeting briefing + tracker update → Sunday: Memory maintenance",
    connectedPlatforms: [
      "Google Drive — strategy documents, tracker, session archives",
      "Slack — #strategy-feed, #cowork-memory, DMs",
      "Fireflies.ai — meeting capture and transcript processing",
      "Gmail — briefing drafts to leadership team",
      "Google Calendar — session scheduling",
      "Netlify — tars-overview.netlify.app (Command Centre)",
      "GitHub — felipekrugel-eng/tars-overview (auto-deploys to Netlify)",
      "Mem — Second Brain reference notes"
    ],
    howToInteract: "Post in #strategy-feed for natural language inputs. Use Slack DMs for status updates. Check tars-overview.netlify.app for the strategic overview. TARS processes Fireflies transcripts automatically every Friday."
  }
};

// ─── Build flat allActions from initiatives + generalBacklog ──────────────
(function() {
  var all = [];
  TARS_DATA.initiatives.forEach(function(init) {
    if (init.actions) {
      init.actions.forEach(function(a) { all.push(a); });
    }
  });
  TARS_DATA.generalBacklog.forEach(function(a) { all.push(a); });
  TARS_DATA.allActions = all;
})();

// ─── Initiative color/label helpers ──────────────────────────────────────────
function _initiativeColor(key) {
  return key === "payments" ? "#1D8FE1" : key === "pricing" ? "#E1A21D" : key === "partnerships" ? "#7B61FF" : "#888";
}
function _initiativeLabel(key) {
  return key === "payments" ? "Payments" : key === "pricing" ? "Pricing" : key === "partnerships" ? "Partnerships" : "Gen. Strategy";
}

// ─── Action row renderer (old drill-down style) ──────────────────────────────
function _actionRow(a) {
  var statusLabel = a.status === "done" ? "Done" : a.status === "in-progress" ? "In Progress" : "Overdue";
  var iColor = _initiativeColor(a.initiative);
  var iLabel = _initiativeLabel(a.initiative);
  return '<div class="td-action-row">' +
    '<div>' +
      '<div class="td-action-id">' + a.id + '</div>' +
      '<div style="width:6px;height:6px;border-radius:50%;background:' + iColor + ';margin-top:8px;"></div>' +
    '</div>' +
    '<div style="flex:1;">' +
      '<div class="td-action-text">' + a.text + '</div>' +
      '<div class="td-action-meta">' +
        '<div class="td-action-avatar" style="background:' + a.ownerColor + '">' + a.ownerInitial + '</div>' +
        '<div class="td-action-owner-name">' + a.owner + '</div>' +
        '<div class="td-action-due">· due ' + a.due + '</div>' +
        '<span style="margin-left:auto;font-size:10px;color:' + iColor + ';font-weight:600;">' + iLabel + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="td-status-chip ' + a.status + '">' + statusLabel + '</div>' +
  '</div>';
}

// ─── Tab helper ──────────────────────────────────────────────────────────────
function _tab(filter, current, label, extraClass) {
  var cls = "td-tab" + (extraClass ? " " + extraClass : "") + (filter === current ? " active" : "");
  return '<div class="' + cls + '" data-filter="' + filter + '">' + label + '</div>';
}

// ─── RENDERING ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  renderTARS();
});

function renderTARS() {
  // Initialize tab switching
  var tabButtons = document.querySelectorAll('.tars-tab-btn');
  tabButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tabName = this.getAttribute('data-tab');
      showTab(tabName);
    });
  });

  renderInitiatives();
  renderBacklog();

  // Sync KPI numbers and owner bars
  syncDashboard();

  // Dynamic hub tile numbers — count from actual data
  updateHubStats();
}

function updateHubStats() {
  // TARS: count task cards on the Operations tab (the meaningful weekly rhythm tasks)
  var taskCards = document.querySelectorAll('#tars-operations .task-card');
  var hubTars = document.getElementById('hub-tars-stat');
  if (hubTars && taskCards.length > 0) {
    hubTars.textContent = taskCards.length;
  }

  // Also update the section subtitle text to match
  var taskCountEl = document.getElementById('tars-ops-task-count');
  if (taskCountEl && taskCards.length > 0) {
    var numWords = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve'];
    var word = numWords[taskCards.length] || taskCards.length;
    taskCountEl.textContent = word + ' scheduled tasks covering the full weekly strategy cycle \u2014 from strategic pulse to session briefings. Click any card to see details.';
  }

  // TARS initiatives count from data
  var initCount = TARS_DATA.initiatives ? TARS_DATA.initiatives.length : 0;
  if (initCount > 0) {
    var liveSubEl = document.getElementById('tars-ops-live-sub');
    if (liveSubEl) {
      liveSubEl.textContent = initCount + ' active initiatives running in parallel. Progress reflects live data from the Action Tracker. Last sync: ' + TARS_DATA.lastUpdated + '.';
    }
  }

  // ─── TARS Hero "Last updated" badge (matches CASE pattern) ─────────────────
  var tarsUpdatedLabel = document.getElementById('tars-updated-label');
  if (tarsUpdatedLabel && TARS_DATA.lastUpdated) {
    tarsUpdatedLabel.textContent = 'Last updated: ' + TARS_DATA.lastUpdated;
  }
}

function showTab(tabName) {
  var tabButtons = document.querySelectorAll('.tars-tab-btn');
  var tabContents = document.querySelectorAll('.tars-tab-content');

  tabButtons.forEach(function(btn) { btn.classList.remove('active'); });
  tabContents.forEach(function(c) { c.classList.remove('active'); });

  document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
  document.getElementById('tars-' + tabName).classList.add('active');
}

// ─── INITIATIVES TAB ─────────────────────────────────────────────────────────
function renderInitiatives() {
  var container = document.getElementById('tars-initiatives-grid');
  if (!container) return;
  _renderInitiativeGrid(container);
}

function _renderInitiativeGrid(container) {
  container.innerHTML = '';

  var grid = document.createElement('div');
  grid.className = 'tars-grid';

  TARS_DATA.initiatives.forEach(function(initiative) {
    var completedMilestones = initiative.milestones.filter(function(m) { return m.status === 'complete'; }).length;
    var totalMilestones = initiative.milestones.length;
    var milestoneProgress = completedMilestones + '/' + totalMilestones + ' milestones';

    var healthColor = initiative.health === 'blocked' ? '#CC3333' :
                      initiative.health === 'at-risk' ? '#E1A21D' : '#2DC46B';

    var card = document.createElement('div');
    card.className = 'tars-initiative-card';
    card.setAttribute('data-initiative', initiative.id);
    card.innerHTML =
      '<div class="tars-card-top-bar"></div>' +
      '<div class="tars-card-content">' +
        '<div class="tars-card-header">' +
          '<div class="tars-card-title">' + initiative.name + '</div>' +
          '<div class="tars-health-indicator" style="background-color: ' + healthColor + ';" title="' + initiative.healthReason + '"></div>' +
        '</div>' +
        '<div class="tars-card-meta">' +
          '<div class="tars-owner-badge" style="background-color: ' + initiative.ownerColor + ';">' + initiative.ownerInitial + '</div>' +
          '<div class="tars-phase-badge">' + initiative.phase + '</div>' +
          '<div class="tars-phase-badge" style="font-weight:700;">' + milestoneProgress + '</div>' +
        '</div>' +
        '<div class="tars-health-reason">' + initiative.healthReason + '</div>' +
      '</div>';

    // Click card → drill down
    (function(init) {
      card.addEventListener('click', function() {
        _renderInitiativeDrilldown(container, init);
      });
    })(initiative);

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

function _renderInitiativeDrilldown(container, initiative) {
  container.innerHTML = '';

  var barColor = initiative.id === 'payments' ? '#1D8FE1' : initiative.id === 'pricing' ? '#C47B10' : '#7B3FA0';
  var healthColor = initiative.health === 'blocked' ? '#CC3333' :
                    initiative.health === 'at-risk' ? '#E1A21D' : '#2DC46B';
  var completedMilestones = initiative.milestones.filter(function(m) { return m.status === 'complete'; }).length;
  var totalMilestones = initiative.milestones.length;

  var view = document.createElement('div');
  view.className = 'tars-drilldown';
  view.innerHTML =
    '<button class="tars-drilldown-back" id="tars-drill-back">&larr; All initiatives</button>' +

    '<div class="tars-drilldown-header">' +
      '<div class="tars-card-top-bar" style="background:' + barColor + ';"></div>' +
      '<div class="tars-drilldown-body">' +
        '<div class="tars-drilldown-meta">' +
          '<div class="tars-owner-badge" style="background-color:' + initiative.ownerColor + ';">' + initiative.ownerInitial + '</div>' +
          '<div class="tars-phase-badge">' + initiative.phase + '</div>' +
          '<div class="tars-health-indicator" style="background-color:' + healthColor + ';" title="Health"></div>' +
          '<span style="font-size:12px;color:#888;font-weight:600;">' + completedMilestones + '/' + totalMilestones + ' milestones complete</span>' +
        '</div>' +
        '<div class="tars-drilldown-title">' + initiative.name + '</div>' +
        '<div class="tars-drilldown-reason">' + initiative.healthReason + '</div>' +
        '<div class="tars-drilldown-decisions">' +
          '<div class="tars-decision-box">' +
            '<div class="tars-decision-label">Latest Decision</div>' +
            '<div class="tars-decision-text">' + initiative.latestDecision + '</div>' +
          '</div>' +
          '<div class="tars-decision-box">' +
            '<div class="tars-decision-label">Next Decision Point</div>' +
            '<div class="tars-decision-text">' + initiative.nextDecisionPoint + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="tars-drilldown-sections">' +
      '<div class="tars-drilldown-section">' +
        '<div class="tars-drilldown-section-title">Context</div>' +
        '<div style="font-size:14px;color:#444;line-height:1.6;">' + initiative.context + '</div>' +
      '</div>' +
      '<div class="tars-drilldown-section">' +
        '<div class="tars-drilldown-section-title">Milestones</div>' +
        '<div class="tars-milestones-list">' +
          initiative.milestones.map(function(m) {
            var statusColor = m.status === 'complete' ? '#2DC46B' : m.status === 'in-progress' ? '#E1A21D' : '#CCC';
            return '<div class="tars-milestone-item" style="margin-bottom:8px;">' +
              '<div class="tars-milestone-checkbox ' + (m.status === "complete" ? "checked" : "") + '" style="border-color:' + statusColor + ';"></div>' +
              '<div class="tars-milestone-content">' +
                '<div style="font-size:13px;color:#333;font-weight:600;">' + m.name + '</div>' +
                '<div style="display:flex;gap:8px;margin-top:4px;">' +
                  '<span style="font-size:11px;color:' + statusColor + ';font-weight:700;text-transform:uppercase;">' + m.status + '</span>' +
                  (m.date ? '<span style="font-size:11px;color:#999;">' + m.date + '</span>' : '') +
                '</div>' +
                (m.notes ? '<div style="font-size:12px;color:#888;margin-top:4px;line-height:1.4;">' + m.notes + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>';

  container.appendChild(view);

  // Back button
  document.getElementById('tars-drill-back').addEventListener('click', function() {
    _renderInitiativeGrid(container);
  });
}

// ─── BACKLOG TAB (old drill-down style with project + owner + status filters) ─
var __backlogFilter = { owner: "all", project: "all", status: "all" };

function renderBacklog() {
  var container = document.getElementById('tars-backlog-list');
  if (!container) return;
  container.innerHTML = '';
  _renderBacklogBody(container);
}

function _renderBacklogBody(container) {
  var all = TARS_DATA.allActions;
  var f = __backlogFilter;

  // Owner chips
  var ownersDef = [
    { name: "Simon",  color: "#1D8FE1", initial: "S" },
    { name: "Caio",   color: "#E1A21D", initial: "C" },
    { name: "Felipe", color: "#7B61FF", initial: "F" },
    { name: "Alex",   color: "#2DC46B", initial: "A" }
  ];

  var ownerChips = '<div class="td-owner-chips">' +
    ownersDef.map(function(o) {
      var isActive = f.owner === o.name;
      return '<div class="td-owner-chip' + (isActive ? ' active' : '') + '" ' +
        (isActive ? 'style="background:' + o.color + ';border-color:' + o.color + ';"' : '') +
        ' data-owner="' + o.name + '">' +
        '<div class="td-owner-chip-av" style="background:' + o.color + '">' + o.initial + '</div>' +
        o.name + '</div>';
    }).join('') +
    '</div>';

  // Project filter tabs
  var projectTabs = '<div class="tars-section-label" style="margin-top:4px;">Filter by project</div>' +
    '<div class="td-filter-tabs td-project-tabs">' +
    '<div class="td-tab' + (f.project === "all" ? ' active' : '') + '" data-project="all">All Projects</div>' +
    '<div class="td-tab' + (f.project === "payments" ? ' active' : '') + '" data-project="payments" style="' + (f.project === "payments" ? 'background:#1D8FE1;border-color:#1D8FE1;color:#fff;' : '') + '">Payments</div>' +
    '<div class="td-tab' + (f.project === "pricing" ? ' active' : '') + '" data-project="pricing" style="' + (f.project === "pricing" ? 'background:#E1A21D;border-color:#E1A21D;color:#fff;' : '') + '">Pricing</div>' +
    '<div class="td-tab' + (f.project === "partnerships" ? ' active' : '') + '" data-project="partnerships" style="' + (f.project === "partnerships" ? 'background:#7B61FF;border-color:#7B61FF;color:#fff;' : '') + '">Partnerships</div>' +
    '<div class="td-tab' + (f.project === "general" ? ' active' : '') + '" data-project="general">Gen. Strategy</div>' +
    '</div>';

  // Apply filters
  var filtered = all;
  if (f.owner !== "all") {
    filtered = filtered.filter(function(a) { return a.owner === f.owner; });
  }
  if (f.project !== "all") {
    filtered = filtered.filter(function(a) { return a.initiative === f.project; });
  }

  // Status counts for filtered set
  var totalN = filtered.length;
  var doneN = filtered.filter(function(a) { return a.status === "done"; }).length;
  var ipN   = filtered.filter(function(a) { return a.status === "in-progress"; }).length;
  var ovN   = filtered.filter(function(a) { return a.status === "overdue"; }).length;

  // Status filter tabs
  var statusTabs = '<div class="tars-section-label" style="margin-top:16px;">Filter by status</div>' +
    '<div class="td-filter-tabs td-status-tabs">' +
    _tab("all",         f.status, "All (" + totalN + ")") +
    _tab("done",        f.status, "Done (" + doneN + ")", "done-tab") +
    _tab("in-progress", f.status, "In Progress (" + ipN + ")", "prog-tab") +
    _tab("overdue",     f.status, "Overdue (" + ovN + ")", "over-tab") +
    '</div>';

  // Apply status filter
  var display = filtered;
  if (f.status !== "all") {
    display = display.filter(function(a) { return a.status === f.status; });
  }

  var count = display.length;
  var actionsHtml = count === 0
    ? '<div style="text-align:center;color:#CCC;padding:24px;font-size:13px;">No actions found.</div>'
    : display.map(_actionRow).join('');

  container.innerHTML =
    ownerChips +
    projectTabs +
    statusTabs +
    '<div class="td-count-summary">' + count + ' action' + (count !== 1 ? 's' : '') + ' shown</div>' +
    actionsHtml;

  // Wire up owner chip clicks
  container.querySelectorAll('.td-owner-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var owner = this.getAttribute('data-owner');
      __backlogFilter.owner = (__backlogFilter.owner === owner) ? "all" : owner;
      __backlogFilter.status = "all";
      _renderBacklogBody(container);
    });
  });

  // Wire up project tab clicks
  container.querySelectorAll('.td-project-tabs .td-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      __backlogFilter.project = this.getAttribute('data-project');
      __backlogFilter.status = "all";
      _renderBacklogBody(container);
    });
  });

  // Wire up status tab clicks
  container.querySelectorAll('.td-status-tabs .td-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      __backlogFilter.status = this.getAttribute('data-filter');
      _renderBacklogBody(container);
    });
  });
}

// Operations tab is now static HTML in index.html — no JS rendering needed

// ─── Dashboard sync — populates KPIs and owner bars in Backlog + Ops tabs ────
function syncDashboard() {
  var all = TARS_DATA.allActions;

  var totalN   = all.length;
  var doneN    = all.filter(function(a) { return a.status === "done"; }).length;
  var ipN      = all.filter(function(a) { return a.status === "in-progress"; }).length;
  var overdueN = all.filter(function(a) { return a.status === "overdue"; }).length;

  // KPI tiles
  var kpiNums = document.querySelectorAll(".action-kpi-num");
  kpiNums.forEach(function(el) {
    if (el.classList.contains("total")) el.textContent = totalN;
    else if (el.classList.contains("done"))  el.textContent = doneN;
    else if (el.classList.contains("prog"))  el.textContent = ipN;
    else if (el.classList.contains("over"))  el.textContent = overdueN;
  });

  // Date string
  var today = new Date();
  var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var dateStr = today.getDate() + " " + months[today.getMonth()] + " " + today.getFullYear();
  var sessions = new Set(all.map(function(a) { return a.id.substring(0, 9); }));

  // Subtitles
  var stripSubs = document.querySelectorAll(".action-strip-sub");
  stripSubs.forEach(function(el) {
    el.textContent = totalN + " actions logged across " + sessions.size + " sessions. Last updated: " + dateStr;
  });

  // Ops live sub
  var liveSub = document.getElementById("tars-ops-live-sub");
  if (liveSub) {
    liveSub.textContent = "Three active initiatives running in parallel. Progress reflects live data from the Action Tracker (" + totalN + " actions across " + sessions.size + " sessions). Last sync: " + dateStr + ".";
  }

  // Owner breakdown bars — find by data-backlog-owner attribute
  var owners = ["Simon", "Caio", "Felipe", "Alex"];
  var ownerRows = document.querySelectorAll(".owner-row-item");
  ownerRows.forEach(function(row) {
    var name = row.getAttribute("data-backlog-owner");
    if (!name) return;
    var mine = all.filter(function(a) { return a.owner === name; });
    var t = mine.length || 1;
    var d = mine.filter(function(a) { return a.status === "done"; }).length;
    var p = mine.filter(function(a) { return a.status === "in-progress"; }).length;
    var o = mine.filter(function(a) { return a.status === "overdue"; }).length;

    var barDone = row.querySelector(".owner-bar-done");
    var barProg = row.querySelector(".owner-bar-prog");
    var barOver = row.querySelector(".owner-bar-over");
    if (barDone) barDone.style.width = Math.round((d / t) * 100) + "%";
    if (barProg) barProg.style.width = Math.round((p / t) * 100) + "%";
    if (barOver) barOver.style.width = Math.round((o / t) * 100) + "%";

    var cDone = row.querySelector(".c-done");
    var cProg = row.querySelector(".c-prog");
    var cOver = row.querySelector(".c-over");
    if (cDone) cDone.textContent = d + "\u2713";
    if (cProg) cProg.textContent = p + "\u25CF";
    if (cOver) cOver.textContent = o > 0 ? o + "!" : "\u2014";
  });

  // Wire up backlog KPI tiles as filter shortcuts
  document.querySelectorAll("[data-backlog-filter]").forEach(function(kpi) {
    kpi.style.cursor = "pointer";
    kpi.addEventListener("click", function() {
      var filter = this.getAttribute("data-backlog-filter");
      __backlogFilter = { owner: "all", project: "all", status: filter };
      showTab("backlog");
      var container = document.getElementById("tars-backlog-list");
      if (container) _renderBacklogBody(container);
    });
  });

  // Wire up backlog owner rows as filter shortcuts
  document.querySelectorAll("[data-backlog-owner]").forEach(function(row) {
    row.style.cursor = "pointer";
    row.addEventListener("click", function() {
      var owner = this.getAttribute("data-backlog-owner");
      __backlogFilter = { owner: owner, project: "all", status: "all" };
      var container = document.getElementById("tars-backlog-list");
      if (container) _renderBacklogBody(container);
    });
  });
}
