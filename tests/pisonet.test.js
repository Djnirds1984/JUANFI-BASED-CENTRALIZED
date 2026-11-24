const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Pisonet holds a paying customer's desktop hostage when the meter runs out, so it
// is tested against an in-memory database and a scripted RouterOS. No packet leaves
// the machine and nobody's PC gets locked by a test run.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

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
  console.log('pisonet tests: using in-memory node:sqlite fallback');
}

const { initializeDatabase, getDb } = require('../src/database');
initializeDatabase();
const db = getDb();

const { mikroTikService: mt } = require('../src/services/mikrotik');
const cafe = require('../src/services/cafe');

db.prepare("INSERT INTO routers (name, host, username, password, is_active) VALUES ('CAFE-HEX', '10.8.8.1', 'admin', 'x', 1)").run();
const ROUTER = db.prepare('SELECT id FROM routers ORDER BY id LIMIT 1').get().id;

// ---- scripted router ---------------------------------------------------------
// /ip/hotspot/ip-binding behaves like the menu: a set on an existing .id mutates
// that row, an add appends one, and nothing on the router is ever keyed by comment.
let bindings = [];
let nextBinding = 1;
let routerUp = true;
const arpTable = [];
const leaseTable = [];

mt.isConnected = () => routerUp;
// RouterOS only takes these words for /ip/hotspot/ip-binding type. A mock that
// accepted anything would happily store 'bypass' and the shop would find every PC
// still hitting a login page, so the menu is enforced here.
const BINDING_TYPES = ['bypassed', 'not-bypassed', 'mac-coa'];
const checkType = (data) => {
  if (data && data.type !== undefined && !BINDING_TYPES.includes(data.type)) {
    throw new Error(`400 Bad Request - no such value for type (allowed: ${BINDING_TYPES.join(', ')})`);
  }
};
mt.getIpBindings = async () => bindings.map((b) => ({ ...b }));
mt.createIpBinding = async (_routerId, data) => {
  checkType(data);
  const entry = { '.id': `*${nextBinding++}`, ...data };
  bindings.push(entry);
  return { ret: entry['.id'] };
};
mt.updateIpBinding = async (_routerId, id, data) => {
  checkType(data);
  const entry = bindings.find((b) => b['.id'] === id);
  if (!entry) throw new Error(`400 Bad Request - no such entry ${id}`);
  Object.assign(entry, data);
  return [];
};
mt.deleteIpBinding = async (_routerId, id) => {
  const before = bindings.length;
  bindings = bindings.filter((b) => b['.id'] !== id);
  if (bindings.length === before) throw new Error(`400 Bad Request - no such entry ${id}`);
  return {};
};
mt.getArpEntries = async () => arpTable.map((e) => ({ ...e }));
mt.getDhcpLeases = async () => leaseTable.map((e) => ({ ...e }));

const bindingFor = (machine) => bindings.filter((b) => b.comment === `JuanFi pisonet ${machine.id}`);
const events = (machineId, event) =>
  db.prepare('SELECT * FROM cafe_sessions WHERE machine_id = ? AND event = ? ORDER BY id').all(machineId, event);
const seconds = (value) => Math.round(value / 1000);
const utcMs = (sql) => new Date(`${String(sql).replace(' ', 'T')}Z`).getTime();

// ------------------------------------------------------------------ settings

test('a fresh router has a rate list and no keyboard unlock until one is set', () => {
  const settings = cafe.getCafeSettings(ROUTER);
  assert.equal(settings.router_id, ROUTER);
  assert.equal(settings.currency, 'PHP');
  assert.equal(settings.pause_on_admin, 1);
  assert.equal(settings.admin_password_hash, '');
  assert.equal(cafe.hasAdminPassword(ROUTER), false);

  const rates = cafe.parseRateList(settings.rate_list);
  assert.equal(rates.length, 4);
  assert.deepEqual(rates[0], { label: '15 Minutes', minutes: 15, amount: 10 });
  // A line the cashier could not price is not a rate at all.
  assert.deepEqual(cafe.parseRateList('WEEK#0#500|broken|2 Hours#120#35').map((r) => r.minutes), [120]);
});

test('saving settings never overwrites the admin password', async () => {
  await cafe.setAdminPassword(ROUTER, 'cafe-0519');
  const saved = cafe.saveCafeSettings(ROUTER, { currency: 'Php', default_minutes: '9000', rate_list: '1 Hour#60#20' });
  assert.equal(saved.currency, 'Php');
  assert.equal(saved.default_minutes, 24 * 60, 'a stray huge number is clamped, not trusted');
  assert.equal(saved.rate_list, '1 Hour#60#20');
  assert.equal(cafe.hasAdminPassword(ROUTER), true, 'the hash survives an unrelated edit');
  assert.equal(await cafe.verifyAdminPassword(ROUTER, 'cafe-0519'), true);
  assert.equal(await cafe.verifyAdminPassword(ROUTER, 'cafe-0520'), false);
});

test('setting an admin password on a router nobody has opened the page for keeps the starter rates', async () => {
  db.prepare("INSERT INTO routers (name, host, username, password, is_active) VALUES ('CAFE-HEX-2', '10.8.8.2', 'admin', 'x', 1)").run();
  const other = db.prepare("SELECT id FROM routers WHERE name = 'CAFE-HEX-2'").get().id;
  // The owner does the obvious first thing: types a password. The row this creates
  // must carry the same starter values a plain read would have shown.
  await cafe.setAdminPassword(other, 'first-password');
  const settings = cafe.getCafeSettings(other);
  assert.equal(cafe.parseRateList(settings.rate_list).length, 4, 'the price buttons are still there');
  assert.equal(settings.currency, 'PHP');
  assert.equal(settings.pause_on_admin, 1, 'time still freezes during an admin session');
  assert.equal(cafe.hasAdminPassword(other), true);
  assert.equal(await cafe.verifyAdminPassword(other, 'first-password'), true);
  // And clearing it again must not invent a row with nothing in it.
  await cafe.setAdminPassword(other, '');
  assert.equal(cafe.hasAdminPassword(other), false);
  assert.equal(cafe.parseRateList(cafe.getCafeSettings(other).rate_list).length, 4);
});

// ------------------------------------------------------------------ adopting

test('a desktop is adopted with a bypass binding so it never sees a login page', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-01', macAddress: 'aa:bb:cc:dd:ee:01', hostname: 'DESKTOP-01', ipAddress: '10.8.8.11' });
  assert.equal(machine.mode, 'client');
  assert.equal(machine.running, 0, 'adopting a PC is not a sale - nobody paid yet');
  assert.equal(cafe.remainingSeconds(machine), 0);
  assert.equal(machine.token.length, 40);
  assert.match(machine.mac_address, /^AA:BB:CC:DD:EE:01$/, 'the MAC is stored the way RouterOS writes it');

  const owned = bindingFor(machine);
  assert.equal(owned.length, 1);
  assert.equal(owned[0].type, 'bypassed');
  assert.equal(owned[0]['mac-address'], 'AA:BB:CC:DD:EE:01');
  assert.equal(owned[0].server, 'all');
  assert.equal(events(machine.id, 'added').length, 1);
});

test('a second desktop cannot take a MAC that is already in use', async () => {
  await assert.rejects(
    () => cafe.addCafeMachine(ROUTER, { name: 'PC-02', macAddress: 'AABBCCDDEE01' }),
    (err) => err.status === 409 && /already using that MAC/.test(err.message)
  );
  // Re-adopting under another spelling of the same address is the same mistake.
  await assert.rejects(() => cafe.addCafeMachine(ROUTER, { name: 'PC-02b', macAddress: 'aa-bb-cc-dd-ee-01' }), (err) => err.status === 409);
});

test('a machine added while the router is offline is still registered and gets re-pushed later', async () => {
  routerUp = false;
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-OFF', macAddress: 'AA:BB:CC:DD:EE:FF' });
  assert.equal(bindingFor(machine).length, 0, 'nothing was written to a router that is not answering');
  routerUp = true;

  const report = await cafe.reconcileBindings(ROUTER);
  assert.ok(report.fixed >= 1, 'the sweep pushes the missing bypass');
  assert.equal(bindingFor(machine)[0].type, 'bypassed');
});

test('a PC that beaconed without a MAC gets its address from the router', async () => {
  const beacon = cafe.noteAgentHello({ hostname: 'DESKTOP-LOST', ip: '10.8.8.55', mac: '', version: '1.0.0' });
  assert.equal(beacon.known, false);
  const candidate = cafe.listCandidates(60).find((c) => c.hostname === 'DESKTOP-LOST');
  assert.ok(candidate, 'the Add dialog can see it as installed-but-not-added');

  arpTable.push({ address: '10.8.8.55', 'mac-address': 'AA:BB:CC:DD:EE:55' });
  assert.equal(await cafe.resolveMac(ROUTER, '10.8.8.55'), 'AABBCCDDEE55');
  // No ARP entry (a box that has been quiet) still answers from the lease table.
  leaseTable.push({ address: '10.8.8.99', 'mac-address': '11:22:33:44:55:66' });
  assert.equal(await cafe.resolveMac(ROUTER, '10.8.8.99'), '112233445566');
  assert.equal(await cafe.resolveMac(ROUTER, '10.8.8.123'), '', 'an address the router does not know stays unknown');
});

test('an installed agent picks its own token up once the shop adds it', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-CLAIM', macAddress: 'AA:BB:CC:DD:EE:11', hostname: 'DESKTOP-CLAIM' });
  // Before the add, the beacon could not claim anything; after it, the MAC matches.
  assert.equal(cafe.claimAgentMachine({ mac: 'AA:BB:CC:DD:EE:11' }), machine.token);
  assert.equal(cafe.claimAgentMachine({ mac: 'AA:BB:CC:DD:EE:99' }), null, 'an unknown PC gets nothing');

  // A token already in use is never handed to a second machine: once this one has
  // phoned home it is no longer claimable.
  cafe.agentHeartbeat(machine.token, { bootId: 'boot-1' });
  assert.equal(cafe.claimAgentMachine({ mac: 'AA:BB:CC:DD:EE:11' }), null);
});

// -------------------------------------------------------------------- money

test('selling minutes extends what is already bought instead of restarting it', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-SELL', macAddress: 'AA:BB:CC:DD:EE:02' });
  assert.equal(cafe.machineState(machine, cafe.getCafeSettings(ROUTER)).locked, true, 'no time yet, so the desktop is locked');

  const started = await cafe.startCafeSession(ROUTER, machine.id, 60, 20, 'cashier1');
  const state = cafe.machineState(started, cafe.getCafeSettings(ROUTER));
  assert.equal(state.locked, false);
  assert.ok(Math.abs(state.secondsLeft - 3600) <= 2, `about an hour, got ${state.secondsLeft}`);
  assert.equal(events(machine.id, 'started').length, 1);

  const topped = await cafe.startCafeSession(ROUTER, machine.id, 30, 10, 'cashier1');
  assert.ok(Math.abs(cafe.remainingSeconds(topped) - 5400) <= 2, 'the 60 minutes already paid for are kept');
  assert.equal(events(machine.id, 'extended').length, 1);
  assert.equal(events(machine.id, 'started').length, 1, 'a top-up is not a new sale of the same clock');

  await assert.rejects(() => cafe.startCafeSession(ROUTER, machine.id, 0), (err) => err.status === 400);
  await assert.rejects(() => cafe.startCafeSession(ROUTER, machine.id, 100000), (err) => err.status === 400);
});

test('a locked machine costs nothing: the meter stops at the freeze instant', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-PAUSE', macAddress: 'AA:BB:CC:DD:EE:03' });
  const running = await cafe.startCafeSession(ROUTER, machine.id, 120, 35, 'cashier');
  const tenMinutes = Date.now() + 10 * 60000;

  // Ten minutes of play, then the cashier locks it.
  const spent = { ...running, expires_at: running.expires_at, running: 1 };
  assert.ok(cafe.remainingSeconds(spent, tenMinutes) < 7200, 'a live meter does drain');

  const paused = cafe.pauseCafeMachine(ROUTER, machine.id, 'client', 'cashier', 'paused');
  const held = cafe.remainingSeconds(paused, tenMinutes);
  assert.equal(cafe.remainingSeconds(paused, tenMinutes + 3600000), held, 'an hour later it still reads the same');
  assert.equal(cafe.machineState(paused, cafe.getCafeSettings(ROUTER)).locked, true);
  assert.equal(cafe.machineState(paused, cafe.getCafeSettings(ROUTER)).lockAt, null, 'nothing to count down to');

  // Resuming buys from where it stopped.
  const resumed = await cafe.startCafeSession(ROUTER, machine.id, 15, 5, 'cashier');
  assert.ok(Math.abs(cafe.remainingSeconds(resumed) - (held + 900)) <= 3, 'banked time plus the new 15 minutes');
});

test('the money ledger only counts sales and knows who did them', () => {
  const summary = cafe.cafeSummary(ROUTER, 1);
  const sold = db.prepare("SELECT * FROM cafe_sessions WHERE event IN ('started','extended')").all();
  assert.ok(sold.length >= 3, 'the earlier tests made real sales');
  assert.equal(summary.sales, sold.length, 'only money events are a sale');
  assert.equal(summary.minutes, sold.reduce((n, r) => n + r.minutes, 0));
  assert.equal(summary.amount, sold.reduce((n, r) => n + r.amount, 0));
  // Locking, unlocking, expiry and adoption all belong on the same ledger, but
  // none of them are money.
  const chores = db.prepare("SELECT COUNT(*) AS c FROM cafe_sessions WHERE event NOT IN ('started','extended')").get();
  assert.ok(chores.c > 0);
  const sale = summary.recent.find((row) => row.event === 'extended');
  assert.equal(sale.operator, 'cashier1');
});

test('resetting wipes paid time and releasing hands a serviced PC back paused', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-RESET', macAddress: 'AA:BB:CC:DD:EE:04' });
  await cafe.startCafeSession(ROUTER, machine.id, 60, 20, 'cashier');
  const cleared = cafe.resetCafeMachine(ROUTER, machine.id, 'owner');
  assert.equal(cleared.expires_at, null);
  assert.equal(cleared.running, 0);
  assert.equal(cafe.remainingSeconds(cleared), 0);
  assert.equal(cafe.machineState(cleared, cafe.getCafeSettings(ROUTER)).locked, true);

  cafe.pauseCafeMachine(ROUTER, machine.id, 'admin', 'owner', 'unlocked');
  const released = await cafe.releaseCafeMachine(ROUTER, machine.id, 'owner');
  assert.equal(released.mode, 'client');
  assert.equal(released.running, 0, 'the next customer has not paid yet');

  // Releasing a machine nobody unlocked is a no-op, not a surprise lock.
  const untouched = await cafe.releaseCafeMachine(ROUTER, machine.id, 'owner');
  assert.equal(untouched.mode, 'client');
});

// ------------------------------------------------------------ the admin story

// Captured by the unlock test and reused by the reboot and handback tests, since
// the exact instant the meter was frozen is the only honest baseline.
let adminBanked = 0;

test('the keyboard unlock is answered by the panel, not by anything on the PC', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-ADMIN', macAddress: 'AA:BB:CC:DD:EE:05' });
  await cafe.startCafeSession(ROUTER, machine.id, 90, 30, 'cashier');
  // The agent reports its boot id before anybody hands it over, which is what
  // lets the panel tell "the shop owner unlocked this" from "this PC was restarted".
  cafe.agentHeartbeat(machine.token, { bootId: 'boot-aaaa', ip: '10.8.8.50' });
  // Read the clock at the moment of the handover: a loaded test run can burn a
  // couple of seconds between the sale and the unlock, and that time is spent.
  adminBanked = cafe.remainingSeconds(db.prepare('SELECT * FROM cafe_machines WHERE id = ?').get(machine.id));
  assert.ok(Math.abs(adminBanked - 5400) <= 5);

  const denied = await cafe.agentUnlock(machine.token, 'guessing');
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Wrong admin password/);
  assert.equal(events(machine.id, 'unlock-denied').length, 1, 'a shop owner can see somebody fished at it');
  assert.equal(db.prepare('SELECT mode FROM cafe_machines WHERE id = ?').get(machine.id).mode, 'client');

  const granted = await cafe.agentUnlock(machine.token, 'cafe-0519');
  assert.equal(granted.ok, true);
  assert.equal(granted.state.mode, 'admin');
  assert.equal(granted.state.locked, false, 'the desktop is usable while the owner works');
  assert.equal(granted.state.lockAt, null, 'no countdown to the lock screen');
  assert.ok(Math.abs(granted.state.secondsLeft - adminBanked) <= 2, 'the customer keeps the time they had');

  // Twenty minutes of patching later, none of it is charged to the customer.
  const row = db.prepare('SELECT * FROM cafe_machines WHERE id = ?').get(machine.id);
  assert.ok(Math.abs(cafe.remainingSeconds(row, Date.now() + 20 * 60000) - adminBanked) <= 2, `the meter froze, got ${cafe.remainingSeconds(row, Date.now() + 1200000)}`);
  assert.equal(events(machine.id, 'unlocked')[0].operator, 'agent');
});

test('a reboot drops the admin session and brings the lock straight back', async () => {
  const machine = db.prepare("SELECT * FROM cafe_machines WHERE name = 'PC-ADMIN'").get();
  // Same boot id as the one on file: Windows did not go through startup, so the
  // shop owner keeps the desktop.
  const steady = cafe.agentHeartbeat(machine.token, { bootId: 'boot-aaaa' });
  assert.equal(steady.mode, 'admin');
  assert.equal(steady.locked, false);
  assert.equal(events(machine.id, 'rebooted').length, 0);

  const beat = cafe.agentHeartbeat(machine.token, { bootId: 'boot-cccc' });
  assert.equal(beat.mode, 'client');
  assert.equal(beat.locked, true, 'Windows went through startup, so the customer screen is back');
  assert.ok(Math.abs(beat.secondsLeft - adminBanked) <= 3, 'and the banked time is still on the clock');
  assert.equal(beat.lockAt, null, 'nothing to count down to - it is locked this instant');
  assert.equal(events(machine.id, 'rebooted').length, 1);
  assert.equal(events(machine.id, 'rebooted')[0].detail, 'admin unlock dropped');

  // The new boot id is what is remembered from here on.
  cafe.agentHeartbeat(machine.token, { bootId: 'boot-cccc' });
  assert.equal(events(machine.id, 'rebooted').length, 1);
});

test('handing the machine back from its own settings window locks it and keeps the time', async () => {
  const machine = db.prepare("SELECT * FROM cafe_machines WHERE name = 'PC-ADMIN'").get();
  await cafe.agentUnlock(machine.token, 'cafe-0519');
  const handed = cafe.agentRelock(machine.token);
  assert.equal(handed.ok, true);
  assert.equal(handed.state.mode, 'client');
  assert.equal(handed.state.locked, true);
  assert.ok(Math.abs(handed.state.secondsLeft - adminBanked) <= 3);
  assert.equal(events(machine.id, 'released').length, 1);

  // An agent with a token the panel does not know gets an error, never a free pass.
  const ghost = cafe.agentRelock('deadbeef'.repeat(5));
  assert.equal(ghost.ok, false);
  assert.match(ghost.error, /not registered/);
});

test('without an admin password the keyboard cannot be used to get in', async () => {
  const machine = db.prepare("SELECT * FROM cafe_machines WHERE name = 'PC-SELL'").get();
  await cafe.startCafeSession(ROUTER, machine.id, 30, 10, 'cashier');
  const before = machine.mode;
  await cafe.setAdminPassword(ROUTER, '');
  const blocked = await cafe.agentUnlock(machine.token, 'anything');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /No admin password/);
  assert.equal(db.prepare('SELECT mode FROM cafe_machines WHERE id = ?').get(machine.id).mode, before);
  await cafe.setAdminPassword(ROUTER, 'cafe-0519');
});

// ------------------------------------------------------------------- heartbeat

test('the heartbeat hands over an absolute instant so the panel may disappear', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-BEAT', macAddress: 'AA:BB:CC:DD:EE:06' });
  await cafe.startCafeSession(ROUTER, machine.id, 15, 5, 'cashier');

  const beat = cafe.agentHeartbeat(machine.token, { bootId: 'boot-1', ip: '10.8.8.60', version: '1.0.0', hostname: 'DESKTOP-BEAT' });
  assert.equal(beat.machineId, machine.id);
  assert.equal(beat.paused, false);
  assert.equal(beat.locked, false);
  assert.ok(Math.abs(beat.secondsLeft - 900) <= 2);
  assert.ok(Math.abs(utcMs(beat.lockAt) - (Date.now() + 900000)) <= 3000, 'lockAt is the deadline, not a number to count');

  const stored = db.prepare('SELECT * FROM cafe_machines WHERE id = ?').get(machine.id);
  assert.equal(stored.ip_address, '10.8.8.60');
  assert.equal(stored.hostname, 'DESKTOP-BEAT');
  assert.equal(stored.agent_version, '1.0.0');
  assert.equal(cafe.listCafeMachines(ROUTER).find((m) => m.id === machine.id).online, true);

  // Unknown token: the agent has to be told its PC is not in the shop yet.
  assert.equal(cafe.agentHeartbeat('ffffffff'.repeat(5), { bootId: 'x' }), null);
});

test('a loopback heartbeat does not overwrite the address the shop typed in', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-LOCALIP', macAddress: 'AA:BB:CC:DD:EE:0B', ipAddress: '10.8.8.11' });
  // The panel was poked from its own box (a local test, or a proxy without
  // X-Forwarded-For). 127.0.0.1 is not where the desktop lives.
  cafe.agentHeartbeat(machine.token, { bootId: 'boot-a', ip: '127.0.0.1' });
  assert.equal(db.prepare('SELECT ip_address FROM cafe_machines WHERE id = ?').get(machine.id).ip_address, '10.8.8.11');
  // An address the agent reports from its own NIC does move it.
  cafe.agentHeartbeat(machine.token, { bootId: 'boot-a', ip: '10.8.8.77' });
  assert.equal(db.prepare('SELECT ip_address FROM cafe_machines WHERE id = ?').get(machine.id).ip_address, '10.8.8.77');
  // Same story for a beacon: it must not be filed as a desktop sitting on the router.
  cafe.noteAgentHello({ hostname: 'DESKTOP-LOCAL', ip: '127.0.0.1', mac: '' });
  assert.equal(cafe.listCandidates(60).find((c) => c.hostname === 'DESKTOP-LOCAL').ip_address, '');
});

test('a machine that runs out reports it once', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-EXPIRE', macAddress: 'AA:BB:CC:DD:EE:07' });
  await cafe.startCafeSession(ROUTER, machine.id, 60, 20, 'cashier');
  db.prepare("UPDATE cafe_machines SET expires_at = datetime('now','-1 minute') WHERE id = ?").run(machine.id);

  const beat = cafe.agentHeartbeat(machine.token, { bootId: 'boot-2' });
  assert.equal(beat.locked, true);
  assert.equal(beat.secondsLeft, 0);
  // The agent is still handed the deadline it blew past, so it locks at once
  // instead of waiting for an instruction that will never change.
  assert.ok(utcMs(beat.lockAt) <= Date.now(), 'lockAt is already in the past');

  cafe.agentHeartbeat(machine.token, { bootId: 'boot-2' });
  cafe.agentHeartbeat(machine.token, { bootId: 'boot-2' });
  assert.equal(events(machine.id, 'expired').length, 1, 'the expiry is written once, not on every poll');
  assert.equal(db.prepare('SELECT running FROM cafe_machines WHERE id = ?').get(machine.id).running, 0);
});

test('the ticker expires the machines that are switched off mid-session', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-TICK', macAddress: 'AA:BB:CC:DD:EE:08' });
  await cafe.startCafeSession(ROUTER, machine.id, 5, 5, 'cashier');
  db.prepare("UPDATE cafe_machines SET expires_at = datetime('now','-10 seconds'), last_seen = NULL WHERE id = ?").run(machine.id);

  const report = cafe.cafeTick(Date.now());
  assert.ok(report.expired >= 1);
  const row = db.prepare('SELECT * FROM cafe_machines WHERE id = ?').get(machine.id);
  assert.equal(row.running, 0);
  assert.equal(events(machine.id, 'expired').length, 1);
  // A second pass must not double-book the same expiry.
  assert.equal(cafe.cafeTick(Date.now()).expired, 0);
});

test('forgetting a desktop takes its router bypass with it', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-GONE', macAddress: 'AA:BB:CC:DD:EE:09' });
  assert.equal(bindingFor(machine).length, 1);
  assert.equal(await cafe.removeCafeMachine(ROUTER, machine.id), true);
  assert.equal(bindingFor(machine).length, 0, 'a forgotten PC must go back through the hotspot login');
  assert.equal(db.prepare('SELECT * FROM cafe_machines WHERE id = ?').get(machine.id), undefined);
  assert.equal(await cafe.removeCafeMachine(ROUTER, machine.id), false);
});

test('an edit that renames a desktop does not lose its binding', async () => {
  const machine = await cafe.addCafeMachine(ROUTER, { name: 'PC-EDIT', macAddress: 'AA:BB:CC:DD:EE:0A' });
  const renamed = await cafe.updateCafeMachine(ROUTER, machine.id, { name: 'PC-17', ipAddress: '10.8.8.17' });
  assert.equal(renamed.name, 'PC-17');
  assert.equal(renamed.mac_address, 'AA:BB:CC:DD:EE:0A');
  assert.equal(bindingFor(renamed).length, 1, 'still exactly one binding for this machine');
});

// ------------------------------------------------- what the panel must not leak

test('the admin password is a hash and the panel never tells an agent more than its own machine', () => {
  const stored = db.prepare('SELECT admin_password_hash FROM cafe_settings WHERE router_id = ?').get(ROUTER);
  assert.ok(stored.admin_password_hash.startsWith('$2'), 'bcrypt, never plaintext');
  assert.ok(!stored.admin_password_hash.includes('cafe-0519'));
  // A token only ever resolves through its own row, so a PC cannot ask about another.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'cafe.ts'), 'utf8');
  const agentBlock = source.slice(source.indexOf('agent endpoints'), source.indexOf('admin endpoints'));
  assert.ok(agentBlock.includes('authMiddleware'), 'the agent half runs before the admin half and stays there');
  assert.ok(!/router\/:routerId/.test(agentBlock), 'no agent route can name a router or list machines');
});

// ------------------------------------------------------- panel/agent contract
//
// The C# agent and the TypeScript panel are written in different languages and run
// on different boxes, so the strings they agree on are checked against each other
// here instead of in a manual test at the shop.

const agentDir = path.join(__dirname, '..', 'cafe-client');
const agentSources = fs.existsSync(path.join(agentDir, 'src'))
  ? fs.readdirSync(path.join(agentDir, 'src')).filter((f) => f.endsWith('.cs')).map((f) => ({ name: f, text: fs.readFileSync(path.join(agentDir, 'src', f), 'utf8') }))
  : [];
const agentAll = agentSources.map((s) => s.text).join('\n');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'cafe.ts'), 'utf8');

test('the agent exists and is what the panel offers for download', () => {
  assert.ok(agentSources.length >= 6, 'the agent sources are there to build');
  assert.ok(agentAll.includes('build.ps1') || fs.existsSync(path.join(agentDir, 'build.ps1')), 'and a build script that needs no SDK');
  assert.match(apiSource, /'cafe-client', 'dist', 'JuanFiCafe\.exe'/, 'the download route serves the path build.ps1 writes to');
});

test('every panel endpoint the agent calls is really mounted', () => {
  assert.ok(agentAll.length > 0, 'agent sources found');
  const called = new Set();
  for (const match of agentAll.matchAll(/PanelApi\("([^"]+)"\)/g)) called.add(match[1]);
  assert.ok(called.size >= 4, `the agent should be calling hello, heartbeat, unlock and relock, saw ${[...called]}`);
  const mounted = new Set([...apiSource.matchAll(/router\.(?:get|post|put|delete)\('([^']+)'/g)].map((m) => m[1]));
  for (const route of called) {
    assert.ok(mounted.has(route), `the agent calls ${route} but the panel does not have it`);
  }
  assert.ok(mounted.has('/discover'), 'the HTTP discovery twin is mounted');
});

test('the agent speaks the same discovery protocol as the panel', () => {
  const discovery = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'cafeDiscovery.ts'), 'utf8');
  const magic = discovery.match(/MAGIC = '([^']+)'/)[1];
  const answer = discovery.match(/ANSWER = '([^']+)'/)[1];
  const port = Number(discovery.match(/CAFE_DISCOVERY_PORT \|\| '(\d+)'/)[1]);
  assert.ok(agentAll.includes(`"${magic}"`), 'the agent shouts the token the panel listens for');
  assert.ok(agentAll.includes(`"${answer}`), 'and reads the reply the panel sends');
  assert.ok(agentAll.includes(`DiscoveryPort = ${port}`), 'on the same UDP port');
  const version = discovery.match(/AGENT_VERSION = '([^']+)'/)[1];
  assert.ok(agentAll.includes(`Version = "${version}"`), 'and the version the panel reports is the agent version');
});

test('the admin handover is the part the shop asked for and cannot be faked locally', () => {
  // Ctrl+Alt+F12 is the only way in from the keyboard, and it asks the panel.
  assert.match(agentAll, /VK_F12 = 0x7B/);
  assert.match(agentAll, /Held\(VK_CONTROL\) && Held\(VK_MENU\)/);
  assert.ok(agentAll.includes('PanelClient.Unlock(token, password)'), 'the password goes to the panel');
  assert.ok(!/Set\("(Password|AdminPassword)"/.test(agentAll), 'and is never written into config.ini');
  // The lock screen keeps working with the panel gone: it is given an instant, and
  // the agent caches its own state so a reboot cannot buy free time.
  assert.match(agentAll, /MiniJson\.Str\(state, "name", machineName\)/);
  assert.ok(agentAll.includes('Config.Set("LastPhase"') && agentAll.includes('Config.Set("LastStamp"'), 'state is cached across a restart');
});

test('the agent starts itself on boot so rebooting is not an escape', () => {
  assert.ok(agentAll.includes('Software\\Microsoft\\Windows\\CurrentVersion\\Run'), 'it writes the Windows Run key');
  assert.ok(agentAll.includes('InstallAutostart()'), 'the Run entry is written by the agent itself');
  assert.ok(agentAll.includes('Config.GetFlag("AutoStart", true) && !Config.AutostartInstalled()'), 'and re-armed on every startup');
  // The panel notices the restart through boot_id, which is the other half of the deal.
  assert.ok(agentAll.includes('BootId = Guid.NewGuid'), 'a boot id is generated per process');
});

// -------------------------------------------------------------- admin wiring

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const apiClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('leaving the Pisonet page stops its poller', () => {
  const navigate = appSource.slice(appSource.indexOf('  navigate(page) {'), appSource.indexOf('  async renderPage('));
  assert.match(navigate, /this\.clearCafePollers\(\)/, 'the 3-second table refresh has to be torn down');
  assert.match(appSource, /_cafeInterval = setInterval/, 'and there is a refresh to tear down');
  assert.match(appSource, /case 'pisonet': await this\.renderPisonet\(\); break;/);
  assert.match(shell, /data-page="pisonet"/);
});

test('the api client has a method for every endpoint the page calls', () => {
  const start = appSource.indexOf('async renderPisonet()');
  const block = appSource.slice(start, appSource.indexOf('openModal(title, bodyHtml', start));
  const used = new Set([...block.matchAll(/\bapi\.([A-Za-z0-9_]+)\(/g)].map((m) => m[1]));
  assert.ok(used.size >= 6, `the page should be talking to the panel, saw ${[...used]}`);
  for (const name of used) {
    assert.ok(new RegExp(`\\b${name}\\s*\\(`).test(apiClientSource), `api.${name}() is missing from api.js`);
  }
});

test('a machine row refreshes its clock without rebuilding the table', () => {
  assert.match(appSource, /cafeStateKey\(m\) \{/);
  assert.match(appSource, /_cafeMachines = machines/, 'the sell dialog reads the live rows');
  assert.match(appSource, /data-cafe-id=/, 'rows are patched in place by machine id');
});
