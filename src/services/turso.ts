import { createClient, Client } from '@libsql/client';
import { getDb } from '../database';
import { mikroTikService } from './mikrotik';
import fs from 'fs';
import path from 'path';

const TURSO_CONFIG_PATH = path.join(__dirname, '..', 'data', 'turso-config.json');

interface TursoConfig {
  url: string;
  authToken: string;
  autoSync?: boolean;
  autoSyncInterval?: number;
}

let autoSyncIntervalId: NodeJS.Timeout | null = null;
let autoPullIntervalId: NodeJS.Timeout | null = null;

export function getConfig(): TursoConfig | null {
  try {
    if (fs.existsSync(TURSO_CONFIG_PATH)) {
      const data = fs.readFileSync(TURSO_CONFIG_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch {}
  return null;
}

export function saveConfig(url: string, authToken: string, autoSync = false, autoSyncInterval = 10000): void {
  const dir = path.dirname(TURSO_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TURSO_CONFIG_PATH, JSON.stringify({ url, authToken, autoSync, autoSyncInterval }, null, 2));
}

export function getClient(): Client | null {
  const config = getConfig();
  if (!config || !config.url || !config.authToken) return null;
  return createClient({
    url: config.url,
    authToken: config.authToken,
  });
}

export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured. Please set URL and auth token.' };
    }
    await client.execute('SELECT 1');
    return { success: true, message: 'Connection successful' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

const SYNC_TABLES = ['hotspot_users', 'vouchers', 'device_sessions', 'device_macs'];

const TABLE_SCHEMAS: Record<string, string> = {
  hotspot_users: `
    CREATE TABLE IF NOT EXISTS hotspot_users (
      id INTEGER PRIMARY KEY,
      router_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'default',
      uptime_limit TEXT DEFAULT '00:00:00',
      bytes_in_quota INTEGER DEFAULT 0,
      bytes_out_quota INTEGER DEFAULT 0,
      comment TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'api',
      radius_profile_id INTEGER,
      total_bytes_in INTEGER NOT NULL DEFAULT 0,
      total_bytes_out INTEGER NOT NULL DEFAULT 0,
      total_session_time INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      last_logout_at TEXT,
      first_login_at TEXT,
      expiry_at TEXT,
      price REAL NOT NULL DEFAULT 0,
      shared_users INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
  vouchers: `
    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY,
      router_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password TEXT,
      profile TEXT NOT NULL,
      duration_minutes INTEGER,
      data_limit_mb INTEGER,
      is_used INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      expires_at TEXT,
      radius_profile_id INTEGER,
      price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
  device_macs: `
    CREATE TABLE IF NOT EXISTS device_macs (
      id INTEGER PRIMARY KEY,
      mac_address TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL DEFAULT '',
      router_id INTEGER,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
  device_sessions: `
    CREATE TABLE IF NOT EXISTS device_sessions (
      id INTEGER PRIMARY KEY,
      session_token TEXT NOT NULL UNIQUE,
      mac_address TEXT NOT NULL DEFAULT '',
      previous_mac TEXT,
      username TEXT NOT NULL DEFAULT '',
      password TEXT,
      profile TEXT,
      router_id INTEGER NOT NULL DEFAULT 1,
      hotspot_server TEXT NOT NULL DEFAULT '',
      total_seconds INTEGER NOT NULL DEFAULT 0,
      remaining_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      is_online INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_rebind_at TEXT,
      expires_at TEXT
    )
  `,
};

async function ensureTables(client: Client): Promise<void> {
  for (const table of SYNC_TABLES) {
    const schema = TABLE_SCHEMAS[table];
    if (schema) {
      await client.execute(schema);
    }
  }
}

function getLocalRouterId(localDb: any): number {
  const row = localDb.prepare('SELECT id FROM routers ORDER BY id LIMIT 1').get() as any;
  return row?.id ?? 1;
}

function deduplicateRows(rows: any[], keyCol: string): any[] {
  const seen = new Map<string, any>();
  for (const row of rows) {
    const key = String(row[keyCol] ?? '');
    seen.set(key, row);
  }
  return Array.from(seen.values());
}

export async function syncToCloud(): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured', counts: {} };
    }

    await ensureTables(client);

    const localDb = getDb();
    const routerId = getLocalRouterId(localDb);
    const counts: Record<string, number> = {};

    for (const table of SYNC_TABLES) {
      const rows = localDb.prepare(`SELECT * FROM ${table}`).all() as any[];
      counts[table] = rows.length;
      if (rows.length === 0) continue;

      const key = SYNC_KEYS[table] || 'id';
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
      const deleteSql = `DELETE FROM ${table} WHERE ${key} = ?`;

      // UPSERT by global key. We no longer wipe the cloud table, so multiple
      // panels MERGE into the same central database instead of overwriting
      // each other (this is what makes it centralized across routers).
      for (const row of rows) {
        const values = columns.map(col => (col === 'router_id' ? routerId : row[col]));
        await client.execute({ sql: deleteSql, args: [row[key]] });
        await client.execute({ sql: insertSql, args: values });
      }
    }

    return {
      success: true,
      message: `Synced ${SYNC_TABLES.length} tables to Turso`,
      counts,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Sync failed', counts: {} };
  }
}

// GLOBAL identity per synced table. These are the merge keys for the
// centralized (multi-router) cloud: an account is shared by USERNAME, a voucher
// by CODE, a device session by TOKEN - NOT per router. This is what lets the
// same account work on any router.
const SYNC_KEYS: Record<string, string> = {
  hotspot_users: 'username',
  vouchers: 'code',
  device_sessions: 'session_token',
  device_macs: 'mac_address',
};

export async function restoreFromCloud(): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured', counts: {} };
    }

    const localDb = getDb();
    const routerId = getLocalRouterId(localDb);
    const counts: Record<string, number> = {};

    for (const table of SYNC_TABLES) {
      const result = await client.execute(`SELECT * FROM ${table}`);
      let rows = result.rows as any[];
      const key = SYNC_KEYS[table] || 'id';
      rows = deduplicateRows(rows, key);
      counts[table] = rows.length;
      if (rows.length === 0) continue;

      // MERGE by key: keep this panel's own rows and add/update the shared
      // accounts + device-session tokens coming from the other routers.
      const columns = Object.keys(rows[0] as object).filter((c) => c !== 'id');
      const updCols = columns.filter((c) => c !== key);
      const updSql = `UPDATE ${table} SET ${updCols.map((c) => `${c} = ?`).join(', ')} WHERE ${key} = ?`;
      const insSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      const stmtUpd = localDb.prepare(updSql);
      const stmtIns = localDb.prepare(insSql);
      // device_sessions has a unique (router_id, mac): free the slot first.
      const freeMacStmt = table === 'device_sessions'
        ? localDb.prepare("UPDATE device_sessions SET mac_address = '' WHERE mac_address = ? AND session_token <> ?")
        : null;

      const mergeMany = localDb.transaction((batch: any[]) => {
        for (const row of batch) {
          const value = (col: string) => (col === 'router_id' ? routerId : row[col]);
          if (freeMacStmt && row.mac_address) freeMacStmt.run(row.mac_address, row[key]);
          const info = stmtUpd.run(...updCols.map(value), row[key]);
          if (info.changes === 0) stmtIns.run(...columns.map(value));
        }
      });
      mergeMany(rows);
    }

    // Push restored users/vouchers to the MikroTik router
    const syncResult = await syncUsersToRouter();

    const parts = [`Merged ${SYNC_TABLES.length} tables from Turso (centralized)`];
    if (syncResult.skipped) {
      parts.push(syncResult.skipped);
    } else {
      parts.push(`${syncResult.pushed} users/vouchers pushed to router`);
      if (syncResult.failed > 0) parts.push(`${syncResult.failed} failed`);
    }

    return {
      success: true,
      message: parts.join(' — '),
      counts,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Restore failed', counts: {} };
  }
}

export async function syncUsersToRouter(): Promise<{ pushed: number; failed: number; skipped: string }> {
  const localDb = getDb();
  const routerId = getLocalRouterId(localDb);
  const routerRow = localDb.prepare('SELECT auth_mode FROM routers WHERE id = ?').get(routerId) as any;

  if (!routerRow || routerRow.auth_mode === 'radius') {
    return { pushed: 0, failed: 0, skipped: 'RADIUS mode — no push needed' };
  }

  if (!mikroTikService.isConnected(routerId)) {
    return { pushed: 0, failed: 0, skipped: 'Router not connected' };
  }

  let pushed = 0;
  let failed = 0;

  const users = localDb.prepare('SELECT * FROM hotspot_users WHERE router_id = ? AND disabled = 0').all(routerId) as any[];
  for (const u of users) {
    try {
      await mikroTikService.createHotspotUser(routerId, {
        username: u.username,
        password: u.password,
        profile: u.profile,
        uptimeLimit: u.uptime_limit || undefined,
        bytesInQuota: u.bytes_in_quota || undefined,
        bytesOutQuota: u.bytes_out_quota || undefined,
        comment: u.comment || undefined,
      });
      pushed++;
    } catch {
      failed++;
    }
  }

  const vouchers = localDb.prepare(
    'SELECT * FROM vouchers WHERE router_id = ? AND is_used = 0 AND (expires_at IS NULL OR expires_at > datetime(\'now\'))'
  ).all(routerId) as any[];
  for (const v of vouchers) {
    try {
      const uptimeLimit = v.duration_minutes
        ? `${Math.floor(v.duration_minutes / 60)}:${String(v.duration_minutes % 60).padStart(2, '0')}:00`
        : undefined;
      await mikroTikService.createHotspotUser(routerId, {
        username: v.username,
        profile: v.profile,
        uptimeLimit,
        comment: `Voucher: ${v.code}`,
      });
      pushed++;
    } catch {
      failed++;
    }
  }

  return { pushed, failed, skipped: '' };
}

export async function pullIfLocalEmpty(): Promise<{ pulled: boolean; message: string; counts?: Record<string, number> }> {
  try {
    const config = getConfig();
    if (!config?.url || !config?.authToken) {
      return { pulled: false, message: 'Turso not configured' };
    }

    const localDb = getDb();
    let hasData = false;
    for (const table of SYNC_TABLES) {
      const count = localDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as any;
      if (count.cnt > 0) {
        hasData = true;
        break;
      }
    }

    if (hasData) {
      return { pulled: false, message: 'Local database has data, skipping auto-pull' };
    }

    const result = await restoreFromCloud();
    if (result.success) {
      return { pulled: true, message: 'Auto-pulled from Turso (local was empty)', counts: result.counts };
    }
    return { pulled: false, message: result.message };
  } catch (error: any) {
    return { pulled: false, message: error.message || 'Auto-pull failed' };
  }
}

export function startAutoSync(intervalMs = 10000): void {
  stopAutoSync();
  const config = getConfig();
  if (!config?.url || !config?.authToken) return;

  console.log(`[Turso] Auto-sync started (push every ${intervalMs / 1000}s)`);
  autoSyncIntervalId = setInterval(async () => {
    try {
      await syncToCloud();
    } catch (err: any) {
      console.error('[Turso] Auto-sync error:', err.message);
    }
  }, intervalMs);

  // Also PULL periodically (merge) so accounts/sessions created on OTHER panels
  // show up here. This is what makes it centralized across routers - without it
  // a running panel would only ever push and never see the shared data.
  const pullMs = Math.max(intervalMs * 3, 30000);
  console.log(`[Turso] Auto-merge (pull) every ${pullMs / 1000}s`);
  autoPullIntervalId = setInterval(async () => {
    try {
      await restoreFromCloud();
    } catch (err: any) {
      console.error('[Turso] Auto-merge error:', err.message);
    }
  }, pullMs);
}

export function stopAutoSync(): void {
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
    console.log('[Turso] Auto-sync stopped');
  }
  if (autoPullIntervalId) {
    clearInterval(autoPullIntervalId);
    autoPullIntervalId = null;
  }
}

export function isAutoSyncRunning(): boolean {
  return autoSyncIntervalId !== null;
}
