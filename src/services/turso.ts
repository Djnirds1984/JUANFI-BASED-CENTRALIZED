import { createClient, Client } from '@libsql/client';
import { getDb } from '../database';
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

const SYNC_TABLES = ['hotspot_users', 'vouchers', 'device_sessions'];

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

export async function syncToCloud(): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured', counts: {} };
    }

    await ensureTables(client);

    const localDb = getDb();
    const counts: Record<string, number> = {};

    for (const table of SYNC_TABLES) {
      const rows = localDb.prepare(`SELECT * FROM ${table}`).all() as any[];
      counts[table] = rows.length;

      // Delete all rows in Turso table, then re-insert from local
      await client.execute(`DELETE FROM ${table}`);

      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map(col => {
          if (col === 'router_id') return 1;
          return row[col];
        });
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

export async function restoreFromCloud(): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured', counts: {} };
    }

    const localDb = getDb();
    const counts: Record<string, number> = {};

    for (const table of SYNC_TABLES) {
      const result = await client.execute(`SELECT * FROM ${table}`);
      const rows = result.rows;
      counts[table] = rows.length;

      localDb.exec(`DELETE FROM ${table}`);

      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0] as object);
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

      const stmt = localDb.prepare(insertSql);
      const insertMany = localDb.transaction((rows: any[]) => {
        for (const row of rows) {
          const values = columns.map(col => {
            if (col === 'router_id') return 1;
            return (row as any)[col];
          });
          stmt.run(...values);
        }
      });
      insertMany(rows);
    }

    // Clear device_sessions after restore — router sessions are stale
    // Users will re-authenticate and create fresh sessions
    localDb.exec(`DELETE FROM device_sessions`);
    counts.device_sessions = 0;

    return {
      success: true,
      message: `Restored ${SYNC_TABLES.length} tables from Turso (sessions cleared — users must re-authenticate)`,
      counts,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Restore failed', counts: {} };
  }
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

  console.log(`[Turso] Auto-sync started (every ${intervalMs / 1000}s)`);
  autoSyncIntervalId = setInterval(async () => {
    try {
      await syncToCloud();
    } catch (err: any) {
      console.error('[Turso] Auto-sync error:', err.message);
    }
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
    console.log('[Turso] Auto-sync stopped');
  }
}

export function isAutoSyncRunning(): boolean {
  return autoSyncIntervalId !== null;
}
