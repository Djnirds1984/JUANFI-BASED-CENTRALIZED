import { getDb } from '../database';
import { mikroTikService } from './mikrotik';
import { syncSessionsWithDevices } from './deviceSessions';

/**
 * Persistent store for hotspot active devices.
 *
 * Rows are upserted from the live MikroTik `/ip/hotspot/active` list on every
 * sync and are never deleted automatically, so a device keeps showing up in the
 * Active Devices tab after its session ends (it is simply flagged `offline`).
 */
const nowStamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

const toInt = (value: any): number => {
  const parsed = parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cleanIp = (raw: any): string => String(raw || '').split('/')[0].trim();

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
      const mac = String(row.mac_address || '').toLowerCase();
      const ip = String(row.ip_address || '').toLowerCase();
      if (mac && !byMac.has(mac)) byMac.set(mac, row);
      if (ip && !byIp.has(ip)) byIp.set(ip, row);
    }

    const touched = new Set<number>();

    for (const conn of live) {
      const mac = String(conn.mac || conn['mac-address'] || '').trim();
      const ip = cleanIp(conn.address);
      const macKey = mac.toLowerCase();
      const ipKey = ip.toLowerCase();

      let row: any = macKey ? byMac.get(macKey) : undefined;
      if (!row && ipKey) row = byIp.get(ipKey);

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
    return {
      id: row.id,
      '.id': row.mikrotik_active_id || '',
      'mac-address': row.mac_address || '',
      address: row.ip_address || '',
      'host-name': row.hostname || '-',
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

export function deleteActiveDevice(routerId: number, deviceId: number): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM active_devices WHERE id = ? AND router_id = ?').run(deviceId, routerId);
  return info.changes > 0;
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

export async function ensureWalledGardenForController(routerId: number): Promise<void> {
  if (walledGardenChecked.has(routerId)) return;
  walledGardenChecked.add(routerId);

  const lanIp = process.env.CONTROLLER_LAN_IP ? process.env.CONTROLLER_LAN_IP.trim() : '';
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
      const live = await mikroTikService.getActiveConnections(router.id);
      syncActiveDevices(router.id, live);
      syncSessionsWithDevices(router.id, live);
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

