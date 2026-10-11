import { createClient, Client } from '@libsql/client';
import { getDb } from '../database';
import fs from 'fs';
import path from 'path';

const TURSO_CONFIG_PATH = path.join(__dirname, '..', 'data', 'turso-config.json');

interface TursoConfig {
  url: string;
  authToken: string;
}

export function getConfig(): TursoConfig | null {
  try {
    if (fs.existsSync(TURSO_CONFIG_PATH)) {
      const data = fs.readFileSync(TURSO_CONFIG_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch {}
  return null;
}

export function saveConfig(url: string, authToken: string): void {
  const dir = path.dirname(TURSO_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TURSO_CONFIG_PATH, JSON.stringify({ url, authToken }, null, 2));
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

export async function syncToCloud(): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured', counts: {} };
    }

    const localDb = getDb();
    const counts: Record<string, number> = {};

    for (const table of SYNC_TABLES) {
      const rows = localDb.prepare(`SELECT * FROM ${table}`).all() as any[];
      counts[table] = rows.length;

      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map(col => row[col]);
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
          const values = columns.map(col => (row as any)[col]);
          stmt.run(...values);
        }
      });
      insertMany(rows);
    }

    return {
      success: true,
      message: `Restored ${SYNC_TABLES.length} tables from Turso`,
      counts,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Restore failed', counts: {} };
  }
}
