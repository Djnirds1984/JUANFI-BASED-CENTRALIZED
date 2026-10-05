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

  async getQueues(routerId) {
    return this.get(`/bandwidth/router/${routerId}/queues`);
  }

  async createQueue(routerId, queue) {
    return this.post(`/bandwidth/router/${routerId}/queues`, queue);
  }

  async deleteQueue(routerId, queueId) {
    return this.delete(`/bandwidth/router/${routerId}/queues/${queueId}`);
  }

  async getBandwidthProfiles(routerId) {
    return this.get(`/bandwidth/router/${routerId}/profiles`);
  }

  async createBandwidthProfile(routerId, profile) {
    return this.post(`/bandwidth/router/${routerId}/profiles`, profile);
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
}

window.api = new ApiClient();
