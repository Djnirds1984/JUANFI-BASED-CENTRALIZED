const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// The wallet holds real money, so these tests run against an in-memory database
// and a faked coin machine: nothing is ever sent to hardware, and the real
// controller database is never opened.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

// Keep SQL coverage available on Node 22+ workstations without the native
// addon. Production still uses better-sqlite3, unchanged.
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
  console.log('wallet tests: using in-memory node:sqlite fallback');
}

const { initializeDatabase, getDb } = require('../src/database');
initializeDatabase();
const db = getDb();

const jwt = require('jsonwebtoken');
const express = require('express');
const registry = require('../src/services/deviceRegistry');
const walletService = require('../src/services/wallet');
const { nodeMcuService } = require('../src/services/nodemcu');
const { mikroTikService: mt } = require('../src/services/mikrotik');

// One router, one time package (the wallet prices time off the GCash table), one
// registered coin machine. The machine is deliberately NOT the address a phone
// could type, so the panel's registry lookup is what the tests exercise.
db.prepare("INSERT INTO routers (name, host, username, password, is_active) VALUES ('TEST-ROUTER', '10.9.9.1', 'admin', 'x', 1)").run();
db.prepare("INSERT INTO payment_rates (label, amount, minutes, is_active, sort_order) VALUES ('1 hour', 10, 60, 1, 1)").run();
const ROUTER_ID = db.prepare('SELECT id FROM routers ORDER BY id LIMIT 1').get().id;
const RATE_ID = db.prepare('SELECT id FROM payment_rates ORDER BY id LIMIT 1').get().id;
const MACHINE = { id: 7, name: 'AJC-TEST', ip: '10.9.9.141', username: 'admin', password: '', mac: '', routerId: ROUTER_ID };

let machines = [MACHINE];
registry.loadDevices = () => machines;
registry.findDevice = (id) => machines.find((d) => d.id === id);
registry.findDeviceByIp = (ip) => machines.find((d) => String(d.ip).trim() === String(ip).trim());

// The router starts out unreachable: a wallet load must still credit the money
// and remember that the machine's hotspot user still needs removing.
let routerConnected = false;
let removedUsers = [];
// What the router's local user list holds. A coin machine writes a user named
// after the code it settles, so a wallet load leaves a free account behind.
let routerUsers = [];
mt.isConnected = () => routerConnected;
mt.getHotspotUsers = async () => routerUsers;
mt.removeHotspotUser = async (_routerId, id) => {
  removedUsers.push(id);
  routerUsers = routerUsers.filter((u) => u['.id'] !== id);
  return true;
};

// What the coin machine answers when the controller asks it to settle a session.
let machineReply = { status: 'settled', coins: 20, timeAdded: 3600, validity: 60 };
const realSettle = nodeMcuService.settleCoinSession;
nodeMcuService.settleCoinSession = async () => machineReply;

// ---- http harness ----
let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/wallet', require('../src/api/wallet').default);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  nodeMcuService.settleCoinSession = realSettle;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const ADMIN_TOKEN = jwt.sign({ userId: 1, username: 'municipal', role: 'admin' }, process.env.JWT_SECRET);

function call(path, { method = 'GET', body, token } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

const MAC_A = 'AA:BB:CC:DD:EE:01';
const MAC_B = 'AA:BB:CC:DD:EE:02';

// Fixture accounts are created through the service so the HTTP rate limiters
// stay free for the requests each test is actually about.
async function makeAccount(email, { password = 'secret123', pin = '', mac = MAC_A } = {}) {
  const account = await walletService.createAccount({
    email, password, pin, full_name: 'Test Customer', mobile: '09171234567',
    mac, routerId: ROUTER_ID, verified: true,
  });
  return { account, token: walletService.signClientToken(account), password, pin };
}

function sessionRow(code) {
  return db.prepare('SELECT * FROM wallet_topup_sessions WHERE code = ?').get(code);
}
function ledger(reference) {
  return db.prepare('SELECT * FROM wallet_transactions WHERE reference = ?').get(reference);
}

test('wallet config is public and reuses the online-payment time packages', async () => {
  const res = await call('/api/wallet/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.rates.length, 1);
  assert.equal(res.body.rates[0].amount_centavos, 1000);
  assert.equal(res.body.rates[0].minutes, 60);
});

test('registration validates, signs the customer in, and refuses a reused email', async () => {
  const bad = await call('/api/wallet/register', {
    method: 'POST',
    body: { email: 'not-an-email', password: 'secret123', full_name: 'A', mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /valid email/i);

  const ok = await call('/api/wallet/register', {
    method: 'POST',
    body: { email: 'Customer@Example.com', password: 'secret123', pin: '4321', full_name: 'Myra Cruz', mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.ok(ok.body.token, 'registration signs the customer in right away');
  assert.equal(ok.body.account.email, 'customer@example.com', 'the email is normalized');
  assert.equal(ok.body.account.balance, 0);
  assert.equal(ok.body.account.has_pin, true);

  const dupe = await call('/api/wallet/register', {
    method: 'POST',
    body: { email: 'customer@example.com', password: 'secret123', full_name: 'Other', mac: MAC_B, routerId: ROUTER_ID },
  });
  assert.equal(dupe.status, 409);
  assert.match(dupe.body.error, /FORGOT PASSWORD/i);
});

test('a customer token cannot reach the staff routes and a staff token cannot reach the wallet routes', async () => {
  const { token } = await makeAccount('scope@example.com');
  const asAdmin = await call('/api/wallet/admin/accounts', { token });
  assert.equal(asAdmin.status, 401, 'the wallet mount must sit behind the staff gate');

  const asCustomer = await call('/api/wallet/me', { token: ADMIN_TOKEN });
  assert.equal(asCustomer.status, 401, 'an admin signature is not a customer session');

  const anonymous = await call('/api/wallet/me');
  assert.equal(anonymous.status, 401);

  const staff = await call('/api/wallet/admin/summary', { token: ADMIN_TOKEN });
  assert.equal(staff.status, 200);
});

test('sign-in fails the same way for an unknown address and locks after five wrong tries', async () => {
  const { token, password } = await makeAccount('lock@example.com');
  const unknown = await call('/api/wallet/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'whatever', mac: MAC_A } });
  const wrong = await call('/api/wallet/login', { method: 'POST', body: { email: 'lock@example.com', password: 'nope', mac: MAC_A } });
  assert.equal(unknown.body.error, wrong.body.error, 'the portal must not reveal who has a wallet');

  let last;
  for (let i = 0; i < 5; i++) {
    last = await call('/api/wallet/login', { method: 'POST', body: { email: 'lock@example.com', password: `guess${i}`, mac: MAC_A } });
  }
  assert.match(last.body.error, /too many|locked/i);
  // The correct password is refused while locked, and the live token still works.
  const afterLock = await call('/api/wallet/login', { method: 'POST', body: { email: 'lock@example.com', password, mac: MAC_A } });
  assert.match(afterLock.body.error, /locked|Too many/i);
  assert.equal((await call('/api/wallet/me', { token })).status, 200);
});

test('password restore is only offered to a device the wallet has used, and it signs the others out', async () => {
  const { account } = await makeAccount('restore@example.com', { mac: MAC_A });

  const stranger = await call('/api/wallet/forgot', { method: 'POST', body: { email: 'restore@example.com', mac: MAC_B, routerId: ROUTER_ID } });
  assert.equal(stranger.status, 200);
  assert.match(stranger.body.message, /device chat|agent/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wallet_auth_codes WHERE account_id = ? AND purpose = 'reset'").get(account.id).n, 0,
    'an unknown device must not get a code issued at all');

  const mine = await call('/api/wallet/forgot', { method: 'POST', body: { email: 'restore@example.com', mac: MAC_A, routerId: ROUTER_ID } });
  assert.equal(mine.status, 200);
  const code = db.prepare("SELECT * FROM wallet_auth_codes WHERE account_id = ? AND purpose = 'reset'").get(account.id);
  assert.ok(code, 'a recognized device gets a code');
  assert.notEqual(code.code_hash, '123456', 'only the hash is stored');
  const chat = db.prepare('SELECT body FROM chat_messages ORDER BY id DESC LIMIT 1').get();
  assert.match(chat.body, /restore/i, 'the code is delivered into the portal chat');

  const wrongCode = await call('/api/wallet/reset', {
    method: 'POST', body: { email: 'restore@example.com', code: '000000', password: 'brandnew1', mac: MAC_A },
  });
  assert.equal(wrongCode.status, 400);

  // Reading the plain code back is impossible (it is hashed), so the test issues
  // a known one through the same helper the endpoint uses.
  db.prepare("UPDATE wallet_auth_codes SET used_at = datetime('now') WHERE id = ?").run(code.id);
  const known = '246813';
  // device_mac is stored normalized (lowercase, no colons changed), so the
  // fixture has to match what the endpoint wrote for the real code.
  db.prepare('INSERT INTO wallet_auth_codes (account_id, purpose, code_hash, device_mac, expires_at) VALUES (?, ?, ?, ?, datetime(\'now\', \'+30 minutes\'))')
    .run(account.id, 'reset', walletService.sha256(known), MAC_A.toLowerCase());

  const fromOtherDevice = await call('/api/wallet/reset', {
    method: 'POST', body: { email: 'restore@example.com', code: known, password: 'brandnew1', mac: MAC_B },
  });
  assert.equal(fromOtherDevice.status, 403, 'a code issued to one device cannot be redeemed on another');

  const oldToken = walletService.signClientToken(db.prepare('SELECT * FROM wallet_accounts WHERE id = ?').get(account.id));
  const done = await call('/api/wallet/reset', {
    method: 'POST', body: { email: 'restore@example.com', code: known, password: 'brandnew1', mac: MAC_A },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok(done.body.token);
  assert.equal((await call('/api/wallet/me', { token: done.body.token })).status, 200, 'this device stays signed in');
  assert.equal((await call('/api/wallet/me', { token: oldToken })).status, 401, 'every other device is signed out');

  const replay = await call('/api/wallet/reset', {
    method: 'POST', body: { email: 'restore@example.com', code: known, password: 'brandnew1', mac: MAC_A },
  });
  assert.equal(replay.status, 400, 'a code is single-use');

  const relog = await call('/api/wallet/login', { method: 'POST', body: { email: 'restore@example.com', password: 'brandnew1', mac: MAC_A } });
  assert.equal(relog.status, 200);
});

test('coins are credited from what the machine reports, exactly once', async () => {
  const { account, token } = await makeAccount('coins@example.com');

  // The machine address comes from the panel registry, never from the phone.
  const forged = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { vendoIp: '169.254.1.1', mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(forged.status, 400, 'an address the panel does not manage is refused');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wallet_topup_sessions').get().n, 0);

  const start = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(start.status, 201);
  assert.match(start.body.code, /^W[A-Z0-9]{9}$/);
  assert.equal(start.body.device_ip, MACHINE.ip);

  machineReply = { status: 'settled', coins: 25, timeAdded: 0, validity: 0 };
  const claim = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: start.body.code } });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.coins, 25, 'the machine total is the amount, not anything the client sent');
  assert.equal(claim.body.amount, 25);
  assert.equal(claim.body.balance, 25);
  assert.equal(sessionRow(start.body.code).status, 'credited');
  assert.equal(ledger(`topup:${start.body.code}`).amount_centavos, 2500);
  assert.equal(claim.body.router_cleanup, 'pending', 'the router was offline, so the cleanup is queued');

  machineReply = { status: 'settled', coins: 999, timeAdded: 0, validity: 0 };
  const twice = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: start.body.code } });
  assert.equal(twice.status, 200);
  assert.equal(twice.body.already_claimed, true);
  assert.equal(twice.body.balance, 25, 'a retry can never pay out the machine counter twice');

  // Somebody else's session is not yours to claim.
  const other = await makeAccount('peeker@example.com', { mac: MAC_B });
  const stolen = await call('/api/wallet/topup/claim', { method: 'POST', token: other.token, body: { code: start.body.code } });
  assert.equal(stolen.status, 404);

  const unknown = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: 'WNOPE NOPE' } });
  assert.equal(unknown.status, 404);
});

test('a machine that does not answer keeps the coins claimable; a taken-over slot closes the session', async () => {
  const { account, token } = await makeAccount('flaky@example.com');
  const start = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  const code = start.body.code;

  machineReply = { status: 'unreachable', coins: 0, timeAdded: 0, validity: 0, error: 'ECONNREFUSED' };
  const down = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code } });
  assert.equal(down.status, 502);
  assert.match(down.body.error, /coins are safe/i);
  assert.equal(sessionRow(code).status, 'open');
  assert.equal(accountBalance(account.id), 0);

  machineReply = { status: 'settled', coins: 12, timeAdded: 0, validity: 0 };
  const retry = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code } });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.amount, 12);
  assert.equal(accountBalance(account.id), 1200);

  const second = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  machineReply = { status: 'busy', coins: 0, timeAdded: 0, validity: 0 };
  const taken = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: second.body.code } });
  assert.equal(taken.status, 409);
  assert.equal(sessionRow(second.body.code).status, 'failed');

  machineReply = { status: 'settled', coins: 0, timeAdded: 0, validity: 0 };
  const third = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  const empty = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: third.body.code } });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /No coins/i);
  assert.equal(sessionRow(third.body.code).status, 'failed');
});

test('the machine account a wallet load leaves behind is cleaned up through staff retry', async () => {
  const { account, token } = await makeAccount('cleanup@example.com');
  const start = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  machineReply = { status: 'settled', coins: 5, timeAdded: 300, validity: 5 };
  const claim = await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: start.body.code } });
  assert.equal(claim.status, 200);
  const row = sessionRow(start.body.code);
  assert.equal(row.cleanup_needed, 1, 'flagged while the router is unreachable');
  assert.equal(removedUsers.length, 0);
  // The machine did create its usual code-named user while settling the coins.
  routerUsers = [{ '.id': '*99', name: start.body.code, limitUptime: '00:05:00' }];

  const pending = await call(`/api/wallet/admin/topups?cleanup=1`, { token: ADMIN_TOKEN });
  assert.ok(pending.body.topups.some((t) => t.id === row.id));

  const summary = await call('/api/wallet/admin/summary', { token: ADMIN_TOKEN });
  assert.ok(summary.body.router_cleanup_pending >= 1);

  routerConnected = true;
  const retry = await call(`/api/wallet/admin/topups/${row.id}/cleanup`, { method: 'POST', token: ADMIN_TOKEN });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.ok, true);
  assert.deepEqual(removedUsers, ['*99'], 'the free hotspot user named after the code is gone');
  assert.equal(sessionRow(start.body.code).cleanup_needed, 0);

  // Back to an offline router so the tests after this one keep exercising the
  // panel-DB-only path the live convert flow runs on.
  routerConnected = false;
  removedUsers = [];
  routerUsers = [];
});

function accountBalance(id) {
  return Number(db.prepare('SELECT balance_centavos FROM wallet_accounts WHERE id = ?').get(id).balance_centavos);
}

test('converting balance buys the package on this device and debits in the same step', async () => {
  const { account, token } = await makeAccount('buyer@example.com', { pin: '1234' });
  machineReply = { status: 'settled', coins: 30, timeAdded: 0, validity: 0 };
  const start = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: start.body.code } });
  assert.equal(accountBalance(account.id), 3000);

  const wrongPin = await call('/api/wallet/convert', {
    method: 'POST', token, body: { rateId: RATE_ID, pin: '9999', mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(wrongPin.status, 403);
  assert.equal(accountBalance(account.id), 3000, 'a refused PIN leaves the money where it is');

  const noRouter = await call('/api/wallet/convert', {
    method: 'POST', token, body: { rateId: RATE_ID, pin: '1234', mac: MAC_A, routerId: 999 },
  });
  assert.equal(noRouter.status, 404);
  assert.equal(accountBalance(account.id), 3000);

  const badMac = await call('/api/wallet/convert', {
    method: 'POST', token, body: { rateId: RATE_ID, pin: '1234', mac: 'not-a-mac', routerId: ROUTER_ID },
  });
  assert.equal(badMac.status, 400);

  const buy = await call('/api/wallet/convert', {
    method: 'POST', token, body: { rateId: RATE_ID, pin: '1234', mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(buy.status, 200, JSON.stringify(buy.body));
  assert.equal(buy.body.minutes, 60);
  assert.equal(buy.body.spent, 10);
  assert.equal(buy.body.balance, 20);
  assert.equal(accountBalance(account.id), 2000);
  assert.ok(buy.body.remainingSeconds > 3500, 'the device got its minute count');

  const user = db.prepare('SELECT * FROM hotspot_users WHERE router_id = ? AND username = ?')
    .get(ROUTER_ID, 'AABBCCDDEE01');
  assert.ok(user, 'the time landed on the device MAC account');
  const entry = db.prepare("SELECT * FROM wallet_transactions WHERE kind = 'time_purchase' AND account_id = ?").get(account.id);
  assert.equal(entry.amount_centavos, -1000);
  assert.equal(entry.minutes, 60);
  assert.equal(entry.balance_after, 2000);

  // Spend the rest, then try to spend more than the wallet holds.
  await call('/api/wallet/convert', { method: 'POST', token, body: { rateId: RATE_ID, pin: '1234', mac: MAC_A, routerId: ROUTER_ID } });
  assert.equal(accountBalance(account.id), 1000);
  const lastCoin = await call('/api/wallet/convert', { method: 'POST', token, body: { rateId: RATE_ID, pin: '1234', mac: MAC_A, routerId: ROUTER_ID } });
  assert.equal(lastCoin.status, 200, 'exactly enough balance still buys the package');
  assert.equal(accountBalance(account.id), 0);
  const broke = await call('/api/wallet/convert', { method: 'POST', token, body: { rateId: RATE_ID, pin: '1234', mac: MAC_A, routerId: ROUTER_ID } });
  assert.equal(broke.status, 400);
  assert.match(broke.body.error, /Insufficient/i);
  assert.equal(accountBalance(account.id), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wallet_transactions WHERE kind = 'time_purchase' AND account_id = ?").get(account.id).n, 3,
    'a refused purchase must not leave a debit behind');
});

test('changing the wallet PIN or password needs the current password', async () => {
  const { account, token } = await makeAccount('pin@example.com');

  const noPassword = await call('/api/wallet/pin', { method: 'POST', token, body: { pin: '1111', current: 'wrong' } });
  assert.equal(noPassword.status, 403);
  assert.equal(db.prepare('SELECT pin_hash FROM wallet_accounts WHERE id = ?').get(account.id).pin_hash, '');

  const shaped = await call('/api/wallet/pin', { method: 'POST', token, body: { pin: '12', current: 'secret123' } });
  assert.equal(shaped.status, 400);

  const saved = await call('/api/wallet/pin', { method: 'POST', token, body: { pin: '1111', current: 'secret123' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.has_pin, true);
  assert.notEqual(db.prepare('SELECT pin_hash FROM wallet_accounts WHERE id = ?').get(account.id).pin_hash, '', 'the PIN is stored hashed');

  const pw = await call('/api/wallet/password', { method: 'POST', token, body: { current: 'nope', next: 'another1' } });
  assert.equal(pw.status, 403);
  const pwOk = await call('/api/wallet/password', { method: 'POST', token, body: { current: 'secret123', next: 'another1' } });
  assert.equal(pwOk.status, 200);
  assert.equal((await call('/api/wallet/me', { token })).status, 401, 'changing the password signs every old device out');
  assert.equal((await call('/api/wallet/me', { token: pwOk.body.token })).status, 200);
});

test('staff can correct a balance but never without a reason', async () => {
  const { account } = await makeAccount('counter@example.com');

  const noReason = await call(`/api/wallet/admin/accounts/${account.id}/adjust`, {
    method: 'POST', token: ADMIN_TOKEN, body: { action: 'credit', amount: 100, reason: '' },
  });
  assert.equal(noReason.status, 400);

  const action = await call(`/api/wallet/admin/accounts/${account.id}/adjust`, {
    method: 'POST', token: ADMIN_TOKEN, body: { action: 'transfer', amount: 100, reason: 'mistake' },
  });
  assert.equal(action.status, 400);

  const credited = await call(`/api/wallet/admin/accounts/${account.id}/adjust`, {
    method: 'POST', token: ADMIN_TOKEN, body: { action: 'credit', amount: 50.5, reason: 'change returned from machine' },
  });
  assert.equal(credited.status, 200);
  assert.equal(credited.body.balance, 50.5);
  const row = db.prepare("SELECT * FROM wallet_transactions WHERE account_id = ? AND kind = 'admin_credit'").get(account.id);
  assert.equal(row.amount_centavos, 5050);
  assert.equal(row.created_by, 'municipal', 'the ledger says which staff member moved the money');

  const overdrawn = await call(`/api/wallet/admin/accounts/${account.id}/adjust`, {
    method: 'POST', token: ADMIN_TOKEN, body: { action: 'debit', amount: 999, reason: 'taking it back' },
  });
  assert.equal(overdrawn.status, 400);
  assert.match(overdrawn.body.error, /Insufficient/i);
  assert.equal(accountBalance(account.id), 5050);

  const frozen = await call(`/api/wallet/admin/accounts/${account.id}/status`, {
    method: 'POST', token: ADMIN_TOKEN, body: { status: 'frozen' },
  });
  assert.equal(frozen.status, 200);
  const live = walletService.signClientToken(db.prepare('SELECT * FROM wallet_accounts WHERE id = ?').get(account.id));
  assert.equal((await call('/api/wallet/me', { token: live })).status, 401, 'freezing signs the customer out at once');

  const detail = await call(`/api/wallet/admin/accounts/${account.id}`, { token: ADMIN_TOKEN });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.account.status, 'frozen');
  assert.equal(detail.body.transactions.length, 1);

  const searched = await call('/api/wallet/admin/accounts?search=counter', { token: ADMIN_TOKEN });
  assert.ok(searched.body.accounts.some((a) => a.id === account.id));
});

test('wallet settings keep money as centavos and refuse impossible values', async () => {
  const saved = await call('/api/wallet/admin/settings', {
    method: 'PUT',
    token: ADMIN_TOKEN,
    body: { enabled: true, coin_value: 1, min_topup: 12.34, max_topup: 5000, min_convert: 10, daily_convert: 1000, topup_validity_min: 20 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.min_topup_centavos, 1234, 'pesos in, whole centavos stored');
  assert.equal(saved.body.daily_convert_centavos, 100000);

  const nonsense = await call('/api/wallet/admin/settings', {
    method: 'PUT', token: ADMIN_TOKEN, body: { topup_validity_min: 99999 },
  });
  assert.equal(nonsense.status, 400);

  // A body aiming at another column is ignored: only the whitelist is written.
  const injected = await call('/api/wallet/admin/settings', {
    method: 'PUT', token: ADMIN_TOKEN, body: { enabled: 1, email: 'x', id: 9 },
  });
  assert.equal(injected.status, 200);

  const off = await call('/api/wallet/admin/settings', { method: 'PUT', token: ADMIN_TOKEN, body: { enabled: false } });
  assert.equal(off.body.enabled, false);
  const { token } = await makeAccount('disabled@example.com');
  const blocked = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(blocked.status, 403);
  const blockedRegister = await call('/api/wallet/register', {
    method: 'POST', body: { email: 'late@example.com', password: 'secret123', full_name: 'Late', mac: MAC_A, routerId: ROUTER_ID },
  });
  assert.equal(blockedRegister.status, 403);
  await call('/api/wallet/admin/settings', { method: 'PUT', token: ADMIN_TOKEN, body: { enabled: true } });
});

test('a daily conversion limit caps what one customer can spend in a day', async () => {
  const cap = await call('/api/wallet/admin/settings', { method: 'PUT', token: ADMIN_TOKEN, body: { daily_convert: 15, min_convert: 1 } });
  assert.equal(cap.status, 200);

  const { token } = await makeAccount('limit@example.com');
  machineReply = { status: 'settled', coins: 40, timeAdded: 0, validity: 0 };
  const start = await call('/api/wallet/topup/start', {
    method: 'POST', token, body: { deviceId: MACHINE.id, mac: MAC_A, routerId: ROUTER_ID },
  });
  await call('/api/wallet/topup/claim', { method: 'POST', token, body: { code: start.body.code } });

  const first = await call('/api/wallet/convert', { method: 'POST', token, body: { rateId: RATE_ID, mac: MAC_A, routerId: ROUTER_ID } });
  assert.equal(first.status, 200);
  const second = await call('/api/wallet/convert', { method: 'POST', token, body: { rateId: RATE_ID, mac: MAC_A, routerId: ROUTER_ID } });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /Daily limit/i);

  await call('/api/wallet/admin/settings', { method: 'PUT', token: ADMIN_TOKEN, body: { daily_convert: 0 } });
});

test('a purchase while the device is online extends that live session', async () => {
  // The customer's complaint this guards: the money left the wallet but the
  // countdown never moved. In RADIUS mode the only way to hand time to a device
  // that stays connected is a CoA-Request, and RouterOS matches it BY THE
  // CLIENT IP alone (anything keyed on Acct-Session-Id / User-Name is NAKed).
  // The new Session-Timeout also replaces the session's TOTAL, so the minutes
  // already used must be added back or the customer pays for them twice.
  await call('/api/wallet/admin/settings', {
    method: 'PUT', token: ADMIN_TOKEN, body: { enabled: true, daily_convert: 0, min_convert: 1 },
  });
  db.prepare("UPDATE routers SET auth_mode = 'radius' WHERE id = ?").run(ROUTER_ID);

  const radiusServer = require('../src/services/radiusServer');
  const realCoA = radiusServer.sendCoASessionTimeout;
  const coa = [];
  radiusServer.sendCoASessionTimeout = (_routerId, nasIp, params) => { coa.push({ nasIp, params }); return true; };
  routerConnected = true;
  mt.getActiveConnections = async () => ([{
    mac: 'AA:BB:CC:DD:EE:01', user: 'AABBCCDDEE01', address: '10.0.0.77/24',
    uptime: '10m0s', 'session-time-left': '00:05:00',
  }]);

  try {
    const { account, token } = await makeAccount('online@example.com');
    const funded = await call(`/api/wallet/admin/accounts/${account.id}/adjust`, {
      method: 'POST', token: ADMIN_TOKEN, body: { action: 'credit', amount: 20, reason: 'test float' },
    });
    assert.equal(funded.status, 200);

    const buy = await call('/api/wallet/convert', {
      method: 'POST', token, body: { rateId: RATE_ID, mac: MAC_A, routerId: ROUTER_ID },
    });
    assert.equal(buy.status, 200, JSON.stringify(buy.body));
    assert.equal(coa.length, 1, 'the live session is told about the time it just paid for');
    assert.equal(coa[0].nasIp, '10.9.9.1');
    assert.equal(coa[0].params.framedIp, '10.0.0.77', 'addressed by the client IP, not by session id');
    assert.equal(coa[0].params.username, 'AABBCCDDEE01');
    assert.equal(coa[0].params.uptimeSeconds, 600, 'the ten minutes already used are added back');
    assert.ok(coa[0].params.remainingSeconds >= 3590, 'the device keeps the whole hour it bought');

    assert.equal(accountBalance(account.id), 1000, 'and exactly one package was debited');
  } finally {
    radiusServer.sendCoASessionTimeout = realCoA;
    delete mt.getActiveConnections;
    routerConnected = false;
    db.prepare("UPDATE routers SET auth_mode = 'api' WHERE id = ?").run(ROUTER_ID);
    await call('/api/wallet/admin/settings', { method: 'PUT', token: ADMIN_TOKEN, body: { min_convert: 10 } });
  }
});
