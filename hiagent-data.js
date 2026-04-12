// HIAgent — Live Agent Registry Data
// Auto-updated by hiagent-monitor scheduled task
// Last sync: 2026-04-12T14:59:38Z

const HIAGENT_DATA = {
  lastSync: "2026-04-12T14:59:38Z",

  tasks: [
    {
      id: "daily-completion-check",
      name: "Daily Completion Check",
      description: "Daily 5 PM — Scan #strategy-feed for completed actions and new signals, update tracker and initiative health indicators",
      schedule: "Daily 5 PM (Mon–Fri)",
      cron: "0 17 * * 1-5",
      cadence: "weekday",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-10T16:05:44.904Z",
      nextRunAt: "2026-04-13T16:07:02.000Z",
      detail: {
        purpose: "Keeps the Action Tracker current by scanning Slack's #strategy-feed channel for completion updates and new actions posted throughout the day.",
        process: "Reads #strategy-feed messages since last run, matches them against open actions in the Google Sheets tracker, marks completed items, and adds any new actions discovered. Sends a summary to Felipe via Slack DM.",
        outputs: "Updated Action_Tracker.xlsx in Google Drive; Slack summary of changes.",
        dependencies: "Slack (#strategy-feed), Google Drive (Action_Tracker.xlsx)"
      }
    },
    {
      id: "sync-tracker-to-html",
      name: "Sync Tracker to Dashboard",
      description: "Daily 5:53 PM — Regenerate tars-data.js from Google Drive Action Tracker, deploy to GitHub/Netlify. Data file only — never touches index.html.",
      schedule: "Daily 5:53 PM",
      cron: "45 17 * * *",
      cadence: "daily",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-11T16:46:05.647Z",
      nextRunAt: "2026-04-12T16:53:08.000Z",
      detail: {
        purpose: "Bridges the Google Sheets Action Tracker to the live TARS dashboard on Netlify, ensuring the web view always reflects the latest data.",
        process: "Reads Action_Tracker.xlsx from Google Drive, transforms it into a JavaScript data file (tars-data.js), clones the tars-overview repo, writes the updated file, commits, and pushes. Netlify auto-deploys.",
        outputs: "Updated tars-data.js deployed to tars-overview.netlify.app.",
        dependencies: "Google Drive (Action_Tracker.xlsx), GitHub (tars-overview repo), Netlify"
      }
    },
    {
      id: "monday-action-reminder",
      name: "Monday Action Reminder",
      description: "Monday 10 AM — Strategic Pulse: one focused view on what matters this week, sent to #strategy-feed",
      schedule: "Monday 10 AM",
      cron: "0 10 * * 1",
      cadence: "weekly-mon",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-07T07:55:47.480Z",
      nextRunAt: "2026-04-13T09:05:39.000Z",
      detail: {
        purpose: "Kicks off each week by sending personalized Slack DMs to each leadership team member with their outstanding action items and strategic context.",
        process: "Reads the Action Tracker, groups open actions by owner, crafts a personalized message for each person with their priorities and any relevant context from recent strategy sessions. Also posts a team-wide summary to #strategy-feed.",
        outputs: "Individual Slack DMs to each team member; team summary in #strategy-feed.",
        dependencies: "Google Drive (Action_Tracker.xlsx), Slack (DMs + #strategy-feed)"
      }
    },
    {
      id: "drive-session-naming-audit",
      name: "Drive Naming Audit",
      description: "Monday 9 AM — audit Strategic Sessions Drive folders for naming conventions, track violations over time, flag recurring issues",
      schedule: "Monday 9 AM",
      cron: "0 9 * * 1",
      cadence: "weekly-mon",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-06T13:29:09.020Z",
      nextRunAt: "2026-04-13T08:06:26.000Z",
      detail: {
        purpose: "Ensures all strategic session folders in Google Drive follow consistent naming conventions for easy navigation and retrieval.",
        process: "Scans the Strategic Sessions folder tree, identifies any folders or files that don't match the naming pattern, and reports violations to Felipe via Slack DM.",
        outputs: "Slack DM with any naming convention issues found.",
        dependencies: "Google Drive (Strategic Sessions folder), Slack"
      }
    },
    {
      id: "thursday-meeting-preview",
      name: "Thursday Meeting Preview",
      description: "Thursday 4 PM — Strategic Pre-read: one focused strategic topic with depth and conviction, sent as email to leadership team and posted to #strategy-feed",
      schedule: "Thursday 4 PM",
      cron: "0 16 * * 4",
      cadence: "weekly-thu",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-09T15:04:22.668Z",
      nextRunAt: "2026-04-16T15:03:32.000Z",
      detail: {
        purpose: "Prepares leadership for Friday's strategy meeting by sending an advance email with discussion topics, key metrics, and context from previous sessions.",
        process: "Reviews the Action Tracker for discussion-worthy items, checks recent Fireflies transcripts for unresolved threads, compiles CASE metrics context, and sends a structured preview email via Gmail to leadership.",
        outputs: "Email to leadership with Friday meeting preview; Slack notification.",
        dependencies: "Google Drive, Gmail, Fireflies, Slack"
      }
    },
    {
      id: "thursday-strategy-deck",
      name: "Thursday Strategy Deck",
      description: "Thursday 4:30 PM — generate Friday Strategy Briefing deck (PPTX) with initiative status, CASE metrics, 5YP context, and decisions needed",
      schedule: "Thursday 4:30 PM",
      cron: "30 16 * * 4",
      cadence: "weekly-thu",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-09T15:33:01.788Z",
      nextRunAt: "2026-04-16T15:32:11.000Z",
      detail: {
        purpose: "Generates a polished PowerPoint briefing deck for Friday's strategy session, incorporating the latest business case data, 5-year plan context, and outstanding action items.",
        process: "Reads CASE data, 5YP context, and the Action Tracker. Builds a branded PPTX with discussion topics, key metrics, and outstanding actions. Saves to Google Drive Strategic Sessions folder.",
        outputs: "Friday Strategy Briefing deck (PPTX) in Google Drive.",
        dependencies: "CASE skill, Google Drive, Action Tracker, pptx skill"
      }
    },
    {
      id: "friday-meeting-briefing",
      name: "Friday Meeting Briefing",
      description: "Friday 4:39 PM — Post-session strategic summary: narrative account of what was discussed, decided, and where the team landed, sent as email to leadership and posted to #strategy-feed",
      schedule: "Friday 4:39 PM",
      cron: "30 16 * * 5",
      cadence: "weekly-fri",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-10T15:33:50.114Z",
      nextRunAt: "2026-04-17T15:39:14.000Z",
      detail: {
        purpose: "Creates a polished executive briefing from the Friday strategy meeting transcript, capturing key decisions, new actions, and strategic insights.",
        process: "Fetches the latest meeting transcript from Fireflies, extracts decisions, action items, and discussion themes. Generates a structured briefing and delivers it via Gmail and Slack. Also updates the Action Tracker with any new actions identified.",
        outputs: "Executive briefing email; Slack post to #strategy-feed; updated Action Tracker.",
        dependencies: "Fireflies (transcript), Gmail, Slack, Google Drive (Action_Tracker.xlsx)"
      }
    },
    {
      id: "friday-session-archive",
      name: "Friday Session Archive",
      description: "Friday 6:30 PM — Create session folder in Google Drive, save Monday Pulse, Thursday Preview, Thursday Deck, Friday Briefing, and Fireflies transcript",
      schedule: "Friday 6:30 PM",
      cron: "30 18 * * 5",
      cadence: "weekly-fri",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-10T17:36:30.356Z",
      nextRunAt: "2026-04-17T17:34:09.000Z",
      detail: {
        purpose: "End-of-week archival task that creates a complete session folder in Google Drive with all weekly deliverables for permanent reference.",
        process: "Creates a session folder in the Strategic Sessions Drive, saves Monday Pulse, Thursday Preview, Thursday Deck, Friday Briefing, and Fireflies transcript into it.",
        outputs: "Complete session folder in Google Drive Strategic Sessions.",
        dependencies: "Google Drive (Strategic Sessions folder), Fireflies"
      }
    },
    {
      id: "weekly-strategy-tracker-update",
      name: "Strategy Tracker Update",
      description: "Friday 7 PM — Extract decisions and milestones from strategy sessions, update initiatives + backlog in tars-data.js, deploy to GitHub/Netlify",
      schedule: "Friday 7 PM",
      cron: "0 19 * * 5",
      cadence: "weekly-fri",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-10T18:02:33.445Z",
      nextRunAt: "2026-04-17T18:04:44.000Z",
      detail: {
        purpose: "End-of-week housekeeping that ensures the Action Tracker reflects everything discussed in the Friday session.",
        process: "Reads the latest session notes and Fireflies transcript, cross-references with the existing Action Tracker, adds new actions, updates statuses, and archives completed items. Writes the updated tracker back to Google Drive.",
        outputs: "Updated Action_Tracker.xlsx in Google Drive.",
        dependencies: "Google Drive (Strategic Sessions folder, Action_Tracker.xlsx), Fireflies"
      }
    },
    {
      id: "weekly-memory-maintenance",
      name: "Memory Maintenance",
      description: "Sunday 8 PM — consolidate working memory from Slack into reference files, update the second brain",
      schedule: "Sunday 8 PM",
      cron: "0 20 * * 0",
      cadence: "weekly-sun",
      owner: "Second Brain",
      enabled: true,
      lastRunAt: "2026-04-05T20:32:13.966Z",
      nextRunAt: "2026-04-12T19:06:11.000Z",
      detail: {
        purpose: "Maintains long-term agent memory by consolidating ephemeral working context from Slack conversations into structured reference files.",
        process: "Scans recent Slack activity across key channels, identifies important decisions, context changes, and new information. Consolidates this into the second-brain reference files for future session continuity.",
        outputs: "Updated second-brain reference files.",
        dependencies: "Slack, Second Brain skill files"
      }
    },
    {
      id: "weekly-mem-update",
      name: "Mem Briefing Update",
      description: "Friday 8 PM — fetch new meetings from Fireflies, create/update Mem briefing notes, keep Session Index current, flag any 5YP conflicts.",
      schedule: "Friday 8 PM",
      cron: "0 20 * * 5",
      cadence: "weekly-fri",
      owner: "Second Brain",
      enabled: true,
      lastRunAt: "2026-04-10T19:04:53.999Z",
      nextRunAt: "2026-04-17T19:09:01.000Z",
      detail: {
        purpose: "Creates structured meeting briefing notes in Mem from Fireflies transcripts, building a searchable knowledge base of all strategic discussions.",
        process: "Fetches new meeting transcripts from Fireflies since the last run, processes each into a structured briefing note format, and creates or updates corresponding notes in Mem with key topics, decisions, and action items.",
        outputs: "New or updated Mem notes for each meeting.",
        dependencies: "Fireflies, Mem"
      }
    },
    {
      id: "appstore-data-pull",
      name: "App Store Data Pull",
      description: "Weekly pull of Loyverse app store ratings and reviews, updating case-data.js (isolated data file) and deploying to GitHub/Netlify.",
      schedule: "Monday 9 AM",
      cron: "0 9 * * 1",
      cadence: "weekly-mon",
      owner: "CASE",
      enabled: true,
      lastRunAt: "2026-04-06T21:07:28.263Z",
      nextRunAt: "2026-04-13T08:00:58.000Z",
      detail: {
        purpose: "Collects competitive intelligence by pulling Loyverse's latest app store ratings and review data for the CASE dashboard.",
        process: "Queries App Store and Google Play Store APIs for Loyverse POS app ratings, review counts, and recent review text. Transforms the data and updates the CASE data files.",
        outputs: "Updated app store metrics in case-data.js.",
        dependencies: "App Store API, Google Play API"
      }
    },
    {
      id: "session-07-archive",
      name: "Session 07 Archive",
      description: "One-time task: generate Session 07 HTML archive and save to Shared Drive",
      schedule: "One-time (Mar 18, 2026)",
      cron: "—",
      cadence: "daily",
      owner: "TARS",
      enabled: false,
      lastRunAt: "2026-03-18T10:30:45.782Z",
      nextRunAt: null,
      detail: {
        purpose: "One-time backfill task to create an HTML archive for Session 07 in the Shared Drive.",
        process: "Generated session HTML from session notes and saved to the Strategic Sessions Google Drive folder.",
        outputs: "Session 07 HTML archive in Google Drive.",
        dependencies: "Google Drive (Strategic Sessions folder)"
      }
    },
    {
      id: "session-07-archive-v2",
      name: "Session 07 Archive v2",
      description: "One-time backfill: save Session 07 HTML archive to correct Shared Drive path",
      schedule: "One-time (Mar 18, 2026)",
      cron: "—",
      cadence: "daily",
      owner: "TARS",
      enabled: false,
      lastRunAt: "2026-03-18T11:00:45.810Z",
      nextRunAt: null,
      detail: {
        purpose: "Retry of Session 07 archive task to save to the correct path in Shared Drive.",
        process: "Re-generated session HTML and saved to the corrected Strategic Sessions Google Drive folder path.",
        outputs: "Session 07 HTML archive in correct Google Drive location.",
        dependencies: "Google Drive (Strategic Sessions folder)"
      }
    },
    {
      id: "case-snowflake-pull",
      name: "CASE Snowflake Pull",
      description: "DISABLED — Snowflake pull now runs via GitHub Actions (daily 6 AM UTC)",
      schedule: "Daily 6:10 AM",
      cron: "0 6 * * *",
      cadence: "daily",
      owner: "TARS",
      enabled: false,
      lastRunAt: "2026-04-08T05:10:28.767Z",
      nextRunAt: null,
      detail: {
        purpose: "Keeps the CASE dashboard data fresh by pulling the latest business metrics from Snowflake daily. Now migrated to GitHub Actions.",
        process: "Connects to Snowflake, extracts the latest Loyverse business metrics (GTV, revenue, ARPC, etc.), transforms them into the case-data.js format, commits to the tars-overview repo, and Netlify auto-deploys.",
        outputs: "Updated case-data.js deployed to tars-overview.netlify.app.",
        dependencies: "Snowflake, GitHub (tars-overview repo), Netlify"
      }
    },
    {
      id: "hiagent-monitor",
      name: "HIAgent Monitor",
      description: "Monitor all scheduled tasks, update dashboard data, alert on failures",
      schedule: "Every 4 hours",
      cron: "0 */4 * * *",
      cadence: "daily",
      owner: "HIAgent",
      enabled: true,
      lastRunAt: "2026-04-12T14:59:38Z",
      nextRunAt: "2026-04-12T19:00:45.000Z",
      detail: {
        purpose: "Self-monitoring agent that keeps the HIAgent dashboard live and alerts Felipe when any automation breaks.",
        process: "Calls list_scheduled_tasks to get current states, rebuilds hiagent-data.js with fresh timestamps, pushes to GitHub (Netlify auto-deploys). Evaluates each task against cadence-aware health thresholds. If any task is overdue or missed, sends a Slack DM alert to Felipe.",
        outputs: "Updated hiagent-data.js on GitHub; Slack alert on failures (silent on success).",
        dependencies: "Scheduled Tasks API, GitHub (tars-overview repo), Slack"
      }
    }
  ],

  infrastructure: [
    {
      name: "Command Centre",
      url: "https://tars-overview.netlify.app",
      type: "Netlify",
      status: "live",
      repo: "felipekrugel-eng/tars-overview",
      owner: "HIAgent",
      detail: {
        purpose: "Loyverse's central operations hub — a single-page app hosting all five operational panels under one roof.",
        stack: "Static HTML/CSS/JS with modular data files (tars-data.js, case-data.js, fyp-data.js, intel-data.js, hiagent-data.js). Deployed via GitHub push to Netlify with auto-deploy.",
        panels: "Hub (portal), TARS, CASE, 5YP, Market Intel, HIAgent",
        updatedBy: "sync-tracker-to-html (TARS data), hiagent-monitor (HIAgent data), manual deploys"
      }
    },
    {
      name: "TARS",
      url: "https://tars-overview.netlify.app",
      type: "Netlify",
      status: "live",
      repo: "felipekrugel-eng/tars-overview",
      owner: "TARS",
      detail: {
        purpose: "Strategy action tracker — monitors leadership team actions from Friday strategy sessions, tracks ownership, status, due dates, and completion.",
        stack: "Panel within the Command Centre, powered by tars-data.js which is auto-generated from the Google Sheets Action Tracker.",
        panels: "Action cards with owner badges, status filters, overdue alerts, completion metrics",
        updatedBy: "sync-tracker-to-html (daily), daily-completion-check (status updates), weekly-strategy-tracker-update (new actions)"
      }
    },
    {
      name: "CASE",
      url: "https://tars-overview.netlify.app",
      type: "Netlify",
      status: "live",
      repo: "felipekrugel-eng/tars-overview",
      owner: "CASE",
      detail: {
        purpose: "Business case analytics — revenue projections, KPI tracking, competitive benchmarks, and strategic phase milestones for Loyverse.",
        stack: "Panel within the Command Centre, powered by case-data.js which contains the financial model, market data, and competitive intelligence.",
        panels: "Revenue model, payment penetration, ARPC analysis, cohort economics, competitive matrix, unit economics",
        updatedBy: "Manual updates via case-data.js; appstore-data-pull (app ratings data); case-snowflake-pull (daily metrics)"
      }
    }
  ],

  skills: [
    { name: "case-skill", category: "Intelligence", detail: { purpose: "Loyverse business case analytics — financial model, revenue projections, KPIs, market data, competitive benchmarks, and strategic phase milestones.", triggers: "Financials, revenue, GTV, ARPC, take rates, pricing model, Phase 2 strategy, 5-year plan, business case, investor materials, competitive analysis, growth strategy.", owner: "Felipe", usedBy: "CASE panel, strategy presentations, board decks, fundraising content" } },
    { name: "loyverse-brand", category: "Design", detail: { purpose: "Loyverse brand code and design system — ensures all visual outputs follow brand guidelines with correct colors, typography, and layout patterns.", triggers: "Any Loyverse-branded content: presentations, slides, decks, documents, one-pagers, reports, visual assets.", owner: "Felipe", usedBy: "All presentation and document creation tasks" } },
    { name: "second-brain", category: "Memory", detail: { purpose: "Persistent memory system that provides continuity across sessions — team structure, strategic decisions, past work, and automation context.", triggers: "Session start, remember, context, what do you know, pick up where we left off, references to past work.", owner: "Felipe", usedBy: "Every session start, all scheduled tasks requiring historical context" } },
    { name: "docx", category: "Document", detail: { purpose: "Create, read, edit, and manipulate Word documents with professional formatting.", triggers: "Word doc, .docx, report, memo, letter, template as Word file.", owner: "System", usedBy: "Reports, memos, offer letters, policy documents" } },
    { name: "pdf", category: "Document", detail: { purpose: "PDF manipulation toolkit — extract text/tables, create, merge, split, fill forms, encrypt, OCR scanned documents.", triggers: "PDF, .pdf, form, extract, merge, split.", owner: "System", usedBy: "Document processing, form filling, report generation" } },
    { name: "pptx", category: "Document", detail: { purpose: "Full PowerPoint support — create decks, read/parse existing presentations, edit slides, work with templates, speaker notes, and comments.", triggers: "Deck, slides, presentation, .pptx, pitch deck.", owner: "System", usedBy: "Strategy decks, Friday briefing deck, board presentations" } },
    { name: "xlsx", category: "Document", detail: { purpose: "Excel spreadsheet creation and analysis — formulas, formatting, data analysis, charts, and visualization.", triggers: "Excel, spreadsheet, .xlsx, data table, budget, financial model, chart.", owner: "System", usedBy: "Action Tracker, financial models, data analysis" } },
    { name: "skill-creator", category: "Meta", detail: { purpose: "Create new skills, modify existing ones, run evals, benchmark performance, and optimize skill descriptions.", triggers: "Create a skill, edit skill, optimize skill, run evals, benchmark skill.", owner: "System", usedBy: "Skill development and optimization workflows" } }
  ]
};

// ─── STATUS CALCULATION ───
function hiagentCalcStatus(task) {
  if (!task.enabled) return { status: 'disabled', label: 'Disabled', color: '#888' };
  if (!task.lastRunAt) return { status: 'pending', label: 'Never run', color: '#C47B10' };

  var now = new Date();
  var lastRun = new Date(task.lastRunAt);
  var hoursSince = (now - lastRun) / (1000 * 60 * 60);

  var maxHours;
  switch (task.cadence) {
    case 'daily':     maxHours = 26; break;
    case 'weekday':   maxHours = 74; break;
    case 'weekly-mon': case 'weekly-thu': case 'weekly-fri': case 'weekly-sun':
      maxHours = 170; break;
    default: maxHours = 170; break;
  }

  if (task.nextRunAt) {
    var nextRun = new Date(task.nextRunAt);
    var graceMs = 2 * 60 * 60 * 1000;
    if (now > new Date(nextRun.getTime() + graceMs) && lastRun < nextRun) {
      return { status: 'failed', label: 'Missed run', color: '#CC3333' };
    }
  }

  if (hoursSince > maxHours) {
    return { status: 'failed', label: 'Overdue', color: '#CC3333' };
  }

  return { status: 'healthy', label: 'Healthy', color: '#2DC46B' };
}

// ─── TIME FORMATTING ───
function hiagentTimeAgo(isoStr) {
  if (!isoStr) return 'Never';
  var now = new Date();
  var then = new Date(isoStr);
  var diffMs = now - then;
  var mins = Math.floor(diffMs / 60000);
  var hrs = Math.floor(mins / 60);
  var days = Math.floor(hrs / 24);

  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  if (hrs < 24) return hrs + 'h ago';
  if (days === 1) return 'Yesterday';
  return days + 'd ago';
}

function hiagentFormatDate(isoStr) {
  if (!isoStr) return '—';
  var d = new Date(isoStr);
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var h = d.getHours();
  var m = d.getMinutes();
  return days[d.getDay()] + ' ' + (h > 12 ? h - 12 : h) + ':' + (m < 10 ? '0' + m : m) + (h >= 12 ? 'PM' : 'AM');
}

// ─── DRILL-DOWN MODAL ───
function hiagentShowDrill(type, index) {
  var overlay = document.getElementById('hiagent-drill-overlay');
  var panel = document.getElementById('hiagent-drill-panel');
  if (!overlay || !panel) return;

  var ownerColors = { 'TARS': '#1D8FE1', 'CASE': '#2DC46B', 'Second Brain': '#7B3FA0', 'HIAgent': '#1D8FE1' };
  var html = '';

  if (type === 'task') {
    var t = HIAGENT_DATA.tasks[index];
    if (!t || !t.detail) return;
    var s = hiagentCalcStatus(t);
    var color = ownerColors[t.owner] || '#1D8FE1';

    html = '<div class="ha-drill-header" style="border-left: 4px solid ' + color + ';">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
        '<div class="ha-status-dot" style="background:' + s.color + ';width:12px;height:12px;"></div>' +
        '<h2 class="ha-drill-title">' + t.name + '</h2>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<span class="ha-badge ha-badge-schedule">' + t.schedule + '</span>' +
        '<span class="ha-badge ha-badge-owner" style="background:' + color + '">' + t.owner + '</span>' +
        '<span class="ha-badge" style="color:' + s.color + ';border-color:' + s.color + '">' + s.label + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="ha-drill-body">' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Purpose</div>' +
        '<div class="ha-drill-text">' + t.detail.purpose + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">How it works</div>' +
        '<div class="ha-drill-text">' + t.detail.process + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Outputs</div>' +
        '<div class="ha-drill-text">' + t.detail.outputs + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Dependencies</div>' +
        '<div class="ha-drill-text">' + t.detail.dependencies + '</div>' +
      '</div>' +
      '<div class="ha-drill-divider"></div>' +
      '<div class="ha-drill-row">' +
        '<div class="ha-drill-stat"><div class="ha-drill-stat-label">Cron</div><div class="ha-drill-stat-val" style="font-family:monospace;font-size:13px;">' + t.cron + '</div></div>' +
        '<div class="ha-drill-stat"><div class="ha-drill-stat-label">Cadence</div><div class="ha-drill-stat-val">' + t.cadence + '</div></div>' +
        '<div class="ha-drill-stat"><div class="ha-drill-stat-label">Last Run</div><div class="ha-drill-stat-val">' + hiagentTimeAgo(t.lastRunAt) + '</div></div>' +
        '<div class="ha-drill-stat"><div class="ha-drill-stat-label">Next Run</div><div class="ha-drill-stat-val">' + hiagentFormatDate(t.nextRunAt) + '</div></div>' +
      '</div>' +
    '</div>';

  } else if (type === 'infra') {
    var inf = HIAGENT_DATA.infrastructure[index];
    if (!inf || !inf.detail) return;
    var iColor = ownerColors[inf.owner] || '#1D8FE1';

    html = '<div class="ha-drill-header" style="border-left: 4px solid ' + iColor + ';">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
        '<div class="ha-status-dot" style="background:#2DC46B;width:12px;height:12px;"></div>' +
        '<h2 class="ha-drill-title">' + inf.name + '</h2>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<span class="ha-badge">' + inf.type + '</span>' +
        '<span class="ha-badge ha-badge-owner" style="background:' + iColor + '">' + inf.owner + '</span>' +
        '<span class="ha-badge" style="color:#2DC46B;border-color:#2DC46B">Live</span>' +
      '</div>' +
    '</div>' +
    '<div class="ha-drill-body">' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Purpose</div>' +
        '<div class="ha-drill-text">' + inf.detail.purpose + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Tech Stack</div>' +
        '<div class="ha-drill-text">' + inf.detail.stack + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Panels / Features</div>' +
        '<div class="ha-drill-text">' + inf.detail.panels + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Updated by</div>' +
        '<div class="ha-drill-text">' + inf.detail.updatedBy + '</div>' +
      '</div>' +
      '<div class="ha-drill-divider"></div>' +
      '<div class="ha-drill-row">' +
        '<div class="ha-drill-stat"><div class="ha-drill-stat-label">URL</div><a href="' + inf.url + '" target="_blank" class="ha-infra-link">' + inf.url.replace('https://','') + '</a></div>' +
        '<div class="ha-drill-stat"><div class="ha-drill-stat-label">Repo</div><div class="ha-drill-stat-val" style="font-family:monospace;font-size:13px;">' + inf.repo + '</div></div>' +
      '</div>' +
    '</div>';

  } else if (type === 'skill') {
    var sk = HIAGENT_DATA.skills[index];
    if (!sk || !sk.detail) return;

    html = '<div class="ha-drill-header" style="border-left: 4px solid #1D8FE1;">' +
      '<h2 class="ha-drill-title">' + sk.name + '</h2>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
        '<span class="ha-badge">' + sk.category + '</span>' +
        '<span class="ha-badge">' + sk.detail.owner + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="ha-drill-body">' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Purpose</div>' +
        '<div class="ha-drill-text">' + sk.detail.purpose + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Triggers</div>' +
        '<div class="ha-drill-text">' + sk.detail.triggers + '</div>' +
      '</div>' +
      '<div class="ha-drill-section">' +
        '<div class="ha-drill-label">Used by</div>' +
        '<div class="ha-drill-text">' + sk.detail.usedBy + '</div>' +
      '</div>' +
    '</div>';
  }

  panel.innerHTML = '<button class="ha-drill-close" onclick="hiagentCloseDrill()">&times;</button>' + html;
  overlay.classList.add('active');
}

function hiagentCloseDrill() {
  var overlay = document.getElementById('hiagent-drill-overlay');
  if (overlay) overlay.classList.remove('active');
}

function hiagentDrillOverlayClick(e) {
  if (e.target.id === 'hiagent-drill-overlay') hiagentCloseDrill();
}

// ─── RENDER PANEL ───
function hiagentRender() {
  var container = document.getElementById('hiagent-tasks-grid');
  if (!container) return;

  var healthy = 0, failed = 0, pending = 0;
  HIAGENT_DATA.tasks.forEach(function(t) {
    var s = hiagentCalcStatus(t);
    if (s.status === 'healthy') healthy++;
    else if (s.status === 'failed') failed++;
    else pending++;
  });

  var sumEl = document.getElementById('hiagent-summary');
  if (sumEl) {
    sumEl.innerHTML =
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#2DC46B">' + healthy + '</span><span class="ha-sum-label">Healthy</span></div>' +
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#CC3333">' + failed + '</span><span class="ha-sum-label">Failed</span></div>' +
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#C47B10">' + pending + '</span><span class="ha-sum-label">Pending</span></div>' +
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#1D8FE1">' + HIAGENT_DATA.tasks.length + '</span><span class="ha-sum-label">Total</span></div>';
  }

  var syncEl = document.getElementById('hiagent-sync-time');
  if (syncEl) syncEl.textContent = 'Last sync: ' + hiagentTimeAgo(HIAGENT_DATA.lastSync);

  var ownerColors = { 'TARS': '#1D8FE1', 'CASE': '#2DC46B', 'Second Brain': '#7B3FA0', 'HIAgent': '#1D8FE1' };
  var html = '';
  HIAGENT_DATA.tasks.forEach(function(t, idx) {
    var s = hiagentCalcStatus(t);
    var topColor = ownerColors[t.owner] || '#1D8FE1';
    html += '<div class="ha-card" onclick="hiagentShowDrill(\'task\',' + idx + ')" style="cursor:pointer;">' +
      '<div class="ha-card-top" style="background:' + topColor + '"></div>' +
      '<div class="ha-card-body">' +
        '<div class="ha-card-header">' +
          '<div class="ha-status-dot" style="background:' + s.color + '"></div>' +
          '<div class="ha-card-name">' + t.name + '</div>' +
        '</div>' +
        '<div class="ha-card-desc">' + t.description + '</div>' +
        '<div class="ha-card-meta">' +
          '<span class="ha-badge ha-badge-schedule">' + t.schedule + '</span>' +
          '<span class="ha-badge ha-badge-owner" style="background:' + topColor + '">' + t.owner + '</span>' +
        '</div>' +
        '<div class="ha-card-footer">' +
          '<span class="ha-card-status" style="color:' + s.color + '">' + s.label + '</span>' +
          '<span class="ha-card-time">Last: ' + hiagentTimeAgo(t.lastRunAt) + '</span>' +
          '<span class="ha-card-time">Next: ' + hiagentFormatDate(t.nextRunAt) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html;

  // Render infrastructure
  var infraEl = document.getElementById('hiagent-infra-grid');
  if (infraEl) {
    var infraHtml = '';
    HIAGENT_DATA.infrastructure.forEach(function(i, idx) {
      var iColor = ownerColors[i.owner] || '#1D8FE1';
      infraHtml += '<div class="ha-infra-card" onclick="hiagentShowDrill(\'infra\',' + idx + ')" style="cursor:pointer;border-left-color:' + iColor + ';">' +
        '<div class="ha-infra-body">' +
          '<div class="ha-card-header">' +
            '<div class="ha-status-dot" style="background:#2DC46B"></div>' +
            '<div class="ha-card-name">' + i.name + '</div>' +
          '</div>' +
          '<div class="ha-card-desc">' + i.type + ' · ' + i.owner + '</div>' +
          '<a href="' + i.url + '" target="_blank" class="ha-infra-link" onclick="event.stopPropagation()">' + i.url.replace('https://','') + ' →</a>' +
        '</div>' +
      '</div>';
    });
    infraEl.innerHTML = infraHtml;
  }

  // Render skills
  var skillsEl = document.getElementById('hiagent-skills-grid');
  if (skillsEl) {
    var skillsHtml = '';
    HIAGENT_DATA.skills.forEach(function(s, idx) {
      skillsHtml += '<span class="ha-skill" onclick="hiagentShowDrill(\'skill\',' + idx + ')" style="cursor:pointer;">' + s.name + '<span class="ha-skill-cat">' + s.category + '</span></span>';
    });
    skillsEl.innerHTML = skillsHtml;
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
  var origShow = window.showPanel;
  if (typeof origShow === 'function') {
    var _haInit = false;
    var _origShow = window.showPanel;
    window.showPanel = function(name) {
      _origShow(name);
      if (name === 'hiagent' && !_haInit) {
        _haInit = true;
        hiagentRender();
      }
    };
  }
});
