/*
 * The Turso sync plan: which table goes to the cloud, what identifies a row
 * there and whether the row is merged back. Kept free of database and network
 * imports so the plan and the SQL it produces can be checked on their own.
 */

export interface SyncPlan {
  /** Columns that identify a row GLOBALLY - never this panel's own row id. */
  key: string[];
  /** true = shared identity: uploaded AND merged back into this panel. */
  pull: boolean;
  /**
   * Expression whose MAX() moves whenever the table changes, used to skip a
   * table that did not move since the last upload. Without it a 10s timer
   * would re-send months of sales history on every tick.
   */
  stamp?: string;
}

/*
 * ---- What the cloud keeps -------------------------------------------------
 *
 * The cloud database is both this panel's backup and the shared brain between
 * panels, so EVERY table the panel writes is uploaded - not just the four
 * roaming tables. Two rules keep that from turning into a data-loss machine:
 *
 *   pull: true   A shared identity (account, voucher, device session/token).
 *                Upserted to the cloud by its natural key and merged back into
 *                every panel, which is what lets one account roam routers.
 *
 *   pull: false  This panel's own book (sales, payments, wallets, settings,
 *                chats, profiles). Uploaded for backup and cross-panel
 *                reporting, but NEVER merged back, so a second panel can
 *                neither overwrite this shop's money rows nor be overwritten
 *                by them.
 *
 * key is the natural identity of a row. It is deliberately never the local
 * AUTOINCREMENT id: two panels both number their rows from 1, so an id-keyed
 * upsert would have them delete and replace each other's rows. The three
 * single-row settings tables are the exception - their identity really is 1.
 *
 * Not uploaded, on purpose:
 *   active_devices     live router state; a restored copy would resurrect
 *                      ghost sessions that are already gone
 *   monitoring_logs    telemetry sampled every poll - pure volume, no value
 *   radius_logs        same, plus it is a debugging aid for one panel only
 *   wallet_auth_codes  one-shot codes that die within minutes
 *   cafe_candidates    discovery beacons from agents not added to a shop yet
 */
export const SYNC_TABLES: Record<string, SyncPlan> = {
  // ---- shared identity: merged both ways --------------------------------
  hotspot_users: { key: ['username'], pull: true },
  vouchers: { key: ['code'], pull: true },
  device_sessions: { key: ['session_token'], pull: true },
  device_macs: { key: ['mac_address'], pull: true },

  // ---- this panel's own book: uploaded, never merged back ---------------
  routers: { key: ['name', 'host'], pull: false, stamp: 'updated_at' },
  admin_users: { key: ['username'], pull: false, stamp: 'created_at' },
  portal_files: { key: ['path'], pull: false, stamp: 'updated_at' },
  bandwidth_profiles: { key: ['router_id', 'name'], pull: false, stamp: 'updated_at' },
  radius_profiles: { key: ['router_id', 'name'], pull: false, stamp: 'updated_at' },
  radius_clients: { key: ['router_id'], pull: false, stamp: 'updated_at' },
  radius_sessions: { key: ['session_id'], pull: false, stamp: 'updated_at' },
  session_bindings: { key: ['session_id', 'created_at', 'new_mac'], pull: false, stamp: 'created_at' },
  trial_claims: { key: ['router_id', 'mac_address'], pull: false, stamp: 'claimed_at' },
  trial_ip_claims: { key: ['router_id', 'ip_address'], pull: false, stamp: 'claimed_at' },
  chat_threads: { key: ['mac', 'router_id'], pull: false, stamp: 'last_message_at' },
  chat_messages: { key: ['thread_id', 'created_at', 'sender', 'body'], pull: false, stamp: 'created_at' },

  // ---- money in ----------------------------------------------------------
  payments: { key: ['reference'], pull: false, stamp: 'COALESCE(paid_at, created_at)' },
  payment_rates: { key: ['label', 'amount', 'minutes'], pull: false, stamp: 'created_at' },
  aircoins_sales: { key: ['device_id', 'created_at', 'mac', 'coins', 'status'], pull: false, stamp: 'created_at' },
  ppp_customers: { key: ['router_id', 'username'], pull: false, stamp: 'updated_at' },
  ppp_payments: { key: ['router_id', 'customer_id', 'created_at', 'amount'], pull: false, stamp: 'created_at' },
  pppoe_servers: { key: ['router_id', 'name'], pull: false, stamp: 'updated_at' },
  billing_plans: { key: ['router_id', 'name'], pull: false, stamp: 'updated_at' },
  billing_settings: { key: ['router_id'], pull: false, stamp: 'updated_at' },
  cafe_settings: { key: ['router_id'], pull: false, stamp: 'updated_at' },
  cafe_machines: { key: ['router_id', 'name'], pull: false, stamp: 'updated_at' },
  cafe_sessions: { key: ['router_id', 'machine_id', 'created_at', 'event'], pull: false, stamp: 'created_at' },

  // ---- wallet: balances live here, so this is backup only ----------------
  wallet_accounts: { key: ['email'], pull: false, stamp: 'updated_at' },
  wallet_transactions: { key: ['reference'], pull: false, stamp: 'created_at' },
  wallet_topup_sessions: { key: ['code'], pull: false, stamp: 'COALESCE(settled_at, created_at)' },
  wallet_devices: { key: ['account_id', 'mac'], pull: false, stamp: 'last_seen' },
  wallet_settings: { key: ['id'], pull: false, stamp: 'updated_at' },
  payment_settings: { key: ['id'], pull: false, stamp: 'updated_at' },
  system_settings: { key: ['id'], pull: false, stamp: 'updated_at' },
};

export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES);
export const PULL_TABLES = SYNC_TABLE_NAMES.filter((t) => SYNC_TABLES[t].pull);

/** Table list for the admin UI / diagnostics. */
export function listSyncTables(): { table: string; pull: boolean }[] {
  return SYNC_TABLE_NAMES.map((table) => ({ table, pull: SYNC_TABLES[table].pull }));
}

/**
 * LOCAL sqlite_master text -> cloud CREATE TABLE.
 *
 * The cloud table is created from the local schema instead of a hardcoded
 * copy: sqlite_master already carries every column this build added through
 * migrations (hotspot_users.paused, ppp_customers.billing_type, ...), so a new
 * table never has to be written by hand when the panel grows a column.
 *
 * FOREIGN KEY clauses are dropped: the cloud holds rows from several panels,
 * so the parent row may not be there, and libsql does not enforce them anyway.
 */
export function cloudDdl(localSql: string): string {
  let sql = String(localSql).trim();
  if (!/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(sql)) {
    sql = sql.replace(/^CREATE\s+TABLE/i, 'CREATE TABLE IF NOT EXISTS');
  }
  const stripped = sql.replace(
    /,?\s*FOREIGN\s+KEY\s*\([^()]*\)\s*REFERENCES\s+[^\s(]+\s*\([^()]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi,
    ''
  );
  // The FK clause is normally the last one, so drop any separator it left.
  return stripped.replace(/,\s*\)/g, ')');
}

/**
 * Columns sent to the cloud.
 *
 * The row's own id is dropped: two panels both number their rows from 1, so
 * it would either collide on the primary key or hijack another shop's row.
 * Only the single-row settings tables keep it (their CHECK (id = 1) needs a
 * value, and 1 is genuinely their identity).
 */
export function pushColumns(plan: SyncPlan, sampleRow: Record<string, any>): string[] {
  return Object.keys(sampleRow).filter((c) => plan.key.includes(c) || c !== 'id');
}

/** One DELETE + one INSERT per row, so re-uploading never duplicates a row. */
export function pushStatements(
  table: string,
  plan: SyncPlan,
  rows: Record<string, any>[],
  routerId: number
): { sql: string; args: any[] }[] {
  const columns = pushColumns(plan, rows[0]);
  const whereSql = plan.key.map((k) => `${k} = ?`).join(' AND ');
  const deleteSql = `DELETE FROM ${table} WHERE ${whereSql}`;
  const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;

  const stmts: { sql: string; args: any[] }[] = [];
  for (const row of rows) {
    stmts.push({ sql: deleteSql, args: plan.key.map((k) => row[k]) });
    stmts.push({
      sql: insertSql,
      // Roaming rows belong to whoever restores them, so router_id is written
      // as this panel's router. A panel's own book keeps the id it was made
      // with, because nothing merges it into another installation.
      args: columns.map((col) => (plan.pull && col === 'router_id' ? routerId : row[col])),
    });
  }
  return stmts;
}

/** Local query that says whether a table moved since the last upload. */
export function fingerprintSql(table: string, plan: SyncPlan): string | null {
  if (!plan.stamp) return null;
  return `SELECT COUNT(*) AS n, COALESCE(MAX(${plan.stamp}), '') AS s FROM ${table}`;
}
