const App = {
  currentPage: 'overview',
  selectedRouterId: null,
  _overviewInterval: null,
  portalCurrentFile: 'login.html',
  portalDirty: false,
  _portalPreviewTimer: null,

  init() {
    if (api.getToken()) {
      this.showDashboard();
    } else {
      this.showLogin();
    }
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
      this.logout();
    });

    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        this.navigate(item.dataset.page);
      });
    });

    document.getElementById('modal-close').addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
  },

  showLogin() {
    document.getElementById('login-screen').classList.add('active');
    document.getElementById('dashboard-screen').classList.remove('active');
  },

  showDashboard() {
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.add('active');
    this.navigate('overview');
  },

  async handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');

    try {
      errorEl.classList.remove('visible');
      await api.login(username, password);
      this.showDashboard();
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
      errorEl.classList.add('visible');
    }
  },

  logout() {
    api.setToken(null);
    this.showLogin();
  },

  navigate(page) {
    if (this._overviewInterval) {
      clearInterval(this._overviewInterval);
      this._overviewInterval = null;
    }
    this.currentPage = page;
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    const titles = {
      overview: 'Overview',
      routers: 'Routers',
      hotspot: 'Hotspot Users',
      vouchers: 'Vouchers',
      monitoring: 'Monitoring',
      portal: 'Portal',
    };

    document.getElementById('page-title').textContent = titles[page] || page;
    this.renderPage(page);
  },

  async renderPage(page) {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';

    try {
      switch (page) {
        case 'overview': await this.renderOverview(); break;
        case 'routers': await this.renderRouters(); break;
        case 'hotspot': await this.renderHotspot(); break;
        case 'vouchers': await this.renderVouchers(); break;
        case 'monitoring': await this.renderMonitoring(); break;
        case 'portal': await this.renderPortal(); break;
      }
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async renderOverview() {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="empty-state"><p>Loading dashboard...</p></div>';

    try {
      const [serverInfo, summary] = await Promise.all([
        api.getSystemInfo(),
        api.getMonitoringSummary(),
      ]);

      const connectedRouters = summary.routers.filter((r) => r.connected && r.systemInfo);
      const primaryRouter = connectedRouters[0] || null;

      const memPct = serverInfo.memoryPercent;
      const diskPct = serverInfo.diskPercent;
      const cpuPct = serverInfo.cpuLoad;
      const memClass = memPct > 80 ? 'fill-high' : memPct > 50 ? 'fill-medium' : 'fill-low';
      const diskClass = diskPct > 80 ? 'fill-high' : diskPct > 50 ? 'fill-medium' : 'fill-low';
      const cpuClass = cpuPct > 80 ? 'fill-high' : cpuPct > 50 ? 'fill-medium' : 'fill-low';

      const formatUptime = (secs) => {
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        return `${h}h ${m}m`;
      };

      const formatBytes = (bytes) => {
        if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
        if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
        return (bytes / 1e3).toFixed(1) + ' KB';
      };

      const routerMemPct = primaryRouter ? Math.round((primaryRouter.systemInfo.memoryUsed / primaryRouter.systemInfo.memoryTotal) * 100) : 0;
      const routerMemClass = routerMemPct > 80 ? 'fill-high' : routerMemPct > 50 ? 'fill-medium' : 'fill-low';
      const routerCpuClass = primaryRouter && primaryRouter.systemInfo.cpuLoad > 80 ? 'fill-high' : primaryRouter && primaryRouter.systemInfo.cpuLoad > 50 ? 'fill-medium' : 'fill-low';

      content.innerHTML = `
        <div class="overview-grid">
          <div class="dash-card">
            <div class="dash-card-title">Server Health</div>
            <div class="dash-metrics">
              <div class="dash-metric">
                <div class="dash-metric-header">
                  <span class="dash-metric-label">CPU Usage</span>
                  <span class="dash-metric-value">${cpuPct}%</span>
                </div>
                <div class="progress-bar"><div class="fill ${cpuClass} anim-bar" data-target="${cpuPct}" style="width:0%"></div></div>
              </div>
              <div class="dash-metric">
                <div class="dash-metric-header">
                  <span class="dash-metric-label">RAM Usage</span>
                  <span class="dash-metric-value">${memPct}% (${formatBytes(serverInfo.memoryUsed)} / ${formatBytes(serverInfo.memoryTotal)})</span>
                </div>
                <div class="progress-bar"><div class="fill ${memClass} anim-bar" data-target="${memPct}" style="width:0%"></div></div>
              </div>
              <div class="dash-metric">
                <div class="dash-metric-header">
                  <span class="dash-metric-label">Disk Usage</span>
                  <span class="dash-metric-value">${diskPct}% (${formatBytes(serverInfo.diskUsed)} / ${formatBytes(serverInfo.diskTotal)})</span>
                </div>
                <div class="progress-bar"><div class="fill ${diskClass} anim-bar" data-target="${diskPct}" style="width:0%"></div></div>
              </div>
            </div>
            <div class="dash-info-grid">
              <div class="dash-info-row"><span class="dash-info-label">Hostname</span><span class="dash-info-value">${this.escapeHtml(serverInfo.hostname)}</span></div>
              <div class="dash-info-row"><span class="dash-info-label">OS</span><span class="dash-info-value">${this.escapeHtml(serverInfo.platform)}</span></div>
              <div class="dash-info-row"><span class="dash-info-label">CPU</span><span class="dash-info-value">${this.escapeHtml(serverInfo.cpuModel)} (${serverInfo.cpuCores} cores)</span></div>
              <div class="dash-info-row"><span class="dash-info-label">Node.js</span><span class="dash-info-value">${serverInfo.nodeVersion}</span></div>
              <div class="dash-info-row"><span class="dash-info-label">Uptime</span><span class="dash-info-value">${formatUptime(serverInfo.uptime)}</span></div>
              <div class="dash-info-row"><span class="dash-info-label">LAN IP</span><span class="dash-info-value">${serverInfo.lanIp || 'N/A'}</span></div>
            </div>
          </div>

          <div class="dash-card">
            <div class="dash-card-title">Router Status${primaryRouter ? `: ${this.escapeHtml(primaryRouter.name)}` : ''}</div>
            ${primaryRouter ? `
              <div class="dash-router-header">
                <div class="dash-router-badge online">Online</div>
                <span class="dash-router-host">${this.escapeHtml(primaryRouter.host)}</span>
              </div>
              <div class="dash-metrics">
                <div class="dash-metric">
                  <div class="dash-metric-header">
                    <span class="dash-metric-label">CPU Load</span>
                    <span class="dash-metric-value">${primaryRouter.systemInfo.cpuLoad}%</span>
                  </div>
                  <div class="progress-bar"><div class="fill ${routerCpuClass} anim-bar" data-target="${primaryRouter.systemInfo.cpuLoad}" style="width:0%"></div></div>
                </div>
                <div class="dash-metric">
                  <div class="dash-metric-header">
                    <span class="dash-metric-label">Memory</span>
                    <span class="dash-metric-value">${routerMemPct}% (${formatBytes(primaryRouter.systemInfo.memoryUsed)} / ${formatBytes(primaryRouter.systemInfo.memoryTotal)})</span>
                  </div>
                  <div class="progress-bar"><div class="fill ${routerMemClass} anim-bar" data-target="${routerMemPct}" style="width:0%"></div></div>
                </div>
              </div>
              <div class="dash-info-grid">
                <div class="dash-info-row"><span class="dash-info-label">Board</span><span class="dash-info-value">${this.escapeHtml(primaryRouter.systemInfo.boardName)}</span></div>
                <div class="dash-info-row"><span class="dash-info-label">Identity</span><span class="dash-info-value">${this.escapeHtml(primaryRouter.systemInfo.identity)}</span></div>
                <div class="dash-info-row"><span class="dash-info-label">Version</span><span class="dash-info-value">${this.escapeHtml(primaryRouter.systemInfo.version)}</span></div>
                <div class="dash-info-row"><span class="dash-info-label">Uptime</span><span class="dash-info-value">${formatUptime(primaryRouter.systemInfo.uptime)}</span></div>
              </div>
            ` : `
              <div class="empty-state" style="padding:2rem">
                <h3>No connected routers</h3>
                <p>Connect a router to see its status here.</p>
              </div>
            `}
          </div>
        </div>

        <div class="dash-card" style="margin-top:1.5rem">
          <div class="dash-card-title">Network Overview</div>
          <div class="stats-grid" style="margin-bottom:0">
            <div class="stat-card">
              <div class="stat-label">Total Routers</div>
              <div class="stat-value">${summary.totalRouters}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Connected</div>
              <div class="stat-value" style="color:var(--success)">${summary.connectedRouters}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Offline</div>
              <div class="stat-value" style="color:var(--danger)">${summary.totalRouters - summary.connectedRouters}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Server Uptime</div>
              <div class="stat-value" style="font-size:1.25rem">${formatUptime(serverInfo.uptime)}</div>
            </div>
          </div>
        </div>

        ${connectedRouters.length > 0 ? `
          <div class="dash-card">
            <div class="dash-card-title">Connected Routers</div>
            <div class="router-grid">
              ${connectedRouters.map((r) => {
                const memP = Math.round((r.systemInfo.memoryUsed / r.systemInfo.memoryTotal) * 100);
                return `
                  <div class="router-card online">
                    <div class="router-name">${this.escapeHtml(r.name)}</div>
                    <div class="router-host">${this.escapeHtml(r.systemInfo.identity || r.host)} &middot; v${r.systemInfo.version}</div>
                    <div style="margin-top:0.75rem">
                      <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:0.25rem">
                        <span>CPU</span><span>${r.systemInfo.cpuLoad}%</span>
                      </div>
                      <div class="progress-bar"><div class="fill ${r.systemInfo.cpuLoad > 80 ? 'fill-high' : r.systemInfo.cpuLoad > 50 ? 'fill-medium' : 'fill-low'} anim-bar" data-target="${r.systemInfo.cpuLoad}" style="width:0%"></div></div>
                    </div>
                    <div style="margin-top:0.75rem">
                      <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:0.25rem">
                        <span>Memory</span><span>${memP}%</span>
                      </div>
                      <div class="progress-bar"><div class="fill ${memP > 80 ? 'fill-high' : memP > 50 ? 'fill-medium' : 'fill-low'} anim-bar" data-target="${memP}" style="width:0%"></div></div>
                    </div>
                    <div class="router-stats" style="margin-top:0.75rem">
                      <span>Uptime: ${formatUptime(r.systemInfo.uptime)}</span>
                      <span>${this.escapeHtml(r.systemInfo.boardName)}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      `;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          content.querySelectorAll('.anim-bar').forEach((bar) => {
            bar.style.width = bar.dataset.target + '%';
          });
        });
      });

      this._overviewInterval = setInterval(() => this.updateOverview(), 2000);
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async updateOverview() {
    if (this.currentPage !== 'overview') return;
    const content = document.getElementById('page-content');
    if (!content.querySelector('.overview-grid')) return;

    try {
      const [serverInfo, summary] = await Promise.all([
        api.getSystemInfo(),
        api.getMonitoringSummary(),
      ]);

      const cpuPct = serverInfo.cpuLoad;
      const memPct = serverInfo.memoryPercent;
      const diskPct = serverInfo.diskPercent;

      const formatBytes = (bytes) => {
        if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
        if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
        return (bytes / 1e3).toFixed(1) + ' KB';
      };

      const formatUptime = (secs) => {
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        return `${h}h ${m}m`;
      };

      const barUpdate = (idx, pct) => {
        const bars = content.querySelectorAll('.overview-grid .dash-card:first-child .anim-bar');
        if (bars[idx]) {
          bars[idx].style.transition = 'width 0.5s ease-out';
          bars[idx].style.width = pct + '%';
          bars[idx].className = bars[idx].className.replace(/fill-\w+/, pct > 80 ? 'fill-high' : pct > 50 ? 'fill-medium' : 'fill-low');
        }
      };
      barUpdate(0, cpuPct);
      barUpdate(1, memPct);
      barUpdate(2, diskPct);

      const metricValues = content.querySelectorAll('.overview-grid .dash-card:first-child .dash-metric-value');
      if (metricValues[0]) metricValues[0].textContent = cpuPct + '%';
      if (metricValues[1]) metricValues[1].textContent = `${memPct}% (${formatBytes(serverInfo.memoryUsed)} / ${formatBytes(serverInfo.memoryTotal)})`;
      if (metricValues[2]) metricValues[2].textContent = `${diskPct}% (${formatBytes(serverInfo.diskUsed)} / ${formatBytes(serverInfo.diskTotal)})`;

      const infoValues = content.querySelectorAll('.overview-grid .dash-card:first-child .dash-info-value');
      if (infoValues[4]) infoValues[4].textContent = formatUptime(serverInfo.uptime);

      const connectedRouters = summary.routers.filter((r) => r.connected && r.systemInfo);
      const primaryRouter = connectedRouters[0] || null;

      if (primaryRouter) {
        const routerBars = content.querySelectorAll('.overview-grid .dash-card:nth-child(2) .anim-bar');
        const rCpu = primaryRouter.systemInfo.cpuLoad;
        const rMem = Math.round((primaryRouter.systemInfo.memoryUsed / primaryRouter.systemInfo.memoryTotal) * 100);
        if (routerBars[0]) {
          routerBars[0].style.transition = 'width 0.5s ease-out';
          routerBars[0].style.width = rCpu + '%';
          routerBars[0].className = routerBars[0].className.replace(/fill-\w+/, rCpu > 80 ? 'fill-high' : rCpu > 50 ? 'fill-medium' : 'fill-low');
        }
        if (routerBars[1]) {
          routerBars[1].style.transition = 'width 0.5s ease-out';
          routerBars[1].style.width = rMem + '%';
          routerBars[1].className = routerBars[1].className.replace(/fill-\w+/, rMem > 80 ? 'fill-high' : rMem > 50 ? 'fill-medium' : 'fill-low');
        }

        const routerMetricValues = content.querySelectorAll('.overview-grid .dash-card:nth-child(2) .dash-metric-value');
        if (routerMetricValues[0]) routerMetricValues[0].textContent = rCpu + '%';
        if (routerMetricValues[1]) routerMetricValues[1].textContent = `${rMem}% (${formatBytes(primaryRouter.systemInfo.memoryUsed)} / ${formatBytes(primaryRouter.systemInfo.memoryTotal)})`;

        const routerInfoValues = content.querySelectorAll('.overview-grid .dash-card:nth-child(2) .dash-info-value');
        if (routerInfoValues[3]) routerInfoValues[3].textContent = formatUptime(primaryRouter.systemInfo.uptime);
      }

      const statValues = content.querySelectorAll('.stat-value');
      if (statValues[0]) statValues[0].textContent = summary.totalRouters;
      if (statValues[1]) statValues[1].textContent = summary.connectedRouters;
      if (statValues[2]) statValues[2].textContent = summary.totalRouters - summary.connectedRouters;
      if (statValues[3]) statValues[3].textContent = formatUptime(serverInfo.uptime);
    } catch (err) {
      // silently ignore poll errors
    }
  },

  async renderRouters() {
    const content = document.getElementById('page-content');
    const routers = await api.getRouters();

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Manage Routers</h3>
          <button class="btn btn-primary btn-sm" onclick="App.showAddRouterModal()">Add Router</button>
        </div>
        <div class="table-wrapper">
          ${routers.length === 0
            ? '<div class="empty-state"><h3>No routers added</h3><p>Click "Add Router" to connect your first MikroTik device.</p></div>'
            : `<table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Host</th>
                  <th>Port</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${routers.map((r) => `
                  <tr>
                    <td>
                      <strong>${this.escapeHtml(r.name)}</strong>
                      ${r.use_rest_api ? '<span class="status-badge" style="background:#6366f1;color:#fff;font-size:0.625rem;padding:0.125rem 0.375rem;margin-left:0.375rem">REST</span>' : ''}
                    </td>
                    <td>${this.escapeHtml(r.host)}</td>
                    <td>${r.port}</td>
                    <td>
                      <span class="status-badge ${r.connected ? 'connected' : 'disconnected'}">
                        ${r.connected ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn-sm ${r.connected ? 'btn-outline' : 'btn-success'}"
                        onclick="App.toggleRouter(${r.id}, ${!r.connected})">
                        ${r.connected ? 'Disconnect' : 'Connect'}
                      </button>
                      <button class="btn btn-sm btn-danger" onclick="App.deleteRouter(${r.id}, '${this.escapeHtml(r.name)}')">
                        Delete
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`}
        </div>
      </div>
    `;
  },

  showAddRouterModal() {
    this.openModal('Add Router', `
      <form id="add-router-form">
        <div class="form-group">
          <label>Router Name</label>
          <input type="text" name="name" required placeholder="e.g. Main Router">
        </div>
        <div class="form-group">
          <label>Host / IP Address</label>
          <input type="text" name="host" required placeholder="192.168.1.1">
        </div>
        <div class="form-group">
          <label>Port</label>
          <input type="number" name="port" value="8728">
          <small style="color:var(--text-secondary);font-size:0.75rem">8728 for RouterOS API, 80 for REST API</small>
        </div>
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" required value="admin">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" required>
        </div>
        <div class="form-group">
          <label>Description (optional)</label>
          <textarea name="description" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
            <input type="checkbox" name="use_rest_api" style="width:auto;margin:0">
            Use REST API (port 80/443, RouterOS v7+)
          </label>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Add Router', class: 'btn btn-primary', action: () => this.submitAddRouter() },
    ]);

    const checkbox = document.querySelector('#add-router-form [name="use_rest_api"]');
    const portInput = document.querySelector('#add-router-form [name="port"]');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && portInput.value === '8728') portInput.value = '80';
      if (!checkbox.checked && portInput.value === '80') portInput.value = '8728';
    });
  },

  async submitAddRouter() {
    const form = document.getElementById('add-router-form');
    const data = {
      name: form.name.value,
      host: form.host.value,
      port: parseInt(form.port.value),
      username: form.username.value,
      password: form.password.value,
      description: form.description.value,
      use_rest_api: form.use_rest_api.checked,
    };

    if (data.use_rest_api && data.port === 8728) {
      data.port = 80;
    }

    try {
      await api.createRouter(data);
      this.closeModal();
      this.toast('Router added successfully', 'success');
      this.renderRouters();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async toggleRouter(id, connect) {
    try {
      if (connect) {
        await api.connectRouter(id);
        this.toast('Connected to router', 'success');
      } else {
        await api.disconnectRouter(id);
        this.toast('Disconnected from router', 'info');
      }
      this.renderRouters();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteRouter(id, name) {
    if (!confirm(`Delete router "${name}"? This cannot be undone.`)) return;

    try {
      await api.deleteRouter(id);
      this.toast('Router deleted', 'success');
      this.renderRouters();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async renderHotspot() {
    const content = document.getElementById('page-content');
    const routers = await api.getRouters();
    const connectedRouters = routers.filter((r) => r.connected);

    if (connectedRouters.length === 0) {
      content.innerHTML = '<div class="empty-state"><h3>No connected routers</h3><p>Connect a router first to view hotspot hosts.</p></div>';
      return;
    }

    if (!this.selectedRouterId || !connectedRouters.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = connectedRouters[0].id;
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Hotspot Hosts</h3>
          <div style="display:flex;gap:0.5rem">
            <select id="hotspot-router-select" class="btn btn-outline">
              ${connectedRouters.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" onclick="App.showAddUserModal()">Add User</button>
          </div>
        </div>
        <div id="hotspot-users-table">Loading...</div>
      </div>
    `;

    document.getElementById('hotspot-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadHotspotHosts();
    });

    this.loadHotspotHosts();
  },

  async loadHotspotHosts() {
    const container = document.getElementById('hotspot-users-table');
    try {
      const hosts = await api.getHotspotHosts(this.selectedRouterId);
      if (hosts.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No hotspot hosts found.</p></div>';
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>MAC Address</th>
                <th>IP Address</th>
                <th>Hostname</th>
                <th>Server</th>
                <th>Uptime</th>
                <th>Idle Time</th>
                <th>Rx Rate</th>
                <th>Tx Rate</th>
              </tr>
            </thead>
            <tbody>
              ${hosts.map((h) => `
                <tr>
                  <td><code>${this.escapeHtml(h['mac-address'] || '')}</code></td>
                  <td>${this.escapeHtml(h.address || '')}</td>
                  <td>${this.escapeHtml(h['host-name'] || '-')}</td>
                  <td>${this.escapeHtml(h.server || '')}</td>
                  <td>${h.uptime || '0s'}</td>
                  <td>${h['idle-time'] || '0s'}</td>
                  <td>${h['rate-limit'] || h['rx-rate'] || '0 bps'}</td>
                  <td>${h['tx-rate'] || '0 bps'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  async showAddUserModal() {
    let profiles = [];
    try {
      profiles = await api.getHotspotProfiles(this.selectedRouterId);
    } catch (err) {
      // ignore
    }

    this.openModal('Add Hotspot User', `
      <form id="add-user-form">
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="text" name="password" required>
        </div>
        <div class="form-group">
          <label>Profile</label>
          <select name="profile">
            ${profiles.length > 0
              ? profiles.map((p) => `<option value="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</option>`).join('')
              : '<option value="default">default</option>'}
          </select>
        </div>
        <div class="form-group">
          <label>Comment (optional)</label>
          <input type="text" name="comment">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Add User', class: 'btn btn-primary', action: () => this.submitAddUser() },
    ]);
  },

  async submitAddUser() {
    const form = document.getElementById('add-user-form');
    try {
      await api.createHotspotUser(this.selectedRouterId, {
        username: form.username.value,
        password: form.password.value,
        profile: form.profile.value,
        comment: form.comment.value,
      });
      this.closeModal();
      this.toast('User created', 'success');
      this.loadHotspotHosts();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteHotspotUser(userId) {
    if (!confirm('Remove this hotspot user?')) return;
    try {
      await api.deleteHotspotUser(this.selectedRouterId, userId);
      this.toast('User removed', 'success');
      this.loadHotspotHosts();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async renderVouchers() {
    const content = document.getElementById('page-content');
    const routers = (await api.getRouters()).filter((r) => r.connected);

    if (routers.length === 0) {
      content.innerHTML = '<div class="empty-state"><h3>No connected routers</h3></div>';
      return;
    }

    if (!this.selectedRouterId || !routers.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = routers[0].id;
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Voucher Management</h3>
          <div style="display:flex;gap:0.5rem">
            <select id="voucher-router-select" class="btn btn-outline">
              ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" onclick="App.showGenerateVouchersModal()">Generate Vouchers</button>
          </div>
        </div>
        <div id="vouchers-table">Loading...</div>
      </div>
    `;

    document.getElementById('voucher-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadVouchers();
    });

    this.loadVouchers();
  },

  async loadVouchers() {
    const container = document.getElementById('vouchers-table');
    try {
      const data = await api.getVouchers(this.selectedRouterId);
      const vouchers = data.vouchers;

      if (vouchers.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No vouchers generated yet.</p></div>';
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Username</th>
                <th>Password</th>
                <th>Profile</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${vouchers.map((v) => `
                <tr>
                  <td><strong>${this.escapeHtml(v.code)}</strong></td>
                  <td>${this.escapeHtml(v.username)}</td>
                  <td><code>${this.escapeHtml(v.password)}</code></td>
                  <td>${this.escapeHtml(v.profile)}</td>
                  <td>${v.is_used ? '<span class="status-badge disconnected">Used</span>' : '<span class="status-badge connected">Available</span>'}</td>
                  <td>${new Date(v.created_at).toLocaleDateString()}</td>
                  <td>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteVoucher(${v.id})">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  showGenerateVouchersModal() {
    this.openModal('Generate Vouchers', `
      <form id="generate-vouchers-form">
        <div class="form-group">
          <label>Number of Vouchers</label>
          <input type="number" name="count" value="10" min="1" max="100">
        </div>
        <div class="form-group">
          <label>Profile</label>
          <input type="text" name="profile" value="default">
        </div>
        <div class="form-group">
          <label>Duration (days, optional)</label>
          <input type="number" name="durationMinutes" placeholder="e.g. 30 for 30 days">
        </div>
        <div class="form-group">
          <label>Data Limit (MB, optional)</label>
          <input type="number" name="dataLimitMb" placeholder="e.g. 1024">
        </div>
        <div class="form-group">
          <label>Code Prefix (optional)</label>
          <input type="text" name="prefix" placeholder="e.g. WIFI">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Generate', class: 'btn btn-primary', action: () => this.submitGenerateVouchers() },
    ]);
  },

  async submitGenerateVouchers() {
    const form = document.getElementById('generate-vouchers-form');
    try {
      await api.generateVouchers(this.selectedRouterId, {
        count: parseInt(form.count.value),
        profile: form.profile.value,
        durationMinutes: form.durationMinutes.value ? parseInt(form.durationMinutes.value) * 24 * 60 : null,
        dataLimitMb: form.dataLimitMb.value ? parseInt(form.dataLimitMb.value) : null,
        prefix: form.prefix.value || undefined,
      });
      this.closeModal();
      this.toast('Vouchers generated', 'success');
      this.loadVouchers();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteVoucher(voucherId) {
    if (!confirm('Delete this voucher?')) return;
    try {
      await api.deleteVoucher(this.selectedRouterId, voucherId);
      this.toast('Voucher deleted', 'success');
      this.loadVouchers();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async renderMonitoring() {
    const content = document.getElementById('page-content');
    const summary = await api.getMonitoringSummary();

    content.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Routers</div>
          <div class="stat-value">${summary.totalRouters}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Online</div>
          <div class="stat-value" style="color: var(--success)">${summary.connectedRouters}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Offline</div>
          <div class="stat-value" style="color: var(--danger)">${summary.totalRouters - summary.connectedRouters}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <h3>Router Health</h3>
        </div>
        <div class="router-grid">
          ${summary.routers.map((r) => {
            if (!r.connected || !r.systemInfo) {
              return `
                <div class="router-card offline">
                  <div class="router-name">${this.escapeHtml(r.name)}</div>
                  <div class="router-host">${this.escapeHtml(r.host)}</div>
                  <div class="router-stats"><span style="color: var(--danger)">Offline - No data available</span></div>
                </div>
              `;
            }

            const memPercent = Math.round((r.systemInfo.memoryUsed / r.systemInfo.memoryTotal) * 100);
            const memClass = memPercent > 80 ? 'fill-high' : memPercent > 50 ? 'fill-medium' : 'fill-low';
            const uptimeHours = Math.round(r.systemInfo.uptime / 3600);

            return `
              <div class="router-card online">
                <div class="router-name">${this.escapeHtml(r.name)}</div>
                <div class="router-host">${this.escapeHtml(r.identity || r.host)} - v${r.systemInfo.version}</div>
                <div style="margin-top:0.75rem">
                  <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:0.25rem">
                    <span>CPU Load</span><span>${r.systemInfo.cpuLoad}%</span>
                  </div>
                  <div class="progress-bar">
                    <div class="fill ${r.systemInfo.cpuLoad > 80 ? 'fill-high' : r.systemInfo.cpuLoad > 50 ? 'fill-medium' : 'fill-low'}" style="width:${r.systemInfo.cpuLoad}%"></div>
                  </div>
                </div>
                <div style="margin-top:0.75rem">
                  <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:0.25rem">
                    <span>Memory</span><span>${memPercent}%</span>
                  </div>
                  <div class="progress-bar">
                    <div class="fill ${memClass}" style="width:${memPercent}%"></div>
                  </div>
                </div>
                <div class="router-stats" style="margin-top:0.75rem">
                  <span>Uptime: ${uptimeHours}h</span>
                  <span>${r.systemInfo.boardName}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  async renderPortal() {
    const content = document.getElementById('page-content');
    const routers = (await api.getRouters()).filter((r) => r.connected);

    if (this.portalDirty && !confirm('You have unsaved changes. Reloading will discard them. Continue?')) {
      return;
    }
    this.portalDirty = false;

    let filesData = [];
    try {
      const res = await api.getPortalFiles();
      filesData = res.files || [];
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
      return;
    }

    const categories = {
      'Pages': filesData.filter(f => f.path.endsWith('.html')),
      'Config': filesData.filter(f => f.path.endsWith('.txt')),
      'Styles': filesData.filter(f => f.path.endsWith('.css')),
      'Scripts': filesData.filter(f => f.path.endsWith('.js')),
      'Other': filesData.filter(f => f.editable && !f.path.match(/\.(html|txt|css|js)$/i)),
      'Assets (push-only)': filesData.filter(f => !f.editable),
    };

    const fileIcon = (f) => {
      if (!f.editable) return '&#128206;';
      if (f.path.endsWith('.html')) return '&#128196;';
      if (f.path.endsWith('.css')) return '&#127912;';
      if (f.path.endsWith('.js')) return '&#9889;';
      if (f.path.endsWith('.txt')) return '&#128221;';
      return '&#128196;';
    };

    const formatSize = (bytes) => {
      if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return bytes + ' B';
    };

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Hotspot Portal Files</h3>
          <div style="display:flex;gap:0.5rem;align-items:center">
            ${routers.length > 0 ? `
              <select id="portal-router-select" class="btn btn-outline">
                ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
              </select>
              <button class="btn btn-primary btn-sm" onclick="App.pushPortal()">Push All to Router</button>
            ` : '<span class="status-badge disconnected">No connected routers — connect one on the Routers page</span>'}
          </div>
        </div>
        <div class="portal-main-layout">
          <div class="portal-file-list" id="portal-file-list">
            ${Object.entries(categories).map(([cat, files]) => {
              if (files.length === 0) return '';
              return `
                <div class="portal-file-group">
                  <div class="portal-file-group-label">${cat}</div>
                  ${files.map((f) => `
                    <div class="portal-file-item ${f.path === this.portalCurrentFile ? 'active' : ''} ${!f.editable ? 'binary' : ''}"
                         data-path="${this.escapeHtml(f.path)}"
                         onclick="App.selectPortalFile('${this.escapeHtml(f.path)}')"
                         title="${this.escapeHtml(f.path)} (${formatSize(f.size)})">
                      <span class="portal-file-icon">${fileIcon(f)}</span>
                      <span class="portal-file-name">${this.escapeHtml(f.path.split('/').pop())}</span>
                      ${f.path.includes('/') ? `<span class="portal-file-subpath">${this.escapeHtml(f.path.split('/').slice(0, -1).join('/'))}</span>` : ''}
                    </div>
                  `).join('')}
                </div>
              `;
            }).join('')}
          </div>
          <div class="portal-editor-area">
            <div class="portal-toolbar">
              <div class="portal-file-info" id="portal-file-info"></div>
              <div class="portal-actions">
                <span id="portal-dirty" class="portal-dirty" style="visibility:hidden">Unsaved changes</span>
                <button class="btn btn-sm btn-outline" id="portal-toggle-preview" onclick="App.togglePortalPreview()">Hide Preview</button>
                <button class="btn btn-sm btn-outline" id="portal-reset-btn" onclick="App.resetPortalFile()">Reset to Default</button>
                <button class="btn btn-sm btn-primary" id="portal-save-btn" onclick="App.savePortalFile()">Save</button>
              </div>
            </div>
            <div class="portal-editor-layout" id="portal-layout">
              <div class="portal-editor-pane">
                <textarea id="portal-editor" class="portal-editor" spellcheck="false" wrap="off"></textarea>
              </div>
              <div class="portal-preview-pane">
                <iframe id="portal-preview" class="portal-preview" sandbox="allow-same-origin"></iframe>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (routers.length > 0) {
      if (!this.selectedRouterId || !routers.find((r) => r.id === this.selectedRouterId)) {
        this.selectedRouterId = routers[0].id;
        document.getElementById('portal-router-select').value = this.selectedRouterId;
      }
      document.getElementById('portal-router-select').addEventListener('change', (e) => {
        this.selectedRouterId = parseInt(e.target.value);
      });
    }

    const editor = document.getElementById('portal-editor');
    editor.addEventListener('input', () => {
      this.portalDirty = true;
      document.getElementById('portal-dirty').style.visibility = 'visible';
      clearTimeout(this._portalPreviewTimer);
      this._portalPreviewTimer = setTimeout(() => this.updatePortalPreview(), 600);
    });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        editor.dispatchEvent(new Event('input'));
      }
    });

    const firstEditable = filesData.find(f => f.editable);
    if (firstEditable) {
      await this.selectPortalFile(this.portalCurrentFile && filesData.find(f => f.path === this.portalCurrentFile) ? this.portalCurrentFile : firstEditable.path, true);
    }
  },

  async selectPortalFile(filePath, force = false) {
    if (!force && this.portalDirty && !confirm('You have unsaved changes. Switching files will discard them. Continue?')) {
      return;
    }

    document.querySelectorAll('.portal-file-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.path === filePath);
    });

    const editor = document.getElementById('portal-editor');
    const fileInfo = document.getElementById('portal-file-info');
    const saveBtn = document.getElementById('portal-save-btn');
    const resetBtn = document.getElementById('portal-reset-btn');
    const toggleBtn = document.getElementById('portal-toggle-preview');
    if (!editor) return;

    const isEditable = !document.querySelector(`.portal-file-item[data-path="${filePath}"]`)?.classList.contains('binary');
    const isHtml = filePath.endsWith('.html');

    editor.disabled = !isEditable;
    saveBtn.style.display = isEditable ? '' : 'none';
    resetBtn.style.display = isEditable ? '' : 'none';
    toggleBtn.style.display = isHtml ? '' : 'none';

    if (!isEditable) {
      editor.value = '';
      fileInfo.textContent = `${filePath} — binary file (pushed to router as-is)`;
      this.portalDirty = false;
      document.getElementById('portal-dirty').style.visibility = 'hidden';
      const preview = document.getElementById('portal-preview');
      if (preview) preview.srcdoc = '<p style="color:#999;text-align:center;margin-top:2rem">Preview not available for binary files</p>';
      return;
    }

    editor.disabled = true;
    editor.value = 'Loading...';
    fileInfo.textContent = filePath;

    try {
      const row = await api.getPortalFile(filePath);
      this.portalCurrentFile = filePath;
      this.portalDirty = false;
      document.getElementById('portal-dirty').style.visibility = 'hidden';
      editor.value = row.content;
      if (isHtml) {
        this.updatePortalPreview();
      } else {
        const preview = document.getElementById('portal-preview');
        if (preview) preview.srcdoc = '<p style="color:#999;text-align:center;margin-top:2rem">Preview available for HTML files only</p>';
      }
    } catch (err) {
      editor.value = `Error loading file: ${err.message}`;
      this.toast(err.message, 'error');
    } finally {
      editor.disabled = false;
    }
  },

  updatePortalPreview() {
    const editor = document.getElementById('portal-editor');
    const preview = document.getElementById('portal-preview');
    if (!editor || !preview) return;
    let html = editor.value;
    html = html.replace(/\$\((link-[\w-]+)\)/g, '#');
    html = html.replace(/\$\((chap-challenge|chap-id|mac|ip|error|username|server-address|link-orig|link-status)\)/g, '');
    if (html.includes('<head>')) {
      html = html.replace('<head>', '<head><base href="/hotspot-assets/">');
    } else if (html.includes('<html')) {
      html = html.replace(/<html[^>]*>/i, (m) => m + '<head><base href="/hotspot-assets/"></head>');
    } else {
      html = '<base href="/hotspot-assets/">' + html;
    }
    preview.srcdoc = html;
  },

  togglePortalPreview() {
    const layout = document.getElementById('portal-layout');
    const btn = document.getElementById('portal-toggle-preview');
    layout.classList.toggle('preview-hidden');
    btn.textContent = layout.classList.contains('preview-hidden') ? 'Show Preview' : 'Hide Preview';
  },

  async savePortalFile() {
    const editor = document.getElementById('portal-editor');
    if (!editor) return;
    try {
      await api.savePortalFile(this.portalCurrentFile, editor.value);
      this.portalDirty = false;
      document.getElementById('portal-dirty').style.visibility = 'hidden';
      this.toast(`${this.portalCurrentFile} saved`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async resetPortalFile() {
    if (!confirm(`Reset ${this.portalCurrentFile} to the default template? Unsaved changes will be lost.`)) return;
    try {
      const res = await api.resetPortalFile(this.portalCurrentFile);
      const editor = document.getElementById('portal-editor');
      editor.value = res.file.content;
      this.portalDirty = false;
      document.getElementById('portal-dirty').style.visibility = 'hidden';
      this.updatePortalPreview();
      this.toast(`${this.portalCurrentFile} reset to default`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async pushPortal() {
    if (this.portalDirty && !confirm('You have unsaved changes. Push will use the last saved version. Continue?')) return;
    const routerId = this.selectedRouterId;
    if (!routerId) {
      this.toast('Select a router first', 'error');
      return;
    }
    if (!confirm(`Push ALL portal files (HTML, CSS, JS, config, images, sounds) to the router's hotspot folder? This overwrites everything in the hotspot directory.`)) return;

    try {
      const res = await api.pushPortalFiles(routerId);
      const failed = (res.results || []).filter((r) => !r.ok);
      if (failed.length === 0) {
        this.toast(res.message || 'All files pushed to router hotspot folder', 'success');
      } else {
        const details = failed.map((f) => `${f.file}: ${f.error}`).join('\n');
        this.toast(`${res.message} — ${failed.map((f) => f.file).join(', ')}`, 'error');
        console.error('Push failures:\n' + details);
      }
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  openModal(title, bodyHtml, buttons = []) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;

    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    buttons.forEach((btn) => {
      const el = document.createElement('button');
      el.className = btn.class || 'btn btn-outline';
      el.textContent = btn.label;
      el.addEventListener('click', btn.action);
      footer.appendChild(el);
    });

    document.getElementById('modal-overlay').classList.add('active');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
