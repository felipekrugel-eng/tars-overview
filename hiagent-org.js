// ═══════════════════════════════════════════════════════════
// HIAGENT ORG CHART — Client-side Supabase fetch & rendering
// ═══════════════════════════════════════════════════════════

const HIAGENT_ORG = {
  data: null,
  cache: null,
  currentView: 'orgchart', // 'orgchart' or 'health'
  expandedTeams: {}, // Track which department teams are expanded

  // Supabase API config
  supabaseUrl: 'https://pkxviyscqmilahedtnzz.supabase.co/rest/v1/people',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreHZpeXNjcW1pbGFoZWR0bnp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTE5MzEsImV4cCI6MjA5MDE4NzkzMX0.MyHLZoQwL_K74IyXw-KFHOhySa31ePHnTtayOn8v3Dw',

  // Fetch org data from Supabase
  async fetchData() {
    if (this.cache) return this.cache;

    try {
      const response = await fetch(this.supabaseUrl + '?select=*&order=name', {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': 'Bearer ' + this.supabaseKey
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch org data: ' + response.status);
      }

      this.cache = await response.json();
      this.data = this.cache;
      return this.data;
    } catch (error) {
      console.error('Supabase fetch error:', error);
      throw error;
    }
  },

  // Build tree structure from flat data
  buildTree(people) {
    const map = {};
    const tree = [];

    // Create map of all people by id
    people.forEach(p => {
      map[p.id] = {
        ...p,
        children: []
      };
    });

    // Build parent-child relationships
    people.forEach(p => {
      if (p.reports_to && map[p.reports_to]) {
        map[p.reports_to].children.push(map[p.id]);
      } else if (!p.reports_to) {
        // Root node (should be CEO Caio)
        tree.push(map[p.id]);
      }
    });

    return tree;
  },

  // Count direct reports (excluding placeholders)
  countDirectReports(person) {
    if (!person.children) return 0;
    return person.children.filter(c => c.type === 'human').length;
  },

  // Check if person has placeholder children
  hasPlaceholderChildren(person) {
    if (!person.children) return false;
    return person.children.some(c => c.name.match(/IC \d+|placeholder/i));
  },

  // Count placeholder children
  countPlaceholders(person) {
    if (!person.children) return 0;
    return person.children.filter(c => c.name.match(/IC \d+|placeholder/i)).length;
  },

  // Render org chart
  renderOrgChart(container) {
    if (!this.data || this.data.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Failed to load org data</div>';
      return;
    }

    const tree = this.buildTree(this.data);
    if (tree.length === 0) return;

    const root = tree[0]; // Caio (CEO)

    // Build summary stats
    const humans = this.data.filter(p => p.type === 'human');
    const agents = this.data.filter(p => p.type === 'agent');
    const departments = new Set(this.data.map(p => p.department).filter(d => d));

    let html = '<div class="ha-org-stats">';
    html += '<div class="ha-stat-item"><span class="ha-stat-num">' + humans.length + '</span><span class="ha-stat-label">Humans</span></div>';
    html += '<div class="ha-stat-item"><span class="ha-stat-num">' + agents.length + '</span><span class="ha-stat-label">AI Agents</span></div>';
    html += '<div class="ha-stat-item"><span class="ha-stat-num">' + departments.size + '</span><span class="ha-stat-label">Departments</span></div>';

    // Count employees vs contractors
    const employees = humans.filter(h => h.employment_type === 'employee').length;
    html += '<div class="ha-stat-item"><span class="ha-stat-num">' + employees + '/' + humans.length + '</span><span class="ha-stat-label">Employees</span></div>';
    html += '</div>';

    // Add view toggle
    html += '<div class="ha-view-toggle">';
    html += '<button class="ha-toggle-btn active" id="ha-tog-org" onclick="HIAGENT_ORG.switchView(\'orgchart\')">Org Chart</button>';
    html += '<button class="ha-toggle-btn" id="ha-tog-health" onclick="HIAGENT_ORG.switchView(\'health\')">Infrastructure Health</button>';
    html += '</div>';

    // Start org chart tree
    html += '<div class="ha-org-tree">';
    html += this.renderNode(root, 0);
    html += '</div>';

    container.innerHTML = html;
  },

  renderNode(person, depth) {
    const isAgent = person.type === 'agent';
    const isL2 = person.level === 'L2';
    const isDeptHead = person.level === 'L4' && person.children && person.children.length > 3;
    const hasDirectReports = person.children && person.children.length > 0;
    const isExpanded = this.expandedTeams[person.id] !== false; // Default expanded for L2, collapsed for dept heads

    // For dept heads, default to collapsed
    if (isDeptHead && !(person.id in this.expandedTeams)) {
      this.expandedTeams[person.id] = false;
    }

    let html = '<div class="ha-org-level" data-level="' + depth + '">';
    html += '<div class="ha-org-node">';

    // Card
    const cardClass = isAgent ? 'ha-person-card ha-agent-card' : 'ha-person-card ha-human-card';
    html += '<div class="' + cardClass + '" onclick="HIAGENT_ORG.showPersonDrill(\'' + person.id + '\')">';

    html += '<div class="ha-person-name">' + person.name + '</div>';
    html += '<div class="ha-person-title">' + (person.title || '') + '</div>';

    if (isAgent) {
      html += '<span class="ha-person-badge ha-ai-badge">AI</span>';
    } else {
      const empType = person.employment_type === 'employee' ? 'E' : 'C';
      const empClass = person.employment_type === 'employee' ? 'ha-emp-badge' : 'ha-contr-badge';
      html += '<span class="ha-person-badge ' + empClass + '">' + empType + '</span>';
    }

    // Show headcount for dept heads with large teams
    if (isDeptHead && hasDirectReports) {
      html += '<div class="ha-headcount">' + person.children.length + '</div>';
      html += '<button class="ha-expand-btn" onclick="event.stopPropagation(); HIAGENT_ORG.toggleTeam(\'' + person.id + '\')">';
      const expanded = this.expandedTeams[person.id];
      html += expanded ? '▼' : '▶';
      html += '</button>';
    }

    html += '</div>'; // End card

    // Render children: always show for L1/L2, only when expanded for dept heads
    const shouldShowChildren = hasDirectReports && (!isDeptHead || this.expandedTeams[person.id]);
    if (shouldShowChildren) {
      // Separate named people from placeholders
      const named = person.children.filter(c => !c.name.match(/IC \d+/i));
      const placeholders = person.children.filter(c => c.name.match(/IC \d+/i));

      html += '<div class="ha-children">';
      named.forEach(child => {
        html += this.renderNode(child, depth + 1);
      });
      if (placeholders.length > 0) {
        html += '<div class="ha-placeholder-count">+ ' + placeholders.length + ' more team members</div>';
      }
      html += '</div>';
    }

    html += '</div>'; // End node
    html += '</div>'; // End level

    return html;
  },

  toggleTeam(personId) {
    if (personId in this.expandedTeams) {
      this.expandedTeams[personId] = !this.expandedTeams[personId];
    } else {
      this.expandedTeams[personId] = true;
    }

    // Re-render
    const container = document.getElementById('hiagent-org-container');
    if (container) {
      this.renderOrgChart(container);
    }
  },

  showPersonDrill(personId) {
    const person = this.data.find(p => p.id === personId);
    if (!person) return;

    const overlay = document.getElementById('hiagent-drill-overlay');
    const panel = document.getElementById('hiagent-drill-panel');
    if (!overlay || !panel) return;

    let html = '<div class="ha-drill-header" style="border-left: 4px solid ' + (person.type === 'agent' ? '#1D8FE1' : '#666') + ';">';
    html += '<h2 class="ha-drill-title">' + person.name + '</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">';

    if (person.type === 'agent') {
      html += '<span class="ha-badge">AI Agent</span>';
    } else {
      html += '<span class="ha-badge">' + person.level + '</span>';
      if (person.employment_type) {
        html += '<span class="ha-badge">' + (person.employment_type === 'employee' ? 'Employee' : 'Contractor') + '</span>';
      }
    }

    if (person.status) {
      html += '<span class="ha-badge" style="color:#1D8FE1;border-color:#1D8FE1">' + person.status + '</span>';
    }

    html += '</div></div>';
    html += '<div class="ha-drill-body">';

    if (person.type === 'agent') {
      // Agent details
      html += '<div class="ha-drill-section">';
      html += '<div class="ha-drill-label">Role</div>';
      html += '<div class="ha-drill-text">' + (person.title || 'AI Agent') + '</div>';
      html += '</div>';

      if (person.profile && person.profile.purpose) {
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Purpose</div>';
        html += '<div class="ha-drill-text">' + person.profile.purpose + '</div>';
        html += '</div>';
      }

      if (person.profile && person.profile.capabilities) {
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Capabilities</div>';
        html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
        person.profile.capabilities.forEach(cap => {
          html += '<li>' + cap + '</li>';
        });
        html += '</ul>';
        html += '</div>';
      }

      if (person.profile && person.profile.tasks) {
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Scheduled Tasks</div>';
        html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
        person.profile.tasks.forEach(task => {
          html += '<li>' + task + '</li>';
        });
        html += '</ul>';
        html += '</div>';
      }
    } else {
      // Human details
      html += '<div class="ha-drill-section">';
      html += '<div class="ha-drill-label">Title</div>';
      html += '<div class="ha-drill-text">' + person.title + '</div>';
      html += '</div>';

      if (person.department) {
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Department</div>';
        html += '<div class="ha-drill-text">' + person.department + '</div>';
        html += '</div>';
      }

      if (person.reports_to) {
        const manager = this.data.find(p => p.id === person.reports_to);
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Reports To</div>';
        html += '<div class="ha-drill-text">' + (manager ? manager.name : person.reports_to) + '</div>';
        html += '</div>';
      }

      if (person.location) {
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Location</div>';
        html += '<div class="ha-drill-text">' + person.location + '</div>';
        html += '</div>';
      }

      if (person.start_date) {
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Start Date</div>';
        html += '<div class="ha-drill-text">' + person.start_date + '</div>';
        html += '</div>';
      }

      // Direct reports
      const directReports = this.data.filter(p => p.reports_to === person.id);
      if (directReports.length > 0) {
        html += '<div class="ha-drill-section">';
        html += '<div class="ha-drill-label">Direct Reports</div>';
        html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
        directReports.forEach(report => {
          html += '<li>' + report.name + ' (' + report.title + ')</li>';
        });
        html += '</ul>';
        html += '</div>';
      }

      // Profile data
      if (person.profile) {
        if (person.profile.responsibilities) {
          html += '<div class="ha-drill-section">';
          html += '<div class="ha-drill-label">Responsibilities</div>';
          html += '<div class="ha-drill-text">' + person.profile.responsibilities + '</div>';
          html += '</div>';
        }

        if (person.profile.domains) {
          html += '<div class="ha-drill-section">';
          html += '<div class="ha-drill-label">Domains</div>';
          html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
          person.profile.domains.forEach(domain => {
            html += '<li>' + domain + '</li>';
          });
          html += '</ul>';
          html += '</div>';
        }
      }
    }

    html += '</div>';

    panel.innerHTML = '<button class="ha-drill-close" onclick="hiagentCloseDrill()">&times;</button>' + html;
    overlay.classList.add('active');
  },

  switchView(view) {
    this.currentView = view;

    // Update toggle buttons
    const orgBtn = document.getElementById('ha-tog-org');
    const healthBtn = document.getElementById('ha-tog-health');
    if (orgBtn) orgBtn.classList.toggle('active', view === 'orgchart');
    if (healthBtn) healthBtn.classList.toggle('active', view === 'health');

    // Toggle visibility
    const orgContainer = document.getElementById('hiagent-org-container');
    const healthContainer = document.getElementById('hiagent-health-container');

    if (view === 'orgchart') {
      if (orgContainer) orgContainer.style.display = 'block';
      if (healthContainer) healthContainer.style.display = 'none';
    } else {
      if (orgContainer) orgContainer.style.display = 'none';
      if (healthContainer) healthContainer.style.display = 'block';
      // Ensure health dashboard is rendered
      if (typeof hiagentRender === 'function') hiagentRender();
    }
  },

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start());
    } else {
      this.start();
    }
  },

  async start() {
    const container = document.getElementById('hiagent-org-container');
    if (!container) return;

    try {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Loading org chart...</div>';
      await this.fetchData();
      this.renderOrgChart(container);
    } catch (error) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#CC3333;">Failed to load org chart from Supabase<br><small style="color:#666;margin-top:8px;">' + error.message + '</small></div>';
    }
  }
};

// Initialize when org chart panel is shown
document.addEventListener('DOMContentLoaded', function() {
  var origShow = window.showPanel;
  if (typeof origShow === 'function') {
    var _orgInit = false;
    window.showPanel = function(name) {
      origShow(name);
      if (name === 'hiagent' && !_orgInit) {
        _orgInit = true;
        HIAGENT_ORG.init();
      }
    };
  }
});
