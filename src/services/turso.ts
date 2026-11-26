import { createClient, Client } from '@libsql/client';
import { getDb } from '../database';
import { mikroTikService } from './mikrotik';
import {
  PULL_TABLES,
  SYNC_TABLES,
  SYNC_TABLE_NAMES,
  SyncPlan,
  cloudDdl,
  fingerprintSql,
  listSyncTables,
  pushStatements,
} from './tursoTables';
import fs from 'fs';
import path from 'path';

export { listSyncTables };

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

// Literal-only defaults can be used in ALTER TABLE ADD COLUMN; expression
// defaults like (datetime('now')) cannot, so those columns are added bare.
function literalDefault(dflt: unknown): string | null {
  if (dflt === null || dflt === undefined) return null;
  const s = String(dflt).trim();
  if (/^-?\d+(\.\d+)?$/.test(s) || /^'(.|\n)*'$/.test(s)) return s;
  return null;
}

function tableExists(localDb: any, table: string): boolean {
  return !!localDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function localColumnSet(localDb: any, table: string): Set<string> {
  return new Set((localDb.prepare(`PRAGMA table_info('${table}')`).all() as any[]).map((c) => String(c.name)));
}

/** This panel's CREATE TABLE text, ready for the cloud (see cloudDdl). */
function localDdl(table: string): string | null {
  const row = getDb()
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as any;
  return row?.sql ? cloudDdl(String(row.sql)) : null;
}

// The schema work (create + column healing) is per cloud database, not per
// sync: it is re-armed by a restart, a changed URL or a forced sync.
let cloudSchemaFor: string | null = null;

export async function ensureTables(client: Client, force = false): Promise<void> {
  const url = getConfig()?.url || '';
  if (!force && cloudSchemaFor === url) return;
  if (cloudSchemaFor !== url) {
    for (const key of Object.keys(pushedFingerprints)) delete pushedFingerprints[key];
  }

  const localDb = getDb();
  for (const table of SYNC_TABLE_NAMES) {
    const ddl = localDdl(table);
    if (!ddl) continue; // this build does not have the table
    try {
      await client.execute(ddl);
    } catch (err: any) {
      console.warn(`[Turso] Could not create ${table} in the cloud: ${err.message}`);
      continue;
    }
    await healColumns(client, localDb, table);
  }

  cloudSchemaFor = url;
  console.log(`[Turso] Cloud schema ready (${SYNC_TABLE_NAMES.length} tables)`);
}

// Heal schema drift: panels upgrade over their old cloud database, so a table
// created weeks ago may lack columns the local schema added since
// (hotspot_users.paused/grace_used_at). Without this the sync INSERT fails
// with "table hotspot_users has no column named paused".
async function healColumns(client: Client, localDb: any, table: string): Promise<void> {
  const localCols = localDb.prepare(`PRAGMA table_info('${table}')`).all() as any[];
  const cloudResult = await client.execute(`PRAGMA table_info(${table})`);
  const cloudCols = new Set((cloudResult.rows as any[]).map((c) => String(c.name)));
  for (const col of localCols) {
    if (cloudCols.has(col.name)) continue;
    const dflt = literalDefault(col.dflt_value);
    // NOT NULL without a usable default cannot be added to a populated table.
    if (col.notnull === 1 && dflt === null) continue;
    await client.execute(
      `ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type || 'TEXT'}` +
        `${col.notnull === 1 ? ' NOT NULL' : ''}${dflt !== null ? ` DEFAULT ${dflt}` : ''}`
    );
    console.log(`[Turso] Cloud schema healed: ${table}.${col.name} added`);
  }
}

function getLocalRouterId(localDb: any): number {
  const row = localDb.prepare('SELECT id FROM routers ORDER BY id LIMIT 1').get() as any;
  return row?.id ?? 1;
}

function deduplicateRows(rows: any[], key: string[]): any[] {
  const seen = new Map<string, any>();
  for (const row of rows) {
    const id = key.map((k) => String(row[k] ?? '')).join('\u0001');
    seen.set(id, row);
  }
  return Array.from(seen.values());
}

// Last successfully uploaded fingerprint per table (auto-sync skip cache).
const pushedFingerprints: Record<string, string> = {};

function tableFingerprint(localDb: any, table: string, plan: SyncPlan): string | null {
  const sql = fingerprintSql(table, plan);
  if (!sql) return null;
  try {
    const row = localDb.prepare(sql).get() as any;
    return `${row.n}:${row.s}`;
  } catch {
    // An older local database may lack the stamp column: just always push.
    return null;
  }
}

// One HTTP round trip per chunk instead of one per statement: a full first
// upload is thousands of DELETEs and INSERTs.
const CHUNK_STATEMENTS = 100;

async function pushInChunks(client: Client, stmts: { sql: string; args: any[] }[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += CHUNK_STATEMENTS) {
    await client.batch(stmts.slice(i, i + CHUNK_STATEMENTS), 'write');
  }
}

/**
 * Upload the whole panel to Turso.
 *
 * force = true (the admin "Sync to Cloud" button) re-sends every table.
 * force = false (auto-sync) skips tables that did not change since the last
 * successful push - see SyncPlan.stamp.
 */
export async function syncToCloud(
  force = true
): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured', counts: {} };
    }

    await ensureTables(client, force);

    const localDb = getDb();
    const routerId = getLocalRouterId(localDb);
    const counts: Record<string, number> = {};
    const failures: string[] = [];

    for (const table of SYNC_TABLE_NAMES) {
      const plan = SYNC_TABLES[table];
      if (!tableExists(localDb, table)) {
        counts[table] = 0;
        continue;
      }

      const rows = localDb.prepare(`SELECT * FROM ${table}`).all() as any[];
      counts[table] = rows.length;

      // Roaming rows are small and change constantly; push them every cycle.
      const fingerprint = plan.pull ? null : tableFingerprint(localDb, table, plan);
      if (!force && fingerprint && pushedFingerprints[table] === fingerprint) continue;
      if (rows.length === 0) {
        if (fingerprint) pushedFingerprints[table] = fingerprint;
        continue;
      }

      try {
        await pushInChunks(client, pushStatements(table, plan, rows, routerId));
        if (fingerprint) pushedFingerprints[table] = fingerprint;
        else delete pushedFingerprints[table];
      } catch (err: any) {
        // One broken table must not stop the rest of the backup.
        failures.push(`${table}: ${err.message}`);
        console.error(`[Turso] Upload of ${table} failed:`, err.message);
      }
    }

    if (failures.length > 0) {
      return {
        success: false,
        message: `Uploaded ${SYNC_TABLE_NAMES.length - failures.length} of ${SYNC_TABLE_NAMES.length} tables — ${failures.join('; ')}`,
        counts,
      };
    }

    return {
      success: true,
      message: `Uploaded ${SYNC_TABLE_NAMES.length} tables to Turso`,
      counts,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Sync failed', counts: {} };
  }
}

/**
 * Merge the shared identity tables (accounts, vouchers, sessions, device MACs)
 * from the cloud into this panel. This panel's own book - sales, payments,
 * wallets, settings - is never touched by a restore.
 */
export async function restoreFromCloud(): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const client = getClient();
    if (!client) {
      return { success: false, message: 'Turso not configured', counts: {} };
    }

    // A fresh (or never-synced) cloud database has no tables at all; without
    // this the SELECT below throws "no such table: hotspot_users".
    await ensureTables(client);

    const localDb = getDb();
    const routerId = getLocalRouterId(localDb);
    const counts: Record<string, number> = {};

    for (const table of PULL_TABLES) {
      const plan = SYNC_TABLES[table];
      if (!tableExists(localDb, table)) continue;

      const result = await client.execute(`SELECT * FROM ${table}`);
      // The cloud also holds rows written by other panel versions, so only the
      // columns this build actually has may reach the UPDATE/INSERT below.
      const localCols = localColumnSet(localDb, table);
      let rows = (result.rows as any[])
        .map((row) => {
          const clean: any = {};
          for (const [col, value] of Object.entries(row)) {
            if (localCols.has(col)) clean[col] = value;
          }
          return clean;
        })
        .filter((row) => plan.key.every((k) => row[k] !== undefined));
      rows = deduplicateRows(rows, plan.key);

      counts[table] = rows.length;
      if (rows.length === 0) continue;

      // MERGE by key: keep this panel's own rows and add/update the shared
      // accounts + device-session tokens coming from the other routers.
      const columns = Object.keys(rows[0] as object).filter((c) => c !== 'id');
      const updCols = columns.filter((c) => !plan.key.includes(c));
      const whereSql = plan.key.map((k) => `${k} = ?`).join(' AND ');
      const updSql = `UPDATE ${table} SET ${updCols.map((c) => `${c} = ?`).join(', ')} WHERE ${whereSql}`;
      const insSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      const stmtUpd = updCols.length > 0 ? localDb.prepare(updSql) : null;
      const stmtIns = localDb.prepare(insSql);
      // device_sessions has a unique (router_id, mac): free the slot first.
      const freeMacStmt = table === 'device_sessions'
        ? localDb.prepare("UPDATE device_sessions SET mac_address = '' WHERE mac_address = ? AND session_token <> ?")
        : null;

      const mergeMany = localDb.transaction((batch: any[]) => {
        for (const row of batch) {
          const value = (col: string) => (col === 'router_id' ? routerId : row[col]);
          if (freeMacStmt && row.mac_address) freeMacStmt.run(row.mac_address, row[plan.key[0]]);
          const info = stmtUpd
            ? stmtUpd.run(...updCols.map(value), ...plan.key.map((k) => row[k]))
            : { changes: 0 };
          if (info.changes === 0) stmtIns.run(...columns.map(value));
        }
      });
      mergeMany(rows);
    }

    // Push restored users/vouchers to the MikroTik router
    const syncResult = await syncUsersToRouter();

    if (PULL_TABLES.every((t) => (counts[t] || 0) === 0)) {
      return {
        success: true,
        message: 'Cloud database is empty — tables are ready. Use Sync to Cloud first to upload this panel\'s data.',
        counts,
      };
    }

    const parts = [`Merged ${PULL_TABLES.length} shared tables from Turso (centralized)`];
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
    for (const table of PULL_TABLES) {
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

  console.log(`[Turso] Auto-sync started (push every ${intervalMs / 1000}s, ${SYNC_TABLE_NAMES.length} tables)`);
  autoSyncIntervalId = setInterval(async () => {
    try {
      // Incremental: only tables that moved since the last upload are re-sent.
      await syncToCloud(false);
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
