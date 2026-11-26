class ApiClient {
  constructor() {
    this.baseUrl = '/api';
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  getToken() {
    return this.token;
  }

  async request(method, path, body = null) {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const options = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);

    if (response.status === 401) {
      this.setToken(null);
      window.location.reload();
      throw new Error('Unauthorized');
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  put(path, body) { return this.request('PUT', path, body); }
  delete(path) { return this.request('DELETE', path); }

  async login(username, password) {
    const data = await this.post('/auth/login', { username, password });
    this.setToken(data.token);
    return data;
  }

  async getMe() {
    return this.get('/auth/me');
  }

  async changePassword(currentPassword, newPassword) {
    return this.post('/auth/change-password', { currentPassword, newPassword });
  }

  async getRouters() {
    return this.get('/routers');
  }

  async getRouter(id) {
    return this.get(`/routers/${id}`);
  }

  async createRouter(router) {
    return this.post('/routers', router);
  }

  async updateRouter(id, router) {
    return this.put(`/routers/${id}`, router);
  }

  async deleteRouter(id) {
    return this.delete(`/routers/${id}`);
  }

  async connectRouter(id) {
    return this.post(`/routers/${id}/connect`);
  }

  async disconnectRouter(id) {
    return this.post(`/routers/${id}/disconnect`);
  }

  async getRouterStatus(id) {
    return this.get(`/routers/${id}/status`);
  }

  async getHotspotUsers(routerId) {
    return this.get(`/hotspot/router/${routerId}`);
  }

  async createHotspotUser(routerId, user) {
    return this.post(`/hotspot/router/${routerId}`, user);
  }

  async deleteHotspotUser(routerId, userId) {
    return this.delete(`/hotspot/router/${routerId}/${userId}`);
  }

  async getActiveConnections(routerId) {
    return this.get(`/hotspot/router/${routerId}/active`);
  }

  async getActiveDevices(routerId) {
    return this.get(`/hotspot/router/${routerId}/devices`);
  }

  async updateActiveDevice(routerId, deviceId, data) {
    return this.put(`/hotspot/router/${routerId}/devices/${deviceId}`, data);
  }

  async createActiveDevice(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/devices`, data);
  }

  async setActiveDeviceAccess(routerId, deviceId, mode) {
    return this.put(`/hotspot/router/${routerId}/devices/${deviceId}/access`, { mode });
  }

  async addActiveDeviceTime(routerId, deviceId, minutes) {
    return this.post(`/hotspot/router/${routerId}/devices/${deviceId}/extend`, { minutes });
  }

  async deleteActiveDevice(routerId, deviceId) {
    return this.delete(`/hotspot/router/${routerId}/devices/${deviceId}`);
  }

  async purgeLocalMacUsers(routerId) {
    return this.post(`/hotspot/router/${routerId}/purge-local-mac-users`);
  }

  async removeActiveConnection(routerId, activeId) {
    return this.delete(`/hotspot/router/${routerId}/active/${activeId}`);
  }

  async getHotspotProfiles(routerId) {
    return this.get(`/hotspot/router/${routerId}/profiles`);
  }

  async getAddressPools(routerId) {
    return this.get(`/hotspot/router/${routerId}/pools`);
  }

  async getHotspotHosts(routerId) {
    return this.get(`/hotspot/router/${routerId}/hosts`);
  }

  async getHotspotServers(routerId) {
    return this.get(`/hotspot/router/${routerId}/servers`);
  }

  async createHotspotServer(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/servers`, data);
  }

  async updateHotspotServer(routerId, serverId, data) {
    return this.put(`/hotspot/router/${routerId}/server/${serverId}`, data);
  }

  async deleteHotspotServer(routerId, serverId) {
    return this.delete(`/hotspot/router/${routerId}/server/${serverId}`);
  }

  async setupHotspot(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/setup`, data);
  }

  async getWalledGarden(routerId) {
    return this.get(`/hotspot/router/${routerId}/walled-garden`);
  }

  async createWalledGarden(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/walled-garden`, data);
  }

  async updateWalledGarden(routerId, entryId, data) {
    return this.put(`/hotspot/router/${routerId}/walled-garden/${entryId}`, data);
  }

  async deleteWalledGarden(routerId, entryId) {
    return this.delete(`/hotspot/router/${routerId}/walled-garden/${entryId}`);
  }

  async getDeviceSessions(routerId) {
    return this.get(`/hotspot/router/${routerId}/sessions`);
  }

  async deleteDeviceSession(routerId, sessionId) {
    return this.delete(`/hotspot/router/${routerId}/sessions/${sessionId}`);
  }

  async getHotspotCookie(routerId) {
    return this.get(`/hotspot/router/${routerId}/cookie`);
  }

  async setHotspotCookie(routerId, data) {
    return this.put(`/hotspot/router/${routerId}/cookie`, data);
  }

  async getHotspotCookies(routerId) {
    return this.get(`/hotspot/router/${routerId}/cookies`);
  }

  async deleteHotspotCookie(routerId, cookieId) {
    return this.delete(`/hotspot/router/${routerId}/cookie/${cookieId}`);
  }

  async getUserProfiles(routerId) {
    return this.get(`/hotspot/router/${routerId}/user-profiles`);
  }

  async createUserProfile(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/user-profiles`, data);
  }

  async updateUserProfile(routerId, profileId, data) {
    return this.put(`/hotspot/router/${routerId}/user-profile/${profileId}`, data);
  }

  async deleteUserProfile(routerId, profileId) {
    return this.delete(`/hotspot/router/${routerId}/user-profile/${profileId}`);
  }

  async getIpBindings(routerId) {
    return this.get(`/hotspot/router/${routerId}/ip-bindings`);
  }

  async createIpBinding(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/ip-bindings`, data);
  }

  async updateIpBinding(routerId, bindingId, data) {
    return this.put(`/hotspot/router/${routerId}/ip-binding/${bindingId}`, data);
  }

  async deleteIpBinding(routerId, bindingId) {
    return this.delete(`/hotspot/router/${routerId}/ip-binding/${bindingId}`);
  }

  async createHotspotProfile(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/profiles`, data);
  }

  async updateHotspotProfile(routerId, profileId, data) {
    return this.put(`/hotspot/router/${routerId}/profile/${profileId}`, data);
  }

  async deleteHotspotProfile(routerId, profileId) {
    return this.delete(`/hotspot/router/${routerId}/profile/${profileId}`);
  }

  async deleteIpBinding(routerId, bindingId) {
    return this.delete(`/hotspot/router/${routerId}/ip-binding/${bindingId}`);
  }

  async getVouchers(routerId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.get(`/vouchers/router/${routerId}${query ? '?' + query : ''}`);
  }

  async generateVouchers(routerId, options) {
    return this.post(`/vouchers/router/${routerId}/generate`, options);
  }

  async deleteVoucher(routerId, voucherId) {
    return this.delete(`/vouchers/router/${routerId}/${voucherId}`);
  }

  async getMonitoringSummary() {
    return this.get('/monitoring/summary');
  }

  async getRouterSystemInfo(routerId) {
    return this.get(`/monitoring/router/${routerId}/system`);
  }

  async getRouterInterfaces(routerId) {
    return this.get(`/monitoring/router/${routerId}/interfaces`);
  }

  async getMonitoringHistory(routerId, hours = 24) {
    return this.get(`/monitoring/router/${routerId}/history?hours=${hours}`);
  }

  async getSystemInfo() {
    return this.get('/monitoring/system');
  }

  async getRouterTraffic(routerId) {
    return this.get(`/monitoring/router/${routerId}/traffic`);
  }

  async getPortalFiles(folder = 'hotspot') {
    return this.get(`/portal?folder=${encodeURIComponent(folder)}`);
  }

  async getPortalFile(name, folder = 'hotspot') {
    return this.get(`/portal/file/${encodeURIComponent(name)}?folder=${encodeURIComponent(folder)}`);
  }

  async savePortalFile(name, content, folder = 'hotspot') {
    return this.put(`/portal/file/${encodeURIComponent(name)}?folder=${encodeURIComponent(folder)}`, { content });
  }

  async resetPortalFile(name, folder = 'hotspot') {
    return this.post(`/portal/reset/${encodeURIComponent(name)}?folder=${encodeURIComponent(folder)}`);
  }

  async pushPortalFile(routerId, filePath, folder = 'hotspot') {
    return this.post(`/portal/push-file/${routerId}`, { file: filePath, folder });
  }

  async pushPortalFiles(routerId, folder = 'hotspot') {
    return this.post(`/portal/push/${routerId}`, { folder });
  }

  async getSubVendoConfig() {
    return this.get('/subvendo/config');
  }

  async saveSubVendoConfig(data) {
    return this.put('/subvendo/config', data);
  }

  async pushSubVendoConfig(routerId) {
    return this.post(`/subvendo/push/${routerId}`, {});
  }

  // NodeMCU devices
  async nodemcuListDevices() {
    return this.get('/nodemcu/devices');
  }

  async nodemcuAddDevice(data) {
    return this.post('/nodemcu/devices', data);
  }

  async nodemcuProvisionDevice(id, data) {
    return this.post(`/nodemcu/devices/${id}/provision`, data || {});
  }

  async nodemcuUpdateDevice(id, data) {
    return this.put(`/nodemcu/devices/${id}`, data);
  }

  async nodemcuDeleteDevice(id) {
    return this.delete(`/nodemcu/devices/${id}`);
  }

  // AirCoins sub-vendos: the machine has no web UI, so all of its settings are
  // read from and written to the panel.
  async nodemcuGetAirCoins(id) {
    return this.get(`/nodemcu/devices/${id}/aircoins`);
  }

  async nodemcuSaveAirCoins(id, data) {
    return this.put(`/nodemcu/devices/${id}/aircoins`, data);
  }

  async nodemcuRotateAirCoinsKey(id) {
    return this.post(`/nodemcu/devices/${id}/aircoins/key`, {});
  }

  async nodemcuAirCoinsCommand(id, command) {
    return this.post(`/nodemcu/devices/${id}/aircoins/command`, { command });
  }

  // Pairing: a new vendo waits on its own access point until the panel accepts it.
  async nodemcuAirCoinsClaims() {
    return this.get('/nodemcu/aircoins/claims');
  }

  async nodemcuApproveAirCoinsClaim(id, data) {
    return this.post(`/nodemcu/aircoins/claims/${id}/approve`, data || {});
  }

  async nodemcuRejectAirCoinsClaim(id) {
    return this.post(`/nodemcu/aircoins/claims/${id}/reject`, {});
  }

  async nodemcuDashboard(id) {
    return this.get(`/nodemcu/devices/${id}/dashboard`);
  }

  async nodemcuGetConfig(id) {
    return this.get(`/nodemcu/devices/${id}/config`);
  }

  async nodemcuSaveConfig(id, config) {
    return this.put(`/nodemcu/devices/${id}/config`, config);
  }

  async nodemcuGetRates(id) {
    return this.get(`/nodemcu/devices/${id}/rates`);
  }

  async nodemcuSaveRates(id, rates) {
    return this.put(`/nodemcu/devices/${id}/rates`, { rates });
  }

  async nodemcuRestart(id) {
    return this.post(`/nodemcu/devices/${id}/restart`);
  }

  async nodemcuRestartMikrotik(id) {
    return this.post(`/nodemcu/devices/${id}/restart-mikrotik`);
  }

  async nodemcuResetStats(id, type) {
    return this.post(`/nodemcu/devices/${id}/reset-stats`, { type });
  }

  async nodemcuToggleNightLight(id) {
    return this.post(`/nodemcu/devices/${id}/toggle-night-light`);
  }

  async nodemcuGenerateVouchers(id, amount, qty, prefix, addToSales) {
    return this.post(`/nodemcu/devices/${id}/generate-vouchers`, { amount, qty, prefix, addToSales });
  }

  async nodemcuScanSSID(id) {
    return this.post(`/nodemcu/devices/${id}/scan-ssid`);
  }

  async nodemcuGetActiveUsers(id) {
    return this.get(`/nodemcu/devices/${id}/active-users`);
  }

  async nodemcuKickUser(id, macAddress) {
    return this.post(`/nodemcu/devices/${id}/kick-user`, { macAddress });
  }

  async nodemcuGetSales(id) {
    return this.get(`/nodemcu/devices/${id}/sales`);
  }

  async nodemcuGetLogs(id) {
    return this.get(`/nodemcu/devices/${id}/logs`);
  }

  async nodemcuPing(id) {
    return this.get(`/nodemcu/devices/${id}/ping`);
  }

  // --- Interfaces ---
  async getInterfaces(routerId) {
    return this.get(`/interfaces/router/${routerId}/interfaces`);
  }
  async updateInterface(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/interface/${id}`, data);
  }

  async getInterfaceLists(routerId) {
    return this.get(`/interfaces/router/${routerId}/interface-lists`);
  }
  async createInterfaceList(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/interface-list`, data);
  }
  async updateInterfaceList(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/interface-list/${id}`, data);
  }
  async deleteInterfaceList(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/interface-list/${id}`);
  }

  async getEthernets(routerId) {
    return this.get(`/interfaces/router/${routerId}/ethernet`);
  }
  async updateEthernet(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/ethernet/${id}`, data);
  }

  async getVlans(routerId) {
    return this.get(`/interfaces/router/${routerId}/vlans`);
  }
  async createVlan(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/vlan`, data);
  }
  async updateVlan(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/vlan/${id}`, data);
  }
  async deleteVlan(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/vlan/${id}`);
  }

  async getBridges(routerId) {
    return this.get(`/interfaces/router/${routerId}/bridges`);
  }
  async createBridge(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/bridge`, data);
  }
  async updateBridge(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/bridge/${id}`, data);
  }
  async deleteBridge(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/bridge/${id}`);
  }

  async getEoIPs(routerId) {
    return this.get(`/interfaces/router/${routerId}/eoip`);
  }
  async createEoIP(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/eoip`, data);
  }
  async updateEoIP(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/eoip/${id}`, data);
  }
  async deleteEoIP(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/eoip/${id}`);
  }

  async getIpTunnels(routerId) {
    return this.get(`/interfaces/router/${routerId}/ip-tunnels`);
  }
  async createIpTunnel(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/ip-tunnel`, data);
  }
  async updateIpTunnel(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/ip-tunnel/${id}`, data);
  }
  async deleteIpTunnel(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/ip-tunnel/${id}`);
  }

  async getGREs(routerId) {
    return this.get(`/interfaces/router/${routerId}/gre`);
  }
  async createGRE(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/gre`, data);
  }
  async updateGRE(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/gre/${id}`, data);
  }
  async deleteGRE(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/gre/${id}`);
  }

  async getVRRPs(routerId) {
    return this.get(`/interfaces/router/${routerId}/vrrp`);
  }
  async createVRRP(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/vrrp`, data);
  }
  async updateVRRP(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/vrrp/${id}`, data);
  }
  async deleteVRRP(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/vrrp/${id}`);
  }

  async getBondings(routerId) {
    return this.get(`/interfaces/router/${routerId}/bonding`);
  }
  async createBonding(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/bonding`, data);
  }
  async updateBonding(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/bonding/${id}`, data);
  }
  async deleteBonding(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/bonding/${id}`);
  }

  async getMACsecs(routerId) {
    return this.get(`/interfaces/router/${routerId}/macsec`);
  }
  async createMACsec(routerId, data) {
    return this.post(`/interfaces/router/${routerId}/macsec`, data);
  }
  async updateMACsec(routerId, id, data) {
    return this.put(`/interfaces/router/${routerId}/macsec/${id}`, data);
  }
  async deleteMACsec(routerId, id) {
    return this.delete(`/interfaces/router/${routerId}/macsec/${id}`);
  }

  // --- RADIUS ---
  async getRadiusStatus() {
    return this.get('/routers/radius/status');
  }

  async regenerateRadiusSecret(routerId) {
    return this.post(`/routers/${routerId}/radius/regenerate-secret`);
  }

  async testRadiusConnectivity(routerId) {
    return this.post(`/routers/${routerId}/radius/test`);
  }

  async getRadiusLogs(routerId, limit = 100, username) {
    const params = new URLSearchParams();
    if (routerId) params.set('router_id', routerId);
    if (limit) params.set('limit', limit);
    if (username) params.set('username', username);
    return this.get(`/routers/radius/logs?${params.toString()}`);
  }

  async clearRadiusLogs(routerId) {
    const params = new URLSearchParams();
    if (routerId) params.set('router_id', routerId);
    return this.delete(`/routers/radius/logs?${params.toString()}`);
  }

  // --- RADIUS Profiles ---
  async getPaymentSettings() { return this.get('/payments/settings'); }
  async updatePaymentSettings(data) { return this.put('/payments/settings', data); }
  async getPayments(limit = 100) { return this.get(`/payments/list?limit=${limit}`); }
  async getPaymentRates() { return this.get('/payments/rates'); }
  async createPaymentRate(data) { return this.post('/payments/rates', data); }
  async updatePaymentRate(id, data) { return this.put(`/payments/rates/${id}`, data); }
  async deletePaymentRate(id) { return this.delete(`/payments/rates/${id}`); }

  // --- Sales report ---
  async getSalesReport(from, to, limit = 1000) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', String(limit));
    return this.get(`/sales/report?${params.toString()}`);
  }

  async deleteAirCoinsSale(id) { return this.delete(`/sales/aircoins/${id}`); }

  async deleteAirCoinsSales(from, to) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.delete(`/sales/aircoins${qs ? `?${qs}` : ''}`);
  }

  // --- Customer wallet (staff side) ---
  async getWalletSummary() { return this.get('/wallet/admin/summary'); }
  async getWalletSettings() { return this.get('/wallet/admin/settings'); }
  async updateWalletSettings(data) { return this.put('/wallet/admin/settings', data); }
  async getWalletAccounts(search) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('limit', '200');
    return this.get(`/wallet/admin/accounts?${params.toString()}`);
  }
  async getWalletAccount(id) { return this.get(`/wallet/admin/accounts/${id}`); }
  async adjustWallet(id, data) { return this.post(`/wallet/admin/accounts/${id}/adjust`, data); }
  async setWalletAccountStatus(id, status) { return this.post(`/wallet/admin/accounts/${id}/status`, { status }); }
  async resetWalletPassword(id, password) { return this.post(`/wallet/admin/accounts/${id}/password`, { password }); }
  async getWalletTopups(cleanupOnly) {
    return this.get(`/wallet/admin/topups?limit=200${cleanupOnly ? '&cleanup=1' : ''}`);
  }
  async retryWalletTopupCleanup(id) { return this.post(`/wallet/admin/topups/${id}/cleanup`, {}); }

  // --- System settings ---
  async getSystemSettings() { return this.get('/settings'); }
  async updateSystemSettings(data) { return this.put('/settings', data); }
  async getBranding() { return this.request('GET', '/settings/branding'); }

  async uploadCompanyLogo(file) {
    const headers = { 'Content-Type': file.type || 'application/octet-stream' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}/settings/logo`, {
      method: 'POST',
      headers,
      body: file,
    });

    if (response.status === 401) {
      this.setToken(null);
      window.location.reload();
      throw new Error('Unauthorized');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Logo upload failed');
    }
    return data;
  }

  async deleteCompanyLogo() { return this.request('DELETE', '/settings/logo'); }

  // --- Portal banner (the hero picture on the customer portal) ---
  async uploadPortalBanner(file) {
    const headers = { 'Content-Type': file.type || 'application/octet-stream' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}/settings/banner`, {
      method: 'POST',
      headers,
      body: file,
    });

    if (response.status === 401) {
      this.setToken(null);
      window.location.reload();
      throw new Error('Unauthorized');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Banner upload failed');
    }
    return data;
  }

  async deletePortalBanner() { return this.request('DELETE', '/settings/banner'); }

  // --- Portal coin sounds ---
  async getPortalSounds() { return this.get('/settings/sounds'); }

  // Audio travels as a plain byte stream on purpose: the server identifies the
  // container from its magic bytes, so whatever the browser labels the File
  // cannot change what gets accepted or how it is stored.
  async uploadPortalSound(kind, file) {
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}/settings/sounds/${encodeURIComponent(kind)}`, {
      method: 'POST',
      headers,
      body: file,
    });

    if (response.status === 401) {
      this.setToken(null);
      window.location.reload();
      throw new Error('Unauthorized');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Sound upload failed');
    }
    return data;
  }

  async deletePortalSound(kind) { return this.request('DELETE', `/settings/sounds/${encodeURIComponent(kind)}`); }

  // --- Chat ---
  async getChatThreads() { return this.get('/chat/threads'); }
  async getChatMessages(threadId, before = 0) {
    return this.get(`/chat/threads/${threadId}/messages${before ? `?before=${before}` : ''}`);
  }
  async sendChatMessage(threadId, body) { return this.post(`/chat/threads/${threadId}/messages`, { body }); }
  async markChatRead(threadId) { return this.post(`/chat/threads/${threadId}/read`); }
  async deleteChatThread(threadId) { return this.delete(`/chat/threads/${threadId}`); }
  async getChatUnread() { return this.get('/chat/unread'); }

  async uploadChatImage(threadId, blob) {
    const headers = { 'Content-Type': 'image/jpeg' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}/chat/threads/${threadId}/image`, {
      method: 'POST',
      headers,
      body: blob,
    });

    if (response.status === 401) {
      this.setToken(null);
      window.location.reload();
      throw new Error('Unauthorized');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Image upload failed');
    }
    return data;
  }

  async getRadiusProfiles(routerId) {
    return this.get(`/radius-profiles/router/${routerId}`);
  }

  async getRadiusProfile(routerId, profileId) {
    return this.get(`/radius-profiles/router/${routerId}/${profileId}`);
  }

  async createRadiusProfile(routerId, data) {
    return this.post(`/radius-profiles/router/${routerId}`, data);
  }

  async updateRadiusProfile(routerId, profileId, data) {
    return this.put(`/radius-profiles/router/${routerId}/${profileId}`, data);
  }

  async assignDefaultRadiusProfile(routerId) {
    return this.post(`/radius-profiles/router/${routerId}/assign-default`);
  }

  async deleteRadiusProfile(routerId, profileId) {
    return this.delete(`/radius-profiles/router/${routerId}/${profileId}`);
  }

  // --- RADIUS Sessions ---
  async getRadiusSessions(routerId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.get(`/radius-sessions/router/${routerId}${query ? '?' + query : ''}`);
  }

  async getActiveRadiusSessions(routerId) {
    return this.get(`/radius-sessions/router/${routerId}/active`);
  }

  async terminateRadiusSession(routerId, sessionId) {
    return this.post(`/radius-sessions/router/${routerId}/${sessionId}/terminate`);
  }

  async applyVoucherToSession(routerId, sessionId, code) {
    return this.post(`/radius-sessions/router/${routerId}/${sessionId}/apply-voucher`, { code });
  }

  async extendRadiusSession(routerId, sessionId, minutes) {
    return this.post(`/radius-sessions/router/${routerId}/${sessionId}/extend`, { minutes });
  }

  async deleteRadiusSession(routerId, sessionId) {
    return this.delete(`/radius-sessions/router/${routerId}/${sessionId}`);
  }

  async getRadiusSessionStats(routerId) {
    return this.get(`/radius-sessions/router/${routerId}/stats`);
  }

  // --- RADIUS Session Settings (auto-pause when a device goes offline) ---
  async getRadiusSessionSettings() {
    return this.get('/radius/session-settings');
  }

  async updateRadiusSessionSettings(autoPauseOffline) {
    return this.put('/radius/session-settings', { autoPauseOffline: !!autoPauseOffline });
  }

  // --- Hotspot User Update ---
  async updateHotspotUser(routerId, userId, data) {
    return this.put(`/hotspot/router/${routerId}/${userId}`, data);
  }

  // --- ZeroTier Tools ---
  async getZeroTierStatus() {
    return this.get('/tools/zerotier/status');
  }

  async installZeroTier() {
    return this.post('/tools/zerotier/install');
  }

  async joinZeroTierNetwork(networkId) {
    return this.post('/tools/zerotier/join', { networkId });
  }

  async leaveZeroTierNetwork(networkId) {
    return this.post('/tools/zerotier/leave', { networkId });
  }

  // --- Database Backup ---
  async downloadDatabaseBackup() {
    const res = await fetch('/api/tools/database/backup', {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Download failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?(.+?)"?$/);
    a.download = match ? match[1] : 'mikrotik-controller-backup.db';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async restoreDatabase(base64Data) {
    return this.post('/tools/database/restore', { data: base64Data });
  }

  // --- Turso Cloud Database ---
  async getTursoConfig() {
    return this.get('/tools/turso/config');
  }

  async saveTursoConfig(url, authToken, autoSync = false, autoSyncInterval = 10000) {
    return this.post('/tools/turso/config', { url, authToken, autoSync, autoSyncInterval });
  }

  async testTursoConnection() {
    return this.post('/tools/turso/test');
  }

  async syncToTurso() {
    return this.post('/tools/turso/sync');
  }

  async restoreFromTurso() {
    return this.post('/tools/turso/restore');
  }

  // --- PPP / PPPoE ---
  async getPppActive(routerId) {
    return this.get(`/ppp/router/${routerId}/active`);
  }

  async getPppCustomers(routerId) {
    return this.get(`/ppp/router/${routerId}/customers`);
  }

  async createPppCustomer(routerId, customer) {
    return this.post(`/ppp/router/${routerId}/customers`, customer);
  }

  async updatePppCustomer(routerId, customerId, data) {
    return this.put(`/ppp/router/${routerId}/customers/${customerId}`, data);
  }

  async deletePppCustomer(routerId, customerId) {
    return this.delete(`/ppp/router/${routerId}/customers/${customerId}`);
  }

  async enablePppCustomer(routerId, customerId) {
    return this.post(`/ppp/router/${routerId}/customers/${customerId}/enable`);
  }

  async disablePppCustomer(routerId, customerId) {
    return this.post(`/ppp/router/${routerId}/customers/${customerId}/disable`);
  }

  // --- PPPoE servers ---
  async getPppoeServers(routerId) {
    return this.get(`/ppp/router/${routerId}/pppoe-servers`);
  }

  async createPppoeServer(routerId, server) {
    return this.post(`/ppp/router/${routerId}/pppoe-servers`, server);
  }

  async updatePppoeServer(routerId, serverId, data) {
    return this.put(`/ppp/router/${routerId}/pppoe-servers/${serverId}`, data);
  }

  async deletePppoeServer(routerId, serverId) {
    return this.delete(`/ppp/router/${routerId}/pppoe-servers/${serverId}`);
  }

  async getPppProfiles(routerId) {
    return this.get(`/ppp/router/${routerId}/ppp-profiles`);
  }

  async createPppProfile(routerId, profile) {
    return this.post(`/ppp/router/${routerId}/ppp-profiles`, profile);
  }

  async updatePppProfile(routerId, profileName, data) {
    return this.put(`/ppp/router/${routerId}/ppp-profiles/${encodeURIComponent(profileName)}`, data);
  }

  async deletePppProfile(routerId, profileName) {
    return this.delete(`/ppp/router/${routerId}/ppp-profiles/${encodeURIComponent(profileName)}`);
  }

  // --- PPP subscription billing ---
  async getBillingPlans(routerId) {
    return this.get(`/ppp/router/${routerId}/billing/plans`);
  }

  async createBillingPlan(routerId, plan) {
    return this.post(`/ppp/router/${routerId}/billing/plans`, plan);
  }

  async updateBillingPlan(routerId, planId, data) {
    return this.put(`/ppp/router/${routerId}/billing/plans/${planId}`, data);
  }

  async deleteBillingPlan(routerId, planId) {
    return this.delete(`/ppp/router/${routerId}/billing/plans/${planId}`);
  }

  async getBillingSettings(routerId) {
    return this.get(`/ppp/router/${routerId}/billing/settings`);
  }

  async saveBillingSettings(routerId, settings) {
    return this.put(`/ppp/router/${routerId}/billing/settings`, settings);
  }

  async getBillingOverview(routerId) {
    return this.get(`/ppp/router/${routerId}/billing/overview`);
  }

  async runBillingSweep(routerId) {
    return this.post(`/ppp/router/${routerId}/billing/sweep`);
  }

  // The router is the one thing that knows what a subscriber is really running
  // at, so this asks it and lets the panel admit profiles it did not set itself.
  async reconcileRouterProfiles(routerId) {
    return this.post(`/ppp/router/${routerId}/billing/reconcile`);
  }

  async assignCustomerPlan(routerId, customerId, data) {
    return this.post(`/ppp/router/${routerId}/customers/${customerId}/plan`, data);
  }

  async payCustomerBill(routerId, customerId, data) {
    return this.post(`/ppp/router/${routerId}/customers/${customerId}/pay`, data);
  }

  async cutoffCustomer(routerId, customerId, data) {
    return this.post(`/ppp/router/${routerId}/customers/${customerId}/cutoff`, data || {});
  }

  async getCustomerPayments(routerId, customerId) {
    return this.get(`/ppp/router/${routerId}/customers/${customerId}/payments`);
  }

  async getBillingPayments(routerId, limit) {
    return this.get(`/ppp/router/${routerId}/billing/payments?limit=${limit || 100}`);
  }

  async getRouterInterfaces(routerId) {
    return this.get(`/interfaces/router/${routerId}/interfaces`);
  }

  // ---- Pisonet (pay-per-minute Windows desktops) ----

  async getCafeMachines(routerId) {
    return this.get(`/cafe/router/${routerId}/machines`);
  }

  async getCafeSettings(routerId) {
    return this.get(`/cafe/router/${routerId}/cafe/settings`);
  }

  async saveCafeSettings(routerId, settings) {
    return this.put(`/cafe/router/${routerId}/cafe/settings`, settings);
  }

  async saveCafeAdminPassword(routerId, password) {
    return this.put(`/cafe/router/${routerId}/cafe/admin-password`, { password });
  }

  // Desktops that already run the agent but are not in the shop list yet.
  async getCafeCandidates(routerId, seconds) {
    return this.get(`/cafe/router/${routerId}/cafe/candidates?seconds=${seconds || 300}`);
  }

  async resolveCafeMac(routerId, ip) {
    return this.post(`/cafe/router/${routerId}/cafe/resolve-mac`, { ip });
  }

  async addCafeMachine(routerId, data) {
    return this.post(`/cafe/router/${routerId}/cafe/machines`, data);
  }

  async updateCafeMachine(routerId, id, data) {
    return this.put(`/cafe/router/${routerId}/cafe/machines/${id}`, data);
  }

  async removeCafeMachine(routerId, id) {
    return this.delete(`/cafe/router/${routerId}/cafe/machines/${id}`);
  }

  async startCafeMachine(routerId, id, data) {
    return this.post(`/cafe/router/${routerId}/cafe/machines/${id}/start`, data);
  }

  async lockCafeMachine(routerId, id) {
    return this.post(`/cafe/router/${routerId}/cafe/machines/${id}/lock`);
  }

  async unlockCafeMachine(routerId, id) {
    return this.post(`/cafe/router/${routerId}/cafe/machines/${id}/unlock`);
  }

  async releaseCafeMachine(routerId, id) {
    return this.post(`/cafe/router/${routerId}/cafe/machines/${id}/release`);
  }

  async resetCafeMachine(routerId, id) {
    return this.post(`/cafe/router/${routerId}/cafe/machines/${id}/reset`);
  }

  async pushCafeBypass(routerId, id, off) {
    return this.post(`/cafe/router/${routerId}/cafe/machines/${id}/bypass`, { off: !!off });
  }

  async getCafeToken(routerId, id) {
    return this.get(`/cafe/router/${routerId}/cafe/machines/${id}/token`);
  }

  async syncCafeBindings(routerId) {
    return this.post(`/cafe/router/${routerId}/cafe/sync`);
  }

  async getCafeSummary(routerId, days) {
    return this.get(`/cafe/router/${routerId}/cafe/summary?days=${days || 1}`);
  }

  async getCafeSetup() {
    return this.get('/cafe/setup');
  }
}

window.api = new ApiClient();
