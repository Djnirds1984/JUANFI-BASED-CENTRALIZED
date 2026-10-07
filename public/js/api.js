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

  async updateHotspotServer(routerId, serverId, data) {
    return this.put(`/hotspot/router/${routerId}/server/${serverId}`, data);
  }

  async deleteHotspotServer(routerId, serverId) {
    return this.delete(`/hotspot/router/${routerId}/server/${serverId}`);
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
}

window.api = new ApiClient();
