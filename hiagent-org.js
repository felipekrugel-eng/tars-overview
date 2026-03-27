// ═══════════════════════════════════════════════════════════
// HIAGENT ORG CHART — True recursive tree with zoom/pan/filter
// ═══════════════════════════════════════════════════════════

const HIAGENT_ORG = {
  data: null,
  cache: null,
  expandedTeams: {},
  currentZoom: 1,
  filterType: 'all',  // 'all', 'human', 'agent'
  isPanning: false,
  panStart: { x: 0, y: 0 },
  panOffset: { x: 0, y: 0 },

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

  // Get filtered data based on current filter
  getFilteredData() {
    if (this.filterType === 'all') return this.data;
    return this.data.filter(p => {
      // Always keep people who are managers of visible people
      if (p.type === this.filterType) return true;
      // Keep managers in the chain even if they're the other type
      // so the tree doesn't break
      const hasFilteredChild = this.data.some(c => c.reports_to === p.id && c.type === this.filterType);
      if (hasFilteredChild) return true;
      // Keep ancestors of filtered people
      return this.isAncestorOfType(p.id, this.filterType);
    });
  },

  isAncestorOfType(personId, type) {
    const directChildren = this.data.filter(p => p.reports_to === personId);
    for (const child of directChildren) {
      if (child.type === type) return true;
      if (this.isAncestorOfType(child.id, type)) return true;
    }
    return false;
  },

  countDescendants(node) {
    let count = 0;
    if (!node.children) return 0;
    node.children.forEach(c => { count += 1 + this.countDescendants(c); });
    return count;
  },

  hasChildren(person) {
    return person.children && person.children.length > 0;
  },

  isExpanded(id) {
    return this.expandedTeams[id] === true;
  },

  // Find which node (if any) among siblings is expanded
  getExpandedSiblingId(siblings) {
    if (!siblings) return null;
    for (const s of siblings) {
      if (this.isExpanded(s.id)) return s.id;
    }
    return null;
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

  // ═══════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════

  renderOrgChart(container) {
    if (!this.data || this.data.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">No org data available</div>';
      return;
    }
    this.updateStats();

    const filteredData = this.getFilteredData();
    const tree = this.buildTree(filteredData);
    if (tree.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">No results for this filter</div>';
      return;
    }

    let html = '<div class="ha-org-tree">';
    html += this.renderNode(tree[0], null);
    html += '</div>';
    container.innerHTML = html;
  },

  // Recursive node renderer with sibling awareness for dimming
  renderNode(person, siblings) {
    const expanded = this.isExpanded(person.id);
    const hasKids = this.hasChildren(person);

    const namedChildren = hasKids ? person.children.filter(c => !c.name.match(/^(Engineering|CustOps|Accounting) IC \d+$/i)) : [];
    const placeholders = hasKids ? person.children.filter(c => c.name.match(/^(Engineering|CustOps|Accounting) IC \d+$/i)) : [];

    // Determine if this node should be dimmed
    // A node is dimmed if one of its siblings is expanded (and it's not the one)
    let dimClass = '';
    if (siblings) {
      const expandedSiblingId = this.getExpandedSiblingId(siblings);
      if (expandedSiblingId && expandedSiblingId !== person.id) {
        dimClass = ' ha-dimmed';
      }
    }

    let html = '<div class="ha-node' + dimClass + '" data-id="' + person.id + '">';

    html += this.renderCard(person);

    if (expanded && namedChildren.length > 0) {
      html += '<div class="ha-connector-v"></div>';

      if (namedChildren.length > 1 || placeholders.length > 0) {
        html += '<div class="ha-children-row">';
        namedChildren.forEach(child => {
          html += '<div class="ha-child-branch">';
          html += '<div class="ha-connector-v"></div>';
          // Pass siblings for dim logic
          html += this.renderNode(child, namedChildren);
          html += '</div>';
        });
        if (placeholders.length > 0) {
          html += '<div class="ha-child-branch">';
          html += '<div class="ha-connector-v"></div>';
          html += '<div class="ha-placeholder-count">+ ' + placeholders.length + ' more</div>';
          html += '</div>';
        }
        html += '</div>';
      } else {
        html += this.renderNode(namedChildren[0], null);
      }
    }

    html += '</div>';
    return html;
  },

  renderCard(person) {
    const isAgent = person.type === 'agent';
    const cardClass = isAgent ? 'ha-person-card ha-agent-card' : 'ha-person-card ha-human-card';
    const expanded = this.isExpanded(person.id);
    const hasKids = this.hasChildren(person);
    const totalDesc = hasKids ? this.countDescendants(person) : 0;

    // If filter is active and this person is not the target type, make card slightly transparent
    const isFilterTarget = (this.filterType === 'all') || (person.type === this.filterType);
    const filterStyle = isFilterTarget ? '' : ' style="opacity:0.55;"';

    let html = '<div class="' + cardClass + '"' + filterStyle + ' onclick="HIAGENT_ORG.showPersonDrill(\'' + person.id + '\')">';

    if (hasKids) {
      html += '<div class="ha-headcount">' + totalDesc + '</div>';
    }

    html += '<div class="ha-person-name">' + person.name + '</div>';
    html += '<div class="ha-person-title">' + (person.title || '') + '</div>';

    html += '<div class="ha-card-badges">';
    if (isAgent) {
      html += '<span class="ha-person-badge ha-ai-badge">AI</span>';
    } else if (person.employment_type) {
      const empType = person.employment_type === 'employee' ? 'E' : 'C';
      const empClass = person.employment_type === 'employee' ? 'ha-emp-badge' : 'ha-contr-badge';
      html += '<span class="ha-person-badge ' + empClass + '">' + empType + '</span>';
    }

    if (hasKids) {
      html += '<button class="ha-expand-btn" onclick="event.stopPropagation(); HIAGENT_ORG.toggleTeam(\'' + person.id + '\')">';
      html += expanded ? '&#x25BE; collapse' : '&#x25B8; ' + person.children.length + ' reports';
      html += '</button>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  },

  // ═══════════════════════════════════════
  // INTERACTIONS
  // ═══════════════════════════════════════

  toggleTeam(personId) {
    if (this.isExpanded(personId)) {
      this.collapseAll(personId);
    } else {
      this.expandedTeams[personId] = true;
    }
    const container = document.getElementById('hiagent-org-container');
    if (container) this.renderOrgChart(container);
  },

  collapseAll(personId) {
    this.expandedTeams[personId] = false;
    const tree = this.buildTree(this.getFilteredData());
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
      const collapse = (children) => {
        children.forEach(c => {
          this.expandedTeams[c.id] = false;
          if (c.children) collapse(c.children);
        });
      };
      collapse(node.children);
    }
  },

  // ═══════════════════════════════════════
  // FILTER
  // ═══════════════════════════════════════

  setFilter(type) {
    this.filterType = type;
    // Update button states
    ['all', 'human', 'agent'].forEach(t => {
      const btn = document.getElementById('ha-fil-' + (t === 'human' ? 'humans' : t === 'agent' ? 'agents' : t));
      if (btn) btn.classList.toggle('active', t === type);
    });
    const container = document.getElementById('hiagent-org-container');
    if (container) this.renderOrgChart(container);
  },

  // ═══════════════════════════════════════
  // ZOOM & PAN
  // ═══════════════════════════════════════

  applyTransform() {
    const container = document.getElementById('hiagent-org-container');
    if (!container) return;
    container.style.transform = 'scale(' + this.currentZoom + ') translate(' + this.panOffset.x + 'px, ' + this.panOffset.y + 'px)';
    const label = document.getElementById('ha-zoom-label');
    if (label) label.textContent = Math.round(this.currentZoom * 100) + '%';
  },

  zoomBy(delta) {
    this.currentZoom = Math.max(0.2, Math.min(2, this.currentZoom + delta));
    this.applyTransform();
  },

  zoomReset() {
    this.currentZoom = 1;
    this.panOffset = { x: 0, y: 0 };
    this.applyTransform();
  },

  zoomFit() {
    const viewport = document.getElementById('hiagent-org-viewport');
    const container = document.getElementById('hiagent-org-container');
    if (!viewport || !container) return;

    // Temporarily reset to measure real size
    container.style.transform = 'scale(1) translate(0px, 0px)';
    const tree = container.querySelector('.ha-org-tree');
    if (!tree) return;

    const treeRect = tree.getBoundingClientRect();
    const vpRect = viewport.getBoundingClientRect();

    const scaleX = (vpRect.width - 48) / treeRect.width;
    const scaleY = (vpRect.height - 48) / treeRect.height;
    this.currentZoom = Math.max(0.15, Math.min(1, Math.min(scaleX, scaleY)));
    this.panOffset = { x: 0, y: 0 };
    this.applyTransform();
  },

  initPan() {
    const viewport = document.getElementById('hiagent-org-viewport');
    if (!viewport || viewport._panInit) return;
    viewport._panInit = true;

    viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ha-person-card') || e.target.closest('.ha-expand-btn')) return;
      this.isPanning = true;
      this.panStart = { x: e.clientX - this.panOffset.x * this.currentZoom, y: e.clientY - this.panOffset.y * this.currentZoom };
      viewport.style.cursor = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning) return;
      this.panOffset.x = (e.clientX - this.panStart.x) / this.currentZoom;
      this.panOffset.y = (e.clientY - this.panStart.y) / this.currentZoom;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        viewport.style.cursor = 'grab';
      }
    });

    // Mouse wheel zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      this.zoomBy(delta);
    }, { passive: false });
  },

  // ═══════════════════════════════════════
  // DRILL-DOWN PANEL
  // ═══════════════════════════════════════

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
    html += this.drillRow('Title', person.title);
    html += this.drillRow('Department', person.department);

    if (person.reports_to) {
      const mgr = this.data.find(p => p.id === person.reports_to);
      html += this.drillRow('Reports To', mgr ? mgr.name : person.reports_to);
    }

    html += this.drillRow('Location', person.location);
    html += this.drillRow('Start Date', person.start_date);

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

  // ═══════════════════════════════════════
  // VIEW TOGGLE
  // ═══════════════════════════════════════

  switchView(view) {
    const orgViewport = document.getElementById('hiagent-org-viewport');
    const orgToolbar = document.getElementById('hiagent-org-toolbar');
    const healthContainer = document.getElementById('hiagent-health-container');
    const orgBtn = document.getElementById('ha-tog-org');
    const healthBtn = document.getElementById('ha-tog-health');

    if (view === 'orgchart') {
      if (orgViewport) orgViewport.style.display = 'block';
      if (orgToolbar) orgToolbar.style.display = 'flex';
      if (healthContainer) healthContainer.style.display = 'none';
      if (orgBtn) orgBtn.classList.add('active');
      if (healthBtn) healthBtn.classList.remove('active');
    } else {
      if (orgViewport) orgViewport.style.display = 'none';
      if (orgToolbar) orgToolbar.style.display = 'none';
      if (healthContainer) healthContainer.style.display = 'block';
      if (orgBtn) orgBtn.classList.remove('active');
      if (healthBtn) healthBtn.classList.add('active');
      if (typeof hiagentRender === 'function') hiagentRender();
    }
  },

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════

  async start() {
    const container = document.getElementById('hiagent-org-container');
    if (!container) return;
    try {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Loading org chart...</div>';
      await this.fetchData();

      const root = this.data.find(p => !p.reports_to);
      if (root) {
        this.expandedTeams[root.id] = true;
      }

      this.renderOrgChart(container);
      this.initPan();
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
