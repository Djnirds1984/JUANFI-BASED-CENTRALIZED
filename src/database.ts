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

    CREATE INDEX IF NOT EXISTS idx_hotspot_users_router ON hotspot_users(router_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_router ON vouchers(router_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
    CREATE INDEX IF NOT EXISTS idx_monitoring_logs_router ON monitoring_logs(router_id);
    CREATE INDEX IF NOT EXISTS idx_monitoring_logs_recorded ON monitoring_logs(recorded_at);
  `);

  const columns = db.prepare("PRAGMA table_info('routers')").all() as any[];
  if (!columns.some((c: any) => c.name === 'use_rest_api')) {
    db.exec("ALTER TABLE routers ADD COLUMN use_rest_api INTEGER NOT NULL DEFAULT 0");
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
