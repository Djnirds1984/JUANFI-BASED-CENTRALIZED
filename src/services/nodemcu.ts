import http from 'http';

export interface NodeMcuDevice {
  id: number;
  name: string;
  ip: string;
  username: string;
  password: string;
}

interface DeviceSession {
  token: string;
  expiresAt: number;
}

interface DashboardData {
  uptimeMs: number;
  lifetimeCoins: number;
  currentCoins: number;
  customerCount: number;
  internetOnline: boolean;
  mikrotikConnected: boolean;
  macAddress: string;
  ipAddress: string;
  hardwareType: string;
  firmwareVersion: string;
  interfaceType: string;
  signalStrength: number;
  freeHeap: number;
}

const SESSION_TTL = 4 * 60 * 1000;
const sessions = new Map<number, DeviceSession>();

function httpGet(host: string, port: number, path: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function httpPost(host: string, port: number, path: string, postData: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host, port, path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(postData);
    req.end();
  });
}

function randomToken(): string {
  return Math.round((Math.pow(36, 10) - Math.random() * Math.pow(36, 10))).toString(36).slice(1);
}

async function login(device: NodeMcuDevice): Promise<string> {
  const res = await httpPost(device.ip, 80, '/validateLogin', `username=${encodeURIComponent(device.username)}&password=${encodeURIComponent(device.password)}&randomToken=${randomToken()}`);
  const parts = res.body.split('|');
  if (parts[0] === 'ok' && parts[1]) {
    return parts[1];
  }
  throw new Error(`NodeMCU login failed: ${res.body || 'no response'}`);
}

async function getToken(device: NodeMcuDevice): Promise<string> {
  const session = sessions.get(device.id);
  if (session && session.expiresAt > Date.now()) {
    return session.token;
  }
  const token = await login(device);
  sessions.set(device.id, { token, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

async function adminGet(device: NodeMcuDevice, apiPath: string): Promise<string> {
  const token = await getToken(device);
  const res = await httpGet(device.ip, 80, apiPath, { 'X-TOKEN': token });
  if (res.status === 401 || res.status === 403) {
    sessions.delete(device.id);
    const freshToken = await getToken(device);
    const retry = await httpGet(device.ip, 80, apiPath, { 'X-TOKEN': freshToken });
    if (retry.status === 401 || retry.status === 403) throw new Error('NodeMCU auth failed');
    return retry.body;
  }
  return res.body;
}

async function adminPost(device: NodeMcuDevice, apiPath: string, postData: string): Promise<string> {
  const token = await getToken(device);
  const res = await httpPost(device.ip, 80, apiPath, postData, { 'X-TOKEN': token });
  if (res.status === 401 || res.status === 403) {
    sessions.delete(device.id);
    const freshToken = await getToken(device);
    const retry = await httpPost(device.ip, 80, apiPath, postData, { 'X-TOKEN': freshToken });
    if (retry.status === 401 || retry.status === 403) throw new Error('NodeMCU auth failed');
    return retry.body;
  }
  return res.body;
}

function parseDashboard(raw: string): DashboardData {
  const p = raw.split('|');
  return {
    uptimeMs: parseInt(p[0]) || 0,
    lifetimeCoins: parseInt(p[1]) || 0,
    currentCoins: parseInt(p[2]) || 0,
    customerCount: parseInt(p[3]) || 0,
    internetOnline: p[4] === '1',
    mikrotikConnected: p[5] === '1',
    macAddress: p[6] || '',
    ipAddress: p[7] || '',
    hardwareType: p[8] || '',
    firmwareVersion: p[9] || '',
    interfaceType: p[10] || '',
    signalStrength: parseInt(p[11]) || 0,
    freeHeap: parseInt(p[12]) || 0,
  };
}

const CONFIG_FIELDS = [
  'vendoName', 'wifiSSID', 'wifiPassword', 'mikrotikIp', 'mikrotikUser', 'mikrotikPassword',
  'coinSlotWaitTime', 'adminUser', 'adminPassword', 'coinSlotAbuseCount', 'coinSlotBanMinutes',
  'coinSlotPin', 'coinSlotSetPin', 'systemReadyLedPin', 'insertCoinLedPin', 'lcdScreen',
  'insertCoinBtnPin', 'checkInternetStatus', 'voucherPrefix', 'welcomeLCDMarquee', 'setupDoneFlag',
  'voucherLoginOption', 'voucherProfile', 'voucherValidity', 'ledTriggerType', 'ipAddressMode',
  'localIpAddress', 'gatewayIp', 'subnetMask', 'dnsServer', 'coinSlotType', 'singleCoinPulseCount',
  'mtConnectionMode', 'operatorUser', 'operatorPassword', 'apiKey', 'nightLightPin',
  'buttonFunction', 'voucherLength', 'coinMultiplier', 'lanModeOverride', 'lcdSDAPin', 'lcdSCLPin',
  'billAcceptorPin', 'billAcceptorMultiplier', 'thermalPrinterPin', 'printOption',
  'printOptionCriteria', 'lanCSPin', 'persistLogs', 'includeVendoName', 'welcomeTextFirstLine',
  'welcomeTextThirdLine', 'insertCoinText', 'thankYouText', 'restartSchedule', 'blackoutDetection',
  'buzzerPin', 'printerBaudRate', 'pulseToBlock', 'thankYouTimeout', 'ethBootUpPin', 'ethPowerPin',
  'ethMdcPin', 'ethMdioPin',
];

function parseSystemConfig(raw: string): Record<string, string> {
  const parts = raw.split('|');
  const config: Record<string, string> = {};
  for (let i = 0; i < CONFIG_FIELDS.length; i++) {
    config[CONFIG_FIELDS[i]] = parts[i] || '';
  }
  return config;
}

function serializeSystemConfig(config: Record<string, string>): string {
  const parts: string[] = [];
  for (const field of CONFIG_FIELDS) {
    parts.push(config[field] || '');
  }
  return parts.join('|');
}

function parseRates(raw: string): Array<{ name: string; price: number; minutes: number; validity: number; dataLimit: number; profile: string }> {
  if (!raw || !raw.trim()) return [];
  return raw.split('|').filter(Boolean).map((row) => {
    const col = row.split('#');
    return {
      name: col[0] || '',
      price: parseInt(col[1]) || 0,
      minutes: parseInt(col[2]) || 0,
      validity: parseInt(col[3]) || 0,
      dataLimit: parseInt(col[4]) || 0,
      profile: col[5] || '',
    };
  });
}

function serializeRates(rates: Array<{ name: string; price: number; minutes: number; validity: number; dataLimit: number; profile: string }>): string {
  return rates.map((r) => `${r.name}#${r.price}#${r.minutes}#${r.validity}#${r.dataLimit}#${r.profile}`).join('|');
}

class NodeMcuService {
  async ping(device: NodeMcuDevice): Promise<{ online: boolean; dashboard?: DashboardData; error?: string }> {
    try {
      const raw = await adminGet(device, `/admin/api/dashboard?query=${Date.now()}`);
      return { online: true, dashboard: parseDashboard(raw) };
    } catch (err: any) {
      return { online: false, error: err.message };
    }
  }

  async getDashboard(device: NodeMcuDevice): Promise<DashboardData> {
    const raw = await adminGet(device, `/admin/api/dashboard?query=${Date.now()}`);
    return parseDashboard(raw);
  }

  async getSystemConfig(device: NodeMcuDevice): Promise<Record<string, string>> {
    const raw = await adminGet(device, `/admin/api/getSystemConfig?query=${Date.now()}`);
    return parseSystemConfig(raw);
  }

  async saveSystemConfig(device: NodeMcuDevice, config: Record<string, string>): Promise<void> {
    const data = serializeSystemConfig(config);
    await adminPost(device, '/admin/api/saveSystemConfig', `data=${encodeURIComponent(data)}`);
  }

  async getRates(device: NodeMcuDevice): Promise<ReturnType<typeof parseRates>> {
    const raw = await adminGet(device, `/admin/api/getRates?query=${Date.now()}`);
    return parseRates(raw);
  }

  async saveRates(device: NodeMcuDevice, rates: Parameters<typeof serializeRates>[0]): Promise<void> {
    const data = serializeRates(rates);
    await adminPost(device, '/admin/api/saveRates?rateType=1', `data=${encodeURIComponent(data)}`);
  }

  async resetStatistic(device: NodeMcuDevice, type: 'lifeTimeCount' | 'coinCount' | 'customerCount'): Promise<void> {
    await adminPost(device, `/admin/api/resetStatistic?type=${type}`, '');
  }

  async restartSystem(device: NodeMcuDevice): Promise<void> {
    await adminGet(device, `/admin/api/restartSystem?query=${Date.now()}`);
  }

  async restartMikrotik(device: NodeMcuDevice): Promise<void> {
    await adminGet(device, `/admin/api/restartMikrotik?query=${Date.now()}`);
  }

  async scanSSID(device: NodeMcuDevice): Promise<string[]> {
    const raw = await adminGet(device, `/admin/api/scanSSID?query=${Date.now()}`);
    return raw.split('|').filter(Boolean);
  }

  async getSystemLogs(device: NodeMcuDevice): Promise<string> {
    return adminGet(device, `/admin/api/getSystemLogs?query=${Date.now()}`);
  }

  async toggleNightLight(device: NodeMcuDevice): Promise<void> {
    await adminPost(device, '/admin/api/toggerNightLight', '');
  }

  async getSalesDetail(device: NodeMcuDevice): Promise<string> {
    return adminGet(device, `/admin/api/getSalesDetail?query=${Date.now()}`);
  }

  async getActiveUsers(device: NodeMcuDevice): Promise<string> {
    return adminGet(device, `/admin/api/getActiveUsers?query=${Date.now()}`);
  }

  async kickActiveUser(device: NodeMcuDevice, mac: string): Promise<void> {
    await adminPost(device, '/admin/api/kickActiveUser', `mac=${encodeURIComponent(mac)}`);
  }

  async generateVouchers(device: NodeMcuDevice, amount: number, qty: number, prefix: string, addToSales: boolean): Promise<string> {
    return adminPost(device, '/admin/api/generateVouchers', `amt=${amount}&qty=${qty}&pfx=${encodeURIComponent(prefix)}&sales=${addToSales ? 1 : 0}`);
  }

  clearSession(deviceId: number): void {
    sessions.delete(deviceId);
  }
}

export const nodeMcuService = new NodeMcuService();
