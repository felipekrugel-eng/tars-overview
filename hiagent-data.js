// HIAgent — Live Agent Registry Data
// Auto-updated by hiagent-monitor scheduled task
// Last sync: 2026-05-05T11:01:34Z

const HIAGENT_DATA = {
  lastSync: "2026-05-05T11:01:34Z",

  tasks: [
    {
      id: "friday-meeting-briefing",
      name: "Friday Meeting Briefing",
      description: "Friday 4:39 PM — Post-session strategic summary: narrative account of what was discussed, decided, and where the team landed, sent as email to leadership and posted to #strategy-feed",
      schedule: "Friday 4:39 PM",
      cron: "30 16 * * 5",
      cadence: "weekly-fri",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-05-01T15:36:24.764Z",
      nextRunAt: "2026-05-08T15:39:14.000Z"
    },
    {
      id: "monday-action-reminder",
      name: "Monday Action Reminder",
      description: "Monday 10 AM — Strategic Pulse: one focused view on what matters this week, posted to #strategy-feed and drafted as email to leadership",
      schedule: "Monday 10 AM",
      cron: "0 10 * * 1",
      cadence: "weekly-mon",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-05-04T09:05:10.062Z",
      nextRunAt: "2026-05-11T09:05:39.000Z"
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
      lastRunAt: "2026-04-30T15:03:45.867Z",
      nextRunAt: "2026-05-07T15:03:32.000Z"
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
      nextRunAt: null
    },
    {
      id: "session-07-archive-v2",
      name: "Session 07 Archive V2",
      description: "One-time backfill: save Session 07 HTML archive to correct Shared Drive path",
      schedule: "One-time (Mar 18, 2026)",
      cron: "—",
      cadence: "daily",
      owner: "TARS",
      enabled: false,
      lastRunAt: "2026-03-18T11:00:45.810Z",
      nextRunAt: null
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
      lastRunAt: "2026-05-04T08:05:39.253Z",
      nextRunAt: "2026-05-11T08:06:26.000Z"
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
      lastRunAt: "2026-05-01T18:01:06.394Z",
      nextRunAt: "2026-05-08T18:04:44.000Z"
    },
    {
      id: "daily-completion-check",
      name: "Daily Completion Check",
      description: "Daily 5 PM — Scan #strategy-feed for completed actions and new signals, update tracker and initiative health indicators",
      schedule: "Daily 5 PM (Mon-Fri)",
      cron: "0 17 * * 1-5",
      cadence: "weekday",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-05-04T16:07:20.205Z",
      nextRunAt: "2026-05-05T16:07:02.000Z"
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
      lastRunAt: "2026-05-04T16:47:56.554Z",
      nextRunAt: "2026-05-05T16:53:08.000Z"
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
      lastRunAt: "2026-05-03T19:05:31.654Z",
      nextRunAt: "2026-05-10T19:06:11.000Z"
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
      lastRunAt: "2026-05-01T19:04:32.597Z",
      nextRunAt: "2026-05-08T19:09:01.000Z"
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
      lastRunAt: "2026-05-04T08:05:39.453Z",
      nextRunAt: "2026-05-11T08:00:58.000Z"
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
      lastRunAt: "2026-04-30T15:32:24.501Z",
      nextRunAt: "2026-05-07T15:32:11.000Z"
    },
    {
      id: "hiagent-monitor",
      name: "HIAgent Monitor",
      description: "Monitor all scheduled tasks, update hiagent-data.js with live status, push to GitHub, and alert Felipe on Slack if any task has failed or missed its run.",
      schedule: "Daily 12 PM",
      cron: "0 12 * * *",
      cadence: "daily",
      owner: "HIAgent",
      enabled: true,
      lastRunAt: "2026-05-05T11:00:51.200Z",
      nextRunAt: "2026-05-06T11:00:45.000Z"
    },
    {
      id: "friday-session-archive",
      name: "Friday Session Archive",
      description: "Friday 6:30 PM — Create local session folder with 3 core .docx docs (Pre-read, Transcript, Briefing) plus optional extras, for manual upload to Google Drive",
      schedule: "Friday 6:30 PM",
      cron: "30 18 * * 5",
      cadence: "weekly-fri",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-05-01T17:32:58.971Z",
      nextRunAt: "2026-05-08T17:34:09.000Z"
    },
    {
      id: "case-snowflake-pull",
      name: "Case Snowflake Pull",
      description: "DISABLED — Snowflake pull now runs via GitHub Actions (daily 6 AM UTC). See .github/workflows/snowflake-pull.yml in tars-overview repo.",
      schedule: "Daily 6:10 AM",
      cron: "0 6 * * *",
      cadence: "daily",
      owner: "TARS",
      enabled: false,
      lastRunAt: "2026-04-08T05:10:28.767Z",
      nextRunAt: null
    },
    {
      id: "daily-simon-briefing",
      name: "Daily Simon Briefing",
      description: "Mon–Thu 4 PM — Fetch daily Felipe × Simon touchpoint transcript from Fireflies, generate briefing note in Mem, and save archive files locally for manual upload to Google Drive",
      schedule: "Mon-Thu 4 PM",
      cron: "0 16 * * 1-4",
      cadence: "weekday",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-05-04T15:07:59.707Z",
      nextRunAt: "2026-05-05T15:01:14.000Z"
    },
    {
      id: "weekly-payments-briefing",
      name: "Weekly Payments Briefing",
      description: "Thursday 7 PM — Fetch weekly Embedded Payments meeting transcript from Fireflies, generate briefing note in Mem, and save archive files locally for manual upload to Google Drive",
      schedule: "Thursday 7 PM",
      cron: "0 19 * * 4",
      cadence: "weekly-thu",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-04-30T18:02:54.297Z",
      nextRunAt: "2026-05-07T18:09:02.000Z"
    }
  ],

  infrastructure: [
    {
      name: "TARS Overview Dashboard",
      url: "https://tars-overview.netlify.app",
      type: "Netlify",
      status: "live",
      repo: "felipekrugel-eng/tars-overview"
    },
    {
      name: "Swiss Pricing Dashboard",
      url: "https://loyverse-pricing-ch.netlify.app",
      type: "Netlify",
      status: "live",
      repo: "felipekrugel-eng/loyverse-pricing-ch"
    }
  ],

  skills: [
    { name: "case-skill", category: "Intelligence" },
    { name: "loyverse-brand", category: "Design" },
    { name: "second-brain", category: "Memory" },
    { name: "docx", category: "Document" },
    { name: "pdf", category: "Document" },
    { name: "pptx", category: "Document" },
    { name: "xlsx", category: "Document" },
    { name: "skill-creator", category: "Meta" }
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
