import { getDb } from '../database';
import { mikroTikService } from './mikrotik';
import { syncSessionsWithDevices, mikrotikTimeToSeconds } from './deviceSessions';
import { isRadiusRunning, sendCoASessionTimeout } from './radiusServer';
import { isIP } from 'net';
import { config } from '../config';
import crypto from 'crypto';

const nowStamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

const toInt = (value: any): number => {
  const parsed = parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cleanIp = (raw: any): string => String(raw || '').split('/')[0].trim();

/**
 * Sync coin-insert sessions: auto-create sessions for new users and mark
 * as stopped when users disconnect. This detects all hotspot users from
 * MikroTik polling, so no NodeMCU firmware changes are needed.
 */
export function syncCoinInsertSessions(routerId: number, live: any[] | null): void {
  if (!live) return;

  const db = getDb();
  const now = nowStamp();

  // Build a map of active users from live connections
  const activeUsers = new Map<string, any>();
  for (const conn of live) {
    const user = String(conn.user || '');
    if (user) activeUsers.set(user.toLowerCase(), conn);
  }

  // Get all active sessions for this router (any session_id pattern)
  const activeSessions = db.prepare(
    "SELECT id, username, session_id, started_at FROM radius_sessions WHERE router_id = ? AND status = 'active'"
  ).all(routerId) as any[];

  const existingUsernames = new Set<string>();
  for (const session of activeSessions) {
    existingUsernames.add(String(session.username).toLowerCase());
  }

  // Real NAS IP = the router itself (the fallback previously stored the device
  // IP here, which made the column wrong and broke Disconnect targeting).
  const routerRow = db.prepare('SELECT host FROM routers WHERE id = ?').get(routerId) as any;
  const nasIp = String(routerRow?.host || '').split(':')[0];

  // Elapsed seconds since the session started (UTC).
  const elapsedSecs = (startedAt: any): number => {
    const start = new Date(String(startedAt || '').replace(' ', 'T') + 'Z').getTime();
    if (!Number.isFinite(start)) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 1000));
  };

  // Create sessions for new users that don't have a session yet. `session_time`
  // starts at 0 and is refreshed on each sync (no more hardcoded 8h), and the
  // live byte counters are stored so Download/Upload are real.
  const insert = db.prepare(`
    INSERT INTO radius_sessions (router_id, username, session_id, nas_ip, status, started_at, updated_at,
                                 mac_address, session_time, input_octets, output_octets)
    VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, 0, ?, ?)
  `);

  for (const [username, conn] of activeUsers) {
    if (!existingUsernames.has(username)) {
      const sessionId = 'coin_' + crypto.randomBytes(8).toString('hex');
      const mac = String(conn.mac || conn['mac-address'] || '');
      insert.run(routerId, username, sessionId, nasIp, mac, toInt(conn['bytes-in']), toInt(conn['bytes-out']));
    }
  }

  // Refresh the elapsed duration + octets of live (panel-created) sessions.
  const touch = db.prepare(
    'UPDATE radius_sessions SET session_time = ?, input_octets = ?, output_octets = ?, updated_at = ? WHERE id = ?'
  );
  // Freeze the final duration when the device goes away.
  const stop = db.prepare(
    "UPDATE radius_sessions SET status = 'stopped', stopped_at = ?, session_time = ?, updated_at = ?, terminate_cause = 'User-Request' WHERE id = ?"
  );

  for (const session of activeSessions) {
    const conn = activeUsers.get(String(session.username).toLowerCase());
    if (conn) {
      // Only the panel-created rows; never overwrite real RADIUS accounting data.
      if (!String(session.session_id || '').startsWith('coin_')) continue;
      touch.run(
        elapsedSecs(session.started_at),
        toInt(conn['bytes-in']), toInt(conn['bytes-out']),
        now, session.id
      );
    } else if (String(session.session_id || '').startsWith('coin_')) {
      stop.run(now, elapsedSecs(session.started_at), now, session.id);
    }
  }
}

/**
 * Upsert every live connection and flag rows whose session ended as `offline`.
 * Pass `live = null` to skip the sync (e.g. router is disconnected) so stored
 * rows keep their last known status.
 */
export function syncActiveDevices(routerId: number, live: any[] | null): void {
  if (!live) return;

  const db = getDb();
  const now = nowStamp();

  const insert = db.prepare(`
    INSERT INTO active_devices (
      router_id, mac_address, ip_address, hostname, user, server, login_by, status,
      uptime, session_time_left, bytes_in, bytes_out, rx_rate, tx_rate,
      mikrotik_active_id, first_seen, last_seen, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);

  const update = db.prepare(`
    UPDATE active_devices SET
      mac_address = CASE WHEN ? <> '' THEN ? ELSE mac_address END,
      ip_address = CASE WHEN ? <> '' THEN ? ELSE ip_address END,
      hostname = CASE WHEN ? <> '' THEN ? ELSE hostname END,
      user = ?, server = ?, login_by = ?, status = 'active',
      uptime = ?, session_time_left = ?, bytes_in = ?, bytes_out = ?,
      rx_rate = ?, tx_rate = ?, mikrotik_active_id = ?, last_seen = ?, ended_at = NULL
    WHERE id = ?
  `);

  const markOffline = db.prepare(`
    UPDATE active_devices SET
      status = 'offline', session_time_left = '', rx_rate = '0 bps', tx_rate = '0 bps',
      mikrotik_active_id = '', ended_at = ?
    WHERE id = ?
  `);

  const apply = db.transaction(() => {
    const known = db
      .prepare('SELECT id, mac_address, ip_address FROM active_devices WHERE router_id = ?')
      .all(routerId) as any[];

    const byMac = new Map<string, any>();
    const byIp = new Map<string, any>();
    for (const row of known) {
      const mac = deviceMacKey(row.mac_address);
      const ip = String(row.ip_address || '').toLowerCase();
      if (mac && !byMac.has(mac)) byMac.set(mac, row);
      if (ip && !byIp.has(ip)) byIp.set(ip, row);
    }

    const touched = new Set<number>();

    for (const conn of live) {
      const mac = String(conn.mac || conn['mac-address'] || '').trim();
      const ip = cleanIp(conn.address);
      const macKey = deviceMacKey(mac);
      const ipKey = ip.toLowerCase();

      let row: any = macKey ? byMac.get(macKey) : undefined;
      if (!row && ipKey) {
        const candidate = byIp.get(ipKey);
        // DHCP address reuse must never transfer a hostname or access policy.
        if (candidate && (!macKey || !deviceMacKey(candidate.mac_address))) row = candidate;
      }

      const hostname = String(conn.hostname || conn['host-name'] || '');
      const sessionLeft = String(conn['session-time-left'] || '');
      const rxRate = String(conn['rx-rate'] || '0 bps');
      const txRate = String(conn['tx-rate'] || '0 bps');

      if (row) {
        update.run(
          mac, mac, ip, ip, hostname, hostname,
          String(conn.user || ''), String(conn.server || ''), String(conn['login-by'] || ''),
          String(conn.uptime || ''), sessionLeft,
          toInt(conn['bytes-in']), toInt(conn['bytes-out']),
          rxRate, txRate, String(conn['.id'] || ''), now,
          row.id
        );
        touched.add(row.id);

        const refreshed = {
          id: row.id,
          mac_address: mac || row.mac_address,
          ip_address: ip || row.ip_address,
        };
        if (macKey) byMac.set(macKey, refreshed);
        if (ipKey) byIp.set(ipKey, refreshed);
      } else {
        const info = insert.run(
          routerId, mac, ip, hostname,
          String(conn.user || ''), String(conn.server || ''), String(conn['login-by'] || ''),
          String(conn.uptime || ''), sessionLeft,
          toInt(conn['bytes-in']), toInt(conn['bytes-out']),
          rxRate, txRate, String(conn['.id'] || ''), now, now
        );
        const newId = Number(info.lastInsertRowid);
        touched.add(newId);

        const created = { id: newId, mac_address: mac, ip_address: ip };
        if (macKey) byMac.set(macKey, created);
        if (ipKey) byIp.set(ipKey, created);
      }
    }

    const stillActive = db
      .prepare("SELECT id FROM active_devices WHERE router_id = ? AND status = 'active'")
      .all(routerId) as any[];
    for (const entry of stillActive) {
      if (!touched.has(entry.id)) markOffline.run(now, entry.id);
    }
  });

  try {
    apply();
  } catch (err) {
    console.error(`syncActiveDevices failed for router ${routerId}:`, (err as Error).message);
  }
}

/** Every device ever recorded for this router, active sessions first. */
export function listActiveDevices(routerId: number): any[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT * FROM active_devices
    WHERE router_id = ?
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, last_seen DESC, id DESC
  `).all(routerId) as any[];

  return rows.map((row) => {
    const isActive = row.status === 'active';
    const account = findDeviceAccount(row);
    const expiry = account?.expiry_at ? Date.parse(String(account.expiry_at).replace(' ', 'T') + 'Z') : NaN;
    return {
      'access-mode': row.access_mode || 'normal',
      'paid-seconds-left': Number.isFinite(expiry) ? Math.max(0, Math.floor((expiry - Date.now()) / 1000)) : null,
      id: row.id,
      '.id': row.mikrotik_active_id || '',
      'mac-address': row.mac_address || '',
      address: row.ip_address || '',
      // Operator-editable override wins over the router-reported name.
      'host-name': row.custom_hostname || row.hostname || '-',
      hostname: row.hostname || '',
      'custom-hostname': row.custom_hostname || '',
      user: row.user || '',
      server: row.server || '',
      uptime: row.uptime || '',
      'session-time-left': isActive ? (row.session_time_left || '') : '',
      'bytes-in': String(row.bytes_in || 0),
      'bytes-out': String(row.bytes_out || 0),
      'rx-rate': isActive ? (row.rx_rate || '0 bps') : '0 bps',
      'tx-rate': isActive ? (row.tx_rate || '0 bps') : '0 bps',
      'login-by': row.login_by || '',
      'is-active': isActive,
      'first-seen': row.first_seen || '',
      'last-seen': row.last_seen || '',
      'ended-at': row.ended_at || '',
    };
  });
}

/**
 * Set/clear the operator-editable hostname override for a stored device. The
 * override is kept in a separate column so the background sync (which refreshes
 * the router-reported `hostname`) never clobbers it. Pass an empty hostname to
 * clear the override.
 */
export function updateActiveDevice(
  routerId: number,
  deviceId: number,
  patch: { hostname?: string }
): any | null {
  const db = getDb();
  const row = db.prepare('SELECT id FROM active_devices WHERE id = ? AND router_id = ?')
    .get(deviceId, routerId) as any;
  if (!row) return null;

  const custom = validateHostname(patch.hostname);
  requireDevice(routerId, deviceId);
  db.prepare('UPDATE active_devices SET custom_hostname = ? WHERE id = ?').run(custom, deviceId);
  return { id: deviceId, 'custom-hostname': custom };
}

export class DeviceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Accept only complete MAC addresses; never turn arbitrary usernames into MACs.
export function deviceMacKey(value: any): string {
  const mac = String(value || '').trim();
  return /^(?:[\da-f]{12}|[\da-f]{2}(?::[\da-f]{2}){5}|[\da-f]{2}(?:-[\da-f]{2}){5})$/i.test(mac)
    ? mac.replace(/[:-]/g, '').toLowerCase() : '';
}

function requireDevice(routerId: number, deviceId: number): any {
  if (!Number.isSafeInteger(routerId) || routerId <= 0 || !Number.isSafeInteger(deviceId) || deviceId <= 0) {
    throw new DeviceError(400, 'Invalid router or device id');
  }
  const device = getDb().prepare('SELECT * FROM active_devices WHERE id = ? AND router_id = ?').get(deviceId, routerId);
  if (!device) throw new DeviceError(404, 'Device not found');
  return device;
}

function validateHostname(value: any): string {
  if (typeof value !== 'string' || value.trim().length > 253 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new DeviceError(400, 'Hostname must be a string of at most 253 characters without control characters');
  }
  return value.trim();
}

function findDeviceAccount(device: any): any {
  const db = getDb();
  const mac = deviceMacKey(device.mac_address);
  const alias = mac ? db.prepare(
    "SELECT username FROM device_macs WHERE LOWER(REPLACE(REPLACE(mac_address, ':', ''), '-', '')) = ? LIMIT 1"
  ).get(mac) as any : null;
  const username = device.user || alias?.username || (mac ? mac.match(/.{2}/g)!.join(':') : '');
  if (!username) return null;
  const find = (name: string) => {
    const userMac = deviceMacKey(name);
    return db.prepare(`SELECT * FROM hotspot_users
      WHERE LOWER(username) = LOWER(?)
         OR (? <> '' AND LOWER(REPLACE(REPLACE(username, ':', ''), '-', '')) = ?)
      ORDER BY CASE WHEN router_id = ? THEN 0 ELSE 1 END, id DESC LIMIT 1`
    ).get(name, userMac, userMac, device.router_id) as any;
  };
  return find(username) || (alias?.username ? find(alias.username) : null);
}

export function createActiveDevice(routerId: number, data: any): any {
  const db = getDb();
  if (!Number.isSafeInteger(routerId) || routerId <= 0) throw new DeviceError(400, 'Invalid router id');
  if (!db.prepare('SELECT id FROM routers WHERE id = ?').get(routerId)) throw new DeviceError(404, 'Router not found');
  const key = deviceMacKey(data?.macAddress);
  if (!key) throw new DeviceError(400, 'A valid MAC address is required');
  const hostname = validateHostname(data?.hostname ?? '');
  if (data?.ipAddress != null && typeof data.ipAddress !== 'string') throw new DeviceError(400, 'Invalid IPv4 address');
  const ip = typeof data?.ipAddress === 'string' ? data.ipAddress.trim() : '';
  if (ip && isIP(ip) !== 4) throw new DeviceError(400, 'Invalid IPv4 address');
  const duplicate = db.prepare(`SELECT id FROM active_devices WHERE router_id = ?
    AND LOWER(REPLACE(REPLACE(mac_address, ':', ''), '-', '')) = ?`).get(routerId, key);
  if (duplicate) throw new DeviceError(409, 'This MAC address is already recorded on this router');
  const mac = key.match(/.{2}/g)!.join(':');
  const result = db.prepare(`INSERT INTO active_devices
    (router_id, mac_address, ip_address, custom_hostname, status)
    VALUES (?, ?, ?, ?, 'offline')`).run(routerId, mac, ip, hostname);
  return { id: Number(result.lastInsertRowid), 'mac-address': mac, 'custom-hostname': hostname };
}

const deviceMutations = new Set<string>();
async function withDeviceMutation<T>(routerId: number, deviceId: number, action: () => Promise<T>): Promise<T> {
  const key = `${routerId}:${deviceId}`;
  if (deviceMutations.has(key)) throw new DeviceError(409, 'Another device action is in progress');
  deviceMutations.add(key);
  try { return await action(); } finally { deviceMutations.delete(key); }
}

async function disconnectDevice(device: any): Promise<void> {
  const key = deviceMacKey(device.mac_address);
  const live = await mikroTikService.getActiveConnections(device.router_id);
  for (const conn of live) {
    if (key && deviceMacKey(conn.mac) === key && conn['.id']) {
      await mikroTikService.removeActiveConnection(device.router_id, conn['.id']);
    }
  }
  // Bypassed devices have host entries but no authenticated active session.
  const hosts = await mikroTikService.getHotspotHosts(device.router_id);
  for (const host of hosts) {
    if (key && deviceMacKey(host['mac-address']) === key && host['.id']) {
      await mikroTikService.removeHotspotHost(device.router_id, host['.id']);
    }
  }
}

function bindingMatchesDevice(binding: any, device: any): boolean {
  const bindingMac = deviceMacKey(binding['mac-address']);
  if (bindingMac && bindingMac !== '000000000000') return bindingMac === deviceMacKey(device.mac_address);
  const address = String(binding.address || '').trim();
  if (!address || address === '0.0.0.0' || !device.ip_address) return true;
  const number = (ip: string): number => ip.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
  if (isIP(device.ip_address) !== 4) return true;
  const ip = number(device.ip_address);
  if (isIP(address) === 4) return ip === number(address);
  const [network, prefix] = address.split('/');
  if (isIP(network) === 4 && /^\d+$/.test(prefix || '') && Number(prefix) <= 32) {
    const size = 2 ** (32 - Number(prefix));
    return Math.floor(ip / size) === Math.floor(number(network) / size);
  }
  const [start, end] = address.split('-');
  if (isIP(start) === 4 && isIP(end || '') === 4) return ip >= number(start) && ip <= number(end);
  // An unrecognized router selector cannot safely be assumed non-matching.
  return true;
}

async function applyDeviceAccess(device: any, mode: string): Promise<void> {
  const routerId = device.router_id;
  if (!mikroTikService.isConnected(routerId)) throw new DeviceError(409, 'Connect the router before changing device access');
  const key = deviceMacKey(device.mac_address);
  if (!key) throw new DeviceError(400, 'Device has no valid MAC address');
  const comment = `JuanFi managed device ${device.id}`;
  const bindings = await mikroTikService.getIpBindings(routerId);
  const owned = bindings.filter((b: any) => b.comment === comment);
  const conflict = bindings.find((b: any) => b.comment !== comment &&
    ![true, 'true', 'yes', 1, '1'].includes(b.disabled) && bindingMatchesDevice(b, device));
  if (conflict) throw new DeviceError(409, 'An existing hotspot IP binding may control this device. Resolve it in IP Bindings first.');
  if (mode === 'normal') {
    for (const binding of owned) await mikroTikService.deleteIpBinding(routerId, binding['.id']);
  } else {
    const data = { 'mac-address': key.match(/.{2}/g)!.join(':'), type: mode, server: 'all', disabled: 'false', comment };
    if (owned.length) {
      await mikroTikService.updateIpBinding(routerId, owned[0]['.id'], data);
      for (const binding of owned.slice(1)) await mikroTikService.deleteIpBinding(routerId, binding['.id']);
    } else {
      await mikroTikService.createIpBinding(routerId, data);
    }
  }
  getDb().prepare('UPDATE active_devices SET access_mode = ? WHERE id = ? AND router_id = ?')
    .run(mode, device.id, routerId);
}

export async function setActiveDeviceAccess(routerId: number, deviceId: number, mode: any): Promise<any> {
  if (!['normal', 'blocked', 'bypassed'].includes(mode)) throw new DeviceError(400, 'Invalid access mode');
  return withDeviceMutation(routerId, deviceId, async () => {
    const device = requireDevice(routerId, deviceId);
    await applyDeviceAccess(device, mode);
    let warning: string | undefined;
    try { await disconnectDevice(device); } catch {
      warning = 'Access rule saved, but the current session could not be disconnected. Reconnect the device to apply it.';
    }
    return { message: `Device access set to ${mode}`, accessMode: mode, warning };
  });
}

export async function deleteActiveDevice(routerId: number, deviceId: number): Promise<boolean> {
  return withDeviceMutation(routerId, deviceId, async () => {
    const device = requireDevice(routerId, deviceId);
    if (device.access_mode !== 'normal') await applyDeviceAccess(device, 'normal');
    if (mikroTikService.isConnected(routerId)) await disconnectDevice(device);
    else if (device.status === 'active') throw new DeviceError(409, 'Connect the router before deleting an active device');
    return getDb().prepare('DELETE FROM active_devices WHERE id = ? AND router_id = ?').run(deviceId, routerId).changes > 0;
  });
}

export async function addActiveDeviceTime(routerId: number, deviceId: number, minutes: any): Promise<any> {
  if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525600) {
    throw new DeviceError(400, 'Minutes must be a whole number from 1 to 525600');
  }
  return withDeviceMutation(routerId, deviceId, async () => {
    const db = getDb();
    const device = requireDevice(routerId, deviceId);
    const router = db.prepare('SELECT auth_mode, host FROM routers WHERE id = ?').get(routerId) as any;
    if (router?.auth_mode !== 'radius') throw new DeviceError(409, 'Time top-ups require RADIUS authentication');
    const mac = deviceMacKey(device.mac_address);
    let live: Awaited<ReturnType<typeof mikroTikService.getActiveConnections>> = [];
    if (mikroTikService.isConnected(routerId)) {
      try { live = await mikroTikService.getActiveConnections(routerId); } catch { /* The credit can still be saved offline. */ }
    }
    const connection = live.find((conn) => mac && deviceMacKey(conn.mac) === mac);
    // Resolve the account after network I/O so concurrent credits to a shared
    // account are stacked using the latest expiry inside the transaction.
    const accountDevice = { ...device, user: connection?.user || device.user };
    let user = findDeviceAccount(accountDevice);
    if (user?.disabled) throw new DeviceError(409, 'Enable the linked RADIUS account before adding time');
    if (!user && (!mac || (accountDevice.user && deviceMacKey(accountDevice.user) !== mac))) {
      throw new DeviceError(404, 'The linked RADIUS account was not found');
    }
    const result = db.transaction(() => {
      if (!user) {
        const username = mac.match(/.{2}/g)!.join(':');
        const info = db.prepare(`INSERT INTO hotspot_users (router_id, username, password, source)
          VALUES (?, ?, '', 'radius')`).run(routerId, username);
        user = db.prepare('SELECT * FROM hotspot_users WHERE id = ?').get(info.lastInsertRowid) as any;
      }
      let current = user.expiry_at ? Date.parse(String(user.expiry_at).replace(' ', 'T') + 'Z') : 0;
      if (!user.expiry_at) {
        const existingSeconds = connection ? mikrotikTimeToSeconds(connection['session-time-left'])
          : Math.max(0, mikrotikTimeToSeconds(user.uptime_limit) - Number(user.total_session_time || 0));
        if (Number.isFinite(existingSeconds)) current = Date.now() + existingSeconds * 1000;
      }
      const expiry = Math.max(Date.now(), Number.isFinite(current) ? current : 0) + minutes * 60000;
      const expiryAt = new Date(expiry).toISOString().replace('T', ' ').slice(0, 19);
      const remainingSeconds = Math.max(1, Math.floor((expiry - Date.now()) / 1000));
      db.prepare("UPDATE hotspot_users SET expiry_at = ?, updated_at = datetime('now') WHERE id = ?").run(expiryAt, user.id);
      db.prepare('UPDATE active_devices SET user = ? WHERE id = ? AND router_id = ?').run(user.username, deviceId, routerId);
      if (mac) {
        db.prepare(`INSERT INTO device_macs (mac_address, username, router_id) VALUES (?, ?, ?)
          ON CONFLICT(mac_address) DO UPDATE SET username = excluded.username,
          router_id = excluded.router_id, updated_at = datetime('now')`)
          .run(mac.match(/.{2}/g)!.join(':'), user.username, routerId);
      }
      db.prepare(`UPDATE device_sessions SET remaining_seconds = ?, total_seconds = MAX(total_seconds, ?),
        status = CASE WHEN is_online = 1 THEN 'active' ELSE 'paused' END
        WHERE router_id = ? AND LOWER(username) = LOWER(?)`)
        .run(remainingSeconds, remainingSeconds, routerId, user.username);
      return { expiryAt, remainingSeconds };
    })();
    // CoA is best-effort; do not report an unacknowledged UDP request as applied.
    let coa = 'not-sent';
    const warnings: string[] = [];
    try {
      const client = db.prepare('SELECT id FROM radius_clients WHERE router_id = ? AND is_active = 1').get(routerId);
      if (isRadiusRunning() && client && mikroTikService.isConnected(routerId)) {
        for (const conn of live) {
          if (!mac || deviceMacKey(conn.mac) !== mac) continue;
          sendCoASessionTimeout(routerId, '', router.host, result.remainingSeconds, conn.user || user.username, cleanIp(conn.address));
          coa = 'requested';
        }
      }
    } catch {
      warnings.push('The live session update could not be requested.');
    }
    if (coa === 'not-sent') warnings.push('Time is saved for the next login; reconnect the device to use it.');
    else warnings.push('Live timeout update requested; reconnect if the router does not apply it.');
    if (device.access_mode !== 'normal') warnings.push(`The device remains ${device.access_mode}; adding time does not change access.`);
    return { message: `Added ${minutes} minutes to ${user.username}`, ...result, coa, warning: warnings.join(' ') };
  });
}


// ---------------------------------------------------------------------------
// Background sync
//
// Keeps `active_devices` up to date even when nobody has the Active Devices
// tab open, so sessions that start and end between UI polls are still recorded.
// Routers that are not connected are skipped: their rows keep their last known
// status instead of being wrongly flagged offline.
// ---------------------------------------------------------------------------

let syncInterval: NodeJS.Timeout | null = null;
let syncInFlight = false;

/*
 * Pre-login the portal pages call the controller (POST /api/session/*), so the
 * controller IP must be allowed in each router's IP > Hotspot > Walled Garden
 * before authentication. This makes that idempotent - it only adds the entry
 * when it is missing, and is done at most once per router per process run.
 */
const walledGardenChecked = new Set<number>();

const radiusOnlyChecked = new Set<number>();

/*
 * FULL RADIUS: on a radius-mode router, leftover LOCAL hotspot users (named like
 * a MAC or a rate/voucher) are checked by MikroTik BEFORE RADIUS, so once their
 * limit runs out they block the device even after a top-up. Remove them so
 * RADIUS is the only authentication path.
 *
 * `purgeLocalDeviceUsers` does the actual removal and applies NO auth-mode
 * guard - the caller decides when a purge is appropriate. It is shared by the
 * background sync (ensureRadiusOnlyLocalUsers, once per router per process) and
 * the coin-insert flow (every successful coin, full RADIUS only).
 */
export async function purgeLocalDeviceUsers(routerId: number): Promise<number> {
  const users = await mikroTikService.getHotspotUsers(routerId);
  // A device user is either MAC-named OR named like a rate/voucher (e.g.
  // `240m,10,1,TEST1`). Operator accounts like `admin` are left alone.
  const isDeviceUserName = (name: any) => {
    const s = String(name || '').trim();
    if (!s) return false;
    const isMacLike = /^[0-9a-fA-F]{2}([:-]?[0-9a-fA-F]{2}){5}$/.test(s) || /^[0-9a-fA-F]{12}$/.test(s);
    return isMacLike || s.includes(',');
  };
  const deviceUsers = (Array.isArray(users) ? users : []).filter((u: any) => u['.id'] && isDeviceUserName(u.name));
  let removed = 0;
  for (const u of deviceUsers) {
    try { await mikroTikService.removeHotspotUser(routerId, u['.id']); removed++; } catch { /* keep going */ }
  }
  if (removed > 0) {
    console.log(`[RADIUS] full-RADIUS: removed ${removed} local device user(s) on router ${routerId} (RADIUS is now the only auth path)`);
  }
  return removed;
}

export async function ensureRadiusOnlyLocalUsers(routerId: number): Promise<void> {
  if (radiusOnlyChecked.has(routerId)) return;

  const db = getDb();
  const row = db.prepare('SELECT auth_mode, radius_local_users FROM routers WHERE id = ?').get(routerId) as any;
  if (!row || row.auth_mode !== 'radius') return;
  // Hybrid mode keeps a local user as a fallback - do not purge it.
  if (Number(row.radius_local_users) === 1) return;

  radiusOnlyChecked.add(routerId);
  try {
    await purgeLocalDeviceUsers(routerId);
  } catch (err) {
    radiusOnlyChecked.delete(routerId);
    console.error(`[RADIUS] local-user cleanup failed for router ${routerId}:`, (err as Error).message);
  }
}


export async function ensureWalledGardenForController(routerId: number): Promise<void> {
  if (walledGardenChecked.has(routerId)) return;
  walledGardenChecked.add(routerId);

  const lanIp = config.controllerLanIp;
  if (!lanIp) return;

  try {
    const entries = await mikroTikService.getWalledGarden(routerId);
    const exists = (Array.isArray(entries) ? entries : []).some((entry: any) => {
      const dstHost = String(entry['dst-host'] || '');
      const dstAddr = String(entry['dst-address'] || '');
      return dstHost === lanIp || dstAddr.split('/')[0] === lanIp;
    });

    if (!exists) {
      await mikroTikService.createWalledGarden(routerId, {
        'dst-host': lanIp,
        action: 'accept',
        comment: 'JuanFi controller (session tokens)',
      });
      console.log(`Walled garden entry added for controller ${lanIp} on router ${routerId}`);
    }
  } catch (err) {
    // Non-fatal: the token restore simply won't work until the entry is added
    // manually; log once so it can be diagnosed.
    walledGardenChecked.delete(routerId);
    console.error(`Walled garden check failed for router ${routerId}:`, (err as Error).message);
  }
}

export async function syncActiveDevicesOnce(): Promise<void> {
  const db = getDb();
  const routers = db.prepare('SELECT id FROM routers WHERE is_active = 1').all() as any[];

  for (const router of routers) {
    if (!mikroTikService.isConnected(router.id)) continue;

    try {
      await ensureWalledGardenForController(router.id);
    } catch (err) {
      // ignore - handled inside
    }

    try {
      await ensureRadiusOnlyLocalUsers(router.id);
    } catch (err) {
      // ignore - handled inside
    }

    try {
      const live = await mikroTikService.getActiveConnections(router.id);
      syncActiveDevices(router.id, live);
      syncSessionsWithDevices(router.id, live);
      syncCoinInsertSessions(router.id, live);
    } catch (err) {
      console.error(`Active devices sync failed for router ${router.id}:`, (err as Error).message);
    }
  }
}

export function startActiveDeviceSync(intervalSeconds?: number): void {
  stopActiveDeviceSync();

  const seconds = Math.max(1, intervalSeconds || 5);
  console.log(`Starting active devices sync (every ${seconds}s)`);

  syncActiveDevicesOnce().catch((err) => console.error('Initial active devices sync failed:', err.message));

  syncInterval = setInterval(() => {
    if (syncInFlight) return; // previous pass still running - skip this tick
    syncInFlight = true;
    syncActiveDevicesOnce()
      .catch((err) => console.error('Active devices sync failed:', err.message))
      .finally(() => {
        syncInFlight = false;
      });
  }, seconds * 1000);
}

export function stopActiveDeviceSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  syncInFlight = false;
}

