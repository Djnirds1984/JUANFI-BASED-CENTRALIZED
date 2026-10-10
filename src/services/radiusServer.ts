import dgram from 'dgram';
import crypto from 'crypto';
import { getDb } from '../database';
import { config } from '../config';

const RADIUS_CODES = {
  ACCESS_REQUEST: 1,
  ACCESS_ACCEPT: 2,
  ACCESS_REJECT: 3,
  ACCOUNTING_REQUEST: 4,
  ACCOUNTING_RESPONSE: 5,
} as const;

const RADIUS_ATTR = {
  USER_NAME: 1,
  USER_PASSWORD: 2,
  NAS_IP_ADDRESS: 4,
  NAS_PORT: 5,
  SERVICE_TYPE: 6,
  FRAMED_PROTOCOL: 7,
  FRAMED_IP_ADDRESS: 8,
  CLASS: 25,
  SESSION_TIMEOUT: 27,
  IDLE_TIMEOUT: 28,
  ACCT_STATUS_TYPE: 40,
  ACCT_DELAY_TIME: 41,
  ACCT_INPUT_OCTETS: 42,
  ACCT_OUTPUT_OCTETS: 43,
  ACCT_SESSION_ID: 44,
  ACCT_AUTHENTIC: 45,
  ACCT_INPUT_PACKETS: 46,
  ACCT_OUTPUT_PACKETS: 47,
  NAS_PORT_TYPE: 61,
  NAS_IDENTIFIER: 87,
} as const;

const ACCT_STATUS = {
  START: 1,
  STOP: 2,
  INTERIM_UPDATE: 3,
} as const;

interface RadiusAttribute {
  type: number;
  value: Buffer | string | number;
}

interface RadiusPacket {
  code: number;
  identifier: number;
  authenticator: Buffer;
  attributes: RadiusAttribute[];
}

interface RadiusClient {
  router_id: number;
  shared_secret: string;
  is_active: number;
}

let authSocket: dgram.Socket | null = null;
let acctSocket: dgram.Socket | null = null;
let running = false;

const MAX_LOG_ENTRIES = 500;

function logRadiusEvent(
  logType: string,
  message: string,
  routerId?: number,
  username?: string,
  sourceIp?: string,
  responseCode?: number
): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO radius_logs (router_id, log_type, username, source_ip, response_code, message)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(routerId ?? null, logType, username ?? '', sourceIp ?? '', responseCode ?? null, message);

    const count = (db.prepare('SELECT COUNT(*) as c FROM radius_logs').get() as any)?.c || 0;
    if (count > MAX_LOG_ENTRIES) {
      db.prepare(
        `DELETE FROM radius_logs WHERE id IN (SELECT id FROM radius_logs ORDER BY created_at ASC LIMIT ?)`
      ).run(count - MAX_LOG_ENTRIES);
    }
  } catch (err) {
    console.error('[RADIUS] Log write error:', err);
  }
}

function encodeString(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

function encodeInteger(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function encodeAttributes(attrs: RadiusAttribute[]): Buffer {
  const buffers: Buffer[] = [];
  for (const attr of attrs) {
    let valueBuf: Buffer;
    if (typeof attr.value === 'number') {
      valueBuf = encodeInteger(attr.value);
    } else if (typeof attr.value === 'string') {
      valueBuf = encodeString(attr.value);
    } else {
      valueBuf = attr.value;
    }
    const len = valueBuf.length + 2;
    const header = Buffer.alloc(2);
    header.writeUInt8(attr.type, 0);
    header.writeUInt8(len, 1);
    buffers.push(header, valueBuf);
  }
  return Buffer.concat(buffers);
}

function decodeAttributes(buf: Buffer, offset: number): RadiusAttribute[] {
  const attrs: RadiusAttribute[] = [];
  while (offset < buf.length) {
    if (offset + 2 > buf.length) break;
    const type = buf.readUInt8(offset);
    const len = buf.readUInt8(offset + 1);
    if (len < 2 || offset + len > buf.length) break;
    const valueBuf = buf.slice(offset + 2, offset + len);
    let value: Buffer | string | number;
    if (len === 6 && (type === RADIUS_ATTR.NAS_IP_ADDRESS ||
        type === RADIUS_ATTR.ACCT_STATUS_TYPE ||
        type === RADIUS_ATTR.SESSION_TIMEOUT ||
        type === RADIUS_ATTR.IDLE_TIMEOUT ||
        type === RADIUS_ATTR.ACCT_INPUT_OCTETS ||
        type === RADIUS_ATTR.ACCT_OUTPUT_OCTETS ||
        type === RADIUS_ATTR.ACCT_INPUT_PACKETS ||
        type === RADIUS_ATTR.ACCT_OUTPUT_PACKETS ||
        type === RADIUS_ATTR.NAS_PORT ||
        type === RADIUS_ATTR.SERVICE_TYPE ||
        type === RADIUS_ATTR.NAS_PORT_TYPE ||
        type === RADIUS_ATTR.ACCT_AUTHENTIC ||
        type === RADIUS_ATTR.ACCT_DELAY_TIME)) {
      value = valueBuf.readUInt32BE(0);
    } else if (type === RADIUS_ATTR.NAS_IP_ADDRESS || type === RADIUS_ATTR.FRAMED_IP_ADDRESS) {
      value = `${valueBuf[0]}.${valueBuf[1]}.${valueBuf[2]}.${valueBuf[3]}`;
    } else {
      value = valueBuf.toString('utf8');
    }
    attrs.push({ type, value });
    offset += len;
  }
  return attrs;
}

function decodePacket(buf: Buffer): RadiusPacket | null {
  if (buf.length < 20) return null;
  const code = buf.readUInt8(0);
  const identifier = buf.readUInt8(1);
  const length = buf.readUInt16BE(2);
  if (length !== buf.length) return null;
  const authenticator = buf.slice(4, 20);
  const attributes = decodeAttributes(buf, 20);
  return { code, identifier, authenticator, attributes };
}

function encryptPassword(password: string, sharedSecret: string, authenticator: Buffer): Buffer {
  const passBuf = Buffer.alloc(Math.ceil(password.length / 16) * 16 || 16);
  passBuf.write(password, 'utf8');
  const result = Buffer.alloc(passBuf.length);
  let prev = authenticator;
  for (let i = 0; i < passBuf.length; i += 16) {
    const hash = crypto.createHash('md5');
    hash.update(sharedSecret);
    hash.update(prev);
    const digest = hash.digest();
    for (let j = 0; j < 16; j++) {
      result[i + j] = passBuf[i + j] ^ digest[j];
    }
    prev = result.slice(i, i + 16);
  }
  return result;
}

function decryptPassword(encrypted: Buffer, sharedSecret: string, authenticator: Buffer): string {
  const result = Buffer.alloc(encrypted.length);
  let prev = authenticator;
  for (let i = 0; i < encrypted.length; i += 16) {
    const hash = crypto.createHash('md5');
    hash.update(sharedSecret);
    hash.update(prev);
    const digest = hash.digest();
    for (let j = 0; j < 16; j++) {
      result[i + j] = encrypted[i + j] ^ digest[j];
    }
    prev = encrypted.slice(i, i + 16);
  }
  let end = result.length;
  while (end > 0 && result[end - 1] === 0) end--;
  return result.slice(0, end).toString('utf8');
}

function buildResponsePacket(
  code: number,
  identifier: number,
  requestAuthenticator: Buffer,
  sharedSecret: string,
  attributes: RadiusAttribute[]
): Buffer {
  const attrBuf = encodeAttributes(attributes);
  const length = 20 + attrBuf.length;
  const packet = Buffer.alloc(length);
  packet.writeUInt8(code, 0);
  packet.writeUInt8(identifier, 1);
  packet.writeUInt16BE(length, 2);
  requestAuthenticator.copy(packet, 4);
  attrBuf.copy(packet, 20);

  const hash = crypto.createHash('md5');
  hash.update(packet);
  hash.update(sharedSecret);
  const responseAuth = hash.digest();
  responseAuth.copy(packet, 4);

  return packet;
}

function getAttr(attrs: RadiusAttribute[], type: number): RadiusAttribute | undefined {
  return attrs.find((a) => a.type === type);
}

function findClientByIp(ip: string): RadiusClient | null {
  try {
    const db = getDb();
    const routers = db.prepare(
      `SELECT r.id as router_id, r.host, rc.shared_secret, rc.is_active
       FROM routers r
       JOIN radius_clients rc ON rc.router_id = r.id
       WHERE r.is_active = 1 AND rc.is_active = 1`
    ).all() as any[];

    for (const r of routers) {
      if (r.host === ip) {
        return { router_id: r.router_id, shared_secret: r.shared_secret, is_active: r.is_active };
      }
    }
  } catch (err) {
    console.error('[RADIUS] Error looking up client:', err);
  }
  return null;
}

function authenticateUser(routerId: number, username: string): { accept: boolean; sessionTimeout?: number } {
  try {
    const db = getDb();
    const user = db.prepare(
      `SELECT id, username, password, profile, uptime_limit, bytes_in_quota, bytes_out_quota, disabled
       FROM hotspot_users
       WHERE router_id = ? AND username = ? AND disabled = 0`
    ).get(routerId, username) as any;

    if (!user) {
      return { accept: false };
    }

    let sessionTimeout: number | undefined;
    if (user.uptime_limit && user.uptime_limit !== '00:00:00') {
      const parts = user.uptime_limit.split(':').map(Number);
      if (parts.length === 3) {
        sessionTimeout = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }

    return { accept: true, sessionTimeout };
  } catch (err) {
    console.error('[RADIUS] Auth error:', err);
    return { accept: false };
  }
}

function handleAccessRequest(packet: RadiusPacket, rinfo: dgram.RemoteInfo): void {
  const client = findClientByIp(rinfo.address);
  if (!client) {
    console.warn(`[RADIUS] Access-Request from unknown client: ${rinfo.address}`);
    logRadiusEvent('warning', `Access-Request from unknown client ${rinfo.address}`, undefined, '', rinfo.address);
    return;
  }

  const userNameAttr = getAttr(packet.attributes, RADIUS_ATTR.USER_NAME);
  const username = typeof userNameAttr?.value === 'string' ? userNameAttr.value : '';

  if (!username) {
    const reject = buildResponsePacket(
      RADIUS_CODES.ACCESS_REJECT,
      packet.identifier,
      packet.authenticator,
      client.shared_secret,
      []
    );
    acctSocket?.send(reject, 0, reject.length, rinfo.port, rinfo.address);
    logRadiusEvent('reject', 'Access-Request with no username', client.router_id, '', rinfo.address, RADIUS_CODES.ACCESS_REJECT);
    return;
  }

  const result = authenticateUser(client.router_id, username);

  const responseAttrs: RadiusAttribute[] = [];
  if (result.accept && result.sessionTimeout) {
    responseAttrs.push({ type: RADIUS_ATTR.SESSION_TIMEOUT, value: result.sessionTimeout });
  }

  const responseCode = result.accept ? RADIUS_CODES.ACCESS_ACCEPT : RADIUS_CODES.ACCESS_REJECT;
  const response = buildResponsePacket(
    responseCode,
    packet.identifier,
    packet.authenticator,
    client.shared_secret,
    responseAttrs
  );

  (result.accept ? authSocket : authSocket)?.send(response, 0, response.length, rinfo.port, rinfo.address);

  const logType = result.accept ? 'accept' : 'reject';
  const msg = result.accept
    ? `Access-Accept${result.sessionTimeout ? ` (session timeout: ${result.sessionTimeout}s)` : ''}`
    : 'Access-Reject (user not found or disabled)';
  console.log(`[RADIUS] Auth ${result.accept ? 'ACCEPT' : 'REJECT'}: user=${username} router=${client.router_id} from=${rinfo.address}`);
  logRadiusEvent(logType, msg, client.router_id, username, rinfo.address, responseCode);
}

function handleAccountingRequest(packet: RadiusPacket, rinfo: dgram.RemoteInfo): void {
  const client = findClientByIp(rinfo.address);
  if (!client) {
    console.warn(`[RADIUS] Accounting-Request from unknown client: ${rinfo.address}`);
    logRadiusEvent('warning', `Accounting-Request from unknown client ${rinfo.address}`, undefined, '', rinfo.address);
    return;
  }

  const statusType = getAttr(packet.attributes, RADIUS_ATTR.ACCT_STATUS_TYPE);
  const sessionId = getAttr(packet.attributes, RADIUS_ATTR.ACCT_SESSION_ID);
  const userName = getAttr(packet.attributes, RADIUS_ATTR.USER_NAME);
  const inputOctets = getAttr(packet.attributes, RADIUS_ATTR.ACCT_INPUT_OCTETS);
  const outputOctets = getAttr(packet.attributes, RADIUS_ATTR.ACCT_OUTPUT_OCTETS);

  const status = typeof statusType?.value === 'number' ? statusType.value : 0;
  const session = typeof sessionId?.value === 'string' ? sessionId.value : '';
  const user = typeof userName?.value === 'string' ? userName.value : '';
  const bytesIn = typeof inputOctets?.value === 'number' ? inputOctets.value : 0;
  const bytesOut = typeof outputOctets?.value === 'number' ? outputOctets.value : 0;

  const statusLabels: Record<number, string> = { 1: 'Start', 2: 'Stop', 3: 'Interim-Update' };
  const statusLabel = statusLabels[status] || `Unknown(${status})`;

  try {
    const db = getDb();
    if (status === ACCT_STATUS.START) {
      db.prepare(
        `INSERT OR REPLACE INTO active_devices (router_id, user, mac_address, ip_address, status, bytes_in, bytes_out, last_seen)
         VALUES (?, ?, '', '', 'active', ?, ?, datetime('now'))`
      ).run(client.router_id, user, bytesIn, bytesOut);
      console.log(`[RADIUS] Acct START: user=${user} session=${session} router=${client.router_id}`);
      logRadiusEvent('accounting', `Accounting-Start: session=${session} in=${bytesIn} out=${bytesOut}`, client.router_id, user, rinfo.address);
    } else if (status === ACCT_STATUS.STOP) {
      db.prepare(
        `UPDATE active_devices SET status = 'inactive', bytes_in = ?, bytes_out = ?, ended_at = datetime('now'), last_seen = datetime('now')
         WHERE router_id = ? AND user = ? AND status = 'active'`
      ).run(bytesIn, bytesOut, client.router_id, user);
      console.log(`[RADIUS] Acct STOP: user=${user} session=${session} router=${client.router_id}`);
      logRadiusEvent('accounting', `Accounting-Stop: session=${session} in=${bytesIn} out=${bytesOut}`, client.router_id, user, rinfo.address);
    } else if (status === ACCT_STATUS.INTERIM_UPDATE) {
      db.prepare(
        `UPDATE active_devices SET bytes_in = ?, bytes_out = ?, last_seen = datetime('now')
         WHERE router_id = ? AND user = ? AND status = 'active'`
      ).run(bytesIn, bytesOut, client.router_id, user);
    }
  } catch (err) {
    console.error('[RADIUS] Accounting error:', err);
    logRadiusEvent('error', `Accounting error: ${err}`, client.router_id, user, rinfo.address);
  }

  const response = buildResponsePacket(
    RADIUS_CODES.ACCOUNTING_RESPONSE,
    packet.identifier,
    packet.authenticator,
    client.shared_secret,
    []
  );
  acctSocket?.send(response, 0, response.length, rinfo.port, rinfo.address);
}

function onAuthMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
  try {
    const packet = decodePacket(msg);
    if (!packet) {
      console.warn(`[RADIUS] Invalid packet from ${rinfo.address}:${rinfo.port}`);
      return;
    }
    if (packet.code === RADIUS_CODES.ACCESS_REQUEST) {
      handleAccessRequest(packet, rinfo);
    } else {
      console.warn(`[RADIUS] Unexpected code ${packet.code} on auth port from ${rinfo.address}`);
    }
  } catch (err) {
    console.error('[RADIUS] Auth handler error:', err);
  }
}

function onAcctMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
  try {
    const packet = decodePacket(msg);
    if (!packet) {
      console.warn(`[RADIUS] Invalid accounting packet from ${rinfo.address}:${rinfo.port}`);
      return;
    }
    if (packet.code === RADIUS_CODES.ACCOUNTING_REQUEST) {
      handleAccountingRequest(packet, rinfo);
    } else {
      console.warn(`[RADIUS] Unexpected code ${packet.code} on acct port from ${rinfo.address}`);
    }
  } catch (err) {
    console.error('[RADIUS] Acct handler error:', err);
  }
}

export function startRadiusServer(): boolean {
  if (running) return true;

  try {
    authSocket = dgram.createSocket('udp4');
    acctSocket = dgram.createSocket('udp4');

    authSocket.on('message', onAuthMessage);
    acctSocket.on('message', onAcctMessage);

    authSocket.on('error', (err) => {
      console.error('[RADIUS] Auth socket error:', err.message);
    });
    acctSocket.on('error', (err) => {
      console.error('[RADIUS] Acct socket error:', err.message);
    });

    authSocket.bind(config.radiusAuthPort, () => {
      console.log(`[RADIUS] Auth server listening on UDP ${config.radiusAuthPort}`);
      logRadiusEvent('info', `Auth server listening on UDP ${config.radiusAuthPort}`);
    });

    acctSocket.bind(config.radiusAcctPort, () => {
      console.log(`[RADIUS] Acct server listening on UDP ${config.radiusAcctPort}`);
      logRadiusEvent('info', `Acct server listening on UDP ${config.radiusAcctPort}`);
    });

    running = true;
    return true;
  } catch (err) {
    console.error('[RADIUS] Failed to start:', err);
    stopRadiusServer();
    return false;
  }
}

export function stopRadiusServer(): void {
  if (authSocket) {
    try { authSocket.close(); } catch {}
    authSocket = null;
  }
  if (acctSocket) {
    try { acctSocket.close(); } catch {}
    acctSocket = null;
  }
  running = false;
  console.log('[RADIUS] Server stopped');
  logRadiusEvent('info', 'RADIUS server stopped');
}

export function isRadiusRunning(): boolean {
  return running;
}

export function getRadiusStatus(): { running: boolean; authPort: number; acctPort: number; clientCount: number } {
  let clientCount = 0;
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM radius_clients WHERE is_active = 1').get() as any;
    clientCount = row?.count || 0;
  } catch {}
  return {
    running,
    authPort: config.radiusAuthPort,
    acctPort: config.radiusAcctPort,
    clientCount,
  };
}

export function hasRadiusClients(): boolean {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM radius_clients WHERE is_active = 1').get() as any;
    return (row?.count || 0) > 0;
  } catch {
    return false;
  }
}

export function getRadiusLogs(routerId?: number, limit: number = 100): any[] {
  try {
    const db = getDb();
    if (routerId) {
      return db.prepare(
        `SELECT rl.*, r.name as router_name FROM radius_logs rl
         LEFT JOIN routers r ON r.id = rl.router_id
         WHERE rl.router_id = ? ORDER BY rl.created_at DESC LIMIT ?`
      ).all(routerId, limit);
    }
    return db.prepare(
      `SELECT rl.*, r.name as router_name FROM radius_logs rl
       LEFT JOIN routers r ON r.id = rl.router_id
       ORDER BY rl.created_at DESC LIMIT ?`
    ).all(limit);
  } catch (err) {
    console.error('[RADIUS] Error reading logs:', err);
    return [];
  }
}

export function clearRadiusLogs(routerId?: number): void {
  try {
    const db = getDb();
    if (routerId) {
      db.prepare('DELETE FROM radius_logs WHERE router_id = ?').run(routerId);
    } else {
      db.prepare('DELETE FROM radius_logs').run();
    }
  } catch (err) {
    console.error('[RADIUS] Error clearing logs:', err);
  }
}

export async function testRadiusConnectivity(routerId: number): Promise<{
  serverRunning: boolean;
  routerConfigured: boolean;
  sharedSecret: string | null;
  hasUsers: boolean;
  userCount: number;
  authTestUser: string | null;
  authTestResult: string;
  portCheck: string;
}> {
  const result = {
    serverRunning: false,
    routerConfigured: false,
    sharedSecret: null as string | null,
    hasUsers: false,
    userCount: 0,
    authTestUser: null as string | null,
    authTestResult: 'not tested',
    portCheck: 'unknown',
  };

  result.serverRunning = running;

  try {
    const db = getDb();

    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      result.authTestResult = 'Router not found';
      return result;
    }

    const radiusClient = db.prepare(
      'SELECT * FROM radius_clients WHERE router_id = ? AND is_active = 1'
    ).get(routerId) as any;

    result.routerConfigured = !!radiusClient;
    result.sharedSecret = radiusClient ? radiusClient.shared_secret : null;

    if (routerRow.auth_mode !== 'radius') {
      result.authTestResult = 'Router auth_mode is not set to RADIUS';
      return result;
    }

    if (!radiusClient) {
      result.authTestResult = 'No active RADIUS client config for this router';
      return result;
    }

    const users = db.prepare(
      'SELECT username FROM hotspot_users WHERE router_id = ? AND disabled = 0 LIMIT 5'
    ).all(routerId) as any[];

    result.userCount = users.length;
    result.hasUsers = users.length > 0;

    if (users.length > 0) {
      const testUser = users[0].username;
      result.authTestUser = testUser;
      const authResult = authenticateUser(routerId, testUser);
      result.authTestResult = authResult.accept
        ? `PASS — user "${testUser}" would be accepted${authResult.sessionTimeout ? ` (timeout: ${authResult.sessionTimeout}s)` : ''}`
        : `FAIL — user "${testUser}" would be rejected`;
    } else {
      result.authTestResult = 'No enabled hotspot users to test with';
    }

    const portOpen = await checkPort(config.radiusAuthPort);
    result.portCheck = portOpen
      ? `Auth port ${config.radiusAuthPort} is listening`
      : `Auth port ${config.radiusAuthPort} is NOT listening`;

    logRadiusEvent(
      'info',
      `Connectivity test: server=${result.serverRunning}, configured=${result.routerConfigured}, users=${result.userCount}, port=${portOpen ? 'open' : 'closed'}`,
      routerId
    );
  } catch (err: any) {
    result.authTestResult = `Error: ${err.message}`;
  }

  return result;
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    sock.once('error', (err: NodeJS.ErrnoException) => {
      try { sock.close(); } catch {}
      resolve(err.code === 'EADDRINUSE');
    });
    sock.bind(port, '127.0.0.1', () => {
      try { sock.close(); } catch {}
      resolve(false);
    });
  });
}
