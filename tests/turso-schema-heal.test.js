const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Never open the controller's real database.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

// Same native-addon fallback as the other SQL suites.
try {
  const probe = new (require('better-sqlite3'))(':memory:');
  probe.close();
} catch (error) {
  if (!/bindings file|NODE_MODULE_VERSION/.test(error.message)) throw error;
  const { DatabaseSync } = require('node:sqlite');
  class TestDatabase extends DatabaseSync {
    pragma(sql) { this.exec(`PRAGMA ${sql}`); }
    transaction(action) {
      return (...args) => {
        this.exec('BEGIN');
        try { const result = action(...args); this.exec('COMMIT'); return result; }
        catch (error) { this.exec('ROLLBACK'); throw error; }
      };
    }
  }
  require.cache[require.resolve('better-sqlite3')].exports = TestDatabase;
}

const { initializeDatabase, getDb } = require('../src/database');
initializeDatabase();

const turso = require('../src/services/turso');

// A "cloud database" that is just another local SQLite file, behind the small
// slice of the @libsql/client interface ensureTables uses: execute(sql) with
// { rows } results. Nothing leaves the process.
function fakeCloud() {
  const D = require('better-sqlite3');
  const db = new D(':memory:');
  return {
    db,
    async execute(query) {
      const sql = typeof query === 'string' ? query : query.sql;
      return { rows: db.prepare(sql).all() };
    },
    columns(table) {
      return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    },
  };
}

test('ensureTables creates every synced table on a fresh cloud database', async () => {
  const cloud = fakeCloud();
  await turso.ensureTables(cloud);
  for (const table of ['hotspot_users', 'vouchers', 'device_sessions', 'device_macs']) {
    assert.ok(cloud.columns(table).length > 0, `${table} should exist in the cloud`);
  }
  // This is what "Restore from cloud" hit as SQLITE_UNKNOWN: no such table.
  const rows = cloud.db.prepare('SELECT * FROM hotspot_users').all();
  assert.equal(rows.length, 0);
});

test('cloud hotspot_users schema includes the newest local columns', async () => {
  const cloud = fakeCloud();
  await turso.ensureTables(cloud);
  const cols = cloud.columns('hotspot_users');
  assert.ok(cols.includes('paused'), 'paused missing');
  assert.ok(cols.includes('grace_used_at'), 'grace_used_at missing');
});

test('ensureTables heals an old cloud table without losing rows', async () => {
  const cloud = fakeCloud();
  // The schema the cloud had before pause/grace existed locally.
  cloud.db.exec(`
    CREATE TABLE hotspot_users (
      id INTEGER PRIMARY KEY,
      router_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'default',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  cloud.db.exec("INSERT INTO hotspot_users (router_id, username, password) VALUES (1, 'ROAMER1', 'pw')");

  await turso.ensureTables(cloud);

  const cols = cloud.columns('hotspot_users');
  assert.ok(cols.includes('paused'), 'paused should be added by the heal');
  assert.ok(cols.includes('grace_used_at'), 'grace_used_at should be added by the heal');
  // Existing roaming rows survive with the same default the local migration uses.
  const row = cloud.db.prepare("SELECT * FROM hotspot_users WHERE username = 'ROAMER1'").get();
  assert.equal(row.paused, 0);
  assert.equal(row.grace_used_at, null);
  // Every column syncToCloud inserts from a fresh local user must now exist.
  const localCols = getDb().prepare("PRAGMA table_info('hotspot_users')").all().map((c) => c.name);
  for (const col of localCols) assert.ok(cols.includes(col), `cloud missing ${col}`);
});

test('ensureTables is idempotent on an already-healed cloud', async () => {
  const cloud = fakeCloud();
  await turso.ensureTables(cloud);
  const before = cloud.columns('hotspot_users').join(',');
  await turso.ensureTables(cloud);
  assert.equal(cloud.columns('hotspot_users').join(','), before);
});
