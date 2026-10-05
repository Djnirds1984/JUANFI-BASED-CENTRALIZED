const App = {
  currentPage: 'overview',
  selectedRouterId: null,

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
                <div class="progress-bar"><div class="fill ${cpuClass}" style="width:${cpuPct}%"></div></div>
              </div>
              <div class="dash-metric">
                <div class="dash-metric-header">
                  <span class="dash-metric-label">RAM Usage</span>
                  <span class="dash-metric-value">${memPct}% (${formatBytes(serverInfo.memoryUsed)} / ${formatBytes(serverInfo.memoryTotal)})</span>
                </div>
                <div class="progress-bar"><div class="fill ${memClass}" style="width:${memPct}%"></div></div>
              </div>
              <div class="dash-metric">
                <div class="dash-metric-header">
                  <span class="dash-metric-label">Disk Usage</span>
                  <span class="dash-metric-value">${diskPct}% (${formatBytes(serverInfo.diskUsed)} / ${formatBytes(serverInfo.diskTotal)})</span>
                </div>
                <div class="progress-bar"><div class="fill ${diskClass}" style="width:${diskPct}%"></div></div>
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
                  <div class="progress-bar"><div class="fill ${primaryRouter.systemInfo.cpuLoad > 80 ? 'fill-high' : primaryRouter.systemInfo.cpuLoad > 50 ? 'fill-medium' : 'fill-low'}" style="width:${primaryRouter.systemInfo.cpuLoad}%"></div></div>
                </div>
                <div class="dash-metric">
                  <div class="dash-metric-header">
                    <span class="dash-metric-label">Memory</span>
                    <span class="dash-metric-value">${Math.round((primaryRouter.systemInfo.memoryUsed / primaryRouter.systemInfo.memoryTotal) * 100)}% (${formatBytes(primaryRouter.systemInfo.memoryUsed)} / ${formatBytes(primaryRouter.systemInfo.memoryTotal)})</span>
                  </div>
                  <div class="progress-bar"><div class="fill ${Math.round((primaryRouter.systemInfo.memoryUsed / primaryRouter.systemInfo.memoryTotal) * 100) > 80 ? 'fill-high' : Math.round((primaryRouter.systemInfo.memoryUsed / primaryRouter.systemInfo.memoryTotal) * 100) > 50 ? 'fill-medium' : 'fill-low'}" style="width:${Math.round((primaryRouter.systemInfo.memoryUsed / primaryRouter.systemInfo.memoryTotal) * 100)}%"></div></div>
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
                      <div class="progress-bar"><div class="fill ${r.systemInfo.cpuLoad > 80 ? 'fill-high' : r.systemInfo.cpuLoad > 50 ? 'fill-medium' : 'fill-low'}" style="width:${r.systemInfo.cpuLoad}%"></div></div>
                    </div>
                    <div style="margin-top:0.75rem">
                      <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:0.25rem">
                        <span>Memory</span><span>${memP}%</span>
                      </div>
                      <div class="progress-bar"><div class="fill ${memP > 80 ? 'fill-high' : memP > 50 ? 'fill-medium' : 'fill-low'}" style="width:${memP}%"></div></div>
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
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
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
      content.innerHTML = '<div class="empty-state"><h3>No connected routers</h3><p>Connect a router first to manage hotspot users.</p></div>';
      return;
    }

    if (!this.selectedRouterId || !connectedRouters.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = connectedRouters[0].id;
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Hotspot Users</h3>
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
      this.loadHotspotUsers();
    });

    this.loadHotspotUsers();
  },

  async loadHotspotUsers() {
    const container = document.getElementById('hotspot-users-table');
    try {
      const users = await api.getHotspotUsers(this.selectedRouterId);
      if (users.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No hotspot users found.</p></div>';
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Profile</th>
                <th>Status</th>
                <th>Uptime</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.map((u) => `
                <tr>
                  <td><strong>${this.escapeHtml(u.name)}</strong></td>
                  <td>${this.escapeHtml(u.profile || 'default')}</td>
                  <td>${u.disabled === 'true' ? '<span class="status-badge disconnected">Disabled</span>' : '<span class="status-badge connected">Active</span>'}</td>
                  <td>${u.uptime || '0s'}</td>
                  <td>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteHotspotUser('${u['.id']}')">Remove</button>
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
      this.loadHotspotUsers();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteHotspotUser(userId) {
    if (!confirm('Remove this hotspot user?')) return;
    try {
      await api.deleteHotspotUser(this.selectedRouterId, userId);
      this.toast('User removed', 'success');
      this.loadHotspotUsers();
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
