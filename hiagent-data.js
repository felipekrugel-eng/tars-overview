// HIAgent — Live Agent Registry Data
// Auto-updated by hiagent-monitor scheduled task
// Last sync: 2026-03-26T17:00:00Z

const HIAGENT_DATA = {
  lastSync: "2026-03-26T17:00:00Z",

  tasks: [
    {
      id: "daily-completion-check",
      name: "Daily Completion Check",
      description: "Scan #strategy-feed and tracker for completed & new actions; update tracker",
      schedule: "Daily 5 PM (Mon–Fri)",
      cron: "0 17 * * 1-5",
      cadence: "weekday",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-03-25T17:07:31Z",
      nextRunAt: "2026-03-26T17:07:02Z"
    },
    {
      id: "sync-tracker-to-html",
      name: "Sync Tracker to Dashboard",
      description: "Read Action Tracker sheet, regenerate tars-data.js, deploy to GitHub/Netlify",
      schedule: "Daily 5:53 PM",
      cron: "45 17 * * *",
      cadence: "daily",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-03-26T10:54:01Z",
      nextRunAt: "2026-03-26T17:53:08Z"
    },
    {
      id: "monday-action-reminder",
      name: "Monday Action Reminder",
      description: "Set up the week with strategic context, send each person their actions",
      schedule: "Monday 10 AM",
      cron: "0 10 * * 1",
      cadence: "weekly-mon",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-03-23T10:06:09Z",
      nextRunAt: "2026-03-30T09:05:39Z"
    },
    {
      id: "drive-session-naming-audit",
      name: "Drive Naming Audit",
      description: "Audit Strategic Sessions Drive folders for naming conventions",
      schedule: "Monday 9 AM",
      cron: "0 9 * * 1",
      cadence: "weekly-mon",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-03-23T09:56:14Z",
      nextRunAt: "2026-03-30T08:06:26Z"
    },
    {
      id: "thursday-meeting-preview",
      name: "Thursday Meeting Preview",
      description: "Strategic pre-read for Friday's session with narrative insight",
      schedule: "Thursday 4 PM",
      cron: "0 16 * * 4",
      cadence: "weekly-thu",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-03-19T16:04:12Z",
      nextRunAt: "2026-03-26T16:03:32Z"
    },
    {
      id: "friday-meeting-briefing",
      name: "Friday Meeting Briefing",
      description: "Process Fireflies transcript, deliver executive briefing via Slack & Gmail",
      schedule: "Friday 4:39 PM",
      cron: "30 16 * * 5",
      cadence: "weekly-fri",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-03-20T16:40:13Z",
      nextRunAt: "2026-03-27T16:39:14Z"
    },
    {
      id: "weekly-strategy-tracker-update",
      name: "Strategy Tracker Update",
      description: "Read latest session notes, update Action_Tracker.xlsx in Google Drive",
      schedule: "Friday 7 PM",
      cron: "0 19 * * 5",
      cadence: "weekly-fri",
      owner: "TARS",
      enabled: true,
      lastRunAt: "2026-03-20T19:03:43Z",
      nextRunAt: "2026-03-27T19:04:44Z"
    },
    {
      id: "weekly-memory-maintenance",
      name: "Memory Maintenance",
      description: "Consolidate working memory from Slack into reference files",
      schedule: "Sunday 8 PM",
      cron: "0 20 * * 0",
      cadence: "weekly-sun",
      owner: "Second Brain",
      enabled: true,
      lastRunAt: null,
      nextRunAt: "2026-03-29T19:06:11Z"
    },
    {
      id: "weekly-mem-update",
      name: "Mem Briefing Update",
      description: "Fetch new meetings from Fireflies, create/update Mem briefing notes",
      schedule: "Friday 8 PM",
      cron: "0 20 * * 5",
      cadence: "weekly-fri",
      owner: "Second Brain",
      enabled: true,
      lastRunAt: null,
      nextRunAt: "2026-03-27T20:09:01Z"
    },
    {
      id: "appstore-data-pull",
      name: "App Store Data Pull",
      description: "Weekly pull of Loyverse app store ratings and reviews",
      schedule: "Monday 9 AM",
      cron: "0 9 * * 1",
      cadence: "weekly-mon",
      owner: "CASE",
      enabled: true,
      lastRunAt: null,
      nextRunAt: "2026-03-30T08:00:58Z"
    },
    {
      id: "hiagent-monitor",
      name: "HIAgent Monitor",
      description: "Monitor all scheduled tasks, update dashboard data, alert on failures",
      schedule: "Every 2 hours",
      cron: "0 */2 * * *",
      cadence: "daily",
      owner: "HIAgent",
      enabled: true,
      lastRunAt: null,
      nextRunAt: "2026-03-26T19:00:00Z"
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
// Determines health status for each task based on cadence and lastRunAt
function hiagentCalcStatus(task) {
  if (!task.enabled) return { status: 'disabled', label: 'Disabled', color: '#888' };
  if (!task.lastRunAt) return { status: 'pending', label: 'Never run', color: '#C47B10' };

  var now = new Date();
  var lastRun = new Date(task.lastRunAt);
  var hoursSince = (now - lastRun) / (1000 * 60 * 60);

  // Grace period: expected interval + 2 hours buffer
  var maxHours;
  switch (task.cadence) {
    case 'daily':     maxHours = 26; break;    // 24h + 2h grace
    case 'weekday':   maxHours = 74; break;    // 72h max (Fri→Mon) + 2h grace
    case 'weekly-mon': maxHours = 170; break;  // 7 days + 2h
    case 'weekly-thu': maxHours = 170; break;
    case 'weekly-fri': maxHours = 170; break;
    case 'weekly-sun': maxHours = 170; break;
    default:          maxHours = 170; break;
  }

  // For weekly tasks, also check: has nextRunAt passed without a new lastRunAt?
  if (task.nextRunAt) {
    var nextRun = new Date(task.nextRunAt);
    var graceMs = 2 * 60 * 60 * 1000; // 2 hour grace after expected run
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

// ─── RENDER PANEL ───
function hiagentRender() {
  var container = document.getElementById('hiagent-tasks-grid');
  if (!container) return;

  // Summary counters
  var healthy = 0, failed = 0, pending = 0;
  HIAGENT_DATA.tasks.forEach(function(t) {
    var s = hiagentCalcStatus(t);
    if (s.status === 'healthy') healthy++;
    else if (s.status === 'failed') failed++;
    else pending++;
  });

  // Update summary
  var sumEl = document.getElementById('hiagent-summary');
  if (sumEl) {
    sumEl.innerHTML =
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#2DC46B">' + healthy + '</span><span class="ha-sum-label">Healthy</span></div>' +
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#CC3333">' + failed + '</span><span class="ha-sum-label">Failed</span></div>' +
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#C47B10">' + pending + '</span><span class="ha-sum-label">Pending</span></div>' +
      '<div class="ha-sum-item"><span class="ha-sum-num" style="color:#1D8FE1">' + HIAGENT_DATA.tasks.length + '</span><span class="ha-sum-label">Total</span></div>';
  }

  // Update sync time
  var syncEl = document.getElementById('hiagent-sync-time');
  if (syncEl) syncEl.textContent = 'Last sync: ' + hiagentTimeAgo(HIAGENT_DATA.lastSync);

  // Render task cards
  var ownerColors = { 'TARS': '#1D8FE1', 'CASE': '#2DC46B', 'Second Brain': '#7B3FA0', 'HIAgent': '#1D8FE1' };
  var html = '';
  HIAGENT_DATA.tasks.forEach(function(t) {
    var s = hiagentCalcStatus(t);
    var topColor = ownerColors[t.owner] || '#1D8FE1';
    html += '<div class="ha-card">' +
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
    HIAGENT_DATA.infrastructure.forEach(function(i) {
      infraHtml += '<div class="ha-infra-card">' +
        '<div class="ha-infra-body">' +
          '<div class="ha-card-header">' +
            '<div class="ha-status-dot" style="background:#2DC46B"></div>' +
            '<div class="ha-card-name">' + i.name + '</div>' +
          '</div>' +
          '<div class="ha-card-desc">' + i.type + ' · ' + i.repo + '</div>' +
          '<a href="' + i.url + '" target="_blank" class="ha-infra-link">' + i.url.replace('https://','') + ' →</a>' +
        '</div>' +
      '</div>';
    });
    infraEl.innerHTML = infraHtml;
  }

  // Render skills
  var skillsEl = document.getElementById('hiagent-skills-grid');
  if (skillsEl) {
    var skillsHtml = '';
    HIAGENT_DATA.skills.forEach(function(s) {
      skillsHtml += '<span class="ha-skill">' + s.name + '<span class="ha-skill-cat">' + s.category + '</span></span>';
    });
    skillsEl.innerHTML = skillsHtml;
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
  // Render when HIAgent panel is first shown
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
