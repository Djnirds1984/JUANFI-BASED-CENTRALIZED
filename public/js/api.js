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

  async changePassword(newPassword) {
    return this.post('/auth/change-password', { newPassword });
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

  async getHotspotProfiles(routerId) {
    return this.get(`/hotspot/router/${routerId}/profiles`);
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

  async getWalledGarden(routerId) {
    return this.get(`/hotspot/router/${routerId}/walled-garden`);
  }

  async createWalledGarden(routerId, data) {
    return this.post(`/hotspot/router/${routerId}/walled-garden`, data);
  }

  async deleteWalledGarden(routerId, entryId) {
    return this.delete(`/hotspot/router/${routerId}/walled-garden/${entryId}`);
  }

  async getHotspotCookie(routerId) {
    return this.get(`/hotspot/router/${routerId}/cookie`);
  }

  async setHotspotCookie(routerId, data) {
    return this.put(`/hotspot/router/${routerId}/cookie`, data);
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

  async getRouterInterfaces(routerId) {
    return this.get(`/monitoring/router/${routerId}/interfaces`);
  }

  async getRouterTraffic(routerId) {
    return this.get(`/monitoring/router/${routerId}/traffic`);
  }

  async getPortalFiles() {
    return this.get('/portal');
  }

  async getPortalFile(name) {
    return this.get(`/portal/file/${encodeURIComponent(name)}`);
  }

  async savePortalFile(name, content) {
    return this.put(`/portal/file/${encodeURIComponent(name)}`, { content });
  }

  async resetPortalFile(name) {
    return this.post(`/portal/reset/${encodeURIComponent(name)}`);
  }

  async pushPortalFile(routerId, filePath) {
    return this.post(`/portal/push-file/${routerId}`, { file: filePath });
  }

  async pushPortalFiles(routerId) {
    return this.post(`/portal/push/${routerId}`, {});
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

  async nodemcuUpdateDevice(id, data) {
    return this.put(`/nodemcu/devices/${id}`, data);
  }

  async nodemcuDeleteDevice(id) {
    return this.delete(`/nodemcu/devices/${id}`);
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
}

window.api = new ApiClient();
