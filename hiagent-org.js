// ═══════════════════════════════════════════════════════════
// HIAGENT ORG CHART — Client-side Supabase fetch & rendering
// ═══════════════════════════════════════════════════════════

const HIAGENT_ORG = {
  data: null,
  cache: null,
  // Default: only L1 expanded. Everything else starts collapsed.
  expandedTeams: {},

  supabaseUrl: 'https://pkxviyscqmilahedtnzz.supabase.co/rest/v1/people',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreHZpeXNjcW1pbGFoZWR0bnp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTE5MzEsImV4cCI6MjA5MDE4NzkzMX0.MyHLZoQwL_K74IyXw-KFHOhySa31ePHnTtayOn8v3Dw',

  async fetchData() {
    if (this.cache) return this.cache;
    try {
      const r = await fetch(this.supabaseUrl + '?select=*&order=name', {
        headers: { 'apikey': this.supabaseKey, 'Authorization': 'Bearer ' + this.supabaseKey }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.cache = await r.json();
      this.data = this.cache;
      return this.data;
    } catch (e) {
      console.error('Supabase fetch error:', e);
      throw e;
    }
  },

  buildTree(people) {
    const map = {};
    const tree = [];
    people.forEach(p => { map[p.id] = { ...p, children: [] }; });
    people.forEach(p => {
      if (p.reports_to && map[p.reports_to]) {
        map[p.reports_to].children.push(map[p.id]);
      } else if (!p.reports_to) {
        tree.push(map[p.id]);
      }
    });
    // Sort children: humans first (by name), then agents (by name)
    const sortChildren = (node) => {
      node.children.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'human' ? -1 : 1;
      });
      node.children.forEach(sortChildren);
    };
    tree.forEach(sortChildren);
    return tree;
  },

  // Count total descendants (not just direct children)
  countDescendants(node) {
    let count = 0;
    if (!node.children) return 0;
    node.children.forEach(c => {
      count += 1 + this.countDescendants(c);
    });
    return count;
  },

  hasChildren(person) {
    return person.children && person.children.length > 0;
  },

  isExpanded(id) {
    return this.expandedTeams[id] === true;
  },

  updateStats() {
    if (!this.data) return;
    const humans = this.data.filter(p => p.type === 'human');
    const agents = this.data.filter(p => p.type === 'agent');
    const depts = new Set(this.data.map(p => p.department).filter(Boolean));
    const employees = humans.filter(h => h.employment_type === 'employee').length;

    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s('ha-stat-humans', humans.length);
    s('ha-stat-agents', agents.length);
    s('ha-stat-depts', depts.size);
    s('ha-stat-emp', employees + '/' + humans.length);
  },

  renderOrgChart(container) {
    if (!this.data || this.data.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">No org data available</div>';
      return;
    }

    this.updateStats();

    const tree = this.buildTree(this.data);
    if (tree.length === 0) return;
    const root = tree[0];

    let html = '<div class="ha-org-tree">';

    // ── L1: CEO card centered ──
    html += '<div class="ha-tree-row ha-tree-ceo">';
    html += this.renderCard(root);
    html += '</div>';

    // ── L2: Direct reports in a row (only if L1 is expanded) ──
    if (this.isExpanded(root.id) && root.children.length > 0) {
      html += '<div class="ha-connector-v"></div>';
      html += '<div class="ha-tree-row ha-tree-l2">';

      root.children.forEach(l2 => {
        html += '<div class="ha-tree-branch">';
        html += this.renderCard(l2);

        // ── Children under L2 (only if L2 is expanded) ──
        if (this.isExpanded(l2.id) && l2.children.length > 0) {
          html += this.renderChildrenContainer(l2.children);
        }

        html += '</div>'; // end branch
      });

      html += '</div>'; // end l2 row
    }

    html += '</div>';
    container.innerHTML = html;
  },

  // Recursively render a children container
  renderChildrenContainer(children) {
    const named = children.filter(c => !c.name.match(/^(Engineering|CustOps|Accounting) IC \d+$/i));
    const placeholders = children.filter(c => c.name.match(/^(Engineering|CustOps|Accounting) IC \d+$/i));

    let html = '<div class="ha-branch-children">';

    named.forEach(child => {
      html += '<div class="ha-tree-leaf">';
      html += this.renderCard(child);

      // If this child has children and is expanded, render them recursively
      if (this.isExpanded(child.id) && child.children && child.children.length > 0) {
        const subNamed = child.children.filter(c => !c.name.match(/IC \d+$/i));
        const subPlaceholders = child.children.filter(c => c.name.match(/IC \d+$/i));

        html += '<div class="ha-sub-team">';
        subNamed.forEach(sub => {
          html += '<div class="ha-sub-leaf">';
          html += this.renderCard(sub);
          // Deep recursion: if this sub has children and is expanded
          if (this.isExpanded(sub.id) && sub.children && sub.children.length > 0) {
            html += this.renderChildrenContainer(sub.children);
          }
          html += '</div>';
        });
        if (subPlaceholders.length > 0) {
          html += '<div class="ha-placeholder-count">+ ' + subPlaceholders.length + ' more team members</div>';
        }
        html += '</div>';
      }

      html += '</div>'; // end leaf
    });

    if (placeholders.length > 0) {
      html += '<div class="ha-placeholder-count">+ ' + placeholders.length + ' more team members</div>';
    }

    html += '</div>'; // end branch-children
    return html;
  },

  renderCard(person) {
    const isAgent = person.type === 'agent';
    const cardClass = isAgent ? 'ha-person-card ha-agent-card' : 'ha-person-card ha-human-card';
    const expanded = this.isExpanded(person.id);
    const hasKids = this.hasChildren(person);
    const totalDesc = hasKids ? this.countDescendants(person) : 0;

    let html = '<div class="' + cardClass + '" onclick="HIAGENT_ORG.showPersonDrill(\'' + person.id + '\')">';

    // Headcount badge (top-right) — show total descendants
    if (hasKids) {
      html += '<div class="ha-headcount">' + totalDesc + '</div>';
    }

    html += '<div class="ha-person-name">' + person.name + '</div>';
    html += '<div class="ha-person-title">' + (person.title || '') + '</div>';

    // Badge row
    html += '<div class="ha-card-badges">';
    if (isAgent) {
      html += '<span class="ha-person-badge ha-ai-badge">AI</span>';
    } else if (person.employment_type) {
      const empType = person.employment_type === 'employee' ? 'E' : 'C';
      const empClass = person.employment_type === 'employee' ? 'ha-emp-badge' : 'ha-contr-badge';
      html += '<span class="ha-person-badge ' + empClass + '">' + empType + '</span>';
    }

    // Expand/collapse button for anyone with children
    if (hasKids) {
      html += '<button class="ha-expand-btn" onclick="event.stopPropagation(); HIAGENT_ORG.toggleTeam(\'' + person.id + '\')">';
      html += expanded ? '▾ collapse' : '▸ ' + person.children.length + ' reports';
      html += '</button>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  },

  toggleTeam(personId) {
    const wasExpanded = this.isExpanded(personId);
    if (wasExpanded) {
      // Collapse: also collapse all descendants
      this.collapseAll(personId);
    } else {
      this.expandedTeams[personId] = true;
    }
    const container = document.getElementById('hiagent-org-container');
    if (container) this.renderOrgChart(container);
  },

  // Recursively collapse a node and all its descendants
  collapseAll(personId) {
    this.expandedTeams[personId] = false;
    // Find the person in data and collapse children too
    const tree = this.buildTree(this.data);
    const findNode = (nodes, id) => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children || [], id);
        if (found) return found;
      }
      return null;
    };
    const node = findNode(tree, personId);
    if (node && node.children) {
      const collapseChildren = (children) => {
        children.forEach(c => {
          this.expandedTeams[c.id] = false;
          if (c.children) collapseChildren(c.children);
        });
      };
      collapseChildren(node.children);
    }
  },

  showPersonDrill(personId) {
    const person = this.data.find(p => p.id === personId);
    if (!person) return;

    const overlay = document.getElementById('hiagent-drill-overlay');
    const panel = document.getElementById('hiagent-drill-panel');
    if (!overlay || !panel) return;

    const borderColor = person.type === 'agent' ? '#1D8FE1' : '#2DC46B';
    let html = '<div class="ha-drill-header" style="padding-left:16px;border-left:4px solid ' + borderColor + ';">';
    html += '<h2 class="ha-drill-title">' + person.name + '</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">';

    if (person.type === 'agent') {
      html += '<span class="ha-badge" style="background:#1D8FE1;color:#fff;border:none">AI Agent</span>';
    } else {
      if (person.level) html += '<span class="ha-badge">' + person.level + '</span>';
      if (person.employment_type) {
        html += '<span class="ha-badge">' + (person.employment_type === 'employee' ? 'Employee' : 'Contractor') + '</span>';
      }
    }
    if (person.status) {
      const statusColor = person.status === 'active' ? '#2DC46B' : person.status === 'departing' ? '#E8A838' : '#888';
      html += '<span class="ha-badge" style="color:' + statusColor + ';border-color:' + statusColor + '">' + person.status + '</span>';
    }
    html += '</div></div>';

    html += '<div class="ha-drill-body">';

    // Title & department
    html += this.drillRow('Title', person.title);
    html += this.drillRow('Department', person.department);

    // Reports to
    if (person.reports_to) {
      const mgr = this.data.find(p => p.id === person.reports_to);
      html += this.drillRow('Reports To', mgr ? mgr.name : person.reports_to);
    }

    html += this.drillRow('Location', person.location);
    html += this.drillRow('Start Date', person.start_date);

    // Direct reports
    const reports = this.data.filter(p => p.reports_to === person.id);
    if (reports.length > 0) {
      const named = reports.filter(r => !r.name.match(/IC \d+$/i));
      const placeholders = reports.filter(r => r.name.match(/IC \d+$/i));
      html += '<div class="ha-drill-section"><div class="ha-drill-label">Direct Reports (' + reports.length + ')</div>';
      html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
      named.forEach(r => {
        const icon = r.type === 'agent' ? '🤖 ' : '';
        html += '<li>' + icon + r.name + ' — ' + (r.title || '') + '</li>';
      });
      if (placeholders.length > 0) {
        html += '<li style="color:#666">+ ' + placeholders.length + ' more team members</li>';
      }
      html += '</ul></div>';
    }

    // Agent-specific fields
    if (person.type === 'agent' && person.profile) {
      html += this.drillRow('Purpose', person.profile.purpose);
      if (person.profile.capabilities) {
        html += '<div class="ha-drill-section"><div class="ha-drill-label">Capabilities</div>';
        html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
        person.profile.capabilities.forEach(c => { html += '<li>' + c + '</li>'; });
        html += '</ul></div>';
      }
      if (person.profile.tasks) {
        html += '<div class="ha-drill-section"><div class="ha-drill-label">Scheduled Tasks</div>';
        html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
        person.profile.tasks.forEach(t => { html += '<li style="font-family:monospace">' + t + '</li>'; });
        html += '</ul></div>';
      }
      html += this.drillRow('Infrastructure', person.profile.infrastructure);
      html += this.drillRow('Deployed', person.profile.deployed);
    }

    // Human-specific profile fields
    if (person.type === 'human' && person.profile) {
      html += this.drillRow('Responsibilities', person.profile.responsibilities);
      if (person.profile.domains) {
        html += '<div class="ha-drill-section"><div class="ha-drill-label">Domains</div>';
        html += '<ul style="color:#ccc;margin:0;padding-left:16px;">';
        person.profile.domains.forEach(d => { html += '<li>' + d + '</li>'; });
        html += '</ul></div>';
      }
      if (person.profile.team_size) {
        html += this.drillRow('Team Size', person.profile.team_size);
      }
    }

    html += '</div>';

    panel.innerHTML = '<button class="ha-drill-close" onclick="hiagentCloseDrill()">&times;</button>' + html;
    overlay.classList.add('active');
  },

  drillRow(label, value) {
    if (!value) return '';
    return '<div class="ha-drill-section"><div class="ha-drill-label">' + label + '</div><div class="ha-drill-text">' + value + '</div></div>';
  },

  switchView(view) {
    const orgContainer = document.getElementById('hiagent-org-container');
    const healthContainer = document.getElementById('hiagent-health-container');
    const orgBtn = document.getElementById('ha-tog-org');
    const healthBtn = document.getElementById('ha-tog-health');

    if (view === 'orgchart') {
      if (orgContainer) orgContainer.style.display = 'block';
      if (healthContainer) healthContainer.style.display = 'none';
      if (orgBtn) orgBtn.classList.add('active');
      if (healthBtn) healthBtn.classList.remove('active');
    } else {
      if (orgContainer) orgContainer.style.display = 'none';
      if (healthContainer) healthContainer.style.display = 'block';
      if (orgBtn) orgBtn.classList.remove('active');
      if (healthBtn) healthBtn.classList.add('active');
      if (typeof hiagentRender === 'function') hiagentRender();
    }
  },

  async start() {
    const container = document.getElementById('hiagent-org-container');
    if (!container) return;
    try {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Loading org chart...</div>';
      await this.fetchData();

      // Set default expanded state: only L1 (CEO) is expanded
      const root = this.data.find(p => !p.reports_to);
      if (root) {
        this.expandedTeams[root.id] = true;
      }

      this.renderOrgChart(container);
    } catch (error) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#CC3333;">Failed to load org data<br><small style="color:#666">' + error.message + '</small></div>';
    }
  }
};

// Initialize on first HIAgent panel show
document.addEventListener('DOMContentLoaded', function() {
  var origShow = window.showPanel;
  if (typeof origShow === 'function') {
    var _orgInit = false;
    window.showPanel = function(name) {
      origShow(name);
      if (name === 'hiagent' && !_orgInit) {
        _orgInit = true;
        HIAGENT_ORG.start();
      }
    };
  }
});
