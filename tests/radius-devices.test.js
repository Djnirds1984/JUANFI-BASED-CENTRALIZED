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

const sockets = [];
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
