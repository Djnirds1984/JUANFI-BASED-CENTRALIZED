import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './config';

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS routers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 8728,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      use_rest_api INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hotspot_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'default',
      uptime_limit TEXT DEFAULT '00:00:00',
      bytes_in_quota INTEGER DEFAULT 0,
      bytes_out_quota INTEGER DEFAULT 0,
      comment TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bandwidth_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      rate_limit TEXT NOT NULL,
      burst TEXT,
      priority INTEGER DEFAULT 8,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS monitoring_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      cpu_load INTEGER,
      memory_total INTEGER,
      memory_used INTEGER,
      uptime INTEGER,
      version TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portal_files (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS active_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      mac_address TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      hostname TEXT NOT NULL DEFAULT '',
      user TEXT NOT NULL DEFAULT '',
      server TEXT NOT NULL DEFAULT '',
      login_by TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      uptime TEXT NOT NULL DEFAULT '',
      session_time_left TEXT NOT NULL DEFAULT '',
      bytes_in INTEGER NOT NULL DEFAULT 0,
      bytes_out INTEGER NOT NULL DEFAULT 0,
      rx_rate TEXT NOT NULL DEFAULT '0 bps',
      tx_rate TEXT NOT NULL DEFAULT '0 bps',
      mikrotik_active_id TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      -- No FK on router_id: the portal can't know the controller's router id
      -- and defaults to 1; router_id is only used for admin grouping.
    );

    CREATE TABLE IF NOT EXISTS session_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      old_mac TEXT NOT NULL DEFAULT '',
      new_mac TEXT NOT NULL DEFAULT '',
      hotspot_server TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT 'login',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES device_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radius_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL UNIQUE,
      shared_secret TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radius_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER,
      log_type TEXT NOT NULL DEFAULT 'info',
      username TEXT DEFAULT '',
      source_ip TEXT DEFAULT '',
      response_code INTEGER,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS radius_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      rate_rx INTEGER NOT NULL DEFAULT 0,
      rate_tx INTEGER NOT NULL DEFAULT 0,
      burst_rx INTEGER NOT NULL DEFAULT 0,
      burst_tx INTEGER NOT NULL DEFAULT 0,
      burst_threshold_rx INTEGER NOT NULL DEFAULT 0,
      burst_threshold_tx INTEGER NOT NULL DEFAULT 0,
      burst_time_rx INTEGER NOT NULL DEFAULT 0,
      burst_time_tx INTEGER NOT NULL DEFAULT 0,
      session_timeout INTEGER NOT NULL DEFAULT 0,
      idle_timeout INTEGER NOT NULL DEFAULT 0,
      quota_rx INTEGER NOT NULL DEFAULT 0,
      quota_tx INTEGER NOT NULL DEFAULT 0,
      quota_total INTEGER NOT NULL DEFAULT 0,
      validity_period INTEGER NOT NULL DEFAULT 0,
      validity_fixed_expiry TEXT,
      shared_users INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radius_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      session_id TEXT NOT NULL,
      nas_ip TEXT,
      profile_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT,
      input_octets INTEGER NOT NULL DEFAULT 0,
      output_octets INTEGER NOT NULL DEFAULT 0,
      input_packets INTEGER NOT NULL DEFAULT 0,
      output_packets INTEGER NOT NULL DEFAULT 0,
      session_time INTEGER NOT NULL DEFAULT 0,
      terminate_cause TEXT,
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_radius_logs_router ON radius_logs(router_id);
    CREATE INDEX IF NOT EXISTS idx_radius_logs_created ON radius_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_radius_profiles_router ON radius_profiles(router_id);
    CREATE INDEX IF NOT EXISTS idx_radius_sessions_router ON radius_sessions(router_id, status);
    CREATE INDEX IF NOT EXISTS idx_radius_sessions_user ON radius_sessions(username);
    CREATE INDEX IF NOT EXISTS idx_radius_sessions_sid ON radius_sessions(session_id);

    CREATE INDEX IF NOT EXISTS idx_hotspot_users_router ON hotspot_users(router_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_router ON vouchers(router_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
    CREATE INDEX IF NOT EXISTS idx_monitoring_logs_router ON monitoring_logs(router_id);
    CREATE INDEX IF NOT EXISTS idx_monitoring_logs_recorded ON monitoring_logs(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_active_devices_router ON active_devices(router_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_devices_mac ON active_devices(router_id, mac_address) WHERE mac_address <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_device_sessions_mac ON device_sessions(router_id, mac_address) WHERE mac_address <> '';
    CREATE INDEX IF NOT EXISTS idx_device_sessions_username ON device_sessions(username);
    CREATE INDEX IF NOT EXISTS idx_session_bindings_session ON session_bindings(session_id);
    CREATE INDEX IF NOT EXISTS idx_radius_clients_router ON radius_clients(router_id);
  `);

  const columns = db.prepare("PRAGMA table_info('routers')").all() as any[];
  if (!columns.some((c: any) => c.name === 'use_rest_api')) {
    db.exec("ALTER TABLE routers ADD COLUMN use_rest_api INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((c: any) => c.name === 'auth_mode')) {
    db.exec("ALTER TABLE routers ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'api'");
  }

  const portalCols = db.prepare("PRAGMA table_info('portal_files')").all() as any[];
  if (portalCols.some((c: any) => c.name === 'name') && !portalCols.some((c: any) => c.name === 'path')) {
    db.exec("ALTER TABLE portal_files RENAME COLUMN name TO path");
  }

  const voucherCols = db.prepare("PRAGMA table_info('vouchers')").all() as any[];
  const passwordCol = voucherCols.find((c: any) => c.name === 'password');
  if (passwordCol && passwordCol.notnull === 1) {
    db.exec(`
      CREATE TABLE vouchers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
      );
      INSERT INTO vouchers_new SELECT * FROM vouchers;
      DROP TABLE vouchers;
      ALTER TABLE vouchers_new RENAME TO vouchers;
      CREATE INDEX idx_vouchers_router ON vouchers(router_id);
      CREATE INDEX idx_vouchers_code ON vouchers(code);
    `);
  }

  const hotspotUserCols = db.prepare("PRAGMA table_info('hotspot_users')").all() as any[];
  if (!hotspotUserCols.some((c: any) => c.name === 'source')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN source TEXT NOT NULL DEFAULT 'api'");
    db.exec("UPDATE hotspot_users SET source = 'api' WHERE source = ''");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'radius_profile_id')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN radius_profile_id INTEGER");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'total_bytes_in')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN total_bytes_in INTEGER NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'total_bytes_out')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN total_bytes_out INTEGER NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'total_session_time')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN total_session_time INTEGER NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'last_login_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN last_login_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'last_logout_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN last_logout_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'first_login_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN first_login_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'expiry_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN expiry_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'price')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN price REAL NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'shared_users')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN shared_users INTEGER NOT NULL DEFAULT 1");
  }

  const voucherCols2 = db.prepare("PRAGMA table_info('vouchers')").all() as any[];
  if (!voucherCols2.some((c: any) => c.name === 'radius_profile_id')) {
    db.exec("ALTER TABLE vouchers ADD COLUMN radius_profile_id INTEGER");
  }
  if (!voucherCols2.some((c: any) => c.name === 'price')) {
    db.exec("ALTER TABLE vouchers ADD COLUMN price REAL NOT NULL DEFAULT 0");
  }

  const allFiles = listHotspotFiles();
  const seedStmt = db.prepare('INSERT OR IGNORE INTO portal_files (path, content) VALUES (?, ?)');
  for (const f of allFiles) {
    if (!f.editable) continue;
    const content = getPortalDefaultContent(f.path);
    if (content !== null) {
      seedStmt.run(f.path, content);
    }
  }
}

export const EDITABLE_EXTENSIONS = new Set(['.html', '.htm', '.txt', '.css', '.js', '.svg']);

export interface HotspotFile {
  path: string;
  editable: boolean;
  size: number;
}

export function listHotspotFiles(): HotspotFile[] {
  const root = path.join(__dirname, '..', 'hotspot');
  const files: HotspotFile[] = [];
  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const editable = EDITABLE_EXTENSIONS.has(ext);
        const stat = fs.statSync(path.join(dir, e.name));
        files.push({ path: rel, editable, size: stat.size });
      }
    }
  };
  walk(root, '');
  return files;
}

export function getPortalDefaultContent(filePath: string): string | null {
  const fullPath = path.join(__dirname, '..', 'hotspot', filePath);
  const realHotspot = path.resolve(__dirname, '..', 'hotspot');
  const realFull = path.resolve(fullPath);
  if (!realFull.startsWith(realHotspot + path.sep) && realFull !== realHotspot) return null;
  try {
    return fs.readFileSync(realFull, 'utf8');
  } catch {
    return null;
  }
}

export function getDb(): Database.Database {
  return db;
}

export function closeDb(): void {
  db.close();
}
