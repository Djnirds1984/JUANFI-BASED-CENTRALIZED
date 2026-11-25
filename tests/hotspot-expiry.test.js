const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Never open the controller's real database or use its authentication secret.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

// Keep SQL regression coverage available on Node 22+ workstations without the
// native addon. Production still uses better-sqlite3, unchanged.
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
  console.log('SQL tests: using in-memory node:sqlite fallback');
}

const { initializeDatabase, getDb } = require('../src/database');
const { mikroTikService: mt } = require('../src/services/mikrotik');
const {
  runHotspotExpirySweep,
  stopHotspotExpirySweep,
  accountExpiryMs,
  isAccountExpired,
  identityKey,
} = require('../src/services/hotspotExpiry');
const {
  claimTrial,
  releaseTrialClaim,
  getTrialSettings,
  MAX_TRIAL_MINUTES,
} = require('../src/services/trial');
const { creditMacAccount } = require('../src/services/timeCredit');

initializeDatabase();
const db = getDb();

// Router commands are captured, never reaching hardware.
let connected, live, kickedUsers;
mt.isConnected = () => connected;
mt.getActiveConnections = async () => live;
mt.kickActiveSession = async (routerId, opts) => {
  kickedUsers.push(String(opts.username || '').toUpperCase());
  return true;
};

const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const minutesFromNow = minutes => stamp(Date.now() + minutes * 60 * 1000);

const insertAccount = ({ username, routerId = 1, expiryAt = null, disabled = 0 }) => {
  db.prepare(
    `INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at, source)
     VALUES (?, ?, '', 'default', ?, ?, 'radius')`
  ).run(routerId, username, disabled, expiryAt);
};

const insertSession = ({ username, routerId = 1, sessionId = 'sess-1' }) => {
  db.prepare(
    `INSERT INTO radius_sessions (router_id, username, session_id, nas_ip, status)
     VALUES (?, ?, ?, '127.0.0.1', 'active')`
  ).run(routerId, username, sessionId);
};

beforeEach(() => {
  stopHotspotExpirySweep();
  db.exec(`DELETE FROM routers; DELETE FROM hotspot_users; DELETE FROM radius_sessions;
           DELETE FROM radius_logs; DELETE FROM trial_claims; DELETE FROM trial_ip_claims;
           DELETE FROM device_sessions; DELETE FROM device_macs;`);
  db.prepare("INSERT INTO routers (id, name, host, username, password, auth_mode) VALUES (1, 'Test', '127.0.0.1', 'test', '', 'radius')").run();
  db.prepare("INSERT INTO routers (id, name, host, username, password, auth_mode) VALUES (2, 'Other', '127.0.0.2', 'test', '', 'radius')").run();
  connected = true;
  live = [];
  kickedUsers = [];
});

after(() => {
  stopHotspotExpirySweep();
  db.close();
});

test('expiry/text helpers understand UTC stamps and MAC shapes', () => {
  assert.equal(accountExpiryMs('2026-11-25 18:57:10'), Date.parse('2026-11-25T18:57:10Z'));
  assert.equal(accountExpiryMs(''), null);
  assert.equal(accountExpiryMs('not a date'), null);
  assert.equal(isAccountExpired('2000-01-01 00:00:00', Date.now()), true);
  assert.equal(isAccountExpired(minutesFromNow(5), Date.now()), false);
  assert.equal(isAccountExpired(null, Date.now()), false);
  assert.equal(identityKey('ec:9a:0c:15:0b:4f'), 'EC9A0C150B4F');
  assert.equal(identityKey('EC9A0C150B4F'), 'EC9A0C150B4F');
  assert.equal(identityKey('MML2Y'), 'MML2Y');
  assert.equal(identityKey(''), '');
});

test('a live session on an expired account is kicked', async () => {
  insertAccount({ username: 'EC9A0C150B4F', expiryAt: '2026-11-25 18:57:10' });
  insertSession({ username: 'EC9A0C150B4F', sessionId: '8000000c' });

  const report = await runHotspotExpirySweep();

  assert.equal(report.expired, 1);
  assert.equal(report.kicked, 1);
  assert.deepEqual(kickedUsers, ['EC9A0C150B4F']);
  assert.match(report.details[0].reason, /account expired/);
  const log = db.prepare("SELECT * FROM radius_logs WHERE message LIKE 'Expiry kick:%'").get();
  assert.ok(log, 'the kick is written to the RADIUS log the panel shows');
  assert.equal(String(log.username).toUpperCase(), 'EC9A0C150B4F');

  // The row is closed so the next tick does not kick a session that is gone.
  const session = db.prepare('SELECT status, terminate_cause FROM radius_sessions WHERE session_id = ?').get('8000000c');
  assert.equal(session.status, 'stopped');
  assert.equal(session.terminate_cause, 'Session-Timeout');

  // A second pass has nothing left to do and writes no second log line.
  const again = await runHotspotExpirySweep();
  assert.equal(again.kicked, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM radius_logs WHERE message LIKE \'Expiry kick:%\'').get().n, 1);
});

test('a session with remaining time is left alone', async () => {
  insertAccount({ username: 'EC9A0C150B4F', expiryAt: minutesFromNow(30) });
  insertSession({ username: 'EC9A0C150B4F' });

  const report = await runHotspotExpirySweep();

  assert.equal(report.kicked, 0);
  assert.deepEqual(kickedUsers, []);
});

test('the expiry check matches the account row whatever its MAC separator shape', async () => {
  // The duplicate-row bug: the panel/auth may read `ec:9a:...`, the credit the
  // compact form. Both must be recognised as the same expired identity.
  insertAccount({ username: 'ec:9a:0c:15:0b:4f', expiryAt: '2026-11-25 18:57:10' });
  insertSession({ username: 'EC9A0C150B4F' });

  const report = await runHotspotExpirySweep();

  assert.equal(report.kicked, 1);
  assert.deepEqual(kickedUsers, ['EC9A0C150B4F']);
});

test('a deleted account cannot keep a live session', async () => {
  insertAccount({ username: 'OTHERDEVICE01', expiryAt: minutesFromNow(60) });
  insertSession({ username: 'DEADBEEF0001' });

  const report = await runHotspotExpirySweep();

  assert.equal(report.kicked, 1);
  assert.deepEqual(kickedUsers, ['DEADBEEF0001']);
  assert.match(report.details[0].reason, /deleted/);
});

test('a disabled account loses its live session', async () => {
  insertAccount({ username: '3E134F0F7D70', expiryAt: minutesFromNow(60), disabled: 1 });
  insertSession({ username: '3E134F0F7D70' });

  const report = await runHotspotExpirySweep();

  assert.equal(report.kicked, 1);
  assert.match(report.details[0].reason, /disabled/);
});

test('the trial is limited per line (IP), not only per MAC', () => {
  const first = claimTrial(db, 1, 'AABBCCDDEE01', '10.0.0.5');
  assert.equal(first.claimed, true);

  // A randomized MAC on the same hotspot line is still the same customer.
  const spoofed = claimTrial(db, 1, '112233445566', '10.0.0.5');
  assert.equal(spoofed.claimed, false);

  // A genuinely different line still gets its trial.
  const neighbour = claimTrial(db, 1, '112233445566', '10.0.0.6');
  assert.equal(neighbour.claimed, true);

  // Same MAC again today is refused whatever the IP.
  assert.equal(claimTrial(db, 1, 'AABBCCDDEE01', '10.0.0.9').claimed, false);
});

test('a loopback or missing IP cannot consume the per-line claim', () => {
  assert.equal(claimTrial(db, 1, 'AABBCCDDEE02', '127.0.0.1').claimed, true);
  // The loopback claim is ignored, so the same line is still free for a device
  // that actually reports its hotspot address.
  assert.equal(claimTrial(db, 1, 'AABBCCDDEE03', '10.0.0.7').claimed, true);
  assert.equal(claimTrial(db, 1, 'AABBCCDDEE04', '10.0.0.7').claimed, false);
});

test('a failed grant releases both the MAC and the line claim', () => {
  const claim = claimTrial(db, 1, 'AABBCCDDEE05', '10.0.0.8');
  assert.equal(claim.claimed, true);
  releaseTrialClaim(db, 1, 'AABBCCDDEE05', claim, '10.0.0.8');
  assert.equal(claimTrial(db, 1, 'AABBCCDDEE05', '10.0.0.8').claimed, true);
});

test('trial settings keep the operator value and clamp only absurd lengths', () => {
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  db.prepare('UPDATE system_settings SET trial_enabled = 1, trial_minutes = 120 WHERE id = 1').run();
  assert.equal(getTrialSettings(db).minutes, 120, 'the shop decides how long the trial is');

  db.prepare('UPDATE system_settings SET trial_minutes = 99999 WHERE id = 1').run();
  assert.equal(getTrialSettings(db).minutes, MAX_TRIAL_MINUTES);

  db.prepare('UPDATE system_settings SET trial_minutes = 0 WHERE id = 1').run();
  assert.equal(getTrialSettings(db).minutes, 15);
});

test('crediting time heals duplicate rows instead of shadowing them', () => {
  // The exact production shape: a compact row (what auth reads) plus a stale
  // colon-shape duplicate (what the panel showed) with an old expiry.
  insertAccount({ username: 'EC9A0C150B4F', expiryAt: '2026-11-25 18:57:10' });
  insertAccount({ username: 'ec:9a:0c:15:0b:4f', expiryAt: '2026-11-24 10:00:00' });

  const before = Date.now();
  const result = creditMacAccount(db, 1, 'EC9A0C150B4F', 15, 'radius');
  const rows = db.prepare(
    `SELECT username, expiry_at, disabled FROM hotspot_users
     WHERE UPPER(REPLACE(username, ':', '')) = 'EC9A0C150B4F'`
  ).all();

  assert.equal(rows.length, 2, 'no third row is created');
  for (const row of rows) {
    assert.equal(row.expiry_at, result.expiryAt, `${row.username} shows the credited time`);
    assert.equal(Number(row.disabled), 0);
  }
  assert.ok(Date.parse(result.expiryAt.replace(' ', 'T') + 'Z') >= before + 14 * 60 * 1000 - 5000);
  assert.equal(result.hadRemaining, false);
});

test('crediting stacks on the best duplicate row', () => {
  insertAccount({ username: 'AABBCCDDEE09', expiryAt: minutesFromNow(10) });
  insertAccount({ username: 'aa:bb:cc:dd:ee:09', expiryAt: '2026-11-24 10:00:00' });

  const result = creditMacAccount(db, 1, 'AABBCCDDEE09', 15, 'radius');

  assert.equal(result.hadRemaining, true, 'the 10 remaining minutes are not lost');
  const expectedMs = Date.now() + 10 * 60 * 1000 + 15 * 60 * 1000;
  const actualMs = Date.parse(result.expiryAt.replace(' ', 'T') + 'Z');
  assert.ok(Math.abs(actualMs - expectedMs) < 60 * 1000, `got ${result.expiryAt}`);
});
