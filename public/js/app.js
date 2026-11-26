function uiIcon(name, cls) {
  return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}

const App = {
  currentPage: 'overview',
  selectedRouterId: null,
  _overviewInterval: null,
  _activeUsersInterval: null,
  _hostsInterval: null,
  _activeInterval: null,
  portalCurrentFile: 'login.html',
  portalDirty: false,
  _portalPreviewTimer: null,
  _portalPreviewTheme: null,
  hotspotTab: 'hosts',
  voucherTab: 'vouchers',
  radiusTab: 'profiles',
  pppTab: 'active',
  systemCurrency: 'PHP',
  _settingsTab: 'general',
  _pendingLogoFile: null,
  _pendingLogoRemoved: false,
  _systemSettings: null,
  _systemSettingsPromise: null,
  currencies: [
    { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
    { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
    { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
    { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
    { code: 'THB', name: 'Thai Baht', symbol: '฿' },
    { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
    { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
    { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
    { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
    { code: 'QAR', name: 'Qatari Riyal', symbol: '﷼' },
    { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك' },
    { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
    { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
    { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
    { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
    { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
    { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
    { code: 'LKR', name: 'Sri Lankan Rupee', symbol: '₨' },
    { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨' },
    { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K' },
    { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
    { code: 'BND', name: 'Brunei Dollar', symbol: 'B$' },
    { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP$' },
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
    { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
    { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
    { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
    { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
    { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
    { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
    { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  ],

  init() {
    if (window.AdminThemes) {
      AdminThemes.applyStored();
    }
    this.loadBranding();
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

    const toggle = document.getElementById('sidebar-toggle');
    if (toggle) toggle.addEventListener('click', () => this.toggleSidebar());

    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => this.closeSidebar());

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
    this.loadSystemSettings();
    this.startChatNotifications();
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
    this.stopChatNotifications();
    this._systemSettings = null;
    this._systemSettingsPromise = null;
    this.systemCurrency = 'PHP';
    this.showLogin();
  },

  toggleSidebar() {
    document.body.classList.toggle('sidebar-open');
  },

  closeSidebar() {
    document.body.classList.remove('sidebar-open');
  },

  navigate(page) {
    if (this._overviewInterval) {
      clearInterval(this._overviewInterval);
      this._overviewInterval = null;
    }
    this.clearHotspotPollers();
    this.clearPppPollers();
    this.clearCafePollers();
    this.clearRadiusPollers();
    this.clearChatPollers();
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
      radius: 'RADIUS',
      chat: 'Chat',
      monitoring: 'Monitoring',
      portal: 'Portal',
      subvendo: 'SubVendo',
      pisonet: 'Pisonet',
      sales: 'Sales Report',
      wallet: 'Customers / Wallet',
      payments: 'Online Payment',
      appearance: 'Appearance',
      settings: 'System Settings',
      ppp: 'PPP',
    };

    document.getElementById('page-title').textContent = titles[page] || page;
    this.renderPage(page);
    this.closeSidebar();
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
        case 'radius': await this.renderRadius(); break;
        case 'chat': await this.renderChat(); break;
        case 'portal': await this.renderPortal(); break;
        case 'subvendo': await this.renderSubVendo(); break;
        case 'pisonet': await this.renderPisonet(); break;
        case 'sales': await this.renderSalesReport(); break;
        case 'wallet': await this.renderWallet(); break;
        case 'payments': await this.renderOnlinePayment(); break;
        case 'tools': await this.renderTools(); break;
        case 'appearance': await this.renderAppearance(); break;
        case 'settings': await this.renderSystemSettings(); break;
        case 'ppp': await this.renderPpp(); break;
      }
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
    }
  },

  async renderOnlinePayment() {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="empty-state"><p>Loading payment settings...</p></div>';

    let s = {};
    let rates = [];
    let payments = [];
    try {
      [s, rates, payments] = await Promise.all([
        api.getPaymentSettings(), api.getPaymentRates(), api.getPayments(100),
      ]);
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
      return;
    }
    this._paymentRates = rates;
    this._paymentCurrency = s.currency || 'PHP';

    const PAY_METHODS = [
      { id: 'qrph', label: 'QR Ph' },
      { id: 'gcash', label: 'GCash' },
      { id: 'paymaya', label: 'Maya (PayMaya)' },
      { id: 'grab_pay', label: 'GrabPay' },
      { id: 'card', label: 'Card' },
      { id: 'billease', label: 'BillEase' },
      { id: 'dob', label: 'DOB' },
    ];
    const activeMethods = String(s.methods || 'qrph').split(',').map((x) => x.trim());
    const payCurrency = s.currency || 'PHP';
    const fmtPay = (v) => this.formatAmount(payCurrency, v);
    const webhookUrl = `${location.origin}/api/payments/paymongo/webhook`;

    content.innerHTML = `
      <div class="payments-layout">
        <div class="payments-main">
          <div class="card">
            <div class="card-header">
              <h3>${uiIcon('card')} Online Payment — PayMongo</h3>
              <span class="status-badge ${s.enabled ? 'connected' : 'disconnected'}">${s.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <form id="payment-form">
              <label class="pay-toggle">
                <span class="pay-toggle-text">
                  <span class="pay-toggle-title">Enable online payment</span>
                  <span class="pay-toggle-sub">Adds a ${this.escapeHtml(s.button_label || 'PAY GCASH')} button to the captive portal</span>
                </span>
                <input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}>
              </label>

              <div class="pay-section">
                <div class="pay-section-head">
                  <h4>${uiIcon('key')} Gateway credentials</h4>
                  <span class="pay-section-hint">From PayMongo → Developers → API keys</span>
                </div>
                <div class="pay-grid-2">
                  <div class="form-group">
                    <label>Public key</label>
                    <input name="public_key" class="form-control pay-key" value="${this.escapeHtml(s.public_key || '')}" placeholder="pk_live_…">
                  </div>
                  <div class="form-group">
                    <label>Secret key</label>
                    <input name="secret_key" class="form-control pay-key" value="${this.escapeHtml(s.secret_key || '')}" placeholder="sk_live_…">
                  </div>
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label>Webhook secret</label>
                  <input name="webhook_secret" class="form-control pay-key" value="${this.escapeHtml(s.webhook_secret || '')}" placeholder="whsk_…">
                </div>
              </div>

              <div class="pay-section">
                <div class="pay-section-head">
                  <h4>${uiIcon('clock')} Default checkout</h4>
                  <span class="pay-section-hint">Used when the portal does not pick a pricing tier</span>
                </div>
                <div class="pay-grid-3">
                  <div class="form-group">
                    <label>Price</label>
                    <input name="amount" type="number" step="0.01" class="form-control" value="${s.amount || 0}">
                  </div>
                  <div class="form-group">
                    <label>Time granted (minutes)</label>
                    <input name="minutes" type="number" class="form-control" value="${s.minutes || 0}">
                  </div>
                  <div class="form-group">
                    <label>Currency</label>
                    <input name="currency" class="form-control" value="${this.escapeHtml(payCurrency)}" placeholder="PHP">
                  </div>
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label>Description</label>
                  <input name="description" class="form-control" value="${this.escapeHtml(s.description || 'Internet Time')}">
                </div>
              </div>

              <div class="pay-section">
                <div class="pay-section-head">
                  <h4>${uiIcon('globe')} Payment methods</h4>
                  <span class="pay-section-hint">Only tick what your PayMongo account offers</span>
                </div>
                <div class="pay-methods">
                  ${PAY_METHODS.map((m) => `
                    <label class="pay-method">
                      <input type="checkbox" name="pm_${m.id}" ${activeMethods.indexOf(m.id) >= 0 ? 'checked' : ''}> ${m.label}
                    </label>`).join('')}
                </div>
              </div>

              <div class="pay-section">
                <div class="pay-section-head">
                  <h4>${uiIcon('monitor')} Portal button</h4>
                </div>
                <div class="form-group" style="margin-bottom:0;max-width:320px">
                  <label>Button label</label>
                  <input name="button_label" class="form-control" value="${this.escapeHtml(s.button_label || 'PAY GCASH')}">
                </div>
              </div>

              <div class="pay-form-actions">
                <button class="btn btn-primary" type="submit">${uiIcon('save')} Save settings</button>
              </div>
            </form>
          </div>

          <div class="card">
            <div class="card-header">
              <h3>${uiIcon('ticket')} Pricing tiers</h3>
              <button class="btn btn-primary btn-sm" onclick="App.addPaymentRate()">${uiIcon('plus')} Add Tier</button>
            </div>
            <div class="table-wrapper">
              <table>
                <thead><tr><th>Label</th><th>Price (${this.escapeHtml(payCurrency)})</th><th>Minutes</th><th>Active</th><th style="text-align:right">Actions</th></tr></thead>
                <tbody id="rates-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="payments-side">
          <div class="card">
            <div class="card-header"><h3>${uiIcon('zap')} Checkout summary</h3></div>
            <div class="pay-summary">
              <div class="pay-summary-row"><span>Price</span><strong>${fmtPay(s.amount || 0)}</strong></div>
              <div class="pay-summary-row"><span>Time granted</span><strong>${s.minutes || 0} min</strong></div>
              <div class="pay-summary-row"><span>Status</span><strong>${s.enabled ? 'Live' : 'Paused'}</strong></div>
            </div>
            <div class="pay-summary-note">The device receives ${s.minutes || 0} minutes once PayMongo confirms the payment.</div>
          </div>

          <div class="card">
            <div class="card-header"><h3>${uiIcon('link')} Webhook</h3></div>
            <p class="pay-hint">Add this URL in PayMongo Dashboard → Developers → Webhooks.</p>
            <div class="pay-code">
              <code id="pay-webhook-url">${webhookUrl}</code>
              <button class="btn btn-outline btn-sm" type="button" onclick="App.copyText(document.getElementById('pay-webhook-url').textContent)">${uiIcon('copy')} Copy</button>
            </div>
            <p class="pay-hint" style="margin-top:0.75rem;margin-bottom:0">Subscribe to <code>payment.paid</code> and <code>checkout_session.payment.paid</code>.</p>
          </div>

          <div class="pay-tip">
            ${uiIcon('info')}
            <span>Keep the secret key and webhook secret private. Devices are only unlocked after a verified webhook.</span>
          </div>
        </aside>
      </div>

      <div class="card" style="margin-top:1.25rem">
        <div class="card-header">
          <h3>${uiIcon('activity')} Payments history</h3>
          <button class="btn btn-outline btn-sm" onclick="App.renderOnlinePayment()">${uiIcon('refresh')} Refresh</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Reference</th><th>MAC</th><th>Amount</th><th>Minutes</th><th>Status</th><th>Paid At</th><th>Created</th></tr></thead>
            <tbody id="payments-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const renderRates = () => {
      const tb = document.getElementById('rates-tbody');
      if (!tb) return;
      tb.innerHTML = (rates && rates.length)
        ? rates.map((r) => `
            <tr>
              <td>${this.escapeHtml(r.label || '-')}</td>
              <td class="pay-amount">${fmtPay(r.amount)}</td>
              <td>${r.minutes}</td>
              <td><span class="status-badge ${r.is_active ? 'connected' : 'disconnected'}">${r.is_active ? 'Active' : 'Hidden'}</span></td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-sm btn-outline" onclick="App.editPaymentRate(${r.id})">${uiIcon('edit')} Edit</button>
                <button class="btn btn-sm btn-outline" onclick="App.deletePaymentRate(${r.id})">${uiIcon('trash')} Delete</button>
              </td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="table-empty">No tiers yet — add one to offer options in the portal.</td></tr>';
    };
    renderRates();

    const tbP = document.getElementById('payments-tbody');
    if (tbP) {
      tbP.innerHTML = (payments && payments.length)
        ? payments.map((p) => {
            const badge = p.status === 'paid' ? 'connected' : (p.status === 'pending' ? 'pending' : 'disconnected');
            return `
              <tr>
                <td><code>${this.escapeHtml(p.reference || '-')}</code></td>
                <td><code>${this.escapeHtml(p.mac_address || '-')}</code></td>
                <td class="pay-amount">${fmtPay(p.amount != null ? p.amount : 0)}</td>
                <td>${p.minutes || 0}</td>
                <td><span class="status-badge ${badge}">${this.escapeHtml(p.status || '-')}</span></td>
                <td>${this.escapeHtml(p.paid_at || '-')}</td>
                <td>${this.escapeHtml(p.created_at || '-')}</td>
              </tr>`;
          }).join('')
        : '<tr><td colspan="7" class="table-empty">No online payments yet.</td></tr>';
    }

    document.getElementById('payment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type="submit"]');
      const payload = {
        enabled: f.enabled.checked,
        public_key: f.public_key.value.trim(),
        secret_key: f.secret_key.value.trim(),
        webhook_secret: f.webhook_secret.value.trim(),
        amount: parseFloat(f.amount.value) || 0,
        minutes: parseInt(f.minutes.value, 10) || 0,
        currency: (f.currency.value.trim() || 'PHP').toUpperCase(),
        description: f.description.value.trim(),
        button_label: f.button_label.value.trim() || 'PAY GCASH',
        methods: PAY_METHODS.filter((m) => f['pm_' + m.id] && f['pm_' + m.id].checked).map((m) => m.id).join(',') || 'qrph',
      };
      if (btn) btn.disabled = true;
      try {
        await api.updatePaymentSettings(payload);
        this.toast('Payment settings saved', 'success');
        await this.renderOnlinePayment();
      } catch (err) {
        this.toast(err.message, 'error');
        if (btn) btn.disabled = false;
      }
    });
  },

  copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => this.toast('Copied to clipboard', 'success'),
        () => this.toast('Copy failed', 'error'),
      );
    } else {
      this.toast('Copy not supported in this browser', 'error');
    }
  },

  addPaymentRate() {
    this.showPaymentRateModal();
  },

  editPaymentRate(id) {
    const r = (this._paymentRates || []).find((x) => x.id === id);
    this.showPaymentRateModal(r || { id });
  },

  showPaymentRateModal(rate = {}) {
    const isEdit = Boolean(rate.id);
    const currency = (this._paymentCurrency || 'PHP');
    this.openModal(isEdit ? 'Edit pricing tier' : 'Add pricing tier', `
      <form id="payment-rate-form">
        <div class="form-group">
          <label>Label</label>
          <input name="label" class="form-control" value="${this.escapeHtml(rate.label || '')}" placeholder="e.g. 30 Minutes" required>
        </div>
        <div class="pay-grid-2">
          <div class="form-group">
            <label>Price (${this.escapeHtml(currency)})</label>
            <input name="amount" type="number" step="0.01" min="0" class="form-control" value="${rate.amount != null ? rate.amount : 10}" required>
          </div>
          <div class="form-group">
            <label>Minutes granted</label>
            <input name="minutes" type="number" min="1" class="form-control" value="${rate.minutes != null ? rate.minutes : 30}" required>
          </div>
        </div>
        <label class="checkbox-label">
          <input type="checkbox" name="is_active" ${rate.is_active === false ? '' : 'checked'}> Show this tier in the portal
        </label>
      </form>`, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: isEdit ? 'Save tier' : 'Add tier', class: 'btn btn-primary', action: () => this.savePaymentRate(isEdit ? rate.id : null) },
    ]);
  },

  async savePaymentRate(id) {
    const f = document.getElementById('payment-rate-form');
    if (!f) return;
    const payload = {
      label: f.label.value.trim(),
      amount: parseFloat(f.amount.value) || 0,
      minutes: parseInt(f.minutes.value, 10) || 0,
      is_active: f.is_active.checked,
    };
    if (!payload.label || payload.minutes < 1) {
      this.toast('Label and minutes are required', 'error');
      return;
    }
    try {
      if (id) {
        await api.updatePaymentRate(id, payload);
        this.toast('Tier updated', 'success');
      } else {
        await api.createPaymentRate(payload);
        this.toast('Tier added', 'success');
      }
      this.closeModal();
      this.renderOnlinePayment();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deletePaymentRate(id) {
    if (!confirm('Delete this pricing tier?')) return;
    try {
      await api.deletePaymentRate(id);
      this.toast('Tier deleted', 'success');
      this.renderOnlinePayment();
    } catch (err) { this.toast(err.message, 'error'); }
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
      // Older panels (or a failed aggregate) report zeroes instead of leaving
      // the tiles blank.
      const stats = summary.stats || {
        onlineUsers: 0,
        sales: { total: 0, today: 0, vouchers: 0, gcash: 0, coins: 0 },
        traffic: { sessions: 0, download: 0, upload: 0 },
      };

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
          <div class="dash-card" style="max-height:420px;overflow-y:auto">
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

          <div class="dash-card" style="max-height:420px;overflow-y:auto">
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

        <div class="stats-grid" style="margin-top:1.5rem">
          <div class="stat-card">
            <div class="stat-label">Hotspot Users Online</div>
            <div class="stat-value" data-stat="online-users" style="color:var(--success)">${stats.onlineUsers}</div>
            <div class="stat-sub" data-stat="online-sub">${summary.connectedRouters}/${summary.totalRouters} routers online</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Sales</div>
            <div class="stat-value" data-stat="sales-total">${this.formatMoney(stats.sales.total)}</div>
            <div class="stat-sub" data-stat="sales-sub">${this.formatMoney(stats.sales.today)} today · ${this.formatMoney(stats.sales.vouchers)} vouchers · ${this.formatMoney(stats.sales.gcash)} GCash · ${this.formatMoney(stats.sales.coins)} coins</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Download</div>
            <div class="stat-value" data-stat="download">${this.formatBytes(stats.traffic.download)}</div>
            <div class="stat-sub" data-stat="download-sub">across ${stats.traffic.sessions} session${stats.traffic.sessions === 1 ? '' : 's'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Upload</div>
            <div class="stat-value" data-stat="upload">${this.formatBytes(stats.traffic.upload)}</div>
            <div class="stat-sub" data-stat="upload-sub">across ${stats.traffic.sessions} session${stats.traffic.sessions === 1 ? '' : 's'}</div>
          </div>
        </div>
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

      const stats = summary.stats;
      if (stats) {
        const setStat = (key, text) => {
          const node = content.querySelector(`[data-stat="${key}"]`);
          if (node) node.textContent = text;
        };
        const sessions = stats.traffic.sessions;
        const sessionsLabel = `across ${sessions} session${sessions === 1 ? '' : 's'}`;
        setStat('online-users', stats.onlineUsers);
        setStat('online-sub', `${summary.connectedRouters}/${summary.totalRouters} routers online`);
        setStat('sales-total', this.formatMoney(stats.sales.total));
        setStat('sales-sub', `${this.formatMoney(stats.sales.today)} today · ${this.formatMoney(stats.sales.vouchers)} vouchers · ${this.formatMoney(stats.sales.gcash)} GCash · ${this.formatMoney(stats.sales.coins)} coins`);
        setStat('download', this.formatBytes(stats.traffic.download));
        setStat('download-sub', sessionsLabel);
        setStat('upload', this.formatBytes(stats.traffic.upload));
        setStat('upload-sub', sessionsLabel);
      }
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
                      ${r.auth_mode === 'radius' ? '<span class="status-badge" style="background:#059669;color:#fff;font-size:0.625rem;padding:0.125rem 0.375rem;margin-left:0.375rem">RADIUS</span>' : ''}
                      ${r.portal_mode === 'stub' ? '<span class="status-badge" style="background:#8b5cf6;color:#fff;font-size:0.625rem;padding:0.125rem 0.375rem;margin-left:0.375rem">Panel Portal</span>' : ''}
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
          <small style="color:var(--text-muted);font-size:0.75rem">8728 for RouterOS API, 80 for REST API</small>
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
        <div class="form-group">
          <label>Auth Mode</label>
          <div style="display:flex;gap:1rem;align-items:center">
            <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
              <input type="radio" name="auth_mode" value="api" checked style="width:auto;margin:0">
              API Mode
            </label>
            <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
              <input type="radio" name="auth_mode" value="radius" style="width:auto;margin:0">
              RADIUS Mode
            </label>
          </div>
          <small style="color:var(--text-muted);font-size:0.75rem">RADIUS: panel authenticates users directly (no hotspot users pushed to router)</small>
        </div>
        <div class="form-group">
          <label>Portal Mode</label>
          <div style="display:flex;gap:1rem;align-items:center">
            <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
              <input type="radio" name="portal_mode" value="mikrotik" checked style="width:auto;margin:0">
              MikroTik-hosted
            </label>
            <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
              <input type="radio" name="portal_mode" value="stub" style="width:auto;margin:0">
              Panel-hosted (stub redirect)
            </label>
          </div>
          <small style="color:var(--text-muted);font-size:0.75rem">MikroTik-hosted: portal files uploaded to router. Panel-hosted: stub on router redirects to panel portal.</small>
        </div>
        <div id="radius-secret-group" class="form-group" style="display:none">
          <label>RADIUS Shared Secret</label>
          <div style="display:flex;gap:0.5rem">
            <input type="text" name="radius_shared_secret" placeholder="Auto-generated if empty" style="flex:1">
            <button type="button" class="btn btn-sm btn-outline" onclick="document.querySelector('#add-router-form [name=radius_shared_secret]').value=crypto.getRandomValues(new Uint8Array(16)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'')">Generate</button>
          </div>
          <small style="color:var(--text-muted);font-size:0.75rem">Must match the RADIUS secret configured on the MikroTik router</small>
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

    const authRadios = document.querySelectorAll('#add-router-form [name="auth_mode"]');
    const secretGroup = document.getElementById('radius-secret-group');
    authRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        secretGroup.style.display = document.querySelector('#add-router-form [name="auth_mode"]:checked').value === 'radius' ? '' : 'none';
      });
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
      auth_mode: document.querySelector('#add-router-form [name="auth_mode"]:checked').value,
      portal_mode: document.querySelector('#add-router-form [name="portal_mode"]:checked').value,
    };

    if (form.radius_shared_secret && form.radius_shared_secret.value) {
      data.radius_shared_secret = form.radius_shared_secret.value;
    }

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
      const currentMode = router.auth_mode || 'api';
      const currentPortalMode = router.portal_mode || 'mikrotik';
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
            <small style="color:var(--text-muted);font-size:0.75rem">8728 for RouterOS API, 80 for REST API</small>
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
          <div class="form-group">
            <label>Auth Mode</label>
            <div style="display:flex;gap:1rem;align-items:center">
              <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
                <input type="radio" name="auth_mode" value="api" ${currentMode === 'api' ? 'checked' : ''} style="width:auto;margin:0">
                API Mode
              </label>
              <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
                <input type="radio" name="auth_mode" value="radius" ${currentMode === 'radius' ? 'checked' : ''} style="width:auto;margin:0">
                RADIUS Mode
              </label>
            </div>
            <small style="color:var(--text-muted);font-size:0.75rem">RADIUS: panel authenticates users directly (no hotspot users pushed to router)</small>
          </div>
          <div class="form-group">
            <label>Portal Mode</label>
            <div style="display:flex;gap:1rem;align-items:center">
              <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
                <input type="radio" name="portal_mode" value="mikrotik" ${currentPortalMode === 'mikrotik' ? 'checked' : ''} style="width:auto;margin:0">
                MikroTik-hosted
              </label>
              <label style="display:flex;align-items:center;gap:0.375rem;cursor:pointer">
                <input type="radio" name="portal_mode" value="stub" ${currentPortalMode === 'stub' ? 'checked' : ''} style="width:auto;margin:0">
                Panel-hosted (stub redirect)
              </label>
            </div>
            <small style="color:var(--text-muted);font-size:0.75rem">MikroTik-hosted: portal files uploaded to router. Panel-hosted: stub on router redirects to panel portal.</small>
          </div>
          <div id="radius-secret-group" class="form-group" style="display:${currentMode === 'radius' ? '' : 'none'}">
            <label>RADIUS Shared Secret</label>
            <div style="display:flex;gap:0.5rem">
              <input type="text" name="radius_shared_secret" value="${this.escapeHtml(router.radius_shared_secret || '')}" placeholder="Leave blank to keep current" style="flex:1">
              <button type="button" class="btn btn-sm btn-outline" id="regen-secret-btn">Regenerate</button>
            </div>
            <small style="color:var(--text-muted);font-size:0.75rem">Must match the RADIUS secret configured on the MikroTik router</small>
          </div>
          <div id="radius-tools-group" class="form-group" style="display:${currentMode === 'radius' ? '' : 'none'}">
            <label>RADIUS Diagnostics</label>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
              <button type="button" class="btn btn-sm btn-primary" id="test-radius-btn">Test Connectivity</button>
              <button type="button" class="btn btn-sm btn-outline" id="view-radius-logs-btn">View Logs</button>
              <button type="button" class="btn btn-sm btn-outline" id="clear-radius-logs-btn" style="color:var(--danger,#ef4444);border-color:var(--danger,#ef4444)">Clear Logs</button>
            </div>
            <div id="radius-test-results" style="display:none;margin-top:0.75rem"></div>
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

      const authRadios = document.querySelectorAll('#edit-router-form [name="auth_mode"]');
      const secretGroup = document.getElementById('radius-secret-group');
      const toolsGroup = document.getElementById('radius-tools-group');
      authRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
          const isRadius = document.querySelector('#edit-router-form [name="auth_mode"]:checked').value === 'radius';
          secretGroup.style.display = isRadius ? '' : 'none';
          toolsGroup.style.display = isRadius ? '' : 'none';
        });
      });

      document.getElementById('regen-secret-btn').addEventListener('click', async () => {
        try {
          const result = await api.regenerateRadiusSecret(routerId);
          document.querySelector('#edit-router-form [name="radius_shared_secret"]').value = result.shared_secret;
          this.toast('New secret generated — save changes to apply', 'info');
        } catch (err) {
          this.toast(err.message, 'error');
        }
      });

      document.getElementById('test-radius-btn').addEventListener('click', async () => {
        const btn = document.getElementById('test-radius-btn');
        const resultsDiv = document.getElementById('radius-test-results');
        btn.disabled = true;
        btn.textContent = 'Testing...';
        resultsDiv.style.display = 'none';
        try {
          const result = await api.testRadiusConnectivity(routerId);
          resultsDiv.style.display = '';
          resultsDiv.innerHTML = `
            <div style="background:var(--bg);border-radius:0.5rem;padding:0.75rem;font-size:0.8125rem;font-family:monospace">
              <div style="margin-bottom:0.375rem"><strong>RADIUS Server:</strong> <span style="color:${result.serverRunning ? 'var(--success,#22c55e)' : 'var(--danger,#ef4444)'}">${result.serverRunning ? 'RUNNING' : 'NOT RUNNING'}</span></div>
              <div style="margin-bottom:0.375rem"><strong>Port Check:</strong> <span style="color:${result.portCheck.includes('listening') ? 'var(--success,#22c55e)' : 'var(--danger,#ef4444)'}">${this.escapeHtml(result.portCheck)}</span></div>
              <div style="margin-bottom:0.375rem"><strong>Router Config:</strong> <span style="color:${result.routerConfigured ? 'var(--success,#22c55e)' : 'var(--danger,#ef4444)'}">${result.routerConfigured ? 'RADIUS enabled' : 'NOT configured'}</span></div>
              <div style="margin-bottom:0.375rem"><strong>Hotspot Users:</strong> ${result.userCount} available for auth</div>
              <div style="margin-bottom:0.375rem"><strong>Auth Test:</strong> <span style="color:${result.authTestResult.startsWith('PASS') ? 'var(--success,#22c55e)' : result.authTestResult.startsWith('FAIL') ? 'var(--danger,#ef4444)' : 'var(--warning,#f59e0b)'}">${this.escapeHtml(result.authTestResult)}</span></div>
              ${result.sharedSecret ? `<div><strong>Shared Secret:</strong> ${this.escapeHtml(result.sharedSecret.substring(0, 8))}...</div>` : ''}
            </div>
          `;
        } catch (err) {
          resultsDiv.style.display = '';
          resultsDiv.innerHTML = `<div style="color:var(--danger,#ef4444);font-size:0.8125rem">Test failed: ${this.escapeHtml(err.message)}</div>`;
        } finally {
          btn.disabled = false;
          btn.textContent = 'Test Connectivity';
        }
      });

      document.getElementById('view-radius-logs-btn').addEventListener('click', async () => {
        try {
          await this.showRadiusLogsModal(routerId);
        } catch (err) {
          this.toast(err.message, 'error');
        }
      });

      document.getElementById('clear-radius-logs-btn').addEventListener('click', async () => {
        if (!confirm('Clear all RADIUS logs for this router?')) return;
        try {
          await api.clearRadiusLogs(routerId);
          this.toast('RADIUS logs cleared', 'success');
        } catch (err) {
          this.toast(err.message, 'error');
        }
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
      auth_mode: document.querySelector('#edit-router-form [name="auth_mode"]:checked').value,
      portal_mode: document.querySelector('#edit-router-form [name="portal_mode"]:checked').value,
    };

    if (form.password.value) {
      data.password = form.password.value;
    }

    if (form.radius_shared_secret && form.radius_shared_secret.value) {
      data.radius_shared_secret = form.radius_shared_secret.value;
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

  async showRadiusLogsModal(routerId) {
    let logs = [];
    try {
      logs = await api.getRadiusLogs(routerId, 200);
    } catch (err) {
      this.toast(err.message, 'error');
      return;
    }

    const logTypeColor = (type) => {
      switch (type) {
        case 'accept': return 'var(--success,#22c55e)';
        case 'reject': return 'var(--danger,#ef4444)';
        case 'accounting': return 'var(--info,#3b82f6)';
        case 'warning': return 'var(--warning,#f59e0b)';
        case 'error': return 'var(--danger,#ef4444)';
        default: return 'var(--text-muted)';
      }
    };

    this.openModal('RADIUS Logs', `
      <div style="max-height:60vh;overflow-y:auto">
        ${logs.length === 0
          ? '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No RADIUS events recorded yet</div>'
          : `<table style="width:100%;font-size:0.8125rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border,#e2e8f0)">
                <th style="text-align:left;padding:0.5rem">Time</th>
                <th style="text-align:left;padding:0.5rem">Type</th>
                <th style="text-align:left;padding:0.5rem">User</th>
                <th style="text-align:left;padding:0.5rem">Source IP</th>
                <th style="text-align:left;padding:0.5rem">Message</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map((log) => `
                <tr style="border-bottom:1px solid var(--border,#e2e8f0)">
                  <td style="padding:0.5rem;white-space:nowrap;font-family:monospace;font-size:0.75rem">${this.escapeHtml(log.created_at)}</td>
                  <td style="padding:0.5rem"><span style="color:${logTypeColor(log.log_type)};font-weight:600;text-transform:uppercase;font-size:0.6875rem">${this.escapeHtml(log.log_type)}</span></td>
                  <td style="padding:0.5rem;font-family:monospace">${this.escapeHtml(log.username || '-')}</td>
                  <td style="padding:0.5rem;font-family:monospace">${this.escapeHtml(log.source_ip || '-')}</td>
                  <td style="padding:0.5rem;word-break:break-all">${this.escapeHtml(log.message)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`
        }
      </div>
      <div style="margin-top:0.75rem;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:0.75rem;color:var(--text-muted)">${logs.length} event${logs.length !== 1 ? 's' : ''}</span>
        <button type="button" class="btn btn-sm btn-outline" id="refresh-logs-btn">Refresh</button>
      </div>
    `, [
      { label: 'Close', class: 'btn btn-outline', action: () => this.closeModal() },
    ]);

    document.getElementById('refresh-logs-btn').addEventListener('click', async () => {
      try {
        const fresh = await api.getRadiusLogs(routerId, 200);
        const tbody = document.querySelector('#modal-body tbody');
        if (tbody) {
          tbody.innerHTML = fresh.map((log) => `
            <tr style="border-bottom:1px solid var(--border,#e2e8f0)">
              <td style="padding:0.5rem;white-space:nowrap;font-family:monospace;font-size:0.75rem">${this.escapeHtml(log.created_at)}</td>
              <td style="padding:0.5rem"><span style="color:${logTypeColor(log.log_type)};font-weight:600;text-transform:uppercase;font-size:0.6875rem">${this.escapeHtml(log.log_type)}</span></td>
              <td style="padding:0.5rem;font-family:monospace">${this.escapeHtml(log.username || '-')}</td>
              <td style="padding:0.5rem;font-family:monospace">${this.escapeHtml(log.source_ip || '-')}</td>
              <td style="padding:0.5rem;word-break:break-all">${this.escapeHtml(log.message)}</td>
            </tr>
          `).join('');
        }
        this.toast('Logs refreshed', 'info');
      } catch (err) {
        this.toast(err.message, 'error');
      }
    });
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
          <h3>Hotspot Users</h3>
          <div style="display:flex;gap:0.5rem">
            <select id="hotspot-router-select" class="btn btn-outline">
              ${connectedRouters.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" onclick="App.showAddUserModal()">Add User</button>
          </div>
        </div>
        <div class="tabs">
          <button class="tab ${this.hotspotTab === 'hosts' ? 'active' : ''}" data-tab="hosts">Hosts</button>
          <button class="tab ${this.hotspotTab === 'active' ? 'active' : ''}" data-tab="active">Active Devices</button>
          <button class="tab ${this.hotspotTab === 'sessions' ? 'active' : ''}" data-tab="sessions">Sessions</button>
        </div>
        <div id="hotspot-tab-content">Loading...</div>
      </div>
    `;

    document.getElementById('hotspot-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadHotspotTab();
    });

    document.querySelectorAll('.tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.hotspotTab = tab.dataset.tab;
        document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.loadHotspotTab();
      });
    });

    this.loadHotspotTab();
  },

  async loadHotspotTab() {
    const container = document.getElementById('hotspot-tab-content');
    if (!container) return;
    this.clearHotspotPollers();
    container.innerHTML = 'Loading...';

    try {
      if (this.hotspotTab === 'active') {
        await this.loadHotspotActiveDevices(container);
      } else if (this.hotspotTab === 'sessions') {
        await this.loadHotspotSessions(container);
      } else {
        await this.loadHotspotHosts(container);
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  clearHotspotPollers() {
    if (this._hostsInterval) {
      clearInterval(this._hostsInterval);
      this._hostsInterval = null;
    }
    if (this._activeInterval) {
      clearInterval(this._activeInterval);
      this._activeInterval = null;
    }
    if (this._sessionsInterval) {
      clearInterval(this._sessionsInterval);
      this._sessionsInterval = null;
    }
  },

  async loadHotspotHosts(container) {
    if (!container) container = document.getElementById('hotspot-tab-content');
    this.clearHotspotPollers();

    try {
      const hosts = await api.getHotspotHosts(this.selectedRouterId);

      if (!hosts || hosts.length === 0) {
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
              </tr>
            </thead>
            <tbody id="hosts-tbody">
              ${this.renderHostsRows(hosts)}
            </tbody>
          </table>
        </div>
      `;

      this._hostsInterval = setInterval(async () => {
        try {
          const freshHosts = await api.getHotspotHosts(this.selectedRouterId);
          const tbody = document.getElementById('hosts-tbody');
          if (tbody) {
            tbody.innerHTML = this.renderHostsRows(freshHosts);
          }
        } catch (err) {
          console.error('Failed to refresh hosts:', err);
        }
      }, 1000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  async loadHotspotActiveDevices(container) {
    if (!container) container = document.getElementById('hotspot-tab-content');
    this.clearHotspotPollers();

    try {
      const devices = this.mapActiveDevices(await api.getActiveDevices(this.selectedRouterId));

      container.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>MAC Address</th>
                <th>IP Address</th>
                <th>Hostname</th>
                <th>User</th>
                <th>Server</th>
                <th>Status</th>
                <th>Uptime</th>
                <th>Session Time Left</th>
                <th>RX Rate</th>
                <th>TX Rate</th>
                <th>Bytes In</th>
                <th>Bytes Out</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="active-devices-tbody">
              ${this.renderActiveDeviceRows(devices)}
            </tbody>
          </table>
        </div>
      `;

      this._activeInterval = setInterval(async () => {
        try {
          const freshDevices = this.mapActiveDevices(await api.getActiveDevices(this.selectedRouterId));
          this.refreshActiveDeviceRows(freshDevices);
        } catch (err) {
          console.error('Failed to refresh active devices:', err);
        }
      }, 1000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  async loadHotspotSessions(container) {
    if (!container) container = document.getElementById('hotspot-tab-content');
    this.clearHotspotPollers();

    try {
      const sessions = await api.getDeviceSessions(this.selectedRouterId);

      if (!sessions || sessions.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No device session tokens issued yet.</p></div>';
        return;
      }

      container.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Current MAC</th>
                <th>Previous MAC</th>
                <th>User</th>
                <th>SSID / Server</th>
                <th>Status</th>
                <th>Remaining</th>
                <th>Online</th>
                <th>First Seen</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="device-sessions-tbody">
              ${this.renderDeviceSessionRows(sessions)}
            </tbody>
          </table>
        </div>
      `;

      this._sessionsInterval = setInterval(async () => {
        try {
          const freshSessions = await api.getDeviceSessions(this.selectedRouterId);
          if (!freshSessions || freshSessions.length === 0) return; // keep last view; a revoke triggers a full reload
          const tbody = document.getElementById('device-sessions-tbody');
          if (tbody) tbody.innerHTML = this.renderDeviceSessionRows(freshSessions);
        } catch (err) {
          console.error('Failed to refresh device sessions:', err);
        }
      }, 1000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  renderDeviceSessionRows(sessions) {
    return (sessions || []).map((s) => {
      const tokenShort = String(s.session_token || '').slice(0, 8) + '…';
      const status = s.status || 'pending';
      const remaining = this.formatSecondsToHMS(s.remaining_seconds || 0);
      const badgeClass = s.is_online ? 'badge-online' : (status === 'expired' ? 'badge-expired' : 'badge-offline');
      return `
        <tr>
          <td><code title="${this.escapeHtml(s.session_token || '')}">${this.escapeHtml(tokenShort)}</code></td>
          <td><code>${this.escapeHtml(s.mac_address || '-')}</code></td>
          <td><code>${this.escapeHtml(s.previous_mac || '-')}</code></td>
          <td>${this.escapeHtml(s.username || '-')}</td>
          <td>${this.escapeHtml(s.hotspot_server || '-')}</td>
          <td><span class="${badgeClass}">${this.escapeHtml(status)}</span></td>
          <td>${remaining}</td>
          <td>${s.is_online ? 'Yes' : 'No'}</td>
          <td>${this.escapeHtml(s.first_seen || '-')}</td>
          <td>${this.escapeHtml(s.last_seen || '-')}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="App.revokeDeviceSession(${this.selectedRouterId}, ${s.id})">Revoke</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  formatSecondsToHMS(secs) {
    const total = Math.max(0, Math.floor(Number(secs) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  async revokeDeviceSession(routerId, sessionId) {
    if (!confirm('Revoke this device session token? The device will need to log in again on its next visit.')) return;
    try {
      await api.deleteDeviceSession(routerId, sessionId);
      const container = document.getElementById('hotspot-tab-content');
      await this.loadHotspotSessions(container);
    } catch (err) {
      alert('Failed to revoke session: ' + err.message);
    }
  },

  mapActiveDevices(devices) {
    return (devices || []).map((conn) => ({
      id: conn.id || '',
      'access-mode': conn['access-mode'] || 'normal',
      'paid-seconds-left': conn['paid-seconds-left'] ?? null,
      'custom-hostname': conn['custom-hostname'] || '',
      '.id': conn['.id'] || '',
      user: conn.user || '',
      address: conn.address || '',
      'mac-address': conn.mac || conn['mac-address'] || '',
      // Operator override first, then the router-reported name (mirrors the backend).
      'host-name': conn['custom-hostname'] || conn.hostname || conn['host-name'] || '-',
      server: conn.server || '',
      uptime: conn.uptime || '',
      'is-active': conn['is-active'] === true,
      'session-time-left': conn['session-time-left'] || '',
      'bytes-in': conn['bytes-in'] || '0',
      'bytes-out': conn['bytes-out'] || '0',
      'rx-rate': conn['rx-rate'] || '0 bps',
      'tx-rate': conn['tx-rate'] || '0 bps',
      'login-by': conn['login-by'] || '',
      'first-seen': conn['first-seen'] || '',
      'last-seen': conn['last-seen'] || '',
      'ended-at': conn['ended-at'] || ''
    }));
  },

  renderHostsRows(hosts) {
    if (!hosts || hosts.length === 0) {
      return '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:2rem">No hotspot hosts found.</td></tr>';
    }

    return hosts.map((h) => `
      <tr>
        <td><code>${this.escapeHtml(h['mac-address'] || '')}</code></td>
        <td>${this.escapeHtml(h.address || '')}</td>
        <td>${this.escapeHtml(h['host-name'] || '-')}</td>
        <td>${this.escapeHtml(h.server || '-')}</td>
        <td>${this.escapeHtml(h.uptime || '-')}</td>
      </tr>
    `).join('');
  },

  renderActiveDeviceRows(devices) {
    if (!devices || devices.length === 0) {
      return '<tr><td colspan="14" style="text-align:center;color:var(--text-muted);padding:2rem">No active devices recorded yet.</td></tr>';
    }

    return devices.map((d) => {
      const isActive = d['is-active'] === true;
      const totalSeconds = this.parseTimeToSeconds(d['session-time-left'] || '');
      const rxRate = d['rx-rate'] || '0 bps';
      const txRate = d['tx-rate'] || '0 bps';

      let countdownClass = '';
      if (isActive && totalSeconds !== Infinity && totalSeconds > 0) {
        if (totalSeconds <= 60) countdownClass = 'countdown-critical';
        else if (totalSeconds <= 300) countdownClass = 'countdown-warning';
      }

      const sessionCell = isActive
        ? `
            <div class="session-countdown ${countdownClass}">
              <div class="countdown-value">${this.formatCountdown(totalSeconds)}</div>
              <div class="countdown-bar">
                <div class="countdown-bar-fill" style="width: ${totalSeconds === Infinity ? 100 : Math.min((totalSeconds / 3600) * 100, 100)}%"></div>
              </div>
            </div>
          `
        : '<span data-field="session" style="color:var(--text-muted)">Session ended</span>';

      const statusCell = isActive
        ? '<span class="device-status device-status-active">Active</span>'
        : '<span class="device-status device-status-offline">Offline</span>';

      const editBtn = `<button class="btn btn-sm btn-outline" onclick="App.editActiveDevice(${parseInt(d.id, 10) || 0}, this)">Edit</button>`;

      const actions = isActive
        ? `${editBtn} ` + (d['.id']
          ? `<button class="btn btn-sm btn-danger" onclick="App.disconnectActiveUser('${d['.id']}', '${this.escapeHtml(d.user || d.address)}')">Disconnect</button>`
          : '')
        : `${editBtn} <button class="btn btn-sm btn-outline" onclick="App.removeStoredActiveDevice(${parseInt(d.id, 10) || 0}, '${this.escapeHtml(d['mac-address'] || d.address || 'device')}')">Remove</button>`;

      const muted = isActive ? '' : ' style="opacity:.6"';

      return `
        <tr data-active-id="${this.escapeHtml(String(d.id ?? ''))}" data-active="${isActive ? '1' : '0'}">
          <td><code>${this.escapeHtml(d['mac-address'] || '')}</code></td>
          <td>${this.escapeHtml(d.address || '')}</td>
          <td>${this.escapeHtml(d['host-name'] || '-')}</td>
          <td>${this.escapeHtml(d.user || '-')}</td>
          <td>${this.escapeHtml(d.server || '-')}</td>
          <td>${statusCell}</td>
          <td data-field="uptime">${this.escapeHtml(d.uptime || '-')}</td>
          <td>${sessionCell}</td>
          <td${muted}>
            <div class="rate-indicator">
              <span class="rate-value" data-rate="rx">${this.escapeHtml(rxRate)}</span>
              <div class="rate-bar">
                <div class="rate-bar-fill rx-fill" data-rate-bar="rx" style="width: ${this.calculateRateBarWidth(rxRate)}%"></div>
              </div>
            </div>
          </td>
          <td${muted}>
            <div class="rate-indicator">
              <span class="rate-value" data-rate="tx">${this.escapeHtml(txRate)}</span>
              <div class="rate-bar">
                <div class="rate-bar-fill tx-fill" data-rate-bar="tx" style="width: ${this.calculateRateBarWidth(txRate)}%"></div>
              </div>
            </div>
          </td>
          <td data-field="bytes-in">${this.formatBytes(parseInt(d['bytes-in'] || '0', 10) || 0)}</td>
          <td data-field="bytes-out">${this.formatBytes(parseInt(d['bytes-out'] || '0', 10) || 0)}</td>
          <td data-field="last-seen">${this.escapeHtml(d['last-seen'] || '-')}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');
  },

  refreshActiveDeviceRows(devices) {
    const tbody = document.getElementById('active-devices-tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr[data-active-id]'));
    const rowKey = (d) => `${d.id}:${d['is-active'] ? 1 : 0}`;
    const domKey = (r) => `${r.dataset.activeId}:${r.dataset.active}`;

    const freshKeys = devices.map(rowKey).join('|');
    const liveKeys = rows.map(domKey).join('|');

    if (freshKeys !== liveKeys) {
      tbody.innerHTML = this.renderActiveDeviceRows(devices);
      return;
    }

    rows.forEach((row, index) => {
      const device = devices[index];
      if (!device) return;

      const uptime = row.querySelector('[data-field="uptime"]');
      if (uptime) uptime.textContent = device.uptime || '-';

      const lastSeen = row.querySelector('[data-field="last-seen"]');
      if (lastSeen) lastSeen.textContent = device['last-seen'] || '-';

      // Ended sessions keep their stored values - only live ones animate.
      if (device['is-active'] !== true) return;

      const totalSeconds = this.parseTimeToSeconds(device['session-time-left'] || '');

      const countdown = row.querySelector('.session-countdown');
      if (countdown) {
        let countdownClass = 'session-countdown';
        if (totalSeconds !== Infinity && totalSeconds > 0) {
          if (totalSeconds <= 60) countdownClass += ' countdown-critical';
          else if (totalSeconds <= 300) countdownClass += ' countdown-warning';
        }
        countdown.className = countdownClass;

        const value = countdown.querySelector('.countdown-value');
        if (value) value.textContent = this.formatCountdown(totalSeconds);

        const fill = countdown.querySelector('.countdown-bar-fill');
        if (fill) fill.style.width = `${totalSeconds === Infinity ? 100 : Math.min((totalSeconds / 3600) * 100, 100)}%`;
      }

      this.updateRateCell(row, 'rx', device['rx-rate']);
      this.updateRateCell(row, 'tx', device['tx-rate']);

      const bytesIn = row.querySelector('[data-field="bytes-in"]');
      if (bytesIn) bytesIn.textContent = this.formatBytes(parseInt(device['bytes-in'] || '0', 10) || 0);

      const bytesOut = row.querySelector('[data-field="bytes-out"]');
      if (bytesOut) bytesOut.textContent = this.formatBytes(parseInt(device['bytes-out'] || '0', 10) || 0);
    });
  },

  async removeStoredActiveDevice(deviceId, label) {
    if (!deviceId) return;
    if (!confirm(`Remove "${label}" from the active devices list?`)) return;

    try {
      await api.deleteActiveDevice(this.selectedRouterId, deviceId);
      this.toast('Device removed', 'success');
      if (this.currentPage === 'radius') {
        this.loadRadiusTab();
      } else {
        this.loadHotspotTab();
      }
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  updateRateCell(row, direction, rate) {
    const value = row.querySelector(`[data-rate="${direction}"]`);
    if (value) value.textContent = rate || '0 bps';

    const fill = row.querySelector(`[data-rate-bar="${direction}"]`);
    if (fill) fill.style.width = `${this.calculateRateBarWidth(rate || '0 bps')}%`;
  },

  normalizeIp(raw) {
    return (raw || '').replace(/:\d+$/, '').replace(/\/\d+$/, '');
  },

  calculateRateBarWidth(rateStr) {
    if (!rateStr || rateStr === '0 bps') return 0;
    
    let bps = 0;
    const match = rateStr.match(/([\d.]+)\s*([kmg]?bps)/i);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      if (unit === 'kbps') bps = value * 1000;
      else if (unit === 'mbps') bps = value * 1000000;
      else if (unit === 'gbps') bps = value * 1000000000;
      else bps = value;
    }
    
    const maxRate = 100000000;
    const percentage = Math.min((bps / maxRate) * 100, 100);
    return percentage;
  },

  parseTimeToSeconds(timeStr) {
    if (!timeStr || timeStr === 'infinity' || timeStr === '') return Infinity;
    
    let seconds = 0;
    const parts = timeStr.match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (parts) {
      const weeks = parseInt(parts[1] || 0);
      const days = parseInt(parts[2] || 0);
      const hours = parseInt(parts[3] || 0);
      const minutes = parseInt(parts[4] || 0);
      const secs = parseInt(parts[5] || 0);
      seconds = (weeks * 7 * 24 * 3600) + (days * 24 * 3600) + (hours * 3600) + (minutes * 60) + secs;
    }
    
    if (seconds === 0 && timeStr.includes(':')) {
      const timeParts = timeStr.split(':');
      if (timeParts.length === 3) {
        seconds = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
      } else if (timeParts.length === 2) {
        seconds = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
      }
    }
    
    return seconds;
  },

  formatCountdown(seconds) {
    if (seconds === Infinity || seconds < 0) return 'Unlimited';
    if (seconds === 0) return 'Expired';
    
    const weeks = Math.floor(seconds / (7 * 24 * 3600));
    const days = Math.floor((seconds % (7 * 24 * 3600)) / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    let result = '';
    if (weeks > 0) result += weeks + 'w ';
    if (days > 0) result += days + 'd ';
    if (hours > 0 || result.length > 0) result += hours.toString().padStart(2, '0') + ':';
    result += minutes.toString().padStart(2, '0') + ':';
    result += secs.toString().padStart(2, '0');
    
    return result.trim();
  },

  // Edit a stored active device's hostname (persistent override).
  async editActiveDevice(deviceId, btn) {
    if (!deviceId) return;

    // Read the current name from the row so we never have to inject it into
    // HTML. The RADIUS table tags the hostname with data-field="hostname"
    // (data-hostname carries the real value); the hotspot table keeps the
    // name in the 3rd column.
    let current = '';
    const row = btn && btn.closest ? btn.closest('tr') : null;
    if (row) {
      const nameEl = row.querySelector('[data-field="hostname"]');
      if (nameEl) {
        current = nameEl.dataset.hostname !== undefined ? nameEl.dataset.hostname : nameEl.textContent.trim();
      } else if (row.children[2]) {
        current = row.children[2].textContent.trim();
      }
      if (current === '-') current = '';
    }

    const value = window.prompt('Hostname for this device (leave blank to clear):', current);
    if (value === null) return;

    try {
      await api.updateActiveDevice(this.selectedRouterId, deviceId, { hostname: value.trim() });
      this.toast('Hostname updated', 'success');
      if (this.currentPage === 'radius') {
        this.loadRadiusTab();
      } else {
        this.loadHotspotTab();
      }
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async disconnectActiveUser(activeId, userName) {
    if (!confirm(`Disconnect user "${userName}"?`)) return;

    try {
      await api.removeActiveConnection(this.selectedRouterId, activeId);
      this.toast('User disconnected', 'success');
      if (this.currentPage === 'radius') {
        this.loadRadiusTab();
      } else {
        this.loadHotspotTab();
      }
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async showAddUserModal() {
    let profiles = [];
    try {
      profiles = await api.getUserProfiles(this.selectedRouterId);
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
      this.loadHotspotTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteHotspotUser(userId) {
    if (!confirm('Remove this hotspot user?')) return;
    try {
      await api.deleteHotspotUser(this.selectedRouterId, userId);
      this.toast('User removed', 'success');
      this.loadHotspotTab();
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
          <div>
            <button class="btn btn-primary btn-sm" onclick="App.showHotspotSetupWizard()" style="margin-right: 8px;">Hotspot Setup</button>
            <button class="btn btn-primary btn-sm" onclick="App.showCreateServerModal()">Add Server</button>
          </div>
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
    let pools = [];
    let profiles = [];

    try { interfaces = await api.getRouterInterfaces(this.selectedRouterId); } catch (err) {}
    try { pools = await api.getAddressPools(this.selectedRouterId); } catch (err) {}
    try { profiles = await api.getHotspotProfiles(this.selectedRouterId); } catch (err) {}

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
          <select name="address-pool" class="form-control">
            <option value="">Select pool...</option>
            ${pools.map((p) => `<option value="${this.escapeHtml(p.name)}" ${p.name === server['address-pool'] ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Profile</label>
          <select name="profile" class="form-control">
            <option value="">Select profile...</option>
            ${profiles.map((p) => `<option value="${this.escapeHtml(p.name)}" ${p.name === server.profile ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
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
    let userProfiles = [];
    try {
      userProfiles = await api.getUserProfiles(this.selectedRouterId);
    } catch (err) {
      // ignore
    }

    this.openModal('Create Server Profile', `
      <form id="create-server-profile-form">
        <h4 style="margin: 0 0 10px 0; color: #666;">General</h4>
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required placeholder="e.g. hs-profile-1">
        </div>
        <div class="form-group">
          <label>Hotspot Address</label>
          <input type="text" name="hotspot-address" placeholder="e.g. 192.168.1.1">
        </div>
        <div class="form-group">
          <label>DNS Name</label>
          <input type="text" name="dns-name" placeholder="e.g. hotspot.example.com">
        </div>
        <div class="form-group">
          <label>HTML Directory</label>
          <input type="text" name="html-directory" value="hotspot" placeholder="e.g. hotspot">
        </div>
        <div class="form-group">
          <label>HTML Directory Override</label>
          <input type="text" name="html-directory-override" placeholder="e.g. flash/hotspot">
        </div>
        <div class="form-group">
          <label>HTTP Proxy</label>
          <input type="text" name="http-proxy" placeholder="e.g. 192.168.1.1">
        </div>
        <div class="form-group">
          <label>SMTP Server</label>
          <input type="text" name="smtp-server" placeholder="e.g. mail.example.com">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="install-queue" value="yes"> Install Hotspot Queue
          </label>
        </div>

        <h4 style="margin: 20px 0 10px 0; color: #666;">Login</h4>
        <div class="form-group">
          <label>Login By</label>
          <div style="display: flex; gap: 15px; flex-wrap: wrap;">
            <label><input type="checkbox" name="login-by-mac" value="yes"> MAC</label>
            <label><input type="checkbox" name="login-by-cookie" value="yes" checked> Cookie</label>
            <label><input type="checkbox" name="login-by-http-chap" value="yes" checked> HTTP CHAP</label>
            <label><input type="checkbox" name="login-by-https" value="yes"> HTTPS</label>
            <label><input type="checkbox" name="login-by-http-pap" value="yes" checked> HTTP PAP</label>
            <label><input type="checkbox" name="login-by-trial" value="yes"> Trial</label>
          </div>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="mac-cookie" value="yes"> MAC Cookie
          </label>
        </div>
        <div class="form-group">
          <label>MAC Auth. Mode</label>
          <select name="mac-auth-mode" class="form-control">
            <option value="mac-as-username">MAC as username</option>
            <option value="mac-as-password">MAC as password</option>
            <option value="mac-as-username-and-password">MAC as username and password</option>
          </select>
        </div>
        <div class="form-group">
          <label>MAC Auth. Password</label>
          <input type="text" name="mac-auth-password" placeholder="MAC auth password">
        </div>
        <div class="form-group">
          <label>HTTP Cookie Lifetime</label>
          <input type="text" name="http-cookie-lifetime" value="3d 00:00:00" placeholder="e.g. 3d 00:00:00">
        </div>
        <div class="form-group">
          <label>SSL Certificate</label>
          <input type="text" name="ssl-certificate" value="none" placeholder="e.g. none">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="split-user-domain" value="yes"> Split User Domain
          </label>
        </div>
        <div class="form-group">
          <label>Trial Uptime Limit</label>
          <input type="text" name="trial-uptime-limit" value="00:30:00" placeholder="e.g. 00:30:00">
        </div>
        <div class="form-group">
          <label>Trial Uptime Reset</label>
          <input type="text" name="trial-uptime-reset" value="1d 00:00:00" placeholder="e.g. 1d 00:00:00">
        </div>
        <div class="form-group">
          <label>Trial User Profile</label>
          <select name="trial-user-profile" class="form-control">
            <option value="">Select profile...</option>
            ${userProfiles.map((p) => `<option value="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
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
          
          const loginByValues = [];
          if (data['login-by-mac']) loginByValues.push('mac');
          if (data['login-by-cookie']) loginByValues.push('cookie');
          if (data['login-by-http-chap']) loginByValues.push('http-chap');
          if (data['login-by-https']) loginByValues.push('https');
          if (data['login-by-http-pap']) loginByValues.push('http-pap');
          if (data['login-by-trial']) loginByValues.push('trial');
          data['login-by'] = loginByValues.join(',');
          
          delete data['login-by-mac'];
          delete data['login-by-cookie'];
          delete data['login-by-http-chap'];
          delete data['login-by-https'];
          delete data['login-by-http-pap'];
          delete data['login-by-trial'];
          
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

    let userProfiles = [];
    try {
      userProfiles = await api.getUserProfiles(this.selectedRouterId);
    } catch (err) {
      // ignore
    }

    const loginBy = profile['login-by'] || '';
    const loginByList = loginBy.split(',').map(s => s.trim());

    this.openModal('Edit Server Profile', `
      <form id="edit-server-profile-form">
        <h4 style="margin: 0 0 10px 0; color: #666;">General</h4>
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required value="${this.escapeHtml(profile.name || '')}">
        </div>
        <div class="form-group">
          <label>Hotspot Address</label>
          <input type="text" name="hotspot-address" value="${this.escapeHtml(profile['hotspot-address'] || '')}">
        </div>
        <div class="form-group">
          <label>DNS Name</label>
          <input type="text" name="dns-name" value="${this.escapeHtml(profile['dns-name'] || '')}">
        </div>
        <div class="form-group">
          <label>HTML Directory</label>
          <input type="text" name="html-directory" value="${this.escapeHtml(profile['html-directory'] || '')}">
        </div>
        <div class="form-group">
          <label>HTML Directory Override</label>
          <input type="text" name="html-directory-override" value="${this.escapeHtml(profile['html-directory-override'] || '')}">
        </div>
        <div class="form-group">
          <label>HTTP Proxy</label>
          <input type="text" name="http-proxy" value="${this.escapeHtml(profile['http-proxy'] || '')}">
        </div>
        <div class="form-group">
          <label>SMTP Server</label>
          <input type="text" name="smtp-server" value="${this.escapeHtml(profile['smtp-server'] || '')}">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="install-queue" value="yes" ${profile['install-queue'] === 'true' ? 'checked' : ''}> Install Hotspot Queue
          </label>
        </div>

        <h4 style="margin: 20px 0 10px 0; color: #666;">Login</h4>
        <div class="form-group">
          <label>Login By</label>
          <div style="display: flex; gap: 15px; flex-wrap: wrap;">
            <label><input type="checkbox" name="login-by-mac" value="yes" ${loginByList.includes('mac') ? 'checked' : ''}> MAC</label>
            <label><input type="checkbox" name="login-by-cookie" value="yes" ${loginByList.includes('cookie') ? 'checked' : ''}> Cookie</label>
            <label><input type="checkbox" name="login-by-http-chap" value="yes" ${loginByList.includes('http-chap') ? 'checked' : ''}> HTTP CHAP</label>
            <label><input type="checkbox" name="login-by-https" value="yes" ${loginByList.includes('https') ? 'checked' : ''}> HTTPS</label>
            <label><input type="checkbox" name="login-by-http-pap" value="yes" ${loginByList.includes('http-pap') ? 'checked' : ''}> HTTP PAP</label>
            <label><input type="checkbox" name="login-by-trial" value="yes" ${loginByList.includes('trial') ? 'checked' : ''}> Trial</label>
          </div>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="mac-cookie" value="yes" ${profile['mac-cookie'] === 'true' ? 'checked' : ''}> MAC Cookie
          </label>
        </div>
        <div class="form-group">
          <label>MAC Auth. Mode</label>
          <select name="mac-auth-mode" class="form-control">
            <option value="mac-as-username" ${profile['mac-auth-mode'] === 'mac-as-username' ? 'selected' : ''}>MAC as username</option>
            <option value="mac-as-password" ${profile['mac-auth-mode'] === 'mac-as-password' ? 'selected' : ''}>MAC as password</option>
            <option value="mac-as-username-and-password" ${profile['mac-auth-mode'] === 'mac-as-username-and-password' ? 'selected' : ''}>MAC as username and password</option>
          </select>
        </div>
        <div class="form-group">
          <label>MAC Auth. Password</label>
          <input type="text" name="mac-auth-password" value="${this.escapeHtml(profile['mac-auth-password'] || '')}">
        </div>
        <div class="form-group">
          <label>HTTP Cookie Lifetime</label>
          <input type="text" name="http-cookie-lifetime" value="${this.escapeHtml(profile['http-cookie-lifetime'] || '3d 00:00:00')}">
        </div>
        <div class="form-group">
          <label>SSL Certificate</label>
          <input type="text" name="ssl-certificate" value="${this.escapeHtml(profile['ssl-certificate'] || 'none')}">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="split-user-domain" value="yes" ${profile['split-user-domain'] === 'true' ? 'checked' : ''}> Split User Domain
          </label>
        </div>
        <div class="form-group">
          <label>Trial Uptime Limit</label>
          <input type="text" name="trial-uptime-limit" value="${this.escapeHtml(profile['trial-uptime-limit'] || '00:30:00')}">
        </div>
        <div class="form-group">
          <label>Trial Uptime Reset</label>
          <input type="text" name="trial-uptime-reset" value="${this.escapeHtml(profile['trial-uptime-reset'] || '1d 00:00:00')}">
        </div>
        <div class="form-group">
          <label>Trial User Profile</label>
          <select name="trial-user-profile" class="form-control">
            <option value="">Select profile...</option>
            ${userProfiles.map((p) => `<option value="${this.escapeHtml(p.name)}" ${profile['trial-user-profile'] === p.name ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
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
          
          const loginByValues = [];
          if (data['login-by-mac']) loginByValues.push('mac');
          if (data['login-by-cookie']) loginByValues.push('cookie');
          if (data['login-by-http-chap']) loginByValues.push('http-chap');
          if (data['login-by-https']) loginByValues.push('https');
          if (data['login-by-http-pap']) loginByValues.push('http-pap');
          if (data['login-by-trial']) loginByValues.push('trial');
          data['login-by'] = loginByValues.join(',');
          
          delete data['login-by-mac'];
          delete data['login-by-cookie'];
          delete data['login-by-http-chap'];
          delete data['login-by-https'];
          delete data['login-by-http-pap'];
          delete data['login-by-trial'];
          
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
    let pools = [];
    try {
      pools = await api.getAddressPools(this.selectedRouterId);
    } catch (err) {
      // ignore
    }

    this.openModal('Create User Profile', `
      <form id="create-user-profile-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required placeholder="e.g. 1hour-10M">
        </div>
        <div class="form-group">
          <label>Address Pool</label>
          <select name="address-pool" class="form-control">
            <option value="">None</option>
            ${pools.map((p) => `<option value="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
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

    let pools = [];
    try {
      pools = await api.getAddressPools(this.selectedRouterId);
    } catch (err) {
      // ignore
    }

    this.openModal('Edit User Profile', `
      <form id="edit-user-profile-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required value="${this.escapeHtml(profile.name || '')}">
        </div>
        <div class="form-group">
          <label>Address Pool</label>
          <select name="address-pool" class="form-control">
            <option value="">None</option>
            ${pools.map((p) => `<option value="${this.escapeHtml(p.name)}" ${p.name === profile['address-pool'] ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
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

  // The row button has been here longer than this method: without it the click
  // threw and the Delete looked pressed but did nothing. RouterOS itself refuses
  // a profile that users or server profiles still reference, so the router's own
  // error is what the operator gets back.
  async deleteUserProfile(profileId) {
    if (!confirm('Delete this hotspot user profile from the router?')) return;
    try {
      await api.deleteUserProfile(this.selectedRouterId, profileId);
      this.toast('User profile deleted', 'success');
      this.loadHotspotSettingsTab();
    } catch (err) { this.toast(err.message, 'error'); }
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
    let pools = [];
    let profiles = [];

    try {
      interfaces = await api.getRouterInterfaces(this.selectedRouterId);
    } catch (err) {
      this.toast('Could not fetch interfaces', 'error');
    }

    try {
      pools = await api.getAddressPools(this.selectedRouterId);
    } catch (err) {
      // ignore
    }

    try {
      profiles = await api.getHotspotProfiles(this.selectedRouterId);
    } catch (err) {
      // ignore
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
          <select name="address-pool" class="form-control">
            <option value="">Select pool...</option>
            ${pools.map((p) => `<option value="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Profile</label>
          <select name="profile" class="form-control">
            <option value="">Select profile...</option>
            ${profiles.map((p) => `<option value="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
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

  async showHotspotSetupWizard() {
    let interfaces = [];
    try {
      interfaces = await api.getRouterInterfaces(this.selectedRouterId);
    } catch (err) {
      this.toast('Could not fetch interfaces', 'error');
    }

    const step = { current: 0 };
    const data = { interface: '', address: '', poolStart: '', poolEnd: '', dnsServers: '8.8.8.8,8.8.4.4', dnsName: '', adminUsername: '', adminPassword: '' };
    const steps = [
      { title: 'Select Interface', desc: 'Select the interface to run the HotSpot on.' },
      { title: 'IP Address', desc: 'Set the IP address and network mask for the HotSpot interface.' },
      { title: 'Address Pool', desc: 'Define the IP address pool for HotSpot users.' },
      { title: 'DNS Servers', desc: 'Set the DNS servers for HotSpot clients.' },
      { title: 'DNS Name', desc: 'Set the DNS name for the HotSpot redirect.' },
      { title: 'Admin User', desc: 'Create the default admin user for HotSpot management.' },
    ];

    const saveCurrentStep = () => {
      if (step.current === 0) { const el = document.getElementById('hs-wiz-interface'); data.interface = el ? el.value : ''; }
      else if (step.current === 1) {
        const el = document.getElementById('hs-wiz-address');
        let v = (el ? el.value : '').trim();
        // RouterOS treats a bare address as /32 - no subnet, no DHCP leases.
        // Complete it the way the placeholder suggests.
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) v += '/24';
        data.address = v;
      }
      else if (step.current === 2) { const s = document.getElementById('hs-wiz-pool-start'); const e = document.getElementById('hs-wiz-pool-end'); data.poolStart = (s ? s.value : '').trim(); data.poolEnd = (e ? e.value : '').trim(); }
      else if (step.current === 3) { const el = document.getElementById('hs-wiz-dns'); data.dnsServers = el ? el.value : ''; }
      else if (step.current === 4) { const el = document.getElementById('hs-wiz-dns-name'); data.dnsName = el ? el.value : ''; }
      else if (step.current === 5) { const u = document.getElementById('hs-wiz-user'); const p = document.getElementById('hs-wiz-pass'); data.adminUsername = u ? u.value : ''; data.adminPassword = p ? p.value : ''; }
    };

    const validateStep = () => {
      saveCurrentStep();
      const checks = [
        [!data.interface, 'Please select an interface'],
        [!data.address, 'Please enter an IP address'],
        [!data.poolStart || !data.poolEnd, 'Please enter pool start and end addresses'],
        [!data.dnsServers, 'Please enter DNS servers'],
        [!data.dnsName, 'Please enter a DNS name'],
        [!data.adminUsername || !data.adminPassword, 'Please enter admin username and password'],
      ];
      if (step.current === 1) {
        const m = data.address.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
        const prefix = m ? parseInt(m[2], 10) : 0;
        if (!m || m[1].split('.').some((o) => Number(o) > 255) || prefix < 8 || prefix > 30) {
          this.toast('Enter a valid address with mask, e.g. 10.0.100.1/24', 'error');
          return false;
        }
      }
      if (step.current === 2) {
        const ipv4 = /^(\d{1,3}(\.\d{1,3}){3})$/;
        const bad = [data.poolStart, data.poolEnd].some((v) => !ipv4.test(v) || v.split('.').some((o) => Number(o) > 255));
        if (bad) { this.toast('Pool addresses must be plain IPv4 addresses, e.g. 10.0.100.10', 'error'); return false; }
      }
      const fail = checks[step.current];
      if (fail && fail[0]) { this.toast(fail[1], 'error'); return false; }
      return true;
    };

    const renderStepContent = () => {
      const s = steps[step.current];
      const total = steps.length;
      const num = step.current + 1;
      let fields = '';
      if (step.current === 0) {
        fields = `<div class="form-group"><label>HotSpot Interface</label><select id="hs-wiz-interface" class="form-control" required><option value="">Select interface...</option>${interfaces.map((i) => `<option value="${this.escapeHtml(i.name)}" ${data.interface === i.name ? 'selected' : ''}>${this.escapeHtml(i.name)}</option>`).join('')}</select></div>`;
      } else if (step.current === 1) {
        fields = `<div class="form-group"><label>IP Address</label><input type="text" id="hs-wiz-address" value="${this.escapeHtml(data.address)}" placeholder="e.g. 10.0.0.1/24" required></div>`;
      } else if (step.current === 2) {
        fields = `<div class="form-group"><label>Pool Start Address</label><input type="text" id="hs-wiz-pool-start" value="${this.escapeHtml(data.poolStart)}" placeholder="e.g. 10.0.0.10" required></div><div class="form-group"><label>Pool End Address</label><input type="text" id="hs-wiz-pool-end" value="${this.escapeHtml(data.poolEnd)}" placeholder="e.g. 10.0.0.254" required></div>`;
      } else if (step.current === 3) {
        fields = `<div class="form-group"><label>DNS Servers</label><input type="text" id="hs-wiz-dns" value="${this.escapeHtml(data.dnsServers)}" placeholder="e.g. 8.8.8.8,8.8.4.4" required></div>`;
      } else if (step.current === 4) {
        fields = `<div class="form-group"><label>DNS Name</label><input type="text" id="hs-wiz-dns-name" value="${this.escapeHtml(data.dnsName)}" placeholder="e.g. hotspot.local" required></div>`;
      } else if (step.current === 5) {
        fields = `<div class="form-group"><label>Admin Username</label><input type="text" id="hs-wiz-user" value="${this.escapeHtml(data.adminUsername)}" placeholder="e.g. admin" required></div><div class="form-group"><label>Admin Password</label><input type="password" id="hs-wiz-pass" value="${this.escapeHtml(data.adminPassword)}" placeholder="Password" required></div>`;
      }
      return `<div style="margin-bottom:16px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:13px;color:var(--text-muted)">Step ${num} of ${total}</span><div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${(num/total)*100}%;height:100%;background:var(--primary-color);border-radius:2px;transition:width 0.2s"></div></div></div><h3 style="margin:0 0 4px 0;font-size:16px">${s.title}</h3><p style="margin:0;font-size:13px;color:var(--text-muted)">${s.desc}</p></div>${fields}`;
    };

    const render = () => {
      const isLast = step.current === steps.length - 1;
      this.openModal('HotSpot Setup', renderStepContent(), [
        { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
        {
          label: 'Back',
          class: 'btn btn-outline',
          action: () => {
            if (step.current > 0) { saveCurrentStep(); step.current--; render(); }
          },
        },
        {
          label: isLast ? 'Finish' : 'Next',
          class: 'btn btn-primary',
          action: async () => {
            if (!validateStep()) return;
            if (!isLast) { step.current++; render(); }
            else {
              try {
                await api.setupHotspot(this.selectedRouterId, data);
                this.closeModal();
                this.toast('HotSpot setup complete', 'success');
                this.loadHotspotSettingsTab();
              } catch (err) {
                this.toast(err.message, 'error');
              }
            }
          },
        },
      ]);
    };

    render();
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
    const connected = routers.filter((r) => r.connected);

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
            ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)} (${this.escapeHtml(r.host)})${r.connected ? '' : ' - offline'}</option>`).join('')}
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
        delete data['l2-mtu'];
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
        <div class="form-group"><label>L2 MTU</label><input type="text" value="${this.escapeHtml(vlan['l2-mtu'] || '-')}" readonly class="form-control"></div>
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
        if (!data['arp-timeout']) delete data['arp-timeout'];
        delete data['l2-mtu'];
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

    const currentRouter = routers.find((r) => r.id === this.selectedRouterId);
    const isRadiusMode = currentRouter?.auth_mode === 'radius';

    if (!isRadiusMode && this.voucherTab === 'radius') {
      this.voucherTab = 'vouchers';
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Voucher Management</h3>
          <div style="display:flex;gap:0.5rem">
            <select id="voucher-router-select" class="btn btn-outline">
              ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="tabs">
          <button class="tab ${this.voucherTab === 'vouchers' ? 'active' : ''}" data-tab="vouchers">Vouchers</button>
          ${isRadiusMode ? `<button class="tab ${this.voucherTab === 'radius' ? 'active' : ''}" data-tab="radius">RADIUS Vouchers</button>` : ''}
        </div>
        <div id="voucher-tab-content">Loading...</div>
      </div>
    `;

    document.getElementById('voucher-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadVoucherTab();
    });

    document.querySelectorAll('.tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.voucherTab = tab.dataset.tab;
        document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.loadVoucherTab();
      });
    });

    this.loadVoucherTab();
  },

  async loadVoucherTab() {
    const container = document.getElementById('voucher-tab-content');
    if (!container) return;
    container.innerHTML = 'Loading...';

    try {
      if (this.voucherTab === 'radius') {
        await this.loadRadiusVouchers(container);
      } else {
        await this.loadVouchersContent(container);
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  async loadRadiusVouchers(container) {
    const data = await api.getVouchers(this.selectedRouterId, { type: 'radius' });
    const vouchers = data.vouchers || [];

    const availableCount = vouchers.filter(v => !v.is_used).length;
    const usedCount = vouchers.filter(v => v.is_used).length;

    let headerHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h4 style="font-size:0.95rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">RADIUS Vouchers (${vouchers.length})</h4>
        <button class="btn btn-primary btn-sm" onclick="App.showGenerateRadiusVouchersModal()">Generate Vouchers</button>
      </div>
    `;

    const summaryHtml = `
      <div class="voucher-summary" style="margin-bottom:1.5rem">
        <div class="voucher-summary-grid">
          <div class="voucher-summary-card voucher-summary-available">
            <div class="voucher-summary-icon">${uiIcon('clock')}</div>
            <div class="voucher-summary-content">
              <div class="voucher-summary-value">${availableCount}</div>
              <div class="voucher-summary-label">Available</div>
            </div>
          </div>
          <div class="voucher-summary-card voucher-summary-used">
            <div class="voucher-summary-icon">${uiIcon('check-circle')}</div>
            <div class="voucher-summary-content">
              <div class="voucher-summary-value">${usedCount}</div>
              <div class="voucher-summary-label">Used</div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (vouchers.length === 0) {
      container.innerHTML = headerHtml + summaryHtml + '<div class="empty-state"><p>No RADIUS vouchers generated yet.</p></div>';
      return;
    }

    container.innerHTML = headerHtml + summaryHtml + `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Username</th>
              <th>RADIUS Profile</th>
              <th>Duration</th>
              <th>Price</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${vouchers.map((v) => {
              const created = v.created_at ? new Date(v.created_at).toLocaleDateString() : '';
              const profileName = v.radius_profile_name || '-';
              const dur = v.duration_minutes ? `${Math.floor(v.duration_minutes / 1440)}d ${Math.floor((v.duration_minutes % 1440) / 60)}h ${v.duration_minutes % 60}m` : 'Unlimited';
              const price = Number(v.price) > 0 ? `₱${Number(v.price).toFixed(2)}` : '—';
              let statusBadge;
              if (!v.is_used) {
                statusBadge = '<span class="status-badge voucher-available">Available</span>';
              } else {
                statusBadge = '<span class="status-badge voucher-used">Used</span>';
              }
              return `
                <tr>
                  <td><strong>${this.escapeHtml(v.code)}</strong></td>
                  <td>${this.escapeHtml(v.username)}</td>
                  <td>${this.escapeHtml(profileName)}</td>
                  <td>${dur}</td>
                  <td>${price}</td>
                  <td>${statusBadge}</td>
                  <td>${created}</td>
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
  },

  async showGenerateRadiusVouchersModal() {
    const radiusProfiles = await api.getRadiusProfiles(this.selectedRouterId);

    this.openModal('Generate RADIUS Vouchers', `
      <form id="generate-radius-vouchers-form">
        <div class="form-group">
          <label>Number of Vouchers</label>
          <input type="number" name="count" value="10" min="1" max="100">
        </div>
        <div class="form-group">
          <label>Code Length</label>
          <input type="number" name="codeLength" value="8" min="4" max="20">
        </div>
        <div class="form-group">
          <label>RADIUS Profile</label>
          <select name="radiusProfileId">
            <option value="">-- No profile --</option>
            ${radiusProfiles.map((p) => `<option value="${p.id}" ${p.is_default ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Uptime Limit (optional)</label>
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
          <label>Price per Voucher (₱, optional)</label>
          <input type="number" name="price" placeholder="e.g. 5" min="0" step="0.01">
        </div>
        <div class="form-group">
          <label>Code Prefix (optional)</label>
          <input type="text" name="prefix" placeholder="e.g. WIFI">
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
            <input type="checkbox" name="usePassword" style="width:auto;margin:0">
            Use Password (auto-generated)
          </label>
        </div>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Generate', class: 'btn btn-primary', action: () => this.submitGenerateRadiusVouchers() },
    ]);
  },

  async submitGenerateRadiusVouchers() {
    const form = document.getElementById('generate-radius-vouchers-form');
    try {
      const days = parseInt(form.durationDays.value) || 0;
      const hours = parseInt(form.durationHours.value) || 0;
      const mins = parseInt(form.durationMins.value) || 0;
      const totalMinutes = days * 24 * 60 + hours * 60 + mins;

      const result = await api.generateVouchers(this.selectedRouterId, {
        count: parseInt(form.count.value),
        codeLength: parseInt(form.codeLength.value) || 8,
        radiusProfileId: form.radiusProfileId.value ? parseInt(form.radiusProfileId.value) : null,
        durationMinutes: totalMinutes > 0 ? totalMinutes : null,
        prefix: form.prefix.value || undefined,
        usePassword: form.usePassword.checked || false,
        price: form.price.value ? parseFloat(form.price.value) : 0,
      });

      this.closeModal();
      this.toast(`Generated ${result.vouchers?.length || 0} RADIUS voucher(s)`, 'success');
      this.loadVoucherTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async loadVouchersContent(container) {
    try {
      const data = await api.getVouchers(this.selectedRouterId, { type: 'api' });
      const vouchers = data.vouchers || [];
      const routerUsers = data.routerUsers || [];

      const availableCount = vouchers.filter(v => !v.is_used).length;

      const activeUsernames = new Set(
        routerUsers.filter(u => u.disabled !== 'true').map(u => u.name)
      );

      const inUseCount = vouchers.filter(v => v.is_used && activeUsernames.has(v.username)).length;
      const usedCount = vouchers.filter(v => v.is_used && !activeUsernames.has(v.username)).length;

      let html = '';

      html += `
        <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
          <button class="btn btn-primary btn-sm" onclick="App.showGenerateVouchersModal()">Generate Vouchers</button>
        </div>
      `;

      html += `
        <div class="voucher-summary" style="margin-bottom:1.5rem">
          <div class="voucher-summary-grid">
            <div class="voucher-summary-card voucher-summary-available">
              <div class="voucher-summary-icon">${uiIcon('clock')}</div>
              <div class="voucher-summary-content">
                <div class="voucher-summary-value">${availableCount}</div>
                <div class="voucher-summary-label">Available</div>
              </div>
            </div>
            <div class="voucher-summary-card voucher-summary-inuse">
              <div class="voucher-summary-icon">${uiIcon('ban')}</div>
              <div class="voucher-summary-content">
                <div class="voucher-summary-value">${inUseCount}</div>
                <div class="voucher-summary-label">In Use</div>
              </div>
            </div>
            <div class="voucher-summary-card voucher-summary-used">
              <div class="voucher-summary-icon">${uiIcon('check-circle')}</div>
              <div class="voucher-summary-content">
                <div class="voucher-summary-value">${usedCount}</div>
                <div class="voucher-summary-label">Used</div>
              </div>
            </div>
          </div>
        </div>
      `;

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
                  <th>Price</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${vouchers.map((v) => {
                  const dur = v.duration_minutes ? `${Math.floor(v.duration_minutes / 60)}h ${v.duration_minutes % 60}m` : 'Unlimited';
                  const price = Number(v.price) > 0 ? `₱${Number(v.price).toFixed(2)}` : '—';

                  const isActive = routerUsers.some(u => u.name === v.username && u.disabled !== 'true');
                  let statusBadge, statusIcon;

                  if (!v.is_used) {
                    statusBadge = '<span class="status-badge voucher-available">Available</span>';
                    statusIcon = uiIcon('clock');
                  } else if (isActive) {
                    statusBadge = '<span class="status-badge voucher-inuse">In Use</span>';
                    statusIcon = uiIcon('activity');
                  } else {
                    statusBadge = '<span class="status-badge voucher-used">Used</span>';
                    statusIcon = uiIcon('check-circle');
                  }
                  
                  return `
                  <tr>
                    <td><strong>${this.escapeHtml(v.code)}</strong></td>
                    <td>${this.escapeHtml(v.username)}</td>
                    <td>${this.escapeHtml(v.profile)}</td>
                    <td>${dur}</td>
                    <td>${price}</td>
                    <td>
                      <div class="voucher-status">
                        <span class="voucher-status-icon">${statusIcon}</span>
                        ${statusBadge}
                      </div>
                    </td>
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

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  async showGenerateVouchersModal() {
    let profileOptions = '<option value="default">default</option>';
    let profileError = null;

    try {
      const profiles = await api.getUserProfiles(this.selectedRouterId);
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
          <label>Price per Voucher (₱, optional)</label>
          <input type="number" name="price" placeholder="e.g. 5" min="0" step="0.01">
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
        price: form.price.value ? parseFloat(form.price.value) : 0,
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
      this.loadVoucherTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteVoucher(voucherId) {
    if (!confirm('Delete this voucher?')) return;
    try {
      await api.deleteVoucher(this.selectedRouterId, voucherId);
      this.toast('Voucher deleted', 'success');
      this.loadVoucherTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async renderRadius() {
    const content = document.getElementById('page-content');
    const routers = await api.getRouters();
    const radiusRouters = routers.filter((r) => r.auth_mode === 'radius');

    if (radiusRouters.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <h3>No RADIUS routers configured</h3>
          <p>Set a router's auth mode to RADIUS in the Routers page to manage RADIUS profiles and sessions.</p>
        </div>`;
      return;
    }

    if (!this.selectedRouterId || !radiusRouters.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = radiusRouters[0].id;
    }

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>RADIUS Management</h3>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <button class="btn btn-outline" id="radius-purge-local" title="Remove local hotspot device users (MAC- or rate-named) so they can't shadow RADIUS">Purge local device users</button>
            <button class="btn btn-outline" id="radius-assign-default" title="Assign the default RADIUS profile to every account that has none">Assign default profile</button>
            <select id="radius-local-mode" class="btn btn-outline" title="RADIUS user mode for this router">
              <option value="0">Pure RADIUS</option>
              <option value="1">Hybrid (local users)</option>
            </select>
            <select id="radius-router-select" class="btn btn-outline">
              ${radiusRouters.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="tabs">
          <button class="tab ${this.radiusTab === 'profiles' ? 'active' : ''}" data-tab="profiles">Profiles</button>
          <button class="tab ${this.radiusTab === 'sessions' ? 'active' : ''}" data-tab="sessions">Sessions</button>
          <button class="tab ${this.radiusTab === 'active' ? 'active' : ''}" data-tab="active">Active</button>
          <button class="tab ${this.radiusTab === 'offline' ? 'active' : ''}" data-tab="offline">Offline Devices<span id="radius-offline-tab-badge" class="radius-tab-badge" style="display:none">0</span></button>
          <button class="tab ${this.radiusTab === 'logs' ? 'active' : ''}" data-tab="logs">Logs</button>
          <button class="tab ${this.radiusTab === 'session-settings' ? 'active' : ''}" data-tab="session-settings">Session Settings</button>
        </div>
        <div id="radius-tab-content">Loading...</div>
      </div>
    `;

    document.getElementById('radius-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadRadiusTab();
    });

    const localModeSel = document.getElementById('radius-local-mode');
    const selRouter = radiusRouters.find((r) => r.id === this.selectedRouterId);
    if (localModeSel && selRouter) localModeSel.value = Number(selRouter.radius_local_users) === 1 ? '1' : '0';

    document.getElementById('radius-local-mode').addEventListener('change', async (e) => {
      const hybrid = parseInt(e.target.value, 10) ? 1 : 0;
      try {
        await api.updateRouter(this.selectedRouterId, { radius_local_users: hybrid });
        this.toast(hybrid ? 'Hybrid RADIUS mode (reuses local users)' : 'Pure RADIUS mode (no local users)', 'success');
      } catch (err) {
        this.toast(err.message, 'error');
      }
    });

    document.getElementById('radius-assign-default').addEventListener('click', async () => {
      if (!confirm('Assign the default RADIUS profile to every account on this router that has none?')) return;
      try {
        const r = await api.assignDefaultRadiusProfile(this.selectedRouterId);
        this.toast(r.message || 'Done', 'success');
        this.loadRadiusTab();
      } catch (err) {
        this.toast(err.message, 'error');
      }
    });

    document.getElementById('radius-purge-local').addEventListener('click', async () => {
      if (!confirm('Remove all LOCAL hotspot users whose name is a MAC from this router? In RADIUS mode accounts live in the panel, so devices then authenticate through RADIUS only. Connected devices must reconnect.')) return;
      try {
        const r = await api.purgeLocalMacUsers(this.selectedRouterId);
        this.toast(r.message || 'Done', 'success');
      } catch (err) {
        this.toast(err.message, 'error');
      }
    });

    document.querySelectorAll('#radius-tab-content').forEach(() => {});
    content.querySelectorAll('.tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.radiusTab = tab.dataset.tab;
        content.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.loadRadiusTab();
      });
    });

    this.loadRadiusTab();
    // The Offline Devices badge is filled even when another tab is opened first.
    if (this.radiusTab !== 'active' && this.radiusTab !== 'offline') this.refreshRadiusOfflineBadge();
  },

  async loadRadiusTab() {
    const container = document.getElementById('radius-tab-content');
    if (!container) return;
    container.innerHTML = 'Loading...';

    try {
      if (this.radiusTab === 'profiles') {
        await this.loadRadiusProfiles(container);
      } else if (this.radiusTab === 'sessions') {
        await this.loadRadiusSessions(container);
      } else if (this.radiusTab === 'active') {
        await this.loadRadiusActiveSessions(container);
      } else if (this.radiusTab === 'offline') {
        await this.loadRadiusOfflineDevices(container);
      } else if (this.radiusTab === 'logs') {
        await this.loadRadiusLogs(container);
      } else if (this.radiusTab === 'session-settings') {
        await this.loadRadiusSessionSettings(container);
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  // Tab switching from markup (notes, toolbar buttons) goes through here so the
  // tab strip, the pollers and the content always stay in sync.
  openRadiusTab(tab) {
    this.radiusTab = tab;
    const container = document.getElementById('radius-tab-content');
    const card = container && container.parentElement;
    if (card) {
      card.querySelectorAll('.tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    }
    this.loadRadiusTab();
  },

  // RADIUS > Session Settings: how tracked time behaves when a phone leaves
  // the hotspot. The flag is read by the 5s device sync, so saving here takes
  // effect on the next tick.
  async loadRadiusSessionSettings(container) {
    const s = await api.getRadiusSessionSettings();
    const on = !!s.autoPauseOffline;
    const paused = Number(s.pausedAccounts) || 0;
    const offline = Number(s.offlineSessions) || 0;

    container.innerHTML = `
      <div style="padding:1.25rem;max-width:820px">
        <label class="pay-toggle" style="cursor:pointer">
          <span class="pay-toggle-text">
            <span class="pay-toggle-title">Auto-pause when a device goes offline</span>
            <span class="pay-toggle-sub">Freezes the remaining paid time as soon as the phone drops off the hotspot. When it comes back the portal offers RESUME with exactly that balance. Off: the clock keeps running while the device is away.</span>
          </span>
          <input type="checkbox" id="radius-auto-pause" ${on ? 'checked' : ''}>
        </label>

        <div class="stat-sub" style="display:flex;flex-wrap:wrap;gap:1.25rem;margin-top:1rem">
          <span>Auto-pause: <strong style="color:${on ? 'var(--success)' : 'var(--text-muted)'}">${on ? 'Enabled' : 'Disabled'}</strong></span>
          <span><strong>${paused}</strong> account${paused === 1 ? '' : 's'} waiting on RESUME</span>
          <span><strong>${offline}</strong> offline session${offline === 1 ? '' : 's'} holding time</span>
        </div>

        <p class="stat-sub" style="margin-top:1rem;line-height:1.55">
          Covers RADIUS and coin-insert accounts. The check runs from the panel's 5-second device sync and only while the router is reachable, so a router outage never pauses the whole shop; a phone that leaves the hotspot is frozen on the next tick. Customers resume from the captive portal, so frozen time is never lost.
        </p>
      </div>
    `;

    const toggle = document.getElementById('radius-auto-pause');
    if (!toggle) return;
    toggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      e.target.disabled = true;
      try {
        await api.updateRadiusSessionSettings(enabled);
        this.toast(enabled ? 'Auto-pause enabled' : 'Auto-pause disabled - time keeps running while offline', 'success');
        this.loadRadiusTab();
      } catch (err) {
        e.target.checked = !enabled;
        e.target.disabled = false;
        this.toast(err.message, 'error');
      }
    });
  },

  async loadRadiusProfiles(container) {
    await this.loadSystemSettings();
    const profiles = await api.getRadiusProfiles(this.selectedRouterId);

    const fmtBps = (bps) => {
      if (!bps || bps === 0) return 'Unlimited';
      if (bps >= 1000000) return `${Number((bps / 1000000).toFixed(3))} Mbps`;
      if (bps >= 1000) return `${Number((bps / 1000).toFixed(1))} Kbps`;
      return `${bps} bps`;
    };

    const fmtBytes = (bytes) => {
      if (!bytes || bytes === 0) return 'Unlimited';
      if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
      if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${bytes} B`;
    };

    const fmtTime = (seconds) => {
      if (!seconds || seconds === 0) return 'Unlimited';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    };

    const fmtValidity = (p) => {
      if (p.validity_fixed_expiry) return `Until ${p.validity_fixed_expiry}`;
      if (p.validity_period && p.validity_period > 0) {
        const secs = p.validity_period;
        if (secs >= 86400) return `${Math.round(secs / 86400)} days`;
        if (secs >= 3600) return `${Math.round(secs / 3600)} hours`;
        return `${Math.round(secs / 60)} minutes`;
      }
      return 'No expiry';
    };

    let headerHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h4 style="font-size:0.95rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">RADIUS Profiles (${profiles.length})</h4>
        <button class="btn btn-primary btn-sm" onclick="App.showAddRadiusProfileModal()">Add Profile</button>
      </div>
    `;

    if (!profiles || profiles.length === 0) {
      container.innerHTML = headerHtml + '<div class="empty-state"><p>No RADIUS profiles yet. Create profiles to define speed limits, quotas, and session settings for your users.</p></div>';
      return;
    }

    container.innerHTML = headerHtml + `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Speed (Rx/Tx)</th>
              <th>Burst</th>
              <th>Session Timeout</th>
              <th>Quota (In/Out)</th>
              <th>Validity</th>
              <th>Price</th>
              <th>Users</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${profiles.map((p) => `
              <tr>
                <td>
                  <strong>${this.escapeHtml(p.name)}</strong>
                  ${p.is_default ? '<span class="status-badge connected" style="margin-left:0.3rem;font-size:0.7rem">Default</span>' : ''}
                  ${p.description ? `<br><small style="color:var(--text-muted)">${this.escapeHtml(p.description)}</small>` : ''}
                </td>
                <td>${fmtBps(p.rate_rx)} / ${fmtBps(p.rate_tx)}</td>
                <td>${(p.burst_rx || p.burst_tx) ? fmtBps(p.burst_rx) + ' / ' + fmtBps(p.burst_tx) : '-'}</td>
                <td>${fmtTime(p.session_timeout)}</td>
                <td>${fmtBytes(p.quota_rx)} / ${fmtBytes(p.quota_tx)}${p.quota_total ? '<br>Total: ' + fmtBytes(p.quota_total) : ''}</td>
                <td>${fmtValidity(p)}</td>
                <td>${p.price ? this.formatMoney(p.price) : '-'}</td>
                <td>${p.user_count || 0}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="App.showEditRadiusProfileModal(${p.id})">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteRadiusProfile(${p.id})">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  async showAddRadiusProfileModal() {
    this.openModal('Add RADIUS Profile', this.radiusProfileFormHtml(), [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Create Profile', class: 'btn btn-primary', action: () => this.submitRadiusProfile() },
    ]);
  },

  async showEditRadiusProfileModal(profileId) {
    const profile = await api.getRadiusProfile(this.selectedRouterId, profileId);
    this.openModal('Edit RADIUS Profile', this.radiusProfileFormHtml(profile), [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Save Changes', class: 'btn btn-primary', action: () => this.submitRadiusProfile(profileId) },
    ]);
  },

  radiusProfileFormHtml(p = {}) {
    const fmtSecs = (s) => {
      if (!s) return '';
      if (s >= 86400) return (s / 86400).toString();
      if (s >= 3600) return (s / 3600).toString();
      if (s >= 60) return (s / 60).toString();
      return s.toString();
    };
    const validityUnit = (s) => {
      if (!s) return 'hours';
      if (s >= 86400) return 'days';
      if (s >= 3600) return 'hours';
      return 'minutes';
    };
    const toMbps = (bps) => (bps ? Number((bps / 1000000).toFixed(3)) : 0);

    return `
      <form id="radius-profile-form">
        <div class="form-group">
          <label>Profile Name</label>
          <input type="text" name="name" value="${this.escapeHtml(p.name || '')}" required>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label>Download Speed (Mbps)</label>
            <input type="number" name="rate_rx" value="${toMbps(p.rate_rx)}" min="0" step="0.001" placeholder="e.g. 5">
          </div>
          <div class="form-group">
            <label>Upload Speed (Mbps)</label>
            <input type="number" name="rate_tx" value="${toMbps(p.rate_tx)}" min="0" step="0.001" placeholder="e.g. 1">
          </div>
          <div class="form-group">
            <label>Burst Download (Mbps)</label>
            <input type="number" name="burst_rx" value="${toMbps(p.burst_rx)}" min="0" step="0.001">
          </div>
          <div class="form-group">
            <label>Burst Upload (Mbps)</label>
            <input type="number" name="burst_tx" value="${toMbps(p.burst_tx)}" min="0" step="0.001">
          </div>
          <div class="form-group">
            <label>Burst Threshold Down (Mbps)</label>
            <input type="number" name="burst_threshold_rx" value="${toMbps(p.burst_threshold_rx)}" min="0" step="0.001">
          </div>
          <div class="form-group">
            <label>Burst Threshold Up (Mbps)</label>
            <input type="number" name="burst_threshold_tx" value="${toMbps(p.burst_threshold_tx)}" min="0" step="0.001">
          </div>
          <div class="form-group">
            <label>Burst Time Down (seconds)</label>
            <input type="number" name="burst_time_rx" value="${p.burst_time_rx || 0}" min="0">
          </div>
          <div class="form-group">
            <label>Burst Time Up (seconds)</label>
            <input type="number" name="burst_time_tx" value="${p.burst_time_tx || 0}" min="0">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label>Session Timeout</label>
            <div style="display:flex;gap:0.5rem">
              <input type="number" name="session_timeout_val" value="${fmtSecs(p.session_timeout)}" min="0" style="flex:1">
              <select name="session_timeout_unit" style="width:80px">
                <option value="hours" ${validityUnit(p.session_timeout) === 'hours' ? 'selected' : ''}>Hours</option>
                <option value="minutes" ${validityUnit(p.session_timeout) === 'minutes' ? 'selected' : ''}>Min</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Idle Timeout (seconds)</label>
            <input type="number" name="idle_timeout" value="${p.idle_timeout || 0}" min="0">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label>Download Quota (bytes)</label>
            <input type="number" name="quota_rx" value="${p.quota_rx || 0}" min="0" placeholder="0 = unlimited">
          </div>
          <div class="form-group">
            <label>Upload Quota (bytes)</label>
            <input type="number" name="quota_tx" value="${p.quota_tx || 0}" min="0">
          </div>
          <div class="form-group">
            <label>Total Quota (bytes)</label>
            <input type="number" name="quota_total" value="${p.quota_total || 0}" min="0">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label>Validity Period</label>
            <div style="display:flex;gap:0.5rem">
              <input type="number" name="validity_val" value="${fmtSecs(p.validity_period)}" min="0" style="flex:1" placeholder="0 = no expiry">
              <select name="validity_unit" style="width:80px">
                <option value="days" ${validityUnit(p.validity_period) === 'days' ? 'selected' : ''}>Days</option>
                <option value="hours" ${validityUnit(p.validity_period) === 'hours' ? 'selected' : ''}>Hours</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Fixed Expiry Date (optional)</label>
            <input type="datetime-local" name="validity_fixed_expiry" value="${p.validity_fixed_expiry ? p.validity_fixed_expiry.replace(' ', 'T') : ''}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem">
          <div class="form-group">
            <label>Shared Users</label>
            <input type="number" name="shared_users" value="${p.shared_users || 1}" min="1">
          </div>
          <div class="form-group">
            <label>Price (${this.systemCurrency})</label>
            <input type="number" name="price" value="${p.price || 0}" min="0" step="0.01">
          </div>
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:0.5rem;margin-top:1.5rem">
              <input type="checkbox" name="is_default" ${p.is_default ? 'checked' : ''}>
              Default profile
            </label>
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <input type="text" name="description" value="${this.escapeHtml(p.description || '')}" placeholder="Optional description">
        </div>
      </form>
    `;
  },

  async submitRadiusProfile(editId = null) {
    const form = document.getElementById('radius-profile-form');
    if (!form.name.value.trim()) {
      this.toast('Profile name is required', 'error');
      return;
    }

    const sessUnit = form.session_timeout_unit.value;
    const sessVal = parseInt(form.session_timeout_val.value) || 0;
    const sessionTimeout = sessUnit === 'hours' ? sessVal * 3600 : sessVal * 60;

    const valUnit = form.validity_unit.value;
    const valVal = parseInt(form.validity_val.value) || 0;
    const validityPeriod = valUnit === 'days' ? valVal * 86400 : valVal * 3600;

    const fixedExpiry = form.validity_fixed_expiry.value
      ? form.validity_fixed_expiry.value.replace('T', ' ')
      : null;

    const mbps = (v) => Math.round((parseFloat(v) || 0) * 1000000);

    const data = {
      name: form.name.value.trim(),
      rate_rx: mbps(form.rate_rx.value),
      rate_tx: mbps(form.rate_tx.value),
      burst_rx: mbps(form.burst_rx.value),
      burst_tx: mbps(form.burst_tx.value),
      burst_threshold_rx: mbps(form.burst_threshold_rx.value),
      burst_threshold_tx: mbps(form.burst_threshold_tx.value),
      burst_time_rx: parseInt(form.burst_time_rx.value) || 0,
      burst_time_tx: parseInt(form.burst_time_tx.value) || 0,
      session_timeout: sessionTimeout,
      idle_timeout: parseInt(form.idle_timeout.value) || 0,
      quota_rx: parseInt(form.quota_rx.value) || 0,
      quota_tx: parseInt(form.quota_tx.value) || 0,
      quota_total: parseInt(form.quota_total.value) || 0,
      validity_period: validityPeriod,
      validity_fixed_expiry: fixedExpiry,
      shared_users: parseInt(form.shared_users.value) || 1,
      price: parseFloat(form.price.value) || 0,
      is_default: form.is_default.checked ? 1 : 0,
      description: form.description.value.trim() || null,
    };

    try {
      if (editId) {
        await api.updateRadiusProfile(this.selectedRouterId, editId, data);
        this.toast('Profile updated', 'success');
      } else {
        await api.createRadiusProfile(this.selectedRouterId, data);
        this.toast('Profile created', 'success');
      }
      this.closeModal();
      this.loadRadiusTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteRadiusProfile(profileId) {
    if (!confirm('Delete this RADIUS profile? Users assigned to it will lose their profile settings.')) return;
    try {
      await api.deleteRadiusProfile(this.selectedRouterId, profileId);
      this.toast('Profile deleted', 'success');
      this.loadRadiusTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async loadRadiusSessions(container) {
    const sessions = await api.getRadiusSessions(this.selectedRouterId, { limit: 200 });

    const fmtBytes = (bytes) => {
      if (!bytes || bytes === 0) return '0 B';
      if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
      if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${bytes} B`;
    };

    const fmtDuration = (secs) => {
      if (!secs) return '0s';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      if (h > 0) return `${h}h ${m}m ${s}s`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    };

    let headerHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h4 style="font-size:0.95rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Session History (${sessions.length})</h4>
      </div>
    `;

    if (!sessions || sessions.length === 0) {
      container.innerHTML = headerHtml + '<div class="empty-state"><p>No session records yet. Sessions appear here when users connect via RADIUS.</p></div>';
      return;
    }

    container.innerHTML = headerHtml + `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Profile</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Download</th>
              <th>Upload</th>
              <th>NAS IP</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${sessions.map((s) => `
              <tr>
                <td><strong>${this.escapeHtml(s.username)}</strong></td>
                <td>${this.escapeHtml(s.profile_name || '-')}</td>
                <td>
                  <span class="status-badge ${s.status === 'active' ? 'connected' : 'disconnected'}">
                    ${s.status === 'active' ? 'Active' : 'Stopped'}
                  </span>
                  ${s.terminate_cause ? `<br><small style="color:var(--text-muted)">${this.escapeHtml(s.terminate_cause)}</small>` : ''}
                </td>
                <td>${s.started_at ? new Date(s.started_at).toLocaleString() : '-'}</td>
                <td>${fmtDuration(s.session_time)}</td>
                <td>${fmtBytes(s.input_octets)}</td>
                <td>${fmtBytes(s.output_octets)}</td>
                <td>${this.escapeHtml(s.nas_ip || '-')}</td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="App.extendRadiusSession(${s.id}, this)">Add time</button>
                  <button class="btn btn-sm btn-outline" onclick="App.applyVoucherToSession(${s.id}, this)">Add voucher</button>
                  ${s.status === 'active' ? `<button class="btn btn-sm btn-danger" onclick="App.terminateRadiusSession(${s.id})">Disconnect</button>` : ''}
                  <button class="btn btn-sm btn-outline" onclick="App.deleteRadiusSession(${s.id})">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // Inline SVG icon set for the RADIUS Active Devices dashboard.
  radiusIcons: {
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    wifiOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  },

  async loadRadiusActiveSessions(container) {
    if (!container) container = document.getElementById('radius-tab-content');
    this.clearRadiusPollers();
    this._radiusDevices = [];
    this._radiusDeviceSearch = '';
    this._radiusDeviceFilter = 'all';
    const routerId = this.selectedRouterId;
    const viewId = this._radiusDeviceViewId;
    const isCurrent = () => this._radiusDeviceViewId === viewId && this.selectedRouterId === routerId &&
      this.currentPage === 'radius' && this.radiusTab === 'active';

    try {
      const [devices, stats] = await Promise.all([
        api.getActiveDevices(routerId),
        api.getRadiusSessionStats(routerId),
      ]);
      if (!isCurrent()) return;

      this._radiusDevices = this.mapActiveDevices(devices);
      const icons = this.radiusIcons;

      container.innerHTML = `
        ${this.renderRadiusKpiCards(this._radiusDevices, stats)}
        <div class="radius-toolbar">
          <div class="radius-search">
            ${icons.search}
            <input type="text" id="radius-device-search" class="form-control" placeholder="Search online devices by MAC, IP, hostname or user&hellip;" autocomplete="off">
          </div>
          <div class="radius-filters" id="radius-device-filters">
            <button class="radius-filter-chip active" data-filter="all">All <span class="radius-filter-count" data-radius-count="all">0</span></button>
            <button class="radius-filter-chip" data-filter="blocked">Blocked <span class="radius-filter-count" data-radius-count="blocked">0</span></button>
            <button class="radius-filter-chip" data-filter="bypassed">Bypassed <span class="radius-filter-count" data-radius-count="bypassed">0</span></button>
          </div>
          <div class="radius-toolbar-actions">
            <span class="radius-live"><span class="radius-live-dot"></span>Live &middot; 1s</span>
            <button class="btn btn-outline btn-sm" onclick="App.openRadiusTab('offline')">Offline Devices</button>
            <button class="btn btn-primary btn-sm" onclick="App.showRadiusDeviceModal()">${icons.userPlus} Add Device</button>
            <button class="btn btn-outline btn-sm" onclick="App.showAddRadiusUserModal()">Add User</button>
          </div>
        </div>
        <div class="radius-offline-note">Only devices connected right now are listed here. Offline devices and ended sessions are in the <a href="#" onclick="App.openRadiusTab('offline');return false;">Offline Devices</a> tab.</div>
        <div class="radius-table-card">
          <div class="table-wrapper">
            <table class="radius-devices-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP Address</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Uptime</th>
                  <th>Time Left</th>
                  <th>Throughput</th>
                  <th>Data Usage</th>
                  <th>Last Seen</th>
                  <th class="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody id="radius-active-devices-tbody">
                ${this.renderRadiusDeviceRows(this.filterRadiusDevices(this._radiusDevices))}
              </tbody>
            </table>
          </div>
        </div>
      `;

      this.updateRadiusFilterCounts(this._radiusDevices);

      // Row actions are delegated through the tbody so quotes inside
      // usernames or MACs can never break out of an inline handler.
      const tbody = document.getElementById('radius-active-devices-tbody');
      if (tbody) {
        tbody.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          const row = btn.closest('tr[data-active-id]');
          const device = this._radiusDevices.find((d) => String(d.id) === row?.dataset.activeId);
          if (device) this.handleRadiusDeviceAction(btn.dataset.action, device);
        });
      }

      const searchInput = document.getElementById('radius-device-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this._radiusDeviceSearch = e.target.value.trim().toLowerCase();
          this.rerenderRadiusDeviceRows();
        });
      }

      const filters = document.getElementById('radius-device-filters');
      if (filters) {
        filters.addEventListener('click', (e) => {
          const chip = e.target.closest('.radius-filter-chip');
          if (!chip) return;
          this._radiusDeviceFilter = chip.dataset.filter || 'all';
          filters.querySelectorAll('.radius-filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
          this.rerenderRadiusDeviceRows();
        });
      }

      // Live rows: uptime, countdowns, rates and counters tick every second.
      let polling = false;
      this._radiusActiveInterval = setInterval(async () => {
        if (polling || !isCurrent() || this._radiusMutationBusy) return;
        polling = true;
        const mutationVersion = this._radiusMutationVersion;
        try {
          const freshDevices = this.mapActiveDevices(await api.getActiveDevices(routerId));
          if (!isCurrent() || mutationVersion !== this._radiusMutationVersion) return;
          this._radiusDevices = freshDevices;
          this.refreshRadiusActiveDeviceRows(freshDevices);
          this.updateRadiusFilterCounts(freshDevices);
          this.updateRadiusKpiValues(freshDevices, null);
        } catch (err) {
          console.error('Failed to refresh radius active devices:', err);
        } finally {
          polling = false;
        }
      }, 1000);

      // Daily aggregates move slowly - a relaxed poll keeps them fresh.
      this._radiusStatsInterval = setInterval(async () => {
        try {
          const freshStats = await api.getRadiusSessionStats(routerId);
          if (isCurrent()) this.updateRadiusKpiValues(this._radiusDevices, freshStats);
        } catch (err) {
          console.error('Failed to refresh radius session stats:', err);
        }
      }, 15000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  // Offline Devices subpage: every known device whose session already ended
  // (router dropped it, or its paid time ran out). The Active tab never lists
  // these, so the two lists stay a clean split of the same device table.
  async loadRadiusOfflineDevices(container) {
    if (!container) container = document.getElementById('radius-tab-content');
    this.clearRadiusPollers();
    this._radiusDevices = [];
    this._radiusOfflineSearch = '';
    this._radiusOfflineFilter = 'all';
    const routerId = this.selectedRouterId;
    const viewId = this._radiusDeviceViewId;
    const isCurrent = () => this._radiusDeviceViewId === viewId && this.selectedRouterId === routerId &&
      this.currentPage === 'radius' && this.radiusTab === 'offline';

    try {
      this._radiusDevices = this.mapActiveDevices(await api.getActiveDevices(routerId));
      if (!isCurrent()) return;
      const icons = this.radiusIcons;

      container.innerHTML = `
        <div class="radius-toolbar">
          <div class="radius-search">
            ${icons.search}
            <input type="text" id="radius-offline-search" class="form-control" placeholder="Search offline devices by MAC, IP, hostname or user&hellip;" autocomplete="off">
          </div>
          <div class="radius-filters" id="radius-offline-filters">
            <button class="radius-filter-chip active" data-filter="all">All <span class="radius-filter-count" data-radius-offline-count="all">0</span></button>
            <button class="radius-filter-chip" data-filter="ended">Session ended <span class="radius-filter-count" data-radius-offline-count="ended">0</span></button>
            <button class="radius-filter-chip" data-filter="blocked">Blocked <span class="radius-filter-count" data-radius-offline-count="blocked">0</span></button>
            <button class="radius-filter-chip" data-filter="bypassed">Bypassed <span class="radius-filter-count" data-radius-offline-count="bypassed">0</span></button>
          </div>
          <div class="radius-toolbar-actions">
            <span class="radius-live"><span class="radius-live-dot"></span>Live &middot; 3s</span>
            <button class="btn btn-outline btn-sm" onclick="App.openRadiusTab('active')">Back to Online</button>
          </div>
        </div>
        <div class="radius-table-card">
          <div class="table-wrapper">
            <table class="radius-devices-table radius-offline-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP Address</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Uptime</th>
                  <th>Time Left</th>
                  <th>Ended</th>
                  <th>Data Usage</th>
                  <th>Last Seen</th>
                  <th class="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody id="radius-offline-devices-tbody">
                ${this.renderRadiusDeviceRows(this.filterRadiusOfflineDevices(this._radiusDevices), this.radiusOfflineRowOpts())}
              </tbody>
            </table>
          </div>
        </div>
      `;

      this.updateRadiusOfflineCounts(this._radiusDevices);

      const tbody = document.getElementById('radius-offline-devices-tbody');
      if (tbody) {
        tbody.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          const row = btn.closest('tr[data-active-id]');
          if (!row) return;
          const device = this._radiusDevices.find((d) => String(d.id) === row.dataset.activeId);
          if (device) this.handleRadiusDeviceAction(btn.dataset.action, device);
        });
      }

      const searchInput = document.getElementById('radius-offline-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this._radiusOfflineSearch = e.target.value.trim().toLowerCase();
          this.rerenderRadiusOfflineDeviceRows();
        });
      }

      const filters = document.getElementById('radius-offline-filters');
      if (filters) {
        filters.addEventListener('click', (e) => {
          const chip = e.target.closest('.radius-filter-chip');
          if (!chip) return;
          this._radiusOfflineFilter = chip.dataset.filter || 'all';
          filters.querySelectorAll('.radius-filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
          this.rerenderRadiusOfflineDeviceRows();
        });
      }

      // Ended sessions barely change - a relaxed poll keeps the list moving as
      // devices drop off without hammering the router.
      let polling = false;
      this._radiusOfflineInterval = setInterval(async () => {
        if (polling || !isCurrent() || this._radiusMutationBusy) return;
        polling = true;
        const mutationVersion = this._radiusMutationVersion;
        try {
          const freshDevices = this.mapActiveDevices(await api.getActiveDevices(routerId));
          if (!isCurrent() || mutationVersion !== this._radiusMutationVersion) return;
          this._radiusDevices = freshDevices;
          this.refreshRadiusOfflineDeviceRows(freshDevices);
          this.updateRadiusOfflineCounts(freshDevices);
        } catch (err) {
          console.error('Failed to refresh radius offline devices:', err);
        } finally {
          polling = false;
        }
      }, 3000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  showRadiusDeviceModal(device = null) {
    const routerId = this.selectedRouterId;
    this.openModal(device ? 'Edit Device Hostname' : 'Add RADIUS Device', `
      <form id="radius-device-form">
        ${device ? '' : `<div class="form-group">
          <label for="radius-device-mac">MAC address</label>
          <input id="radius-device-mac" name="macAddress" required maxlength="17" placeholder="AA:BB:CC:DD:EE:FF">
        </div>
        <div class="form-group">
          <label for="radius-device-ip">IP address (optional)</label>
          <input id="radius-device-ip" name="ipAddress" placeholder="192.168.88.10">
        </div>`}
        <div class="form-group">
          <label for="radius-device-hostname">Hostname override</label>
          <input id="radius-device-hostname" name="hostname" maxlength="253">
          <small class="radius-muted">Leave blank to use the router-reported hostname.</small>
        </div>
        ${device ? '' : '<p class="radius-muted">Creates an offline device record in normal access mode. Use Add Time or Bypass after saving to grant access.</p>'}
      </form>`, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: device ? 'Save Hostname' : 'Add Device', class: 'btn btn-primary', action: () => save() },
    ]);
    const form = document.getElementById('radius-device-form');
    form.elements.hostname.value = device?.['custom-hostname'] || '';
    const save = async () => {
      if (this._radiusMutationBusy || !form.reportValidity()) return;
      const data = { hostname: form.elements.hostname.value.trim() };
      if (!device) {
        data.macAddress = form.elements.macAddress.value.trim();
        data.ipAddress = form.elements.ipAddress.value.trim();
      }
      await this.runRadiusDeviceMutation(routerId, () => device
        ? api.updateActiveDevice(routerId, device.id, data)
        : api.createActiveDevice(routerId, data), true);
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  },

  showRadiusDeviceTimeModal(device) {
    const routerId = this.selectedRouterId;
    this.openModal('Add Device Time', `
      <form id="radius-device-time-form">
        <p id="radius-time-device"></p>
        <div class="form-group">
          <label for="radius-device-minutes">Minutes to add</label>
          <input id="radius-device-minutes" name="minutes" type="number" min="1" max="525600" step="1" value="60" required>
        </div>
        <p class="radius-muted">Stacks on the linked account's unexpired time, or starts now if expired. Time also runs while offline. A MAC account is created for new devices. Block/bypass settings are unchanged.</p>
      </form>`, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Add Time', class: 'btn btn-primary', action: () => save() },
    ]);
    document.getElementById('radius-time-device').textContent = device['host-name'] !== '-'
      ? device['host-name'] : device['mac-address'];
    const form = document.getElementById('radius-device-time-form');
    const save = async () => {
      if (this._radiusMutationBusy || !form.reportValidity()) return;
      await this.runRadiusDeviceMutation(routerId,
        () => api.addActiveDeviceTime(routerId, device.id, Number(form.elements.minutes.value)), true);
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  },

  async runRadiusDeviceMutation(routerId, action, closeModal = false) {
    if (this._radiusMutationBusy) return;
    this._radiusMutationBusy = true;
    this._radiusMutationVersion = (this._radiusMutationVersion || 0) + 1;
    const viewId = this._radiusDeviceViewId;
    try {
      const result = await action();
      if (closeModal) this.closeModal();
      this.toast(result.message || 'Device updated', 'success');
      if (result.warning) this.toast(result.warning, 'warning');
      if (this.currentPage === 'radius' && this.selectedRouterId === routerId &&
        (this.radiusTab === 'active' || this.radiusTab === 'offline')) {
        const devices = this.mapActiveDevices(await api.getActiveDevices(routerId));
        if (this._radiusDeviceViewId !== viewId || this.selectedRouterId !== routerId) return;
        this._radiusDevices = devices;
        if (this.radiusTab === 'active') {
          this.rerenderRadiusDeviceRows();
          this.updateRadiusFilterCounts(devices);
          this.updateRadiusKpiValues(devices, null);
        } else {
          this.rerenderRadiusOfflineDeviceRows();
          this.updateRadiusOfflineCounts(devices);
        }
      }
    } catch (err) {
      this.toast(err.message, 'error');
    } finally {
      this._radiusMutationBusy = false;
    }
  },

  async handleRadiusDeviceAction(action, device) {
    if (this._radiusMutationBusy) return;
    if (action === 'edit') return this.showRadiusDeviceModal(device);
    if (action === 'time') return this.showRadiusDeviceTimeModal(device);
    const routerId = this.selectedRouterId;
    const label = device['host-name'] !== '-' ? device['host-name'] : device['mac-address'];
    if (action === 'disconnect') {
      if (confirm(`Disconnect "${label}"?`)) {
        await this.runRadiusDeviceMutation(routerId, () => api.removeActiveConnection(routerId, device['.id']));
      }
    } else if (action === 'remove') {
      if (confirm(`Delete "${label}" and its managed block/bypass rule? Its current session will be disconnected. Paid accounts/history are retained, and reconnecting devices can appear again. Use Block to prevent access.`)) {
        await this.runRadiusDeviceMutation(routerId, () => api.deleteActiveDevice(routerId, device.id));
      }
    } else if (['blocked', 'bypassed', 'normal'].includes(action)) {
      const explanation = action === 'blocked' ? 'Block internet access on this router'
        : action === 'bypassed' ? 'Allow internet without login or paid time on this router'
        : 'Restore normal login and paid-time requirements on this router';
      if (confirm(`${explanation} for "${label}"? The current session will be disconnected.`)) {
        await this.runRadiusDeviceMutation(routerId, () => api.setActiveDeviceAccess(routerId, device.id, action));
      }
    }
  },

  radiusDeviceTimeCell(device) {
    if (device['access-mode'] === 'bypassed') return '<span class="radius-access-bypassed">Unlimited (bypass)</span>';
    const paid = device['paid-seconds-left'];
    const seconds = device['is-active'] ? this.parseTimeToSeconds(device['session-time-left']) : paid;
    if (seconds === null || seconds === undefined) return '<span class="radius-muted">No paid time</span>';
    const level = seconds > 0 && seconds <= 60 ? ' countdown-critical'
      : seconds > 0 && seconds <= 300 ? ' countdown-warning' : '';
    return `<div class="session-countdown${level}">
      <div class="countdown-value">${this.formatCountdown(seconds)}</div>
      <div class="countdown-bar"><div class="countdown-bar-fill" style="width:${seconds === Infinity ? 100 : Math.min(seconds / 36, 100)}%"></div></div>
    </div>${paid !== null && paid !== undefined ? `<small class="radius-muted">Paid: ${this.formatCountdown(paid)}</small>` : ''}`;
  },

  radiusDeviceRowKey(d) {
    return JSON.stringify([d.id, d['is-active'], d['access-mode'], d['host-name'], d['mac-address'], d.address, d.user, d.server, d['login-by'], d['.id']]);
  },

  renderRadiusKpiCards(devices, stats) {
    const list = devices || [];
    const online = list.filter((d) => d['is-active'] === true).length;
    const icons = this.radiusIcons;

    const kpis = [
      {
        key: 'online', label: 'Online Now', icon: icons.wifi, accent: 'kpi-success', live: true,
        value: online,
        sub: `of ${list.length} known device${list.length === 1 ? '' : 's'}`,
      },
      {
        key: 'devices', label: 'Known Devices', icon: icons.monitor, accent: 'kpi-primary',
        value: list.length,
        sub: `${list.length - online} offline`,
      },
      {
        key: 'sessions', label: 'Sessions Today', icon: icons.clock, accent: 'kpi-violet',
        value: (stats && stats.todaySessions) || 0,
        sub: 'logins since midnight',
      },
      {
        key: 'down', label: 'Download Today', icon: icons.arrowDown, accent: 'kpi-success',
        value: this.formatBytes((stats && stats.todayBytesIn) || 0),
        sub: 'inbound traffic',
      },
      {
        key: 'up', label: 'Upload Today', icon: icons.arrowUp, accent: 'kpi-violet',
        value: this.formatBytes((stats && stats.todayBytesOut) || 0),
        sub: 'outbound traffic',
      },
    ];

    return `<div class="stats-grid">${kpis.map((k) => `
      <div class="stat-card radius-kpi" data-radius-kpi="${k.key}">
        <span class="radius-kpi-icon ${k.accent}${k.live ? ' radius-kpi-live' : ''}">${k.icon}</span>
        <div class="radius-kpi-body">
          <span class="stat-label">${k.label}</span>
          <div class="stat-value">${k.value}</div>
          <div class="stat-sub">${k.sub}</div>
        </div>
      </div>`).join('')}
    </div>`;
  },

  setRadiusKpi(key, value, sub) {
    const card = document.querySelector(`[data-radius-kpi="${key}"]`);
    if (!card) return;
    const valueEl = card.querySelector('.stat-value');
    if (valueEl) valueEl.textContent = value;
    if (sub !== undefined) {
      const subEl = card.querySelector('.stat-sub');
      if (subEl) subEl.textContent = sub;
    }
  },

  updateRadiusKpiValues(devices, stats) {
    const list = devices || [];
    const online = list.filter((d) => d['is-active'] === true).length;
    this.setRadiusKpi('online', online, `of ${list.length} known device${list.length === 1 ? '' : 's'}`);
    this.setRadiusKpi('devices', list.length, `${list.length - online} offline`);
    if (stats) {
      this.setRadiusKpi('sessions', stats.todaySessions || 0, 'logins since midnight');
      this.setRadiusKpi('down', this.formatBytes(stats.todayBytesIn || 0), 'inbound traffic');
      this.setRadiusKpi('up', this.formatBytes(stats.todayBytesOut || 0), 'outbound traffic');
    }
  },

  renderRadiusDeviceRows(devices, opts = {}) {
    const list = devices || [];
    const searchTerm = opts.search !== undefined ? opts.search : this._radiusDeviceSearch;
    if (list.length === 0) {
      const title = searchTerm
        ? (opts.noMatchTitle || 'No matching devices')
        : (opts.emptyTitle || 'No devices yet');
      const text = searchTerm
        ? (opts.noMatchText || 'No devices match your search. Try a different MAC, IP, hostname or username.')
        : (opts.emptyText || 'Devices will appear here as soon as they connect to this router.');
      return `
        <tr class="radius-no-devices">
          <td colspan="10">
            <div class="radius-empty-state">
              <span class="radius-empty-icon">${this.radiusIcons.wifiOff}</span>
              <h4>${title}</h4>
              <p>${text}</p>
            </div>
          </td>
        </tr>
      `;
    }

    // escapeHtml leaves quotes alone - make values safe for double-quoted
    // data-* attributes before they end up in markup.
    const escAttr = (v) => this.escapeHtml(String(v == null ? '' : v)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const icons = this.radiusIcons;

    return list.map((d) => {
      const isActive = d['is-active'] === true;
      const mac = d['mac-address'] || '';
      const hostname = (d['host-name'] && d['host-name'] !== '-') ? d['host-name'] : '';
      const displayName = hostname || mac || 'Unknown device';
      const initials = this.radiusDeviceInitials(hostname || mac || d.user || '?');
      const hue = this.radiusDeviceHue(mac || d.address || displayName);
      const accessMode = d['access-mode'] || 'normal';
      const rxRate = d['rx-rate'] || '0 bps';
      const txRate = d['tx-rate'] || '0 bps';
      const bytesIn = parseInt(d['bytes-in'] || '0', 10) || 0;
      const bytesOut = parseInt(d['bytes-out'] || '0', 10) || 0;
      const dataTotal = bytesIn + bytesOut;
      const inPct = dataTotal ? ((bytesIn / dataTotal) * 100).toFixed(1) : 0;
      const outPct = dataTotal ? ((bytesOut / dataTotal) * 100).toFixed(1) : 0;

      const sessionCell = this.radiusDeviceTimeCell(d);

      // The Offline Devices table swaps the live throughput column for the time
      // the session ended, which is the only thing that still changes.
      const endedAt = d['ended-at'] || '';
      const endedCell = `<span class="radius-muted" data-field="ended-at" title="${escAttr(endedAt)}">${endedAt ? this.formatTimeAgo(endedAt) : '&mdash;'}</span>`;

      const trafficCell = isActive
        ? `
          <div class="traffic-cell">
            <div class="traffic-row">
              <span class="traffic-dir traffic-dir-rx">&darr;</span>
              <span class="traffic-value" data-rate="rx">${this.escapeHtml(rxRate)}</span>
              <span class="traffic-bar"><span class="traffic-bar-fill rx" data-rate-bar="rx" style="width: ${this.calculateRateBarWidth(rxRate)}%"></span></span>
            </div>
            <div class="traffic-row">
              <span class="traffic-dir traffic-dir-tx">&uarr;</span>
              <span class="traffic-value" data-rate="tx">${this.escapeHtml(txRate)}</span>
              <span class="traffic-bar"><span class="traffic-bar-fill tx" data-rate-bar="tx" style="width: ${this.calculateRateBarWidth(txRate)}%"></span></span>
            </div>
          </div>`
        : '<span class="radius-muted">&mdash;</span>';

      const dataCell = `
        <div class="data-cell">
          <div class="data-values">
            <span class="data-value"><span class="data-dir data-dir-rx">&darr;</span><span data-field="bytes-in">${this.formatBytes(bytesIn)}</span></span>
            <span class="data-value"><span class="data-dir data-dir-tx">&uarr;</span><span data-field="bytes-out">${this.formatBytes(bytesOut)}</span></span>
          </div>
          <div class="data-bar">
            <span class="data-bar-in" style="width: ${inPct}%"></span>
            <span class="data-bar-out" style="width: ${outPct}%"></span>
          </div>
        </div>`;

      const statusCell = (isActive
        ? '<span class="device-status device-status-active">Online</span>'
        : '<span class="device-status device-status-offline">Offline</span>') +
        (accessMode === 'blocked' ? '<span class="device-status radius-access-blocked">Blocked</span>'
          : accessMode === 'bypassed' ? '<span class="device-status radius-access-bypassed">Bypassed</span>' : '');

      const actions = `<div class="radius-device-controls">
        <button class="icon-btn" data-action="edit" title="Edit hostname" aria-label="Edit hostname">${icons.edit}</button>
        <button class="btn btn-sm btn-outline" data-action="time">Add Time</button>
        <button class="btn btn-sm btn-outline" data-action="${accessMode === 'blocked' ? 'normal' : 'blocked'}">${accessMode === 'blocked' ? 'Unblock' : 'Block'}</button>
        <button class="btn btn-sm btn-outline" data-action="${accessMode === 'bypassed' ? 'normal' : 'bypassed'}">${accessMode === 'bypassed' ? 'Normal' : 'Bypass'}</button>
        ${isActive && d['.id'] ? `<button class="icon-btn icon-btn-danger" data-action="disconnect" title="Disconnect device" aria-label="Disconnect device">${icons.power}</button>` : ''}
        <button class="icon-btn icon-btn-danger" data-action="remove" title="Delete device" aria-label="Delete device">${icons.trash}</button>
      </div>`;

      return `
        <tr data-active-id="${escAttr(d.id)}" data-row-key="${escAttr(this.radiusDeviceRowKey(d))}" data-active="${isActive ? '1' : '0'}"${isActive ? '' : ' class="radius-row-offline"'}>
          <td>
            <div class="device-cell">
              <span class="device-avatar" style="background: hsl(${hue}, 62%, 45%)">${this.escapeHtml(initials)}</span>
              <div class="device-names">
                <span class="device-name" data-field="hostname" data-hostname="${escAttr(hostname)}">${this.escapeHtml(displayName)}</span>
                <span class="device-mac">${mac ? this.escapeHtml(mac) : 'MAC unavailable'}</span>
              </div>
            </div>
          </td>
          <td class="radius-mono">${this.escapeHtml(d.address || '-')}</td>
          <td>
            <div class="device-user">
              <span class="device-user-name">${d.user ? this.escapeHtml(d.user) : '&mdash;'}</span>
              <span class="device-user-sub">${this.escapeHtml(d.server || d['login-by'] || '')}</span>
            </div>
          </td>
          <td>${statusCell}</td>
          <td class="radius-mono" data-field="uptime">${this.escapeHtml(d.uptime || '-')}</td>
          <td data-field="device-time">${sessionCell}</td>
          <td>${opts.endedColumn ? endedCell : trafficCell}</td>
          <td>${dataCell}</td>
          <td class="radius-muted" data-field="last-seen" title="${escAttr(d['last-seen'] || '')}">${this.formatTimeAgo(d['last-seen'])}</td>
          <td class="radius-actions">${actions}</td>
        </tr>`;
    }).join('');
  },

  // Patch a device table in place: re-render only when the row set changed,
  // otherwise refresh just the cells that animate.
  refreshRadiusRows(tbodyId, visible, opts = {}) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr[data-active-id]'));
    const rowKey = (d) => this.radiusDeviceRowKey(d);
    const domKey = (r) => r.dataset.rowKey;

    if (visible.map(rowKey).join('|') !== rows.map(domKey).join('|')) {
      tbody.innerHTML = this.renderRadiusDeviceRows(visible, opts);
      return;
    }

    rows.forEach((row, index) => {
      const device = visible[index];
      if (!device) return;

      const uptime = row.querySelector('[data-field="uptime"]');
      if (uptime) uptime.textContent = device.uptime || '-';

      const lastSeen = row.querySelector('[data-field="last-seen"]');
      if (lastSeen) {
        lastSeen.textContent = this.formatTimeAgo(device['last-seen']);
        if (device['last-seen']) lastSeen.title = device['last-seen'];
      }
      const timeCell = row.querySelector('[data-field="device-time"]');
      if (timeCell) timeCell.innerHTML = this.radiusDeviceTimeCell(device);

      const endedCell = row.querySelector('[data-field="ended-at"]');
      if (endedCell) {
        endedCell.textContent = device['ended-at'] ? this.formatTimeAgo(device['ended-at']) : '\u2014';
        endedCell.title = device['ended-at'] || '';
      }

      // Ended sessions keep their stored values - only live ones animate.
      if (device['is-active'] !== true) return;

      const rxRate = device['rx-rate'] || '0 bps';
      const txRate = device['tx-rate'] || '0 bps';

      const rxValue = row.querySelector('[data-rate="rx"]');
      if (rxValue) rxValue.textContent = rxRate;
      const rxFill = row.querySelector('[data-rate-bar="rx"]');
      if (rxFill) rxFill.style.width = `${this.calculateRateBarWidth(rxRate)}%`;

      const txValue = row.querySelector('[data-rate="tx"]');
      if (txValue) txValue.textContent = txRate;
      const txFill = row.querySelector('[data-rate-bar="tx"]');
      if (txFill) txFill.style.width = `${this.calculateRateBarWidth(txRate)}%`;

      const bytesIn = parseInt(device['bytes-in'] || '0', 10) || 0;
      const bytesOut = parseInt(device['bytes-out'] || '0', 10) || 0;
      const dataTotal = bytesIn + bytesOut;

      const bytesInEl = row.querySelector('[data-field="bytes-in"]');
      if (bytesInEl) bytesInEl.textContent = this.formatBytes(bytesIn);
      const bytesOutEl = row.querySelector('[data-field="bytes-out"]');
      if (bytesOutEl) bytesOutEl.textContent = this.formatBytes(bytesOut);

      const dataIn = row.querySelector('.data-bar-in');
      if (dataIn) dataIn.style.width = `${dataTotal ? ((bytesIn / dataTotal) * 100).toFixed(1) : 0}%`;
      const dataOut = row.querySelector('.data-bar-out');
      if (dataOut) dataOut.style.width = `${dataTotal ? ((bytesOut / dataTotal) * 100).toFixed(1) : 0}%`;
    });
  },

  refreshRadiusActiveDeviceRows(devices) {
    this.refreshRadiusRows('radius-active-devices-tbody', this.filterRadiusDevices(devices));
  },

  refreshRadiusOfflineDeviceRows(devices) {
    this.refreshRadiusRows('radius-offline-devices-tbody',
      this.filterRadiusOfflineDevices(devices), this.radiusOfflineRowOpts());
  },

  filterRadiusDevices(devices) {
    // The Active tab only lists devices that are on the router now. Offline and
    // ended sessions are moved to the Offline Devices tab.
    let list = (devices || []).filter((d) => d['is-active'] === true);

    if (['blocked', 'bypassed'].includes(this._radiusDeviceFilter)) {
      list = list.filter((d) => d['access-mode'] === this._radiusDeviceFilter);
    }

    const q = (this._radiusDeviceSearch || '').trim().toLowerCase();
    if (q) {
      list = list.filter((d) =>
        [d['mac-address'], d.address, d['host-name'], d.user, d.server]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }

    return list;
  },

  filterRadiusOfflineDevices(devices) {
    const offline = (devices || []).filter((d) => d['is-active'] !== true);
    let list = offline;

    if (this._radiusOfflineFilter === 'ended') {
      list = offline.filter((d) => !!d['ended-at']);
    } else if (['blocked', 'bypassed'].includes(this._radiusOfflineFilter)) {
      list = offline.filter((d) => d['access-mode'] === this._radiusOfflineFilter);
    }

    const q = (this._radiusOfflineSearch || '').trim().toLowerCase();
    if (q) {
      list = list.filter((d) =>
        [d['mac-address'], d.address, d['host-name'], d.user, d.server]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }

    // Most recently ended first, so the freshest drop-offs stay on top.
    const stamp = (d) => {
      const ts = new Date(String(d['ended-at'] || d['last-seen'] || '').replace(' ', 'T')).getTime();
      return isNaN(ts) ? 0 : ts;
    };
    return list.slice().sort((a, b) => stamp(b) - stamp(a));
  },

  radiusOfflineRowOpts() {
    return {
      search: this._radiusOfflineSearch,
      endedColumn: true,
      emptyTitle: 'No offline devices',
      emptyText: 'Devices move here when they disconnect or when their paid session ends.',
      noMatchTitle: 'No matching offline devices',
      noMatchText: 'No offline device matches your search. Try a different MAC, IP, hostname or username.',
    };
  },

  rerenderRadiusDeviceRows() {
    const tbody = document.getElementById('radius-active-devices-tbody');
    if (!tbody) return;
    tbody.innerHTML = this.renderRadiusDeviceRows(this.filterRadiusDevices(this._radiusDevices || []));
  },

  rerenderRadiusOfflineDeviceRows() {
    const tbody = document.getElementById('radius-offline-devices-tbody');
    if (!tbody) return;
    tbody.innerHTML = this.renderRadiusDeviceRows(
      this.filterRadiusOfflineDevices(this._radiusDevices || []), this.radiusOfflineRowOpts());
  },

  updateRadiusFilterCounts(devices) {
    const list = devices || [];
    const online = list.filter((d) => d['is-active'] === true);
    const offline = list.length - online.length;
    const counts = {
      all: online.length,
      online: online.length,
      offline,
      blocked: online.filter((d) => d['access-mode'] === 'blocked').length,
      bypassed: online.filter((d) => d['access-mode'] === 'bypassed').length,
    };

    document.querySelectorAll('[data-radius-count]').forEach((el) => {
      if (counts[el.dataset.radiusCount] !== undefined) el.textContent = counts[el.dataset.radiusCount];
    });
    this.updateRadiusOfflineTabBadge(offline);
  },

  updateRadiusOfflineCounts(devices) {
    const offline = (devices || []).filter((d) => d['is-active'] !== true);
    const counts = {
      all: offline.length,
      ended: offline.filter((d) => !!d['ended-at']).length,
      blocked: offline.filter((d) => d['access-mode'] === 'blocked').length,
      bypassed: offline.filter((d) => d['access-mode'] === 'bypassed').length,
    };

    document.querySelectorAll('[data-radius-offline-count]').forEach((el) => {
      const key = el.dataset.radiusOfflineCount;
      if (counts[key] !== undefined) el.textContent = counts[key];
    });
    this.updateRadiusOfflineTabBadge(offline.length);
  },

  updateRadiusOfflineTabBadge(count) {
    const badge = document.getElementById('radius-offline-tab-badge');
    if (!badge || typeof count !== 'number') return;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  },

  // Cosmetic badge fill when the RADIUS page opens on a tab that never loads
  // the device list (Profiles / Sessions / Logs).
  async refreshRadiusOfflineBadge() {
    const routerId = this.selectedRouterId;
    try {
      const devices = this.mapActiveDevices(await api.getActiveDevices(routerId));
      if (this.currentPage !== 'radius' || this.selectedRouterId !== routerId) return;
      this.updateRadiusOfflineTabBadge(devices.filter((d) => d['is-active'] !== true).length);
    } catch (err) {
      // A failed count must never break the page.
    }
  },

  // Deterministic per-device identity helpers for the avatars.
  radiusDeviceInitials(seed) {
    const chars = String(seed || '').replace(/[^a-z0-9]/gi, '');
    return (chars.slice(0, 2) || '?').toUpperCase();
  },

  radiusDeviceHue(seed) {
    const str = String(seed || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) % 360;
    }
    return hash;
  },

  formatTimeAgo(stamp) {
    if (!stamp) return '-';
    const ts = new Date(String(stamp).replace(' ', 'T')).getTime();
    if (isNaN(ts)) return String(stamp);

    const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (secs < 10) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  },

  clearRadiusPollers() {
    this._radiusDeviceViewId = (this._radiusDeviceViewId || 0) + 1;
    if (this._radiusActiveInterval) {
      clearInterval(this._radiusActiveInterval);
      this._radiusActiveInterval = null;
    }
    if (this._radiusStatsInterval) {
      clearInterval(this._radiusStatsInterval);
      this._radiusStatsInterval = null;
    }
    if (this._radiusOfflineInterval) {
      clearInterval(this._radiusOfflineInterval);
      this._radiusOfflineInterval = null;
    }
    if (this._radiusLogsInterval) {
      clearInterval(this._radiusLogsInterval);
      this._radiusLogsInterval = null;
    }
  },

  // Live RADIUS log console (auth accepts/rejects, accounting, CoA, warnings).
  // Can be filtered to a single user (a "user log"): type a username, or click
  // one in the stream; the filter is applied server-side.
  async loadRadiusLogs(container) {
    if (!container) container = document.getElementById('radius-tab-content');
    this.clearRadiusPollers();
    if (typeof this._radiusLogUsername !== 'string') this._radiusLogUsername = '';

    const esc = (v) => this.escapeHtml(String(v == null ? '' : v));
    const typeColor = (t) => {
      switch (t) {
        case 'accept': return '#22c55e';
        case 'reject': return '#ef4444';
        case 'accounting': return '#818cf8';
        case 'warning': return '#f59e0b';
        case 'error': return '#ef4444';
        default: return '#94a3b8';
      }
    };

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem">
        <h4 style="font-size:0.95rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin:0">
          RADIUS Log <span style="color:#22c55e">&#9679;</span> <span style="color:var(--text-muted);font-weight:400;text-transform:none">live</span>
          <span id="radius-log-filter-note" style="margin-left:0.5rem;font-size:0.75rem;font-weight:400;text-transform:none;color:var(--primary)"></span>
        </h4>
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
          <span style="font-size:0.8rem;color:var(--text-muted)">User</span>
          <input id="radius-log-user" type="text" placeholder="filter by username..." value="${esc(this._radiusLogUsername)}"
                 style="padding:0.35rem 0.5rem;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.8rem;width:180px">
          <button class="btn btn-sm btn-outline" id="radius-log-user-clear">Clear user</button>
          <label style="font-size:0.8rem;color:var(--text-muted);cursor:pointer">
            <input type="checkbox" id="radius-log-all" style="vertical-align:middle"> All routers
          </label>
          <label style="font-size:0.8rem;color:var(--text-muted);cursor:pointer">
            <input type="checkbox" id="radius-log-autoscroll" checked style="vertical-align:middle"> Auto-scroll
          </label>
          <button class="btn btn-sm btn-outline" id="radius-log-clear">Clear log</button>
        </div>
      </div>
      <div id="radius-log-box" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
           background:#0b1220;color:#cbd5e1;border:1px solid var(--border);border-radius:8px;padding:0.75rem;
           height:60vh;overflow:auto;line-height:1.6;white-space:pre-wrap;word-break:break-word"></div>
    `;

    const box = document.getElementById('radius-log-box');
    const autoChk = document.getElementById('radius-log-autoscroll');
    const userInput = document.getElementById('radius-log-user');
    const note = document.getElementById('radius-log-filter-note');

    const refresh = async () => {
      try {
        const allR = document.getElementById('radius-log-all');
        const rid = (allR && allR.checked) ? undefined : this.selectedRouterId;
        const logs = await api.getRadiusLogs(rid, 300, this._radiusLogUsername || undefined);
        if (!box || !box.parentNode) return; // tab switched away
        const rows = (logs || []).slice().reverse(); // oldest -> newest (console tail)
        const wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
        const prevTop = box.scrollTop;

        if (note) {
          note.textContent = this._radiusLogUsername
            ? '- user "' + this._radiusLogUsername + '" (' + rows.length + ')'
            : '';
        }

        box.innerHTML = rows.length === 0
          ? '<div style="color:#64748b">' + (this._radiusLogUsername ? 'No log entries for this user yet.' : 'No RADIUS log entries yet.') + '</div>'
          : rows.map((l) => {
              const time = esc(l.created_at || '');
              const color = typeColor(l.log_type);
              const type = esc(String(l.log_type || 'info').toUpperCase());
              const user = l.username
                ? ' <span class="radius-log-user" title="Show this user\'s log" style="color:#e2e8f0;cursor:pointer;border-bottom:1px dotted #64748b">' + esc(l.username) + '</span>'
                : '';
              const code = l.response_code ? ' <span style="color:#64748b">[' + esc(l.response_code) + ']</span>' : '';
              const src = l.source_ip ? ' <span style="color:#475569">(' + esc(l.source_ip) + ')</span>' : '';
              return '<div><span style="color:#64748b">' + time + '</span> <span style="color:' + color + ';font-weight:600">' + type + '</span>' + user + code + src + ' <span>' + esc(l.message) + '</span></div>';
            }).join('');

        if (autoChk && autoChk.checked && wasBottom) box.scrollTop = box.scrollHeight;
        else box.scrollTop = prevTop;
      } catch (err) {
        // Surface the failure instead of silently freezing on stale entries.
        if (note) note.textContent = ' - refresh failed: ' + (err && err.message ? err.message : err);
      }
    };

    // Click a username in the stream to open that user's log.
    box.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.classList && t.classList.contains('radius-log-user')) {
        this._radiusLogUsername = (t.textContent || '').trim();
        if (userInput) userInput.value = this._radiusLogUsername;
        refresh();
      }
    });

    if (userInput) {
      userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { this._radiusLogUsername = userInput.value.trim(); refresh(); }
      });
      userInput.addEventListener('change', () => { this._radiusLogUsername = userInput.value.trim(); refresh(); });
    }

    document.getElementById('radius-log-user-clear').addEventListener('click', () => {
      this._radiusLogUsername = '';
      if (userInput) userInput.value = '';
      refresh();
    });

    document.getElementById('radius-log-clear').addEventListener('click', async () => {
      if (!confirm('Clear the RADIUS log for this router?')) return;
      try {
        await api.clearRadiusLogs(this.selectedRouterId);
        await refresh();
        this.toast('RADIUS log cleared', 'success');
      } catch (err) {
        this.toast(err.message, 'error');
      }
    });

    await refresh();
    if (box) box.scrollTop = box.scrollHeight;
    this._radiusLogsInterval = setInterval(refresh, 2000);
  },

  showAddRadiusUserModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000';
    modal.innerHTML = `
      <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:2rem;max-width:500px;width:90%">
        <h3 style="margin:0 0 1.5rem 0">Generate RADIUS Voucher</h3>
        <form id="add-radius-user-form">
          <div style="margin-bottom:1rem">
            <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:var(--text-muted)">Profile</label>
            <select name="profile_id" required style="width:100%;padding:0.5rem;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:var(--text)">
              <option value="">Loading profiles...</option>
            </select>
          </div>
          <div style="margin-bottom:1rem">
            <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:var(--text-muted)">Prefix (optional)</label>
            <input type="text" name="prefix" placeholder="e.g., P" style="width:100%;padding:0.5rem;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:var(--text)">
          </div>
          <div style="margin-bottom:1rem">
            <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:var(--text-muted)">Price per Voucher (₱, optional)</label>
            <input type="number" name="price" placeholder="e.g. 5" min="0" step="0.01" style="width:100%;padding:0.5rem;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;color:var(--text)">
          </div>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end">
            <button type="button" class="btn btn-outline" onclick="this.closest('.modal').remove()">Cancel</button>
            <button type="submit" class="btn btn-primary">Generate</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    api.getRadiusProfiles(this.selectedRouterId).then((profiles) => {
      const select = modal.querySelector('select[name="profile_id"]');
      if (profiles && profiles.length > 0) {
        select.innerHTML = profiles.map((p) => `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`).join('');
      } else {
        select.innerHTML = '<option value="">No profiles available</option>';
      }
    }).catch(() => {
      modal.querySelector('select[name="profile_id"]').innerHTML = '<option value="">Failed to load profiles</option>';
    });

    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        count: 1,
        radiusProfileId: parseInt(formData.get('profile_id'), 10),
        prefix: formData.get('prefix') || 'P',
        codeLength: 8,
        price: formData.get('price') ? parseFloat(formData.get('price')) : 0,
      };

      try {
        const result = await api.generateVouchers(this.selectedRouterId, data);
        this.toast(`Voucher generated: ${result.vouchers?.[0]?.code || 'success'}`, 'success');
        modal.remove();
        this.loadRadiusTab();
      } catch (err) {
        this.toast(err.message, 'error');
      }
    });
  },

  // Redeem a VOUCHER and add its time to the device behind a session.
  async applyVoucherToSession(sessionId, btn) {
    if (!sessionId) return;

    let username = '';
    const row = btn && btn.closest ? btn.closest('tr') : null;
    if (row && row.children[0]) username = row.children[0].textContent.trim();

    const code = window.prompt('Voucher code to add to ' + (username || 'this device') + ':', '');
    if (code === null) return;
    if (!code.trim()) return;

    try {
      const r = await api.applyVoucherToSession(this.selectedRouterId, sessionId, code.trim());
      this.toast(r.message || 'Voucher applied', 'success');
      this.loadRadiusTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  // Admin top-up: add time to the USER behind a session (not a voucher/coin).
  async extendRadiusSession(sessionId, btn) {
    if (!sessionId) return;

    let username = '';
    const row = btn && btn.closest ? btn.closest('tr') : null;
    if (row && row.children[0]) username = row.children[0].textContent.trim();

    const val = window.prompt('Add time (minutes) for ' + (username || 'this user') + ':', '30');
    if (val === null) return;
    const minutes = parseInt(val, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) { alert('Enter a positive number of minutes'); return; }

    try {
      const r = await api.extendRadiusSession(this.selectedRouterId, sessionId, minutes);
      this.toast(r.message || 'Time added', 'success');
      this.loadRadiusTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async terminateRadiusSession(sessionId) {
    if (!confirm('Disconnect this session? The user will be immediately disconnected from the network.')) return;
    try {
      await api.terminateRadiusSession(this.selectedRouterId, sessionId);
      this.toast('Session terminated', 'success');
      this.loadRadiusTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteRadiusSession(sessionId) {
    if (!confirm('Remove this session record?')) return;
    try {
      await api.deleteRadiusSession(this.selectedRouterId, sessionId);
      this.toast('Session removed', 'success');
      this.loadRadiusTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async renderPortal() {
    const content = document.getElementById('page-content');

    if (this.portalDirty && !confirm('You have unsaved changes. Reloading will discard them. Continue?')) {
      return;
    }
    this.portalDirty = false;

    // Initialize portal tab if not set
    if (!this.portalActiveTab) {
      this.portalActiveTab = 'mikrotik';
    }

    const activeTab = this.portalActiveTab;

    // The Sounds and Banner Uploader tabs own their own layout - no file tree,
    // no code editor, and no router to push to, so they must not depend on
    // either request.
    if (activeTab === 'sounds') {
      await this.renderPortalSounds(content);
      return;
    }
    if (activeTab === 'banner') {
      await this.renderPortalBanner(content);
      return;
    }

    const routers = (await api.getRouters()).filter((r) => r.connected);
    const folder = activeTab === 'stub' ? 'stub' : (activeTab === 'panel-page' ? 'panel-page' : 'hotspot');

    let filesData = [];
    try {
      const res = await api.getPortalFiles(folder);
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
      if (!f.editable) return uiIcon('paperclip');
      if (/\.(png|jpe?g|gif|svg|ico|webp)$/i.test(f.path)) return uiIcon('image');
      if (f.path.endsWith('.html')) return uiIcon('file-text');
      if (f.path.endsWith('.css')) return uiIcon('palette');
      if (f.path.endsWith('.js')) return uiIcon('zap');
      if (f.path.endsWith('.txt')) return uiIcon('file-text');
      return uiIcon('file-text');
    };

    const formatSize = (bytes) => {
      if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return bytes + ' B';
    };

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${activeTab === 'mikrotik' ? 'MikroTik Portal Files' : (activeTab === 'stub' ? 'Stub Portal Files' : 'Panel Portal')}</h3>
          <div style="display:flex;gap:0.5rem;align-items:center">
            ${routers.length > 0 && activeTab !== 'panel-page' ? `
              <select id="portal-router-select" class="btn btn-outline">
                ${routers.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
              </select>
              <button class="btn btn-primary btn-sm" onclick="App.pushPortal()">Push All to Router</button>
            ` : (activeTab === 'panel-page' ? '<span class="status-badge connected">Panel-hosted portal — served directly by this panel</span>' : '<span class="status-badge disconnected">No connected routers — connect one on the Routers page</span>')}
          </div>
        </div>
        ${this._portalTabs(activeTab)}
        ${activeTab === 'stub' && routers.length > 0 ? (() => {
          const selectedRouter = routers.find(r => r.id === this.selectedRouterId);
          const panelUrl = selectedRouter?.panel_url || '';
          return `
            <div style="padding:1rem;background:var(--bg);border-bottom:1px solid var(--border)">
              <div style="display:flex;gap:0.5rem;align-items:center;max-width:600px">
                <label style="font-weight:600;white-space:nowrap">Panel Redirect URL:</label>
                <input type="text" id="stub-panel-url-input" value="${this.escapeHtml(panelUrl)}"
                  placeholder="http://10.0.0.252:3000 (leave empty for auto-detect)"
                  style="flex:1;padding:0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.875rem">
                <button class="btn btn-sm btn-primary" onclick="App.saveStubPanelUrl()">Save</button>
              </div>
              <small style="color:var(--text-muted);font-size:0.75rem;display:block;margin-top:0.25rem">
                The URL where stubs should redirect to (this panel's address). Update when moving SBC to a different network.
              </small>
            </div>
          `;
        })() : ''}
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
                ${activeTab !== 'stub' ? `<button class="btn btn-sm btn-outline" id="portal-themes-btn" onclick="App.openPortalThemes()">${uiIcon('palette')} Themes</button>` : ''}
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

    const routerSelect = document.getElementById('portal-router-select');
    if (routerSelect && routers.length > 0) {
      if (!this.selectedRouterId || !routers.find((r) => r.id === this.selectedRouterId)) {
        this.selectedRouterId = routers[0].id;
        routerSelect.value = this.selectedRouterId;
      }
      routerSelect.addEventListener('change', (e) => {
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

  switchPortalTab(tab) {
    if (tab === this.portalActiveTab) return;
    if (this.portalDirty && !confirm('You have unsaved changes. Switching tabs will discard them. Continue?')) return;
    this.portalDirty = false;
    this.portalActiveTab = tab;
    this.portalCurrentFile = null;
    this.renderPortal();
  },

  _portalTabs(activeTab) {
    return `
      <div class="tabs portal-tabs">
        <button class="tab portal-tab ${activeTab === 'mikrotik' ? 'active' : ''}" onclick="App.switchPortalTab('mikrotik')">${uiIcon('file-text')} MikroTik Portal</button>
        <button class="tab portal-tab ${activeTab === 'stub' ? 'active' : ''}" onclick="App.switchPortalTab('stub')">${uiIcon('link')} Stub Portal</button>
        <button class="tab portal-tab ${activeTab === 'panel-page' ? 'active' : ''}" onclick="App.switchPortalTab('panel-page')">${uiIcon('monitor')} Panel Portal</button>
        <button class="tab portal-tab ${activeTab === 'banner' ? 'active' : ''}" onclick="App.switchPortalTab('banner')">${uiIcon('image')} Banner Uploader</button>
        <button class="tab portal-tab ${activeTab === 'sounds' ? 'active' : ''}" onclick="App.switchPortalTab('sounds')">${uiIcon('music')} Sounds</button>
      </div>
    `;
  },

  // Portal > Sounds. The two coin sounds are stored on this server and served
  // from the same origin as the portal page itself, so a phone that is still
  // captive - the walled garden only opens the controller's address - reaches
  // them exactly like it reaches the portal HTML.
  async renderPortalSounds(content) {
    let sounds = { insert_coin: '', coin_drop: '', defaults: {} };
    try {
      sounds = await api.getPortalSounds();
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
      return;
    }

    const slots = [
      {
        kind: 'insert-coin',
        key: 'insert_coin',
        title: 'Insert coin sound',
        hint: 'Starts the moment the customer presses INSERT COIN / ADD TIME, then loops while the coin slot is open.',
        builtin: 'insertcoinbg.mp3',
      },
      {
        kind: 'coin-drop',
        key: 'coin_drop',
        title: 'Coin drop sound',
        hint: 'Plays once for every coin the machine reports, on top of the insert-coin loop.',
        builtin: 'coin-received.mp3',
      },
    ];

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Portal Coin Sounds</h3>
          <span class="status-badge connected">Panel-hosted portal - nothing to push to a router</span>
        </div>
        ${this._portalTabs('sounds')}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;padding:1rem">
          ${slots.map((slot) => {
            const custom = sounds[slot.key] || '';
            const src = custom || (sounds.defaults ? sounds.defaults[slot.key] : '') || '';
            return `
              <div style="border:1px solid var(--border);border-radius:8px;padding:1rem">
                <div class="dash-card-title" style="display:flex;align-items:center;gap:0.4rem">
                  ${uiIcon('music')} ${slot.title}
                  <span class="status-badge ${custom ? 'connected' : 'disconnected'}">${custom ? 'Custom' : 'Built-in'}</span>
                </div>
                <p style="color:var(--text-muted);font-size:0.8rem;margin:0.5rem 0">${slot.hint}</p>
                ${src ? `<audio controls preload="none" src="${src}" style="width:100%;margin-bottom:0.75rem"></audio>` : ''}
                <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
                  <input type="file" id="sound-file-${slot.kind}" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
                    style="flex:1;min-width:170px;font-size:0.8rem">
                  <button class="btn btn-sm btn-primary" id="sound-upload-${slot.kind}" onclick="App.uploadPortalSound('${slot.kind}')">${uiIcon('upload')} Upload</button>
                  <button class="btn btn-sm btn-outline" onclick="App.removePortalSound('${slot.kind}')" ${custom ? '' : 'disabled'}>${uiIcon('trash')} Built-in</button>
                </div>
                <small style="color:var(--text-muted);display:block;margin-top:0.5rem">
                  Now playing: ${this.escapeHtml(custom ? custom.split('/').pop() : slot.builtin)}
                </small>
              </div>
            `;
          }).join('')}
        </div>
        <div style="padding:0 1rem 1rem;color:var(--text-muted);font-size:0.8rem">
          MP3, WAV, OGG, M4A or AAC, up to 10 MB. Keep the insert-coin sound short - it repeats until the slot
          closes. A customer hears a change on their very next coin press, no portal update needed.
        </div>
      </div>
    `;
  },

  async uploadPortalSound(kind) {
    const input = document.getElementById(`sound-file-${kind}`);
    const file = input && input.files && input.files[0];
    if (!file) {
      this.toast('Choose an audio file first', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.toast('Audio must be 10 MB or smaller', 'error');
      return;
    }

    const button = document.getElementById(`sound-upload-${kind}`);
    const buttonHtml = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Uploading...';
    }

    try {
      await api.uploadPortalSound(kind, file);
      this.toast('Sound saved', 'success');
      await this.renderPortal();
    } catch (err) {
      this.toast(err.message, 'error');
      if (button) {
        button.disabled = false;
        button.innerHTML = buttonHtml;
      }
    }
  },

  async removePortalSound(kind) {
    if (!confirm('Remove this sound and play the built-in one again?')) return;
    try {
      await api.deletePortalSound(kind);
      this.toast('Sound removed', 'success');
      await this.renderPortal();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  // Portal > Banner Uploader. The picture replaces the JuanFi artwork at the
  // top of the customer portal (public/portal.html). It lives on this server and
  // is served from the same origin as the portal page itself, so a phone that
  // is still captive reaches it exactly like it reaches the portal HTML. The
  // portal script swaps the image at load time, so the operator's own copy of
  // portal.html is never rewritten.
  async renderPortalBanner(content) {
    let branding = { portal_banner: '', default_banner: '/assets/MainPic.PNG' };
    try {
      branding = await api.getBranding();
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
      return;
    }

    const custom = branding.portal_banner || '';
    const shown = custom || branding.default_banner || '';

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Banner Uploader</h3>
          <span class="status-badge connected">Panel-hosted portal - nothing to push to a router</span>
        </div>
        ${this._portalTabs('banner')}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;padding:1rem">
          <div style="border:1px solid var(--border);border-radius:8px;padding:1rem">
            <div class="dash-card-title" style="display:flex;align-items:center;gap:0.4rem">
              ${uiIcon('image')} Portal banner
              <span class="status-badge ${custom ? 'connected' : 'disconnected'}">${custom ? 'Custom' : 'JuanFi default'}</span>
            </div>
            <p style="color:var(--text-muted);font-size:0.8rem;margin:0.5rem 0">
              The picture at the top of the customer portal. Upload any image to replace the JuanFi artwork
              for every customer.
            </p>
            <div style="background:var(--bg);border-radius:6px;padding:0.5rem;text-align:center;margin-bottom:0.75rem">
              ${shown ? `<img src="${this.escapeHtml(shown)}" alt="Portal banner" style="max-width:100%;max-height:220px;border-radius:4px">` : ''}
            </div>
            <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
              <input type="file" id="banner-file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                style="flex:1;min-width:170px;font-size:0.8rem">
              <button class="btn btn-sm btn-primary" id="banner-upload" onclick="App.uploadPortalBanner()">${uiIcon('upload')} Upload</button>
              <button class="btn btn-sm btn-outline" onclick="App.removePortalBanner()" ${custom ? '' : 'disabled'}>${uiIcon('trash')} JuanFi Default</button>
            </div>
            <small style="color:var(--text-muted);display:block;margin-top:0.5rem">
              Now showing: ${this.escapeHtml(custom ? custom.split('/').pop() : 'MainPic.PNG (JuanFi)')}
            </small>
          </div>
        </div>
        <div style="padding:0 1rem 1rem;color:var(--text-muted);font-size:0.8rem">
          PNG, JPEG or WebP, up to 5 MB. A wide picture (about 900 x 500) fits the portal card best.
          Customers see the change on their next portal load - nothing is uploaded to the router.
        </div>
      </div>
    `;
  },

  async uploadPortalBanner() {
    const input = document.getElementById('banner-file');
    const file = input && input.files && input.files[0];
    if (!file) {
      this.toast('Choose an image file first', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.toast('Banner must be 5 MB or smaller', 'error');
      return;
    }

    const button = document.getElementById('banner-upload');
    const buttonHtml = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Uploading...';
    }

    try {
      await api.uploadPortalBanner(file);
      this.toast('Banner saved', 'success');
      await this.renderPortal();
    } catch (err) {
      this.toast(err.message, 'error');
      if (button) {
        button.disabled = false;
        button.innerHTML = buttonHtml;
      }
    }
  },

  async removePortalBanner() {
    if (!confirm('Remove the custom banner and show the JuanFi artwork again?')) return;
    try {
      await api.deletePortalBanner();
      this.toast('Banner reset to the JuanFi artwork', 'success');
      await this.renderPortal();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async saveStubPanelUrl() {
    const input = document.getElementById('stub-panel-url-input');
    if (!input) return;

    const panelUrl = input.value.trim();
    const routerId = this.selectedRouterId;

    if (!routerId) {
      this.toast('No router selected', 'error');
      return;
    }

    try {
      // Get current router data to preserve other fields
      const routers = await api.getRouters();
      const router = routers.find(r => r.id === routerId);
      if (!router) {
        this.toast('Router not found', 'error');
        return;
      }

      await api.updateRouter(routerId, {
        name: router.name,
        host: router.host,
        port: router.port,
        username: router.username,
        password: router.password,
        description: router.description || '',
        use_rest_api: router.use_rest_api,
        auth_mode: router.auth_mode,
        portal_mode: router.portal_mode,
        panel_url: panelUrl,
      });

      this.toast('Panel redirect URL saved — push stubs to apply', 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  _portalFolder() {
    if (this.portalActiveTab === 'panel-page') return 'panel-page';
    return this.portalActiveTab === 'stub' ? 'stub' : 'hotspot';
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
    const hasRouter = !!this.selectedRouterId && this._portalFolder() !== 'panel-page';

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
      const row = await api.getPortalFile(filePath, this._portalFolder());
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
      const folder = this._portalFolder();
      const res = await api.getPortalFile(this.portalCurrentFile, folder);
      let html = res.content;
      if (this._portalPreviewTheme) {
        html = PortalThemes.applyTheme(html, PortalThemes.getTheme(this._portalPreviewTheme), folder);
      }
      html = html.replace(/\$\((link-[\w-]+)\)/g, '#');
      html = html.replace(/\$\((chap-challenge|chap-id|mac|ip|error|username|server-address|link-orig|link-status)\)/g, '');
      const assetsBase = folder === 'panel-page' ? '/' : folder === 'stub' ? '/stub-assets/' : '/hotspot-assets/';
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head><base href="${assetsBase}">`);
      } else if (html.includes('<html')) {
        html = html.replace(/<html[^>]*>/i, (m) => m + `<head><base href="${assetsBase}"></head>`);
      } else {
        html = `<base href="${assetsBase}">` + html;
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
      await api.savePortalFile(this.portalCurrentFile, editor.value, this._portalFolder());
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
      const res = await api.pushPortalFile(routerId, this.portalCurrentFile, this._portalFolder());
      this.toast(res.message || `${this.portalCurrentFile} uploaded to router`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async resetPortalFile() {
    if (!confirm(`Reset ${this.portalCurrentFile} to the default template? Unsaved changes will be lost.`)) return;
    try {
      await api.resetPortalFile(this.portalCurrentFile, this._portalFolder());
      await this.selectPortalFile(this.portalCurrentFile, true);
      this.toast(`${this.portalCurrentFile} reset to default`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  openPortalThemes() {
    const folder = this._portalFolder();
    if (folder === 'stub') {
      this.toast('Stub pages only redirect visitors. Change the theme in Panel Portal.', 'info');
      return;
    }
    let modal = document.getElementById('portal-themes-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'portal-themes-modal';
      document.body.appendChild(modal);
    }
    const themes = PortalThemes.getThemeList();
    modal.innerHTML = `
      <div class="ptm-backdrop" onclick="App.closePortalThemes()"></div>
      <div class="ptm-dialog">
        <div class="ptm-header">
          <h3>Portal Themes</h3>
          <button class="ptm-close" onclick="App.closePortalThemes()">&times;</button>
        </div>
        <div class="ptm-body">
          <p class="ptm-hint">${folder === 'panel-page'
            ? 'Preview a theme, then apply it to portal.html. Changes are served directly by the panel; no router upload is needed. Default removes the theme and restores the panel page styling.'
            : 'Preview how each theme looks, then apply. Default restores the original JuanFi UI. Applying a theme updates login.html, status.html, and logout.html — use "Push All to Router" to upload them to your MikroTik.'}</p>
          <div class="ptm-grid">
            ${themes.map((t) => `
              <div class="ptm-card" data-theme="${t.id}">
                <div class="ptm-banner" style="background: ${t.banner}"></div>
                <div class="ptm-card-body">
                  <div class="ptm-name">${this.escapeHtml(folder === 'panel-page' && t.id === 'default' ? 'Default (Panel)' : t.name)}</div>
                  <div class="ptm-desc">${this.escapeHtml(folder === 'panel-page' && t.id === 'default' ? 'Original panel portal styling' : t.description)}</div>
                  <div class="ptm-swatches">
                    ${t.swatches.map((c) => `<span class="ptm-swatch" style="background:${c}" title="${c}"></span>`).join('')}
                  </div>
                  <div class="ptm-card-actions">
                    <button class="btn btn-sm btn-outline" onclick="App.previewPortalTheme('${t.id}')">Preview</button>
                    <button class="btn btn-sm btn-primary" onclick="App.applyPortalTheme('${t.id}')">Apply</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="ptm-footer">
          <button class="btn btn-outline" onclick="App.closePortalThemes()">Close</button>
        </div>
      </div>
    `;
    requestAnimationFrame(() => modal.classList.add('ptm-open'));
  },

  closePortalThemes() {
    const modal = document.getElementById('portal-themes-modal');
    if (modal) {
      modal.classList.remove('ptm-open');
      setTimeout(() => modal.remove(), 180);
    }
    this._portalPreviewTheme = null;
    this.updatePortalPreview();
  },

  async previewPortalTheme(themeId) {
    const theme = PortalThemes.getTheme(themeId);
    document.querySelectorAll('.ptm-card').forEach((c) => {
      c.classList.toggle('ptm-previewing', c.dataset.theme === themeId);
    });
    this._portalPreviewTheme = themeId;
    await this.updatePortalPreview();
  },

  async applyPortalTheme(themeId) {
    if (this._portalThemeApplying) return;
    const folder = this._portalFolder();
    if (folder === 'stub') {
      this.toast('Stub pages only redirect visitors. Change the theme in Panel Portal.', 'info');
      return;
    }
    const theme = PortalThemes.getTheme(themeId);
    const label = folder === 'panel-page' && theme.id === 'default' ? 'Default (Panel)' : theme.name;
    const files = folder === 'panel-page' ? ['portal.html'] : ['login.html', 'status.html', 'logout.html'];
    const delivery = folder === 'panel-page' ? 'Changes are served by the panel; no router upload is needed.'
      : 'Use Push All to Router afterward.';
    if (!confirm(`Apply "${label}" theme to ${files.join(', ')}? Unsaved editor changes will be discarded. You can revert the styling with Default. ${delivery}`)) return;

    this._portalThemeApplying = true;
    try {
      // Finish reading and transforming all targets before saving any file.
      const pages = await Promise.all(files.map(async (file) => {
        const page = await api.getPortalFile(file, folder);
        return { file, content: PortalThemes.applyTheme(page.content, theme, folder) };
      }));
      for (const page of pages) await api.savePortalFile(page.file, page.content, folder);
      if (this._portalFolder() === folder) {
        this.portalDirty = false;
        this._portalPreviewTheme = null;
        this.closePortalThemes();
        await this.renderPortal();
      }
      this.toast(`"${label}" theme applied`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    } finally {
      this._portalThemeApplying = false;
    }
  },

  async renderTools() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Tools</h3>
        </div>
        <div class="tab-bar">
          <button class="tab-btn active" data-toolstab="zerotier" onclick="App.switchToolsTab('zerotier')">ZeroTier</button>
          <button class="tab-btn" data-toolstab="database" onclick="App.switchToolsTab('database')">Database</button>
          <button class="tab-btn" data-toolstab="cloud" onclick="App.switchToolsTab('cloud')">Cloud</button>
        </div>
        <div id="tools-tab-content"></div>
      </div>
    `;
    this._toolsTab = 'zerotier';
    await this.loadToolsTab();
  },

  async switchToolsTab(tab) {
    this._toolsTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.toolstab === tab);
    });
    await this.loadToolsTab();
  },

  async loadToolsTab() {
    const container = document.getElementById('tools-tab-content');
    if (!container) return;
    if (this._toolsTab === 'zerotier') {
      await this.loadZeroTierContent(container);
    } else if (this._toolsTab === 'database') {
      this.renderDatabaseContent(container);
    } else {
      await this.renderCloudContent(container);
    }
  },

  async loadZeroTierContent(container) {
    try {
      const status = await api.getZeroTierStatus();
      if (!status.installed) {
        container.innerHTML = `
          <div style="text-align:center;padding:2rem 0">
            <div style="margin-bottom:1rem">${uiIcon('lock', 'icon-3xl')}</div>
            <h4>ZeroTier Not Installed</h4>
            <p style="color:var(--text-muted);max-width:500px;margin:0.5rem auto 1.5rem">
              Install ZeroTier to access this panel remotely from anywhere in the world.
              ZeroTier creates a secure virtual network between your devices.
            </p>
            <button class="btn btn-primary btn-lg" onclick="App.installZeroTier()" id="zt-install-btn">
              Install ZeroTier
            </button>
            <div id="zt-install-status" style="margin-top:1rem;color:var(--text-muted);font-size:0.9rem"></div>
            <div id="zt-manual-instructions" style="display:none;background:var(--bg);padding:1.5rem;border-radius:8px;max-width:650px;margin:1.5rem auto 0;text-align:left">
              <h5 style="margin-top:0">Manual Installation (if auto-install fails):</h5>
              <pre style="background:var(--bg);padding:1rem;border-radius:4px;overflow-x:auto;font-size:0.9rem;margin:0">
SSH into your SBC and run:

  sudo apt-get update
  sudo apt-get install -y zerotier-one
  sudo systemctl enable zerotier-one
  sudo systemctl start zerotier-one

Then join your network:
  sudo zerotier-cli join &lt;NETWORK_ID&gt;</pre>
            </div>
          </div>
        `;
        return;
      }

      const networksHtml = status.networks.length > 0
        ? status.networks.map((n) => `
          <div class="card" style="margin-bottom:0.75rem;border:1px solid var(--border)">
            <div style="padding:1rem;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-weight:600;font-size:1rem">${this.escapeHtml(n.name || 'Network')}</div>
                <div style="font-size:0.85rem;color:var(--text-muted)">
                  ID: ${this.escapeHtml(n.nwid)} &middot;
                  Status: <span style="color:${n.status === 'OK' ? 'var(--success)' : 'var(--warning)'}">${this.escapeHtml(n.status)}</span> &middot;
                  Type: ${this.escapeHtml(n.type)}
                </div>
                ${n.assignedAddresses.length > 0 ? `
                  <div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.25rem">
                    IPs: ${n.assignedAddresses.map((a) => this.escapeHtml(a)).join(', ')}
                  </div>
                ` : ''}
              </div>
              <button class="btn btn-sm btn-outline" onclick="App.leaveZeroTierNetwork('${this.escapeHtml(n.nwid)}')">Leave</button>
            </div>
          </div>
        `).join('')
        : '<p style="color:var(--text-muted);text-align:center;padding:1rem 0">No networks joined yet.</p>';

      container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
          <div class="card" style="border:1px solid var(--border)">
            <div style="padding:1rem">
              <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.25rem">ZeroTier Address</div>
              <div style="font-weight:600;font-size:1.1rem;font-family:monospace">${this.escapeHtml(status.address || 'N/A')}</div>
            </div>
          </div>
          <div class="card" style="border:1px solid var(--border)">
            <div style="padding:1rem">
              <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.25rem">Status</div>
              <div style="font-weight:600;font-size:1.1rem">
                <span class="status-badge ${status.online ? 'connected' : 'disconnected'}">${status.online ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
        </div>

        <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center">
          <h4 style="margin:0">Networks</h4>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input type="text" id="zt-network-id" placeholder="Enter Network ID" class="form-control" style="width:220px;font-family:monospace">
            <button class="btn btn-primary btn-sm" onclick="App.joinZeroTierNetwork()">Join Network</button>
          </div>
        </div>
        ${networksHtml}
      `;
    } catch (err) {
      container.innerHTML = `<div style="color:var(--danger);text-align:center;padding:2rem">Error: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderDatabaseContent(container) {
    container.innerHTML = `
      <div style="max-width:700px;margin:0 auto">
        <div class="card" style="border:1px solid var(--border);margin-bottom:1.5rem">
          <div style="padding:1.5rem">
            <h4 style="margin-top:0;display:flex;align-items:center;gap:0.5rem">
              ${uiIcon('download')} Download Backup
            </h4>
            <p style="color:var(--text-muted);margin:0.5rem 0 1rem">
              Download a copy of your database including all hotspot users, vouchers, sessions,
              router configurations, and settings. Keep this file safe for disaster recovery.
            </p>
            <button class="btn btn-primary" onclick="App.downloadDatabaseBackup()">
              Download Database Backup
            </button>
          </div>
        </div>

        <div class="card" style="border:1px solid var(--border);margin-bottom:1.5rem">
          <div style="padding:1.5rem">
            <h4 style="margin-top:0;display:flex;align-items:center;gap:0.5rem">
              ${uiIcon('upload')} Restore Database
            </h4>
            <p style="color:var(--text-muted);margin:0.5rem 0 1rem">
              Upload a previously downloaded backup to restore your system. The current database
              will be backed up automatically before restoring.
            </p>
            <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
              <input type="file" id="db-restore-file" accept=".db,.sqlite,.bak" class="form-control" style="flex:1;min-width:200px">
              <button class="btn btn-warning" onclick="App.restoreDatabase()" id="db-restore-btn">
                Restore from Backup
              </button>
            </div>
            <div id="db-restore-status" style="margin-top:0.75rem;font-size:0.9rem"></div>
          </div>
        </div>

        <div class="card" style="border:1px solid var(--danger);background:rgba(220,53,69,0.05)">
          <div style="padding:1.5rem">
            <h4 style="margin-top:0;color:var(--danger);display:flex;align-items:center;gap:0.5rem">
              ${uiIcon('alert-triangle')} Important Notes
            </h4>
            <ul style="color:var(--text-muted);margin:0.5rem 0 0;padding-left:1.25rem;line-height:1.8">
              <li>After restoring, <strong>restart the panel</strong> for changes to take effect.</li>
              <li>Restoring replaces all current data &mdash; users, vouchers, sessions, and settings.</li>
              <li>A backup of the current database is created automatically before any restore.</li>
              <li>Only restore backups from this same panel system.</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  },

  async downloadDatabaseBackup() {
    try {
      await api.downloadDatabaseBackup();
      this.toast('Database backup downloaded', 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async restoreDatabase() {
    const fileInput = document.getElementById('db-restore-file');
    const statusEl = document.getElementById('db-restore-status');
    const btn = document.getElementById('db-restore-btn');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      this.toast('Please select a backup file first', 'error');
      return;
    }
    if (!confirm('This will replace your current database. All existing data will be lost. Continue?')) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Restoring...'; }
    if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = 'Reading file...'; }
    try {
      const file = fileInput.files[0];
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          const commaIndex = result.indexOf(',');
          resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      if (statusEl) statusEl.textContent = 'Uploading and restoring database...';
      const res = await api.restoreDatabase(base64);
      if (statusEl) { statusEl.style.color = 'var(--success)'; statusEl.textContent = res.message || 'Database restored successfully.'; }
      this.toast('Database restored. Restart the panel to apply changes.', 'success');
    } catch (err) {
      this.toast(err.message, 'error');
      if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Restore failed: ' + this.escapeHtml(err.message); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Restore from Backup'; }
    }
  },

  async renderCloudContent(container) {
    try {
      const cfg = await api.getTursoConfig();
      container.innerHTML = `
        <div style="max-width:700px;margin:0 auto">
          <div class="card" style="border:1px solid var(--border);margin-bottom:1.5rem">
            <div style="padding:1.5rem">
              <h4 style="margin-top:0;display:flex;align-items:center;gap:0.5rem">
                <span style="font-size:1.3rem">&#9729;</span> Turso Cloud Database
              </h4>
              <p style="color:var(--text-muted);margin:0.5rem 0 1rem">
                Upload this panel's whole database to a Turso cloud database — accounts, vouchers, sessions, sales, payments, wallets, chats and settings — for backup and multi-panel reporting.
              </p>

              <div style="margin-bottom:1rem">
                <label style="display:block;margin-bottom:0.25rem;font-weight:500;font-size:0.9rem">Turso Database URL</label>
                <input type="text" id="turso-url" value="${this.escapeHtml(cfg.url || '')}" placeholder="libsql://your-db.turso.io" class="form-control">
              </div>

              <div style="margin-bottom:1rem">
                <label style="display:block;margin-bottom:0.25rem;font-weight:500;font-size:0.9rem">Auth Token</label>
                <input type="password" id="turso-token" value="" placeholder="Enter your Turso auth token" class="form-control">
                ${cfg.configured ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem">Current: ${this.escapeHtml(cfg.authToken)}</div>` : ''}
              </div>

              <div style="margin-bottom:1rem;padding:1rem;background:var(--bg);border-radius:6px">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                  <input type="checkbox" id="turso-auto-sync" ${cfg.autoSync ? 'checked' : ''}>
                  <span style="font-weight:500">Enable Auto-Sync</span>
                </label>
                <div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.5rem">
                  Automatically sync to cloud every
                  <input type="number" id="turso-sync-interval" value="${cfg.autoSyncInterval || 10}" min="5" max="300" style="width:60px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)">
                  seconds. Only tables that changed are re-sent, so history is not re-uploaded on every tick. New controllers with empty database will auto-pull from cloud on startup.
                </div>
              </div>

              <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" onclick="App.saveTursoConfig()">Save Config</button>
                <button class="btn btn-outline btn-sm" onclick="App.testTursoConnection()" id="turso-test-btn">Test Connection</button>
              </div>
              <div id="turso-config-status" style="margin-top:0.75rem;font-size:0.9rem"></div>
            </div>
          </div>

          <div class="card" style="border:1px solid var(--border);margin-bottom:1.5rem">
            <div style="padding:1.5rem">
              <h4 style="margin-top:0;display:flex;align-items:center;gap:0.5rem">
                ${uiIcon('upload')} Sync &amp; Restore
              </h4>
              <p style="color:var(--text-muted);margin:0.5rem 0 1rem">
                Sync uploads every table of this panel. Restore only merges the shared roaming tables (accounts, vouchers, session tokens, device MACs) back — it never overwrites this panel's own sales, payments, wallet balances or settings.
              </p>
              <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
                <button class="btn btn-primary" onclick="App.syncToTurso()" id="turso-sync-btn">
                  Sync to Cloud
                </button>
                <button class="btn btn-warning" onclick="App.restoreFromTurso()" id="turso-restore-btn">
                  Restore from Cloud
                </button>
              </div>
              <div id="turso-sync-status" style="margin-top:0.75rem;font-size:0.9rem"></div>
            </div>
          </div>

          <div class="card" style="border:1px solid var(--border)">
            <div style="padding:1.5rem">
              <h4 style="margin-top:0;color:var(--text-muted);font-size:1rem">What Gets Synced</h4>
              <ul style="color:var(--text-muted);margin:0.5rem 0 0;padding-left:1.25rem;line-height:1.8">
                <li><strong>Roaming, two-way</strong> — hotspot_users, vouchers, device_sessions, device_macs. An account or voucher follows the device to any router.</li>
                <li><strong>Panel book, upload only</strong> — routers, admin_users, portal_files, bandwidth/radius profiles, radius_clients, radius_sessions, session_bindings, ppp_customers, pppoe_servers, billing plans/settings, ppp_payments, payments, payment_rates, aircoins_sales, cafe machines/settings/sessions, trial claims, chat threads and messages.</li>
                <li><strong>Wallet, upload only</strong> — wallet_accounts, wallet_transactions, wallet_topup_sessions, wallet_devices, wallet_settings. Balances are never merged back, so no panel can overwrite another shop's money.</li>
                <li><strong>Kept local</strong> — active_devices (live router state), radius_logs and monitoring_logs (high-volume telemetry), wallet_auth_codes (one-shot codes), cafe_candidates (discovery beacons).</li>
              </ul>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div style="color:var(--danger);text-align:center;padding:2rem">Error: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  async saveTursoConfig() {
    const url = document.getElementById('turso-url')?.value.trim();
    const authToken = document.getElementById('turso-token')?.value.trim();
    const autoSync = document.getElementById('turso-auto-sync')?.checked || false;
    const autoSyncInterval = parseInt(document.getElementById('turso-sync-interval')?.value || '10') * 1000;
    const statusEl = document.getElementById('turso-config-status');
    if (!url || !authToken) {
      this.toast('URL and auth token are required', 'error');
      return;
    }
    try {
      const res = await api.saveTursoConfig(url, authToken, autoSync, autoSyncInterval);
      this.toast(res.message || 'Configuration saved', 'success');
      if (statusEl) { statusEl.style.color = 'var(--success)'; statusEl.textContent = res.message; }
      await this.loadToolsTab();
    } catch (err) {
      this.toast(err.message, 'error');
      if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = err.message; }
    }
  },

  async testTursoConnection() {
    const btn = document.getElementById('turso-test-btn');
    const statusEl = document.getElementById('turso-config-status');
    if (btn) { btn.disabled = true; btn.textContent = 'Testing...'; }
    try {
      const res = await api.testTursoConnection();
      if (res.success) {
        this.toast(res.message, 'success');
        if (statusEl) { statusEl.style.color = 'var(--success)'; statusEl.textContent = res.message; }
      } else {
        this.toast(res.message, 'error');
        if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = res.message; }
      }
    } catch (err) {
      this.toast(err.message, 'error');
      if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = err.message; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Test Connection'; }
    }
  },

  async syncToTurso() {
    const btn = document.getElementById('turso-sync-btn');
    const statusEl = document.getElementById('turso-sync-status');
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
    try {
      const res = await api.syncToTurso();
      if (res.success) {
        const entries = Object.entries(res.counts || {});
        const total = entries.reduce((n, [, v]) => n + v, 0);
        const rows = entries.filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ');
        this.toast(`Synced ${entries.length} tables to cloud`, 'success');
        if (statusEl) { statusEl.style.color = 'var(--success)'; statusEl.textContent = `${res.message} — ${total} rows (${rows})`; }
      } else {
        this.toast(res.message, 'error');
        if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = res.message; }
      }
    } catch (err) {
      this.toast(err.message, 'error');
      if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = err.message; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sync to Cloud'; }
    }
  },

  async restoreFromTurso() {
    if (!confirm('Merge the shared roaming tables (accounts, vouchers, session tokens, device MACs) from Turso into this panel? Sales, payments, wallet balances and settings stay exactly as they are locally. Continue?')) return;
    const btn = document.getElementById('turso-restore-btn');
    const statusEl = document.getElementById('turso-sync-status');
    if (btn) { btn.disabled = true; btn.textContent = 'Restoring...'; }
    try {
      const res = await api.restoreFromTurso();
      if (res.success) {
        const counts = Object.entries(res.counts || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
        this.toast(`Restored from cloud (${counts})`, 'success');
        if (statusEl) { statusEl.style.color = 'var(--success)'; statusEl.textContent = `${res.message} — ${counts}`; }
      } else {
        this.toast(res.message, 'error');
        if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = res.message; }
      }
    } catch (err) {
      this.toast(err.message, 'error');
      if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = err.message; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Restore from Cloud'; }
    }
  },

  async installZeroTier() {
    const btn = document.getElementById('zt-install-btn');
    const statusEl = document.getElementById('zt-install-status');
    const manualEl = document.getElementById('zt-manual-instructions');
    if (btn) { btn.disabled = true; btn.textContent = 'Installing...'; }
    if (statusEl) statusEl.textContent = 'Downloading and installing ZeroTier. This may take a minute...';
    if (manualEl) manualEl.style.display = 'none';
    try {
      const res = await api.installZeroTier();
      this.toast(res.message || 'ZeroTier installed successfully', 'success');
      await this.loadToolsTab();
    } catch (err) {
      const isPermissionError = err.message && err.message.includes('PERMISSION_DENIED');
      if (isPermissionError) {
        this.toast('Auto-install failed due to permissions. Showing manual instructions.', 'error');
        if (manualEl) manualEl.style.display = 'block';
        if (statusEl) statusEl.textContent = 'Auto-install failed. Use the manual commands below.';
        if (btn) { btn.disabled = false; btn.textContent = 'Install ZeroTier'; }
      } else {
        this.toast(err.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Install ZeroTier'; }
        if (statusEl) statusEl.textContent = 'Installation failed: ' + err.message;
      }
    }
  },

  async joinZeroTierNetwork() {
    const input = document.getElementById('zt-network-id');
    const networkId = input ? input.value.trim() : '';
    if (!networkId) { this.toast('Enter a network ID', 'error'); return; }
    try {
      const res = await api.joinZeroTierNetwork(networkId);
      this.toast(res.message || `Joined network ${networkId}`, 'success');
      await this.loadToolsTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async leaveZeroTierNetwork(networkId) {
    if (!confirm(`Leave network ${networkId}? You will lose remote access if this is your only network.`)) return;
    try {
      const res = await api.leaveZeroTierNetwork(networkId);
      this.toast(res.message || `Left network ${networkId}`, 'success');
      await this.loadToolsTab();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async renderAppearance() {
    const content = document.getElementById('page-content');
    const themes = window.AdminThemes ? AdminThemes.getThemeList() : [];
    const activeId = window.AdminThemes ? AdminThemes.getStoredId() : 'midnight';
    content.innerHTML = `
      <div class="appearance-hero">
        <div class="appearance-hero-text">
          <h2>Admin Dashboard Themes</h2>
          <p>Choose a look for your control panel. Your selection is saved locally and applied instantly.</p>
        </div>
        <div class="appearance-current">
          <span class="appearance-current-label">Active theme</span>
          <span class="appearance-current-name" id="appearance-current-name">${this.escapeHtml(AdminThemes.getTheme(activeId).name)}</span>
        </div>
      </div>
      <div class="appearance-grid">
        ${themes.map((t) => `
          <div class="appearance-card${t.id === activeId ? ' active' : ''}" data-theme="${t.id}" onclick="App.applyAdminTheme('${t.id}')">
            <div class="appearance-banner" style="background: ${t.banner}">
              ${t.id === activeId ? `<span class="appearance-check">${uiIcon('check')}</span>` : ''}
            </div>
            <div class="appearance-body">
              <div class="appearance-name">${this.escapeHtml(t.name)}</div>
              <div class="appearance-desc">${this.escapeHtml(t.description)}</div>
              <div class="appearance-swatches">
                ${t.swatches.map((c) => `<span class="appearance-swatch" style="background:${c}" title="${c}"></span>`).join('')}
              </div>
              <div class="appearance-actions">
                <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();App.previewAdminTheme('${t.id}')">Preview</button>
                <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();App.applyAdminTheme('${t.id}')">${t.id === activeId ? 'Active' : 'Apply'}</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  previewAdminTheme(themeId) {
    if (!window.AdminThemes) return;
    AdminThemes.apply(themeId);
    this.toast(`Previewing "${AdminThemes.getTheme(themeId).name}"`, 'info');
  },

  applyAdminTheme(themeId) {
    if (!window.AdminThemes) return;
    const theme = AdminThemes.apply(themeId);
    const nameEl = document.getElementById('appearance-current-name');
    if (nameEl) nameEl.textContent = theme.name;
    document.querySelectorAll('.appearance-card').forEach((c) => {
      const isActive = c.dataset.theme === themeId;
      c.classList.toggle('active', isActive);
      const applyBtn = c.querySelector('.appearance-actions .btn-primary');
      if (applyBtn) applyBtn.textContent = isActive ? 'Active' : 'Apply';
      const banner = c.querySelector('.appearance-banner');
      let check = banner ? banner.querySelector('.appearance-check') : null;
      if (isActive && banner && !check) {
        check = document.createElement('span');
        check.className = 'appearance-check';
        check.innerHTML = uiIcon('check');
        banner.appendChild(check);
      } else if (!isActive && check) {
        check.remove();
      }
    });
    this.toast(`"${theme.name}" theme applied`, 'success');
  },

  async loadBranding() {
    try {
      const branding = await api.getBranding();
      this.applyBranding(branding || {});
    } catch (e) {
      // Branding is cosmetic; keep the defaults when the endpoint is unreachable.
    }
  },

  applyBranding(branding = {}) {
    const name = String(branding.company_name || 'MikroTik').trim() || 'MikroTik';
    const logo = branding.logo_path || '';
    const fallbackIcon = uiIcon('zap');

    document.title = `${name} Controller`;

    const sidebarName = document.getElementById('sidebar-brand-name');
    if (sidebarName) sidebarName.textContent = name;
    const loginName = document.getElementById('login-brand-name');
    if (loginName) loginName.textContent = `${name} Controller`;

    const marks = [document.querySelector('.sidebar-header .brand-mark'), document.querySelector('.login-brand')];
    marks.forEach((mark) => {
      if (!mark) return;
      if (logo) {
        mark.classList.add('has-logo');
        mark.innerHTML = `<img src="${logo}" alt="${this.escapeHtml(name)} logo">`;
      } else {
        mark.classList.remove('has-logo');
        mark.innerHTML = fallbackIcon;
      }
    });
  },

  async loadSystemSettings(force = false) {
    if (!force && this._systemSettings) return this._systemSettings;
    if (!force && this._systemSettingsPromise) return this._systemSettingsPromise;
    this._systemSettingsPromise = api.getSystemSettings()
      .then((settings) => {
        this._systemSettings = settings || {};
        this.systemCurrency = this._systemSettings.currency || 'PHP';
        return this._systemSettings;
      })
      .catch(() => {
        this._systemSettings = { currency: 'PHP' };
        this.systemCurrency = 'PHP';
        return this._systemSettings;
      })
      .finally(() => { this._systemSettingsPromise = null; });
    return this._systemSettingsPromise;
  },

  formatAmount(code, amount) {
    const value = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code || 'PHP' }).format(value);
    } catch (e) {
      return `${code || 'PHP'} ${value.toFixed(2)}`;
    }
  },

  formatMoney(amount) {
    return this.formatAmount(this.systemCurrency, amount);
  },

  // SQLite stamps every row in UTC, but the shop reads its own wall clock: a
  // sale at 00:23 belongs to the new day. Every timestamp on screen and every
  // date filter goes through here, so the two never disagree. Keep the offset
  // in step with src/services/shopTime.ts.
  shopTzMinutes: 8 * 60,

  /** A stored UTC stamp shown on the shop clock: "2026-11-27 00:23:55". */
  shopTime(value) {
    if (!value) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value));
    if (!m) return String(value);
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], Number(m[6] || 0));
    const d = new Date(utc + this.shopTzMinutes * 60000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
      + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  },

  /** Today on the shop clock (YYYY-MM-DD), optionally that many days back. */
  shopToday(daysAgo) {
    const d = new Date(Date.now() + this.shopTzMinutes * 60000 - (Number(daysAgo) || 0) * 86400000);
    return d.toISOString().slice(0, 10);
  },

  async renderSystemSettings() {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="empty-state"><p>Loading settings...</p></div>';
    const settings = await this.loadSystemSettings(true);
    const tab = ['company', 'credentials'].includes(this._settingsTab) ? this._settingsTab : 'general';

    let username = '';
    if (tab === 'credentials') {
      try {
        const me = await api.getMe();
        username = me.username || '';
      } catch (e) {
        // The form still works; only the "signed in as" hint is missing.
      }
    }

    content.innerHTML = `
      <div class="settings-tabs">
        <button class="settings-tab ${tab === 'general' ? 'active' : ''}" onclick="App.switchSettingsTab('general')">General</button>
        <button class="settings-tab ${tab === 'company' ? 'active' : ''}" onclick="App.switchSettingsTab('company')">Company</button>
        <button class="settings-tab ${tab === 'credentials' ? 'active' : ''}" onclick="App.switchSettingsTab('credentials')">Admin Credential</button>
      </div>
      ${tab === 'company' ? this.companySettingsHtml(settings) : tab === 'credentials' ? this.credentialsSettingsHtml(username) : this.generalSettingsHtml(settings)}
    `;

    if (tab === 'company') {
      this._pendingLogoFile = null;
      this._pendingLogoRemoved = false;
    }
  },

  switchSettingsTab(tab) {
    this._settingsTab = ['company', 'credentials'].includes(tab) ? tab : 'general';
    this.renderSystemSettings();
  },

  generalSettingsHtml(settings) {
    const active = settings.currency || 'PHP';
    const trialOn = settings.trial_enabled !== false;
    const trialMinutes = settings.trial_minutes || 15;
    return `
      <div class="card" style="max-width:680px">
        <div class="card-header">
          <h3>${uiIcon('settings')} Panel Settings</h3>
        </div>
        <div style="padding:0.25rem 0 0">
          <div class="form-group">
            <label>Currency</label>
            <select id="system-currency" class="form-control" onchange="App.updateCurrencyPreview()">
              ${this.currencies.map((c) => `<option value="${c.code}" ${c.code === active ? 'selected' : ''}>${c.code} — ${this.escapeHtml(c.name)} (${c.symbol})</option>`).join('')}
            </select>
            <small style="display:block;margin-top:0.4rem;color:var(--text-muted)">Used for price displays across the panel, such as RADIUS profile prices.</small>
          </div>
          <div style="margin:1rem 0;padding:1rem 1.25rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">
            <div style="font-size:0.6875rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem">Portal Free Trial</div>
            <div class="form-group" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
              <input type="checkbox" id="system-trial-enabled" ${trialOn ? 'checked' : ''}>
              <label for="system-trial-enabled" style="margin:0">Show the TRIAL button on the customer portal</label>
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
              <label for="system-trial-minutes" style="margin:0;white-space:nowrap">Trial minutes</label>
              <input type="number" id="system-trial-minutes" class="form-control" style="max-width:120px" min="1" max="1440" value="${trialMinutes}">
              <small style="color:var(--text-muted)">per device, once per day (tracked through RADIUS like a coin insert)</small>
            </div>
          </div>
          <div style="margin:1rem 0 1.25rem;padding:1rem 1.25rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">
            <div style="font-size:0.6875rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted)">Preview</div>
            <div id="currency-preview" style="font-size:1.5rem;font-weight:650;margin-top:0.15rem">${this.formatAmount(active, 1234.5)}</div>
            <div style="font-size:0.8125rem;color:var(--text-muted)">Sample: 1-day voucher price</div>
          </div>
          <button class="btn btn-primary" onclick="App.saveSystemSettings()">${uiIcon('save')} Save Settings</button>
        </div>
      </div>
    `;
  },

  companySettingsHtml(settings) {
    const name = settings.company_name || 'MikroTik';
    const logo = settings.logo_path || '';
    const previewMark = logo
      ? `<span class="brand-mark has-logo" id="company-logo-preview"><img src="${logo}" alt=""></span>`
      : `<span class="brand-mark" id="company-logo-preview">${uiIcon('zap')}</span>`;

    return `
      <div class="card" style="max-width:760px">
        <div class="card-header">
          <h3>${uiIcon('store')} Company Settings</h3>
        </div>
        <div class="company-body">
          <div class="company-preview">
            <span class="company-preview-label">Sidebar preview</span>
            <div class="company-preview-shell">
              <div class="sidebar-header company-preview-header">
                ${previewMark}
                <span class="sidebar-brand-text">
                  <h2 id="company-name-preview">${this.escapeHtml(name)}</h2>
                  <span class="version">Controller</span>
                </span>
              </div>
            </div>
            <p class="pay-hint" style="margin:0.75rem 0 0">The name and logo are also used on the login screen and in the browser tab.</p>
          </div>

          <div class="company-form">
            <div class="form-group">
              <label>Panel name</label>
              <input id="company-name" class="form-control" maxlength="40" value="${this.escapeHtml(name)}" placeholder="MikroTik" oninput="App.updateCompanyPreview()">
            </div>

            <div class="form-group">
              <label>Logo</label>
              <div class="logo-actions">
                <input type="file" id="company-logo-input" accept="image/png,image/jpeg,image/webp" hidden onchange="App.handleCompanyLogoPick()">
                <button class="btn btn-outline btn-sm" type="button" onclick="document.getElementById('company-logo-input').click()">${uiIcon('image')} Choose image</button>
                <button class="btn btn-outline btn-sm" type="button" id="company-logo-remove" onclick="App.queueCompanyLogoRemoval()" ${logo ? '' : 'disabled'}>${uiIcon('trash')} Remove</button>
              </div>
              <small style="display:block;margin-top:0.5rem;color:var(--text-muted)">PNG, JPG or WebP, up to 5 MB. Large images are resized to 512px automatically.</small>
            </div>

            <div class="pay-form-actions">
              <button class="btn btn-primary" type="button" onclick="App.saveCompanySettings()">${uiIcon('save')} Save company settings</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  credentialsSettingsHtml(username) {
    return `
      <div class="card" style="max-width:680px">
        <div class="card-header">
          <h3>${uiIcon('shield')} Admin Credential</h3>
        </div>
        <form id="credential-form" onsubmit="App.saveAdminPassword(event)">
          <div class="cred-account">
            ${uiIcon('user')}
            <span>Signed in as <strong>${this.escapeHtml(username || 'admin')}</strong></span>
          </div>
          <div class="form-group">
            <label>Current password</label>
            <input id="cred-current" type="password" class="form-control" autocomplete="current-password" required>
          </div>
          <div class="form-group">
            <label>New password</label>
            <input id="cred-new" type="password" class="form-control" autocomplete="new-password" minlength="8" required>
          </div>
          <div class="form-group">
            <label>Confirm new password</label>
            <input id="cred-confirm" type="password" class="form-control" autocomplete="new-password" minlength="8" required>
          </div>
          <small style="display:block;color:var(--text-muted)">At least 8 characters. Use a password you don't reuse on other services.</small>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${uiIcon('key')} Update password</button>
          </div>
        </form>
      </div>
    `;
  },

  updateCompanyPreview() {
    const input = document.getElementById('company-name');
    const preview = document.getElementById('company-name-preview');
    if (input && preview) preview.textContent = input.value.trim() || 'MikroTik';
  },

  async handleCompanyLogoPick() {
    const input = document.getElementById('company-logo-input');
    const picked = input && input.files && input.files[0];
    if (!picked) return;
    if (picked.size > 5 * 1024 * 1024) {
      this.toast('Logo must be 5 MB or smaller', 'error');
      input.value = '';
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(picked.type)) {
      this.toast('Logo must be a PNG, JPG or WebP image', 'error');
      input.value = '';
      return;
    }

    let file = picked;
    try {
      file = await this.compressLogo(picked);
    } catch (e) {
      // Fall back to the original file if the browser cannot decode it.
    }

    this._pendingLogoFile = file;
    this._pendingLogoRemoved = false;

    const mark = document.getElementById('company-logo-preview');
    if (mark) {
      mark.classList.add('has-logo');
      mark.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
    }
    const remove = document.getElementById('company-logo-remove');
    if (remove) remove.disabled = false;
    this.toast('Logo ready — save to apply', 'info');
  },

  compressLogo(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const max = 512;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const keepsAlpha = file.type !== 'image/jpeg';
        const type = keepsAlpha ? 'image/png' : 'image/jpeg';
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], keepsAlpha ? 'logo.png' : 'logo.jpg', { type }));
        }, type, 0.92);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read image'));
      };
      img.src = url;
    });
  },

  queueCompanyLogoRemoval() {
    this._pendingLogoFile = null;
    this._pendingLogoRemoved = true;
    const input = document.getElementById('company-logo-input');
    if (input) input.value = '';

    const mark = document.getElementById('company-logo-preview');
    if (mark) {
      mark.classList.remove('has-logo');
      mark.innerHTML = uiIcon('zap');
    }
    const remove = document.getElementById('company-logo-remove');
    if (remove) remove.disabled = true;
    this.toast('Logo will be removed when you save', 'info');
  },

  async saveCompanySettings() {
    const input = document.getElementById('company-name');
    const name = (input?.value || '').trim();
    if (!name) {
      this.toast('Panel name cannot be empty', 'error');
      return;
    }

    const button = document.querySelector('.company-form .btn-primary');
    if (button) button.disabled = true;

    try {
      if (this._pendingLogoRemoved) {
        await api.deleteCompanyLogo();
      } else if (this._pendingLogoFile) {
        await api.uploadCompanyLogo(this._pendingLogoFile);
      }
      const settings = await api.updateSystemSettings({ company_name: name });

      this._pendingLogoFile = null;
      this._pendingLogoRemoved = false;
      this._systemSettings = settings;
      this.applyBranding(settings);
      this.toast('Company settings saved', 'success');
      await this.renderSystemSettings();
    } catch (err) {
      this.toast(err.message, 'error');
      if (button) button.disabled = false;
    }
  },

  async saveAdminPassword(event) {
    if (event) event.preventDefault();
    const current = document.getElementById('cred-current');
    const next = document.getElementById('cred-new');
    const confirm = document.getElementById('cred-confirm');
    if (!current || !next || !confirm) return;

    const currentValue = current.value;
    const newValue = next.value;
    if (newValue.length < 8) {
      this.toast('New password must be at least 8 characters', 'error');
      return;
    }
    if (newValue !== confirm.value) {
      this.toast('New passwords do not match', 'error');
      return;
    }
    if (newValue === currentValue) {
      this.toast('New password must differ from the current password', 'error');
      return;
    }

    const button = event?.target?.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await api.changePassword(currentValue, newValue);
      this.toast('Password updated', 'success');
      current.value = '';
      next.value = '';
      confirm.value = '';
    } catch (err) {
      this.toast(err.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  },

  updateCurrencyPreview() {
    const select = document.getElementById('system-currency');
    const preview = document.getElementById('currency-preview');
    if (select && preview) {
      preview.textContent = this.formatAmount(select.value, 1234.5);
    }
  },

  async saveSystemSettings() {
    const select = document.getElementById('system-currency');
    if (!select) return;
    const payload = { currency: select.value };
    const trialOn = document.getElementById('system-trial-enabled');
    const trialMins = document.getElementById('system-trial-minutes');
    if (trialOn) payload.trial_enabled = trialOn.checked;
    if (trialMins) payload.trial_minutes = parseInt(trialMins.value, 10);
    if (trialMins && (!Number.isFinite(payload.trial_minutes) || payload.trial_minutes < 1 || payload.trial_minutes > 1440)) {
      this.toast('Trial minutes must be between 1 and 1440', 'error');
      return;
    }
    try {
      const settings = await api.updateSystemSettings(payload);
      this._systemSettings = settings;
      this.systemCurrency = settings.currency || 'PHP';
      this.toast(`Currency set to ${this.systemCurrency}`, 'success');
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
      const res = await api.pushPortalFiles(routerId, this._portalFolder());
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

  // Two kinds of coin machine live under this page, and they are managed in
  // completely different ways: a JuanFi board keeps its own admin page and the
  // panel talks to it, while an AirCoins board has no web UI at all and takes
  // every setting from here. Each type is its own subpage so the two setting
  // sets can never be applied to the wrong firmware.
  _subvendoType: 'juanfi',
  _subvendoTab: 'config',

  async renderSubVendo() {
    const content = document.getElementById('page-content');
    this._subvendoType = this._subvendoType || 'juanfi';
    this._subvendoTab = this._subvendoTab || 'config';

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>SubVendo</h3>
          <span style="font-size:.8rem;opacity:.7">Settings are kept per firmware type</span>
        </div>
        <div class="tab-bar subvendo-type-tabs">
          <button class="tab-btn ${this._subvendoType === 'juanfi' ? 'active' : ''}" data-type="juanfi" onclick="App.switchSubVendoType('juanfi')">JuanFi Subvendo</button>
          <button class="tab-btn ${this._subvendoType === 'aircoins' ? 'active' : ''}" data-type="aircoins" onclick="App.switchSubVendoType('aircoins')">AirCoins Subvendo</button>
        </div>
        <div class="tab-bar subvendo-view-tabs" style="border-bottom:1px solid var(--border)${this._subvendoType === 'aircoins' ? ';display:none' : ''}">
          <button class="tab-btn ${this._subvendoTab === 'config' ? 'active' : ''}" data-subtab="config" onclick="App.switchSubVendoTab('config')">Configuration</button>
          <button class="tab-btn ${this._subvendoTab === 'devices' ? 'active' : ''}" data-subtab="devices" onclick="App.switchSubVendoTab('devices')">Sub-Vendo Devices</button>
        </div>
        <div id="subvendo-tab-content"></div>
      </div>
    `;

    await this.loadSubVendoTab();
  },

  async switchSubVendoType(type) {
    const wanted = type === 'aircoins' ? 'aircoins' : 'juanfi';
    if (wanted === this._subvendoType) return;
    this._subvendoType = wanted;
    // A machine belongs to exactly one type, so a selection made on one
    // subpage is meaningless on the other.
    this._nodemcuSelectedId = null;
    document.querySelectorAll('.subvendo-type-tabs .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === wanted);
    });
    // The Configuration / Sub-Vendo Devices switch is a JuanFi idea: its devices
    // keep their own admin page. An AirCoins page already puts the machine
    // selector and its settings side by side, so the second view shows nothing new.
    const viewTabs = document.querySelector('.subvendo-view-tabs');
    if (viewTabs) viewTabs.style.display = wanted === 'aircoins' ? 'none' : '';
    await this.loadSubVendoTab();
  },

  async switchSubVendoTab(tab) {
    this._subvendoTab = tab;
    document.querySelectorAll('.subvendo-view-tabs .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === tab);
    });
    await this.loadSubVendoTab();
  },

  async loadSubVendoTab() {
    const container = document.getElementById('subvendo-tab-content');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';
    // AirCoins owns one page only, so both views of it would be identical.
    if (this._subvendoType === 'aircoins') {
      await this.renderAirCoinsConfig(container);
      return;
    }
    if (this._subvendoTab === 'devices') await this.renderNodeMcu(container, 'juanfi');
    else await this.renderSubVendoConfig(container);
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
          <h4>Roaming Session (Centralized)</h4>
          <p style="font-size:.8rem;opacity:.7;margin-bottom:.75rem">
            Lets a device keep its session token across SSIDs. Set the controller's
            LAN URL as seen from the hotspot (must be allowed in the router's Walled
            Garden). Leave blank to disable roaming.
          </p>
          <div class="form-row">
            <label>Controller API URL:</label>
            <input type="text" id="subvendo-controllerApiUrl" class="form-control" placeholder="http://10.0.0.243:3000/api">
          </div>
          <div class="form-row">
            <label>Session Cookie Name:</label>
            <input type="text" id="subvendo-sessionCookieName" class="form-control" placeholder="juanfi_sid">
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
    this.toggleVendoFields();

    document.getElementById('subvendo-multiVendoOption').addEventListener('change', () => this.toggleVendoFields());
    document.querySelector('.subvendo-form').addEventListener('change', () => {
      this.updateSubVendoPreview();
    });
    document.querySelector('.subvendo-form').addEventListener('input', () => {
      this.updateSubVendoPreview();
    });
  },

  toggleVendoFields() {
    const opt = parseInt(document.getElementById('subvendo-multiVendoOption').value);
    document.querySelectorAll('.vendo-hotspot-row').forEach(el => { el.style.display = opt === 1 ? 'block' : 'none'; });
    document.querySelectorAll('.vendo-interface-row').forEach(el => { el.style.display = opt === 2 ? 'block' : 'none'; });
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
    document.getElementById('subvendo-controllerApiUrl').value = config.controllerApiUrl || '';
    document.getElementById('subvendo-sessionCookieName').value = config.sessionCookieName || 'juanfi_sid';

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
      controllerApiUrl: document.getElementById('subvendo-controllerApiUrl').value.trim(),
      sessionCookieName: document.getElementById('subvendo-sessionCookieName').value.trim() || 'juanfi_sid',
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

// JuanFi centralized roaming session token support.
var controllerApiUrl = "${config.controllerApiUrl || ''}";
var sessionCookieName = "${config.sessionCookieName || 'juanfi_sid'}";
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

  // ---------- AirCoins sub-vendos (panel-managed firmware) ----------
  //
  // An AirCoins board has no admin page and no API to configure it with: it
  // boots with a panel address and a device key, then reads everything else
  // from here. That is why this page is the only settings screen these
  // machines have, and why every field below is stored on the controller.

  async renderAirCoinsConfig(container) {
    // Pairing requests come first: they are the only thing on this page that a
    // machine can cause by itself, and they expire when the vendo gives up.
    let claims = [];
    try { claims = (await api.nodemcuAirCoinsClaims()).claims || []; } catch (err) { claims = []; }
    this._airCoinsClaims = claims;
    const pending = this.renderAirCoinsClaims(claims);

    const data = await api.nodemcuListDevices();
    const devices = (data.devices || []).filter((d) => (d.firmwareType || 'juanfi') === 'aircoins');
    this._nodemcuDevices = devices;

    if (!devices.length) {
      container.innerHTML = `
        <div class="subvendo-form">
          ${pending}
          <div class="empty-state">
            <h3>No AirCoins sub-vendos yet</h3>
            <p>Power the vendo, join its <strong>Aircoins_setup</strong> WiFi and pick the shop network there -
            or type its name when the network is hidden or not in the scan list. The board saves it and
            joins straight away; if that fails in 10 seconds the setup network comes back for another try.
            It then asks this panel to accept it - nothing is registered until you press Accept above.</p>
            <button class="btn btn-primary" onclick="App.showAddNodeMcuDevice('aircoins')">Add Manually</button>
          </div>
        </div>
      `;
      this.startAirCoinsClaimPoller();
      return;
    }

    if (!this._nodemcuSelectedId || !devices.find((d) => d.id === this._nodemcuSelectedId)) {
      this._nodemcuSelectedId = devices[0].id;
    }

    let payload;
    try {
      payload = await api.nodemcuGetAirCoins(this._nodemcuSelectedId);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3>Could not load settings</h3><p>${this.escapeHtml(err.message)}</p></div>`;
      return;
    }

    const s = payload.settings || {};
    const status = payload.status || {};
    const online = !!payload.online;
    const pollSeconds = parseInt(s.pollSeconds, 10) || 30;
    const lastSeen = status.lastSeen ? new Date(status.lastSeen).toLocaleString() : 'never';
    const panelUrl = window.location.origin;
    // 0 is a real GPIO (D3), so only a missing value falls back.
    const pinValue = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    const slotTrigger = pinValue(s.slotTriggerType, 1) === 1 ? 1 : 0;
    // The board is labelled D0..D8 but the setting is stored as a GPIO number,
    // so the dropdown carries the label and posts the number underneath.
    const pinChoices = [
      ['-1', 'NONE (not wired)'],
      ['16', 'D0 (GPIO16)'],
      ['5', 'D1 (GPIO5)'],
      ['4', 'D2 (GPIO4)'],
      ['0', 'D3 (GPIO0)'],
      ['2', 'D4 (GPIO2, onboard LED)'],
      ['14', 'D5 (GPIO14)'],
      ['12', 'D6 (GPIO12)'],
      ['13', 'D7 (GPIO13)'],
      ['15', 'D8 (GPIO15)'],
    ];
    // A pin saved as a GPIO with no D label of its own (3, 1, ...) keeps its
    // entry, so merely opening this page never rewrites it.
    const pinSelect = (id, value, fallback) => {
      const current = String(pinValue(value, fallback));
      const choices = pinChoices.some(([v]) => v === current)
        ? pinChoices
        : [...pinChoices, [current, 'GPIO ' + current]];
      const options = choices
        .map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`)
        .join('');
      return `<select id="${id}" class="form-control">${options}</select>`;
    };
    // The coin slot is the one job D0 cannot do on older firmware: GPIO16 has no
    // interrupt, so 1.4.0 samples that pin instead of refusing it.
    const firmware = String(status.firmwareVersion || '');
    const d0NeedsFlash = pinValue(s.coinPin, 4) === 16
      && /^\d+\.\d+/.test(firmware)
      && (parseInt(firmware, 10) < 1
        || (parseInt(firmware, 10) === 1 && parseInt(firmware.split('.')[1], 10) < 4));

    container.innerHTML = `
      <div class="subvendo-form">
        ${pending}
        <div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:space-between;margin-bottom:1rem">
          <div style="display:flex;gap:.5rem;align-items:center">
            <select id="aircoins-device-select" class="btn btn-outline" onchange="App.selectAirCoinsDevice(this.value)">
              ${devices.map((d) => `<option value="${d.id}" ${d.id === this._nodemcuSelectedId ? 'selected' : ''}>${this.escapeHtml(d.name)} (${this.escapeHtml(d.ip)})</option>`).join('')}
            </select>
            <span class="status-badge ${online ? 'connected' : 'disconnected'}">${online ? 'Online' : 'Offline'}</span>
          </div>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-sm btn-outline" onclick="App.showAddNodeMcuDevice('aircoins')">Add Vendo</button>
            <button class="btn btn-sm btn-outline" onclick="App.showEditNodeMcuDevice()">Edit Device</button>
            <button class="btn btn-sm btn-danger" onclick="App.deleteNodeMcuDevice()">Delete</button>
          </div>
        </div>

        ${!s.clientMac ? `
        <div class="subvendo-section" style="border-left:3px solid #ff9800;padding-left:.75rem">
          <h4 style="color:#ff9800">No fixed sale target</h4>
          <p style="font-size:.85rem;margin:0">
            Coins are credited to whichever PC opens the coin slot in the portal, so this box does not
            need one fixed MAC. Leave <strong>Sale Target</strong> empty to sell to any device, and fill
            it in only when every coin here must always credit the same PC. Every coin is recorded in
            the Sales Report either way.
          </p>
        </div>` : ''}

        <div class="subvendo-section">
          <h4>Machine Status</h4>
          <p style="font-size:.8rem;opacity:.7;margin:0 0 .75rem">
            Reported by the vendo itself every ${pollSeconds}s. There is no page to open on the machine.
          </p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem">
            ${this.renderAirCoinsStat('Last report', lastSeen)}
            ${this.renderAirCoinsStat('Uptime', this.formatAirCoinsUptime(status.uptimeSeconds))}
            ${this.renderAirCoinsStat('Firmware', status.firmwareVersion || 'not reported yet')}
            ${this.renderAirCoinsStat('Coins taken', status.coins || 0)}
            ${this.renderAirCoinsStat('Customers', status.customers || 0)}
            ${this.renderAirCoinsStat('Last sale', `${status.lastCoins || 0} coins / ${status.lastMinutes || 0} min`)}
            ${this.renderAirCoinsStat('Coin pulses', status.pulses || 0)}
            ${this.renderAirCoinsStat('Banked pulses', status.bank || 0)}
          </div>
          <p style="font-size:.78rem;opacity:.7;margin:.6rem 0 0">
            Coin pulses count what the acceptor sent since the board booted. If a coin drops and this
            stays at 0, the acceptor is not reaching its GPIO - check the coin pin and the 3.3V signal wire.
          </p>
          ${status.lastError ? `<p style="color:#ff9800;font-size:.8rem;margin:.75rem 0 0">Last error: ${this.escapeHtml(status.lastError)}</p>` : ''}
        </div>

        <div class="subvendo-section">
          <h4>Panel Link</h4>
          <p style="font-size:.8rem;opacity:.7;margin:0 0 .75rem">
            Enter these on the vendo the first time it boots. After that the machine only reads from
            the panel, so replacing the key here is the only way to cut one off.
          </p>
          <div class="form-row">
            <label>Panel URL:</label>
            <input class="form-control" readonly value="${this.escapeHtml(panelUrl)}">
          </div>
          <div class="form-row">
            <label>Device Key:</label>
            <input id="aircoins-device-key" class="form-control" readonly value="${this.escapeHtml(s.deviceKey || '')}">
          </div>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-sm btn-outline" onclick="App.copyAirCoinsKey()">Copy Key</button>
            <button class="btn btn-sm btn-outline" onclick="App.rotateAirCoinsKey()">Replace Key</button>
          </div>
        </div>

        <div class="subvendo-section">
          <h4>Sale Target</h4>
          <p style="font-size:.8rem;opacity:.7;margin:0 0 .75rem">
            Optional. Leave it empty and each sale credits whichever PC opened the coin slot in the
            portal; fill it in when every coin from this box must always credit the same computer.
            Enter the MAC the hotspot sees for that PC.
          </p>
          <div class="form-row">
            <label>PC MAC:</label>
            <input id="ac-clientMac" class="form-control" placeholder="AA:BB:CC:DD:EE:FF" value="${this.escapeHtml(s.clientMac || '')}">
          </div>
        </div>

        <div class="subvendo-section">
          <h4>Coin Slot</h4>
          <div class="form-row">
            <label>Pesos per pulse:</label>
            <input id="ac-coinValue" class="form-control" type="number" min="1" value="${parseInt(s.coinValue, 10) || 1}">
          </div>
          <div class="form-row">
            <label>Pulses per coin:</label>
            <input id="ac-pulsesPerCoin" class="form-control" type="number" min="1" value="${parseInt(s.pulsesPerCoin, 10) || 1}">
          </div>
          <div class="form-row">
            <label>Pulse gap (ms):</label>
            <input id="ac-pulseDebounceMs" class="form-control" type="number" min="1" max="50" value="${parseInt(s.pulseDebounceMs, 10) || 6}">
          </div>
          <p style="font-size:.8rem;opacity:.7;margin:.25rem 0 .5rem">
            A coin arrives as a burst - five pulses for 5 pesos - so pulses closer than this gap count
            as one bounce. Lower it if a coin reads short (5 read as 4), raise it if one coin counts twice.
          </p>
          <div class="form-row">
            <label>Wait for more coins (sec):</label>
            <input id="ac-coinWaitSeconds" class="form-control" type="number" min="1" value="${parseInt(s.coinWaitSeconds, 10) || 10}">
          </div>
          <div class="form-row">
            <label>Sale cap (0 = none):</label>
            <input id="ac-maxCoins" class="form-control" type="number" min="0" value="${parseInt(s.maxCoins, 10) || 0}">
          </div>
          <div class="form-row">
            <label>Pulses before ban:</label>
            <input id="ac-abuseCount" class="form-control" type="number" min="0" value="${parseInt(s.abuseCount, 10) || 0}">
          </div>
          <div class="form-row">
            <label>Ban minutes:</label>
            <input id="ac-banMinutes" class="form-control" type="number" min="0" value="${parseInt(s.banMinutes, 10) || 0}">
          </div>
        </div>

        <div class="subvendo-section">
          <h4>Hardware Pins</h4>
          <p style="font-size:.8rem;opacity:.7;margin:0 0 .75rem">
            Pick the pin by its board label; each one maps to GPIO D0 = 16, D1 = 5, D2 = 4,
            D3 = 0, D4 = 2, D5 = 14, D6 = 12, D7 = 13, D8 = 15. The vendo re-wires itself on
            its next report - no reflash.
          </p>
          <div class="form-row">
            <label>Coin slot pin:</label>
            ${pinSelect('ac-coinPin', s.coinPin, 4)}
          </div>
          ${d0NeedsFlash ? `<p style="font-size:.8rem;color:var(--warning);margin:.25rem 0 0">
            This vendo reports firmware ${this.escapeHtml(firmware)}: GPIO16 cannot take coin pulses before 1.4.0.
            Flash AirCoins-v1.4.0.bin, or put the coin slot on another pin.
          </p>` : ''}
          <div class="form-row">
            <label>Buzzer pin:</label>
            ${pinSelect('ac-buzzerPin', s.buzzerPin, 14)}
          </div>
          <div class="form-row">
            <label>Status LED pin:</label>
            ${pinSelect('ac-ledPin', s.ledPin, 2)}
          </div>
          <div class="form-row">
            <label>Slot lock relay pin:</label>
            ${pinSelect('ac-slotLockPin', s.slotLockPin, -1)}
          </div>
          <p style="font-size:.8rem;opacity:.7;margin:.25rem 0 0">
            D0 (GPIO16) is fine for the buzzer, LED and slot relay. For the coin slot it needs
            firmware 1.4.0 or newer, because GPIO16 has no interrupt line - the vendo samples
            that pin instead - and it has no internal pull-up either, so if the acceptor's
            output is open-collector add a 10k resistor from D0 to 3V3.
          </p>
          <div class="form-row">
            <label>Slot lock trigger:</label>
            <select id="ac-slotTriggerType" class="form-control">
              <option value="1" ${slotTrigger === 1 ? 'selected' : ''}>Signal goes HIGH while coins are accepted (active-high relay)</option>
              <option value="0" ${slotTrigger === 0 ? 'selected' : ''}>Signal goes LOW while coins are accepted (active-low relay)</option>
            </select>
          </div>
          <p style="font-size:.8rem;opacity:.7;margin:.25rem 0 0">
            Same idea as JuanFi's Relay Trigger Type: only the level inverts, the pin itself stays as
            you set it. With a relay pin set the acceptor is powered only while a customer is in a
            coin session - it clicks on after INSERT COIN and drops as soon as that session is paid,
            cancelled or times out.
          </p>
        </div>

        <div class="subvendo-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
            <h4 style="margin:0">Rates</h4>
            <button class="btn btn-sm btn-primary" onclick="App.addAirCoinsRate()">Add Rate</button>
          </div>
          <p style="font-size:.8rem;opacity:.7;margin:0 0 .75rem">
            The whole bank is priced together, like JuanFi: the coins buy the most expensive rate
            they can still pay for, over and over. Ten 1-peso coins therefore reach the 10-peso rate,
            and the coins in the portal's PROMO RATES button are exactly these. The panel credits the
            time, so a change here applies to the next sale - no reflash.
          </p>
          <table class="table" id="aircoins-rates-table">
            <thead><tr><th>Name</th><th>Price</th><th>Minutes</th><th></th></tr></thead>
            <tbody>${(s.rates || []).map((r) => this.airCoinsRateRow(r)).join('')}</tbody>
          </table>
        </div>

        <div class="subvendo-section">
          <h4>Feedback</h4>
          <div class="form-row">
            <label>Cooldown after sale (sec):</label>
            <input id="ac-thankYouSeconds" class="form-control" type="number" min="1" value="${parseInt(s.thankYouSeconds, 10) || 5}">
          </div>
          <div class="form-row">
            <label>Report every (sec):</label>
            <input id="ac-pollSeconds" class="form-control" type="number" min="5" value="${pollSeconds}">
          </div>
          <label class="checkbox-label">
            <input type="checkbox" id="ac-buzzer" ${s.buzzer ? 'checked' : ''}>
            <span>Beep on coin and on sale</span>
          </label>
        </div>

        <div class="subvendo-section">
          <h4>Remote Controls</h4>
          <p style="font-size:.8rem;opacity:.7;margin:0 0 .75rem">
            Commands are handed to the vendo on its next report, because the panel never opens a connection to the machine.
          </p>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-sm btn-outline" onclick="App.sendAirCoinsCommand('sync')">Refresh Config</button>
            <button class="btn btn-sm btn-outline" onclick="App.sendAirCoinsCommand('restart')">Restart Vendo</button>
          </div>
          ${s.pendingCommand ? `<p style="color:#ff9800;font-size:.8rem;margin:.75rem 0 0">Waiting for the vendo: ${this.escapeHtml(s.pendingCommand)}</p>` : ''}
        </div>

        <div class="subvendo-actions">
          <button class="btn btn-primary" onclick="App.saveAirCoinsSettings()">Save Settings</button>
        </div>
      </div>
    `;

    this.startAirCoinsClaimPoller();
  },

  // Always rendered, even empty, so the poller can fill it in without
  // rebuilding the settings form the operator may be typing into.
  renderAirCoinsClaims(claims) {
    return `<div id="aircoins-claims">${this.renderAirCoinsClaimsInner(claims)}</div>`;
  },

  renderAirCoinsClaimsInner(claims) {
    if (!claims || !claims.length) return '';
    const rows = claims.map((c) => {
      const seen = c.lastSeen ? new Date(c.lastSeen).toLocaleTimeString() : 'just now';
      return `
        <div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between;border-top:1px solid var(--border);padding:.7rem 0">
          <div>
            <div style="font-weight:600">${this.escapeHtml(c.name || 'AirCoins Vendo')}</div>
            <div style="font-size:.78rem;opacity:.75">
              ${this.escapeHtml(c.ip || 'no address reported')} · MAC ${this.escapeHtml(c.mac)}<br>
              joined ${this.escapeHtml(c.ssid || 'unknown WiFi')} · seen ${this.escapeHtml(seen)}
              ${c.firmwareVersion ? ` · firmware ${this.escapeHtml(c.firmwareVersion)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-sm btn-primary" onclick="App.acceptAirCoinsClaim(${c.id})">Accept</button>
            <button class="btn btn-sm btn-outline" onclick="App.rejectAirCoinsClaim(${c.id})">Reject</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="subvendo-section" style="border-color:#ff9800;margin-bottom:1rem">
        <h4 style="margin-top:0">Machines waiting to be accepted</h4>
        <p style="font-size:.8rem;opacity:.75;margin:0 0 .25rem">
          A vendo on its <strong>Aircoins_setup</strong> access point is asking to join this panel.
          It stays in setup mode, showing "waiting for admin", until you accept it.
        </p>
        ${rows}
      </div>`;
  },

  async acceptAirCoinsClaim(id) {
    const claim = (this._airCoinsClaims || []).find((c) => c.id === id);
    const label = claim
      ? `${claim.name || 'this vendo'} at ${claim.ip || 'its reported address'} (MAC ${claim.mac})`
      : `pairing request #${id}`;
    if (!confirm(`Accept ${label}?\n\nIt will be registered as an AirCoins sub-vendo, given its device key and allowed to leave setup mode.`)) return;

    try {
      const res = await api.nodemcuApproveAirCoinsClaim(id, {});
      const name = res.device ? res.device.name : 'Vendo';
      this.toast(`${name} accepted - it is leaving setup mode now`, 'success');
      if (res.provision && res.provision.ok === false) {
        this.toast('Router setup needs attention: ' + (res.provision.error || 'run Register on Router'), 'error');
      }
      if (res.device) {
        this._nodemcuSelectedId = res.device.id;
        this._subvendoTab = 'config';
      }
      await this.loadSubVendoTab();
    } catch (err) {
      this.toast('Failed to accept: ' + err.message, 'error');
    }
  },

  async rejectAirCoinsClaim(id) {
    if (!confirm('Reject this pairing request? The vendo keeps its setup access point and can ask again.')) return;
    try {
      await api.nodemcuRejectAirCoinsClaim(id);
      this.toast('Pairing request rejected', 'success');
      await this.loadSubVendoTab();
    } catch (err) {
      this.toast('Failed to reject: ' + err.message, 'error');
    }
  },

  // A machine can only appear while this page is open, so keep the pair of
  // buttons coming without touching the settings form being edited.
  startAirCoinsClaimPoller() {
    if (this._airCoinsClaimTimer) clearInterval(this._airCoinsClaimTimer);
    this._airCoinsClaimTimer = setInterval(async () => {
      if (this.currentPage !== 'subvendo' || this._subvendoType !== 'aircoins' || this._subvendoTab !== 'config') {
        clearInterval(this._airCoinsClaimTimer);
        this._airCoinsClaimTimer = null;
        return;
      }
      const box = document.getElementById('aircoins-claims');
      if (!box) return;
      try {
        const res = await api.nodemcuAirCoinsClaims();
        const claims = res.claims || [];
        const previous = (this._airCoinsClaims || []).map((c) => c.id).join(',');
        if (claims.map((c) => c.id).join(',') === previous) return;
        this._airCoinsClaims = claims;
        box.innerHTML = this.renderAirCoinsClaimsInner(claims);
      } catch (err) {
        // pairing is a convenience; a failed poll must not disturb the page
      }
    }, 8000);
  },

  renderAirCoinsStat(label, value) {
    return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.6rem .75rem">
      <div style="font-size:.75rem;opacity:.65">${this.escapeHtml(label)}</div>
      <div style="font-weight:600">${this.escapeHtml(String(value))}</div>
    </div>`;
  },

  formatAirCoinsUptime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
  },

  airCoinsRateRow(rate) {
    const r = rate || { name: '', price: 1, minutes: 10 };
    return `<tr>
      <td><input class="form-control ac-rate-name" value="${this.escapeHtml(r.name || '')}"></td>
      <td><input class="form-control ac-rate-price" type="number" min="1" value="${parseInt(r.price, 10) || 0}"></td>
      <td><input class="form-control ac-rate-minutes" type="number" min="1" value="${parseInt(r.minutes, 10) || 0}"></td>
      <td><button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()">X</button></td>
    </tr>`;
  },

  addAirCoinsRate() {
    const tbody = document.querySelector('#aircoins-rates-table tbody');
    if (tbody) tbody.insertAdjacentHTML('beforeend', this.airCoinsRateRow(null));
  },

  selectAirCoinsDevice(id) {
    this._nodemcuSelectedId = parseInt(id, 10);
    this.loadSubVendoTab();
  },

  collectAirCoinsSettings() {
    const num = (id, fallback) => {
      const el = document.getElementById(id);
      const value = el ? parseInt(el.value, 10) : NaN;
      return Number.isFinite(value) ? value : fallback;
    };
    const rates = [];
    document.querySelectorAll('#aircoins-rates-table tbody tr').forEach((row) => {
      rates.push({
        name: row.querySelector('.ac-rate-name').value.trim(),
        price: parseInt(row.querySelector('.ac-rate-price').value, 10) || 0,
        minutes: parseInt(row.querySelector('.ac-rate-minutes').value, 10) || 0,
      });
    });
    return {
      clientMac: (document.getElementById('ac-clientMac') || {}).value || '',
      coinPin: num('ac-coinPin', 4),
      buzzerPin: num('ac-buzzerPin', 14),
      ledPin: num('ac-ledPin', 2),
      slotLockPin: num('ac-slotLockPin', -1),
      slotTriggerType: num('ac-slotTriggerType', 1),
      coinValue: num('ac-coinValue', 1),
      pulsesPerCoin: num('ac-pulsesPerCoin', 1),
      pulseDebounceMs: num('ac-pulseDebounceMs', 6),
      coinWaitSeconds: num('ac-coinWaitSeconds', 10),
      maxCoins: num('ac-maxCoins', 0),
      abuseCount: num('ac-abuseCount', 0),
      banMinutes: num('ac-banMinutes', 0),
      rates,
      thankYouSeconds: num('ac-thankYouSeconds', 5),
      buzzer: !!(document.getElementById('ac-buzzer') || {}).checked,
      pollSeconds: num('ac-pollSeconds', 30),
    };
  },

  async saveAirCoinsSettings() {
    const id = this._nodemcuSelectedId;
    if (!id) return;
    const settings = this.collectAirCoinsSettings();
    if (!settings.rates.length) {
      this.toast('Add at least one rate before saving', 'error');
      return;
    }
    try {
      await api.nodemcuSaveAirCoins(id, settings);
      this.toast('AirCoins settings saved - the vendo picks them up on its next report', 'success');
      await this.loadSubVendoTab();
    } catch (err) {
      this.toast('Failed to save: ' + err.message, 'error');
    }
  },

  async copyAirCoinsKey() {
    const input = document.getElementById('aircoins-device-key');
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      this.toast('Device key copied', 'success');
    } catch (err) {
      input.select();
      this.toast('Press Ctrl+C to copy the selected key', 'info');
    }
  },

  async rotateAirCoinsKey() {
    const id = this._nodemcuSelectedId;
    if (!id) return;
    if (!confirm('Replace the device key? The vendo stops reading settings until the new key is entered on the machine.')) return;
    try {
      await api.nodemcuRotateAirCoinsKey(id);
      this.toast('Device key replaced', 'success');
      await this.loadSubVendoTab();
    } catch (err) {
      this.toast('Failed: ' + err.message, 'error');
    }
  },

  async sendAirCoinsCommand(command) {
    const id = this._nodemcuSelectedId;
    if (!id) return;
    if (command === 'restart' && !confirm('Queue a restart for this vendo? It reboots on its next report.')) return;
    try {
      const res = await api.nodemcuAirCoinsCommand(id, command);
      this.toast(res.message || 'Command queued', 'success');
      await this.loadSubVendoTab();
    } catch (err) {
      this.toast('Failed: ' + err.message, 'error');
    }
  },

  // ====================================================== Pisonet
  //
  // Pay-per-minute Windows desktops. The router only makes the PC invisible to
  // the hotspot (an IP binding of type=bypassed); the countdown, the lock and the
  // admin handover all live between this page and the agent on the desktop.

  async renderPisonet() {
    const content = document.getElementById('page-content');
    const routers = await api.getRouters();
    const usable = routers.filter((r) => r.connected);
    if (!usable.length) {
      content.innerHTML = '<div class="empty-state"><h3>No connected routers</h3><p>Connect the shop router first to manage its desktops.</p></div>';
      return;
    }
    if (!this.selectedRouterId || !usable.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = usable[0].id;
    }
    this.pisonetTab = this.pisonetTab || 'desktops';

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Pisonet</h3>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
            <select id="pisonet-router-select" class="btn btn-outline">
              ${usable.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" onclick="App.showAddPcModal()">Add PC</button>
          </div>
        </div>
        <div class="tabs">
          <button class="tab ${this.pisonetTab === 'desktops' ? 'active' : ''}" data-tab="desktops">Desktops</button>
          <button class="tab ${this.pisonetTab === 'rates' ? 'active' : ''}" data-tab="rates">Rates</button>
          <button class="tab ${this.pisonetTab === 'setup' ? 'active' : ''}" data-tab="setup">Client Setup</button>
        </div>
        <div id="pisonet-tab-content">Loading...</div>
      </div>
    `;

    document.getElementById('pisonet-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadPisonetTab();
    });
    document.querySelectorAll('#page-content .tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.pisonetTab = tab.dataset.tab;
        document.querySelectorAll('#page-content .tabs .tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.loadPisonetTab();
      });
    });
    this.loadPisonetTab();
  },

  async loadPisonetTab() {
    const container = document.getElementById('pisonet-tab-content');
    if (!container) return;
    this.clearCafePollers();
    container.innerHTML = 'Loading...';
    try {
      if (this.pisonetTab === 'rates') await this.loadCafeRates(container);
      else if (this.pisonetTab === 'setup') await this.loadCafeSetup(container);
      else await this.loadCafeMachines(container);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  clearCafePollers() {
    if (this._cafeInterval) {
      clearInterval(this._cafeInterval);
      this._cafeInterval = null;
    }
  },

  async loadCafeMachines(container) {
    if (!container) container = document.getElementById('pisonet-tab-content');
    this.clearCafePollers();

    let payload;
    let summary = { amount: 0, minutes: 0, sales: 0 };
    try {
      [payload, summary] = await Promise.all([
        api.getCafeMachines(this.selectedRouterId),
        api.getCafeSummary(this.selectedRouterId, 1).catch(() => summary),
      ]);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
      return;
    }

    this._cafeRates = payload.rates || [];
    this._cafeSettings = payload.settings || {};
    this._cafeCurrency = payload.settings?.currency || 'PHP';
    const machines = payload.machines || [];
    // Kept so the Sell and Edit dialogs can name the desktop without a second call.
    this._cafeMachines = machines;

    container.innerHTML = `
      ${this.renderCafeKpis(machines, summary)}
      ${Number(payload.settings?.enabled) === 1 ? '' : '<p style="color:var(--text-muted);margin:0 0 .75rem">Automatic cut-off is off for pisonet on this router. Adding a desktop still bypasses it and starts its timer.</p>'}
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Desktop</th>
              <th>Identity</th>
              <th>Agent</th>
              <th>In Use</th>
              <th>Time Left</th>
              <th>Last Seen</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="cafe-tbody">${this.renderCafeRows(machines)}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.75rem">
        <button class="btn btn-sm btn-outline" onclick="App.syncCafeBindingsNow()">Re-check Bypasses</button>
      </div>
    `;

    // A pisonet table nobody refreshes is a table that lies about money, so it
    // re-reads itself while the operator is looking at it.
    this._cafeInterval = setInterval(async () => {
      if (!document.getElementById('cafe-tbody')) {
        this.clearCafePollers();
        return;
      }
      try {
        const fresh = await api.getCafeMachines(this.selectedRouterId);
        this._cafeRates = fresh.rates || this._cafeRates;
        this.refreshCafeRows(fresh.machines || []);
      } catch (err) {
        console.error('pisonet refresh failed:', err);
      }
    }, 3000);
  },

  renderCafeKpis(machines, summary) {
    const online = machines.filter((m) => m.online).length;
    const playing = machines.filter((m) => m.running && m.mode !== 'admin').length;
    const admin = machines.filter((m) => m.mode === 'admin').length;
    const cards = [
      { label: 'Today\u2019s sales', value: `${this._cafeCurrency || ''} ${(Number(summary.amount) || 0).toFixed(2)}`, sub: `${summary.sales || 0} sell${summary.sales === 1 ? '' : 's'} · ${summary.minutes || 0} min sold`, cls: 'kpi-success' },
      { label: 'Desktops in use', value: String(playing), sub: `${machines.length} registered`, cls: 'kpi-primary' },
      { label: 'Agents online', value: String(online), sub: admin ? `${admin} unlocked for service` : 'all on the customer clock', cls: 'kpi-violet' },
    ];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin-bottom:1rem">${cards.map((c) => `
      <div class="stat-card ${c.cls}">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value">${this.escapeHtml(c.value)}</div>
        <div class="stat-sub">${this.escapeHtml(c.sub)}</div>
      </div>`).join('')}</div>`;
  },

  renderCafeRows(machines) {
    if (!machines || !machines.length) {
      return '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem">No desktops yet. Use Add PC to pick one from the router.</td></tr>';
    }
    return machines.map((m) => `
      <tr data-cafe-id="${parseInt(m.id, 10) || 0}" data-cafe-state="${this.cafeStateKey(m)}">
        <td><strong>${this.escapeHtml(m.name)}</strong></td>
        <td>
          <code>${this.escapeHtml(m.mac_address || 'no MAC')}</code><br>
          <span style="color:var(--text-muted);font-size:.85em">${this.escapeHtml(m.ip_address || '-')} · ${this.escapeHtml(m.hostname || 'no hostname')}</span>
        </td>
        <td data-field="agent">${this.renderAgentCell(m)}</td>
        <td data-field="mode">${this.renderCafeModeBadge(m)}</td>
        <td data-field="time">${this.renderCafeTimeCell(m)}</td>
        <td data-field="seen">${this.escapeHtml(m.last_seen || 'never')}</td>
        <td style="text-align:right" data-field="actions">${this.renderCafeActions(m)}</td>
      </tr>
    `).join('');
  },

  cafeStateKey(m) {
    return `${m.mode || 'client'}:${m.running ? 1 : 0}:${m.online ? 1 : 0}`;
  },

  formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  },

  renderAgentCell(m) {
    if (!m.online) return '<span class="badge badge-offline">offline</span>';
    return `<span class="badge badge-online">live</span> <span style="color:var(--text-muted);font-size:.85em">v${this.escapeHtml(m.agent_version || '?')}</span>`;
  },

  renderCafeModeBadge(m) {
    if (m.mode === 'admin') return '<span class="badge badge-warning" title="Unlocked for servicing. A reboot puts it back on the customer clock.">admin</span>';
    if (m.running && m.seconds_left > 0) return '<span class="badge badge-online" title="A customer is paying for this time">playing</span>';
    if (m.seconds_left > 0) return '<span class="badge badge-warning" title="Time is banked but the meter is stopped">paused</span>';
    return '<span class="badge badge-expired" title="Locked, waiting for time to be sold">locked</span>';
  },

  renderCafeTimeCell(m) {
    const left = Math.max(0, Number(m.seconds_left) || 0);
    if (!left) return '<span style="color:var(--text-muted)">00:00</span>';
    const cls = left <= 60 ? 'countdown-critical' : left <= 300 ? 'countdown-warning' : '';
    return `<span class="${cls}" style="font-variant-numeric:tabular-nums;font-weight:600">${this.formatClock(left)}</span>`;
  },

  renderCafeActions(m) {
    const id = parseInt(m.id, 10) || 0;
    const sold = m.running && m.seconds_left > 0;
    const primary = m.mode === 'admin'
      ? `<button class="btn btn-sm btn-primary" onclick="App.cafeRelease(${id})">Back to Service</button>`
      : `<button class="btn btn-sm ${sold ? 'btn-outline' : 'btn-primary'}" onclick="App.showCafeSellModal(${id})">${sold ? 'Add Time' : 'Start'}</button>`;
    const lock = m.mode === 'admin' ? ''
      : m.running
        ? ` <button class="btn btn-sm btn-outline" onclick="App.cafeLock(${id})">Lock</button>`
        : '';
    const admin = m.mode === 'admin' ? ''
      : ` <button class="btn btn-sm btn-outline" onclick="App.cafeAdmin(${id})" title="Unlock this desktop so it can be serviced">Admin</button>`;
    return `${primary}${lock}${admin} <button class="btn btn-sm btn-outline" onclick="App.showCafeMore(${id})">⋯</button>`;
  },

  refreshCafeRows(machines) {
    this._cafeMachines = machines;
    const tbody = document.getElementById('cafe-tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr[data-cafe-id]'));
    const keys = machines.map((m) => `${m.id}:${this.cafeStateKey(m)}`).join('|');
    const live = rows.map((r) => `${r.dataset.cafeId}:${r.dataset.cafeState}`).join('|');
    // A state change alters the buttons, so only a rebuild keeps it honest.
    if (keys !== live) {
      tbody.innerHTML = this.renderCafeRows(machines);
      return;
    }
    rows.forEach((row, index) => {
      const m = machines[index];
      if (!m) return;
      const time = row.querySelector('[data-field="time"]');
      if (time) time.innerHTML = this.renderCafeTimeCell(m);
      const seen = row.querySelector('[data-field="seen"]');
      if (seen) seen.textContent = m.last_seen || 'never';
      const agent = row.querySelector('[data-field="agent"]');
      if (agent) agent.innerHTML = this.renderAgentCell(m);
    });
  },

  async cafeAction(name, fn, ok) {
    try {
      await fn();
      this.toast(ok || 'Done', 'success');
      this.loadPisonetTab();
    } catch (err) {
      this.toast(`${name} failed: ${err.message}`, 'error');
    }
  },

  cafeLock(id) {
    this.cafeAction('Lock', () => api.lockCafeMachine(this.selectedRouterId, id), 'Desktop locked, banked time kept');
  },

  cafeAdmin(id) {
    this.cafeAction('Admin unlock', () => api.unlockCafeMachine(this.selectedRouterId, id), 'Handed to admin, the meter is paused');
  },

  cafeRelease(id) {
    this.cafeAction('Release', () => api.releaseCafeMachine(this.selectedRouterId, id), 'Back on the customer clock');
  },

  cafeReset(id) {
    if (!confirm('Clear all paid time on this desktop?')) return;
    this.cafeAction('Reset', () => api.resetCafeMachine(this.selectedRouterId, id), 'Time cleared');
  },

  async cafeRemove(id) {
    if (!confirm('Remove this desktop? Its router bypass is removed too.')) return;
    this.cafeAction('Remove', () => api.removeCafeMachine(this.selectedRouterId, id), 'Desktop removed');
  },

  async syncCafeBindingsNow() {
    this.toast('Re-checking the router bypasses...', 'info');
    try {
      const report = await api.syncCafeBindings(this.selectedRouterId);
      if (report.skipped) this.toast(`Skipped: ${report.skipped}`, 'error');
      else this.toast(`${report.fixed} bypass(es) written, ${report.checked} desktops checked`, 'success');
    } catch (err) {
      this.toast('Sync failed: ' + err.message, 'error');
    }
  },

  /**
   * Sell time. The rate buttons come from the Rates tab so the shop keeps one
   * price list, and a custom amount is always available for the friend who asks
   * for "twenty minutes, boss".
   */
  showCafeSellModal(id) {
    const machine = (this._cafeMachines || []).find((m) => Number(m.id) === Number(id));
    const rates = this._cafeRates || [];
    const name = machine ? machine.name : `#${id}`;
    const banked = machine ? this.formatClock(machine.seconds_left) : '00:00';
    const buttons = rates.map((r) => `
      <button class="btn btn-outline" style="min-width:8rem" onclick="App.cafeSell(${id}, ${r.minutes}, ${r.amount}, this)">
        ${this.escapeHtml(r.label)}<br><span style="font-size:.85em;opacity:.8">${this.escapeHtml(this._cafeCurrency || '')} ${r.amount}</span>
      </button>`).join('');

    this.openModal(`Sell time - ${name}`, `
      <p style="margin-top:0">${this.escapeHtml(name)} has <strong>${banked}</strong> banked.</p>
      <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">${buttons || '<span style="color:var(--text-muted)">No rates configured yet.</span>'}</div>
      <div class="form-row">
        <div class="form-group">
          <label>Minutes</label>
          <input type="number" id="cafe-custom-minutes" min="1" max="1440" value="${this._cafeSettings?.default_minutes || 60}">
        </div>
        <div class="form-group">
          <label>Amount collected</label>
          <input type="number" id="cafe-custom-amount" min="0" step="0.01" value="0">
        </div>
      </div>
      <button class="btn btn-primary" onclick="App.cafeSellCustom(${id}, this)">Add Custom Time</button>
    `, [{ label: 'Close', class: 'btn btn-outline', action: () => this.closeModal() }]);
  },

  async cafeSell(id, minutes, amount, el) {
    if (el) el.disabled = true;
    const machine = (this._cafeMachines || []).find((m) => Number(m.id) === Number(id));
    try {
      await api.startCafeMachine(this.selectedRouterId, id, { minutes, amount });
      this.toast(`+${minutes} min on ${machine ? machine.name : 'PC'}`, 'success');
      this.closeModal();
      this.loadPisonetTab();
    } catch (err) {
      this.toast('Could not sell time: ' + err.message, 'error');
      if (el) el.disabled = false;
    }
  },

  async cafeSellCustom(id, trigger) {
    const minutes = parseInt(document.getElementById('cafe-custom-minutes').value, 10);
    const amount = parseFloat(document.getElementById('cafe-custom-amount').value) || 0;
    if (!minutes || minutes < 1) {
      this.toast('Enter how many minutes to add', 'error');
      return;
    }
    if (trigger) trigger.disabled = true;
    try {
      await api.startCafeMachine(this.selectedRouterId, id, { minutes, amount });
      this.toast(`+${minutes} min sold`, 'success');
      this.closeModal();
      this.loadPisonetTab();
    } catch (err) {
      this.toast('Could not sell time: ' + err.message, 'error');
      if (trigger) trigger.disabled = false;
    }
  },

  showCafeMore(id) {
    this.openModal('Desktop', `
      <p>Everything else about this desktop.</p>
      <div style="display:flex;flex-direction:column;gap:.5rem">
        <button class="btn btn-outline" onclick="App.showCafeToken(${id})">Show machine token</button>
        <button class="btn btn-outline" onclick="App.cafePushBypass(${id})">Re-write the router bypass</button>
        <button class="btn btn-outline" onclick="App.editCafeMachine(${id})">Rename / change MAC</button>
        <button class="btn btn-danger" onclick="App.closeModal();App.cafeRemove(${id})">Remove desktop</button>
      </div>
    `, [{ label: 'Close', class: 'btn btn-outline', action: () => this.closeModal() }]);
  },

  async showCafeToken(id) {
    try {
      const { token } = await api.getCafeToken(this.selectedRouterId, id);
      this.openModal('Machine token', `
        <p>Paste this into <code>config.ini</code> on the desktop as <code>Token=${token}</code> if it cannot claim its own token.</p>
        <input class="form-group" style="width:100%" readonly value="${this.escapeHtml(token)}" onclick="this.select()">
      `, [{ label: 'Close', class: 'btn btn-outline', action: () => this.closeModal() }]);
    } catch (err) {
      this.toast('Could not read the token: ' + err.message, 'error');
    }
  },

  async cafePushBypass(id) {
    try {
      const result = await api.pushCafeBypass(this.selectedRouterId, id);
      this.toast(result.synced ? 'Bypass is on the router' : `Bypass not applied: ${result.error}`, result.synced ? 'success' : 'error');
    } catch (err) {
      this.toast('Bypass failed: ' + err.message, 'error');
    }
  },

  async editCafeMachine(id) {
    const m = (this._cafeMachines || []).find((row) => Number(row.id) === Number(id)) || {};
    this.openModal('Edit desktop', `
      <div class="form-group">
        <label>Name shown on the lock screen</label>
        <input type="text" id="cafe-edit-name" value="${this.escapeHtml(m.name || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>MAC address</label>
          <input type="text" id="cafe-edit-mac" value="${this.escapeHtml(m.mac_address || '')}" placeholder="AA:BB:CC:DD:EE:FF">
        </div>
        <div class="form-group">
          <label>IP address</label>
          <input type="text" id="cafe-edit-ip" value="${this.escapeHtml(m.ip_address || '')}">
        </div>
      </div>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      {
        label: 'Save',
        class: 'btn btn-primary',
        action: async () => {
          try {
            await api.updateCafeMachine(this.selectedRouterId, id, {
              name: document.getElementById('cafe-edit-name').value,
              macAddress: document.getElementById('cafe-edit-mac').value,
              ipAddress: document.getElementById('cafe-edit-ip').value,
            });
            this.closeModal();
            this.toast('Desktop saved', 'success');
            this.loadPisonetTab();
          } catch (err) {
            this.toast('Save failed: ' + err.message, 'error');
          }
        },
      },
    ]);
  },

  // ---- Add PC ----
  //
  // The shop owner should not have to read a MAC off a sticker. The router
  // already lists everything plugged into it, and an installed agent shouts its
  // own hostname, so the two together say which of these desktops are ready to
  // be sold time on.
  async showAddPcModal() {
    this.openModal('Add a desktop', '<p style="margin:0">Reading the router...</p>', []);
    let devices = [];
    let candidates = [];
    let existing = [];
    try {
      [devices, candidates, existing] = await Promise.all([
        api.getActiveDevices(this.selectedRouterId).then((rows) => this.mapActiveDevices(rows)).catch(() => []),
        api.getCafeCandidates(this.selectedRouterId, 600).then((r) => r.candidates || []).catch(() => []),
        api.getCafeMachines(this.selectedRouterId).then((r) => r.machines || []).catch(() => []),
      ]);
    } catch (err) {
      this.openModal('Add a desktop', `<p style="margin:0">Could not read the router: ${this.escapeHtml(err.message)}</p>`, [{ label: 'Close', class: 'btn btn-outline', action: () => this.closeModal() }]);
      return;
    }

    const key = (mac) => String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    const knownMacs = new Set(existing.map((m) => key(m.mac_address)).filter(Boolean));
    const knownHosts = new Set(existing.map((m) => String(m.hostname || '').toLowerCase()).filter(Boolean));
    // An agent that already beaconed is proof the app is installed, and it knows
    // its own hostname better than a DHCP lease does.
    const agentByHost = new Map(candidates.map((c) => [String(c.hostname || '').toLowerCase(), c]));
    const agentByIp = new Map(candidates.map((c) => [String(c.ip_address || ''), c]));
    const agentByMac = new Map(candidates.map((c) => [key(c.mac_address), c]).filter(([k]) => k));

    const rows = devices.map((d) => {
      const mac = key(d['mac-address']);
      const host = String(d['host-name'] || '').toLowerCase();
      const agent = agentByMac.get(mac) || agentByIp.get(d.address) || (host && host !== '-' ? agentByHost.get(host) : null);
      const added = (mac && knownMacs.has(mac)) || knownHosts.has(host);
      return {
        name: (agent && agent.hostname && agent.hostname !== '?' ? agent.hostname : (host !== '-' ? host : '')) || d.address || mac || 'unnamed',
        mac: d['mac-address'] || (agent ? agent.mac_address : ''),
        ip: d.address || (agent ? agent.ip_address : ''),
        hostname: agent ? agent.hostname : (host !== '-' ? host : ''),
        deviceId: parseInt(d.id, 10) || null,
        candidateId: agent ? agent.id : null,
        agent: !!agent,
        added,
        live: d['is-active'] === true,
      };
    });

    // A PC whose agent is talking but that the hotspot has never seen still
    // deserves to be addable - it is bypassed, so it may never log in at all.
    for (const c of candidates) {
      const mac = key(c.mac_address);
      if (rows.some((r) => (mac && r.mac && key(r.mac) === mac) || (r.ip && r.ip === c.ip_address))) continue;
      rows.push({
        name: c.hostname && c.hostname !== '?' ? c.hostname : c.ip_address,
        mac: c.mac_address, ip: c.ip_address, hostname: c.hostname, deviceId: null, candidateId: c.id,
        agent: true, added: knownMacs.has(mac), live: false,
      });
    }

    rows.sort((a, b) => (Number(b.agent) - Number(a.agent)) || String(a.name).localeCompare(String(b.name)));
    this._cafeDetect = rows;

    const body = `
      <p style="margin-top:0">Devices the router can see, and whether the JuanFi agent on that PC has already introduced itself.</p>
      <div class="table-wrapper" style="max-height:50vh;overflow:auto">
        <table>
          <thead><tr><th>Desktop</th><th>MAC / IP</th><th>Agent</th><th style="text-align:right"></th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((r, i) => `
              <tr>
                <td><strong>${this.escapeHtml(r.name)}</strong>${r.live ? ' <span class="badge badge-online" style="opacity:.85">online</span>' : ''}</td>
                <td><code style="font-size:.85em">${this.escapeHtml(r.mac || 'no MAC')}</code><br><span style="color:var(--text-muted);font-size:.85em">${this.escapeHtml(r.ip || '-')}</span></td>
                <td>${r.added
                  ? '<span class="badge badge-offline">already added</span>'
                  : r.agent
                    ? '<span class="badge badge-online">installed</span>'
                    : '<span class="badge badge-warning" title="No agent has beaconed from this address. Install JuanFiCafe.exe on it.">not installed</span>'}</td>
                <td style="text-align:right">${r.added
                  ? ''
                  : `<button class="btn btn-sm btn-primary" onclick="App.addDetectedPc(${i}, this)">Add</button>`}</td>
              </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.5rem">Nothing on this router yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="form-row" style="margin-top:1rem">
        <div class="form-group">
          <label>Or type one in</label>
          <input type="text" id="cafe-manual-name" placeholder="PC-01">
        </div>
        <div class="form-group">
          <label>MAC</label>
          <input type="text" id="cafe-manual-mac" placeholder="AA:BB:CC:DD:EE:FF">
        </div>
        <div class="form-group" style="align-self:flex-end">
          <button class="btn btn-outline" onclick="App.addManualPc(this)">Add</button>
        </div>
      </div>
    `;
    this.openModal('Add a desktop', body, [{ label: 'Done', class: 'btn btn-outline', action: () => { this.closeModal(); this.loadPisonetTab(); } }]);
  },

  async addDetectedPc(index, el) {
    const row = (this._cafeDetect || [])[index];
    if (!row) return;
    if (el) el.disabled = true;
    try {
      const result = await api.addCafeMachine(this.selectedRouterId, {
        name: row.name, macAddress: row.mac, ipAddress: row.ip, hostname: row.hostname,
        deviceId: row.deviceId, candidateId: row.candidateId,
      });
      this.toast(`${row.name} added and bypassed`, 'success');
      this.closeModal();
      this.loadPisonetTab();
    } catch (err) {
      this.toast('Could not add it: ' + err.message, 'error');
      if (el) el.disabled = false;
    }
  },

  async addManualPc(el) {
    const name = String(document.getElementById('cafe-manual-name').value || '').trim();
    const mac = String(document.getElementById('cafe-manual-mac').value || '').trim();
    if (!name && !mac) {
      this.toast('Give it a name or a MAC address', 'error');
      return;
    }
    if (el) el.disabled = true;
    try {
      await api.addCafeMachine(this.selectedRouterId, { name: name || mac, macAddress: mac });
      this.toast(`${name || mac} added`, 'success');
      this.closeModal();
      this.loadPisonetTab();
    } catch (err) {
      this.toast('Could not add it: ' + err.message, 'error');
      if (el) el.disabled = false;
    }
  },

  // ---- Rates ----

  async loadCafeRates(container) {
    let payload;
    try {
      payload = await api.getCafeSettings(this.selectedRouterId);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
      return;
    }
    const s = payload.settings || {};
    container.innerHTML = `
      <p style="margin-top:0">Each line is <code>Label#Minutes#Price</code>, and the Sell buttons follow this order.</p>
      <div class="form-group">
        <label>Price list</label>
        <textarea id="cafe-rate-list" rows="6" style="width:100%;font-family:monospace">${this.escapeHtml(s.rate_list || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Currency</label>
          <input type="text" id="cafe-currency" value="${this.escapeHtml(s.currency || 'PHP')}">
        </div>
        <div class="form-group">
          <label>Default custom-minutes</label>
          <input type="number" id="cafe-default-minutes" min="1" max="1440" value="${Number(s.default_minutes) || 60}">
        </div>
      </div>
      <button class="btn btn-primary" onclick="App.saveCafeRates()">Save Rates</button>
    `;
  },

  async saveCafeRates() {
    try {
      await api.saveCafeSettings(this.selectedRouterId, {
        rate_list: document.getElementById('cafe-rate-list').value,
        currency: document.getElementById('cafe-currency').value,
        default_minutes: document.getElementById('cafe-default-minutes').value,
      });
      this.toast('Rates saved', 'success');
      this.loadPisonetTab();
    } catch (err) {
      this.toast('Save failed: ' + err.message, 'error');
    }
  },

  // ---- Client Setup ----

  async loadCafeSetup(container) {
    let setup = {};
    let candidates = [];
    try {
      [setup, candidates] = await Promise.all([
        api.getCafeSetup().catch(() => ({})),
        api.getCafeCandidates(this.selectedRouterId, 600).then((r) => r.candidates || []).catch(() => []),
      ]);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
      return;
    }
    container.innerHTML = `
      <h4 style="margin-top:0">1. Put the agent on the desktop</h4>
      <p>Run this in PowerShell on the PC, or download <code>JuanFiCafe.exe</code> and copy it there.</p>
      <div class="form-group">
        <input type="text" readonly style="width:100%;font-family:monospace" value="${this.escapeHtml(setup.installLine || '')}" onclick="this.select()">
      </div>
      <h4>2. Tell it where the panel is</h4>
      <p>The agent looks for this panel on the LAN by itself. If a desktop is behind something that blocks that, drop a <code>config.ini</code> next to the exe:</p>
      <pre class="form-group" style="white-space:pre-wrap;margin:0;padding:.75rem">${this.escapeHtml(setup.configIni || '')}</pre>
      <h4>3. Add the desktop here</h4>
      <p>Press <strong>Add PC</strong> above. A desktop that has run the agent shows as <em>installed</em> and claims its own token, so nothing has to be typed on it.</p>
      <h4>Installed but not added (${candidates.length})</h4>
      ${candidates.length ? `
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Hostname</th><th>IP</th><th>MAC</th><th>Agent</th><th>Last seen</th></tr></thead>
            <tbody>${candidates.map((c) => `
              <tr>
                <td>${this.escapeHtml(c.hostname)}</td>
                <td>${this.escapeHtml(c.ip_address || '-')}</td>
                <td><code>${this.escapeHtml(c.mac_address || '-')}</code></td>
                <td>${this.escapeHtml(c.agent_version || '-')}</td>
                <td>${this.escapeHtml(c.last_seen || '')}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : '<p style="color:var(--text-muted)">Nothing is waiting to be added right now.</p>'}
      <h4>Admin unlock on the keyboard</h4>
      <p>The shop owner presses <strong>Ctrl+Alt+F12</strong> on a desktop and types the admin password to service the machine - update a game, install a patch - without burning the customer's time. Restarting the PC always brings the lock screen straight back.</p>
      <div class="form-row">
        <div class="form-group">
          <label>Admin password</label>
          <input type="password" id="cafe-admin-password" placeholder="set once for this router">
        </div>
        <div class="form-group" style="align-self:flex-end">
          <button class="btn btn-outline" onclick="App.saveCafeAdminPassword()">Save Password</button>
        </div>
      </div>
    `;
  },

  async saveCafeAdminPassword() {
    const value = String(document.getElementById('cafe-admin-password').value || '');
    if (!value) {
      this.toast('Type the password you want, or clear it on the server first', 'error');
      return;
    }
    try {
      await api.saveCafeAdminPassword(this.selectedRouterId, value);
      document.getElementById('cafe-admin-password').value = '';
      this.toast('Admin password saved', 'success');
    } catch (err) {
      this.toast('Save failed: ' + err.message, 'error');
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

  async renderPpp() {
    const content = document.getElementById('page-content');
    const routers = await api.getRouters();
    const connectedRouters = routers.filter((r) => r.connected);
    if (connectedRouters.length === 0) {
      content.innerHTML = '<div class="empty-state"><h3>No connected routers</h3><p>Connect a router first to view PPP connections.</p></div>';
      return;
    }
    if (!this.selectedRouterId || !connectedRouters.find((r) => r.id === this.selectedRouterId)) {
      this.selectedRouterId = connectedRouters[0].id;
    }
    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>PPP / PPPoE</h3>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
            <select id="ppp-router-select" class="btn btn-outline">
              ${connectedRouters.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" onclick="App.showAddCustomerModal()">Add Customer</button>
          </div>
        </div>
        <div class="tabs">
          <button class="tab ${this.pppTab === 'active' ? 'active' : ''}" data-tab="active">Active Connections</button>
          <button class="tab ${this.pppTab === 'customers' ? 'active' : ''}" data-tab="customers">Customers</button>
          <button class="tab ${this.pppTab === 'servers' ? 'active' : ''}" data-tab="servers">PPPoE Servers</button>
          <button class="tab ${this.pppTab === 'profiles' ? 'active' : ''}" data-tab="profiles">PPPoE Profiles</button>
          <button class="tab ${this.pppTab === 'plans' ? 'active' : ''}" data-tab="plans">Billing Plans</button>
          <button class="tab ${this.pppTab === 'billing' ? 'active' : ''}" data-tab="billing">Billing Settings</button>
        </div>
        <div id="ppp-tab-content">Loading...</div>
      </div>
    `;
    document.getElementById('ppp-router-select').addEventListener('change', (e) => {
      this.selectedRouterId = parseInt(e.target.value);
      this.loadPppTab();
    });
    document.querySelectorAll('.tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.pppTab = tab.dataset.tab;
        document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.loadPppTab();
      });
    });
    this.loadPppTab();
  },

  async loadPppTab() {
    const container = document.getElementById('ppp-tab-content');
    if (!container) return;
    this.clearPppPollers();
    container.innerHTML = 'Loading...';
    try {
      if (this.pppTab === 'customers') await this.loadPppCustomers(container);
      else if (this.pppTab === 'servers') await this.loadPppoeServers(container);
      else if (this.pppTab === 'profiles') await this.loadPppProfiles(container);
      else if (this.pppTab === 'plans') await this.loadBillingPlans(container);
      else if (this.pppTab === 'billing') await this.loadBillingSettings(container);
      else await this.loadPppActiveConnections(container);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  clearPppPollers() {
    if (this._pppActiveInterval) {
      clearInterval(this._pppActiveInterval);
      this._pppActiveInterval = null;
    }
  },

  async loadPppActiveConnections(container) {
    if (!container) container = document.getElementById('ppp-tab-content');
    this.clearPppPollers();
    try {
      const connections = await api.getPppActive(this.selectedRouterId);
      this.renderPppActiveTable(container, connections || []);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  renderPppActiveTable(container, connections) {
    if (!container) container = document.getElementById('ppp-tab-content');
    if (!connections || connections.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No active PPPoE connections.</p></div>';
      return;
    }
    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>User</th><th>Service</th><th>Caller</th><th>Address</th><th>Uptime</th><th>Bytes In</th><th>Bytes Out</th><th>Status</th></tr></thead>
          <tbody id="ppp-active-tbody">${this.renderPppActiveRows(connections)}</tbody>
        </table>
      </div>
    `;
    this._pppActiveInterval = setInterval(async () => {
      try {
        const conns = await api.getPppActive(this.selectedRouterId);
        const tbody = document.getElementById('ppp-active-tbody');
        if (!tbody) { this.clearPppPollers(); return; }
        tbody.innerHTML = this.renderPppActiveRows(conns || []);
      } catch (e) { /* ignore refresh errors */ }
    }, 10000);
  },

  renderPppActiveRows(connections) {
    return connections.map((c) => `
      <tr>
        <td>${this.escapeHtml(c.name || '-')}</td>
        <td>${this.escapeHtml(c.service || '-')}</td>
        <td>${this.escapeHtml(c.caller || '-')}</td>
        <td>${this.escapeHtml(c.address || '-')}</td>
        <td>${this.escapeHtml(c.uptime || '-')}</td>
        <td>${this.formatBytes(c['bytes-in'] || 0)}</td>
        <td>${this.formatBytes(c['bytes-out'] || 0)}</td>
        <td><span class="badge badge-online">Active</span></td>
      </tr>
    `).join('');
  },

  async loadPppCustomers(container) {
    if (!container) container = document.getElementById('ppp-tab-content');
    this.clearPppPollers();
    try {
      // The billing switch decides whether an account can have a router timer at
      // all, so the table needs it to explain an unarmed row instead of guessing.
      const [customers, settings] = await Promise.all([
        api.getPppCustomers(this.selectedRouterId),
        api.getBillingSettings(this.selectedRouterId).catch(() => null),
      ]);
      this._pppBillingEnabled = Number(settings?.enabled) === 1;
      this._pppBillingGrace = Number(settings?.grace_days || 0);
      // The profile that means "throttled", so a row sitting on it can be called
      // out however it got there.
      this._pppNonPaymentProfile = String(settings?.non_payment_profile || '').trim();
      this.renderPppCustomersTable(container, customers || []);
      // Somebody is looking at the list, so make it say what the router really
      // holds: an account's own cut-off timer fires even while this panel is
      // offline, and a profile changed in Winbox never passes through the server.
      await this.syncPppFromRouter({ silent: true });
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  },

  /**
   * Ask the router which profile each of our accounts actually has and mirror the
   * answer into the panel. Without this the table keeps showing the profile the
   * subscriber stopped using the moment the router's own timer moved them.
   */
  async syncPppFromRouter(opts = {}) {
    if (this._pppSyncing) return;
    this._pppSyncing = true;
    try {
      const report = await api.reconcileRouterProfiles(this.selectedRouterId);
      const moved = (report && report.updated) || [];
      if (!moved.length) {
        if (!opts.silent) this.toast('Panel already matches the router profiles', 'info');
        return;
      }
      const customers = await api.getPppCustomers(this.selectedRouterId).catch(() => null);
      if (customers) this.renderPppCustomersTable(document.getElementById('ppp-tab-content'), customers);
      const names = moved.slice(0, 3).map((u) => `${u.username} ${u.from || '-'} -> ${u.to}`);
      this.toast(`Router had ${moved.length} account(s) on another profile: ${names.join(', ')}${moved.length > 3 ? ` +${moved.length - 3} more` : ''}`, 'info');
    } catch (err) {
      if (!opts.silent) this.toast(err.message, 'error');
    } finally {
      this._pppSyncing = false;
    }
  },

  renderPppCustomersTable(container, customers) {
    if (!container) container = document.getElementById('ppp-tab-content');
    this._pppCustomers = customers || [];
    if (!customers || customers.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No PPP customers found.</p><button class="btn btn-primary btn-sm" onclick="App.showAddCustomerModal()">Add Customer</button></div>';
      return;
    }
    container.innerHTML = `
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-bottom:0.75rem">
        <button class="btn btn-sm btn-outline" onclick="App.syncPppFromRouter()">Sync from Router</button>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Customer</th><th>Plan</th><th>Profile</th><th>Due Date</th><th>Billing</th><th>Account</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody id="ppp-customers-tbody">
            ${customers.map((c) => `
              <tr>
                <td><strong>${this.escapeHtml(c.name || '-')}</strong><br><span style="color:var(--text-muted);font-size:0.85rem">${this.escapeHtml(c.username || '-')}</span>${this.renderInstalledLine(c)}</td>
                <td>${c.plan_name ? `${this.escapeHtml(c.plan_name)} <span style="color:var(--text-muted);font-size:0.85rem">(${this.formatAmount(c.plan_currency || this.systemCurrency, c.plan_price)})</span>` : '<span style="color:var(--text-muted)">-</span>'}</td>
                <td>${this.renderProfileCell(c)}</td>
                <td>${this.renderDueCell(c)}${this.renderScheduledCell(c)}</td>
                <td>${this.renderBillingBadge(c)} ${this.renderBillingTypeBadge(c)}</td>
                <td><span class="badge ${c.disabled ? 'badge-offline' : 'badge-online'}">${c.disabled ? 'Disabled' : 'Enabled'}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-sm btn-primary" onclick="App.showPayModal(${c.id})">Pay</button>
                  <button class="btn btn-sm btn-outline" onclick="App.showAssignPlanModal(${c.id})">Plan</button>
                  <button class="btn btn-sm btn-outline" onclick="App.showAddCustomerModal(${c.id})">Edit</button>
                  <button class="btn btn-sm btn-outline" onclick="App.toggleCustomer(${c.id}, ${c.disabled ? 0 : 1})">${c.disabled ? 'Enable' : 'Disable'}</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deleteCustomer(${c.id})">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem">Every account carries its own cut-off timer on the router itself, armed for its due date plus its own grace period - postpaid accounts get the configured grace, prepaid accounts are cut off on the due date itself - so a subscriber is moved to the non-payment profile even when the panel is offline. The panel's own sweep runs every minute as a backstop. The Profile column is the profile the router holds for that login, so an account its own timer moved - or one changed in Winbox - shows up here as it really is.</p>`;
  },

  /**
   * What the subscriber is actually running at. Read off /ppp/secret, which means
   * it can be a profile this panel never set, so sitting on the non-payment
   * profile is called out whatever moved the account there.
   */
  renderProfileCell(customer) {
    const profile = String(customer.profile || '');
    if (!profile) return '<span style="color:var(--text-muted)">-</span>';
    if (this._pppNonPaymentProfile && profile === this._pppNonPaymentProfile) {
      return `<span style="color:var(--danger)">${this.escapeHtml(profile)}</span><br><small style="color:var(--danger);font-size:0.78rem" title="The router has this login on the non-payment profile, so the subscriber is throttled right now - the panel put it there, the account's own cut-off timer did, or somebody set it in Winbox.">&#9888; cut off</small>`;
    }
    return this.escapeHtml(profile);
  },

  renderInstalledLine(customer) {
    if (!customer.install_date) return '';
    const when = this.parseDue(customer.install_date);
    if (!when) return '';
    const text = customer.install_date.includes(':')
      ? `${when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return `<br><small style="color:var(--text-muted);font-size:0.78rem">installed ${text}</small>`;
  },

  /**
   * What the router's own scheduler job is armed for. Blank means no timer on the
   * router, and the reason matters: billing switched off, a cut-off instant that
   * has already gone by, or a router that was unreachable when the account was
   * saved. The panel sweep is the backstop in every case.
   */
  renderScheduledCell(customer) {
    if (!customer.due_date) return '';
    if (customer.scheduled_at) {
      const when = this.parseDue(customer.scheduled_at);
      const label = when
        ? `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
        : this.escapeHtml(customer.scheduled_at);
      return `<br><small style="color:var(--text-muted);font-size:0.78rem">&#9200; auto-kick on router: ${label}</small>`;
    }
    if (this._pppBillingEnabled === false) {
      return '<br><small style="color:var(--warning);font-size:0.78rem" title="Billing is switched off on this router, so the panel arms no cut-off timer and its sweep does not run either. Turn billing on in PPP - Billing Settings, then save the account.">billing off - no cut-off</small>';
    }
    const due = this.parseDue(customer.due_date);
    // A prepaid account is cut off on the due date itself, so its timer is armed
    // with nothing added - showing the router grace here would be a lie.
    const grace = this.graceDaysFor(customer) * 86400000;
    const fires = due ? new Date(due.getTime() + grace) : null;
    if (fires && fires <= new Date()) {
      return '<br><small style="color:var(--text-muted);font-size:0.78rem" title="The cut-off instant has passed, so there is nothing left to arm; the sweep handles it.">cut-off due</small>';
    }
    return '<br><small style="color:var(--warning);font-size:0.78rem" title="No scheduler job on the router for this account - it was offline when the account was saved, or the account predates per-account timers. Open Edit and press Save to arm it.">router timer not armed</small>';
  },

  renderDueCell(customer) {
    if (!customer.due_date) return '<span style="color:var(--text-muted)">not billed</span>';
    const due = this.parseDue(customer.due_date);
    if (!due) return this.escapeHtml(customer.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    const label = due.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      + (customer.due_date.includes(':') ? ` ${due.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '');
    if (due < today) return `<span style="color:var(--danger)">${label}<br><small>${Math.abs(Math.round((today - due) / 86400000))}d overdue</small></span>`;
    if (days <= 3) return `<span style="color:var(--warning)">${label}<br><small>${days <= 0 ? 'due today' : `in ${days}d`}</small></span>`;
    return `${label}<br><small style="color:var(--text-muted)">in ${days}d</small>`;
  },

  /**
   * A stored due date is either a bare day or a day with the minute the operator
   * picked. Both are read as local time - sending `2026-11-30` straight to
   * new Date() would land it on midnight UTC and shift the whole billing day.
   */
  parseDue(value) {
    if (!value) return null;
    const text = String(value).trim().replace(' ', 'T');
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
    return Number.isNaN(date.getTime()) ? null : date;
  },

  /** Value for an <input type="datetime-local">: `YYYY-MM-DDTHH:MM`. */
  toLocalInput(value, { endOfDay = false } = {}) {
    if (!value) return '';
    const text = String(value).trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T${endOfDay ? '23:59' : '00:00'}`;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(text);
    return match ? `${match[1]}T${match[2]}:${match[3]}` : '';
  },

  // Grace is a property of the account now, not of the router: prepaid rows
  // never get the forgive-the-N-days treatment.
  graceDaysFor(row) {
    if (String(row?.billing_type || '').toLowerCase() === 'prepaid') return 0;
    return Math.max(0, Number(this._pppBillingGrace) || 0);
  },

  renderBillingBadge(customer) {
    const status = customer.billing_status || 'unbilled';
    if (status === 'cut-off') return '<span class="badge badge-offline">Cut-off</span>';
    if (status === 'suspended') return '<span class="badge badge-offline">Suspended</span>';
    if (!customer.plan_id || !customer.due_date) return '<span class="badge" style="opacity:0.6">Unbilled</span>';
    const due = this.parseDue(customer.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due && due < today) {
      return `<span class="badge badge-offline">${this.graceDaysFor(customer) > 0 ? 'Grace' : 'Overdue'}</span>`;
    }
    return '<span class="badge badge-online">Paid</span>';
  },

  /**
   * How this account's period is counted. Postpaid is what every account was
   * before this existed and what the backend defaults to, so the badge only has
   * to earn its place on the prepaid side.
   */
  renderBillingTypeBadge(customer) {
    const prepaid = String(customer?.billing_type || 'postpaid').toLowerCase() === 'prepaid';
    return `<span class="badge ${prepaid ? 'badge-warning' : 'badge-online'}" style="opacity:0.85" title="${prepaid
      ? 'Prepaid account: cycle counted from the day they pay - cut off on the due date itself, no grace'
      : 'Postpaid account: fixed cut-off day per month - the grace period applies before the line is slowed down'}">${prepaid ? 'Prepaid' : 'Postpaid'}</span>`;
  },

  // A plan is only a price, a cycle and a profile, so this label stays away from
  // the billing model - that is decided on the account, not on what it pays.
  planOptionLabel(p) {
    const cycle = p.cycle_days >= 365 ? `${Math.round(p.cycle_days / 365)}y` : p.cycle_days >= 28 ? `${Math.round(p.cycle_days / 30)}mo` : `${p.cycle_days}d`;
    return `${this.escapeHtml(p.name)} - ${this.planMoney(p)}/${cycle}`;
  },

  // Mirror of the server's prepaid arithmetic - the preview must not promise a
  // date the backend will not produce.
  addMonthsLocal(date, months) {
    const day = date.getDate();
    const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
    next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    return next;
  },

  cycleMonths(cycleDays) {
    const days = Math.max(1, Math.round(cycleDays) || 30);
    if (days >= 365) return Math.max(1, Math.round(days / 365));
    return Math.max(1, Math.round(days / 30));
  },

  // Plans carry their own currency code; fall back to the system one.
  planMoney(plan) {
    if (!plan) return '-';
    return this.formatAmount(plan.currency || this.systemCurrency, plan.price);
  },

  // The subscriber's speed comes from the billing plan, which already binds a
  // PPPoE profile carrying the rate-limit. That is why this form has no profile,
  // service, address or quota boxes any more: plan + dates only.
  async showAddCustomerModal(customerId = null) {
    const isEdit = customerId != null;
    const [plans, settings] = await Promise.all([
      api.getBillingPlans(this.selectedRouterId).catch(() => []),
      api.getBillingSettings(this.selectedRouterId).catch(() => null),
    ]);
    let customer = { name: '', username: '', password: '', plan_id: null, billing_type: 'postpaid', install_date: '', due_date: '' };
    if (isEdit) {
      const customers = await api.getPppCustomers(this.selectedRouterId);
      customer = (customers || []).find((c) => c.id === customerId) || customer;
    }

    const usable = (plans || []).filter((p) => p.is_active || p.id === customer.plan_id);
    const grace = Number(settings?.grace_days || 0);
    this._pppPlanChoices = usable;
    this._pppBillingGrace = grace;
    const planLabels = usable.map((p) => `${this.planOptionLabel(p)} (${this.escapeHtml(p.pppoe_profile)})`);
    // The billing model is sold with the account, never with the plan, so the
    // picker lives here and two neighbours on one price can be billed differently.
    const prepaid = String(customer.billing_type || 'postpaid').toLowerCase() === 'prepaid';
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    this.openModal(isEdit ? 'Edit PPP Customer' : 'Add PPP Customer', `
      <form id="ppp-customer-form">
        <div class="form-group"><label>Customer Name</label><input type="text" name="name" required value="${this.escapeHtml(customer.name)}"></div>
        <div class="form-group"><label>Username (PPPoE login)</label><input type="text" name="username" required value="${this.escapeHtml(customer.username)}" ${isEdit ? '' : 'autocomplete="off"'}></div>
        <div class="form-group"><label>Password</label><input type="password" name="password" ${isEdit ? 'placeholder="leave empty to keep the current one"' : 'required'} value="${this.escapeHtml(customer.password || '')}"></div>
        ${usable.length
          ? `<div class="form-group"><label>Billing Plan (decides the speed)</label>
               <select name="planId" onchange="App.renderCustomerDueHint()">${usable.map((p, i) => `<option value="${p.id}" ${String(p.id) === String(customer.plan_id || '') ? 'selected' : ''}>${planLabels[i]}</option>`).join('')}</select>
               <small style="color:var(--text-muted)">The plan's PPPoE profile and its rate-limit are handed to this subscriber. Change the speed on the PPPoE Profiles tab.</small></div>`
          : `<div class="form-group"><label>Billing Plan</label>
               <input type="text" name="planId" value="" disabled>
               <small style="color:var(--warning)">No billing plan on this router yet - create one on the Billing Plans tab before adding a subscriber.</small></div>`}
        <div class="form-group"><label>Billing Type (how this account pays)</label>
          <select name="billingType" onchange="App.renderCustomerDueHint()">
            <option value="postpaid" ${prepaid ? '' : 'selected'}>Postpaid - fixed cut-off day, grace allowed</option>
            <option value="prepaid" ${prepaid ? 'selected' : ''}>Prepaid - cycle from the day they pay, no grace</option>
          </select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group"><label>Date of Installation</label>
            <input type="datetime-local" name="installDate" value="${this.toLocalInput(customer.install_date) || `${today}T08:00`}"></div>
          <div class="form-group"><label>Next Due Date</label>
            <input type="datetime-local" name="dueDate" value="${this.toLocalInput(customer.due_date, { endOfDay: true })}"></div>
        </div>
        <small id="customer-due-hint" style="color:var(--text-muted);display:block;margin-top:0.25rem"></small>
        <small style="color:var(--text-muted);display:block;margin-top:0.25rem">Leave the due date empty to bill one plan cycle from today. The panel arms a cut-off timer on the router for this account, so the line is slowed down even when the panel is offline.</small>
      </form>
    `, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: isEdit ? 'Save Changes' : 'Add Customer', class: 'btn btn-primary', action: () => (isEdit ? this.submitEditCustomer(customerId) : this.submitAddCustomer()) },
    ]);
    this.renderCustomerDueHint();
  },

  /**
   * What the chosen billing model means for the dates above it. Saying
   * "prepaid" is not enough - the operator has to know the line dies on the day
   * itself and that a late payment moves the anniversary along with it.
   */
  renderCustomerDueHint() {
    const box = document.getElementById('customer-due-hint');
    if (!box) return;
    const type = document.querySelector('#ppp-customer-form select[name="billingType"]');
    if (type && String(type.value).toLowerCase() === 'prepaid') {
      box.textContent = 'Prepaid account: the router cuts this line on the due date itself, no grace. Pay late and the next cycle starts from the day the money comes in - due Dec 23, paid Dec 25, next due Jan 25.';
      return;
    }
    const grace = Math.max(0, Number(this._pppBillingGrace) || 0);
    box.textContent = grace > 0
      ? `Postpaid account: ${grace}-day grace after this due date before the line is slowed down, and renewals snap back to the fixed cut-off day.`
      : 'Postpaid account: renewals snap back to the fixed cut-off day set in Billing Settings.';
  },

  // Shared by add and edit: the fields this form is allowed to touch.
  customerFormPayload(form) {
    return {
      name: form.name.value.trim(),
      username: form.username.value.trim(),
      password: form.password.value || null,
      planId: form.planId && form.planId.value ? parseInt(form.planId.value, 10) : null,
      billingType: form.billingType ? form.billingType.value : 'postpaid',
      installDate: form.installDate.value || null,
      dueDate: form.dueDate.value || null,
    };
  },

  async submitAddCustomer() {
    const form = document.getElementById('ppp-customer-form');
    const payload = this.customerFormPayload(form);
    if (!payload.planId) { this.toast('Pick a billing plan so the subscriber gets a speed', 'error'); return; }
    try {
      const result = await api.createPppCustomer(this.selectedRouterId, payload);
      this.closeModal();
      this.toast(result?.message || 'PPP customer created', 'success');
      if (result?.warning) this.toast(result.warning, 'info');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async submitEditCustomer(customerId) {
    const form = document.getElementById('ppp-customer-form');
    const payload = this.customerFormPayload(form);
    if (!payload.password) delete payload.password;
    try {
      const result = await api.updatePppCustomer(this.selectedRouterId, customerId, payload);
      this.closeModal();
      this.toast(result?.message || 'PPP customer updated', 'success');
      if (result?.warning) this.toast(result.warning, 'info');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deleteCustomer(customerId) {
    if (!confirm('Delete this PPP customer?')) return;
    try {
      await api.deletePppCustomer(this.selectedRouterId, customerId);
      this.toast('PPP customer deleted', 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async toggleCustomer(customerId, disabled) {
    try {
      await api[disabled ? 'disablePppCustomer' : 'enablePppCustomer'](this.selectedRouterId, customerId);
      this.toast(disabled ? 'Customer disabled' : 'Customer enabled', 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ---- PPP sub-pages: shared option loaders ----

  // Profiles and interfaces live on the router, so every picker falls back to a
  // free-text box when the router is offline rather than blocking the form.
  async pppProfileNames(force) {
    const routerId = this.selectedRouterId;
    if (!force && this._pppProfileCache && this._pppProfileCache.routerId === routerId) return this._pppProfileCache.names;
    let names = [];
    try {
      const profiles = await api.getPppProfiles(routerId);
      names = (profiles || []).map((p) => p.name).filter(Boolean);
    } catch (err) { /* offline */ }
    this._pppProfileCache = { routerId, names };
    return names;
  },

  async pppInterfaceNames(force) {
    const routerId = this.selectedRouterId;
    if (!force && this._pppInterfaceCache && this._pppInterfaceCache.routerId === routerId) return this._pppInterfaceCache.names;
    let names = [];
    try {
      const list = await api.getRouterInterfaces(routerId);
      names = (list || []).map((i) => i.name).filter(Boolean);
    } catch (err) { /* offline */ }
    this._pppInterfaceCache = { routerId, names };
    return names;
  },

  optionList(options, selected) {
    const items = (options || []).slice();
    if (selected && !items.includes(selected)) items.unshift(selected);
    return items.map((value) => `<option value="${this.escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${this.escapeHtml(value)}</option>`).join('');
  },

  profileField(name, selected, names, label) {
    if (!names || names.length === 0) {
      return `<div class="form-group"><label>${label || 'PPPoE Profile'}</label>
        <input type="text" name="${name}" value="${this.escapeHtml(selected || '')}" placeholder="default">
        <small style="color:var(--text-muted)">Connect the router to list the profiles it has.</small></div>`;
    }
    return `<div class="form-group"><label>${label || 'PPPoE Profile'}</label>
      <select name="${name}">${this.optionList(names, selected || names[0])}</select></div>`;
  },

  // ---- PPPoE Servers sub-page ----

  async loadPppoeServers(container) {
    if (!container) container = document.getElementById('ppp-tab-content');
    // The profile/interface calls look unused here, but they warm the caches the
    // create/edit form reads, so the modal opens instantly.
    const [servers] = await Promise.all([
      api.getPppoeServers(this.selectedRouterId),
      this.pppProfileNames(),
      this.pppInterfaceNames(),
    ]);
    this._pppServers = servers || [];

    const head = `
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-bottom:0.75rem;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="App.loadPppoeServers()">Refresh from Router</button>
        <button class="btn btn-sm btn-primary" onclick="App.showServerModal()">Create PPPoE Server</button>
      </div>`;

    if (!servers || servers.length === 0) {
      container.innerHTML = `${head}<div class="empty-state"><p>No PPPoE server on this router yet. Create one to accept PPPoE dial-ins.</p></div>`;
      return;
    }

    container.innerHTML = `${head}
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Interface</th><th>Service Name</th><th>Default Profile</th><th>Authentication</th><th>Sessions</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${servers.map((s) => `
              <tr>
                <td><strong>${this.escapeHtml(s.interface || s.name)}</strong>${s.on_router ? '' : '<br><small style="color:var(--warning)">not on the router anymore</small>'}</td>
                <td>${s.service_name ? `<code>${this.escapeHtml(s.service_name)}</code>` : '<small style="color:var(--text-muted)">(matches any)</small>'}</td>
                <td>${this.escapeHtml(s.default_profile || '-')}</td>
                <td><small>${this.escapeHtml(s.authentication || '-')}</small></td>
                <td>${s.current_sessions || 0}${s.max_sessions ? ` / ${s.max_sessions}` : ''}</td>
                <td>${s.running === null
                  ? '<span class="badge" style="opacity:0.6">Unknown</span>'
                  : s.running
                    ? '<span class="badge badge-online">Running</span>'
                    : s.invalid
                      ? `<span class="badge badge-warning" title="${s.interface_down ? 'RouterOS will start it as soon as the port gets a link' : 'RouterOS refuses to run it on this interface'}">${s.interface_down ? 'No link' : 'Invalid'}</span>`
                      : '<span class="badge badge-offline">Disabled</span>'}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-sm btn-outline" onclick="App.showServerModal(${s.id})">Edit</button>
                  ${s.on_router ? `<button class="btn btn-sm btn-outline" onclick="App.toggleServer(${s.id}, ${s.disabled ? 0 : 1})">${s.disabled ? 'Enable' : 'Disable'}</button>` : ''}
                  <button class="btn btn-sm btn-danger" onclick="App.deleteServer(${s.id})">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem">RouterOS has no name for a PPPoE server: the interface plus the service name is what identifies it. Servers created in Winbox are picked up automatically. A server on a port with no cable shows as No link - RouterOS starts it the moment the link comes up. Customers get their speed from their own PPP secret profile, not from the default profile here.</p>
    `;
  },

  async showServerModal(serverId = null) {
    const isEdit = serverId != null;
    const existing = isEdit ? (this._pppServers || []).find((s) => s.id === serverId) || {} : {};
    const [profiles, interfaces] = await Promise.all([this.pppProfileNames(), this.pppInterfaceNames()]);
    const authOptions = ['pap,chap,mschap1,mschap2', 'pap,chap', 'pap', 'chap', 'mschap2'];
    const auth = existing.authentication || 'pap,chap,mschap1,mschap2';

    const form = `
      <form id="ppp-server-form">
        ${isEdit ? `<div class="form-group"><label>Server</label>
          <input type="text" value="${this.escapeHtml(existing.interface || existing.name || '')}" readonly>
          <small style="color:var(--text-muted)">RouterOS gives a PPPoE server no name of its own.</small></div>` : ''}
        ${interfaces.length
          ? `<div class="form-group"><label>Interface (where customers plug in)</label>
               <select name="interface">${this.optionList(interfaces, existing.interface)}</select></div>`
          : `<div class="form-group"><label>Interface (where customers plug in)</label>
               <input type="text" name="interface" required value="${this.escapeHtml(existing.interface || '')}" placeholder="ether2 / bridge1 / vlan10"></div>`}
        <div class="form-group"><label>Service Name (optional)</label>
          <input type="text" name="serviceName" value="${this.escapeHtml(existing.service_name || '')}">
          <small style="color:var(--text-muted)">Leave empty to answer every client on that interface. Fill it in only when a remote router dials a specific service name.</small></div>
        ${this.profileField('defaultProfile', existing.default_profile || 'default', profiles, 'Default Profile')}
        <div class="form-group"><label>Authentication</label>
          <select name="authentication">${authOptions.map((a) => `<option value="${a}" ${a === auth ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group"><label>Max Sessions (0 = unlimited)</label>
            <input type="number" name="maxSessions" min="0" value="${existing.max_sessions != null ? existing.max_sessions : 0}"></div>
          <div class="form-group"><label>Keepalive Timeout (s)</label>
            <input type="text" name="keepaliveTimeout" value="${this.escapeHtml(existing.keepalive_timeout || '10')}"></div>
          <div class="form-group"><label>Max MTU</label>
            <input type="number" name="maxMtu" min="1280" max="1480" value="${existing.max_mtu || 1480}"></div>
          <div class="form-group"><label>Max MRU</label>
            <input type="number" name="maxMru" min="1280" max="1480" value="${existing.max_mru || 1480}"></div>
        </div>
        <div class="form-group"><label style="display:flex;gap:0.5rem;align-items:center;text-transform:none">
          <input type="checkbox" name="oneSessionPerHost" ${existing.one_session_per_host === 0 ? '' : 'checked'}> One session per host</label></div>
        <div class="form-group"><label style="display:flex;gap:0.5rem;align-items:center;text-transform:none">
          <input type="checkbox" name="disabled" ${isEdit ? (existing.disabled ? 'checked' : '') : 'checked'}> Disabled (create it switched off)</label></div>
        <div class="form-group"><label>Comment (optional)</label>
          <input type="text" name="comment" value="${this.escapeHtml(existing.comment || '')}"></div>
      </form>
    `;

    this.openModal(isEdit ? 'Edit PPPoE Server' : 'Create PPPoE Server', form, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: isEdit ? 'Save Changes' : 'Create Server', class: 'btn btn-primary', action: () => this.submitServer(serverId) },
    ]);
  },

  async submitServer(serverId = null) {
    const form = document.getElementById('ppp-server-form');
    const payload = {
      interface: form.interface.value.trim(),
      serviceName: form.serviceName.value.trim(),
      defaultProfile: form.defaultProfile.value ? form.defaultProfile.value.trim() : 'default',
      authentication: form.authentication.value,
      oneSessionPerHost: form.oneSessionPerHost.checked ? 1 : 0,
      maxSessions: parseInt(form.maxSessions.value, 10) || 0,
      maxMtu: parseInt(form.maxMtu.value, 10) || 1480,
      maxMru: parseInt(form.maxMru.value, 10) || 1480,
      keepaliveTimeout: form.keepaliveTimeout.value.trim() || '10',
      disabled: form.disabled.checked ? 1 : 0,
      comment: form.comment.value.trim(),
    };
    if (!payload.interface) { this.toast('Pick the interface the server runs on', 'error'); return; }

    try {
      if (serverId != null) await api.updatePppoeServer(this.selectedRouterId, serverId, payload);
      else await api.createPppoeServer(this.selectedRouterId, payload);
      this.closeModal();
      this.toast(`PPPoE server ${serverId != null ? 'updated' : 'created'}`, 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async toggleServer(serverId, disable) {
    const server = (this._pppServers || []).find((s) => s.id === serverId);
    if (!server) return;
    try {
      await api.updatePppoeServer(this.selectedRouterId, serverId, { disabled: disable ? 1 : 0 });
      this.toast(`PPPoE server ${disable ? 'disabled' : 'enabled'}`, 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deleteServer(serverId) {
    const server = (this._pppServers || []).find((s) => s.id === serverId);
    if (!confirm(`Remove PPPoE server "${server ? server.name : serverId}" from the router? Active clients will drop.`)) return;
    try {
      const result = await api.deletePppoeServer(this.selectedRouterId, serverId);
      this.closeModal();
      this.toast(result && result.warning ? result.warning : 'PPPoE server deleted', result && result.warning ? 'info' : 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ---- PPPoE Profiles sub-page ----

  /**
   * /ppp/profile belongs to the router, so nothing is mirrored in the database:
   * the list is read live, a profile made in Winbox shows up here and one made
   * here shows up in Winbox. The panel only adds who is using it, because a
   * profile with subscribers behind it must not be deleted by accident.
   */
  async loadPppProfiles(container) {
    if (!container) container = document.getElementById('ppp-tab-content');
    const [profiles, pools] = await Promise.all([
      api.getPppProfiles(this.selectedRouterId),
      api.getAddressPools(this.selectedRouterId).catch(() => []),
    ]);
    this._pppProfiles = profiles || [];
    this._pppPoolNames = (pools || []).map((p) => p.name).filter(Boolean);

    const head = `
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-bottom:0.75rem;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="App.loadPppProfiles()">Refresh from Router</button>
        <button class="btn btn-sm btn-primary" onclick="App.showProfileModal()">Add PPPoE Profile</button>
      </div>`;

    if (!profiles || profiles.length === 0) {
      container.innerHTML = `${head}<div class="empty-state"><p>No profiles could be read. Connect the router, then refresh - profiles are never stored in the panel, they live on the router.</p></div>`;
      return;
    }

    container.innerHTML = `${head}
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Profile</th><th>Speed Limit</th><th>Local Address</th><th>Remote Pool</th><th>In Use By</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${profiles.map((p) => `
              <tr>
                <td><strong>${this.escapeHtml(p.name)}</strong>${p.built_in ? ' <span class="badge" style="opacity:0.6" title="Shipped by RouterOS">built-in</span>' : ''}</td>
                <td>${p.rate_limit
                  ? `<code>${this.escapeHtml(p.rate_limit)}</code><br><small style="color:var(--text-muted)">rx ${this.escapeHtml(p.rx_limit || '-')} / tx ${this.escapeHtml(p.tx_limit || '-')}</small>`
                  : '<small style="color:var(--text-muted)">no limit</small>'}</td>
                <td><small>${this.escapeHtml(p.local_address || '-')}</small></td>
                <td><small>${this.escapeHtml(p.remote_address || '-')}</small></td>
                <td>${this.renderProfileUsage(p)}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-sm btn-outline" onclick="App.showProfileModal('${this.escapeHtml(p.name).replace(/'/g, '&#39;')}')">Edit</button>
                  ${p.built_in ? '' : `<button class="btn btn-sm btn-danger" onclick="App.deleteProfile('${this.escapeHtml(p.name).replace(/'/g, '&#39;')}')">Delete</button>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem">These are the profiles a billing plan binds to and that a subscriber's login carries. RouterOS reads the speed when a session connects, so changing one drops the live sessions on it and the clients redial with the new cap. A profile name cannot be changed because every login refers to it by that text.</p>
    `;
  },

  renderProfileUsage(p) {
    const parts = [];
    if (p.secrets) parts.push(`${p.secrets} router login(s)`);
    if (p.customers) parts.push(`${p.customers} panel customer(s)`);
    if (p.plans && p.plans.length) parts.push(`plan: ${p.plans.join(', ')}`);
    if (p.servers && p.servers.length) parts.push(`server default: ${p.servers.join(', ')}`);
    if (!parts.length) return '<small style="color:var(--text-muted)">nobody</small>';
    return `<small>${parts.map((x) => this.escapeHtml(x)).join('<br>')}</small>`;
  },

  async showProfileModal(profileName = null) {
    const isEdit = profileName != null;
    const existing = isEdit ? (this._pppProfiles || []).find((p) => p.name === profileName) || {} : {};
    const pools = this._pppPoolNames || [];
    const yesNoDefault = (value) => ['default', 'yes', 'no'].map((o) => `<option value="${o}" ${(value || 'default') === o ? 'selected' : ''}>${o}</option>`).join('');

    const form = `
      <form id="ppp-profile-form">
        <div class="form-group"><label>Profile Name</label>
          ${isEdit
            ? `<input type="text" value="${this.escapeHtml(existing.name || profileName)}" readonly>
               <small style="color:var(--text-muted)">Subscribers point at a profile by name, so it cannot be renamed here.</small>`
            : `<input type="text" name="name" required placeholder="e.g. 20M" value="">
               <small style="color:var(--text-muted)">Letters, numbers, - and _. Whatever a billing plan will bind to.</small>`}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group"><label>Download / Rx (first value)</label>
            <input type="text" name="rxLimit" value="${this.escapeHtml(existing.rx_limit || '')}" placeholder="10M">
            <small style="color:var(--text-muted)">10M, 512k... blank = no cap</small></div>
          <div class="form-group"><label>Upload / Tx (second value)</label>
            <input type="text" name="txLimit" value="${this.escapeHtml(existing.tx_limit || '')}" placeholder="10M">
            <small style="color:var(--text-muted)">leave blank for the same both ways</small></div>
          <div class="form-group"><label>Local Address (router side)</label>
            <input type="text" name="localAddress" value="${this.escapeHtml(existing.local_address || '')}" placeholder="172.16.44.1">
            <small style="color:var(--text-muted)">${isEdit ? 'blank keeps the address it has now - RouterOS cannot un-set one' : 'blank lets RouterOS use its own default'}</small></div>
          ${pools.length
            ? `<div class="form-group"><label>Remote Address / Pool</label>
                 <select name="remoteAddressPool">${isEdit ? '' : '<option value="">(router default)</option>'}${this.optionList(pools, existing.remote_address)}</select>
                 <small style="color:var(--text-muted)">the pool clients get their IP from</small></div>`
            : `<div class="form-group"><label>Remote Address / Pool</label>
                 <input type="text" name="remoteAddress" value="${this.escapeHtml(existing.remote_address || '')}" placeholder="PPPOE (an IP pool name)">
                 <small style="color:var(--text-muted)">${isEdit ? 'blank keeps the pool it has now' : 'blank lets RouterOS use its own default'}</small></div>`}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group"><label>Only One Session</label><select name="onlyOne">${yesNoDefault(existing.only_one)}</select></div>
          <div class="form-group"><label>Change TCP MSS</label><select name="changeTcpMss">${yesNoDefault(existing.change_tcp_mss)}</select></div>
          <div class="form-group"><label>Use IPv6</label><select name="useIpv6">${yesNoDefault(existing.use_ipv6)}</select></div>
          <div class="form-group"><label>Use Encryption</label><select name="useEncryption">${yesNoDefault(existing.use_encryption)}</select></div>
        </div>
      </form>
    `;

    this.openModal(isEdit ? `Edit Profile: ${profileName}` : 'Add PPPoE Profile', form, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: isEdit ? 'Save on Router' : 'Create on Router', class: 'btn btn-primary', action: () => this.submitProfile(profileName) },
    ]);
  },

  async submitProfile(profileName = null) {
    const form = document.getElementById('ppp-profile-form');
    const SPEED = /^\d+(\.\d+)?[kmgt]?$/i;
    const rx = form.rxLimit.value.trim();
    const tx = form.txLimit.value.trim();
    if (rx && !SPEED.test(rx)) { this.toast('Download must look like 10M or 512k', 'error'); return; }
    if (tx && !SPEED.test(tx)) { this.toast('Upload must look like 10M or 512k', 'error'); return; }

    // RouterOS wants rx/tx; one value means the operator meant it both ways.
    let rateLimit = '';
    if (rx && tx) rateLimit = `${rx}/${tx}`;
    else if (rx) rateLimit = rx;
    else if (tx) rateLimit = `${tx}/${tx}`;

    const poolField = form.remoteAddressPool || form.remoteAddress;
    const payload = {
      rateLimit,
      localAddress: form.localAddress.value.trim(),
      remoteAddress: poolField ? poolField.value.trim() : '',
      onlyOne: form.onlyOne.value,
      changeTcpMss: form.changeTcpMss.value,
      useIpv6: form.useIpv6.value,
      useEncryption: form.useEncryption.value,
    };
    if (profileName == null) {
      payload.name = form.name.value.trim();
      if (!payload.name) { this.toast('Give the profile a name', 'error'); return; }
    }

    try {
      const result = profileName == null
        ? await api.createPppProfile(this.selectedRouterId, payload)
        : await api.updatePppProfile(this.selectedRouterId, profileName, payload);
      this.closeModal();
      this._pppProfileCache = null;
      this.toast(result && result.message ? result.message : 'Profile saved', 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deleteProfile(profileName) {
    const profile = (this._pppProfiles || []).find((p) => p.name === profileName);
    if (profile && profile.in_use) {
      this.toast(`${profileName} still has subscribers, plans or a server default on it - move them first or change its speed instead`, 'error');
      return;
    }
    if (!confirm(`Delete PPPoE profile "${profileName}" from the router?`)) return;
    try {
      const result = await api.deletePppProfile(this.selectedRouterId, profileName);
      this._pppProfileCache = null;
      this.toast(result && result.message ? result.message : 'Profile deleted', 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ---- Billing Plans sub-page ----

  async loadBillingPlans(container) {
    if (!container) container = document.getElementById('ppp-tab-content');
    const [plans, profiles] = await Promise.all([api.getBillingPlans(this.selectedRouterId), this.pppProfileNames()]);
    this._billingPlans = plans || [];
    this._billingProfileNames = profiles || [];

    const head = `
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-bottom:0.75rem">
        <button class="btn btn-sm btn-primary" onclick="App.showPlanModal()">New Plan</button>
      </div>`;

    if (!plans || plans.length === 0) {
      container.innerHTML = `${head}<div class="empty-state"><p>No billing plans yet. A plan is a price plus the PPPoE profile it hands out.</p></div>`;
      return;
    }

    container.innerHTML = `${head}
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Plan</th><th>Price</th><th>Cycle</th><th>Binds to Profile</th><th>Description</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${plans.map((p) => `
              <tr>
                <td><strong>${this.escapeHtml(p.name)}</strong></td>
                <td>${this.planMoney(p)}</td>
                <td>${p.cycle_days >= 365 ? `${Math.round(p.cycle_days / 365)} year(s)` : p.cycle_days >= 28 ? `${Math.round(p.cycle_days / 30)} month(s)` : `${p.cycle_days} days`}</td>
                <td><code>${this.escapeHtml(p.pppoe_profile)}</code></td>
                <td><small style="color:var(--text-muted)">${this.escapeHtml(p.description || '-')}</small></td>
                <td><span class="badge ${p.is_active ? 'badge-online' : 'badge-offline'}">${p.is_active ? 'Active' : 'Hidden'}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-sm btn-outline" onclick="App.showPlanModal(${p.id})">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="App.deletePlan(${p.id})">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem">A plan is only a price, a cycle and the PPPoE profile it hands out. Whether the subscriber paying it is <strong>postpaid</strong> (fixed cut-off day, grace allowed) or <strong>prepaid</strong> (cycle counted from the day the money arrives, no grace) is chosen on the customer account, so the same plan can be sold either way. Cycles shorter than 28 days always roll forward by that many days.</p>
    `;
  },

  async showPlanModal(planId = null) {
    const isEdit = planId != null;
    const existing = isEdit ? (this._billingPlans || []).find((p) => p.id === planId) || {} : {};
    const profiles = this._billingProfileNames || (await this.pppProfileNames());

    const form = `
      <form id="billing-plan-form">
        <div class="form-group"><label>Plan Name</label>
          <input type="text" name="name" required value="${this.escapeHtml(existing.name || '')}" placeholder="e.g. 10Mbps - 500"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group"><label>Price per Cycle</label>
            <input type="number" name="price" min="0" step="0.01" required value="${existing.price != null ? existing.price : ''}"></div>
          <div class="form-group"><label>Currency</label>
            <input type="text" name="currency" value="${this.escapeHtml(existing.currency || 'PHP')}" maxlength="3"></div>
          <div class="form-group"><label>Cycle (days)</label>
            <input type="number" name="cycleDays" min="1" required value="${existing.cycle_days != null ? existing.cycle_days : 30}">
            <small style="color:var(--text-muted)">30 monthly, 90 quarterly, 365 yearly</small></div>
        </div>
        ${this.profileField('pppoeProfile', existing.pppoe_profile, profiles, 'Binds to PPPoE Profile')}
        <div class="form-group"><label>Description (optional)</label>
          <input type="text" name="description" value="${this.escapeHtml(existing.description || '')}"></div>
        <div class="form-group"><label style="display:flex;gap:0.5rem;align-items:center;text-transform:none">
          <input type="checkbox" name="isActive" ${existing.is_active === 0 ? '' : 'checked'}> Offer this plan (untick to hide it from new sales)</label></div>
      </form>
    `;

    this.openModal(isEdit ? 'Edit Billing Plan' : 'New Billing Plan', form, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: isEdit ? 'Save Changes' : 'Create Plan', class: 'btn btn-primary', action: () => this.submitPlan(planId) },
    ]);
  },

  async submitPlan(planId = null) {
    const form = document.getElementById('billing-plan-form');
    const payload = {
      name: form.name.value.trim(),
      price: parseFloat(form.price.value) || 0,
      currency: (form.currency.value.trim() || 'PHP').toUpperCase(),
      cycleDays: parseInt(form.cycleDays.value, 10) || 30,
      pppoeProfile: form.pppoeProfile.value.trim(),
      description: form.description.value.trim(),
      isActive: form.isActive.checked ? 1 : 0,
    };
    if (!payload.pppoeProfile) { this.toast('A PPPoE profile is required', 'error'); return; }

    try {
      if (planId != null) await api.updateBillingPlan(this.selectedRouterId, planId, payload);
      else await api.createBillingPlan(this.selectedRouterId, payload);
      this.closeModal();
      this.toast(`Billing plan ${planId != null ? 'updated' : 'created'}`, 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deletePlan(planId) {
    const plan = (this._billingPlans || []).find((p) => p.id === planId);
    if (!confirm(`Delete billing plan "${plan ? plan.name : planId}"?`)) return;
    try {
      const result = await api.deleteBillingPlan(this.selectedRouterId, planId);
      this.toast(result && result.deactivated
        ? `Plan has ${result.customers} customer(s), hidden instead of deleted`
        : 'Billing plan deleted', result && result.deactivated ? 'info' : 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ---- Billing Settings sub-page ----

  async loadBillingSettings(container) {
    if (!container) container = document.getElementById('ppp-tab-content');
    const [settings, plans, overview, payments, profiles] = await Promise.all([
      api.getBillingSettings(this.selectedRouterId),
      api.getBillingPlans(this.selectedRouterId),
      api.getBillingOverview(this.selectedRouterId),
      api.getBillingPayments(this.selectedRouterId, 25),
      this.pppProfileNames(),
    ]);
    this._billingSettings = settings || {};
    this._billingPlans = plans || [];
    this._billingProfileNames = profiles || [];

    const card = (label, value, color) => `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      </div>`;

    const planOptions = (plans || []).filter((p) => p.is_active).map((p) => ({ value: String(p.id), label: `${p.name} - ${this.planMoney(p)}` }));
    const profileOptions = profiles || [];

    container.innerHTML = `
      <div class="stats-grid" style="margin-bottom:1rem">
        ${card('Subscribers', overview.total)}
        ${card('Paid', overview.active, 'var(--success)')}
        ${card('Due Soon', overview.dueSoon, 'var(--warning)')}
        ${card('In Grace', overview.grace, 'var(--warning)')}
        ${card('Cut-off', overview.cutOff, 'var(--danger)')}
        ${card('Collected This Month', this.formatAmount(this.systemCurrency, overview.collectedThisMonth))}
      </div>

      <form id="billing-settings-form" class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.75rem;align-items:end">
        <div class="form-group"><label style="display:flex;gap:0.5rem;align-items:center;text-transform:none">
          <input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}> Enable automatic cut-off</label>
          <small style="color:var(--text-muted)">Checked every minute for this router</small></div>
        <div class="form-group"><label>Cut-off Day of Month</label>
          <input type="number" name="cutoffDay" min="1" max="28" value="${settings.cutoff_day || 1}">
          <small style="color:var(--text-muted)">Everyone lands on this day</small></div>
        <div class="form-group"><label>Grace Period (days)</label>
          <input type="number" name="graceDays" min="0" max="28" value="${settings.grace_days || 0}"></div>
        <div class="form-group"><label>Expiry Time (HH:MM)</label>
          <input type="time" name="expiryTime" value="${this.escapeHtml(settings.expiry_time || '00:00')}"></div>
        <div class="form-group"><label>Transfer to Profile (cut-off)</label>
          ${profileOptions.length
            ? `<select name="nonPaymentProfile">${this.optionList(profileOptions, settings.non_payment_profile)}</select>`
            : `<input type="text" name="nonPaymentProfile" value="${this.escapeHtml(settings.non_payment_profile || 'non-payment')}">`}</div>
        <div class="form-group"><label>Default Plan (for quick billing)</label>
          <select name="defaultPlanId">
            <option value="">- none -</option>
            ${planOptions.map((o) => `<option value="${o.value}" ${Number(settings.default_plan_id) === Number(o.value) ? 'selected' : ''}>${this.escapeHtml(o.label)}</option>`).join('')}
          </select></div>
        <div class="form-group" style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" onclick="App.submitBillingSettings()">Save Settings</button>
          <button type="button" class="btn btn-outline" onclick="App.runCutoffNow()">Run Cut-off Now</button>
        </div>
      </form>

      <h4 style="margin:1.25rem 0 0.5rem">Recent Payments</h4>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Date</th><th>Customer</th><th>Plan</th><th>Amount</th><th>Method</th><th>Reference</th><th>By</th><th>New Due</th></tr></thead>
          <tbody>
            ${(payments || []).length === 0
              ? '<tr><td colspan="8" style="color:var(--text-muted)">No payments recorded yet.</td></tr>'
              : payments.map((p) => `
              <tr>
                <td><small>${this.escapeHtml(String(p.created_at || '').replace('T', ' ').slice(0, 16))}</small></td>
                <td>${this.escapeHtml(p.customer_name || p.customer_username || '-')}</td>
                <td>${this.escapeHtml(p.plan_name || '-')}</td>
                <td>${this.formatAmount(this.systemCurrency, p.amount)}</td>
                <td>${this.escapeHtml(p.payment_method || '-')}</td>
                <td><small>${this.escapeHtml(p.reference || '-')}</small></td>
                <td><small>${this.escapeHtml(p.recorded_by || '-')}</small></td>
                <td>${this.escapeHtml(p.due_after || '-')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem">Cut-off moves the subscriber to the profile above and drops their session so the new limit applies. Recording a payment restores the plan profile and re-anchors the next due date on the cut-off day.</p>
    `;
  },

  async submitBillingSettings() {
    const form = document.getElementById('billing-settings-form');
    try {
      await api.saveBillingSettings(this.selectedRouterId, {
        enabled: form.enabled.checked ? 1 : 0,
        cutoffDay: parseInt(form.cutoffDay.value, 10) || 1,
        graceDays: parseInt(form.graceDays.value, 10) || 0,
        expiryTime: form.expiryTime.value || '00:00',
        nonPaymentProfile: form.nonPaymentProfile.value.trim(),
        defaultPlanId: form.defaultPlanId.value ? parseInt(form.defaultPlanId.value, 10) : null,
      });
      this.toast('Billing settings saved', 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async runCutoffNow() {
    try {
      const report = await api.runBillingSweep(this.selectedRouterId);
      const moved = (report && report.cutOff) || 0;
      const pending = (report && report.pending) || 0;
      this.toast(moved ? `Cut-off applied to ${moved} subscriber(s)` : 'Nothing was due', moved || pending ? 'success' : 'info');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ---- Per-customer billing actions ----

  findPppCustomer(customerId) {
    return (this._pppCustomers || []).find((c) => c.id === customerId) || null;
  },

  async showAssignPlanModal(customerId) {
    const customer = this.findPppCustomer(customerId);
    if (!customer) { this.toast('Reload the customers list first', 'error'); return; }
    const plans = (await api.getBillingPlans(this.selectedRouterId)).filter((p) => p.is_active || p.id === customer.plan_id);
    this._billingPlans = plans;

    if (plans.length === 0) {
      this.toast('Create a billing plan first', 'error');
      return;
    }

    const form = `
      <form id="assign-plan-form">
        <p style="color:var(--text-muted)">Binds <strong>${this.escapeHtml(customer.name || customer.username)}</strong> to a plan and starts the clock from today. No payment is recorded - use this for free trials and postpaid accounts.</p>
        <div class="form-group"><label>Plan</label>
          <select name="planId" onchange="App.updateAssignPreview()">
            ${plans.map((p) => `<option value="${p.id}" ${p.id === customer.plan_id ? 'selected' : ''}>${this.planOptionLabel(p)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>Cycles</label>
          <input type="number" name="cycles" min="1" max="24" value="1" onchange="App.updateAssignPreview()" oninput="App.updateAssignPreview()"></div>
        <div class="form-group"><label>Resulting Profile</label><input type="text" id="assign-profile" readonly value="${this.escapeHtml(plans[0].pppoe_profile)}"></div>
      </form>
    `;

    this.openModal('Assign Billing Plan', form, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Assign Plan', class: 'btn btn-primary', action: () => this.submitAssignPlan(customerId) },
    ]);
  },

  updateAssignPreview() {
    const form = document.getElementById('assign-plan-form');
    if (!form) return;
    const plan = (this._billingPlans || []).find((p) => p.id === parseInt(form.planId.value, 10));
    const field = document.getElementById('assign-profile');
    if (plan && field) field.value = plan.pppoe_profile;
  },

  async submitAssignPlan(customerId) {
    const form = document.getElementById('assign-plan-form');
    try {
      const result = await api.assignCustomerPlan(this.selectedRouterId, customerId, {
        planId: parseInt(form.planId.value, 10),
        cycles: parseInt(form.cycles.value, 10) || 1,
      });
      this.closeModal();
      this.toast(`${result.username} billed until ${result.dueDate}${result.warning ? ` (${result.warning})` : ''}`, result.warning ? 'info' : 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async showPayModal(customerId) {
    const customer = this.findPppCustomer(customerId);
    if (!customer) { this.toast('Reload the customers list first', 'error'); return; }
    const [plans, payments] = await Promise.all([
      api.getBillingPlans(this.selectedRouterId),
      api.getCustomerPayments(this.selectedRouterId, customerId).catch(() => []),
    ]);
    const options = plans.filter((p) => p.is_active || p.id === customer.plan_id);
    if (options.length === 0) { this.toast('Create a billing plan first', 'error'); return; }
    this._billingPlans = options;
    this._payCustomer = customer;

    const selected = customer.plan_id || options[0].id;
    const history = (payments || []).slice(0, 8);

    const form = `
      <form id="pay-form">
        <p style="color:var(--text-muted)">
          <strong>${this.escapeHtml(customer.name || customer.username)}</strong> (${this.escapeHtml(customer.username)})
          ${customer.due_date ? ` - currently paid until <strong>${this.escapeHtml(customer.due_date)}</strong>` : ' - not billed yet'}
          ${customer.billing_status === 'cut-off' ? ' - <span style="color:var(--danger)">cut off</span>' : ''}
        </p>
        <div class="form-group"><label>Plan</label>
          <select name="planId" onchange="App.updatePayPreview()">
            ${options.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${this.planOptionLabel(p)}</option>`).join('')}
          </select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div class="form-group"><label>Cycles (months)</label>
            <input type="number" name="cycles" min="1" max="24" value="1" oninput="App.updatePayPreview()" onchange="App.updatePayPreview()"></div>
          <div class="form-group"><label>Amount</label>
            <input type="number" name="amount" min="0" step="0.01" id="pay-amount" value="${Number((options.find((p) => p.id === selected) || options[0]).price).toFixed(2)}"></div>
          <div class="form-group"><label>Method</label>
            <select name="paymentMethod"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank">Bank</option><option value="other">Other</option></select></div>
          <div class="form-group"><label>Reference (optional)</label>
            <input type="text" name="reference" placeholder="OR number"></div>
        </div>
        <div class="form-group"><label>New Due Date</label>
          <input type="text" id="pay-due-preview" readonly value="calculating..."></div>
        <div class="form-group"><label>Note (optional)</label>
          <input type="text" name="note"></div>
      </form>
      ${history.length ? `
        <h5 style="margin:0.75rem 0 0.25rem">Payment History</h5>
        <div class="table-wrapper" style="max-height:160px;overflow:auto">
          <table>
            <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Method</th><th>Due After</th></tr></thead>
            <tbody>${history.map((p) => `
              <tr><td><small>${this.escapeHtml(String(p.created_at || '').slice(0, 10))}</small></td>
                  <td>${this.escapeHtml(p.plan_name || '-')}</td>
                  <td>${this.formatAmount(this.systemCurrency, p.amount)}</td>
                  <td>${this.escapeHtml(p.payment_method || '-')}</td>
                  <td>${this.escapeHtml(p.due_after || '-')}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
    `;

    this.openModal('Record Payment', form, [
      { label: 'Cancel', class: 'btn btn-outline', action: () => this.closeModal() },
      { label: 'Record Payment', class: 'btn btn-primary', action: () => this.submitPayment(customerId) },
    ]);
    this.updatePayPreview();
  },

  // Mirrors the server rule so the operator sees the date before saving: the
  // cycle is measured from the date the customer already paid up to.
  updatePayPreview() {
    const form = document.getElementById('pay-form');
    const preview = document.getElementById('pay-due-preview');
    const amountField = document.getElementById('pay-amount');
    if (!form || !preview) return;

    const plan = (this._billingPlans || []).find((p) => p.id === parseInt(form.planId.value, 10));
    if (!plan) return;
    const cycles = Math.max(1, parseInt(form.cycles.value, 10) || 1);
    if (amountField) amountField.value = (Number(plan.price) * cycles).toFixed(2);

    const settings = this._billingSettings || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let due = this._payCustomer && this._payCustomer.due_date ? new Date(`${this._payCustomer.due_date}T00:00:00`) : today;
    if (Number.isNaN(due.getTime()) || due < today) due = today;

    // The billing model comes off the account, not off the plan it happens to pay.
    const prepaid = String((this._payCustomer && this._payCustomer.billing_type) || 'postpaid').toLowerCase() === 'prepaid';

    if (Number(settings.enabled) === 1 && plan.cycle_days >= 28 && !prepaid) {
      const cutoffDay = Math.max(1, Math.min(28, parseInt(settings.cutoff_day, 10) || 1));
      for (let i = 0; i < cycles; i++) {
        const lastDay = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
        const candidate = new Date(due.getFullYear(), due.getMonth(), Math.min(cutoffDay, lastDay));
        due = candidate > due ? candidate : new Date(due.getFullYear(), due.getMonth() + 1, Math.min(cutoffDay, lastDay));
      }
    } else if (prepaid && plan.cycle_days >= 28) {
      // Prepaid anniversaries: whole calendar months from the day the money
      // arrives, clamped to days that really exist - Dec 25 plus a month is
      // Jan 25, Jan 31 plus a month is Feb 28.
      due = this.addMonthsLocal(due, this.cycleMonths(plan.cycle_days) * cycles);
    } else {
      due = new Date(due.getFullYear(), due.getMonth(), due.getDate() + plan.cycle_days * cycles);
    }

    const profileNote = this._payCustomer && this._payCustomer.billing_status === 'cut-off' ? ' - profile restored to plan' : '';
    const typeNote = prepaid ? ' - prepaid, no grace' : '';
    const local = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    preview.value = `${local} via profile "${plan.pppoe_profile}"${profileNote}${typeNote}`;
  },

  async submitPayment(customerId) {
    const form = document.getElementById('pay-form');
    try {
      const result = await api.payCustomerBill(this.selectedRouterId, customerId, {
        planId: parseInt(form.planId.value, 10),
        cycles: parseInt(form.cycles.value, 10) || 1,
        amount: form.amount.value === '' ? null : parseFloat(form.amount.value),
        paymentMethod: form.paymentMethod.value,
        reference: form.reference.value.trim() || null,
        note: form.note.value.trim() || null,
      });
      this.closeModal();
      this.toast(`${result.username}: ${this.formatAmount(this.systemCurrency, result.amount)} paid, due ${result.dueDate}${result.warning ? ` (${result.warning})` : ''}`, result.warning ? 'info' : 'success');
      this.loadPppTab();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ---- Sales Report ----
  _salesReport: null,
  _salesRange: null,

  // One shape for the Sub-Vendo table and its CSV export: the panel ledger wins
  // for AirCoins boards (they never kept their own counters), the board's own
  // counters win for JuanFi machines, which the panel cannot see per sale.
  salesVendoView(d) {
    const airCoinsBox = d.firmware === 'aircoins';
    const range = d.range || { sales: 0, coins: 0, minutes: 0, customers: 0 };
    const ledger = d.ledger || range;
    return {
      airCoinsBox,
      range,
      tracked: airCoinsBox || (Number(range.sales) || 0) > 0,
      lifetime: Math.max(Number(d.lifetimeCoins) || 0, airCoinsBox ? Number(ledger.coins) || 0 : 0),
      sinceReset: airCoinsBox ? null : Number(d.currentCoins) || 0,
      customers: Math.max(Number(d.customerCount) || 0, airCoinsBox ? Number(ledger.customers) || 0 : 0),
    };
  },

  // One row of the Sub-Vendo table. The columns are the same for both firmware
  // types, so a shop reads them the same way; the range columns are dashed out
  // for machines whose sales only exist on the board itself.
  salesVendoRow(d) {
    const v = this.salesVendoView(d);
    const fmt = (x) => this.formatMoney(x);
    const esc = (x) => this.escapeHtml(String(x == null ? '' : x));
    const dash = '<span title="This machine keeps no panel-side ledger">—</span>';
    const sinceReset = v.sinceReset === null
      ? '<span title="AirCoins keeps no board-side reset counter">—</span>'
      : fmt(v.sinceReset);
    return `
      <tr>
        <td>${esc(d.name)}</td>
        <td>${esc(d.ip)}</td>
        <td>${v.airCoinsBox ? 'AirCoins' : 'JuanFi'}</td>
        <td><span class="status-badge ${d.online ? 'connected' : 'disconnected'}">${d.online ? 'Online' : 'Offline'}</span></td>
        <td>${v.tracked ? fmt(v.range.coins) : dash}</td>
        <td>${v.tracked ? v.range.sales : dash}</td>
        <td>${v.tracked ? v.range.minutes : dash}</td>
        <td>${fmt(v.lifetime)}</td>
        <td>${sinceReset}</td>
        <td>${v.customers}</td>
      </tr>`;
  },

  async renderSalesReport() {
    const content = document.getElementById('page-content');
    const today = this.shopToday();
    if (!this._salesRange) this._salesRange = { from: today, to: today };
    const { from, to } = this._salesRange;

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${uiIcon('chart')} Sales Report</h3>
          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
            <input type="date" id="sales-from" class="form-control" style="width:auto" value="${from}">
            <span style="color:var(--text-muted)">to</span>
            <input type="date" id="sales-to" class="form-control" style="width:auto" value="${to}">
            <button class="btn btn-sm btn-primary" onclick="App.loadSalesReport()">Apply</button>
            <button class="btn btn-sm btn-outline" onclick="App.exportSalesCsv()">Export CSV</button>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" onclick="App.setSalesRange('today')">Today</button>
          <button class="btn btn-sm btn-outline" onclick="App.setSalesRange('7d')">Last 7 Days</button>
          <button class="btn btn-sm btn-outline" onclick="App.setSalesRange('30d')">Last 30 Days</button>
          <button class="btn btn-sm btn-outline" onclick="App.setSalesRange('month')">This Month</button>
        </div>
        <div id="sales-report-body"><div class="empty-state"><p>Loading...</p></div></div>
      </div>
    `;
    await this.loadSalesReport();
  },

  setSalesRange(kind) {
    // The report filters days on the shop clock, so these buttons have to name
    // the same days it does - the browser's UTC date would be a day off.
    const to = this.shopToday();
    let from = to;
    if (kind === '7d' || kind === '30d') {
      from = this.shopToday(kind === '7d' ? 6 : 29);
    } else if (kind === 'month') {
      from = to.slice(0, 8) + '01';
    }
    this._salesRange = { from, to };
    const f = document.getElementById('sales-from');
    const t = document.getElementById('sales-to');
    if (f) f.value = from;
    if (t) t.value = to;
    this.loadSalesReport();
  },

  async loadSalesReport() {
    const body = document.getElementById('sales-report-body');
    if (!body) return;
    const from = (document.getElementById('sales-from') || {}).value || '';
    const to = (document.getElementById('sales-to') || {}).value || '';
    this._salesRange = { from, to };
    body.innerHTML = '<div class="empty-state"><p>Loading sales data...</p></div>';

    let r;
    try {
      r = await api.getSalesReport(from, to);
    } catch (err) {
      body.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${this.escapeHtml(err.message)}</p></div>`;
      return;
    }
    this._salesReport = r;
    const fmt = (v) => this.formatMoney(v);
    const esc = (v) => this.escapeHtml(String(v == null ? '' : v));

    const vendoRows = (r.vendo.devices || []).map((d) => this.salesVendoRow(d)).join('');

    const voucherRows = (r.vouchers.rows || []).map((v) => `
      <tr>
        <td><code>${esc(v.code)}</code></td>
        <td>${esc(v.profile)}</td>
        <td>${fmt(v.price)}</td>
        <td>${v.duration_minutes == null ? '—' : v.duration_minutes}</td>
        <td>${esc(this.shopTime(v.used_at))}</td>
        <td>${esc(v.router_name || v.router_id)}</td>
      </tr>`).join('');

    const gcashRows = (r.gcash.rows || []).map((p) => `
      <tr>
        <td><code>${esc(p.reference)}</code></td>
        <td>${esc(p.mac_address)}</td>
        <td>${fmt(p.amount)}</td>
        <td>${p.minutes}</td>
        <td>${esc(this.shopTime(p.paid_at))}</td>
      </tr>`).join('');

    const airCoins = r.aircoins || { count: 0, amount: 0, minutes: 0, unassignedCount: 0, unassignedAmount: 0, failedCount: 0, rows: [] };
    // One coin slot is one sale. The transaction id is minted when the first
    // coin lands and every coin after it is totalled onto the same row, so this
    // table shows what each customer paid - not what each handful bought.
    const airCoinsRows = (airCoins.rows || []).map((sale) => `
      <tr>
        <td>${esc(sale.deviceName)}</td>
        <td>${sale.txnId ? `<code>${esc(sale.txnId)}</code>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${sale.mac ? esc(sale.mac) : '<span class="status-badge disconnected">unassigned</span>'}</td>
        <td>${fmt(sale.coins)}</td>
        <td>${sale.minutes}</td>
        <td>${esc(sale.status)}</td>
        <td>${esc(this.shopTime(sale.createdAt))}</td>
        <td style="text-align:right"><button class="btn btn-sm btn-outline" onclick="App.deleteAirCoinsSale(${Number(sale.id)})">Delete</button></td>
      </tr>`).join('');

    body.innerHTML = `
      <div class="overview-grid">
        <div class="dash-card">
          <div class="dash-card-title">Voucher Sales (range)</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(r.totals.voucherSales)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">${r.vouchers.count} redeemed · ${r.vouchers.generatedCount} generated (${fmt(r.vouchers.generatedAmount)})</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">GCash / Online (range)</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(r.totals.gcashSales)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">${r.gcash.count} paid payments</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Sub-Vendo Coins</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(r.totals.vendoLifetimeCoins)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">lifetime · ${fmt(r.vendo.rangeCoins)} sold in range (${r.vendo.rangeSales} sale${r.vendo.rangeSales === 1 ? '' : 's'}) · ${r.vendo.rangeMinutes} minutes · ${r.vendo.customerCount} customers · ${r.vendo.onlineCount}/${r.vendo.deviceCount} online</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">AirCoins Coins (range)</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(airCoins.amount)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">${airCoins.count} sale(s) · ${Math.round((airCoins.minutes || 0) / 60)} hours credited${airCoins.unassignedCount ? ` · ${airCoins.unassignedCount} unassigned (${fmt(airCoins.unassignedAmount)})` : ''}${airCoins.failedCount ? ` · ${airCoins.failedCount} not credited yet` : ''}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Total Sales (range)</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(r.totals.periodTotal)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">Vouchers + GCash + AirCoins coins within ${esc(r.from)} → ${esc(r.to)}</div>
        </div>
      </div>
      <p style="color:var(--text-muted);font-size:0.8125rem;margin:0.75rem 0">
        Sold in range counts the coins each machine took inside the selected dates (1 coin = ${fmt(1)}).
        AirCoins boxes report into the panel, so their sales are date-filtered like vouchers and GCash;
        JuanFi machines keep their counters on the board, so their revenue is the Lifetime / Since Reset columns,
        which are not affected by the date range.
        AirCoins takings also appear in the AirCoins Coin Sales card below - the two are the same money, not a sum.
      </p>

      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3>${uiIcon('store')} Sub-Vendo / NodeMCU Sales</h3></div>
        ${r.vendo.devices.length ? `
        <table class="table">
          <thead><tr><th>Device</th><th>IP</th><th>Type</th><th>Status</th><th>Sold (range)</th><th>Sales</th><th>Minutes</th><th>Lifetime</th><th>Since Reset</th><th>Customers</th></tr></thead>
          <tbody>${vendoRows}</tbody>
        </table>` : '<div class="empty-state"><p>No sub-vendo devices configured. Add them under SubVendo → Sub-Vendo Devices.</p></div>'}
      </div>

      <div class="card" style="margin-top:1rem">
        <div class="card-header">
          <h3>${uiIcon('store')} AirCoins Coin Sales</h3>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <span class="status-badge connected">${airCoins.count} · ${fmt(airCoins.amount)}</span>
            ${airCoins.rows.length ? `<button class="btn btn-sm btn-outline" onclick="App.deleteAllAirCoinsSales()">Delete All (${esc(r.from)} → ${esc(r.to)})</button>` : ''}
          </div>
        </div>
        ${airCoinsRows ? `
        <table class="table">
          <thead><tr><th>Device</th><th>Txn</th><th>Credited to</th><th>Coins</th><th>Minutes</th><th>Status</th><th>When (UTC+8)</th><th></th></tr></thead>
          <tbody>${airCoinsRows}</tbody>
        </table>
        <p style="color:var(--text-muted);font-size:0.75rem;margin:0.5rem 0 0">
          One row per coin slot: the transaction id is minted when the first coin lands and
          every coin fed after it is totalled onto that row, so the coins and minutes shown
          are what that customer paid for in one go.
        </p>` : '<div class="empty-state"><p>No AirCoins coin sales in this range.</p></div>'}
      </div>

      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3>${uiIcon('ticket')} Redeemed Vouchers</h3><span class="status-badge connected">${r.vouchers.count} · ${fmt(r.vouchers.amount)}</span></div>
        ${voucherRows ? `
        <table class="table">
          <thead><tr><th>Code</th><th>Profile</th><th>Price</th><th>Minutes</th><th>Used At (UTC+8)</th><th>Router</th></tr></thead>
          <tbody>${voucherRows}</tbody>
        </table>` : '<div class="empty-state"><p>No vouchers redeemed in this range.</p></div>'}
      </div>

      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3>${uiIcon('card')} GCash / Online Payments</h3><span class="status-badge connected">${r.gcash.count} · ${fmt(r.gcash.amount)}</span></div>
        ${gcashRows ? `
        <table class="table">
          <thead><tr><th>Reference</th><th>MAC</th><th>Amount</th><th>Minutes</th><th>Paid At (UTC+8)</th></tr></thead>
          <tbody>${gcashRows}</tbody>
        </table>` : '<div class="empty-state"><p>No paid online payments in this range.</p></div>'}
      </div>
    `;
  },

  // Delete one coin sale from the ledger - a test sale or a mis-punch. Only the
  // report row goes: the customer keeps the time that was already credited.
  async deleteAirCoinsSale(id) {
    if (!Number.isFinite(id) || id <= 0) return;
    if (!confirm('Delete this coin sale from the sales report? The customer keeps the time already credited.')) return;
    try {
      const res = await api.deleteAirCoinsSale(id);
      if (!res.deleted) { this.toast('That sale is already gone', 'info'); return; }
      this.toast('Sale deleted', 'success');
      this.loadSalesReport();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // Clear every coin sale inside the range the report is showing; rows outside
  // it are untouched, which is why the button names the dates.
  async deleteAllAirCoinsSales() {
    const { from, to } = this._salesRange || {};
    const label = from && to ? (from === to ? from : `${from} → ${to}`) : 'today';
    if (!confirm(`Delete every AirCoins coin sale from ${label}? Customers keep the time already credited, and this cannot be undone.`)) return;
    try {
      const res = await api.deleteAirCoinsSales(from, to);
      if (!res.deleted) { this.toast('No coin sales in this range', 'info'); return; }
      this.toast(`${res.deleted} coin sale${res.deleted === 1 ? '' : 's'} deleted`, 'success');
      this.loadSalesReport();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  exportSalesCsv() {
    const r = this._salesReport;
    if (!r) { this.toast('Load a report first', 'error'); return; }
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [];
    lines.push(['SALES REPORT', r.from, r.to].map(q).join(','));
    lines.push('');
    lines.push(['SUMMARY', 'Count', 'Amount'].map(q).join(','));
    lines.push(['Voucher sales (redeemed in range)', r.vouchers.count, r.vouchers.amount].map(q).join(','));
    lines.push(['GCash / online (paid in range)', r.gcash.count, r.gcash.amount].map(q).join(','));
    lines.push(['AirCoins coins (sold in range)', (r.aircoins || {}).count || 0, (r.aircoins || {}).amount || 0].map(q).join(','));
    lines.push(['AirCoins coins (no PC to credit)', (r.aircoins || {}).unassignedCount || 0, (r.aircoins || {}).unassignedAmount || 0].map(q).join(','));
    lines.push(['AirCoins credits that did not go through', (r.aircoins || {}).failedCount || 0, ''].map(q).join(','));
    lines.push(['Total sales in range', '', r.totals.periodTotal].map(q).join(','));
    lines.push(['Sub-vendo lifetime coins', '', r.totals.vendoLifetimeCoins].map(q).join(','));
    lines.push(['Sub-vendo coins since reset', '', r.totals.vendoCurrentCoins].map(q).join(','));
    lines.push(['Sub-vendo coins sold in range', r.vendo.rangeSales || 0, r.vendo.rangeCoins || 0].map(q).join(','));
    lines.push('');
    lines.push(['SUB-VENDO DEVICES', 'IP', 'Type', 'Status', 'Sold (range)', 'Sales (range)', 'Minutes (range)', 'Lifetime Coins', 'Since Reset', 'Customers'].map(q).join(','));
    (r.vendo.devices || []).forEach((d) => {
      const v = this.salesVendoView(d);
      lines.push([
        d.name,
        d.ip,
        v.airCoinsBox ? 'aircoins' : 'juanfi',
        d.online ? 'online' : 'offline',
        v.tracked ? v.range.coins : '',
        v.tracked ? v.range.sales : '',
        v.tracked ? v.range.minutes : '',
        v.lifetime,
        v.sinceReset === null ? '' : v.sinceReset,
        v.customers,
      ].map(q).join(','));
    });
    lines.push('');
    lines.push(['REDEEMED VOUCHERS', 'Profile', 'Price', 'Minutes', 'Used At (UTC+8)', 'Router'].map(q).join(','));
    (r.vouchers.rows || []).forEach((v) => {
      lines.push([v.code, v.profile, v.price, v.duration_minutes, this.shopTime(v.used_at), v.router_name || v.router_id].map(q).join(','));
    });
    lines.push('');
    lines.push(['AIRCOINS COIN SALES', 'Txn', 'Credited To', 'Coins', 'Minutes', 'Status', 'When (UTC+8)'].map(q).join(','));
    ((r.aircoins || {}).rows || []).forEach((sale) => {
      lines.push([
        sale.deviceName, sale.txnId || sale.sessionId || '', sale.mac || 'unassigned',
        sale.coins, sale.minutes, sale.status, this.shopTime(sale.createdAt),
      ].map(q).join(','));
    });
    lines.push('');
    lines.push(['GCASH PAYMENTS', 'MAC', 'Amount', 'Minutes', 'Paid At (UTC+8)'].map(q).join(','));
    (r.gcash.rows || []).forEach((p) => {
      lines.push([p.reference, p.mac_address, p.amount, p.minutes, this.shopTime(p.paid_at)].map(q).join(','));
    });

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sales-report_${r.from}_to_${r.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  },

  // ---- Customer Wallet (staff side) ----
  // Money here is real: the only way it enters a wallet is coins the controller
  // counted itself, and the only way it leaves is time handed to a device. Staff
  // can also move it by hand, which is why every such move needs a reason and
  // lands in the same append-only ledger the customer sees.
  _walletTab: 'customers',
  _walletSearch: '',
  _walletNeedsCleanup: true,

  async renderWallet() {
    const content = document.getElementById('page-content');
    const tab = ['customers', 'topups', 'settings'].includes(this._walletTab) ? this._walletTab : 'customers';

    let s = { accounts: 0, total_balance: 0, credited_today: 0, spent_today: 0, minutes_sold_today: 0, router_cleanup_pending: 0 };
    try {
      s = await api.getWalletSummary();
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><h3>Wallet unavailable</h3><p>${this.escapeHtml(err.message)}</p></div>`;
      return;
    }
    const fmt = (v) => this.formatMoney(v);

    content.innerHTML = `
      <div class="overview-grid">
        <div class="dash-card">
          <div class="dash-card-title">Wallet Accounts</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${s.accounts}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">${s.router_cleanup_pending ? s.router_cleanup_pending + ' machine account(s) to clean' : 'no router cleanup pending'}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Cash Held for Customers</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(s.total_balance)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">total unpaid balance across all wallets</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Coins Loaded Today</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(s.credited_today)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">credited into wallets (UTC+8 day)</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Spent on Time Today</div>
          <div style="font-size:1.5rem;font-weight:650;margin-top:0.25rem">${fmt(s.spent_today)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;margin-top:0.25rem">${s.minutes_sold_today} minute(s) sold from balances</div>
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <div class="card-header"><h3>${uiIcon('user')} Customers</h3></div>
        <div class="tabs">
          <button class="tab ${tab === 'customers' ? 'active' : ''}" data-wtab="customers">Wallets</button>
          <button class="tab ${tab === 'topups' ? 'active' : ''}" data-wtab="topups">Coin Sessions</button>
          <button class="tab ${tab === 'settings' ? 'active' : ''}" data-wtab="settings">Settings</button>
        </div>
        <div id="wallet-tab-content">Loading...</div>
      </div>
    `;

    document.querySelectorAll('[data-wtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._walletTab = btn.dataset.wtab;
        document.querySelectorAll('[data-wtab]').forEach((t) => t.classList.remove('active'));
        btn.classList.add('active');
        this.loadWalletTab();
      });
    });
    await this.loadWalletTab();
  },

  async loadWalletTab() {
    const box = document.getElementById('wallet-tab-content');
    if (!box) return;
    box.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';
    try {
      if (this._walletTab === 'topups') await this.loadWalletTopups(box);
      else if (this._walletTab === 'settings') await this.loadWalletSettings(box);
      else await this.loadWalletCustomers(box);
    } catch (err) {
      box.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${this.escapeHtml(err.message)}</p></div>`;
    }
  },

  async loadWalletCustomers(box) {
    const esc = (v) => this.escapeHtml(String(v == null ? '' : v));
    const fmt = (v) => this.formatMoney(v);
    const data = await api.getWalletAccounts(this._walletSearch);
    const rows = data.accounts || [];
    box.innerHTML = `
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
        <input id="wallet-search" class="form-control" style="max-width:320px" placeholder="name, email, mobile or MAC" value="${esc(this._walletSearch)}">
        <button class="btn btn-primary btn-sm" onclick="App.searchWallets()">${uiIcon('search')} Search</button>
      </div>
      ${rows.length ? `
      <table class="table">
        <thead><tr><th>Customer</th><th>Contact</th><th>Balance</th><th>Entries</th><th>Status</th><th>Last Seen</th><th></th></tr></thead>
        <tbody>${rows.map((a) => `
          <tr>
            <td><strong>${esc(a.full_name) || '<span style="color:var(--text-muted)">(no name)</span>'}</strong><div style="font-size:0.8125rem;color:var(--text-muted)">${esc(a.email)}</div></td>
            <td style="font-size:0.8125rem">${esc(a.mobile) || '—'}<div style="color:var(--text-muted)">${esc(a.last_mac || a.registered_mac || '')}</div></td>
            <td><strong>${fmt(a.balance)}</strong></td>
            <td>${a.tx_count}</td>
            <td><span class="status-badge ${a.status === 'active' ? 'connected' : 'disconnected'}">${esc(a.status)}</span>${a.verified ? '' : ' <span class="status-badge disconnected">unverified</span>'}</td>
            <td style="font-size:0.8125rem;color:var(--text-muted)">${esc(this.shopTime(a.last_login_at || a.created_at))}</td>
            <td><button class="btn btn-outline btn-sm" onclick="App.openWalletAccount(${a.id})">Open</button></td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty-state"><p>No wallet accounts yet. Customers create their own on the portal, or register one for them there.</p></div>'}
    `;
  },

  searchWallets() {
    this._walletSearch = ((document.getElementById('wallet-search') || {}).value || '').trim();
    this.loadWalletTab();
  },

  async openWalletAccount(id) {
    const esc = (v) => this.escapeHtml(String(v == null ? '' : v));
    const fmt = (v) => this.formatMoney(v);
    let d;
    try {
      d = await api.getWalletAccount(id);
    } catch (err) {
      this.toast(err.message, 'error');
      return;
    }
    const a = d.account;
    const kinds = {
      coin_topup: 'Coins loaded', time_purchase: 'Time purchased',
      admin_credit: 'Added by staff', admin_debit: 'Removed by staff',
    };

    const txRows = (d.transactions || []).slice(0, 40).map((t) => `
      <tr>
        <td style="font-size:0.8125rem">${esc(this.shopTime(t.created_at))}</td>
        <td>${esc(kinds[t.kind] || t.kind)}</td>
        <td style="text-align:right;color:${t.amount_centavos >= 0 ? 'var(--success)' : 'var(--danger)'}">${t.amount_centavos >= 0 ? '+' : '−'}${fmt(Math.abs(t.amount))}</td>
        <td style="text-align:right">${fmt(t.balance)}</td>
        <td style="font-size:0.8125rem">${t.minutes ? t.minutes + ' min' : ''} ${t.created_by !== 'portal' ? '<span style="color:var(--text-muted)">by ' + esc(t.created_by) + '</span>' : ''}</td>
      </tr>`).join('');

    const deviceRows = (d.devices || []).map((v) => `
      <tr><td><code>${esc(v.mac)}</code></td><td>${esc(v.router_id)}</td><td style="font-size:0.8125rem;color:var(--text-muted)">${esc(this.shopTime(v.first_seen))} → ${esc(this.shopTime(v.last_seen))}</td></tr>`).join('');

    const topupRows = (d.topups || []).slice(0, 12).map((t) => `
      <tr>
        <td><code>${esc(t.code)}</code></td>
        <td>${esc(t.device_name || t.device_ip)}</td>
        <td>${t.coins}</td>
        <td><span class="status-badge ${t.status === 'credited' ? 'connected' : (t.status === 'failed' ? 'disconnected' : '')}">${esc(t.status)}</span></td>
        <td>${t.cleanup_needed ? `<button class="btn btn-outline btn-sm" onclick="App.retryWalletCleanup(${t.id})">${uiIcon('refresh')} Clean router</button>` : ''}${t.cleanup_error ? `<div style="font-size:0.75rem;color:var(--danger)">${esc(t.cleanup_error)}</div>` : ''}</td>
      </tr>`).join('');

    this.openModal(`${a.full_name || a.email} — ${fmt(a.balance)}`, `
      <div style="font-size:0.875rem">
        <p style="margin:0 0 0.25rem"><strong>${esc(a.email)}</strong> · ${esc(a.mobile) || 'no mobile'} · PIN ${a.has_pin ? 'set' : 'not set'}</p>
        <p style="margin:0 0 0.25rem;color:var(--text-muted)">registered ${esc(this.shopTime(a.created_at))} · last login ${esc(a.last_login_at ? this.shopTime(a.last_login_at) : 'never')} · status ${esc(a.status)}</p>

        <div class="form-row" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;margin:0.75rem 0;padding:0.75rem;background:var(--bg-secondary, #f8fafc);border-radius:8px">
          <div style="flex:1;min-width:120px">
            <label style="font-size:0.75rem">Amount</label>
            <input id="wadj-amount" type="number" step="0.01" min="0" class="form-control" placeholder="0.00">
          </div>
          <div style="flex:2;min-width:180px">
            <label style="font-size:0.75rem">Reason (required, goes on the customer ledger)</label>
            <input id="wadj-reason" class="form-control" placeholder="e.g. change returned from machine">
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.walletAdjust(${a.id}, 'credit')">+ Add</button>
          <button class="btn btn-outline btn-sm" onclick="App.walletAdjust(${a.id}, 'debit')">− Deduct</button>
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
          <button class="btn btn-outline btn-sm" onclick="App.walletSetStatus(${a.id}, '${a.status === 'active' ? 'frozen' : 'active'}')">${a.status === 'active' ? uiIcon('lock') + ' Freeze' : uiIcon('power') + ' Activate'}</button>
          <button class="btn btn-outline btn-sm" onclick="App.walletResetPassword(${a.id})">${uiIcon('key')} New Password</button>
        </div>

        ${d.open_code ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.8125rem">
          Pending restore/verification code <strong>${esc(d.open_code.purpose)}</strong> for ${esc(d.open_code.device_mac || 'any device')} — expires ${esc(this.shopTime(d.open_code.expires_at))}. Give it to the customer over the counter.
        </div>` : ''}

        <h4 style="margin:0.75rem 0 0.25rem">Ledger</h4>
        ${txRows ? `<table class="table"><thead><tr><th>When (UTC+8)</th><th>Kind</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th><th></th></tr></thead><tbody>${txRows}</tbody></table>` : '<p style="color:var(--text-muted)">No wallet activity.</p>'}

        <h4 style="margin:0.75rem 0 0.25rem">Coin Sessions</h4>
        ${topupRows ? `<table class="table"><thead><tr><th>Code</th><th>Machine</th><th>Coins</th><th>Status</th><th></th></tr></thead><tbody>${topupRows}</tbody></table>` : '<p style="color:var(--text-muted)">This customer has not loaded a wallet from a machine yet.</p>'}

        <h4 style="margin:0.75rem 0 0.25rem">Devices</h4>
        ${deviceRows ? `<table class="table"><thead><tr><th>MAC</th><th>Router</th><th>Seen</th></tr></thead><tbody>${deviceRows}</tbody></table>` : '<p style="color:var(--text-muted)">No linked devices.</p>'}
      </div>
    `, [{ label: 'Close', class: 'btn btn-outline', action: () => this.closeModal() }]);
  },

  async walletAdjust(id, action) {
    const amount = ((document.getElementById('wadj-amount') || {}).value || '').trim();
    const reason = ((document.getElementById('wadj-reason') || {}).value || '').trim();
    if (!amount || Number(amount) <= 0) { this.toast('Enter an amount greater than 0', 'error'); return; }
    if (reason.length < 3) { this.toast('A reason is required', 'error'); return; }
    if (!confirm(`${action === 'credit' ? 'Add' : 'Remove'} ${this.formatMoney(amount)} ${action === 'credit' ? 'to' : 'from'} this wallet?`)) return;
    try {
      const r = await api.adjustWallet(id, { action, amount: Number(amount), reason });
      this.toast(`${action === 'credit' ? 'Added' : 'Removed'} ${this.formatMoney(amount)} — balance ${this.formatMoney(r.balance)}`, 'success');
      this.openWalletAccount(id);
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async walletSetStatus(id, status) {
    try {
      await api.setWalletAccountStatus(id, status);
      this.toast(status === 'frozen' ? 'Account frozen and signed out' : 'Account activated', 'success');
      this.renderWallet();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  // The temporary password is generated server-side and shown once: the agent
  // reads it to the customer, nobody stores it.
  async walletResetPassword(id) {
    if (!confirm('Set a new temporary password for this account? Their current password stops working immediately.')) return;
    try {
      const r = await api.resetWalletPassword(id, '');
      this.openModal('Temporary password', `
        <p style="font-size:0.875rem">Hand this to the customer and tell them to change it after signing in:</p>
        <div style="font-size:1.5rem;letter-spacing:2px;font-weight:700;text-align:center;padding:0.75rem;background:var(--bg-secondary,#f8fafc);border-radius:8px"><code id="w-temp-pass">${this.escapeHtml(r.temporary_password)}</code></div>
        <button class="btn btn-outline btn-sm" style="margin-top:0.5rem" onclick="App.copyText(document.getElementById('w-temp-pass').textContent)">${uiIcon('copy')} Copy</button>
      `, [{ label: 'Done', class: 'btn btn-primary', action: () => this.closeModal() }]);
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async loadWalletTopups(box) {
    const esc = (v) => this.escapeHtml(String(v == null ? '' : v));
    const data = await api.getWalletTopups(this._walletNeedsCleanup);
    const rows = data.topups || [];
    box.innerHTML = `
      <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem">
        <label style="font-size:0.8125rem;display:flex;gap:0.4rem;align-items:center">
          <input type="checkbox" id="wallet-cleanup-only" ${this._walletNeedsCleanup ? 'checked' : ''} onchange="App.setWalletCleanupFilter(this.checked)">
          only sessions whose router account is still on the router
        </label>
      </div>
      <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 0.75rem">
        A wallet load settles the machine with /useVoucher, and that also makes the machine create a hotspot user named after the session code. That user is free internet nobody bought, so it is removed right after the credit. If the router was unreachable at that moment, clean it here.
      </p>
      ${rows.length ? `
      <table class="table">
        <thead><tr><th>Code</th><th>Customer</th><th>Machine</th><th>Coins</th><th>Status</th><th>Started (UTC+8)</th><th></th></tr></thead>
        <tbody>${rows.map((t) => `
          <tr>
            <td><code>${esc(t.code)}</code></td>
            <td style="font-size:0.8125rem">${esc(t.email || 'deleted account')}<div style="color:var(--text-muted)">${esc(t.client_mac || '')}</div></td>
            <td>${esc(t.device_name || t.device_ip)}</td>
            <td>${t.coins}</td>
            <td><span class="status-badge ${t.status === 'credited' ? 'connected' : (t.status === 'failed' ? 'disconnected' : '')}">${esc(t.status)}</span>${t.cleanup_needed ? ' <span class="status-badge disconnected">cleanup</span>' : ''}</td>
            <td style="font-size:0.8125rem;color:var(--text-muted)">${esc(this.shopTime(t.created_at))}</td>
            <td>${t.cleanup_needed ? `<button class="btn btn-outline btn-sm" onclick="App.retryWalletCleanup(${t.id})">${uiIcon('refresh')} Clean</button>` : ''}${t.cleanup_error ? `<div style="font-size:0.75rem;color:var(--danger)">${esc(t.cleanup_error)}</div>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty-state"><p>No coin sessions' + (this._walletNeedsCleanup ? ' need cleaning.' : ' yet.') + '</p></div>'}
    `;
  },

  setWalletCleanupFilter(checked) {
    this._walletNeedsCleanup = !!checked;
    this.loadWalletTab();
  },

  async retryWalletCleanup(id) {
    try {
      const r = await api.retryWalletTopupCleanup(id);
      if (r.ok) this.toast('Router account removed', 'success');
      else this.toast('Router still unreachable: ' + (r.error || 'unknown'), 'error');
    } catch (err) {
      this.toast(err.message, 'error');
      return;
    }
    // Refresh whatever list the button was on.
    if (this._walletTab === 'topups') this.loadWalletTab();
    else this.renderWallet();
  },

  async loadWalletSettings(box) {
    const s = await api.getWalletSettings();
    box.innerHTML = `
      <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 0.75rem">
        A coin counts as its peso value because the machine already prices coins against its own rate table. Time packages come from Online Payment → Payment Rates, so wallet prices always match the GCash prices.
      </p>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;max-width:760px">
        <label style="display:flex;gap:0.4rem;align-items:center;font-size:0.875rem;margin-bottom:0.75rem">
          <input type="checkbox" id="ws-enabled" ${s.enabled ? 'checked' : ''}> Wallet enabled on the portal
        </label>
        <label style="display:flex;gap:0.4rem;align-items:center;font-size:0.875rem;margin-bottom:0.75rem">
          <input type="checkbox" id="ws-verify" ${s.require_verification ? 'checked' : ''}> require an agent to confirm new accounts
        </label>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0.75rem;max-width:760px">
        <div><label style="font-size:0.75rem">Peso value of 1 coin</label><input id="ws-coin" type="number" step="0.01" min="0.01" class="form-control" value="${s.coin_value}"></div>
        <div><label style="font-size:0.75rem">Smallest load (peso)</label><input id="ws-min-topup" type="number" step="1" min="0" class="form-control" value="${s.min_topup}"></div>
        <div><label style="font-size:0.75rem">Largest load (peso)</label><input id="ws-max-topup" type="number" step="1" min="1" class="form-control" value="${s.max_topup}"></div>
        <div><label style="font-size:0.75rem">Smallest package to buy (peso)</label><input id="ws-min-convert" type="number" step="1" min="0" class="form-control" value="${s.min_convert}"></div>
        <div><label style="font-size:0.75rem">Daily spend limit per customer (0 = none)</label><input id="ws-daily" type="number" step="1" min="0" class="form-control" value="${s.daily_convert}"></div>
        <div><label style="font-size:0.75rem">Coin session length (minutes)</label><input id="ws-validity" type="number" step="1" min="1" max="240" class="form-control" value="${s.topup_validity_min}"></div>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:1rem" onclick="App.saveWalletSettings()">${uiIcon('save')} Save Wallet Settings</button>
    `;
  },

  async saveWalletSettings() {
    const val = (id) => ((document.getElementById(id) || {}).value || '').trim();
    const body = {
      enabled: !!(document.getElementById('ws-enabled') || {}).checked,
      require_verification: !!(document.getElementById('ws-verify') || {}).checked,
      coin_value: Number(val('ws-coin')),
      min_topup: Number(val('ws-min-topup')),
      max_topup: Number(val('ws-max-topup')),
      min_convert: Number(val('ws-min-convert')),
      daily_convert: Number(val('ws-daily')),
      topup_validity_min: Number(val('ws-validity')),
    };
    try {
      await api.updateWalletSettings(body);
      this.toast('Wallet settings saved', 'success');
      this.renderWallet();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  _nodemcuRefreshInterval: null,
  _nodemcuSelectedId: null,
  _nodemcuTab: 'dashboard',

  async renderNodeMcu(container, type) {
    const wanted = (type || this._nodemcuType) === 'aircoins' ? 'aircoins' : 'juanfi';
    this._nodemcuType = wanted;
    if (!container) container = document.getElementById('subvendo-tab-content');
    if (!container) return;

    // An AirCoins board runs no web server, so every "open the device" call the
    // JuanFi view makes ends in ECONNREFUSED. Its whole page is panel-owned.
    if (wanted === 'aircoins') { await this.renderAirCoinsConfig(container); return; }

    const data = await api.nodemcuListDevices();
    const devices = (data.devices || []).filter((d) => (d.firmwareType || 'juanfi') === wanted);
    this._nodemcuDevices = devices;

    if (devices.length === 0) {
      container.innerHTML = wanted === 'aircoins' ? `
        <div class="empty-state">
          <h3>No AirCoins sub-vendos configured</h3>
          <p>Add the machine, then flash the AirCoins firmware with the device key from its Configuration tab.</p>
          <button class="btn btn-primary" onclick="App.showAddNodeMcuDevice('aircoins')">Add AirCoins Vendo</button>
        </div>
      ` : `
        <div class="empty-state">
          <h3>No JuanFi sub-vendos configured</h3>
          <p>Add a JuanFi NodeMCU vending machine to manage it from this panel.</p>
          <button class="btn btn-primary" onclick="App.showAddNodeMcuDevice('juanfi')">Add Device</button>
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
          <h3>${wanted === 'aircoins' ? 'AirCoins Vending Machines' : 'Sub-Vendo Devices'}</h3>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <select id="nodemcu-device-select" class="btn btn-outline" onchange="App.selectNodeMcuDevice(this.value)">
              ${devices.map(d => `<option value="${d.id}" ${d.id === this._nodemcuSelectedId ? 'selected' : ''}>${this.escapeHtml(d.name)} (${this.escapeHtml(d.ip)})</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-primary" onclick="App.showAddNodeMcuDevice('${wanted}')">Add Device</button>
            <button class="btn btn-sm btn-outline" onclick="App.provisionSelectedNodeMcuDevice()">Register on Router</button>
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

  async showAddNodeMcuDevice(type) {
    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    const footer = document.getElementById('modal-footer');
    const routers = await api.getRouters();
    const connected = routers.filter((r) => r.connected);
    const firmware = type === 'aircoins' || (!type && this._subvendoType === 'aircoins') ? 'aircoins' : 'juanfi';

    title.textContent = 'Add Sub-Vendo (NodeMCU)';
    const formHtml = `
      <p style="font-size:.85rem;opacity:.8;margin-top:0">
        The machine is registered on the router as well: static address, hotspot
        login bypassed and allowed in the Walled Garden, so a customer can insert
        a coin before being logged in.
      </p>
      <div class="form-row">
        <label>Firmware</label>
        <select id="nd-firmware" class="form-control" onchange="App.toggleAddDeviceFirmware()">
          <option value="juanfi" ${firmware === 'juanfi' ? 'selected' : ''}>JuanFi (has its own admin page)</option>
          <option value="aircoins" ${firmware === 'aircoins' ? 'selected' : ''}>AirCoins (panel managed, no web UI)</option>
        </select>
      </div>
      <p id="nd-aircoins-note" style="display:none;font-size:.8rem;opacity:.75;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.6rem">
        AirCoins machines have no login page and no web interface. After adding one, copy its
        device key from the AirCoins Configuration tab and enter it in the firmware.
      </p>
      <div class="form-row"><label>Device Name</label><input id="nd-name" class="form-control" placeholder="e.g. Vendo 1"></div>
      <div class="form-row"><label>IP Address</label><input id="nd-ip" class="form-control" placeholder="10.0.0.243"></div>
      <div class="form-row">
        <label>Router</label>
        <select id="nd-router" class="form-control">
          ${connected.length
            ? connected.map((r) => `<option value="${r.id}" ${r.id === this.selectedRouterId ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`).join('')
            : '<option value="">No connected router</option>'}
        </select>
      </div>
      <div class="form-row">
        <label>MAC Address (optional)</label>
        <input id="nd-mac" class="form-control" placeholder="8C:AA:B5:00:00:00 - leave blank to detect on the router">
      </div>
      <div id="nd-credentials">
        <div class="form-row"><label>Admin Username</label><input id="nd-user" class="form-control" value="admin"></div>
        <div class="form-row"><label>Admin Password</label><input id="nd-pass" class="form-control" type="password"></div>
      </div>
    `;

    const showForm = () => {
      body.innerHTML = formHtml;
      this.toggleAddDeviceFirmware();
      footer.innerHTML = '';
      [
        { label: 'Cancel', cls: 'btn-outline', action: () => this.closeModal() },
        { label: 'Add Device', cls: 'btn-primary', action: async () => {
          const ip = document.getElementById('nd-ip').value.trim();
          const name = document.getElementById('nd-name').value.trim();
          if (!name || !ip) {
            this.toast('Device name and IP are required', 'error');
            return;
          }
          const btn = footer.querySelector('.btn-primary');
          if (btn) { btn.disabled = true; btn.textContent = 'Registering...'; }
          try {
            const res = await api.nodemcuAddDevice({
              name,
              ip,
              username: document.getElementById('nd-user') ? document.getElementById('nd-user').value : undefined,
              password: document.getElementById('nd-pass') ? document.getElementById('nd-pass').value : undefined,
              mac: document.getElementById('nd-mac').value.trim(),
              routerId: parseInt(document.getElementById('nd-router').value) || undefined,
              firmwareType: document.getElementById('nd-firmware').value,
            });
            if (res.device) {
              this._subvendoType = res.device.firmwareType === 'aircoins' ? 'aircoins' : 'juanfi';
              this._nodemcuSelectedId = res.device.id;
            }
            this._subvendoTab = 'config';
            await this.renderSubVendo();
            this.showProvisionResult(`Added ${res.device ? res.device.name : ip}`, res.provision, showForm);
          } catch (err) {
            this.toast('Failed: ' + err.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Add Device'; }
          }
        }},
      ].forEach(btn => {
        const el = document.createElement('button');
        el.className = `btn ${btn.cls}`;
        el.textContent = btn.label;
        el.addEventListener('click', btn.action);
        footer.appendChild(el);
      });
    };

    showForm();
    modal.classList.add('active');
  },

  // JuanFi boards are reached over their admin login; AirCoins boards are not
  // reachable that way at all, so the credentials are not asked for.
  toggleAddDeviceFirmware() {
    const select = document.getElementById('nd-firmware');
    if (!select) return;
    const aircoins = select.value === 'aircoins';
    const credentials = document.getElementById('nd-credentials');
    const note = document.getElementById('nd-aircoins-note');
    if (credentials) credentials.style.display = aircoins ? 'none' : '';
    if (note) note.style.display = aircoins ? '' : 'none';
  },

  /*
   * The four setup steps, one line each. A half-registered machine is the thing
   * that produces "coin slot is not available" on a device the panel calls
   * online, so show what the router accepted and what still needs attention.
   */
  showProvisionResult(heading, provision, onBack) {
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    const footer = document.getElementById('modal-footer');
    title.textContent = 'Sub-Vendo Registration';

    let detail = '';
    if (!provision) {
      detail = '<p style="font-size:.85rem;opacity:.8">Saved without router setup.</p>';
    } else if (provision.error) {
      detail = `<p style="color:#f44336;font-size:.85rem">Router setup could not run: ${this.escapeHtml(provision.error)}</p>`;
    } else {
      detail = (provision.steps || []).map((s) => `
        <div style="display:flex;gap:.5rem;align-items:flex-start;margin-bottom:.5rem">
          <span style="color:${s.ok ? '#4caf50' : '#ff9800'};font-weight:700">${s.ok ? '\u2713' : '!'}</span>
          <div>
            <div style="font-size:.9rem">${this.escapeHtml(s.label)}</div>
            <div style="font-size:.78rem;opacity:.75">${this.escapeHtml(s.detail)}</div>
          </div>
        </div>`).join('');
    }

    body.innerHTML = `
      <h4 style="margin-top:0">${this.escapeHtml(heading)}</h4>
      ${detail}
      <p style="font-size:.8rem;opacity:.7;margin-bottom:0">
        ${provision && provision.ok
          ? 'The machine can take coins now. Push the portal config to the router if this vendo must also appear on portals it serves itself.'
          : 'Fix what is listed above and run "Register on Router" again.'}
      </p>
    `;

    footer.innerHTML = '';
    const actions = [];
    // showForm() rebuilds both the body and the footer of the modal.
    if (onBack) actions.push({ label: 'Add another', cls: 'btn-outline', action: onBack });
    actions.push({ label: 'Done', cls: 'btn-primary', action: () => this.closeModal() });
    actions.forEach((a) => {
      const el = document.createElement('button');
      el.className = `btn ${a.cls}`;
      el.textContent = a.label;
      el.addEventListener('click', a.action);
      footer.appendChild(el);
    });
  },

  async provisionSelectedNodeMcuDevice() {
    const devices = this._nodemcuDevices || [];
    const device = devices.find(d => d.id === this._nodemcuSelectedId);
    if (!device) return;

    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    title.textContent = 'Sub-Vendo Registration';
    body.innerHTML = '<div class="empty-state"><p>Applying router setup...</p></div>';
    modal.classList.add('active');

    try {
      const res = await api.nodemcuProvisionDevice(device.id, { routerId: device.routerId });
      this.showProvisionResult(`${device.name} (${device.ip})`, res.provision);
      this.renderNodeMcu(document.getElementById('subvendo-tab-content'), this._nodemcuType);
    } catch (err) {
      body.innerHTML = `<p style="color:#f44336">Failed: ${this.escapeHtml(err.message)}</p>`;
    }
  },

  showEditNodeMcuDevice() {
    const devices = this._nodemcuDevices || [];
    const device = devices.find(d => d.id === this._nodemcuSelectedId);
    if (!device) return;

    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    title.textContent = 'Edit NodeMCU Device';
    const firmware = device.firmwareType === 'aircoins' ? 'aircoins' : 'juanfi';
    body.innerHTML = `
      <div class="form-row"><label>Device Name</label><input id="nd-name" class="form-control" value="${this.escapeHtml(device.name)}"></div>
      <div class="form-row"><label>IP Address</label><input id="nd-ip" class="form-control" value="${this.escapeHtml(device.ip)}"></div>
      <div class="form-row">
        <label>Firmware</label>
        <select id="nd-firmware" class="form-control">
          <option value="juanfi" ${firmware === 'juanfi' ? 'selected' : ''}>JuanFi (has its own admin page)</option>
          <option value="aircoins" ${firmware === 'aircoins' ? 'selected' : ''}>AirCoins (panel managed, no web UI)</option>
        </select>
      </div>
      <p style="font-size:.8rem;opacity:.75">Changing the firmware type moves this machine to the other subpage and stops the panel from using the matching settings.</p>
      <div class="form-row">
        <label>Portal networks (VLANs)</label>
        <input id="nd-subnets" class="form-control" value="${(device.hotspotSubnets || []).map((s) => this.escapeHtml(s)).join(', ')}" placeholder="10.0.10.0/24, 10.0.20.0/24">
      </div>
      <p style="font-size:.8rem;opacity:.75">
        The hotspot subnets this machine serves, one per VLAN or SSID. A customer whose address falls inside
        one of them can only ever pay this vendo - the portal hides the others and the panel refuses them.
        Leave it empty to use the machine's own /24.
      </p>
      <div class="form-row"><label>Admin Username</label><input id="nd-user" class="form-control" value="${this.escapeHtml(device.username)}"></div>
      <div class="form-row"><label>Admin Password</label><input id="nd-pass" class="form-control" type="password" value="${this.escapeHtml(device.password)}"></div>
    `;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    const btns = [
      { label: 'Cancel', cls: 'btn-outline', action: () => this.closeModal() },
      { label: 'Save', cls: 'btn-primary', action: async () => {
        try {
          const firmwareType = document.getElementById('nd-firmware').value;
          const res = await api.nodemcuUpdateDevice(this._nodemcuSelectedId, {
            name: document.getElementById('nd-name').value,
            ip: document.getElementById('nd-ip').value,
            username: document.getElementById('nd-user').value,
            password: document.getElementById('nd-pass').value,
            firmwareType,
            hotspotSubnets: document.getElementById('nd-subnets').value,
          });
          this._subvendoType = res.device && res.device.firmwareType === 'aircoins' ? 'aircoins' : 'juanfi';
          this.closeModal();
          this.toast('Device updated', 'success');
          await this.renderSubVendo();
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
    const device = (this._nodemcuDevices || []).find(d => d.id === this._nodemcuSelectedId);
    const label = device ? `${device.name} (${device.ip})` : 'this device';
    if (!confirm(`Delete ${label}?\n\nThe panel forgets its settings and device key, so the machine stops selling and has to be paired again.`)) return;
    try {
      await api.nodemcuDeleteDevice(this._nodemcuSelectedId);
      this._nodemcuSelectedId = null;
      this.toast('Device deleted', 'success');
      // Reload the page the admin is on rather than the JuanFi list: an AirCoins
      // machine lives on one page that also has to drop the deleted row.
      await this.loadSubVendoTab();
    } catch (err) { this.toast('Failed: ' + err.message, 'error'); }
  },

  // ---------- Chat ----------
  async renderChat() {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="empty-state"><p>Loading conversations...</p></div>';

    let threads = [];
    try {
      threads = await api.getChatThreads();
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><p>Error: ${this.escapeHtml(err.message)}</p></div>`;
      return;
    }
    this._chatThreads = threads || [];
    this._chatSignature = '';

    content.innerHTML = `
      <div class="chat-layout">
        <div class="card chat-threads-card">
          <div class="chat-threads-head">
            <h3>${uiIcon('message')} Conversations</h3>
            <button class="btn btn-outline btn-sm" onclick="App.refreshChat()">${uiIcon('refresh')} Refresh</button>
          </div>
          <div class="chat-thread-list" id="chat-thread-list"></div>
        </div>
        <div class="card chat-convo-card" id="chat-convo"></div>
      </div>`;

    this.renderChatThreadList();

    const convo = document.getElementById('chat-convo');
    if (this._chatActiveId && this._chatThreads.some((t) => t.id === this._chatActiveId)) {
      await this.selectChatThread(this._chatActiveId, true);
    } else {
      this._chatActiveId = null;
      convo.innerHTML = `<div class="chat-panel-empty">${this._chatThreads.length
        ? 'Select a conversation to read messages.'
        : 'No conversations yet. Messages sent from the hotspot portal will appear here.'}</div>`;
    }

    this.startChatPollers();
  },

  renderChatThreadList() {
    const el = document.getElementById('chat-thread-list');
    if (!el) return;
    const threads = this._chatThreads || [];
    if (!threads.length) {
      el.innerHTML = '<div class="chat-panel-empty">No conversations yet.</div>';
      return;
    }
    el.innerHTML = threads.map((t) => `
      <div class="chat-thread ${t.id === this._chatActiveId ? 'active' : ''}" onclick="App.selectChatThread(${t.id})">
        <div class="chat-thread-avatar">${uiIcon('user')}</div>
        <div class="chat-thread-main">
          <div class="chat-thread-top">
            <span class="chat-thread-name">${this.escapeHtml(this.chatThreadLabel(t))}</span>
            <span class="chat-thread-time">${this.chatTime(t.last_message_at || t.created_at, true)}</span>
          </div>
          <div class="chat-thread-sub">${this.escapeHtml(t.router_name || (t.router_id ? `Router #${t.router_id}` : 'No router'))}</div>
          <div class="chat-thread-preview">${this.escapeHtml(t.last_preview || 'No messages yet')}</div>
        </div>
        ${t.unread_admin ? `<span class="chat-thread-unread">${t.unread_admin > 99 ? '99+' : t.unread_admin}</span>` : ''}
      </div>`).join('');
  },

  chatThreadLabel(thread) {
    const mac = thread.mac || '';
    if (mac.indexOf('ip:') === 0) return mac.slice(3);
    return mac || `Thread #${thread.id}`;
  },

  chatTime(value, withDate) {
    if (!value) return '';
    const iso = String(value).indexOf('T') === -1 ? String(value).replace(' ', 'T') + 'Z' : value;
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!withDate) return time;
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  },

  async selectChatThread(threadId, keepComposer) {
    const thread = (this._chatThreads || []).find((t) => t.id === threadId);
    if (!thread) return;
    this._chatActiveId = threadId;
    if (!keepComposer) {
      this._chatPendingImage = null;
      this._chatSignature = '';
    }
    this.renderChatThreadList();

    const convo = document.getElementById('chat-convo');
    if (!convo) return;
    convo.innerHTML = `
      <div class="chat-convo-head">
        <div class="chat-convo-title">
          <div class="chat-thread-avatar">${uiIcon('user')}</div>
          <div>
            <h3>${this.escapeHtml(this.chatThreadLabel(thread))}</h3>
            <span>${this.escapeHtml(thread.router_name || (thread.router_id ? `Router #${thread.router_id}` : 'No router'))}</span>
          </div>
        </div>
        <div class="chat-convo-actions">
          <button class="btn btn-outline btn-sm" onclick="App.deleteChatThread(${thread.id})">${uiIcon('trash')} Delete</button>
        </div>
      </div>
      <div class="chat-convo-body" id="chat-convo-body"></div>
      <div class="chat-composer">
        <div class="chat-attach-preview" id="chat-attach-preview">
          <img id="chat-attach-thumb" alt="Attachment preview">
          <span>Image ready to send</span>
          <button type="button" onclick="App.clearChatAttachment()" aria-label="Remove image">&times;</button>
        </div>
        <div class="chat-input-row">
          <button class="btn btn-outline" style="flex:0 0 auto;" onclick="document.getElementById('chat-admin-file').click()" title="Attach image">${uiIcon('paperclip')}</button>
          <textarea class="chat-textarea" id="chat-admin-textarea" rows="1" placeholder="Reply to this user..."></textarea>
          <button class="btn btn-primary" style="flex:0 0 auto;" onclick="App.sendAdminChat()">${uiIcon('arrow-up')} Send</button>
        </div>
        <input type="file" id="chat-admin-file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="App.handleAdminChatFile(event)">
      </div>`;

    const textarea = document.getElementById('chat-admin-textarea');
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendAdminChat();
        }
      });
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 110) + 'px';
      });
    }

    try {
      const res = await api.getChatMessages(threadId);
      this.paintChatMessages(res.messages || []);
      const local = (this._chatThreads || []).find((t) => t.id === threadId);
      if (local) local.unread_admin = 0;
      this.renderChatThreadList();
      this.refreshChatBadge();
    } catch (err) {
      const body = document.getElementById('chat-convo-body');
      if (body) body.innerHTML = `<div class="chat-panel-empty">Error: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  paintChatMessages(messages) {
    const body = document.getElementById('chat-convo-body');
    if (!body) return;
    if (!messages.length) {
      this._chatSignature = '0';
      body.innerHTML = '<div class="chat-panel-empty">No messages yet.</div>';
      return;
    }
    this._chatSignature = `${messages.length}:${messages[messages.length - 1].id}`;
    body.innerHTML = messages.map((m) => {
      const out = m.sender === 'admin';
      const content = m.image_path
        ? `<a href="${this.escapeHtml(m.image_path)}" target="_blank" rel="noopener"><img src="${this.escapeHtml(m.image_path)}" alt="Chat image"></a>`
        : this.escapeHtml(m.body);
      return `
        <div class="chat-row ${out ? 'out' : 'in'}">
          <div class="chat-bubble">${content}</div>
          <div class="chat-time">${out ? 'You' : 'User'} · ${this.chatTime(m.created_at, true)}</div>
        </div>`;
    }).join('');
    body.scrollTop = body.scrollHeight;
  },

  async refreshChat() {
    if (this.currentPage !== 'chat') return;
    try {
      this._chatThreads = await api.getChatThreads();
      this.renderChatThreadList();
      if (this._chatActiveId) {
        const res = await api.getChatMessages(this._chatActiveId);
        const messages = res.messages || [];
        const signature = messages.length ? `${messages.length}:${messages[messages.length - 1].id}` : '0';
        if (signature !== this._chatSignature) this.paintChatMessages(messages);
        const local = (this._chatThreads || []).find((t) => t.id === this._chatActiveId);
        if (local) local.unread_admin = 0;
      }
      this.refreshChatBadge();
    } catch (err) {
      this.toast('Failed to refresh chats: ' + err.message, 'error');
    }
  },

  async sendAdminChat() {
    if (!this._chatActiveId || this._chatSending) return;
    const textarea = document.getElementById('chat-admin-textarea');
    if (!textarea) return;

    this._chatSending = true;
    try {
      if (this._chatPendingImage) {
        await api.uploadChatImage(this._chatActiveId, this._chatPendingImage);
        this.clearChatAttachment();
      } else {
        const text = textarea.value.trim();
        if (!text) return;
        await api.sendChatMessage(this._chatActiveId, text);
        textarea.value = '';
        textarea.style.height = 'auto';
      }
      const res = await api.getChatMessages(this._chatActiveId);
      this.paintChatMessages(res.messages || []);
      await this.refreshChat();
    } catch (err) {
      this.toast('Failed to send: ' + err.message, 'error');
    } finally {
      this._chatSending = false;
    }
  },

  handleAdminChatFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      this.toast('Image is too large (max 10MB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => this.toast('Could not read that image', 'error');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => this.toast('Could not read that image', 'error');
      img.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            this.toast('Could not process that image', 'error');
            return;
          }
          this._chatPendingImage = blob;
          const preview = document.getElementById('chat-attach-preview');
          const thumb = document.getElementById('chat-attach-thumb');
          if (preview && thumb) {
            thumb.src = URL.createObjectURL(blob);
            preview.classList.add('show');
          }
        }, 'image/jpeg', 0.85);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  },

  clearChatAttachment() {
    const preview = document.getElementById('chat-attach-preview');
    const thumb = document.getElementById('chat-attach-thumb');
    if (thumb && thumb.src) URL.revokeObjectURL(thumb.src);
    if (thumb) thumb.removeAttribute('src');
    if (preview) preview.classList.remove('show');
    this._chatPendingImage = null;
  },

  async deleteChatThread(threadId) {
    if (!confirm('Delete this conversation and all of its messages? This cannot be undone.')) return;
    try {
      await api.deleteChatThread(threadId);
      if (this._chatActiveId === threadId) {
        this._chatActiveId = null;
        this._chatSignature = '';
      }
      this._chatThreads = (this._chatThreads || []).filter((t) => t.id !== threadId);
      this.renderChatThreadList();
      const convo = document.getElementById('chat-convo');
      if (convo && !this._chatActiveId) {
        convo.innerHTML = `<div class="chat-panel-empty">${this._chatThreads.length
          ? 'Select a conversation to read messages.'
          : 'No conversations yet. Messages sent from the hotspot portal will appear here.'}</div>`;
      }
      this.refreshChatBadge();
      this.toast('Conversation deleted', 'success');
    } catch (err) {
      this.toast('Failed to delete: ' + err.message, 'error');
    }
  },

  startChatPollers() {
    this.clearChatPollers();
    this._chatPollTimer = setInterval(() => {
      if (document.hidden || this.currentPage !== 'chat') return;
      this.refreshChat();
    }, 5000);
  },

  clearChatPollers() {
    if (this._chatPollTimer) {
      clearInterval(this._chatPollTimer);
      this._chatPollTimer = null;
    }
  },

  startChatNotifications() {
    if (this._chatNavTimer) clearInterval(this._chatNavTimer);
    this._chatNotifiedId = 0;
    this._chatBaselineSet = false;
    this.pollChatNotifications();
    this._chatNavTimer = setInterval(() => this.pollChatNotifications(), 10000);
  },

  stopChatNotifications() {
    if (this._chatNavTimer) {
      clearInterval(this._chatNavTimer);
      this._chatNavTimer = null;
    }
    this.updateChatBadge(0);
  },

  async pollChatNotifications() {
    try {
      const data = await api.getChatUnread();
      const unread = data.unread || 0;
      const lastId = data.last_id || 0;
      this.updateChatBadge(unread);
      if (!this._chatBaselineSet) {
        this._chatBaselineSet = true;
        this._chatNotifiedId = lastId;
        return;
      }
      if (lastId > this._chatNotifiedId) {
        this._chatNotifiedId = lastId;
        if (unread > 0 && this.currentPage !== 'chat') {
          this.toast('New chat message from a hotspot user', 'info');
        }
      }
    } catch (err) {
      // notifications are best-effort; ignore transient errors
    }
  },

  async refreshChatBadge() {
    try {
      const data = await api.getChatUnread();
      this.updateChatBadge(data.unread || 0);
      this._chatNotifiedId = Math.max(this._chatNotifiedId || 0, data.last_id || 0);
    } catch (err) {
      // ignore
    }
  },

  updateChatBadge(unread) {
    const badge = document.getElementById('chat-nav-badge');
    if (!badge) return;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.style.display = unread > 0 ? '' : 'none';
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

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
