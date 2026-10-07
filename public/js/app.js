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
      'hotspot-settings': 'Hotspot Settings',
      interfaces: 'Interfaces',
      vouchers: 'Vouchers',
      monitoring: 'Monitoring',
      portal: 'Portal',
      subvendo: 'SubVendo',
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
        case 'hotspot-settings': await this.renderHotspotSettings(); break;
        case 'interfaces': await this.renderInterfaces(); break;
        case 'vouchers': await this.renderVouchers(); break;
        case 'monitoring': await this.renderMonitoring(); break;
        case 'portal': await this.renderPortal(); break;
        case 'subvendo': await this.renderSubVendo(); break;
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
                      <button class="btn btn-sm btn-outline" onclick="App.showEditRouterModal(${r.id})">
                        Edit
                      </button>
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

  async showEditRouterModal(routerId) {
    try {
      const router = await api.getRouter(routerId);
      this.openModal('Edit Router', `
        <form id="edit-router-form">
          <div class="form-group">
            <label>Router Name</label>
            <input type="text" name="name" required value="${this.escapeHtml(router.name)}">
          </div>
          <div class="form-group">
            <label>Host / IP Address</label>
            <input type="text" name="host" required value="${this.escapeHtml(router.host)}">
          </div>
          <div class="form-group">
            <label>Port</label>
            <input type="number" name="port" value="${router.port}">
            <small style="color:var(--text-secondary);font-size:0.75rem">8728 for RouterOS API, 80 for REST API</small>
          </div>
          <div class="form-group">
            <label>Username</label>
            <input type="text" name="username" required value="${this.escapeHtml(router.username)}">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" name="password" placeholder="Leave blank to keep current">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea name="description" rows="2">${this.escapeHtml(router.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
              <input type="checkbox" name="use_rest_api" style="width:auto;margin:0" ${router.use_rest_api ? 'checked' : ''}>
              Use REST API (port 80/443, RouterOS v7+)
            </label>
          </div>
        </form>
      `, [
        { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
        { label: 'Save Changes', class: 'btn btn-primary', action: () => this.submitEditRouter(routerId) },
      ]);

      const checkbox = document.querySelector('#edit-router-form [name="use_rest_api"]');
      const portInput = document.querySelector('#edit-router-form [name="port"]');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && portInput.value === '8728') portInput.value = '80';
        if (!checkbox.checked && portInput.value === '80') portInput.value = '8728';
      });
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async submitEditRouter(routerId) {
    const form = document.getElementById('edit-router-form');
    const data = {
      name: form.name.value,
      host: form.host.value,
      port: parseInt(form.port.value),
      username: form.username.value,
      description: form.description.value,
      use_rest_api: form.use_rest_api.checked,
    };

    if (form.password.value) {
      data.password = form.password.value;
    }

    if (data.use_rest_api && data.port === 8728) {
      data.port = 80;
    }

    try {
      await api.updateRouter(routerId, data);
      this.closeModal();
      this.toast('Router updated successfully', 'success');
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

  async renderHotspotSettings() {
    const content = document.getElementById('page-content');
    const routers = (await api.getRouters()).filter((r) => r.connected);

    if (routers.length === 0) {
      content.innerHTML = '<div class="empty-state"><h3>No connected routers</h3></div>';
      return;
    }

    if (!this.selectedRouterId || !routers.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = routers[0].id;
    }

    if (!this.hotspotSettingsTab) {
      this.hotspotSettingsTab = 'servers';
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Hotspot Settings</h3>
          <select id="hotspot-settings-router-select" class="btn btn-outline">
            ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
          </select>
        </div>
        <div class="tabs">
          <button class="tab ${this.hotspotSettingsTab === 'servers' ? 'active' : ''}" data-tab="servers">Hotspot Servers</button>
          <button class="tab ${this.hotspotSettingsTab === 'server-profiles' ? 'active' : ''}" data-tab="server-profiles">Server Profiles</button>
          <button class="tab ${this.hotspotSettingsTab === 'user-profiles' ? 'active' : ''}" data-tab="user-profiles">User Profiles</button>
          <button class="tab ${this.hotspotSettingsTab === 'ip-bindings' ? 'active' : ''}" data-tab="ip-bindings">IP Bindings</button>
          <button class="tab ${this.hotspotSettingsTab === 'walled-garden' ? 'active' : ''}" data-tab="walled-garden">Walled Garden</button>
          <button class="tab ${this.hotspotSettingsTab === 'cookies' ? 'active' : ''}" data-tab="cookies">Cookies</button>
        </div>
        <div id="hotspot-settings-content">Loading...</div>
      </div>
    `;

    document.getElementById('hotspot-settings-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadHotspotSettingsTab();
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.hotspotSettingsTab = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.loadHotspotSettingsTab();
      });
    });

    this.loadHotspotSettingsTab();
  },

  async loadHotspotSettingsTab() {
    const container = document.getElementById('hotspot-settings-content');
    container.innerHTML = 'Loading...';

    try {
      switch (this.hotspotSettingsTab) {
        case 'servers': await this.loadHotspotServers(container); break;
        case 'server-profiles': await this.loadServerProfiles(container); break;
        case 'user-profiles': await this.loadUserProfiles(container); break;
        case 'ip-bindings': await this.loadIpBindings(container); break;
        case 'walled-garden': await this.loadWalledGarden(container); break;
        case 'cookies': await this.loadCookies(container); break;
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  async loadHotspotServers(container) {
    const servers = await api.getHotspotServers(this.selectedRouterId);

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>Hotspot Servers</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateServerModal()">Add Server</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Interface</th>
                <th>Address Pool</th>
                <th>Profile</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${servers.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No servers configured</td></tr>' : servers.map((s) => `
                <tr>
                  <td>${this.escapeHtml(s.name || '-')}</td>
                  <td>${this.escapeHtml(s.interface || '-')}</td>
                  <td>${this.escapeHtml(s['address-pool'] || '-')}</td>
                  <td>${this.escapeHtml(s.profile || '-')}</td>
                  <td>${s.disabled === 'true' ? '<span class="status-badge disconnected">Disabled</span>' : '<span class="status-badge connected">Enabled</span>'}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="App.showEditServerModal('${s['.id']}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteHotspotServer('${s['.id']}')">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async loadServerProfiles(container) {
    const profiles = await api.getHotspotProfiles(this.selectedRouterId);

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>Server Profiles</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateServerProfileModal()">Add Profile</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Address Pool</th>
                <th>Rate Limit</th>
                <th>Shared Users</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${profiles.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No profiles found</td></tr>' : profiles.map((p) => `
                <tr>
                  <td>${this.escapeHtml(p.name || '-')}</td>
                  <td>${this.escapeHtml(p['address-pool'] || '-')}</td>
                  <td>${this.escapeHtml(p['rate-limit'] || '-')}</td>
                  <td>${this.escapeHtml(p['shared-users'] || '1')}</td>
                  <td>${p.disabled === 'true' ? '<span class="status-badge disconnected">Disabled</span>' : '<span class="status-badge connected">Enabled</span>'}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="App.showEditServerProfileModal('${p['.id']}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteServerProfile('${p['.id']}')">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async loadUserProfiles(container) {
    const profiles = await api.getUserProfiles(this.selectedRouterId);

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>User Profiles</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateUserProfileModal()">Add Profile</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Rate Limit</th>
                <th>Shared Users</th>
                <th>Session Timeout</th>
                <th>Idle Timeout</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${profiles.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No user profiles found</td></tr>' : profiles.map((p) => `
                <tr>
                  <td>${this.escapeHtml(p.name || '-')}</td>
                  <td>${this.escapeHtml(p['rate-limit'] || '-')}</td>
                  <td>${this.escapeHtml(p['shared-users'] || '1')}</td>
                  <td>${this.escapeHtml(p['session-timeout'] || '-')}</td>
                  <td>${this.escapeHtml(p['idle-timeout'] || '-')}</td>
                  <td>${p.disabled === 'true' ? '<span class="status-badge disconnected">Disabled</span>' : '<span class="status-badge connected">Enabled</span>'}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="App.showEditUserProfileModal('${p['.id']}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteUserProfile('${p['.id']}')">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async loadIpBindings(container) {
    const bindings = await api.getIpBindings(this.selectedRouterId);

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>IP Bindings</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateIpBindingModal()">Add Binding</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>MAC Address</th>
                <th>Address</th>
                <th>To Address</th>
                <th>Server</th>
                <th>Comment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${bindings.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No IP bindings found</td></tr>' : bindings.map((b) => `
                <tr>
                  <td>${this.escapeHtml(b['mac-address'] || '-')}</td>
                  <td>${this.escapeHtml(b.address || '-')}</td>
                  <td>${this.escapeHtml(b['to-address'] || '-')}</td>
                  <td>${this.escapeHtml(b.server || 'all')}</td>
                  <td>${this.escapeHtml(b.comment || '-')}</td>
                  <td>${b.disabled === 'true' ? '<span class="status-badge disconnected">Disabled</span>' : '<span class="status-badge connected">Enabled</span>'}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="App.showEditIpBindingModal('${b['.id']}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteIpBinding('${b['.id']}')">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async loadWalledGarden(container) {
    const entries = await api.getWalledGarden(this.selectedRouterId);

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>Walled Garden</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateWalledGardenModal()">Add Entry</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Host</th>
                <th>Action</th>
                <th>Comment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${entries.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No walled garden entries</td></tr>' : entries.map((w) => `
                <tr>
                  <td>${this.escapeHtml(w.host || '-')}</td>
                  <td>${this.escapeHtml(w.action || '-')}</td>
                  <td>${this.escapeHtml(w.comment || '-')}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" onclick="App.showEditWalledGardenModal('${w['.id']}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteWalledGarden('${w['.id']}')">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async loadCookies(container) {
    const cookies = await api.getHotspotCookies(this.selectedRouterId);

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>Cookies</h4>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Domain</th>
                <th>MAC Address</th>
                <th>Expires In</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cookies.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No cookies found</td></tr>' : cookies.map((c) => `
                <tr>
                  <td>${this.escapeHtml(c.user || '-')}</td>
                  <td>${this.escapeHtml(c.domain || '-')}</td>
                  <td>${this.escapeHtml(c['mac-address'] || '-')}</td>
                  <td>${this.escapeHtml(c['expires-in'] || '-')}</td>
                  <td>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteHotspotCookie('${c['.id']}')">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async deleteHotspotCookie(cookieId) {
    if (!confirm('Delete this cookie?')) return;
    try {
      await api.deleteHotspotCookie(this.selectedRouterId, cookieId);
      this.toast('Cookie deleted', 'success');
      this.loadHotspotSettingsTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteHotspotServer(serverId) {
    if (!confirm('Delete this hotspot server?')) return;
    try {
      await api.deleteHotspotServer(this.selectedRouterId, serverId);
      this.toast('Hotspot server deleted', 'success');
      this.loadHotspotSettingsTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async showEditServerModal(serverId) {
    const servers = await api.getHotspotServers(this.selectedRouterId);
    const server = servers.find((s) => s['.id'] === serverId);
    if (!server) { this.toast('Server not found', 'error'); return; }

    let interfaces = [];
    try { interfaces = await api.getRouterInterfaces(this.selectedRouterId); } catch (err) {}

    this.openModal('Edit Hotspot Server', `
      <form id="edit-server-form">
        <div class="form-group">
          <label>Server Name</label>
          <input type="text" name="name" required value="${this.escapeHtml(server.name || '')}">
        </div>
        <div class="form-group">
          <label>Interface</label>
          <select name="interface" class="form-control" required>
            <option value="">Select interface...</option>
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}" ${i.name === server.interface ? 'selected' : ''}>${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Address Pool</label>
          <input type="text" name="address-pool" value="${this.escapeHtml(server['address-pool'] || '')}">
        </div>
        <div class="form-group">
          <label>Profile</label>
          <input type="text" name="profile" value="${this.escapeHtml(server.profile || 'default')}">
        </div>
        <div class="form-group">
          <label>Addresses</label>
          <input type="text" name="addresses" value="${this.escapeHtml(server.addresses || '')}">
        </div>
        <div class="form-group">
          <label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${server.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${server.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Save',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('edit-server-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => { data[key] = value; });
          try {
            await api.updateHotspotServer(this.selectedRouterId, serverId, data);
            this.closeModal();
            this.toast('Hotspot server updated', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async showCreateServerProfileModal() {
    this.openModal('Create Server Profile', `
      <form id="create-server-profile-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required placeholder="e.g. hs-profile-1">
        </div>
        <div class="form-group">
          <label>Address Pool</label>
          <input type="text" name="address-pool" placeholder="e.g. dhcp-pool1">
        </div>
        <div class="form-group">
          <label>Rate Limit</label>
          <input type="text" name="rate-limit" placeholder="e.g. 10M/20M">
        </div>
        <div class="form-group">
          <label>Shared Users</label>
          <input type="number" name="shared-users" value="1" min="1">
        </div>
        <div class="form-group">
          <label>Session Timeout</label>
          <input type="text" name="session-timeout" placeholder="e.g. 1d or 00:00:00">
        </div>
        <div class="form-group">
          <label>Idle Timeout</label>
          <input type="text" name="idle-timeout" placeholder="e.g. 30m or 00:30:00">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Create',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('create-server-profile-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => { if (value) data[key] = value; });
          try {
            await api.createHotspotProfile(this.selectedRouterId, data);
            this.closeModal();
            this.toast('Server profile created', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async showEditServerProfileModal(profileId) {
    const profiles = await api.getHotspotProfiles(this.selectedRouterId);
    const profile = profiles.find((p) => p['.id'] === profileId);
    if (!profile) { this.toast('Profile not found', 'error'); return; }

    this.openModal('Edit Server Profile', `
      <form id="edit-server-profile-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required value="${this.escapeHtml(profile.name || '')}">
        </div>
        <div class="form-group">
          <label>Address Pool</label>
          <input type="text" name="address-pool" value="${this.escapeHtml(profile['address-pool'] || '')}">
        </div>
        <div class="form-group">
          <label>Rate Limit</label>
          <input type="text" name="rate-limit" value="${this.escapeHtml(profile['rate-limit'] || '')}">
        </div>
        <div class="form-group">
          <label>Shared Users</label>
          <input type="number" name="shared-users" value="${profile['shared-users'] || 1}" min="1">
        </div>
        <div class="form-group">
          <label>Session Timeout</label>
          <input type="text" name="session-timeout" value="${this.escapeHtml(profile['session-timeout'] || '')}">
        </div>
        <div class="form-group">
          <label>Idle Timeout</label>
          <input type="text" name="idle-timeout" value="${this.escapeHtml(profile['idle-timeout'] || '')}">
        </div>
        <div class="form-group">
          <label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${profile.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${profile.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Save',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('edit-server-profile-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => { data[key] = value; });
          try {
            await api.updateHotspotProfile(this.selectedRouterId, profileId, data);
            this.closeModal();
            this.toast('Server profile updated', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async deleteServerProfile(profileId) {
    if (!confirm('Delete this server profile?')) return;
    try {
      await api.deleteHotspotProfile(this.selectedRouterId, profileId);
      this.toast('Server profile deleted', 'success');
      this.loadHotspotSettingsTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async showCreateUserProfileModal() {
    this.openModal('Create User Profile', `
      <form id="create-user-profile-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required placeholder="e.g. 1hour-10M">
        </div>
        <div class="form-group">
          <label>Rate Limit</label>
          <input type="text" name="rate-limit" placeholder="e.g. 10M/20M">
        </div>
        <div class="form-group">
          <label>Shared Users</label>
          <input type="number" name="shared-users" value="1" min="1">
        </div>
        <div class="form-group">
          <label>Session Timeout</label>
          <input type="text" name="session-timeout" placeholder="e.g. 1h or 01:00:00">
        </div>
        <div class="form-group">
          <label>Idle Timeout</label>
          <input type="text" name="idle-timeout" placeholder="e.g. 30m or 00:30:00">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Create',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('create-user-profile-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => { if (value) data[key] = value; });
          try {
            await api.createUserProfile(this.selectedRouterId, data);
            this.closeModal();
            this.toast('User profile created', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async showEditUserProfileModal(profileId) {
    const profiles = await api.getUserProfiles(this.selectedRouterId);
    const profile = profiles.find((p) => p['.id'] === profileId);
    if (!profile) { this.toast('Profile not found', 'error'); return; }

    this.openModal('Edit User Profile', `
      <form id="edit-user-profile-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required value="${this.escapeHtml(profile.name || '')}">
        </div>
        <div class="form-group">
          <label>Rate Limit</label>
          <input type="text" name="rate-limit" value="${this.escapeHtml(profile['rate-limit'] || '')}">
        </div>
        <div class="form-group">
          <label>Shared Users</label>
          <input type="number" name="shared-users" value="${profile['shared-users'] || 1}" min="1">
        </div>
        <div class="form-group">
          <label>Session Timeout</label>
          <input type="text" name="session-timeout" value="${this.escapeHtml(profile['session-timeout'] || '')}">
        </div>
        <div class="form-group">
          <label>Idle Timeout</label>
          <input type="text" name="idle-timeout" value="${this.escapeHtml(profile['idle-timeout'] || '')}">
        </div>
        <div class="form-group">
          <label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${profile.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${profile.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Save',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('edit-user-profile-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => { data[key] = value; });
          try {
            await api.updateUserProfile(this.selectedRouterId, profileId, data);
            this.closeModal();
            this.toast('User profile updated', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async showEditIpBindingModal(bindingId) {
    const bindings = await api.getIpBindings(this.selectedRouterId);
    const binding = bindings.find((b) => b['.id'] === bindingId);
    if (!binding) { this.toast('IP binding not found', 'error'); return; }

    this.openModal('Edit IP Binding', `
      <form id="edit-ip-binding-form">
        <div class="form-group">
          <label>MAC Address</label>
          <input type="text" name="mac-address" value="${this.escapeHtml(binding['mac-address'] || '')}">
        </div>
        <div class="form-group">
          <label>Address</label>
          <input type="text" name="address" value="${this.escapeHtml(binding.address || '')}">
        </div>
        <div class="form-group">
          <label>To Address</label>
          <input type="text" name="to-address" value="${this.escapeHtml(binding['to-address'] || '')}">
        </div>
        <div class="form-group">
          <label>Server</label>
          <input type="text" name="server" value="${this.escapeHtml(binding.server || 'all')}">
        </div>
        <div class="form-group">
          <label>Comment</label>
          <input type="text" name="comment" value="${this.escapeHtml(binding.comment || '')}">
        </div>
        <div class="form-group">
          <label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${binding.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${binding.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Save',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('edit-ip-binding-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => { data[key] = value; });
          try {
            await api.updateIpBinding(this.selectedRouterId, bindingId, data);
            this.closeModal();
            this.toast('IP binding updated', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async showEditWalledGardenModal(entryId) {
    const entries = await api.getWalledGarden(this.selectedRouterId);
    const entry = entries.find((w) => w['.id'] === entryId);
    if (!entry) { this.toast('Walled garden entry not found', 'error'); return; }

    this.openModal('Edit Walled Garden Entry', `
      <form id="edit-walled-garden-form">
        <div class="form-group">
          <label>Host</label>
          <input type="text" name="host" required value="${this.escapeHtml(entry.host || '')}">
        </div>
        <div class="form-group">
          <label>Action</label>
          <select name="action" class="form-control" required>
            <option value="accept" ${entry.action === 'accept' ? 'selected' : ''}>Accept</option>
            <option value="reject" ${entry.action === 'reject' ? 'selected' : ''}>Reject</option>
          </select>
        </div>
        <div class="form-group">
          <label>Comment</label>
          <input type="text" name="comment" value="${this.escapeHtml(entry.comment || '')}">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Save',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('edit-walled-garden-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => { if (value) data[key] = value; });
          try {
            await api.updateWalledGarden(this.selectedRouterId, entryId, data);
            this.closeModal();
            this.toast('Walled garden entry updated', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async showCreateServerModal() {
    let interfaces = [];
    try {
      interfaces = await api.getRouterInterfaces(this.selectedRouterId);
    } catch (err) {
      this.toast('Could not fetch interfaces', 'error');
    }

    this.openModal('Create Hotspot Server', `
      <form id="create-server-form">
        <div class="form-group">
          <label>Server Name</label>
          <input type="text" name="name" required placeholder="e.g. hotspot1">
        </div>
        <div class="form-group">
          <label>Interface</label>
          <select name="interface" class="form-control" required>
            <option value="">Select interface...</option>
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}">${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Address Pool</label>
          <input type="text" name="address-pool" placeholder="e.g. dhcp-pool1">
        </div>
        <div class="form-group">
          <label>Profile</label>
          <input type="text" name="profile" value="default" placeholder="e.g. default">
        </div>
        <div class="form-group">
          <label>Addresses</label>
          <input type="text" name="addresses" placeholder="e.g. 192.168.1.0/24">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Create',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('create-server-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => {
            if (value) data[key] = value;
          });
          try {
            await api.createHotspotServer(this.selectedRouterId, data);
            this.closeModal();
            this.toast('Hotspot server created', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async showCreateIpBindingModal() {
    this.openModal('Add IP Binding', `
      <form id="create-ip-binding-form">
        <div class="form-group">
          <label>MAC Address</label>
          <input type="text" name="mac-address" placeholder="e.g. 00:11:22:33:44:55">
        </div>
        <div class="form-group">
          <label>Address</label>
          <input type="text" name="address" placeholder="e.g. 192.168.1.100">
        </div>
        <div class="form-group">
          <label>To Address</label>
          <input type="text" name="to-address" placeholder="e.g. 192.168.1.200">
        </div>
        <div class="form-group">
          <label>Server</label>
          <input type="text" name="server" value="all" placeholder="e.g. all or hotspot1">
        </div>
        <div class="form-group">
          <label>Comment (optional)</label>
          <input type="text" name="comment" placeholder="e.g. Office PC">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Add',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('create-ip-binding-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => {
            if (value) data[key] = value;
          });
          try {
            await api.createIpBinding(this.selectedRouterId, data);
            this.closeModal();
            this.toast('IP binding added', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async deleteIpBinding(bindingId) {
    if (!confirm('Delete this IP binding?')) return;
    try {
      await api.deleteIpBinding(this.selectedRouterId, bindingId);
      this.toast('IP binding deleted', 'success');
      this.loadHotspotSettingsTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async showCreateWalledGardenModal() {
    this.openModal('Add Walled Garden Entry', `
      <form id="create-walled-garden-form">
        <div class="form-group">
          <label>Host</label>
          <input type="text" name="host" required placeholder="e.g. *.example.com or 192.168.1.0/24">
        </div>
        <div class="form-group">
          <label>Action</label>
          <select name="action" class="form-control" required>
            <option value="accept">Accept</option>
            <option value="reject">Reject</option>
          </select>
        </div>
        <div class="form-group">
          <label>Comment (optional)</label>
          <input type="text" name="comment" placeholder="e.g. Allow Facebook">
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Add',
        class: 'btn btn-primary',
        action: async () => {
          const form = document.getElementById('create-walled-garden-form');
          const formData = new FormData(form);
          const data = {};
          formData.forEach((value, key) => {
            if (value) data[key] = value;
          });
          try {
            await api.createWalledGarden(this.selectedRouterId, data);
            this.closeModal();
            this.toast('Walled garden entry added', 'success');
            this.loadHotspotSettingsTab();
          } catch (err) {
            this.toast(err.message, 'error');
          }
        },
      },
    ]);
  },

  async deleteWalledGarden(entryId) {
    if (!confirm('Delete this walled garden entry?')) return;
    try {
      await api.deleteWalledGarden(this.selectedRouterId, entryId);
      this.toast('Walled garden entry deleted', 'success');
      this.loadHotspotSettingsTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  // ==================== INTERFACES PAGE ====================

  async renderInterfaces() {
    const content = document.getElementById('page-content');
    const routers = await api.getRouters();
    const connected = routers.filter((r) => r.status === 'connected');

    if (!this.selectedRouterId || !connected.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = connected.length > 0 ? connected[0].id : (routers.length > 0 ? routers[0].id : null);
    }

    if (!this.interfacesTab) {
      this.interfacesTab = 'interfaces';
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <select id="interfaces-router-select" class="form-control" style="width:auto;min-width:200px">
            ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)} (${this.escapeHtml(r.host)})${r.status === 'connected' ? '' : ' - offline'}</option>`).join('')}
          </select>
        </div>
        <div class="tabs" style="margin-top:1rem">
          <button class="tab ${this.interfacesTab === 'interfaces' ? 'active' : ''}" data-tab="interfaces">Interfaces</button>
          <button class="tab ${this.interfacesTab === 'interface-lists' ? 'active' : ''}" data-tab="interface-lists">Interface List</button>
          <button class="tab ${this.interfacesTab === 'ethernet' ? 'active' : ''}" data-tab="ethernet">Ethernet</button>
          <button class="tab ${this.interfacesTab === 'bridge' ? 'active' : ''}" data-tab="bridge">Bridge</button>
          <button class="tab ${this.interfacesTab === 'vlan' ? 'active' : ''}" data-tab="vlan">VLAN</button>
          <button class="tab ${this.interfacesTab === 'eoip' ? 'active' : ''}" data-tab="eoip">EoIP Tunnel</button>
          <button class="tab ${this.interfacesTab === 'ip-tunnel' ? 'active' : ''}" data-tab="ip-tunnel">IP Tunnel</button>
          <button class="tab ${this.interfacesTab === 'gre' ? 'active' : ''}" data-tab="gre">GRE Tunnel</button>
          <button class="tab ${this.interfacesTab === 'vrrp' ? 'active' : ''}" data-tab="vrrp">VRRP</button>
          <button class="tab ${this.interfacesTab === 'bonding' ? 'active' : ''}" data-tab="bonding">Bonding</button>
          <button class="tab ${this.interfacesTab === 'macsec' ? 'active' : ''}" data-tab="macsec">MACsec</button>
        </div>
        <div id="interfaces-content" style="padding:1rem 0"></div>
      </div>
    `;

    const routerSelect = document.getElementById('interfaces-router-select');
    routerSelect.addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadInterfacesTab();
    });

    content.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        content.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.interfacesTab = tab.dataset.tab;
        this.loadInterfacesTab();
      });
    });

    this.loadInterfacesTab();
  },

  loadInterfacesTab() {
    const container = document.getElementById('interfaces-content');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';

    switch (this.interfacesTab) {
      case 'interfaces': this.loadAllInterfaces(container); break;
      case 'interface-lists': this.loadInterfaceLists(container); break;
      case 'ethernet': this.loadEthernetList(container); break;
      case 'bridge': this.loadBridgeList(container); break;
      case 'vlan': this.loadVlanList(container); break;
      case 'eoip': this.loadEoIPList(container); break;
      case 'ip-tunnel': this.loadIpTunnelList(container); break;
      case 'gre': this.loadGREList(container); break;
      case 'vrrp': this.loadVRRPList(container); break;
      case 'bonding': this.loadBondingList(container); break;
      case 'macsec': this.loadMACsecList(container); break;
    }
  },

  async loadAllInterfaces(container) {
    const interfaces = await api.getInterfaces(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header"><h4>All Interfaces</h4></div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Type</th><th>MTU</th><th>MAC Address</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${interfaces.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No interfaces found</td></tr>' : interfaces.map((i) => `
              <tr>
                <td>${this.escapeHtml(i.name || '-')}</td>
                <td><span class="status-badge ${i.running === 'true' ? 'connected' : 'disconnected'}">${this.escapeHtml(i.type || i['type'] || '-')}</span></td>
                <td>${this.escapeHtml(i.mtu || i['actual-mtu'] || '-')}</td>
                <td>${this.escapeHtml(i['mac-address'] || '-')}</td>
                <td>${i.disabled === 'true' ? '<span class="status-badge disconnected">Disabled</span>' : '<span class="status-badge connected">Enabled</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditInterfaceModal('${i['.id']}')">Edit</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showEditInterfaceModal(ifId) {
    const interfaces = await api.getInterfaces(this.selectedRouterId);
    const iface = interfaces.find((i) => i['.id'] === ifId);
    if (!iface) { this.toast('Interface not found', 'error'); return; }

    this.openModal('Edit Interface', `
      <form id="edit-interface-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(iface.name || '')}"></div>
        <div class="form-group"><label>Comment</label><input type="text" name="comment" value="${this.escapeHtml(iface.comment || '')}"></div>
        <div class="form-group"><label>MTU</label><input type="text" name="mtu" value="${this.escapeHtml(iface.mtu || '')}"></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${iface.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${iface.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const form = document.getElementById('edit-interface-form');
        const data = {};
        new FormData(form).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateInterface(this.selectedRouterId, ifId, data);
          this.closeModal(); this.toast('Interface updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async loadInterfaceLists(container) {
    const lists = await api.getInterfaceLists(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>Interface Lists</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateInterfaceListModal()">Add List</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Comment</th><th>Built-in</th><th>Dynamic</th><th>Actions</th></tr></thead>
          <tbody>
            ${lists.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No interface lists</td></tr>' : lists.map((l) => `
              <tr>
                <td>${this.escapeHtml(l.name || '-')}</td>
                <td>${this.escapeHtml(l.comment || '-')}</td>
                <td>${l.builtin === 'true' ? 'Yes' : 'No'}</td>
                <td>${l.dynamic === 'true' ? 'Yes' : 'No'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditInterfaceListModal('${l['.id']}')">Edit</button>
                  ${l.builtin !== 'true' ? `<button class="btn btn-sm btn-danger" onclick="App.deleteInterfaceList('${l['.id']}')">Delete</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateInterfaceListModal() {
    this.openModal('Create Interface List', `
      <form id="create-iface-list-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required placeholder="e.g. my-list"></div>
        <div class="form-group"><label>Comment</label><input type="text" name="comment" placeholder="Optional"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-iface-list-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createInterfaceList(this.selectedRouterId, data);
          this.closeModal(); this.toast('Interface list created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditInterfaceListModal(listId) {
    const lists = await api.getInterfaceLists(this.selectedRouterId);
    const list = lists.find((l) => l['.id'] === listId);
    if (!list) { this.toast('Not found', 'error'); return; }
    this.openModal('Edit Interface List', `
      <form id="edit-iface-list-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required value="${this.escapeHtml(list.name || '')}"></div>
        <div class="form-group"><label>Comment</label><input type="text" name="comment" value="${this.escapeHtml(list.comment || '')}"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-iface-list-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateInterfaceList(this.selectedRouterId, listId, data);
          this.closeModal(); this.toast('Interface list updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteInterfaceList(id) {
    if (!confirm('Delete this interface list?')) return;
    try { await api.deleteInterfaceList(this.selectedRouterId, id); this.toast('Deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadEthernetList(container) {
    const eths = await api.getEthernets(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header"><h4>Ethernet</h4></div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Speed</th><th>Duplex</th><th>Auto-Negotiate</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${eths.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No ethernet interfaces</td></tr>' : eths.map((e) => `
              <tr>
                <td>${this.escapeHtml(e.name || '-')}</td>
                <td>${this.escapeHtml(e.speed || '-')}</td>
                <td>${this.escapeHtml(e.duplex || '-')}</td>
                <td>${e['auto-negotiation'] === 'true' ? 'Yes' : 'No'}</td>
                <td>${e.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td><button class="btn btn-sm btn-outline" onclick="App.showEditEthernetModal('${e['.id']}')">Edit</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showEditEthernetModal(ethId) {
    const eths = await api.getEthernets(this.selectedRouterId);
    const eth = eths.find((e) => e['.id'] === ethId);
    if (!eth) { this.toast('Not found', 'error'); return; }
    this.openModal('Edit Ethernet', `
      <form id="edit-eth-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(eth.name || '')}"></div>
        <div class="form-group"><label>Comment</label><input type="text" name="comment" value="${this.escapeHtml(eth.comment || '')}"></div>
        <div class="form-group"><label>MTU</label><input type="text" name="mtu" value="${this.escapeHtml(eth.mtu || '')}"></div>
        <div class="form-group"><label>Auto-Negotiation</label>
          <select name="auto-negotiation" class="form-control">
            <option value="yes" ${eth['auto-negotiation'] !== 'false' ? 'selected' : ''}>Yes</option>
            <option value="no" ${eth['auto-negotiation'] === 'false' ? 'selected' : ''}>No</option>
          </select>
        </div>
        <div class="form-group"><label>Speed</label>
          <select name="speed" class="form-control">
            <option value="">Auto</option>
            <option value="10Mbps" ${eth.speed === '10Mbps' ? 'selected' : ''}>10 Mbps</option>
            <option value="100Mbps" ${eth.speed === '100Mbps' ? 'selected' : ''}>100 Mbps</option>
            <option value="1Gbps" ${eth.speed === '1Gbps' ? 'selected' : ''}>1 Gbps</option>
          </select>
        </div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${eth.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${eth.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-eth-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateEthernet(this.selectedRouterId, ethId, data);
          this.closeModal(); this.toast('Ethernet updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async loadBridgeList(container) {
    const bridges = await api.getBridges(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>Bridge</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateBridgeModal()">Add Bridge</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>MAC Address</th><th>Protocol Mode</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${bridges.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No bridges</td></tr>' : bridges.map((b) => `
              <tr>
                <td>${this.escapeHtml(b.name || '-')}</td>
                <td>${this.escapeHtml(b['admin-mac'] || '-')}</td>
                <td>${this.escapeHtml(b['protocol-mode'] || '-')}</td>
                <td>${this.escapeHtml(b.priority || '-')}</td>
                <td>${b.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditBridgeModal('${b['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteBridge('${b['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateBridgeModal() {
    this.openModal('Create Bridge', `
      <form id="create-bridge-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required placeholder="e.g. bridge1"></div>
        <div class="form-group"><label>Protocol Mode</label>
          <select name="protocol-mode" class="form-control">
            <option value="rstp">RSTP</option>
            <option value="stp">STP</option>
            <option value="none">None</option>
          </select>
        </div>
        <div class="form-group"><label>Priority</label><input type="number" name="priority" value="0x8000"></div>
        <div class="form-group"><label>MTU</label><input type="number" name="mtu" value="1500"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-bridge-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createBridge(this.selectedRouterId, data);
          this.closeModal(); this.toast('Bridge created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditBridgeModal(bridgeId) {
    const bridges = await api.getBridges(this.selectedRouterId);
    const bridge = bridges.find((b) => b['.id'] === bridgeId);
    if (!bridge) { this.toast('Not found', 'error'); return; }
    this.openModal('Edit Bridge', `
      <form id="edit-bridge-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(bridge.name || '')}"></div>
        <div class="form-group"><label>Comment</label><input type="text" name="comment" value="${this.escapeHtml(bridge.comment || '')}"></div>
        <div class="form-group"><label>Protocol Mode</label>
          <select name="protocol-mode" class="form-control">
            <option value="rstp" ${bridge['protocol-mode'] === 'rstp' ? 'selected' : ''}>RSTP</option>
            <option value="stp" ${bridge['protocol-mode'] === 'stp' ? 'selected' : ''}>STP</option>
            <option value="none" ${bridge['protocol-mode'] === 'none' ? 'selected' : ''}>None</option>
          </select>
        </div>
        <div class="form-group"><label>Priority</label><input type="text" name="priority" value="${this.escapeHtml(bridge.priority || '')}"></div>
        <div class="form-group"><label>MTU</label><input type="text" name="mtu" value="${this.escapeHtml(bridge.mtu || '')}"></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${bridge.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${bridge.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-bridge-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateBridge(this.selectedRouterId, bridgeId, data);
          this.closeModal(); this.toast('Bridge updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteBridge(id) {
    if (!confirm('Delete this bridge?')) return;
    try { await api.deleteBridge(this.selectedRouterId, id); this.toast('Bridge deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadVlanList(container) {
    const vlans = await api.getVlans(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>VLAN</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateVlanModal()">Add VLAN</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Type</th><th>MTU</th><th>Actual MTU</th><th>L2 MTU</th><th>VLAN ID</th><th>Interface</th><th>ARP</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${vlans.length === 0 ? '<tr><td colspan="10" style="text-align:center;color:var(--text-muted)">No VLANs</td></tr>' : vlans.map((v) => `
              <tr>
                <td>${this.escapeHtml(v.name || '-')}</td>
                <td>VLAN</td>
                <td>${this.escapeHtml(v.mtu || '-')}</td>
                <td>${this.escapeHtml(v['actual-mtu'] || '-')}</td>
                <td>${this.escapeHtml(v['l2-mtu'] || '-')}</td>
                <td>${this.escapeHtml(v['vlan-id'] || '-')}</td>
                <td>${this.escapeHtml(v.interface || '-')}</td>
                <td>${this.escapeHtml(v.arp || '-')}</td>
                <td>${v.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditVlanModal('${v['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteVlan('${v['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateVlanModal() {
    let interfaces = [];
    try { interfaces = await api.getInterfaces(this.selectedRouterId); } catch (err) {}
    this.openModal('New VLAN Interface', `
      <form id="create-vlan-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required placeholder="e.g. vlan100"></div>
        <div class="form-group"><label>Type</label><input type="text" value="VLAN" readonly class="form-control"></div>
        <div class="form-group"><label>MTU</label><input type="number" name="mtu" value="1500"></div>
        <div class="form-group"><label>L2 MTU</label><input type="number" name="l2-mtu" value="1500"></div>
        <div class="form-group"><label>VRF</label><input type="text" name="vrf-interface" placeholder="main (optional)"></div>
        <div class="form-group"><label>MAC Address</label><input type="text" name="mac-address" placeholder="XX:XX:XX:XX:XX:XX (optional)"></div>
        <div class="form-group"><label>ARP</label>
          <select name="arp" class="form-control">
            <option value="enabled" selected>enabled</option>
            <option value="disabled">disabled</option>
            <option value="request-reply-only">request-reply-only</option>
            <option value="reply-only">reply-only</option>
          </select>
        </div>
        <div class="form-group"><label>ARP Timeout</label><input type="text" name="arp-timeout" value="30s" placeholder="e.g. 30s"></div>
        <div class="form-group"><label>VLAN ID</label><input type="number" name="vlan-id" required min="1" max="4094" placeholder="e.g. 100"></div>
        <div class="form-group"><label>Interface</label>
          <select name="interface" class="form-control" required>
            <option value="">Select...</option>
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}">${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" name="use-service-tag" value="yes"> Use Service Tag</label></div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" name="mvrp" value="yes"> MVRP</label></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'OK', class: 'btn btn-primary', action: async () => {
        const form = document.getElementById('create-vlan-form');
        const fd = new FormData(form);
        const data = {};
        fd.forEach((v, k) => {
          if (v && v.trim()) data[k] = v;
        });
        data['use-service-tag'] = form.querySelector('[name="use-service-tag"]').checked ? 'yes' : 'no';
        data['mvrp'] = form.querySelector('[name="mvrp"]').checked ? 'yes' : 'no';
        if (!data['mac-address']) delete data['mac-address'];
        if (!data['vrf-interface']) delete data['vrf-interface'];
        if (!data['arp-timeout']) delete data['arp-timeout'];
        try {
          await api.createVlan(this.selectedRouterId, data);
          this.closeModal(); this.toast('VLAN created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditVlanModal(vlanId) {
    const vlans = await api.getVlans(this.selectedRouterId);
    const vlan = vlans.find((v) => v['.id'] === vlanId);
    if (!vlan) { this.toast('Not found', 'error'); return; }
    let interfaces = [];
    try { interfaces = await api.getInterfaces(this.selectedRouterId); } catch (err) {}
    const arpOptions = ['enabled', 'disabled', 'request-reply-only', 'reply-only'];
    const currentArp = vlan.arp || 'enabled';
    this.openModal('Edit VLAN Interface', `
      <form id="edit-vlan-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(vlan.name || '')}"></div>
        <div class="form-group"><label>Type</label><input type="text" value="VLAN" readonly class="form-control"></div>
        <div class="form-group"><label>MTU</label><input type="number" name="mtu" value="${this.escapeHtml(vlan.mtu || '1500')}"></div>
        <div class="form-group"><label>Actual MTU</label><input type="text" value="${this.escapeHtml(vlan['actual-mtu'] || '-')}" readonly class="form-control"></div>
        <div class="form-group"><label>L2 MTU</label><input type="number" name="l2-mtu" value="${this.escapeHtml(vlan['l2-mtu'] || '1500')}"></div>
        <div class="form-group"><label>VRF</label><input type="text" name="vrf-interface" value="${this.escapeHtml(vlan['vrf-interface'] || '')}" placeholder="main (optional)"></div>
        <div class="form-group"><label>MAC Address</label><input type="text" name="mac-address" value="${this.escapeHtml(vlan['mac-address'] || '')}" placeholder="XX:XX:XX:XX:XX:XX (optional)"></div>
        <div class="form-group"><label>ARP</label>
          <select name="arp" class="form-control">
            ${arpOptions.map((a) => `<option value="${a}" ${a === currentArp ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>ARP Timeout</label><input type="text" name="arp-timeout" value="${this.escapeHtml(vlan['arp-timeout'] || '30s')}"></div>
        <div class="form-group"><label>VLAN ID</label><input type="number" name="vlan-id" value="${this.escapeHtml(vlan['vlan-id'] || '')}" min="1" max="4094"></div>
        <div class="form-group"><label>Interface</label>
          <select name="interface" class="form-control">
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}" ${i.name === vlan.interface ? 'selected' : ''}>${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" name="use-service-tag" value="yes" ${vlan['use-service-tag'] === 'true' ? 'checked' : ''}> Use Service Tag</label></div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" name="mvrp" value="yes" ${vlan.mvrp === 'true' ? 'checked' : ''}> MVRP</label></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${vlan.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${vlan.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'OK', class: 'btn btn-primary', action: async () => {
        const form = document.getElementById('edit-vlan-form');
        const fd = new FormData(form);
        const data = {};
        fd.forEach((v, k) => {
          if (v && v.trim()) data[k] = v;
        });
        data['use-service-tag'] = form.querySelector('[name="use-service-tag"]').checked ? 'yes' : 'no';
        data['mvrp'] = form.querySelector('[name="mvrp"]').checked ? 'yes' : 'no';
        if (!data['mac-address']) delete data['mac-address'];
        if (!data['vrf-interface']) delete data['vrf-interface'];
        try {
          await api.updateVlan(this.selectedRouterId, vlanId, data);
          this.closeModal(); this.toast('VLAN updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteVlan(id) {
    if (!confirm('Delete this VLAN?')) return;
    try { await api.deleteVlan(this.selectedRouterId, id); this.toast('VLAN deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadEoIPList(container) {
    const eoips = await api.getEoIPs(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>EoIP Tunnels</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateEoIPModal()">Add EoIP</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Remote Peer</th><th>Tunnel ID</th><th>Local Address</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${eoips.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No EoIP tunnels</td></tr>' : eoips.map((e) => `
              <tr>
                <td>${this.escapeHtml(e.name || '-')}</td>
                <td>${this.escapeHtml(e['remote-address'] || '-')}</td>
                <td>${this.escapeHtml(e['tunnel-id'] || '-')}</td>
                <td>${this.escapeHtml(e['local-address'] || '-')}</td>
                <td>${e.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditEoIPModal('${e['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteEoIP('${e['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateEoIPModal() {
    this.openModal('Create EoIP Tunnel', `
      <form id="create-eoip-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required placeholder="e.g. eoip-tunnel1"></div>
        <div class="form-group"><label>Remote Address</label><input type="text" name="remote-address" required placeholder="e.g. 10.0.0.1"></div>
        <div class="form-group"><label>Local Address</label><input type="text" name="local-address" placeholder="0.0.0.0 for any"></div>
        <div class="form-group"><label>Tunnel ID</label><input type="number" name="tunnel-id" required min="0" max="65535" placeholder="e.g. 1"></div>
        <div class="form-group"><label>MTU</label><input type="number" name="mtu" value="1500"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-eoip-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createEoIP(this.selectedRouterId, data);
          this.closeModal(); this.toast('EoIP tunnel created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditEoIPModal(eoipId) {
    const eoips = await api.getEoIPs(this.selectedRouterId);
    const eoip = eoips.find((e) => e['.id'] === eoipId);
    if (!eoip) { this.toast('Not found', 'error'); return; }
    this.openModal('Edit EoIP Tunnel', `
      <form id="edit-eoip-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(eoip.name || '')}"></div>
        <div class="form-group"><label>Remote Address</label><input type="text" name="remote-address" value="${this.escapeHtml(eoip['remote-address'] || '')}"></div>
        <div class="form-group"><label>Local Address</label><input type="text" name="local-address" value="${this.escapeHtml(eoip['local-address'] || '')}"></div>
        <div class="form-group"><label>Tunnel ID</label><input type="number" name="tunnel-id" value="${this.escapeHtml(eoip['tunnel-id'] || '')}"></div>
        <div class="form-group"><label>MTU</label><input type="text" name="mtu" value="${this.escapeHtml(eoip.mtu || '')}"></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${eoip.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${eoip.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-eoip-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateEoIP(this.selectedRouterId, eoipId, data);
          this.closeModal(); this.toast('EoIP updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteEoIP(id) {
    if (!confirm('Delete this EoIP tunnel?')) return;
    try { await api.deleteEoIP(this.selectedRouterId, id); this.toast('EoIP deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadIpTunnelList(container) {
    const tunnels = await api.getIpTunnels(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>IP Tunnels</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateIpTunnelModal()">Add IP Tunnel</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Remote Address</th><th>Local Address</th><th>MTU</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${tunnels.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No IP tunnels</td></tr>' : tunnels.map((t) => `
              <tr>
                <td>${this.escapeHtml(t.name || '-')}</td>
                <td>${this.escapeHtml(t['remote-address'] || '-')}</td>
                <td>${this.escapeHtml(t['local-address'] || '-')}</td>
                <td>${this.escapeHtml(t.mtu || '-')}</td>
                <td>${t.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditIpTunnelModal('${t['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteIpTunnel('${t['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateIpTunnelModal() {
    this.openModal('Create IP Tunnel', `
      <form id="create-ipip-form">
        <div class="form-group"><label>Remote Address</label><input type="text" name="remote-address" required placeholder="e.g. 10.0.0.1"></div>
        <div class="form-group"><label>Local Address</label><input type="text" name="local-address" placeholder="0.0.0.0 for any"></div>
        <div class="form-group"><label>Comment</label><input type="text" name="comment" placeholder="Optional"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-ipip-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createIpTunnel(this.selectedRouterId, data);
          this.closeModal(); this.toast('IP tunnel created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditIpTunnelModal(tunnelId) {
    const tunnels = await api.getIpTunnels(this.selectedRouterId);
    const tunnel = tunnels.find((t) => t['.id'] === tunnelId);
    if (!tunnel) { this.toast('Not found', 'error'); return; }
    this.openModal('Edit IP Tunnel', `
      <form id="edit-ipip-form">
        <div class="form-group"><label>Remote Address</label><input type="text" name="remote-address" value="${this.escapeHtml(tunnel['remote-address'] || '')}"></div>
        <div class="form-group"><label>Local Address</label><input type="text" name="local-address" value="${this.escapeHtml(tunnel['local-address'] || '')}"></div>
        <div class="form-group"><label>Comment</label><input type="text" name="comment" value="${this.escapeHtml(tunnel.comment || '')}"></div>
        <div class="form-group"><label>MTU</label><input type="text" name="mtu" value="${this.escapeHtml(tunnel.mtu || '')}"></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${tunnel.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${tunnel.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-ipip-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateIpTunnel(this.selectedRouterId, tunnelId, data);
          this.closeModal(); this.toast('IP tunnel updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteIpTunnel(id) {
    if (!confirm('Delete this IP tunnel?')) return;
    try { await api.deleteIpTunnel(this.selectedRouterId, id); this.toast('IP tunnel deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadGREList(container) {
    const gres = await api.getGREs(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>GRE Tunnels</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateGREModal()">Add GRE</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Remote Address</th><th>Local Address</th><th>MTU</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${gres.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No GRE tunnels</td></tr>' : gres.map((g) => `
              <tr>
                <td>${this.escapeHtml(g.name || '-')}</td>
                <td>${this.escapeHtml(g['remote-address'] || '-')}</td>
                <td>${this.escapeHtml(g['local-address'] || '-')}</td>
                <td>${this.escapeHtml(g.mtu || '-')}</td>
                <td>${g.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditGREModal('${g['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteGRE('${g['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateGREModal() {
    this.openModal('Create GRE Tunnel', `
      <form id="create-gre-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required placeholder="e.g. gre-tunnel1"></div>
        <div class="form-group"><label>Remote Address</label><input type="text" name="remote-address" required placeholder="e.g. 10.0.0.1"></div>
        <div class="form-group"><label>Local Address</label><input type="text" name="local-address" placeholder="0.0.0.0 for any"></div>
        <div class="form-group"><label>MTU</label><input type="number" name="mtu" value="1500"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-gre-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createGRE(this.selectedRouterId, data);
          this.closeModal(); this.toast('GRE tunnel created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditGREModal(greId) {
    const gres = await api.getGREs(this.selectedRouterId);
    const gre = gres.find((g) => g['.id'] === greId);
    if (!gre) { this.toast('Not found', 'error'); return; }
    this.openModal('Edit GRE Tunnel', `
      <form id="edit-gre-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(gre.name || '')}"></div>
        <div class="form-group"><label>Remote Address</label><input type="text" name="remote-address" value="${this.escapeHtml(gre['remote-address'] || '')}"></div>
        <div class="form-group"><label>Local Address</label><input type="text" name="local-address" value="${this.escapeHtml(gre['local-address'] || '')}"></div>
        <div class="form-group"><label>MTU</label><input type="text" name="mtu" value="${this.escapeHtml(gre.mtu || '')}"></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${gre.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${gre.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-gre-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateGRE(this.selectedRouterId, greId, data);
          this.closeModal(); this.toast('GRE updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteGRE(id) {
    if (!confirm('Delete this GRE tunnel?')) return;
    try { await api.deleteGRE(this.selectedRouterId, id); this.toast('GRE deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadVRRPList(container) {
    const vrrps = await api.getVRRPs(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>VRRP</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateVRRPModal()">Add VRRP</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Interface</th><th>VRID</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${vrrps.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No VRRP entries</td></tr>' : vrrps.map((v) => `
              <tr>
                <td>${this.escapeHtml(v.name || '-')}</td>
                <td>${this.escapeHtml(v.interface || '-')}</td>
                <td>${this.escapeHtml(v['vrid'] || '-')}</td>
                <td>${this.escapeHtml(v.priority || '-')}</td>
                <td>${v.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditVRRPModal('${v['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteVRRP('${v['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateVRRPModal() {
    let interfaces = [];
    try { interfaces = await api.getInterfaces(this.selectedRouterId); } catch (err) {}
    this.openModal('Create VRRP', `
      <form id="create-vrrp-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required placeholder="e.g. vrrp1"></div>
        <div class="form-group"><label>Interface</label>
          <select name="interface" class="form-control" required>
            <option value="">Select...</option>
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}">${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>VRID</label><input type="number" name="vrid" required min="1" max="255" placeholder="e.g. 1"></div>
        <div class="form-group"><label>Priority</label><input type="number" name="priority" value="100" min="1" max="255"></div>
        <div class="form-group"><label>Password</label><input type="text" name="password" placeholder="Optional"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-vrrp-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createVRRP(this.selectedRouterId, data);
          this.closeModal(); this.toast('VRRP created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditVRRPModal(vrrpId) {
    const vrrps = await api.getVRRPs(this.selectedRouterId);
    const vrrp = vrrps.find((v) => v['.id'] === vrrpId);
    if (!vrrp) { this.toast('Not found', 'error'); return; }
    let interfaces = [];
    try { interfaces = await api.getInterfaces(this.selectedRouterId); } catch (err) {}
    this.openModal('Edit VRRP', `
      <form id="edit-vrrp-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(vrrp.name || '')}"></div>
        <div class="form-group"><label>Interface</label>
          <select name="interface" class="form-control">
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}" ${i.name === vrrp.interface ? 'selected' : ''}>${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>VRID</label><input type="number" name="vrid" value="${this.escapeHtml(vrrp['vrid'] || '')}" min="1" max="255"></div>
        <div class="form-group"><label>Priority</label><input type="number" name="priority" value="${this.escapeHtml(vrrp.priority || '100')}" min="1" max="255"></div>
        <div class="form-group"><label>Password</label><input type="text" name="password" value="${this.escapeHtml(vrrp.password || '')}"></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${vrrp.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${vrrp.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-vrrp-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateVRRP(this.selectedRouterId, vrrpId, data);
          this.closeModal(); this.toast('VRRP updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteVRRP(id) {
    if (!confirm('Delete this VRRP entry?')) return;
    try { await api.deleteVRRP(this.selectedRouterId, id); this.toast('VRRP deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadBondingList(container) {
    const bondings = await api.getBondings(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>Bonding</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateBondingModal()">Add Bonding</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Mode</th><th>Slaves</th><th>MTU</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${bondings.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No bonding interfaces</td></tr>' : bondings.map((b) => `
              <tr>
                <td>${this.escapeHtml(b.name || '-')}</td>
                <td>${this.escapeHtml(b.mode || '-')}</td>
                <td>${this.escapeHtml(b.slaves || '-')}</td>
                <td>${this.escapeHtml(b.mtu || '-')}</td>
                <td>${b.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditBondingModal('${b['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteBonding('${b['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateBondingModal() {
    let interfaces = [];
    try { interfaces = await api.getInterfaces(this.selectedRouterId); } catch (err) {}
    const ethInterfaces = interfaces.filter((i) => i.type === 'ether' || i['type'] === 'ether');
    this.openModal('Create Bonding', `
      <form id="create-bonding-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" required placeholder="e.g. bond1"></div>
        <div class="form-group"><label>Slaves</label><input type="text" name="slaves" required placeholder="e.g. ether1,ether2"></div>
        <div class="form-group"><label>Mode</label>
          <select name="mode" class="form-control">
            <option value="balance-rr">Balance RR</option>
            <option value="active-backup">Active Backup</option>
            <option value="balance-xor">Balance XOR</option>
            <option value="broadcast">Broadcast</option>
            <option value="802.3ad">802.3ad</option>
            <option value="balance-tlb">Balance TLB</option>
            <option value="balance-alb">Balance ALB</option>
          </select>
        </div>
        <div class="form-group"><label>MTU</label><input type="number" name="mtu" value="1500"></div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-bonding-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createBonding(this.selectedRouterId, data);
          this.closeModal(); this.toast('Bonding created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditBondingModal(bondId) {
    const bondings = await api.getBondings(this.selectedRouterId);
    const bonding = bondings.find((b) => b['.id'] === bondId);
    if (!bonding) { this.toast('Not found', 'error'); return; }
    this.openModal('Edit Bonding', `
      <form id="edit-bonding-form">
        <div class="form-group"><label>Name</label><input type="text" name="name" value="${this.escapeHtml(bonding.name || '')}"></div>
        <div class="form-group"><label>Slaves</label><input type="text" name="slaves" value="${this.escapeHtml(bonding.slaves || '')}"></div>
        <div class="form-group"><label>Mode</label>
          <select name="mode" class="form-control">
            ${['balance-rr','active-backup','balance-xor','broadcast','802.3ad','balance-tlb','balance-alb'].map((m) => `<option value="${m}" ${bonding.mode === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>MTU</label><input type="text" name="mtu" value="${this.escapeHtml(bonding.mtu || '')}"></div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${bonding.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${bonding.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-bonding-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateBonding(this.selectedRouterId, bondId, data);
          this.closeModal(); this.toast('Bonding updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteBonding(id) {
    if (!confirm('Delete this bonding interface?')) return;
    try { await api.deleteBonding(this.selectedRouterId, id); this.toast('Bonding deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async loadMACsecList(container) {
    const macsecs = await api.getMACsecs(this.selectedRouterId);
    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h4>MACsec</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showCreateMACsecModal()">Add MACsec</button>
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Interface</th><th>Encrypt</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${macsecs.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No MACsec interfaces</td></tr>' : macsecs.map((m) => `
              <tr>
                <td>${this.escapeHtml(m.name || '-')}</td>
                <td>${this.escapeHtml(m.interface || '-')}</td>
                <td>${m.encrypt === 'true' ? 'Yes' : 'No'}</td>
                <td>${m.running === 'true' ? '<span class="status-badge connected">Running</span>' : '<span class="status-badge disconnected">Not running</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditMACsecModal('${m['.id']}')">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteMACsec('${m['.id']}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  async showCreateMACsecModal() {
    let interfaces = [];
    try { interfaces = await api.getInterfaces(this.selectedRouterId); } catch (err) {}
    this.openModal('Create MACsec', `
      <form id="create-macsec-form">
        <div class="form-group"><label>Interface</label>
          <select name="interface" class="form-control" required>
            <option value="">Select...</option>
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}">${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Encrypt</label>
          <select name="encrypt" class="form-control">
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('create-macsec-form')).forEach((v, k) => { if (v) data[k] = v; });
        try {
          await api.createMACsec(this.selectedRouterId, data);
          this.closeModal(); this.toast('MACsec created', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async showEditMACsecModal(macsecId) {
    const macsecs = await api.getMACsecs(this.selectedRouterId);
    const macsec = macsecs.find((m) => m['.id'] === macsecId);
    if (!macsec) { this.toast('Not found', 'error'); return; }
    let interfaces = [];
    try { interfaces = await api.getInterfaces(this.selectedRouterId); } catch (err) {}
    this.openModal('Edit MACsec', `
      <form id="edit-macsec-form">
        <div class="form-group"><label>Interface</label>
          <select name="interface" class="form-control">
            ${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}" ${i.name === macsec.interface ? 'selected' : ''}>${this.escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Encrypt</label>
          <select name="encrypt" class="form-control">
            <option value="yes" ${macsec.encrypt === 'true' ? 'selected' : ''}>Yes</option>
            <option value="no" ${macsec.encrypt !== 'true' ? 'selected' : ''}>No</option>
          </select>
        </div>
        <div class="form-group"><label>Disabled</label>
          <select name="disabled" class="form-control">
            <option value="no" ${macsec.disabled !== 'true' ? 'selected' : ''}>No</option>
            <option value="yes" ${macsec.disabled === 'true' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const data = {};
        new FormData(document.getElementById('edit-macsec-form')).forEach((v, k) => { data[k] = v; });
        try {
          await api.updateMACsec(this.selectedRouterId, macsecId, data);
          this.closeModal(); this.toast('MACsec updated', 'success'); this.loadInterfacesTab();
        } catch (err) { this.toast(err.message, 'error'); }
      }},
    ]);
  },

  async deleteMACsec(id) {
    if (!confirm('Delete this MACsec interface?')) return;
    try { await api.deleteMACsec(this.selectedRouterId, id); this.toast('MACsec deleted', 'success'); this.loadInterfacesTab(); }
    catch (err) { this.toast(err.message, 'error'); }
  },

  async renderVouchers() {
    const content = document.getElementById('page-content');
    const routers = await api.getRouters();

    if (routers.length === 0) {
      content.innerHTML = '<div class="empty-state"><h3>No routers configured</h3></div>';
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
      const vouchers = data.vouchers || [];
      const routerUsers = data.routerUsers || [];

      let html = '';

      html += `
        <div style="margin-bottom:1.5rem">
          <h4 style="margin-bottom:0.75rem;font-size:0.95rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Local Vouchers (${data.total || vouchers.length})</h4>
      `;

      if (vouchers.length === 0) {
        html += '<div class="empty-state"><p>No vouchers generated yet.</p></div>';
      } else {
        html += `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Username</th>
                  <th>Profile</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${vouchers.map((v) => {
                  const dur = v.duration_minutes ? `${Math.floor(v.duration_minutes / 60)}h ${v.duration_minutes % 60}m` : 'Unlimited';
                  return `
                  <tr>
                    <td><strong>${this.escapeHtml(v.code)}</strong></td>
                    <td>${this.escapeHtml(v.username)}</td>
                    <td>${this.escapeHtml(v.profile)}</td>
                    <td>${dur}</td>
                    <td>${v.is_used ? '<span class="status-badge disconnected">Used</span>' : '<span class="status-badge connected">Available</span>'}</td>
                    <td>${new Date(v.created_at).toLocaleDateString()}</td>
                    <td>
                      <button class="btn btn-sm btn-danger" onclick="App.deleteVoucher(${v.id})">Delete</button>
                    </td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      html += `</div>`;

      html += `
        <div>
          <h4 style="margin-bottom:0.75rem;font-size:0.95rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Router Hotspot Users (${routerUsers.length})</h4>
      `;

      if (routerUsers.length === 0) {
        html += '<div class="empty-state"><p>No hotspot users found on router.</p></div>';
      } else {
        html += `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Profile</th>
                  <th>Uptime Limit</th>
                  <th>Bytes In/Out</th>
                  <th>Comment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${routerUsers.map((u) => `
                  <tr>
                    <td><strong>${this.escapeHtml(u.name || '')}</strong></td>
                    <td>${this.escapeHtml(u.profile || '')}</td>
                    <td>${this.escapeHtml(u['limit-uptime'] || 'Unlimited')}</td>
                    <td>${u['bytes-in-quota'] || 0} / ${u['bytes-out-quota'] || 0}</td>
                    <td>${this.escapeHtml(u.comment || '')}</td>
                    <td>${u.disabled === 'true' ? '<span class="status-badge disconnected">Disabled</span>' : '<span class="status-badge connected">Active</span>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      html += `</div>`;

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  async showGenerateVouchersModal() {
    let profileOptions = '<option value="default">default</option>';
    let profileError = null;

    try {
      const profiles = await api.getHotspotProfiles(this.selectedRouterId);
      if (profiles && profiles.length > 0) {
        profileOptions = profiles.map(p =>
          `<option value="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</option>`
        ).join('');
      }
    } catch (err) {
      profileError = err.message;
    }

    this.openModal('Generate Vouchers', `
      <form id="generate-vouchers-form">
        <div class="form-group">
          <label>Number of Vouchers</label>
          <input type="number" name="count" value="10" min="1" max="100">
        </div>
        <div class="form-group">
          <label>Code Length</label>
          <input type="number" name="codeLength" value="8" min="4" max="20">
        </div>
        <div class="form-group">
          <label>Profile</label>
          <select name="profile" class="form-control">
            ${profileOptions}
          </select>
          ${profileError ? `<small style="color: var(--danger); display: block; margin-top: 0.25rem;">Warning: Could not fetch profiles (${profileError}). Using default.</small>` : ''}
        </div>
        <div class="form-group">
          <label>Duration (optional)</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <div style="flex:1">
              <input type="number" name="durationDays" placeholder="Days" min="0" class="form-control">
              <small style="color:var(--text-muted)">Days</small>
            </div>
            <div style="flex:1">
              <input type="number" name="durationHours" placeholder="Hours" min="0" max="23" class="form-control">
              <small style="color:var(--text-muted)">Hours</small>
            </div>
            <div style="flex:1">
              <input type="number" name="durationMins" placeholder="Minutes" min="0" max="59" class="form-control">
              <small style="color:var(--text-muted)">Minutes</small>
            </div>
          </div>
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
      const days = parseInt(form.durationDays.value) || 0;
      const hours = parseInt(form.durationHours.value) || 0;
      const mins = parseInt(form.durationMins.value) || 0;
      const totalMinutes = days * 24 * 60 + hours * 60 + mins;

      const result = await api.generateVouchers(this.selectedRouterId, {
        count: parseInt(form.count.value),
        profile: form.profile.value,
        durationMinutes: totalMinutes > 0 ? totalMinutes : null,
        dataLimitMb: form.dataLimitMb.value ? parseInt(form.dataLimitMb.value) : null,
        prefix: form.prefix.value || undefined,
        codeLength: parseInt(form.codeLength.value) || 8,
      });

      this.closeModal();

      let message = `Generated ${result.vouchers?.length || 0} voucher(s)`;
      if (result.mikrotik) {
        if (result.mikrotik.connected) {
          message += ` | MikroTik: ${result.mikrotik.success} added`;
          if (result.mikrotik.failed > 0) {
            message += `, ${result.mikrotik.failed} failed`;
          }
        } else {
          message += ' | MikroTik: Not connected';
        }
      }

      this.toast(message, 'success');
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
                <button class="btn btn-sm btn-outline" id="portal-upload-btn" onclick="App.uploadPortalFile()">Upload to Router</button>
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
        const uploadBtn = document.getElementById('portal-upload-btn');
        if (uploadBtn) uploadBtn.style.display = '';
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
    const uploadBtn = document.getElementById('portal-upload-btn');
    if (!editor) return;

    const isEditable = !document.querySelector(`.portal-file-item[data-path="${filePath}"]`)?.classList.contains('binary');
    const isHtml = filePath.endsWith('.html');
    const hasRouter = !!this.selectedRouterId;

    editor.disabled = !isEditable;
    saveBtn.style.display = isEditable ? '' : 'none';
    resetBtn.style.display = isEditable ? '' : 'none';
    toggleBtn.style.display = isHtml ? '' : 'none';
    uploadBtn.style.display = hasRouter ? '' : 'none';

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

  async updatePortalPreview() {
    const preview = document.getElementById('portal-preview');
    if (!preview || !this.portalCurrentFile) return;
    try {
      const res = await api.getPortalFile(this.portalCurrentFile);
      let html = res.content;
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
    } catch (err) {
      preview.srcdoc = '<p style="color:#999;text-align:center;margin-top:2rem">Preview unavailable</p>';
    }
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

  async uploadPortalFile() {
    const routerId = this.selectedRouterId;
    if (!routerId) {
      this.toast('Select a router first', 'error');
      return;
    }
    if (this.portalDirty && !confirm('You have unsaved changes. Upload will use the last saved version. Continue?')) return;
    try {
      const res = await api.pushPortalFile(routerId, this.portalCurrentFile);
      this.toast(res.message || `${this.portalCurrentFile} uploaded to router`, 'success');
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

  async renderSubVendo() {
    const content = document.getElementById('page-content');
    const routers = (await api.getRouters()).filter((r) => r.connected);

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>SubVendo</h3>
        </div>
        <div class="tab-bar">
          <button class="tab-btn active" data-subtab="config" onclick="App.switchSubVendoTab('config')">Configuration</button>
          <button class="tab-btn" data-subtab="devices" onclick="App.switchSubVendoTab('devices')">Sub-Vendo Devices</button>
        </div>
        <div id="subvendo-tab-content"></div>
      </div>
    `;

    this._subvendoTab = 'config';
    await this.loadSubVendoTab();
  },

  async switchSubVendoTab(tab) {
    this._subvendoTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === tab);
    });
    await this.loadSubVendoTab();
  },

  async loadSubVendoTab() {
    const container = document.getElementById('subvendo-tab-content');
    if (this._subvendoTab === 'config') {
      await this.renderSubVendoConfig(container);
    } else {
      await this.renderNodeMcu(container);
    }
  },

  async renderSubVendoConfig(container) {
    const routers = (await api.getRouters()).filter((r) => r.connected);

    container.innerHTML = `
      <div class="subvendo-form">
        <div class="subvendo-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h4 style="margin:0">Router Selection</h4>
            ${routers.length > 0 ? `
              <div style="display:flex;gap:0.5rem;align-items:center">
                <select id="subvendo-router-select" class="btn btn-outline">
                  ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
                </select>
                <button class="btn btn-primary btn-sm" onclick="App.saveAndPushSubVendo()">Save & Push</button>
              </div>
            ` : '<span class="status-badge disconnected">No connected routers</span>'}
          </div>
        </div>

        <div class="subvendo-section">
          <h4>Multi-Vendo Setup</h4>
          <div class="form-row">
            <label class="checkbox-label">
              <input type="checkbox" id="subvendo-isMultiVendo">
              <span>Enable Multi-Vendo</span>
            </label>
          </div>
          <div class="form-row">
            <label>Multi-Vendo Mode:</label>
            <select id="subvendo-multiVendoOption" class="form-control">
              <option value="0">Traditional (client chooses vendo)</option>
              <option value="1">Auto-select by hotspot address</option>
              <option value="2">Interface name</option>
            </select>
          </div>
        </div>

        <div class="subvendo-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h4 style="margin:0">Vendo Entries</h4>
            <button class="btn btn-sm btn-primary" onclick="App.addVendoEntry()">Add Vendo</button>
          </div>
          <div id="subvendo-vendo-list"></div>
        </div>

        <div class="subvendo-section">
          <h4>Login & General</h4>
          <div class="form-row">
            <label>Login Mode:</label>
            <select id="subvendo-loginOption" class="form-control">
              <option value="0">Username only</option>
              <option value="1">Username + Password</option>
            </select>
          </div>
          <div class="form-row">
            <label class="checkbox-label">
              <input type="checkbox" id="subvendo-dataRateOption">
              <span>Enable Data Rates</span>
            </label>
          </div>
          <div class="form-row">
            <label>Default Vendor IP:</label>
            <input type="text" id="subvendo-vendorIpAddress" class="form-control" placeholder="10.1.0.41">
          </div>
        </div>

        <div class="subvendo-section">
          <h4>Feature Flags</h4>
          <div class="toggle-group">
            <label class="checkbox-label"><input type="checkbox" id="subvendo-chargingEnable"><span>Charging Station</span></label>
            <label class="checkbox-label"><input type="checkbox" id="subvendo-eloadEnable"><span>E-Load</span></label>
            <label class="checkbox-label"><input type="checkbox" id="subvendo-showPauseTime"><span>Show Pause/Logout</span></label>
            <label class="checkbox-label"><input type="checkbox" id="subvendo-showMemberLogin"><span>Member Login</span></label>
            <label class="checkbox-label"><input type="checkbox" id="subvendo-showExtendTimeButton"><span>Extend Time Button</span></label>
            <label class="checkbox-label"><input type="checkbox" id="subvendo-disableVoucherInput"><span>Disable Voucher Input</span></label>
            <label class="checkbox-label"><input type="checkbox" id="subvendo-macAsVoucherCode"><span>MAC as Voucher Code</span></label>
            <label class="checkbox-label"><input type="checkbox" id="subvendo-qrCodeVoucherPurchase"><span>QR Code Voucher Purchase</span></label>
          </div>
        </div>

        <div class="subvendo-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h4 style="margin:0">Preview (config.js)</h4>
            <button class="btn btn-sm btn-outline" onclick="App.updateSubVendoPreview()">Refresh Preview</button>
          </div>
          <textarea id="subvendo-preview" class="subvendo-preview" readonly></textarea>
        </div>

        <div class="subvendo-actions">
          <button class="btn btn-outline" onclick="App.updateSubVendoPreview()">Preview</button>
          <button class="btn btn-primary" onclick="App.saveSubVendo()">Save</button>
        </div>
      </div>
    `;

    if (routers.length > 0) {
      if (!this.selectedRouterId || !routers.find((r) => r.id === this.selectedRouterId)) {
        this.selectedRouterId = routers[0].id;
        document.getElementById('subvendo-router-select').value = this.selectedRouterId;
      }
      document.getElementById('subvendo-router-select').addEventListener('change', (e) => {
        this.selectedRouterId = parseInt(e.target.value);
      });
    }

    try {
      const config = await api.getSubVendoConfig();
      this.populateSubVendoForm(config);
    } catch (err) {
      this.toast('Failed to load config: ' + err.message, 'error');
    }

    this.updateSubVendoPreview();

    document.querySelector('.subvendo-form').addEventListener('change', () => {
      this.updateSubVendoPreview();
    });
    document.querySelector('.subvendo-form').addEventListener('input', () => {
      this.updateSubVendoPreview();
    });
  },

  populateSubVendoForm(config) {
    document.getElementById('subvendo-isMultiVendo').checked = config.isMultiVendo;
    document.getElementById('subvendo-multiVendoOption').value = config.multiVendoOption;
    document.getElementById('subvendo-loginOption').value = config.loginOption;
    document.getElementById('subvendo-dataRateOption').checked = config.dataRateOption;
    document.getElementById('subvendo-vendorIpAddress').value = config.vendorIpAddress;
    document.getElementById('subvendo-chargingEnable').checked = config.chargingEnable;
    document.getElementById('subvendo-eloadEnable').checked = config.eloadEnable;
    document.getElementById('subvendo-showPauseTime').checked = config.showPauseTime;
    document.getElementById('subvendo-showMemberLogin').checked = config.showMemberLogin;
    document.getElementById('subvendo-showExtendTimeButton').checked = config.showExtendTimeButton;
    document.getElementById('subvendo-disableVoucherInput').checked = config.disableVoucherInput;
    document.getElementById('subvendo-macAsVoucherCode').checked = config.macAsVoucherCode;
    document.getElementById('subvendo-qrCodeVoucherPurchase').checked = config.qrCodeVoucherPurchase;

    const vendoList = document.getElementById('subvendo-vendo-list');
    vendoList.innerHTML = '';
    (config.multiVendoAddresses || []).forEach((v) => this.addVendoEntry(v));
  },

  addVendoEntry(data = null) {
    const vendoList = document.getElementById('subvendo-vendo-list');
    const entry = document.createElement('div');
    entry.className = 'vendo-entry';
    entry.innerHTML = `
      <button class="vendo-remove" onclick="this.parentElement.remove(); document.querySelector('.subvendo-form').dispatchEvent(new Event('change'))">&times;</button>
      <div class="vendo-entry-grid">
        <div class="form-row">
          <label>Vendo Name:</label>
          <input type="text" class="vendo-name form-control" value="${data ? this.escapeHtml(data.vendoName) : ''}" placeholder="Vendo 1">
        </div>
        <div class="form-row">
          <label>Vendo IP:</label>
          <input type="text" class="vendo-ip form-control" value="${data ? this.escapeHtml(data.vendoIp) : ''}" placeholder="10.1.0.41">
        </div>
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" class="vendo-charging" ${data && data.chargingEnable ? 'checked' : ''}>
            <span>Charging</span>
          </label>
        </div>
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" class="vendo-eload" ${data && data.eloadEnable ? 'checked' : ''}>
            <span>E-Load</span>
          </label>
        </div>
        <div class="form-row vendo-hotspot-row" style="display:none">
          <label>Hotspot Address:</label>
          <input type="text" class="vendo-hotspot form-control" value="${data && data.hotspotAddress ? this.escapeHtml(data.hotspotAddress) : ''}">
        </div>
        <div class="form-row vendo-interface-row" style="display:none">
          <label>Interface Name:</label>
          <input type="text" class="vendo-interface form-control" value="${data && data.interfaceName ? this.escapeHtml(data.interfaceName) : ''}">
        </div>
      </div>
    `;
    vendoList.appendChild(entry);
  },

  collectSubVendoData() {
    const multiVendoOption = parseInt(document.getElementById('subvendo-multiVendoOption').value);
    const vendoEntries = [];
    document.querySelectorAll('.vendo-entry').forEach((entry) => {
      const vendo = {
        vendoName: entry.querySelector('.vendo-name').value,
        vendoIp: entry.querySelector('.vendo-ip').value,
        chargingEnable: entry.querySelector('.vendo-charging').checked,
        eloadEnable: entry.querySelector('.vendo-eload').checked,
      };
      if (multiVendoOption === 1) {
        vendo.hotspotAddress = entry.querySelector('.vendo-hotspot').value;
      }
      if (multiVendoOption === 2) {
        vendo.interfaceName = entry.querySelector('.vendo-interface').value;
      }
      vendoEntries.push(vendo);
    });

    return {
      isMultiVendo: document.getElementById('subvendo-isMultiVendo').checked,
      multiVendoOption,
      multiVendoAddresses: vendoEntries,
      loginOption: parseInt(document.getElementById('subvendo-loginOption').value),
      dataRateOption: document.getElementById('subvendo-dataRateOption').checked,
      vendorIpAddress: document.getElementById('subvendo-vendorIpAddress').value,
      chargingEnable: document.getElementById('subvendo-chargingEnable').checked,
      eloadEnable: document.getElementById('subvendo-eloadEnable').checked,
      showPauseTime: document.getElementById('subvendo-showPauseTime').checked,
      showMemberLogin: document.getElementById('subvendo-showMemberLogin').checked,
      showExtendTimeButton: document.getElementById('subvendo-showExtendTimeButton').checked,
      disableVoucherInput: document.getElementById('subvendo-disableVoucherInput').checked,
      macAsVoucherCode: document.getElementById('subvendo-macAsVoucherCode').checked,
      qrCodeVoucherPurchase: document.getElementById('subvendo-qrCodeVoucherPurchase').checked,
    };
  },

  generateConfigJsPreview(config) {
    const vendoEntries = config.multiVendoAddresses.map((v) => {
      let entry = `\t{
\t\tvendoName: "${v.vendoName}",
\t\tvendoIp: "${v.vendoIp}",
\t\tchargingEnable: ${v.chargingEnable},
\t\teloadEnable: ${v.eloadEnable}`;
      if (v.hotspotAddress) {
        entry += `,
\t\thotspotAddress: "${v.hotspotAddress}"`;
      }
      if (v.interfaceName) {
        entry += `,
\t\tinterfaceName: "${v.interfaceName}"`;
      }
      entry += '\n\t}';
      return entry;
    });

    return `//this is to enable multi vendo setup, set to true when multi vendo is supported
var isMultiVendo = ${config.isMultiVendo};
// 0 = traditional (client choose a vendo) , 1 = auto select vendo base on hotspot address, 2 = interface name ( this will preserve one hotspot server ip only)
var multiVendoOption = ${config.multiVendoOption};

//list here all node mcu address for multi vendo setup
var multiVendoAddresses = [
${vendoEntries.join(',\n')}
];


//0 means its login by username only, 1 = means if login by username + password
var loginOption = ${config.loginOption}; //replace 1 if you want login voucher by username + password

var dataRateOption = ${config.dataRateOption}; //replace true if you enable data rates
//put here the default selected address
var vendorIpAddress = "${config.vendorIpAddress}";

var chargingEnable = ${config.chargingEnable}; //replace true if you enable charging, this can be override if multivendo setup

var eloadEnable = ${config.eloadEnable}; //replace true if you enable eload, this can be override if multivendo setup

//hide pause time / logout true = you want to show pause / logout button
var showPauseTime = ${config.showPauseTime};

//enable member login, true = if you want to enable member login
var showMemberLogin = ${config.showMemberLogin};

//enable extend time button for customers
var showExtendTimeButton = ${config.showExtendTimeButton};

//disable voucher input
var disableVoucherInput = ${config.disableVoucherInput};

//enable mac address as voucher code
var macAsVoucherCode = ${config.macAsVoucherCode};

var qrCodeVoucherPurchase = ${config.qrCodeVoucherPurchase};
`;
  },

  updateSubVendoPreview() {
    const config = this.collectSubVendoData();
    const preview = document.getElementById('subvendo-preview');
    if (preview) {
      preview.value = this.generateConfigJsPreview(config);
    }
  },

  async saveSubVendo() {
    try {
      const config = this.collectSubVendoData();
      await api.saveSubVendoConfig(config);
      this.updateSubVendoPreview();
      this.toast('SubVendo config saved', 'success');
    } catch (err) {
      this.toast('Failed to save: ' + err.message, 'error');
    }
  },

  async saveAndPushSubVendo() {
    const routerId = this.selectedRouterId;
    if (!routerId) {
      this.toast('Select a router first', 'error');
      return;
    }

    try {
      const config = this.collectSubVendoData();
      await api.saveSubVendoConfig(config);
      await api.pushSubVendoConfig(routerId);
      this.updateSubVendoPreview();
      this.toast('Config saved and pushed to router', 'success');
    } catch (err) {
      this.toast('Failed: ' + err.message, 'error');
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

  _nodemcuRefreshInterval: null,
  _nodemcuSelectedId: null,
  _nodemcuTab: 'dashboard',

  async renderNodeMcu(container) {
    const data = await api.nodemcuListDevices();
    const devices = data.devices || [];
    this._nodemcuDevices = devices;

    if (devices.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No Sub-Vendo Devices configured</h3>
          <p>Add a JuanFI NodeMCU vending machine to manage it from this panel.</p>
          <button class="btn btn-primary" onclick="App.showAddNodeMcuDevice()">Add Device</button>
        </div>
      `;
      return;
    }

    if (!this._nodemcuSelectedId || !devices.find(d => d.id === this._nodemcuSelectedId)) {
      this._nodemcuSelectedId = devices[0].id;
    }

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Sub-Vendo Devices</h3>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <select id="nodemcu-device-select" class="btn btn-outline" onchange="App.selectNodeMcuDevice(this.value)">
              ${devices.map(d => `<option value="${d.id}" ${d.id === this._nodemcuSelectedId ? 'selected' : ''}>${this.escapeHtml(d.name)} (${this.escapeHtml(d.ip)})</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-primary" onclick="App.showAddNodeMcuDevice()">Add Device</button>
            <button class="btn btn-sm btn-outline" onclick="App.showEditNodeMcuDevice()">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="App.deleteNodeMcuDevice()">Delete</button>
          </div>
        </div>
        <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1rem">
          <button class="btn btn-sm ${this._nodemcuTab === 'dashboard' ? 'btn-primary' : 'btn-outline'}" onclick="App.switchNodeMcuTab('dashboard')">Dashboard</button>
          <button class="btn btn-sm ${this._nodemcuTab === 'config' ? 'btn-primary' : 'btn-outline'}" onclick="App.switchNodeMcuTab('config')">Configuration</button>
          <button class="btn btn-sm ${this._nodemcuTab === 'rates' ? 'btn-primary' : 'btn-outline'}" onclick="App.switchNodeMcuTab('rates')">Rates</button>
          <button class="btn btn-sm ${this._nodemcuTab === 'control' ? 'btn-primary' : 'btn-outline'}" onclick="App.switchNodeMcuTab('control')">Controls</button>
        </div>
        <div id="nodemcu-tab-content"><div class="empty-state"><p>Loading...</p></div></div>
      </div>
    `;

    this.loadNodeMcuTab();
  },

  switchNodeMcuTab(tab) {
    this._nodemcuTab = tab;
    if (this._nodemcuRefreshInterval) {
      clearInterval(this._nodemcuRefreshInterval);
      this._nodemcuRefreshInterval = null;
    }
    const container = document.getElementById('subvendo-tab-content');
    if (container) {
      this.renderNodeMcu(container);
    }
  },

  selectNodeMcuDevice(id) {
    this._nodemcuSelectedId = parseInt(id);
    if (this._nodemcuRefreshInterval) {
      clearInterval(this._nodemcuRefreshInterval);
      this._nodemcuRefreshInterval = null;
    }
    this.loadNodeMcuTab();
  },

  async loadNodeMcuTab() {
    const container = document.getElementById('nodemcu-tab-content');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';

    try {
      switch (this._nodemcuTab) {
        case 'dashboard': await this.loadNodeMcuDashboard(container); break;
        case 'config': await this.loadNodeMcuConfig(container); break;
        case 'rates': await this.loadNodeMcuRates(container); break;
        case 'control': await this.loadNodeMcuControl(container); break;
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${this.escapeHtml(err.message)}</p></div>`;
    }
  },

  async loadNodeMcuDashboard(container) {
    const d = await api.nodemcuDashboard(this._nodemcuSelectedId);
    const uptimeSec = Math.floor(d.uptimeMs / 1000);
    const fmtUptime = (s) => {
      const days = Math.floor(s / 86400);
      const hrs = Math.floor((s % 86400) / 3600);
      const mins = Math.floor((s % 3600) / 60);
      return days > 0 ? `${days}d ${hrs}h ${mins}m` : `${hrs}h ${mins}m`;
    };

    container.innerHTML = `
      <div class="overview-grid">
        <div class="dash-card">
          <div class="dash-card-title">System Status</div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem">
            <div style="display:flex;justify-content:space-between"><span>Internet</span><span style="color:${d.internetOnline ? '#4caf50' : '#f44336'}">${d.internetOnline ? 'Online' : 'Offline'}</span></div>
            <div style="display:flex;justify-content:space-between"><span>MikroTik</span><span style="color:${d.mikrotikConnected ? '#4caf50' : '#f44336'}">${d.mikrotikConnected ? 'Connected' : 'Disconnected'}</span></div>
            <div style="display:flex;justify-content:space-between"><span>Uptime</span><span>${fmtUptime(uptimeSec)}</span></div>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Sales</div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem">
            <div style="display:flex;justify-content:space-between"><span>Lifetime</span><span>${d.lifetimeCoins} coins</span></div>
            <div style="display:flex;justify-content:space-between"><span>Current Session</span><span>${d.currentCoins} coins</span></div>
            <div style="display:flex;justify-content:space-between"><span>Customers Served</span><span>${d.customerCount}</span></div>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Device Info</div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem">
            <div style="display:flex;justify-content:space-between"><span>Hardware</span><span>${this.escapeHtml(d.hardwareType)}</span></div>
            <div style="display:flex;justify-content:space-between"><span>Firmware</span><span>v${this.escapeHtml(d.firmwareVersion)}</span></div>
            <div style="display:flex;justify-content:space-between"><span>Interface</span><span>${this.escapeHtml(d.interfaceType)}</span></div>
            <div style="display:flex;justify-content:space-between"><span>Signal</span><span>${d.signalStrength}%</span></div>
            <div style="display:flex;justify-content:space-between"><span>MAC</span><span>${this.escapeHtml(d.macAddress)}</span></div>
            <div style="display:flex;justify-content:space-between"><span>IP</span><span>${this.escapeHtml(d.ipAddress)}</span></div>
            <div style="display:flex;justify-content:space-between"><span>Free Heap</span><span>${d.freeHeap} bytes</span></div>
          </div>
        </div>
      </div>
      <div style="margin-top:1rem">
        <button class="btn btn-sm btn-outline" onclick="App.loadNodeMcuTab()">Refresh</button>
        <button class="btn btn-sm btn-outline" onclick="App.startNodeMcuAutoRefresh()" id="nodemcu-auto-refresh-btn">Auto-Refresh (10s)</button>
      </div>
    `;
  },

  startNodeMcuAutoRefresh() {
    if (this._nodemcuRefreshInterval) {
      clearInterval(this._nodemcuRefreshInterval);
      this._nodemcuRefreshInterval = null;
      const btn = document.getElementById('nodemcu-auto-refresh-btn');
      if (btn) btn.textContent = 'Auto-Refresh (10s)';
      return;
    }
    const btn = document.getElementById('nodemcu-auto-refresh-btn');
    if (btn) btn.textContent = 'Stop Auto-Refresh';
    this._nodemcuRefreshInterval = setInterval(() => {
      if (this._nodemcuTab === 'dashboard' && this.currentPage === 'nodemcu') {
        this.loadNodeMcuDashboard(document.getElementById('nodemcu-tab-content'));
      }
    }, 10000);
  },

  async loadNodeMcuConfig(container) {
    const config = await api.nodemcuGetConfig(this._nodemcuSelectedId);
    const pinOptions = ['NONE', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];
    const pinSelect = (id, val) => `<select id="nc-${id}" class="form-control">${pinOptions.map(p => `<option value="${p === 'NONE' ? 'NONE' : p}" ${val === p ? 'selected' : ''}>${p}</option>`).join('')}</select>`;
    const lcdOptions = [{v:'0',l:'None'},{v:'1',l:'16x2'},{v:'2',l:'20x4'}];
    const lcdSelect = (val) => `<select id="nc-lcdScreen" class="form-control">${lcdOptions.map(o => `<option value="${o.v}" ${val === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>`;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
        <div>
          <h4 style="margin-bottom:0.5rem">Vendo & WiFi</h4>
          <div class="form-row"><label>Vendo Name</label><input id="nc-vendoName" class="form-control" value="${this.escapeHtml(config.vendoName)}"></div>
          <div class="form-row"><label>WiFi SSID</label><input id="nc-wifiSSID" class="form-control" value="${this.escapeHtml(config.wifiSSID)}"></div>
          <div class="form-row"><label>WiFi Password</label><input id="nc-wifiPassword" class="form-control" type="password" value="${this.escapeHtml(config.wifiPassword)}"></div>
          <div class="form-row"><label>IP Mode</label><select id="nc-ipAddressMode" class="form-control"><option value="0" ${config.ipAddressMode==='0'?'selected':''}>DHCP</option><option value="1" ${config.ipAddressMode==='1'?'selected':''}>Static</option></select></div>
          <div class="form-row"><label>Local IP</label><input id="nc-localIpAddress" class="form-control" value="${this.escapeHtml(config.localIpAddress)}"></div>
          <div class="form-row"><label>Gateway</label><input id="nc-gatewayIp" class="form-control" value="${this.escapeHtml(config.gatewayIp)}"></div>
          <div class="form-row"><label>Subnet</label><input id="nc-subnetMask" class="form-control" value="${this.escapeHtml(config.subnetMask)}"></div>
          <div class="form-row"><label>DNS</label><input id="nc-dnsServer" class="form-control" value="${this.escapeHtml(config.dnsServer)}"></div>

          <h4 style="margin:1rem 0 0.5rem">MikroTik Connection</h4>
          <div class="form-row"><label>MikroTik IP</label><input id="nc-mikrotikIp" class="form-control" value="${this.escapeHtml(config.mikrotikIp)}"></div>
          <div class="form-row"><label>Username</label><input id="nc-mikrotikUser" class="form-control" value="${this.escapeHtml(config.mikrotikUser)}"></div>
          <div class="form-row"><label>Password</label><input id="nc-mikrotikPassword" class="form-control" type="password" value="${this.escapeHtml(config.mikrotikPassword)}"></div>
          <div class="form-row"><label>Connection Mode</label><select id="nc-mtConnectionMode" class="form-control"><option value="0" ${config.mtConnectionMode==='0'?'selected':''}>On-Demand</option><option value="1" ${config.mtConnectionMode==='1'?'selected':''}>Keep Alive</option></select></div>
        </div>
        <div>
          <h4 style="margin-bottom:0.5rem">Coin Slot</h4>
          <div class="form-row"><label>Coin Slot Type</label><select id="nc-coinSlotType" class="form-control"><option value="0" ${config.coinSlotType==='0'?'selected':''}>Universal</option><option value="1" ${config.coinSlotType==='1'?'selected':''}>Multicoin</option></select></div>
          <div class="form-row"><label>Wait Time (sec)</label><input id="nc-coinSlotWaitTime" class="form-control" type="number" value="${this.escapeHtml(config.coinSlotWaitTime)}"></div>
          <div class="form-row"><label>Abuse Count</label><input id="nc-coinSlotAbuseCount" class="form-control" type="number" value="${this.escapeHtml(config.coinSlotAbuseCount)}"></div>
          <div class="form-row"><label>Ban Minutes</label><input id="nc-coinSlotBanMinutes" class="form-control" type="number" value="${this.escapeHtml(config.coinSlotBanMinutes)}"></div>
          <div class="form-row"><label>Coin Multiplier</label><input id="nc-coinMultiplier" class="form-control" type="number" value="${this.escapeHtml(config.coinMultiplier)}"></div>
          <div class="form-row"><label>Pulse Count</label><input id="nc-singleCoinPulseCount" class="form-control" type="number" value="${this.escapeHtml(config.singleCoinPulseCount)}"></div>

          <h4 style="margin:1rem 0 0.5rem">Voucher</h4>
          <div class="form-row"><label>Prefix</label><input id="nc-voucherPrefix" class="form-control" value="${this.escapeHtml(config.voucherPrefix)}"></div>
          <div class="form-row"><label>Login Option</label><select id="nc-voucherLoginOption" class="form-control"><option value="0" ${config.voucherLoginOption==='0'?'selected':''}>Username only</option><option value="1" ${config.voucherLoginOption==='1'?'selected':''}>Username + Password</option></select></div>
          <div class="form-row"><label>Profile</label><input id="nc-voucherProfile" class="form-control" value="${this.escapeHtml(config.voucherProfile)}"></div>
          <div class="form-row"><label>Length</label><input id="nc-voucherLength" class="form-control" type="number" value="${this.escapeHtml(config.voucherLength)}"></div>
          <div class="form-row"><label>Validity Mode</label><select id="nc-voucherValidity" class="form-control"><option value="0" ${config.voucherValidity==='0'?'selected':''}>First Validity</option><option value="1" ${config.voucherValidity==='1'?'selected':''}>First + Extend</option></select></div>

          <h4 style="margin:1rem 0 0.5rem">Credentials</h4>
          <div class="form-row"><label>Admin User</label><input id="nc-adminUser" class="form-control" value="${this.escapeHtml(config.adminUser)}"></div>
          <div class="form-row"><label>Admin Password</label><input id="nc-adminPassword" class="form-control" type="password" value="${this.escapeHtml(config.adminPassword)}"></div>
          <div class="form-row"><label>API Key</label><input id="nc-apiKey" class="form-control" value="${this.escapeHtml(config.apiKey)}"></div>
        </div>
      </div>
      <div style="margin-top:1.5rem;display:flex;gap:0.5rem">
        <button class="btn btn-primary" onclick="App.saveNodeMcuConfig()">Save Configuration</button>
        <span style="color:#f44336;font-size:0.85rem;align-self:center">Warning: Saving will restart the device</span>
      </div>
    `;
  },

  async saveNodeMcuConfig() {
    const fields = ['vendoName','wifiSSID','wifiPassword','mikrotikIp','mikrotikUser','mikrotikPassword',
      'coinSlotWaitTime','adminUser','adminPassword','coinSlotAbuseCount','coinSlotBanMinutes',
      'coinSlotPin','coinSlotSetPin','systemReadyLedPin','insertCoinLedPin','lcdScreen',
      'insertCoinBtnPin','checkInternetStatus','voucherPrefix','welcomeLCDMarquee','setupDoneFlag',
      'voucherLoginOption','voucherProfile','voucherValidity','ledTriggerType','ipAddressMode',
      'localIpAddress','gatewayIp','subnetMask','dnsServer','coinSlotType','singleCoinPulseCount',
      'mtConnectionMode','operatorUser','operatorPassword','apiKey','nightLightPin',
      'buttonFunction','voucherLength','coinMultiplier','lanModeOverride','lcdSDAPin','lcdSCLPin',
      'billAcceptorPin','billAcceptorMultiplier','thermalPrinterPin','printOption',
      'printOptionCriteria','lanCSPin','persistLogs','includeVendoName','welcomeTextFirstLine',
      'welcomeTextThirdLine','insertCoinText','thankYouText','restartSchedule','blackoutDetection',
      'buzzerPin','printerBaudRate','pulseToBlock','thankYouTimeout','ethBootUpPin','ethPowerPin',
      'ethMdcPin','ethMdioPin'];

    const current = await api.nodemcuGetConfig(this._nodemcuSelectedId);
    const config = { ...current };
    for (const f of fields) {
      const el = document.getElementById(`nc-${f}`);
      if (el) config[f] = el.value;
    }

    try {
      await api.nodemcuSaveConfig(this._nodemcuSelectedId, config);
      this.toast('Configuration saved. Device restarting...', 'success');
    } catch (err) {
      this.toast('Save failed: ' + err.message, 'error');
    }
  },

  async loadNodeMcuRates(container) {
    const data = await api.nodemcuGetRates(this._nodemcuSelectedId);
    const rates = data.rates || [];

    container.innerHTML = `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h4 style="margin:0">Promo Rates</h4>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-sm btn-outline" onclick="App.addNodeMcuRate()">Add Rate</button>
            <button class="btn btn-sm btn-primary" onclick="App.saveNodeMcuRates()">Save Rates</button>
          </div>
        </div>
        <table class="table" id="nodemcu-rates-table">
          <thead>
            <tr><th>Name</th><th>Price</th><th>Minutes</th><th>Validity (min)</th><th>Data Limit (MB)</th><th>Profile</th><th></th></tr>
          </thead>
          <tbody>
            ${rates.map((r, i) => `
              <tr data-idx="${i}">
                <td><input class="form-control rate-name" value="${this.escapeHtml(r.name)}"></td>
                <td><input class="form-control rate-price" type="number" value="${r.price}"></td>
                <td><input class="form-control rate-minutes" type="number" value="${r.minutes}"></td>
                <td><input class="form-control rate-validity" type="number" value="${r.validity}"></td>
                <td><input class="form-control rate-datalimit" type="number" value="${r.dataLimit}"></td>
                <td><input class="form-control rate-profile" value="${this.escapeHtml(r.profile)}"></td>
                <td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()">X</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  addNodeMcuRate() {
    const tbody = document.querySelector('#nodemcu-rates-table tbody');
    const idx = tbody.children.length;
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;
    tr.innerHTML = `
      <td><input class="form-control rate-name" value="New Rate"></td>
      <td><input class="form-control rate-price" type="number" value="1"></td>
      <td><input class="form-control rate-minutes" type="number" value="10"></td>
      <td><input class="form-control rate-validity" type="number" value="20"></td>
      <td><input class="form-control rate-datalimit" type="number" value="0"></td>
      <td><input class="form-control rate-profile" value=""></td>
      <td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()">X</button></td>
    `;
    tbody.appendChild(tr);
  },

  async saveNodeMcuRates() {
    const rows = document.querySelectorAll('#nodemcu-rates-table tbody tr');
    const rates = [];
    rows.forEach(row => {
      rates.push({
        name: row.querySelector('.rate-name').value,
        price: parseInt(row.querySelector('.rate-price').value) || 0,
        minutes: parseInt(row.querySelector('.rate-minutes').value) || 0,
        validity: parseInt(row.querySelector('.rate-validity').value) || 0,
        dataLimit: parseInt(row.querySelector('.rate-datalimit').value) || 0,
        profile: row.querySelector('.rate-profile').value,
      });
    });
    try {
      await api.nodemcuSaveRates(this._nodemcuSelectedId, rates);
      this.toast('Rates saved', 'success');
    } catch (err) {
      this.toast('Save failed: ' + err.message, 'error');
    }
  },

  async loadNodeMcuControl(container) {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
        <div class="dash-card">
          <div class="dash-card-title">System Controls</div>
          <div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:0.5rem">
            <button class="btn btn-outline" onclick="App.nodemcuRestart()">Restart NodeMCU</button>
            <button class="btn btn-outline" onclick="App.nodemcuRestartMikrotik()">Restart MikroTik</button>
            <button class="btn btn-outline" onclick="App.nodemcuToggleNightLight()">Toggle Night Light</button>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Reset Statistics</div>
          <div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:0.5rem">
            <button class="btn btn-outline" onclick="App.nodemcuResetStats('coinCount')">Reset Current Coins</button>
            <button class="btn btn-outline" onclick="App.nodemcuResetStats('customerCount')">Reset Customer Count</button>
            <button class="btn btn-danger" onclick="App.nodemcuResetStats('lifeTimeCount')">Reset Lifetime Count</button>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Generate Vouchers</div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem">
            <div class="form-row"><label>Amount (coins)</label><input id="nc-gen-amount" class="form-control" type="number" value="5"></div>
            <div class="form-row"><label>Quantity</label><input id="nc-gen-qty" class="form-control" type="number" value="1"></div>
            <div class="form-row"><label>Prefix</label><input id="nc-gen-prefix" class="form-control" value="P"></div>
            <label class="checkbox-label"><input type="checkbox" id="nc-gen-sales"><span>Add to Sales</span></label>
            <button class="btn btn-primary" onclick="App.nodemcuGenerateVouchers()">Generate</button>
            <div id="nc-gen-result"></div>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">WiFi Scan</div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.5rem">
            <button class="btn btn-outline" onclick="App.nodemcuScanSSID()">Scan Networks</button>
            <div id="nc-ssid-result"></div>
          </div>
        </div>
      </div>
    `;
  },

  async nodemcuRestart() {
    if (!confirm('Restart this NodeMCU device?')) return;
    try {
      await api.nodemcuRestart(this._nodemcuSelectedId);
      this.toast('Restart command sent', 'success');
    } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
  },

  async nodemcuRestartMikrotik() {
    if (!confirm('Restart MikroTik from this NodeMCU?')) return;
    try {
      await api.nodemcuRestartMikrotik(this._nodemcuSelectedId);
      this.toast('MikroTik restart command sent', 'success');
    } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
  },

  async nodemcuToggleNightLight() {
    try {
      await api.nodemcuToggleNightLight(this._nodemcuSelectedId);
      this.toast('Night light toggled', 'success');
    } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
  },

  async nodemcuResetStats(type) {
    if (!confirm(`Reset ${type}?`)) return;
    try {
      await api.nodemcuResetStats(this._nodemcuSelectedId, type);
      this.toast('Statistics reset', 'success');
    } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
  },

  async nodemcuGenerateVouchers() {
    const amount = parseInt(document.getElementById('nc-gen-amount').value) || 0;
    const qty = parseInt(document.getElementById('nc-gen-qty').value) || 0;
    const prefix = document.getElementById('nc-gen-prefix').value;
    const addToSales = document.getElementById('nc-gen-sales').checked;
    try {
      const data = await api.nodemcuGenerateVouchers(this._nodemcuSelectedId, amount, qty, prefix, addToSales);
      const parts = (data.raw || '').split('|');
      const vouchers = (parts[3] || '').split('#').filter(Boolean);
      document.getElementById('nc-gen-result').innerHTML = vouchers.length > 0
        ? `<div style="margin-top:0.5rem"><strong>Generated:</strong><br>${vouchers.map(v => this.escapeHtml(v)).join('<br>')}</div>`
        : '<div style="margin-top:0.5rem;color:#f44336">No vouchers generated</div>';
    } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
  },

  async nodemcuScanSSID() {
    const container = document.getElementById('nc-ssid-result');
    container.innerHTML = '<p>Scanning...</p>';
    try {
      const data = await api.nodemcuScanSSID(this._nodemcuSelectedId);
      const ssids = data.ssids || [];
      container.innerHTML = ssids.length > 0
        ? `<div style="margin-top:0.5rem">${ssids.map(s => `<div>${this.escapeHtml(s)}</div>`).join('')}</div>`
        : '<div style="margin-top:0.5rem">No networks found</div>';
    } catch (err) { container.innerHTML = `<div style="color:#f44336">${this.escapeHtml(err.message)}</div>`; }
  },

  showAddNodeMcuDevice() {
    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    title.textContent = 'Add NodeMCU Device';
    body.innerHTML = `
      <div class="form-row"><label>Device Name</label><input id="nd-name" class="form-control" placeholder="e.g. Vendo 1"></div>
      <div class="form-row"><label>IP Address</label><input id="nd-ip" class="form-control" placeholder="10.0.0.243"></div>
      <div class="form-row"><label>Admin Username</label><input id="nd-user" class="form-control" value="admin"></div>
      <div class="form-row"><label>Admin Password</label><input id="nd-pass" class="form-control" type="password"></div>
    `;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    const btns = [
      { label: 'Cancel', cls: 'btn-outline', action: () => this.closeModal() },
      { label: 'Add', cls: 'btn-primary', action: async () => {
        try {
          await api.nodemcuAddDevice({
            name: document.getElementById('nd-name').value,
            ip: document.getElementById('nd-ip').value,
            username: document.getElementById('nd-user').value,
            password: document.getElementById('nd-pass').value,
          });
          this.closeModal();
          this.toast('Device added', 'success');
          this.renderNodeMcu();
        } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
      }},
    ];
    btns.forEach(btn => {
      const el = document.createElement('button');
      el.className = `btn ${btn.cls}`;
      el.textContent = btn.label;
      el.addEventListener('click', btn.action);
      footer.appendChild(el);
    });
    modal.classList.add('active');
  },

  showEditNodeMcuDevice() {
    const devices = this._nodemcuDevices || [];
    const device = devices.find(d => d.id === this._nodemcuSelectedId);
    if (!device) return;

    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    title.textContent = 'Edit NodeMCU Device';
    body.innerHTML = `
      <div class="form-row"><label>Device Name</label><input id="nd-name" class="form-control" value="${this.escapeHtml(device.name)}"></div>
      <div class="form-row"><label>IP Address</label><input id="nd-ip" class="form-control" value="${this.escapeHtml(device.ip)}"></div>
      <div class="form-row"><label>Admin Username</label><input id="nd-user" class="form-control" value="${this.escapeHtml(device.username)}"></div>
      <div class="form-row"><label>Admin Password</label><input id="nd-pass" class="form-control" type="password" value="${this.escapeHtml(device.password)}"></div>
    `;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    const btns = [
      { label: 'Cancel', cls: 'btn-outline', action: () => this.closeModal() },
      { label: 'Save', cls: 'btn-primary', action: async () => {
        try {
          await api.nodemcuUpdateDevice(this._nodemcuSelectedId, {
            name: document.getElementById('nd-name').value,
            ip: document.getElementById('nd-ip').value,
            username: document.getElementById('nd-user').value,
            password: document.getElementById('nd-pass').value,
          });
          this.closeModal();
          this.toast('Device updated', 'success');
          this.renderNodeMcu();
        } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
      }},
    ];
    btns.forEach(btn => {
      const el = document.createElement('button');
      el.className = `btn ${btn.cls}`;
      el.textContent = btn.label;
      el.addEventListener('click', btn.action);
      footer.appendChild(el);
    });
    modal.classList.add('active');
  },

  async deleteNodeMcuDevice() {
    if (!confirm('Delete this NodeMCU device?')) return;
    try {
      await api.nodemcuDeleteDevice(this._nodemcuSelectedId);
      this._nodemcuSelectedId = null;
      this.toast('Device deleted', 'success');
      this.renderNodeMcu();
    } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
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
