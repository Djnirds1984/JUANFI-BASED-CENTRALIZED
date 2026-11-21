const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

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
const devices = require('../src/services/activeDevices');
const radius = require('../src/services/radiusServer');
const { config } = require('../src/config');
initializeDatabase();
const db = getDb();

// Router commands and RADIUS datagrams are captured, never sent to hardware.
let connected, bindings, live, hosts, kicks, hostKicks, bindingFailure, holdBindings;
mt.isConnected = () => connected;
mt.getIpBindings = async () => { if (holdBindings) await holdBindings; return bindings; };
mt.createIpBinding = async (routerId, data) => {
  if (bindingFailure) throw new Error('Router rejected binding');
  bindings.push({ '.id': `*${bindings.length + 1}`, ...data });
};
mt.updateIpBinding = async (routerId, id, data) => {
  if (bindingFailure) throw new Error('Router rejected binding');
  Object.assign(bindings.find(b => b['.id'] === id), data);
};
mt.deleteIpBinding = async (routerId, id) => {
  if (bindingFailure) throw new Error('Router rejected binding');
  bindings = bindings.filter(b => b['.id'] !== id);
};
mt.getActiveConnections = async () => live;
mt.getHotspotHosts = async () => hosts;
mt.removeActiveConnection = async (routerId, id) => { kicks.push(id); live = live.filter(c => c['.id'] !== id); };
mt.removeHotspotHost = async (routerId, id) => { hostKicks.push(id); hosts = hosts.filter(c => c['.id'] !== id); };
mt.resetHotspotUserCounters = async () => true;
mt.setUserUptimeLimit = async () => true;

const sockets = [];
// The walled-garden pass also opens the coin machines for pre-login clients.
// Never read the developer's real data/nodemcu-devices.json here: the machine
// list must not be able to change router-side assertions.
const vendoService = require('../src/services/vendoConfig');
const originalVendoList = vendoService.listVendoAddresses;
let vendoAddresses = [];
vendoService.listVendoAddresses = () => vendoAddresses;
const dgram = require('node:dgram');
const originalCreateSocket = dgram.createSocket;
dgram.createSocket = () => {
  const socket = new EventEmitter();
  socket.sent = [];
  socket.bind = (port, callback) => callback();
  socket.close = () => {};
  socket.send = (packet, offset, length, port, host, callback) => {
    socket.sent.push(Buffer.from(packet));
    if (callback) callback(null);
  };
  sockets.push(socket);
  return socket;
};

const mac = 'AA:BB:CC:DD:EE:02';
const newDevice = (overrides = {}, routerId = 1) => devices.createActiveDevice(routerId, { macAddress: mac, hostname: 'Phone', ...overrides });
const row = id => db.prepare('SELECT * FROM active_devices WHERE id = ?').get(id);
const account = username => db.prepare('SELECT * FROM hotspot_users WHERE LOWER(username) = LOWER(?)').get(username);
const status = expected => error => error.status === expected;
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

beforeEach(() => {
  if (radius.isRadiusRunning()) radius.stopRadiusServer();
  db.exec('DELETE FROM routers; DELETE FROM device_macs; DELETE FROM device_sessions;');
  db.prepare("INSERT INTO routers (id, name, host, username, password, auth_mode) VALUES (?, 'Test', ?, 'test', '', 'radius')").run(1, '127.0.0.1');
  db.prepare("INSERT INTO routers (id, name, host, username, password, auth_mode) VALUES (?, 'Other', ?, 'test', '', 'radius')").run(2, '127.0.0.2');
  connected = false;
  bindings = []; live = []; hosts = []; kicks = []; hostKicks = [];
  bindingFailure = false; holdBindings = null; sockets.length = 0;
});

after(() => {
  vendoService.listVendoAddresses = originalVendoList;
  if (radius.isRadiusRunning()) radius.stopRadiusServer();
  dgram.createSocket = originalCreateSocket;
  db.close();
});

test('migration is repeatable; manual creation validates and normalizes identity', () => {
  initializeDatabase();
  const d = newDevice();
  assert.equal(row(d.id).mac_address, mac.toLowerCase());
  assert.equal(row(d.id).status, 'offline');
  assert.equal(row(d.id).access_mode, 'normal');
  assert.throws(() => newDevice({ macAddress: 'aabbccddee02' }), status(409));
  assert.throws(() => newDevice({ macAddress: 'not a mac' }), status(400));
  assert.throws(() => newDevice({ ipAddress: '999.1.1.1' }), status(400));
  assert.throws(() => newDevice({}, 999), status(404));
  assert.throws(() => newDevice({}, 1.5), status(400));
  assert.ok(newDevice({}, 2).id);
});

test('hostname and access policy survive sync; reused DHCP IP cannot inherit policy', () => {
  const d = newDevice({ ipAddress: '192.0.2.10' });
  devices.updateActiveDevice(1, d.id, { hostname: 'Owner\'s "Phone"' });
  db.prepare("UPDATE active_devices SET access_mode = 'blocked' WHERE id = ?").run(d.id);
  devices.syncActiveDevices(1, [{ mac: mac.replace(/:/g, '-'), address: '192.0.2.10', hostname: 'DHCP name' }]);
  assert.equal(devices.listActiveDevices(1)[0]['host-name'], 'Owner\'s "Phone"');
  assert.equal(devices.listActiveDevices(1)[0]['access-mode'], 'blocked');
  devices.syncActiveDevices(1, [{ mac: 'AA:BB:CC:DD:EE:04', address: '192.0.2.10' }]);
  assert.equal(devices.listActiveDevices(1).length, 2);
  assert.equal(row(d.id).status, 'offline');
  assert.equal(row(d.id).access_mode, 'blocked');
  devices.updateActiveDevice(1, d.id, { hostname: '' });
  assert.equal(row(d.id).custom_hostname, '');
  assert.throws(() => devices.updateActiveDevice(1, d.id, { hostname: 'x'.repeat(254) }), status(400));
  assert.equal(devices.updateActiveDevice(2, d.id, { hostname: 'wrong router' }), null);
});

test('block, bypass and normal manage only owned bindings and disconnect matching MAC', async () => {
  const d = newDevice(); connected = true;
  live = [{ '.id': '*A', mac, user: 'shared' }, { '.id': '*B', mac: 'AA:BB:CC:DD:EE:04', user: 'shared' }];
  hosts = [{ '.id': '*H', 'mac-address': mac }];
  await devices.setActiveDeviceAccess(1, d.id, 'blocked');
  assert.equal(bindings[0].type, 'blocked');
  assert.equal(bindings[0].server, 'all');
  assert.deepEqual(kicks, ['*A']);
  assert.deepEqual(hostKicks, ['*H']);
  await devices.setActiveDeviceAccess(1, d.id, 'bypassed');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].type, 'bypassed');
  assert.equal(row(d.id).access_mode, 'bypassed');
  hosts = [{ '.id': '*BYPASS', 'mac-address': mac }];
  await devices.setActiveDeviceAccess(1, d.id, 'normal');
  assert.equal(bindings.length, 0);
  assert.equal(row(d.id).access_mode, 'normal');
  assert.ok(hostKicks.includes('*BYPASS'));
});

test('disconnected routers, conflicting bindings, invalid modes and write failures are not reported as saved', async () => {
  const d = newDevice();
  await assert.rejects(devices.setActiveDeviceAccess(1, d.id, 'blocked'), status(409));
  connected = true;
  await assert.rejects(devices.setActiveDeviceAccess(2, d.id, 'blocked'), status(404));
  await assert.rejects(devices.setActiveDeviceAccess(1, d.id, 'anything'), status(400));
  bindings = [{ '.id': '*OTHER', 'mac-address': mac, type: 'bypassed', comment: 'Operator rule' }];
  await assert.rejects(devices.setActiveDeviceAccess(1, d.id, 'blocked'), status(409));
  assert.equal(bindings[0].type, 'bypassed');
  bindings = []; bindingFailure = true;
  await assert.rejects(devices.setActiveDeviceAccess(1, d.id, 'blocked'), /Router rejected/);
  assert.equal(row(d.id).access_mode, 'normal');
});

test('wildcard and subnet bindings cannot silently override a new block', async () => {
  const d = newDevice({ ipAddress: '192.0.2.10' }); connected = true;
  bindings = [{ '.id': '*SUBNET', 'mac-address': '00:00:00:00:00:00', address: '192.0.2.0/24', type: 'bypassed' }];
  await assert.rejects(devices.setActiveDeviceAccess(1, d.id, 'blocked'), status(409));
  bindings[0].address = '192.0.2.1-192.0.2.50';
  await assert.rejects(devices.setActiveDeviceAccess(1, d.id, 'blocked'), status(409));
  bindings[0].address = '198.51.100.0/24';
  await devices.setActiveDeviceAccess(1, d.id, 'blocked');
  assert.equal(bindings.length, 2);
  assert.equal(bindings[0].type, 'bypassed');
});

test('a saved access rule reports a warning if immediate disconnection fails', async () => {
  const d = newDevice(); connected = true;
  const original = mt.getHotspotHosts;
  mt.getHotspotHosts = async () => { throw new Error('Router unreachable'); };
  try {
    const result = await devices.setActiveDeviceAccess(1, d.id, 'blocked');
    assert.equal(row(d.id).access_mode, 'blocked');
    assert.match(result.warning, /could not be disconnected/);
  } finally { mt.getHotspotHosts = original; }
});

test('RouterOS bindings use the correct API words and REST verbs', async () => {
  const service = new mt.constructor();
  const commands = [];
  service.getClient = () => ({ write: async (...args) => { commands.push(args); return []; } });
  await service.createIpBinding(1, { type: 'blocked' });
  await service.updateIpBinding(1, '*1', { type: 'bypassed' });
  await service.deleteIpBinding(1, '*1');
  await service.removeHotspotHost(1, '*H');
  assert.deepEqual(commands[1][0], ['/ip/hotspot/ip-binding/set', '=.id=*1', '=type=bypassed']);
  assert.deepEqual(commands[3][0], ['/ip/hotspot/host/remove', '=.id=*H']);
  const requests = [];
  service.routerConfigs.set(1, { useRestApi: true });
  service.restApiCall = async (router, method, path) => { requests.push([method, path]); };
  await service.createIpBinding(1, { type: 'blocked' });
  await service.updateIpBinding(1, '*1', { type: 'bypassed' });
  await service.deleteIpBinding(1, '*1');
  await service.removeHotspotHost(1, '*H');
  assert.deepEqual(requests, [
    ['PUT', '/ip/hotspot/ip-binding'], ['PATCH', '/ip/hotspot/ip-binding/*1'],
    ['DELETE', '/ip/hotspot/ip-binding/*1'], ['DELETE', '/ip/hotspot/host/*H'],
  ]);
});

test('overlapping mutations on a device are rejected', async () => {
  const d = newDevice(); connected = true;
  let release;
  holdBindings = new Promise(resolve => { release = resolve; });
  const first = devices.setActiveDeviceAccess(1, d.id, 'blocked');
  await assert.rejects(devices.deleteActiveDevice(1, d.id), status(409));
  release();
  await first;
  assert.equal(row(d.id).access_mode, 'blocked');
});

test('offline time creates a MAC account, stacks expiry, survives migration and preserves block', async () => {
  const d = newDevice();
  const first = await devices.addActiveDeviceTime(1, d.id, 10);
  assert.ok(first.remainingSeconds >= 599 && first.remainingSeconds <= 600);
  assert.equal(first.coa, 'not-sent');
  db.prepare("UPDATE active_devices SET access_mode = 'blocked' WHERE id = ?").run(d.id);
  const second = await devices.addActiveDeviceTime(1, d.id, 5);
  assert.ok(second.remainingSeconds >= 898 && second.remainingSeconds <= 900);
  assert.equal(row(d.id).access_mode, 'blocked');
  initializeDatabase();
  assert.equal(row(d.id).access_mode, 'blocked');
  assert.ok(devices.listActiveDevices(1)[0]['paid-seconds-left'] >= 897);
  db.prepare("UPDATE hotspot_users SET expiry_at = datetime('now', '-1 day')").run();
  const revived = await devices.addActiveDeviceTime(1, d.id, 1);
  assert.ok(revived.remainingSeconds >= 59 && revived.remainingSeconds <= 60);
  for (const invalid of [0, -1, 1.5, '10', 525601, null]) {
    await assert.rejects(devices.addActiveDeviceTime(1, d.id, invalid), status(400));
  }
});

test('time resolves centralized MAC aliases and refuses disabled or missing named accounts', async () => {
  const d = newDevice();
  db.prepare("INSERT INTO hotspot_users (router_id, username, password, expiry_at) VALUES (2, 'roaming-user', '', ?)").run(stamp(Date.now() + 600000));
  db.prepare('INSERT INTO device_macs (mac_address, username, router_id) VALUES (?, ?, 2)').run(mac.toLowerCase(), 'roaming-user');
  db.prepare('UPDATE active_devices SET user = ? WHERE id = ?').run(mac, d.id);
  const result = await devices.addActiveDeviceTime(1, d.id, 5);
  assert.ok(result.remainingSeconds >= 898);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hotspot_users').get().n, 1);
  db.prepare('UPDATE hotspot_users SET disabled = 1').run();
  await assert.rejects(devices.addActiveDeviceTime(1, d.id, 5), status(409));
  db.exec('DELETE FROM device_macs; DELETE FROM hotspot_users;');
  db.prepare("UPDATE active_devices SET user = 'missing-account' WHERE id = ?").run(d.id);
  await assert.rejects(devices.addActiveDeviceTime(1, d.id, 5), status(404));
});

test('time preserves a finite live balance when the account has no expiry yet', async () => {
  const d = newDevice(); connected = true;
  live = [{ '.id': '*A', mac, user: mac, 'session-time-left': '10m' }];
  const result = await devices.addActiveDeviceTime(1, d.id, 5);
  assert.ok(result.remainingSeconds >= 899 && result.remainingSeconds <= 900);
});

test('delete removes managed access rules and the record, but retains paid accounts', async () => {
  const d = newDevice();
  await devices.addActiveDeviceTime(1, d.id, 10);
  connected = true;
  await devices.setActiveDeviceAccess(1, d.id, 'bypassed');
  connected = false;
  await assert.rejects(devices.deleteActiveDevice(1, d.id), status(409));
  assert.ok(row(d.id));
  connected = true;
  await devices.deleteActiveDevice(1, d.id);
  assert.equal(bindings.length, 0);
  assert.equal(row(d.id), undefined);
  assert.ok(account(mac));
  await assert.rejects(devices.deleteActiveDevice(1, d.id), status(404));
});

function radiusRequest(username, callingMac) {
  const attrs = [[1, username], [31, callingMac]].filter(([, value]) => value).map(([type, value]) => {
    const text = Buffer.from(value);
    return Buffer.concat([Buffer.from([type, text.length + 2]), text]);
  });
  const packet = Buffer.concat([Buffer.alloc(20), ...attrs]);
  packet[0] = 1; packet[1] = 17; packet.writeUInt16BE(packet.length, 2);
  crypto.randomBytes(16).copy(packet, 4);
  sockets[0].emit('message', packet, { address: '127.0.0.1', port: 40000 });
  return sockets[0].sent.at(-1);
}

test('RADIUS rejects a blocked MAC before account fallback or expired grace; normal restores login', async () => {
  const d = newDevice();
  await devices.addActiveDeviceTime(1, d.id, 10);
  db.prepare("INSERT INTO radius_clients (router_id, shared_secret) VALUES (1, 'test-only')").run();
  radius.startRadiusServer();
  assert.equal(radiusRequest(mac, mac)[0], 2);
  connected = true;
  await devices.setActiveDeviceAccess(1, d.id, 'blocked');
  db.prepare("UPDATE hotspot_users SET expiry_at = datetime('now', '-1 day')").run();
  assert.equal(radiusRequest(mac, mac.toLowerCase())[0], 3);
  assert.equal(radiusRequest(mac.replace(/:/g, '-'), '')[0], 3);
  await devices.setActiveDeviceAccess(1, d.id, 'normal');
  await devices.addActiveDeviceTime(1, d.id, 10);
  assert.equal(radiusRequest(mac, mac)[0], 2);
});

test('expired grace is one-shot: refresh cannot farm free 60s sessions; top-up re-arms it', async () => {
  const d = newDevice();
  await devices.addActiveDeviceTime(1, d.id, 10);
  db.prepare("UPDATE hotspot_users SET expiry_at = datetime('now', '-1 hour')").run();
  db.prepare("INSERT INTO radius_clients (router_id, shared_secret) VALUES (1, 'test-only')").run();
  radius.startRadiusServer();

  // First auth after expiry: a SINGLE short grace to reach the portal.
  const first = radiusRequest(mac, mac);
  assert.equal(first[0], 2);
  assert.equal(radiusSessionTimeout(first), config.radiusExpiredGraceSec);
  assert.ok(account(mac).grace_used_at);

  // Refresh / reconnect must NOT grant another free minute.
  assert.equal(radiusRequest(mac, mac)[0], 3);
  assert.equal(radiusRequest(mac, mac.toLowerCase())[0], 3);

  // A top-up restores paid time (and re-arms the next cycle's grace).
  await devices.addActiveDeviceTime(1, d.id, 10);
  const paid = radiusRequest(mac, mac);
  assert.equal(paid[0], 2);
  assert.ok(radiusSessionTimeout(paid) > config.radiusExpiredGraceSec);

  // Next expiry cycle (previous grace stamp older than the new expiry):
  // exactly ONE new grace, then reject again.
  db.prepare("UPDATE hotspot_users SET expiry_at = datetime('now', '-1 minute'), grace_used_at = datetime('now', '-1 hour')").run();
  const again = radiusRequest(mac, mac);
  assert.equal(again[0], 2);
  assert.equal(radiusSessionTimeout(again), config.radiusExpiredGraceSec);
  assert.equal(radiusRequest(mac, mac)[0], 3);
});

test('voucher redeem credits the MAC identity (MAC-as-voucher mode), single-use and stacking', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/vouchers', require('../src/api/vouchers').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/vouchers`;
  const post = (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const macKey = mac.replace(/:/g, '');
  const insertVoucher = code => db.prepare(
    `INSERT INTO vouchers (router_id, code, username, profile, duration_minutes) VALUES (1, ?, ?, 'default', 10)`
  ).run(code, code);
  // Isolate from accounts/vouchers left behind by earlier tests.
  db.prepare('DELETE FROM hotspot_users WHERE router_id = 1').run();
  db.prepare('DELETE FROM vouchers WHERE router_id = 1').run();
  try {
    insertVoucher('TESTVC01');
    db.prepare(`INSERT INTO hotspot_users (router_id, username, password, comment, disabled)
                VALUES (1, 'TESTVC01', '', 'Voucher: TESTVC01', 0)`).run();

    // Redeem (code typed lower-case) credits the MAC account, marks the
    // voucher used and disables the voucher's own account.
    const res = await post('/redeem', { mac, code: 'testvc01', routerId: 1 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.success);
    assert.ok(Math.abs(body.remainingSeconds - 600) < 5, `remaining ${body.remainingSeconds}`);
    assert.equal(db.prepare('SELECT is_used FROM vouchers WHERE code = ?').get('TESTVC01').is_used, 1);
    assert.equal(account('TESTVC01').disabled, 1);
    const acct = account(macKey);
    assert.ok(acct, 'MAC account created');
    const expiryMs = new Date(acct.expiry_at.replace(' ', 'T') + 'Z').getTime();
    assert.ok(Math.abs(expiryMs - (Date.now() + 600000)) < 5000);

    // RADIUS accepts the MAC with exactly the redeemed time.
    db.prepare("INSERT INTO radius_clients (router_id, shared_secret) VALUES (1, 'test-only')").run();
    radius.startRadiusServer();
    const accept = radiusRequest(mac, mac);
    assert.equal(accept[0], 2);
    const timeout = radiusSessionTimeout(accept);
    assert.ok(timeout >= 595 && timeout <= 600, `Session-Timeout ${timeout}`);

    // Single-use: replay rejected; unknown code rejected.
    assert.equal((await post('/redeem', { mac, code: 'TESTVC01', routerId: 1 })).status, 409);
    assert.equal((await post('/redeem', { mac, code: 'NOPE1234', routerId: 1 })).status, 404);

    // A second voucher stacks onto the same MAC account.
    insertVoucher('TESTVC02');
    const stacked = await post('/redeem', { mac, code: 'TESTVC02', routerId: 1 });
    assert.equal(stacked.status, 200);
    const sb = await stacked.json();
    assert.ok(Math.abs(sb.remainingSeconds - 1200) < 5, `stacked ${sb.remainingSeconds}`);
  } finally {
    db.prepare("DELETE FROM vouchers WHERE code IN ('TESTVC01','TESTVC02')").run();
    db.prepare("DELETE FROM hotspot_users WHERE username IN ('TESTVC01','TESTVC02')").run();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('first login cannot overwrite an admin top-up with profile validity', async () => {
  const d = newDevice();
  await devices.addActiveDeviceTime(1, d.id, 60);
  const profile = db.prepare("INSERT INTO radius_profiles (router_id, name, validity_period) VALUES (1, 'Short validity', 60)").run();
  db.prepare('UPDATE hotspot_users SET radius_profile_id = ?').run(profile.lastInsertRowid);
  const expiry = account(mac).expiry_at;
  db.prepare("INSERT INTO radius_clients (router_id, shared_secret) VALUES (1, 'test-only')").run();
  radius.startRadiusServer();
  assert.equal(radiusRequest(mac, mac)[0], 2);
  assert.equal(account(mac).expiry_at, expiry);
});

test('generated vouchers do not self-expire: an old unused voucher still redeems', async () => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const app = express();
  app.use(express.json());
  app.use('/api/vouchers', require('../src/api/vouchers').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ userId: 1, username: 'admin', role: 'admin' }, process.env.JWT_SECRET);
  const post = (path, body, auth) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    db.exec('DELETE FROM hotspot_users; DELETE FROM vouchers;');
    const gen = await post('/api/vouchers/router/1/generate', { count: 1, durationMinutes: 60 }, token);
    assert.equal(gen.status, 201);
    const code = gen.body.vouchers[0].code;
    const v = db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
    assert.equal(v.expires_at, null, 'voucher must not expire on its own session length');

    // Simulate a voucher printed days ago: still redeemable onto the MAC.
    db.prepare("UPDATE vouchers SET created_at = datetime('now', '-3 days') WHERE id = ?").run(v.id);
    const redeemMac = 'AA:BB:CC:DD:EE:31';
    const res = await post('/api/vouchers/redeem', { mac: redeemMac, code, routerId: 1 });
    assert.equal(res.status, 200);
    assert.ok(res.body.remainingSeconds >= 3595 && res.body.remainingSeconds <= 3600);
    assert.equal(db.prepare('SELECT is_used FROM vouchers WHERE id = ?').get(v.id).is_used, 1);
  } finally {
    db.exec('DELETE FROM hotspot_users; DELETE FROM vouchers;');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('voucher generation stores the selling price and rejects invalid prices', async () => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const app = express();
  app.use(express.json());
  app.use('/api/vouchers', require('../src/api/vouchers').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ userId: 1, username: 'admin', role: 'admin' }, process.env.JWT_SECRET);
  const post = (path, body) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    db.exec('DELETE FROM hotspot_users; DELETE FROM vouchers;');
    const gen = await post('/api/vouchers/router/1/generate', { count: 2, durationMinutes: 60, price: 5.5 });
    assert.equal(gen.status, 201);
    assert.equal(gen.body.vouchers[0].price, 5.5);
    const rows = db.prepare('SELECT price FROM vouchers').all();
    assert.equal(rows.length, 2);
    for (const r of rows) assert.equal(r.price, 5.5);

    // Optional: omitted price defaults to 0; negative / non-numeric rejected.
    const free = await post('/api/vouchers/router/1/generate', { count: 1 });
    assert.equal(free.status, 201);
    assert.equal(db.prepare('SELECT price FROM vouchers WHERE code = ?').get(free.body.vouchers[0].code).price, 0);
    assert.equal((await post('/api/vouchers/router/1/generate', { count: 1, price: -5 })).status, 400);
    assert.equal((await post('/api/vouchers/router/1/generate', { count: 1, price: 'abc' })).status, 400);
  } finally {
    db.exec('DELETE FROM hotspot_users; DELETE FROM vouchers;');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('voucher account first login gets the voucher duration, not days of profile validity', async () => {
  const profile = db.prepare("INSERT INTO radius_profiles (router_id, name, validity_period) VALUES (1, 'Two days', 172800)").run();
  db.prepare("INSERT INTO hotspot_users (router_id, username, password, comment, radius_profile_id, disabled) VALUES (1, 'TESTVACC', '', 'Voucher: TESTVACC', ?, 0)")
    .run(profile.lastInsertRowid);
  db.prepare("INSERT INTO vouchers (router_id, code, username, profile, duration_minutes, radius_profile_id) VALUES (1, 'TESTVACC', 'TESTVACC', 'Two days', 30, ?)")
    .run(profile.lastInsertRowid);
  db.prepare("INSERT INTO radius_clients (router_id, shared_secret) VALUES (1, 'test-only')").run();
  radius.startRadiusServer();
  const accept = radiusRequest('TESTVACC', 'AA:BB:CC:DD:EE:32');
  assert.equal(accept[0], 2);
  assert.equal(radiusSessionTimeout(accept), 1800);
  const expiryMs = new Date(account('TESTVACC').expiry_at.replace(' ', 'T') + 'Z').getTime();
  assert.ok(Math.abs(expiryMs - (Date.now() + 1800000)) < 5000, 'expiry must be voucher duration, not profile validity');
  assert.equal(db.prepare("SELECT is_used FROM vouchers WHERE code = 'TESTVACC'").get().is_used, 1);
});

test('full-RADIUS cleanup strips trial login so devices cannot bypass RADIUS', async () => {
  db.prepare("INSERT INTO routers (id, name, host, username, password, auth_mode) VALUES (77, 'Trial', '127.0.0.77', 'test', '', 'radius')").run();
  const updates = [];
  const origUsers = mt.getHotspotUsers, origProfiles = mt.getHotspotProfiles, origUpdate = mt.updateHotspotProfile;
  mt.getHotspotUsers = async () => [];
  mt.getHotspotProfiles = async () => [
    { '.id': '*1', name: 'hsprof1', 'login-by': 'http-chap,https,http-pap,trial' },
    { '.id': '*2', name: 'default', 'login-by': 'cookie,http-chap' },
    { '.id': '*3', name: 'trialonly', 'login-by': 'trial' },
  ];
  mt.updateHotspotProfile = async (routerId, id, data) => { updates.push({ routerId, id, data }); };
  try {
    await devices.ensureRadiusOnlyLocalUsers(77);
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0], { routerId: 77, id: '*1', data: { 'login-by': 'http-chap,https,http-pap' } });
    assert.deepEqual(updates[1], { routerId: 77, id: '*3', data: { 'login-by': 'http-chap' } });
  } finally {
    mt.getHotspotUsers = origUsers;
    mt.getHotspotProfiles = origProfiles;
    mt.updateHotspotProfile = origUpdate;
    db.prepare('DELETE FROM routers WHERE id = 77').run();
  }
});

test('live time requests CoA but does not claim acknowledgment', async () => {
  const d = newDevice(); connected = true;
  live = [{ '.id': '*A', mac, user: mac, address: '192.0.2.10', 'session-time-left': '2m' }];
  db.prepare("INSERT INTO radius_clients (router_id, shared_secret) VALUES (1, 'test-only')").run();
  radius.startRadiusServer();
  const result = await devices.addActiveDeviceTime(1, d.id, 5);
  assert.equal(result.coa, 'requested');
  assert.equal(sockets[1].sent.at(-1)[0], 43);
  assert.match(result.warning, /reconnect/i);
});

test('authenticated HTTP CRUD routes validate bodies and enforce router scope', async () => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const app = express();
  app.use(express.json());
  app.use('/hotspot', require('../src/api/hotspot').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/hotspot/router`;
  const token = jwt.sign({ id: 1, username: 'test', role: 'admin' }, config.jwtSecret);
  const request = (path, method, body, authenticated = true) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await request('/1/devices', 'POST', { macAddress: mac }, false)).status, 401);
    const created = await request('/1/devices', 'POST', { macAddress: mac, hostname: 'Phone' });
    assert.equal(created.status, 201);
    const id = (await created.json()).device.id;
    assert.equal((await request(`/2/devices/${id}/access`, 'PUT', { mode: 'blocked' })).status, 404);
    assert.equal((await request(`/1/devices/${id}`, 'PUT', { hostname: 'Renamed' })).status, 200);
    assert.equal((await request(`/1/devices/${id}/extend`, 'POST', { minutes: 'bad' })).status, 400);
    assert.equal((await request(`/1/devices/${id}/extend`, 'POST', { minutes: 5 })).status, 200);
    assert.equal((await request('/1/devices', 'GET')).status, 200);
    assert.equal((await request(`/1/devices/${id}`, 'DELETE')).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('dashboard renders CRUD controls, escaped hostnames, access filters and offline credit', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const app = vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8') + '\nApp;', {
    document: { addEventListener() {}, createElement() { return {
      set textContent(value) { this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    }; } },
  });
  const mapped = app.mapActiveDevices([{ id: 1, 'mac-address': mac, 'host-name': '<img src=x onerror="bad()">',
    'access-mode': 'blocked', 'paid-seconds-left': 600, 'is-active': false }]);
  const html = app.renderRadiusDeviceRows(mapped);
  for (const action of ['edit', 'time', 'normal', 'bypassed', 'remove']) assert.ok(html.includes(`data-action="${action}"`));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('10:00'));
  app._radiusDeviceFilter = 'blocked';
  assert.equal(app.filterRadiusDevices(mapped).length, 1);
  app._radiusDeviceFilter = 'bypassed';
  assert.equal(app.filterRadiusDevices(mapped).length, 0);
  assert.match(app.radiusDeviceTimeCell({ 'access-mode': 'bypassed' }), /Unlimited/);
});

test('check-session shows restored time on the roamed MAC (account keeps original identity)', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/portal', require('../src/api/portal').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/portal`;
  const check = mac => fetch(`${base}/check-session?mac=${encodeURIComponent(mac)}&routerId=1`).then(r => r.json());
  try {
    const oldMac = '50:7b:9d:3c:0a:d2';
    const newMac = '4c:34:88:a4:31:ed';
    const username = '507B9D3C0AD2';
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'Aircoins', 0, datetime('now', '+1 day'))"
    ).run(username);
    // Roamed session: token rebind to the NEW mac, account keeps the ORIGINAL username.
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, previous_mac, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, ?, 1, 'active', 80000, 79733, 1, datetime('now'), datetime('now'))`
    ).run('a'.repeat(48), newMac, oldMac, username);

    // Router unreachable: stored remaining time must still resolve via the roam binding.
    connected = false;
    let res = await check(newMac);
    assert.equal(res.hasSession, true);
    assert.equal(res.remainingSeconds, 79733);
    assert.equal(res.username, username);

    // Online: the live session (original username on the new MAC) is authoritative.
    connected = true;
    live = [{ '.id': '*1', mac: newMac, user: username, 'session-time-left': '22h8m53s', server: 'hotspot1' }];
    res = await check(newMac);
    assert.equal(res.hasSession, true);
    assert.equal(res.online, true);
    assert.equal(res.remainingSeconds, 22 * 3600 + 8 * 60 + 53);
    assert.equal(res.username, username);

    // The original MAC keeps working too (same account, matched by username).
    res = await check(oldMac);
    assert.equal(res.hasSession, true);
    assert.equal(res.username, username);

    // Unknown MAC with no binding and no live session still reports no session.
    res = await check('06:5f:5c:fb:0d:f9');
    assert.equal(res.hasSession, false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

// Session-Timeout (RADIUS attribute 27) from a raw response packet.
function radiusSessionTimeout(packet) {
  for (let o = 20; o + 2 <= packet.length;) {
    const type = packet[o], len = packet[o + 1];
    if (len < 2) break;
    if (type === 27 && len === 6) return packet.readUInt32BE(o + 2);
    o += len;
  }
  return null;
}

test('pause freezes live time, resume restores it, and RADIUS grants the frozen balance', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/portal', require('../src/api/portal').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/portal`;
  const post = (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json() }));
  const check = m => fetch(`${base}/check-session?mac=${encodeURIComponent(m)}&routerId=1`).then(r => r.json());
  const pauseMac = 'aa:bb:cc:dd:ee:10';
  const pauseUser = 'AABBCCDDEE10';
  try {
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, datetime('now', '+2 hours'))"
    ).run(pauseUser);
    connected = true;
    live = [{ '.id': '*P1', mac: pauseMac, user: pauseUser, 'session-time-left': '1h30m', server: 'hotspot1' }];

    // PAUSE: freeze the LIVE balance, kick the session, disable the account.
    let res = await post('/pause', { mac: pauseMac, routerId: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.remainingSeconds, 5400);
    assert.deepEqual(kicks, ['*P1']);
    let acct = account(pauseUser);
    assert.equal(acct.disabled, 1);
    assert.equal(acct.paused, 1);
    assert.equal(acct.expiry_at, null);
    const sess = db.prepare('SELECT * FROM device_sessions WHERE router_id = 1 AND mac_address = ?').get(pauseMac);
    assert.equal(sess.status, 'paused');
    assert.equal(sess.remaining_seconds, 5400);
    assert.equal(sess.username, pauseUser);

    // check-session reports the frozen balance as paused (not connected), and
    // it does not drain on subsequent reads.
    let cs = await check(pauseMac);
    assert.equal(cs.paused, true);
    assert.equal(cs.hasSession, true);
    assert.equal(cs.remainingSeconds, 5400);
    assert.equal(cs.online, false);
    assert.equal(cs.username, pauseUser);
    assert.equal((await check(pauseMac)).remainingSeconds, 5400);

    // Idempotent pause; RADIUS rejects the disabled account while paused.
    res = await post('/pause', { mac: pauseMac, routerId: 1 });
    assert.equal(res.body.alreadyPaused, true);
    db.prepare("INSERT INTO radius_clients (router_id, shared_secret) VALUES (1, 'test-only')").run();
    radius.startRadiusServer();
    assert.equal(radiusRequest(pauseUser, pauseMac)[0], 3);

    // RESUME: re-enable with expiry = now + balance; RADIUS accepts with that
    // exact Session-Timeout so the re-login gets the full frozen time.
    res = await post('/resume', { mac: pauseMac, routerId: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.remainingSeconds, 5400);
    acct = account(pauseUser);
    assert.equal(acct.disabled, 0);
    assert.equal(acct.paused, 0);
    const expiryMs = new Date(acct.expiry_at.replace(' ', 'T') + 'Z').getTime();
    assert.ok(Math.abs(expiryMs - (Date.now() + 5400000)) < 5000);
    const accept = radiusRequest(pauseUser, pauseMac);
    assert.equal(accept[0], 2);
    const timeout = radiusSessionTimeout(accept);
    assert.ok(timeout >= 5395 && timeout <= 5400, `Session-Timeout ${timeout}`);
    cs = await check(pauseMac);
    assert.equal(cs.paused, false);
    assert.equal(cs.hasSession, true);

    // Logout forfeits the balance — no RESUME offer afterwards.
    await post('/pause', { mac: pauseMac, routerId: 1 });
    await post('/logout', { mac: pauseMac, routerId: 1 });
    assert.equal(account(pauseUser).paused, 0);
    assert.equal((await check(pauseMac)).hasSession, false);

    // Invalid requests are rejected, not silently accepted.
    assert.equal((await post('/pause', { mac: 'zz', routerId: 1 })).status, 400);
    assert.equal((await post('/resume', { mac: pauseMac, routerId: 1 })).status, 404);
    assert.equal((await post('/pause', { mac: '06:5f:5c:fb:0d:f9', routerId: 1 })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('paused time survives a roam and stacks with a coin top-up', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/portal', require('../src/api/portal').default);
  app.use('/vouchers', require('../src/api/vouchers').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { restoreSession } = require('../src/services/deviceSessions');
  const oldMac = '50:7b:9d:3c:0a:d2';
  const newMac = '4c:34:88:a4:31:ed';
  const username = '507B9D3C0AD2';
  const token = 'b'.repeat(48);
  try {
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, paused, expiry_at) VALUES (1, ?, '', 'default', 1, 1, NULL)"
    ).run(username);
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'paused', 80000, 79733, 0, datetime('now'), datetime('now'))`
    ).run(token, oldMac, username);
    connected = false;

    // Roam to a new MAC: restore refuses to re-login but rebinds the token and
    // reports the frozen balance so the portal shows the paused panel.
    const res = await restoreSession({ token, mac: newMac, routerId: 1 });
    assert.equal(res.restore, false);
    assert.equal(res.reason, 'paused');
    assert.equal(res.remaining, 79733);
    assert.equal(res.rebind, true);
    const rebound = db.prepare('SELECT mac_address, status FROM device_sessions WHERE session_token = ?').get(token);
    assert.equal(rebound.mac_address, newMac);
    assert.equal(rebound.status, 'paused');

    // check-session on the NEW mac resolves the paused balance via the binding.
    const cs = await fetch(`${base}/portal/check-session?mac=${encodeURIComponent(newMac)}&routerId=1`).then(r => r.json());
    assert.equal(cs.paused, true);
    assert.equal(cs.remainingSeconds, 79733);
    assert.equal(cs.username, username);

    // Resume from the NEW mac works (binding resolves the original account).
    const resumed = await fetch(`${base}/portal/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac: newMac, routerId: 1 }),
    }).then(r => r.json());
    assert.equal(resumed.success, true);
    assert.equal(resumed.username, username);
    assert.equal(resumed.remainingSeconds, 79733);
    assert.equal(account(username).paused, 0);

    // Pause again, then a coin top-up must STACK onto the frozen balance and
    // unpause — never lose the paid time.
    await fetch(`${base}/portal/pause`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac: newMac, routerId: 1 }),
    }).then(r => r.json());
    assert.equal(account(username).paused, 1);
    const coin = await fetch(`${base}/vouchers/coin-auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac: newMac, durationMinutes: 5, routerId: 1 }),
    }).then(r => r.json());
    assert.equal(coin.success, true);
    assert.ok(coin.remainingSeconds >= 79733 + 300 - 5 && coin.remainingSeconds <= 79733 + 300,
      `stacked balance ${coin.remainingSeconds}`);
    const acct = account(username);
    assert.equal(acct.paused, 0);
    assert.equal(acct.disabled, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('offline-sync paused status does not trap a device whose account is not paused', async () => {
  const { restoreSession } = require('../src/services/deviceSessions');
  const mac = 'aa:bb:cc:dd:ee:20';
  const username = 'AABBCCDDEE20';
  const token = 'c'.repeat(48);
  const expiry = new Date(Date.now() + 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    // The background sync marks ANY session that went offline with time left
    // as status='paused' — but the account was never user-paused. Restore must
    // still re-login (the old behaviour trapped these devices on a paused
    // panel whose RESUME failed with "No paused session for this device").
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, paused, expiry_at) VALUES (1, ?, '', 'default', 0, 0, ?)"
    ).run(username, expiry);
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'paused', 3600, 3000, 0, datetime('now'), datetime('now'))`
    ).run(token, mac, username);
    connected = false;

    const res = await restoreSession({ token, mac, routerId: 1 });
    assert.equal(res.restore, true);
    assert.equal(res.username, username);
    assert.ok(res.remaining > 0);

    // Reverse direction: the sync can flip a REAL paused row back to 'active'
    // while the router still lists the session. The account flag must win.
    db.prepare("UPDATE hotspot_users SET disabled = 1, paused = 1, expiry_at = NULL WHERE router_id = 1 AND username = ?").run(username);
    db.prepare("UPDATE device_sessions SET status = 'active' WHERE session_token = ?").run(token);
    const res2 = await restoreSession({ token, mac, routerId: 1 });
    assert.equal(res2.restore, false);
    assert.equal(res2.reason, 'paused');
    assert.equal(res2.remaining, 3000);
  } finally {
    db.prepare('DELETE FROM device_sessions WHERE session_token = ?').run(token);
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username = ?').run(username);
  }
});

test('post-login bind keeps the original paid identity when the portal submits the current MAC', () => {
  const { bindSession } = require('../src/services/deviceSessions');
  const originalUser = '507B9D3C0AD2';
  const currentMac = '4c:34:88:a4:31:ed';
  const currentUser = '4C3488A431ED';
  const token = 'd'.repeat(48);
  const expiry = new Date(Date.now() + 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    // Roamed/redeemed device: the session tracks the ORIGINAL account while
    // the portal's delayed bind submits the CURRENT MAC as the username.
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(originalUser, expiry);
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'active', 3600, 3000, 1, datetime('now'), datetime('now'))`
    ).run(token, currentMac, originalUser);

    bindSession({ token, mac: currentMac, username: currentUser, routerId: 1 });
    let sess = db.prepare('SELECT username FROM device_sessions WHERE session_token = ?').get(token);
    assert.equal(sess.username, originalUser, 'MAC bind must not clobber the paid account identity');

    // Once the current MAC has its OWN enabled account (e.g. a fresh redeem),
    // binding it is legitimate and switches the tracked identity.
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(currentUser, expiry);
    bindSession({ token, mac: currentMac, username: currentUser, routerId: 1 });
    sess = db.prepare('SELECT username FROM device_sessions WHERE session_token = ?').get(token);
    assert.equal(sess.username, currentUser);
  } finally {
    db.prepare('DELETE FROM device_sessions WHERE session_token = ?').run(token);
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username IN (?, ?)').run(originalUser, currentUser);
  }
});

test('same-MAC restore does not kick a live session; a real roam still does', async () => {
  const { restoreSession } = require('../src/services/deviceSessions');
  const mac = 'aa:bb:cc:dd:ee:30';
  const roamMac = 'aa:bb:cc:dd:ee:31';
  const username = 'AABBCCDDEE30';
  const token = 'e'.repeat(48);
  const expiry = new Date(Date.now() + 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(username, expiry);
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'active', 3600, 3000, 1, datetime('now'), datetime('now'))`
    ).run(token, mac, username);
    connected = true;
    live = [{ '.id': '*L1', mac, user: username, 'session-time-left': '50m', server: 'hotspot1' }];

    // Portal reload while connected: restore must NOT disconnect the working
    // session (the old kick + re-login race made the paid time "vanish").
    const res = await restoreSession({ token, mac, routerId: 1 });
    assert.equal(res.restore, false);
    assert.equal(res.reason, 'already-online');
    assert.equal(res.username, username);
    assert.ok(res.remaining > 0);
    assert.deepEqual(kicks, []);

    // A genuine roam (new MAC) still frees the old slot and restores.
    const res2 = await restoreSession({ token, mac: roamMac, routerId: 1 });
    assert.equal(res2.restore, true);
    assert.equal(res2.rebind, true);
    assert.deepEqual(kicks, ['*L1']);
  } finally {
    db.prepare('DELETE FROM device_sessions WHERE session_token = ?').run(token);
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username = ?').run(username);
  }
});

test('roam restore kicks the old session and re-arms the account in parallel', async () => {
  const { restoreSession } = require('../src/services/deviceSessions');
  const oldMac = 'aa:bb:cc:dd:ee:62';
  const roamMac = 'aa:bb:cc:dd:ee:63';
  const username = 'AABBCCDDEE62';
  const token = '1'.repeat(48);
  const expiry = new Date(Date.now() + 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const events = [];
  const origKick = mt.kickActiveSession;
  const origReset = mt.resetHotspotUserCounters;
  const origSet = mt.setUserUptimeLimit;
  try {
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(username, expiry);
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'active', 3600, 1800, 0, datetime('now'), datetime('now'))`
    ).run(token, oldMac, username);
    connected = true;
    live = [{ '.id': '*R1', mac: oldMac, user: username, 'session-time-left': '30m' }];

    // A slow kick: if the kick and the re-arm ran sequentially the reset would
    // only start after 'kick-end'. Running them concurrently is what makes the
    // roam leave the captive portal faster (one wave instead of two).
    mt.kickActiveSession = async () => {
      events.push('kick-start');
      await new Promise(resolve => setTimeout(resolve, 20));
      events.push('kick-end');
      return true;
    };
    mt.resetHotspotUserCounters = async () => { events.push('reset'); return true; };
    mt.setUserUptimeLimit = async (routerId, user, limit) => { events.push('set:' + limit); return true; };

    const res = await restoreSession({ token, mac: roamMac, routerId: 1 });
    assert.equal(res.restore, true);
    assert.equal(res.rebind, true);
    assert.equal(res.remaining, 1800);
    assert.ok(events.includes('set:00:30:00'), events.join(','));
    assert.ok(events.indexOf('reset') < events.indexOf('kick-end'),
      `reset must overlap the kick, got: ${events.join(',')}`);
    assert.ok(events.indexOf('reset') < events.indexOf('set:00:30:00'),
      `counters must reset before the new limit, got: ${events.join(',')}`);
  } finally {
    mt.kickActiveSession = origKick;
    mt.resetHotspotUserCounters = origReset;
    mt.setUserUptimeLimit = origSet;
    db.prepare('DELETE FROM device_sessions WHERE session_token = ?').run(token);
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username = ?').run(username);
  }
});

test('roam restore clears every ghost session so the router accepts the login', async () => {
  const { restoreSession } = require('../src/services/deviceSessions');
  const oldMac = 'aa:bb:cc:dd:ee:64';
  const roamMac = 'aa:bb:cc:dd:ee:65';
  const username = 'AABBCCDDEE64';
  const token = '2'.repeat(48);
  const expiry = new Date(Date.now() + 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(username, expiry);
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'active', 3600, 1800, 0, datetime('now'), datetime('now'))`
    ).run(token, oldMac, username);
    connected = true;
    // Two live rows for the SAME account: the session the phone left behind on
    // the old hotspot server plus the one it made before roaming. Dropping only
    // the first keeps shared-users full, RouterOS refuses the auto-login and the
    // captive portal stays open on the phone.
    live = [
      { '.id': '*G1', mac: oldMac, user: username, server: 'hotspot1' },
      { '.id': '*G2', mac: oldMac, user: username, server: 'hs-VLAN100' },
      { '.id': '*G3', mac: 'aa:bb:cc:dd:ee:99', user: 'OTHERACCOUNT', server: 'hotspot1' },
    ];

    const res = await restoreSession({ token, mac: roamMac, routerId: 1 });
    assert.equal(res.restore, true);
    assert.deepEqual(kicks, ['*G1', '*G2']);
    assert.deepEqual(live.map(c => c['.id']), ['*G3'], 'another account must not be disconnected');
  } finally {
    db.prepare('DELETE FROM device_sessions WHERE session_token = ?').run(token);
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username = ?').run(username);
  }
});

test('check-session resolves colon-form MAC accounts and the RADIUS MAC alias', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/portal', require('../src/api/portal').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/portal`;
  const check = m => fetch(`${base}/check-session?mac=${encodeURIComponent(m)}&routerId=1`).then(r => r.json());
  const colonUser = 'da:e4:5a:ce:76:6c';
  const aliasUser = '065F5CFB0DF1';
  const aliasMac = '11:22:33:44:55:66';
  const expiry = new Date(Date.now() + 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    connected = false;
    // Account stored WITH colons / lower case: the exact `username = ?` lookup
    // missed it and reported "no session" while the device had paid time.
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(colonUser, expiry);
    let res = await check(colonUser);
    assert.equal(res.hasSession, true);
    assert.ok(res.remainingSeconds > 3500);

    // No account under the current MAC and no session row: the RADIUS
    // device_macs alias resolves the ORIGINAL paid account (roam identity).
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(aliasUser, expiry);
    db.prepare('INSERT INTO device_macs (mac_address, username, router_id) VALUES (?, ?, 1)').run(aliasMac, aliasUser);
    res = await check(aliasMac);
    assert.equal(res.hasSession, true);
    assert.equal(res.username, aliasUser);
    assert.ok(res.remainingSeconds > 3500);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username IN (?, ?)').run(colonUser, aliasUser);
    db.prepare('DELETE FROM device_macs WHERE mac_address = ?').run(aliasMac);
  }
});

test('restore refuses a stale balance once the account expiry is consumed', async () => {
  const { restoreSession } = require('../src/services/deviceSessions');
  const mac = 'aa:bb:cc:dd:ee:40';
  const username = 'AABBCCDDEE40';
  const token = 'f'.repeat(48);
  const pastExpiry = new Date(Date.now() - 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(username, pastExpiry);
    // Sync froze the balance at 3s before the account expired. Granting it
    // again made the portal auto-login with phantom time forever, so the
    // router never dropped the device to the captive portal.
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'paused', 3600, 3, 0, datetime('now'), datetime('now'))`
    ).run(token, mac, username);
    connected = false;
    live = [];

    const res = await restoreSession({ token, mac, routerId: 1 });
    assert.equal(res.restore, false);
    assert.equal(res.reason, 'expired');
    const row = db.prepare('SELECT remaining_seconds, status FROM device_sessions WHERE session_token = ?').get(token);
    assert.equal(row.remaining_seconds, 0);
    assert.equal(row.status, 'expired');

    // A top-up re-arms the account: restore works again with the paid time.
    const futureExpiry = new Date(Date.now() + 1800 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('UPDATE hotspot_users SET expiry_at = ? WHERE router_id = 1 AND username = ?').run(futureExpiry, username);
    db.prepare("UPDATE device_sessions SET remaining_seconds = 1800, status = 'active' WHERE session_token = ?").run(token);
    const res2 = await restoreSession({ token, mac, routerId: 1 });
    assert.equal(res2.restore, true);

    // A GENUINE pause (account paused=1) keeps its frozen balance restorable.
    db.prepare('UPDATE hotspot_users SET disabled = 1, paused = 1, expiry_at = NULL WHERE router_id = 1 AND username = ?').run(username);
    db.prepare("UPDATE device_sessions SET remaining_seconds = 900, status = 'paused' WHERE session_token = ?").run(token);
    const res3 = await restoreSession({ token, mac, routerId: 1 });
    assert.equal(res3.restore, false);
    assert.equal(res3.reason, 'paused');
    assert.equal(res3.remaining, 900);
  } finally {
    db.prepare('DELETE FROM device_sessions WHERE session_token = ?').run(token);
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username = ?').run(username);
  }
});

test('check-session reports no session for consumed accounts despite stale balances', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/portal', require('../src/api/portal').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/portal`;
  const check = m => fetch(`${base}/check-session?mac=${encodeURIComponent(m)}&routerId=1`).then(r => r.json());
  const mac = 'aa:bb:cc:dd:ee:41';
  const username = 'AABBCCDDEE41';
  const token = 'a'.repeat(48);
  const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    db.prepare(
      "INSERT INTO hotspot_users (router_id, username, password, profile, disabled, expiry_at) VALUES (1, ?, '', 'default', 0, ?)"
    ).run(username, pastExpiry);
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, username, router_id, status,
         total_seconds, remaining_seconds, is_online, first_seen, last_seen)
       VALUES (?, ?, ?, 1, 'active', 3600, 59, 0, datetime('now'), datetime('now'))`
    ).run(token, mac, username);
    connected = false;
    live = [];

    // Offline + expired account: the stale 59s must NOT be reported.
    let res = await check(mac);
    assert.equal(res.hasSession, false);
    assert.equal(res.remainingSeconds, 0);

    // A LIVE session still wins (the one-shot expired-grace window): the
    // portal must show the grace countdown, not "no session".
    connected = true;
    live = [{ '.id': '*G1', mac, user: username, 'session-time-left': '55s', server: 'hotspot1' }];
    res = await check(mac);
    assert.equal(res.hasSession, true);
    assert.equal(res.online, true);
    assert.ok(res.remainingSeconds > 0 && res.remainingSeconds <= 55);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.prepare('DELETE FROM device_sessions WHERE session_token = ?').run(token);
    db.prepare('DELETE FROM hotspot_users WHERE router_id = 1 AND username = ?').run(username);
  }
});

test('walled garden denies captive-portal probe hosts ahead of wildcard allows', async () => {
  // Samsung probes connectivitycheck.gstatic.com/generate_204. A wildcard
  // *.gstatic.com allow let the probe pass UNAUTHENTICATED, so Samsung closed
  // the portal popup and reported "connected" with zero time. The exact probe
  // hosts must be denied BEFORE any wildcard allow (first match wins).
  const origGet = mt.getWalledGarden, origCreate = mt.createWalledGarden, origMove = mt.moveWalledGarden;
  const origGetIp = mt.getWalledGardenIp, origCreateIp = mt.createWalledGardenIp;
  let wgEntries = [], wgCreates = [], wgMoves = [];
  mt.getWalledGarden = async () => wgEntries;
  mt.createWalledGarden = async (routerId, data) => {
    const row = { '.id': `*W${wgEntries.length + 1}`, ...data };
    wgEntries.push(row);
    wgCreates.push(data);
    return row;
  };
  // These tests maintain the hostname menu; the address menu is stubbed so an
  // unconnected test router cannot abort the whole pass.
  mt.getWalledGardenIp = async () => [];
  mt.createWalledGardenIp = async () => ({});
  mt.moveWalledGarden = async (routerId, id, destination) => {
    wgMoves.push({ id, destination });
    const idx = wgEntries.findIndex(e => e['.id'] === id);
    const [row] = wgEntries.splice(idx, 1);
    wgEntries.splice(destination, 0, row);
  };
  try {
    // Fresh router: wildcard allows present, no probe entries yet.
    wgEntries = [
      { '.id': '*1', 'dst-host': '*.paymongo.com', action: 'allow' },
      { '.id': '*2', 'dst-host': '*.googleapis.com', action: 'allow' },
      { '.id': '*3', 'dst-host': '*.gstatic.com', action: 'allow' },
    ];
    wgCreates = []; wgMoves = [];
    await devices.ensureWalledGardenForController(77);
    const denied = wgCreates.filter(c => c.action === 'deny').map(c => c['dst-host']);
    assert.ok(denied.includes('connectivitycheck.gstatic.com'));
    assert.ok(denied.includes('www.googleapis.com'));
    const idxProbe = wgEntries.findIndex(e => e['dst-host'] === 'connectivitycheck.gstatic.com');
    const idxWildcard = wgEntries.findIndex(e => e['dst-host'] === '*.gstatic.com');
    assert.ok(idxProbe >= 0 && idxProbe < idxWildcard, 'probe deny must precede the wildcard allow');
    assert.ok(wgMoves.every(m => m.destination === 0));

    // Idempotent AND quiet: a deny that is already ahead of every allow must not
    // be moved again. RouterOS answers such a move with
    // 400 "can not move object before itself", and the retry-on-error loop used
    // to hammer the router REST API on every sync tick (~900 failing calls per
    // hour observed) - the same API a roaming device needs to restore fast.
    wgCreates = []; wgMoves = [];
    await devices.ensureWalledGardenForController(78);
    assert.equal(wgCreates.filter(c => c.action === 'deny').length, 0);
    assert.equal(wgMoves.length, 0, `already-correct rules must not be moved: ${JSON.stringify(wgMoves)}`);
    const stillOrdered = wgEntries.findIndex(e => e['dst-host'] === 'connectivitycheck.gstatic.com')
      < wgEntries.findIndex(e => String(e['dst-host']) === '*.gstatic.com');
    assert.ok(stillOrdered, 'probe deny stays ahead of the wildcard allow');

    // A successful pass is not repeated for minutes even though the device sync
    // calls it every few seconds.
    wgCreates = []; wgMoves = [];
    await devices.ensureWalledGardenForController(77);
    assert.equal(wgCreates.length, 0);
    assert.equal(wgMoves.length, 0);
  } finally {
    mt.getWalledGarden = origGet;
    mt.createWalledGarden = origCreate;
    mt.moveWalledGarden = origMove;
    mt.getWalledGardenIp = origGetIp;
    mt.createWalledGardenIp = origCreateIp;
  }
});

test('walled garden re-positions a shadowed probe deny and survives a move refusal', async () => {
  const origGet = mt.getWalledGarden, origCreate = mt.createWalledGarden, origMove = mt.moveWalledGarden;
  const origGetIp = mt.getWalledGardenIp, origCreateIp = mt.createWalledGardenIp;
  let wgEntries = [], wgMoves = [];
  mt.getWalledGarden = async () => wgEntries;
  mt.createWalledGarden = async (routerId, data) => {
    const row = { '.id': `*N${wgEntries.length + 1}`, ...data };
    wgEntries.push(row);
    return row;
  };
  // Address rules are another menu's business here; only *C (an old hand-made
  // controller rule still sitting in the hostname menu) has to be recognised so
  // the pass does not go looking for more address work.
  mt.getWalledGardenIp = async () => [];
  mt.createWalledGardenIp = async () => ({});
  try {
    // Someone inserted a wildcard allow ABOVE the deny: first-match would let
    // the probe through again, so the deny has to be pushed back to the top.
    // The other deny is already first-match-proof and must not be touched.
    wgEntries = [
      { '.id': '*A', 'dst-host': '*.gstatic.com', action: 'allow' },
      { '.id': '*P', 'dst-host': 'connectivitycheck.gstatic.com', action: 'deny' },
      { '.id': '*G', 'dst-host': 'www.googleapis.com', action: 'deny' },
      { '.id': '*C', 'dst-host': config.controllerLanIp, action: 'accept' },
    ];
    wgMoves = [];
    mt.moveWalledGarden = async (routerId, id, destination) => {
      wgMoves.push(id);
      const idx = wgEntries.findIndex(e => e['.id'] === id);
      const [row] = wgEntries.splice(idx, 1);
      wgEntries.splice(destination, 0, row);
    };
    await devices.ensureWalledGardenForController(79);
    assert.deepEqual(wgMoves, ['*P']);
    assert.equal(wgEntries[0]['dst-host'], 'connectivitycheck.gstatic.com');

    // A router that refuses the move ("can not move object before itself") is
    // already in the wanted shape: the pass must not fail, and every remaining
    // probe host must still be maintained.
    wgEntries = [
      { '.id': '*M', 'dst-host': '', 'dst-address': '', action: 'allow', comment: 'place hotspot rules here' },
      { '.id': '*P', 'dst-host': 'connectivitycheck.gstatic.com', action: 'deny' },
      { '.id': '*G', 'dst-host': 'www.googleapis.com', action: 'deny' },
      { '.id': '*C', 'dst-host': config.controllerLanIp, action: 'accept' },
    ];
    wgMoves = [];
    mt.moveWalledGarden = async (routerId, id) => {
      wgMoves.push(id);
      throw new Error('REST API error: 400 Bad Request - {"detail":"failure: can not move object before itself"}');
    };
    await devices.ensureWalledGardenForController(80);
    assert.deepEqual(wgMoves, ['*P', '*G']);
  } finally {
    mt.getWalledGarden = origGet;
    mt.createWalledGarden = origCreate;
    mt.moveWalledGarden = origMove;
    mt.getWalledGardenIp = origGetIp;
    mt.createWalledGardenIp = origCreateIp;
  }
});

test('a sub-vendo default that is not in the machine list is repaired to a real machine', () => {
  const { resolveVendorIp } = require('../src/services/vendoConfig');
  // The admin UI edits the default machine separately from the list, so after a
  // sub-vendo changes IP the portal keeps POSTing /topUp to the dead address and
  // reports "coin slot is not available" while the panel shows the machine online.
  const listed = { isMultiVendo: true, vendorIpAddress: '10.0.0.243', multiVendoAddresses: [{ vendoIp: '10.0.0.141' }] };
  assert.equal(resolveVendorIp(listed).vendorIpAddress, '10.0.0.141');
  const matching = { isMultiVendo: true, vendorIpAddress: '10.0.0.141', multiVendoAddresses: [{ vendoIp: '10.0.0.141' }] };
  assert.equal(resolveVendorIp(matching).vendorIpAddress, '10.0.0.141');
  // Single-machine setups have no list to be wrong about - leave them alone.
  const single = { isMultiVendo: false, vendorIpAddress: '10.0.0.243', multiVendoAddresses: [{ vendoIp: '10.0.0.141' }] };
  assert.equal(resolveVendorIp(single).vendorIpAddress, '10.0.0.243');
  const empty = { isMultiVendo: true, vendorIpAddress: '10.0.0.243', multiVendoAddresses: [] };
  assert.equal(resolveVendorIp(empty).vendorIpAddress, '10.0.0.243');
  // The rest of the config must survive the rewrite untouched.
  const full = { isMultiVendo: true, vendorIpAddress: '', loginOption: 1, multiVendoAddresses: [{ vendoIp: '10.0.0.9' }] };
  assert.equal(resolveVendorIp(full).loginOption, 1);
  assert.equal(resolveVendorIp(full).vendorIpAddress, '10.0.0.9');
});

test('walled garden opens the coin machine in the IP menu so a phone can pay before login', async () => {
  const origGet = mt.getWalledGarden, origCreate = mt.createWalledGarden, origMove = mt.moveWalledGarden;
  const origGetIp = mt.getWalledGardenIp, origCreateIp = mt.createWalledGardenIp;
  const origDelete = mt.deleteWalledGarden;
  let wgEntries = [], wgIpEntries = [], wgIpCreates = [], wgDeletes = [];
  mt.getWalledGarden = async () => wgEntries;
  mt.createWalledGarden = async (routerId, data) => {
    const row = { '.id': `*H${wgEntries.length + 1}`, ...data };
    wgEntries.push(row);
    return row;
  };
  mt.deleteWalledGarden = async (routerId, id) => {
    wgDeletes.push(id);
    wgEntries = wgEntries.filter(e => e['.id'] !== id);
  };
  mt.getWalledGardenIp = async () => wgIpEntries;
  mt.createWalledGardenIp = async (routerId, data) => {
    const row = { '.id': `*I${wgIpEntries.length + 1}`, ...data };
    wgIpEntries.push(row);
    wgIpCreates.push(data);
    return row;
  };
  mt.moveWalledGarden = async () => {};
  vendoAddresses = ['10.0.0.141'];
  try {
    // INSERT COIN is posted by the phone straight to the machine while it is
    // still unauthenticated. RouterOS sends every other destination to the login
    // page, so without this allow the portal gets HTML back and the customer is
    // told the coin slot is broken.
    //
    // It has to be the walled-garden IP sub-menu: on RouterOS 7.25 a general
    // entry with an address in dst-host is accepted but installs no firewall
    // rule, while the ip/ entry creates chain=hs-unauth action=return and is
    // exactly how the controller's own pre-login access works.
    wgEntries = [{ '.id': '*1', 'dst-host': '*.gstatic.com', action: 'allow' }];
    wgIpEntries = [];
    wgIpCreates = [];
    await devices.ensureWalledGardenForController(81);
    const coinAllow = wgIpCreates.find(c => c['dst-address'] === '10.0.0.141');
    assert.ok(coinAllow, `coin machine must be reachable pre-login, created: ${JSON.stringify(wgIpCreates)}`);
    assert.equal(coinAllow.action, 'accept');
    assert.ok(wgIpCreates.some(c => c['dst-address'] === config.controllerLanIp),
      'the controller address belongs in the IP menu too');
    assert.equal(wgEntries.filter(e => String(e['dst-host'] || '').includes('10.0.0')).length, 0,
      'an address in the hostname menu passes no traffic');

    // Already open, written by Winbox with a /32: no duplicate, so a healthy
    // router stays quiet instead of growing a rule per sync tick.
    wgEntries = [];
    wgIpEntries = [
      { '.id': '*C', 'dst-address': config.controllerLanIp, action: 'accept' },
      { '.id': '*V', 'dst-address': '10.0.0.141/32', action: 'accept' },
    ];
    wgIpCreates = [];
    await devices.ensureWalledGardenForController(82);
    assert.deepEqual(wgIpCreates, []);
    assert.deepEqual(wgDeletes, [], 'a rule that works is never removed');

    // The router this was first deployed on still carried the previous build's
    // rule: the address written into the hostname menu, which RouterOS accepted
    // and then ignored. It has to be replaced, not treated as proof that the
    // coin machine is already reachable - that lie is what kept the coin slot
    // "not available" while every check said the rule existed.
    wgEntries = [
      { '.id': '*A', 'dst-host': '10.0.0.141', action: 'allow', comment: 'sub-vendo coin machine (insert coin before login)' },
      { '.id': '*E', 'dst-host': '', action: 'allow', comment: 'sub-vendo coin machine (insert coin before login)' },
      { '.id': '*B', 'dst-host': '10.0.0.200', action: 'allow', comment: 'vendor added by hand' },
      { '.id': '*P', 'dst-host': '', action: 'allow', comment: 'place hotspot rules here' },
      { '.id': '*H', 'dst-host': '*.paymongo.com', action: 'allow', comment: 'JuanFi payment gateway' },
    ];
    wgIpEntries = [{ '.id': '*C', 'dst-address': config.controllerLanIp, action: 'accept' }];
    wgIpCreates = []; wgDeletes = [];
    await devices.ensureWalledGardenForController(83);
    assert.ok(wgIpCreates.some(c => c['dst-address'] === '10.0.0.141'),
      `dead hostname rule must not replace the IP-menu one, created: ${JSON.stringify(wgIpCreates)}`);
    assert.deepEqual(wgDeletes, ['*A', '*E'],
      'only controller-written address rules go, never a hostname rule or an operator placeholder');
  } finally {
    vendoAddresses = [];
    mt.getWalledGarden = origGet;
    mt.createWalledGarden = origCreate;
    mt.moveWalledGarden = origMove;
    mt.getWalledGardenIp = origGetIp;
    mt.createWalledGardenIp = origCreateIp;
    mt.deleteWalledGarden = origDelete;
  }
});

test('registering a sub-vendo makes it static, bypasses its login and opens it for payment', async () => {
  const { provisionSubVendo } = require('../src/services/vendoProvision');
  const vendoConfigService = require('../src/services/vendoConfig');
  const orig = {
    register: vendoConfigService.registerVendoMachine,
    isConnected: mt.isConnected,
    getDhcpLeases: mt.getDhcpLeases, makeDhcpLeaseStatic: mt.makeDhcpLeaseStatic, createDhcpLease: mt.createDhcpLease,
    getDhcpServers: mt.getDhcpServers, getArpEntries: mt.getArpEntries,
    getIpBindings: mt.getIpBindings, createIpBinding: mt.createIpBinding, updateIpBinding: mt.updateIpBinding,
    deleteIpBinding: mt.deleteIpBinding, deleteWalledGarden: mt.deleteWalledGarden,
    getWalledGarden: mt.getWalledGarden, getWalledGardenIp: mt.getWalledGardenIp, createWalledGardenIp: mt.createWalledGardenIp,
  };
  const calls = { static: [], leaseAdd: [], bindingCreate: [], bindingUpdate: [], bindingDelete: [], wgDelete: [], wgIpCreate: [] };
  const vendo = '10.0.0.141';
  const mac = '8C:AA:B5:70:3C:53';
  try {
    vendoConfigService.registerVendoMachine = () => ({ added: true, renamed: false, defaultSet: true });
    mt.isConnected = () => true;
    // A dynamic lease carries the MAC even when nobody typed it into the panel.
    mt.getDhcpLeases = async () => [{ '.id': '*9D', address: vendo, 'mac-address': mac, server: 'dhcp1', dynamic: 'true' }];
    mt.getDhcpServers = async () => [{ '.id': '*1', name: 'dhcp1', interface: 'bridge-HS', disabled: 'false' }];
    mt.getArpEntries = async () => [{ '.id': '*3', address: vendo, 'mac-address': mac, interface: 'bridge-HS' }];
    mt.makeDhcpLeaseStatic = async (routerId, id) => { calls.static.push(id); };
    mt.createDhcpLease = async (routerId, data) => { calls.leaseAdd.push(data); };
    // The MAC is already bypassed by an operator rule that has no address, so it
    // must be corrected instead of a second rule being added for the same client
    // (RouterOS refuses that one with 400 "such client already exists").
    mt.getIpBindings = async () => [
      { '.id': '*5', 'mac-address': mac, type: 'bypassed', server: 'all' },
      { '.id': '*6', address: vendo, 'mac-address': mac, type: 'bypassed', server: 'all', comment: 'JuanFi sub-vendo old' },
    ];
    mt.createIpBinding = async (routerId, data) => { calls.bindingCreate.push(data); };
    mt.updateIpBinding = async (routerId, id, data) => { calls.bindingUpdate.push([id, data]); };
    mt.deleteIpBinding = async (routerId, id) => { calls.bindingDelete.push(id); };
    mt.deleteWalledGarden = async (routerId, id) => { calls.wgDelete.push(id); };
    // A previous build wrote the address into the hostname menu, where RouterOS
    // accepts it and installs no firewall rule - it must be replaced, not trusted.
    mt.getWalledGarden = async () => [
      { '.id': '*A', 'dst-host': vendo, action: 'allow', comment: 'sub-vendo coin machine (insert coin before login)' },
    ];
    mt.getWalledGardenIp = async () => [{ '.id': '*C', 'dst-address': config.controllerLanIp, action: 'accept' }];
    mt.createWalledGardenIp = async (routerId, data) => { calls.wgIpCreate.push(data); };

    const res = await provisionSubVendo(7, { name: 'AJC1', ip: vendo });
    const byStep = {};
    res.steps.forEach(s => { byStep[s.step] = s; });

    assert.equal(res.mac, mac, 'MAC resolved from the router, not typed by hand');
    assert.deepEqual(calls.static, ['*9D']);
    assert.deepEqual(calls.leaseAdd, [], 'an existing lease is made static, never duplicated');
    assert.ok(byStep.static.ok, byStep.static.detail);

    assert.deepEqual(calls.bindingUpdate.map(b => b[0]), ['*5']);
    assert.equal(calls.bindingUpdate[0][1].type, 'bypassed');
    assert.equal(calls.bindingUpdate[0][1].address, vendo);
    assert.equal(calls.bindingCreate.length, 0);
    assert.deepEqual(calls.bindingDelete, ['*6'],
      'the duplicate is pruned first, or RouterOS refuses the corrected row with "such client already exists"');
    assert.ok(byStep.bypass.ok, byStep.bypass.detail);

    assert.deepEqual(calls.wgIpCreate, [{
      'dst-address': vendo,
      action: 'accept',
      comment: 'sub-vendo coin machine (insert coin before login)',
    }]);
    assert.deepEqual(calls.wgDelete, ['*A']);
    assert.ok(byStep.walledGarden.ok, byStep.walledGarden.detail);
    assert.ok(byStep.portalList.ok, byStep.portalList.detail);
    assert.equal(res.ok, true);

    // A machine nobody has ever powered on: no MAC, so nothing can be pinned, but
    // the portal must still list it and the report must say why the rest failed.
    mt.getDhcpLeases = async () => [];
    mt.getArpEntries = async () => [];
    const cold = await provisionSubVendo(7, { name: 'AJC2', ip: '10.0.0.199' });
    const coldSteps = {};
    cold.steps.forEach(s => { coldSteps[s.step] = s; });
    assert.equal(cold.ok, false);
    assert.equal(cold.mac, '');
    assert.equal(coldSteps.mac.ok, false);
    assert.equal(coldSteps.static.ok, false);
    assert.equal(coldSteps.bypass.ok, false);
    assert.equal(coldSteps.portalList.ok, true);

    // Offline router: the portal side still happens, the router side reports it.
    mt.isConnected = () => false;
    const off = await provisionSubVendo(7, { name: 'AJC3', ip: vendo });
    assert.equal(off.steps.find(s => s.step === 'portalList').ok, true);
    assert.equal(off.steps.find(s => s.step === 'walledGarden').ok, false);
    assert.match(off.steps.find(s => s.step === 'walledGarden').detail, /not connected/);
  } finally {
    Object.assign(vendoConfigService, { registerVendoMachine: orig.register });
    Object.assign(mt, {
      isConnected: orig.isConnected, getDhcpLeases: orig.getDhcpLeases,
      makeDhcpLeaseStatic: orig.makeDhcpLeaseStatic, createDhcpLease: orig.createDhcpLease,
      getDhcpServers: orig.getDhcpServers, getArpEntries: orig.getArpEntries,
      getIpBindings: orig.getIpBindings, createIpBinding: orig.createIpBinding,
      updateIpBinding: orig.updateIpBinding, deleteIpBinding: orig.deleteIpBinding,
      deleteWalledGarden: orig.deleteWalledGarden, getWalledGarden: orig.getWalledGarden,
      getWalledGardenIp: orig.getWalledGardenIp, createWalledGardenIp: orig.createWalledGardenIp,
    });
  }
});

test('sales report aggregates redeemed vouchers, paid GCash and sub-vendo counters', async () => {
  const { buildSalesReport, normalizeRange } = require('../src/services/salesReport');
  const { nodeMcuService } = require('../src/services/nodemcu');
  const origDash = nodeMcuService.getDashboard;
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 10 * 86400 * 1000).toISOString().slice(0, 10);
  const devOnline = { id: 91, name: 'Vendo A', ip: '10.0.0.91', username: 'admin', password: '' };
  const devOffline = { id: 92, name: 'Vendo B', ip: '10.0.0.92', username: 'admin', password: '' };
  nodeMcuService.getDashboard = async (d) => {
    if (d.id === 91) return { lifetimeCoins: 100, currentCoins: 40, customerCount: 7 };
    throw new Error('Request timeout');
  };
  try {
    // Isolate from vouchers/payments left behind by earlier tests.
    db.exec('DELETE FROM vouchers; DELETE FROM payments;');
    db.prepare(
      "INSERT INTO vouchers (router_id, code, username, profile, price, duration_minutes, is_used, used_at, created_at) VALUES (1, 'SALES-V1', 'U1', 'default', 10, 60, 1, ?, ?)"
    ).run(`${today} 12:00:00`, `${today} 08:00:00`);
    db.prepare(
      "INSERT INTO vouchers (router_id, code, username, profile, price, duration_minutes, is_used, used_at, created_at) VALUES (1, 'SALES-V2', 'U2', 'default', 25, 120, 1, ?, ?)"
    ).run(`${old} 12:00:00`, `${old} 08:00:00`);
    db.prepare(
      "INSERT INTO vouchers (router_id, code, username, profile, price, duration_minutes, is_used, created_at) VALUES (1, 'SALES-V3', 'U3', 'default', 50, 240, 0, ?)"
    ).run(`${today} 09:00:00`);
    db.prepare(
      "INSERT INTO payments (reference, mac_address, amount, minutes, status, paid_at, created_at) VALUES ('SALES-P1', 'AABBCCDDEE91', 20, 60, 'paid', ?, ?)"
    ).run(`${today} 13:00:00`, `${today} 12:50:00`);
    db.prepare(
      "INSERT INTO payments (reference, mac_address, amount, minutes, status, created_at) VALUES ('SALES-P2', 'AABBCCDDEE92', 99, 60, 'pending', ?)"
    ).run(`${today} 12:55:00`);
    db.prepare(
      "INSERT INTO payments (reference, mac_address, amount, minutes, status, paid_at, created_at) VALUES ('SALES-P3', 'AABBCCDDEE93', 30, 60, 'paid', ?, ?)"
    ).run(`${old} 13:00:00`, `${old} 12:50:00`);

    // Today only: unredeemed/pending rows and old sales stay out.
    const r = await buildSalesReport({ from: today, to: today }, [devOnline, devOffline]);
    assert.equal(r.vouchers.count, 1);
    assert.equal(r.vouchers.amount, 10);
    assert.equal(r.vouchers.rows[0].code, 'SALES-V1');
    assert.equal(r.vouchers.rows[0].router_name, 'Test');
    assert.equal(r.vouchers.generatedCount, 2);
    assert.equal(r.vouchers.generatedAmount, 60);
    assert.equal(r.gcash.count, 1);
    assert.equal(r.gcash.amount, 20);
    assert.equal(r.gcash.rows[0].reference, 'SALES-P1');
    assert.equal(r.vendo.deviceCount, 2);
    assert.equal(r.vendo.onlineCount, 1);
    assert.equal(r.vendo.lifetimeCoins, 100);
    assert.equal(r.vendo.currentCoins, 40);
    assert.equal(r.vendo.customerCount, 7);
    const offline = r.vendo.devices.find(d => d.id === 92);
    assert.equal(offline.online, false);
    assert.ok(offline.error);
    assert.equal(r.totals.periodTotal, 30);

    // Reversed bounds are swapped; the wide range picks up the old sales too.
    const wide = await buildSalesReport({ from: today, to: '2000-01-01' }, []);
    assert.equal(wide.from, '2000-01-01');
    assert.equal(wide.to, today);
    assert.equal(wide.vouchers.count, 2);
    assert.equal(wide.vouchers.amount, 35);
    assert.equal(wide.gcash.count, 2);
    assert.equal(wide.gcash.amount, 50);
    assert.equal(wide.vendo.deviceCount, 0);

    // Invalid/missing dates fall back to today.
    const norm = normalizeRange('not-a-date', undefined);
    assert.equal(norm.from, today);
    assert.equal(norm.to, today);
  } finally {
    nodeMcuService.getDashboard = origDash;
    db.prepare("DELETE FROM vouchers WHERE code LIKE 'SALES-V%'").run();
    db.prepare("DELETE FROM payments WHERE reference LIKE 'SALES-P%'").run();
  }
});

test('sales report endpoint rejects anonymous access and serves the report', async () => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const { nodeMcuService } = require('../src/services/nodemcu');
  const origDash = nodeMcuService.getDashboard;
  // Never reach real hardware from tests, even if a devices file exists.
  nodeMcuService.getDashboard = async () => ({ lifetimeCoins: 0, currentCoins: 0, customerCount: 0 });
  const app = express();
  app.use(express.json());
  app.use('/sales', require('../src/api/sales').default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/sales`;
  try {
    const anon = await fetch(`${base}/report`);
    assert.equal(anon.status, 401);

    const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, config.jwtSecret, { expiresIn: '1h' });
    const res = await fetch(`${base}/report`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(body.from, today);
    assert.equal(body.to, today);
    assert.ok(body.totals && typeof body.totals.periodTotal === 'number');
    assert.ok(Array.isArray(body.vendo.devices));
  } finally {
    nodeMcuService.getDashboard = origDash;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
