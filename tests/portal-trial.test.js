const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Never open the controller's real database.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

// Keep SQL coverage available on Node 22+ workstations without the native
// addon (same shim as the other suites).
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
const { getTrialSettings, claimTrial, releaseTrialClaim } = require('../src/services/trial');

const MAC = 'AABBCCDDEEFF';
const RID = 1;

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM trial_claims').run();
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  db.prepare('UPDATE system_settings SET trial_enabled = 1, trial_minutes = 15 WHERE id = 1').run();
});

test('trial settings default to enabled with sane minutes', () => {
  const db = getDb();
  assert.deepEqual(getTrialSettings(db), { enabled: true, minutes: 15 });

  db.prepare('UPDATE system_settings SET trial_enabled = 0, trial_minutes = 99999 WHERE id = 1').run();
  const off = getTrialSettings(db);
  assert.equal(off.enabled, false);
  assert.equal(off.minutes, 1440, 'absurd minutes are clamped to one day');

  // Any sane value the operator sets is handed out as-is - the length is the
  // shop's policy, not the code's.
  db.prepare('UPDATE system_settings SET trial_minutes = 120 WHERE id = 1').run();
  assert.equal(getTrialSettings(db).minutes, 120);

  db.prepare('UPDATE system_settings SET trial_minutes = 0 WHERE id = 1').run();
  assert.equal(getTrialSettings(db).minutes, 15, 'zero/unset falls back to the default');
});

test('trial is granted once per device per day', () => {
  const db = getDb();
  const first = claimTrial(db, RID, MAC);
  assert.equal(first.claimed, true);
  assert.equal(first.previous, undefined, 'fresh claim has no history');

  const second = claimTrial(db, RID, MAC);
  assert.equal(second.claimed, false, 'same day cannot claim twice');

  // Another router and another device keep their own allowance.
  assert.equal(claimTrial(db, RID + 2, MAC).claimed, true);
  assert.equal(claimTrial(db, RID, '112233445566').claimed, true);
});

test('yesterday\'s claim can be renewed today', () => {
  const db = getDb();
  claimTrial(db, RID, MAC);
  db.prepare("UPDATE trial_claims SET claimed_at = '2020-01-01 23:59:59' WHERE router_id = ? AND mac_address = ?")
    .run(RID, MAC);

  const again = claimTrial(db, RID, MAC);
  assert.equal(again.claimed, true);
  assert.equal(again.previous.claimed_at, '2020-01-01 23:59:59');
  // And the renewal itself is once-per-day too.
  assert.equal(claimTrial(db, RID, MAC).claimed, false);
});

test('a failed grant rolls the claim back so the day is not burned', () => {
  const db = getDb();
  const fresh = claimTrial(db, RID, MAC);
  releaseTrialClaim(db, RID, MAC, fresh);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM trial_claims WHERE router_id = ? AND mac_address = ?')
      .get(RID, MAC).n, 0, 'fresh claim removed');
  assert.equal(claimTrial(db, RID, MAC).claimed, true, 'device can still trial today');

  // Renewal over an old stamp: rollback must restore the OLD date, not delete.
  db.prepare("UPDATE trial_claims SET claimed_at = '2020-01-01 00:00:00' WHERE router_id = ?")
    .run(RID);
  const again = claimTrial(db, RID, MAC);
  assert.equal(again.claimed, true, 'old stamp can be renewed');
  releaseTrialClaim(db, RID, MAC, again);
  assert.equal(
    db.prepare('SELECT claimed_at FROM trial_claims WHERE router_id = ? AND mac_address = ?')
      .get(RID, MAC).claimed_at, '2020-01-01 00:00:00');
});
