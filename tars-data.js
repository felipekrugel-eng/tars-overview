const TARS_DATA = {
  lastUpdated: "2026-03-28",

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
      healthReason: "Working demo complete but security and tip issues flagged as pre-launch blockers. US pricing not finalized. Dedicated strategy meeting not yet scheduled.",
      milestones: [
        { id: "m1", name: "Stripe terminal integration demonstrated", status: "complete", date: "27 Mar 2026", notes: "Pay Demo 27 Mar — functional but issues flagged" },
        { id: "m2", name: "Pre-launch blockers resolved (security, tips)", status: "in-progress", date: "15 Apr 2026", notes: "Oleksandr: export validation. Dmytro: tip handling investigation" },
        { id: "m3", name: "US pricing model validated", status: "not-started", date: null, notes: "3% flat rate proposed (Session 09). Dedicated meeting TBD." },
        { id: "m4", name: "First merchant processing payment", status: "not-started", date: null, notes: "Pending KYC + pricing + billing infrastructure" },
        { id: "m5", name: "5,000 customers on payments + software", status: "not-started", date: "Dec 2026", notes: "Caio's headline proof point for scaling and capital raise" }
      ],
      latestDecision: "US pricing: 3% flat rate with surcharging options recommended (Session 09, 27 Mar)",
      nextDecisionPoint: "Confirm US pricing approach at dedicated meeting (Caio scheduling)",
      context: "Caio proposed 100% US focus until 5K customers proven. Simon suggested 3% flat rate. Alex prefers Mexico given 50% organic growth. Debit card issuance feasible but needs US legal entity (~2-3 months).",
      actions: [
        { id: "A-260206-01", text: "Book time Mon–Thu to discuss Stripe Mexico preview launch", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Feb", status: "done" },
        { id: "A-260213-02", text: "Talk to Bevon to understand how yo-yo operates (vs payments model)", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done" },
        { id: "A-260213-04", text: "Report back on back-office processes at Payments", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done" },
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
        { id: "A-260306-01", text: "Finalize narrative proposal for new pricing model trial by end of week", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
        { id: "A-260306-02", text: "Share document on seven potential directions to evolve the S-curve", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "9 Mar", status: "overdue" },
        { id: "A-260306-03", text: "Prepare pricing options and positioning for Swiss pilot", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
        { id: "A-260306-04", text: "Map Loyverse product to G60 tax compliance regulation for Swiss market", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
        { id: "A-260306-05", text: "Draft communication plan for pricing rollout", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Mar", status: "overdue" },
        { id: "A-260306-09", text: "Design trust-building programme for app store ratings and reviews", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue" },
        { id: "A-260306-10", text: "Create landing pages and content for new pricing model and partnerships", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Mar", status: "overdue" },
        { id: "A-260324-04", text: "Confirm final payment pricing proposal for US customers with the team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "28 Mar", status: "in-progress" },
        { id: "A-260325-02", text: "Build out product list in Shopify with final pricing. Blocked by A-260324-04.", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "31 Mar", status: "in-progress" }
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
        { id: "A-260213-07", text: "Draft partnership proposal framework document", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Feb", status: "done" },
        { id: "A-260220-07", text: "Share full list of partner payment inquiries with Simon for strategy research", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done" },
        { id: "A-260306-08", text: "Develop structured channel partnership framework", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "20 Mar", status: "done" },
        { id: "A-260316-06", text: "Develop and submit clear engagement proposal for Teya partnership", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue" }
      ]
    }
  ],

  // LAYER 2: Backlog
  backlog: [
    { id: "A-260316-01", text: "Finalise financial model (v3.1) and share with team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "16 Mar", status: "done" },
    { id: "A-260130-01", text: "Research whether fiscalization is required to distribute software in Brazil", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Feb", status: "done" },
    { id: "A-260130-02", text: "Send notes to group, propose structure for the plan, consolidate documents and share ideas weekly", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Feb", status: "done" },
    { id: "A-260130-03", text: "Invite Felipe for Monday meeting with Alex to discuss working environment setup", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done" },
    { id: "A-260130-04", text: "Send daily calendar invitations (2–3 PM UK time) for continuous strategy collaboration", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Feb", status: "done" },
    { id: "A-260206-02", text: "Research AI market analysis tools and alternatives to ChatGPT for internal strategy work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "13 Feb", status: "done" },
    { id: "A-260206-03", text: "Define and draw out customer personas, clearly identifying their needs", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done" },
    { id: "A-260206-04", text: "Prepare cashflow projections (monthly) for the first year of the plan", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done" },
    { id: "A-260206-05", text: "Revise financial model to include NPV per new user in each of the top 10 markets", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "13 Feb", status: "done" },
    { id: "A-260213-01", text: "Prepare one-slide summary of top 10 markets by revenue vs cost from financial model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "20 Feb", status: "done" },
    { id: "A-260213-03", text: "Present Singapore and UK cohort analysis using local regulatory and financial context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done" },
    { id: "A-260213-05", text: "Book call with marketing agency (Favoured) and prepare Loyverse onboarding context", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "20 Feb", status: "done" },
    { id: "A-260213-06", text: "Bring competitive landscape analysis (feature comparison + pricing) to next session", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Feb", status: "done" },
    { id: "A-260220-01", text: "Finalize 3-month execution budget aligned to cash flow model", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done" },
    { id: "A-260220-02", text: "Produce written document outlining the 5 prioritized personas with evidence and logic", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done" },
    { id: "A-260220-03", text: "Assemble list of AI tools to be operationalized across teams", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done" },
    { id: "A-260220-04", text: "Present competitive benchmarking data: Lightspeed and other POS players", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "27 Feb", status: "done" },
    { id: "A-260220-06", text: "Share five customer personas, slide deck, and three merchant case summaries", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "27 Feb", status: "done" },
    { id: "A-260227-01", text: "Finalize financial tool by adding new growth charts", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done" },
    { id: "A-260227-02", text: "Share updated financial spreadsheet with group; update tool based on feedback", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "27 Feb", status: "done" },
    { id: "A-260227-03", text: "Add cohort 25 baseline to the financial data", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "2 Mar", status: "done" },
    { id: "A-260227-04", text: "Prepare initial competitive product gap analysis vs top 3 competitors", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "6 Mar", status: "done" },
    { id: "A-260227-05", text: "Set up Robert Walters as recruitment partner for UK operations role", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "6 Mar", status: "done" },
    { id: "A-260227-06", text: "Confirm whether fixing Sep–Dec 2025 numbers will block upcoming execution work", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "6 Mar", status: "done" },
    { id: "A-260227-07", text: "Compile exercises from Alex and Simon on customers; produce synthesis document", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "6 Mar", status: "done" },
    { id: "A-260306-07", text: "Provide update on Brex card onboarding and new cards for team", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "13 Mar", status: "overdue" },
    { id: "A-260306-11", text: "Write first draft of SAP partnership proposal document", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "20 Mar", status: "overdue" },
    { id: "A-260316-02", text: "Push for resolution on Snowflake migration timeline with data team", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue" },
    { id: "A-260316-03", text: "Continue competitive benchmarking and prepare summary of key gaps in product", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue" },
    { id: "A-260316-04", text: "Draft terms of reference for Loyverse business plan project phase", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue" },
    { id: "A-260316-05", text: "Draft initial product requirements document (PRD) for the new pricing module", owner: "Caio", ownerColor: "#E1A21D", ownerInitial: "C", due: "23 Mar", status: "overdue" },
    { id: "A-260316-08", text: "Coordinate Snowflake data migration and Claude AI integration meeting", owner: "Simon", ownerColor: "#1D8FE1", ownerInitial: "S", due: "23 Mar", status: "overdue" },
    { id: "A-260316-09", text: "Continue developing AI-powered notes and task automation agent", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue" },
    { id: "A-260316-10", text: "Manage procurement of additional corporate cards for team", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue" },
    { id: "A-260316-11", text: "Confirm SAP entity integration approach; engage external contractor if required", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "23 Mar", status: "overdue" },
    { id: "A-260316-12", text: "Add Dimitri to Claude AI team account", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "18 Mar", status: "overdue" },
    { id: "A-260316-13", text: "Provide and validate budget figures and cost/revenue projections for Caio", owner: "Alex", ownerColor: "#2DC46B", ownerInitial: "A", due: "18 Mar", status: "overdue" },
    { id: "A-260324-05", text: "Prepare discussion topics for Friday: From POS to BOSS and From Integrations to Plug-Ins", owner: "Felipe", ownerColor: "#7B61FF", ownerInitial: "F", due: "27 Mar", status: "in-progress" }
  ],

  // LAYER 3: Operations
  operations: {
    scheduledTasks: [
      { id: "daily-completion-check", purpose: "Monitor #strategy-feed for completed actions, update tracker", frequency: "Daily 5 PM (Mon-Fri)", owner: "TARS", status: "Active" },
      { id: "sync-tracker-to-html", purpose: "Regenerate tars-data.js, deploy to GitHub/Netlify", frequency: "Daily 5:53 PM", owner: "TARS", status: "Active" },
      { id: "monday-strategic-pulse", purpose: "Initiative health status, key decisions, pending decisions, strategic questions", frequency: "Monday 10 AM", owner: "TARS", status: "Active" },
      { id: "drive-session-naming-audit", purpose: "Verify Strategic Sessions folder naming conventions", frequency: "Monday 9 AM", owner: "TARS", status: "Active" },
      { id: "thursday-strategic-preview", purpose: "Meeting framing, initiative status, unresolved tensions, discussion questions", frequency: "Thursday 4 PM", owner: "TARS", status: "Active" },
      { id: "friday-meeting-briefing", purpose: "Process Fireflies transcripts, create executive briefing", frequency: "Friday 4:39 PM", owner: "TARS", status: "Active" },
      { id: "weekly-strategy-tracker-update", purpose: "Extract decisions and milestones from strategy sessions, update initiatives + backlog", frequency: "Friday 7 PM", owner: "TARS", status: "Active" },
      { id: "weekly-memory-maintenance", purpose: "Consolidate working memory from Slack into Mem reference files", frequency: "Sunday 8 PM", owner: "Second Brain", status: "Active" },
      { id: "weekly-mem-update", purpose: "Fetch new Fireflies meetings, create/update Mem briefing notes", frequency: "Friday 8 PM", owner: "Second Brain", status: "Active" },
      { id: "appstore-data-pull", purpose: "Weekly pull of Loyverse app store ratings and reviews", frequency: "Monday 9 AM", owner: "CASE", status: "Active" },
      { id: "hiagent-monitor", purpose: "Monitor all scheduled tasks, update dashboard, alert on failures", frequency: "Every 2 hours", owner: "HIAgent", status: "Active" }
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

// Rendering logic
document.addEventListener('DOMContentLoaded', function() {
  renderTARS();
});

function renderTARS() {
  // Initialize tab switching
  const tabButtons = document.querySelectorAll('.tars-tab-btn');
  const tabContents = document.querySelectorAll('.tars-tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.getAttribute('data-tab');
      showTab(tabName);
    });
  });

  // Render initiatives
  renderInitiatives();

  // Render backlog
  renderBacklog();

  // Render operations
  renderOperations();
}

function showTab(tabName) {
  const tabButtons = document.querySelectorAll('.tars-tab-btn');
  const tabContents = document.querySelectorAll('.tars-tab-content');

  tabButtons.forEach(btn => btn.classList.remove('active'));
  tabContents.forEach(content => content.classList.remove('active'));

  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tars-${tabName}`).classList.add('active');
}

function renderInitiatives() {
  const grid = document.getElementById('tars-initiatives-grid');
  if (!grid) return;

  grid.innerHTML = '';

  TARS_DATA.initiatives.forEach(initiative => {
    const completedMilestones = initiative.milestones.filter(m => m.status === 'complete').length;
    const totalMilestones = initiative.milestones.length;
    const milestoneProgress = `${completedMilestones}/${totalMilestones} milestones complete`;

    const healthColor = initiative.health === 'blocked' ? '#CC3333' :
                        initiative.health === 'at-risk' ? '#E1A21D' : '#2DC46B';

    const card = document.createElement('div');
    card.className = 'tars-initiative-card';
    card.innerHTML = `
      <div class="tars-card-header">
        <div class="tars-card-title">${initiative.name}</div>
        <div class="tars-health-indicator" style="background-color: ${healthColor};" title="${initiative.healthReason}"></div>
      </div>

      <div class="tars-card-meta">
        <div class="tars-owner-badge" style="background-color: ${initiative.ownerColor};">${initiative.ownerInitial}</div>
        <div class="tars-phase-badge">${initiative.phase}</div>
      </div>

      <div class="tars-health-reason">${initiative.healthReason}</div>

      <div class="tars-milestone-progress">${milestoneProgress}</div>

      <div class="tars-decision-box">
        <div class="tars-decision-label">Latest Decision</div>
        <div class="tars-decision-text">${initiative.latestDecision}</div>
      </div>

      <div class="tars-decision-box">
        <div class="tars-decision-label">Next Decision Point</div>
        <div class="tars-decision-text">${initiative.nextDecisionPoint}</div>
      </div>

      <button class="tars-expand-btn" data-id="${initiative.id}">Expand to view milestones & actions</button>

      <div class="tars-expanded-content" id="expanded-${initiative.id}" style="display: none;">
        <div class="tars-context-box">
          <div class="tars-section-label">Context</div>
          <div class="tars-context-text">${initiative.context}</div>
        </div>

        <div class="tars-milestones-section">
          <div class="tars-section-label">Milestones</div>
          <div class="tars-milestones-list">
            ${initiative.milestones.map(m => `
              <div class="tars-milestone-item">
                <div class="tars-milestone-checkbox ${m.status === 'complete' ? 'checked' : ''}"></div>
                <div class="tars-milestone-content">
                  <div class="tars-milestone-name">${m.name}</div>
                  <div class="tars-milestone-meta">
                    <span class="tars-milestone-status">${m.status}</span>
                    ${m.date ? `<span class="tars-milestone-date">${m.date}</span>` : ''}
                  </div>
                  ${m.notes ? `<div class="tars-milestone-notes">${m.notes}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="tars-actions-section">
          <div class="tars-section-label">Related Actions</div>
          <div class="tars-actions-list">
            ${initiative.actions.map(action => `
              <div class="tars-action-item">
                <div class="tars-action-id">${action.id}</div>
                <div class="tars-action-text">${action.text}</div>
                <div class="tars-action-meta">
                  <span class="tars-owner-small" style="background-color: ${action.ownerColor};">${action.ownerInitial}</span>
                  <span class="tars-due">${action.due}</span>
                  <span class="tars-status ${action.status}">${action.status}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    grid.appendChild(card);

    // Attach expand/collapse handler
    card.querySelector('.tars-expand-btn').addEventListener('click', function() {
      const expanded = document.getElementById(`expanded-${initiative.id}`);
      const isVisible = expanded.style.display !== 'none';
      expanded.style.display = isVisible ? 'none' : 'block';
      this.textContent = isVisible ? 'Expand to view milestones & actions' : 'Collapse';
    });
  });
}

function renderBacklog() {
  const list = document.getElementById('tars-backlog-list');
  if (!list) return;

  // Get unique owners
  const owners = [...new Set(TARS_DATA.backlog.map(a => a.owner))];

  // Create filter
  const filterContainer = document.createElement('div');
  filterContainer.className = 'tars-backlog-filter';

  const allBtn = document.createElement('button');
  allBtn.className = 'tars-owner-filter-btn active';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', function() {
    document.querySelectorAll('.tars-owner-filter-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    renderBacklogItems(TARS_DATA.backlog);
  });
  filterContainer.appendChild(allBtn);

  owners.forEach(owner => {
    const btn = document.createElement('button');
    btn.className = 'tars-owner-filter-btn';
    btn.textContent = owner;
    const ownerData = TARS_DATA.backlog.find(a => a.owner === owner);
    if (ownerData) {
      btn.style.borderColor = ownerData.ownerColor;
    }
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tars-owner-filter-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const filtered = TARS_DATA.backlog.filter(a => a.owner === owner);
      renderBacklogItems(filtered);
    });
    filterContainer.appendChild(btn);
  });

  list.appendChild(filterContainer);

  // Render all items initially
  renderBacklogItems(TARS_DATA.backlog);
}

function renderBacklogItems(items) {
  let itemsContainer = document.getElementById('tars-backlog-items');
  if (!itemsContainer) {
    itemsContainer = document.createElement('div');
    itemsContainer.id = 'tars-backlog-items';
    itemsContainer.className = 'tars-backlog-items';
    document.getElementById('tars-backlog-list').appendChild(itemsContainer);
  }

  itemsContainer.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'tars-backlog-table';

  const header = document.createElement('tr');
  header.innerHTML = `
    <th>ID</th>
    <th>Action</th>
    <th>Owner</th>
    <th>Due</th>
    <th>Status</th>
  `;
  table.appendChild(header);

  items.forEach(action => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="tars-action-id-col">${action.id}</td>
      <td class="tars-action-text-col">${action.text}</td>
      <td class="tars-owner-col">
        <span class="tars-owner-badge-small" style="background-color: ${action.ownerColor};">${action.ownerInitial}</span>
        ${action.owner}
      </td>
      <td class="tars-due-col">${action.due}</td>
      <td class="tars-status-col">
        <span class="tars-status-badge ${action.status}">${action.status}</span>
      </td>
    `;
    table.appendChild(row);
  });

  itemsContainer.appendChild(table);
}

function renderOperations() {
  const container = document.getElementById('tars-ops-container');
  if (!container) return;

  container.innerHTML = '';

  // Scheduled tasks
  const tasksSection = document.createElement('div');
  tasksSection.className = 'tars-ops-section';
  tasksSection.innerHTML = '<div class="tars-section-label">Scheduled Tasks</div>';

  const tasksTable = document.createElement('table');
  tasksTable.className = 'tars-tasks-table';
  tasksTable.innerHTML = `
    <tr>
      <th>Purpose</th>
      <th>Frequency</th>
      <th>Owner</th>
      <th>Status</th>
    </tr>
  `;

  TARS_DATA.operations.scheduledTasks.forEach(task => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${task.purpose}</td>
      <td>${task.frequency}</td>
      <td>${task.owner}</td>
      <td><span class="tars-status-badge active">${task.status}</span></td>
    `;
    tasksTable.appendChild(row);
  });

  tasksSection.appendChild(tasksTable);
  container.appendChild(tasksSection);

  // Weekly rhythm
  const rhythmSection = document.createElement('div');
  rhythmSection.className = 'tars-ops-section';
  rhythmSection.innerHTML = `
    <div class="tars-section-label">Weekly Rhythm</div>
    <div class="tars-ops-text">${TARS_DATA.operations.weeklyRhythm}</div>
  `;
  container.appendChild(rhythmSection);

  // Connected platforms
  const platformsSection = document.createElement('div');
  platformsSection.className = 'tars-ops-section';
  platformsSection.innerHTML = '<div class="tars-section-label">Connected Platforms</div>';

  const platformsList = document.createElement('ul');
  platformsList.className = 'tars-platforms-list';
  TARS_DATA.operations.connectedPlatforms.forEach(platform => {
    const li = document.createElement('li');
    li.textContent = platform;
    platformsList.appendChild(li);
  });

  platformsSection.appendChild(platformsList);
  container.appendChild(platformsSection);

  // How to interact
  const interactSection = document.createElement('div');
  interactSection.className = 'tars-ops-section';
  interactSection.innerHTML = `
    <div class="tars-section-label">How to Interact</div>
    <div class="tars-ops-text">${TARS_DATA.operations.howToInteract}</div>
  `;
  container.appendChild(interactSection);
}
