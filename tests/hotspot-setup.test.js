const { test } = require('node:test');
const assert = require('node:assert/strict');

// Never touch a real router: restApiCall is replaced with an in-process fake
// that mimics RouterOS 7 REST for the menus setupHotspot touches.
const { mikroTikService: mt } = require('../src/services/mikrotik');

function fakeRouter(options = {}) {
  const state = {
    addresses: options.addresses || [],
    pools: [],
    dhcp: [],
    networks: [],
    hotspotProfiles: [],
    hotspotServers: [],
    userProfiles: [],
    users: [],
    calls: [],
  };
  let nextId = 1;
  const id = () => `*${nextId++}`;
  const fail = (message) => { throw new Error(`REST API error: 400 Bad Request - ${message}`); };

  mt.routerConfigs.set(1, { id: 1, name: 'r1', host: '192.0.2.1', port: 80, username: 'u', password: 'p', useRestApi: true });
  mt.restApiCall = async (config, method, path, body) => {
    state.calls.push(`${method} ${path}`);
    if (method === 'POST' && path === '/ip/address/add') {
      const clash = state.addresses.find((a) => a.interface === body.interface && a.address.split('/')[0] === String(body.address).split('/')[0]);
      if (clash) fail('already have such address');
      const row = { '.id': id(), ...body };
      state.addresses.push(row);
      return row;
    }
    if (method === 'GET' && path === '/ip/address') return state.addresses;
    if (method === 'PATCH' && path.startsWith('/ip/address/')) {
      const row = state.addresses.find((a) => a['.id'] === path.split('/').pop());
      Object.assign(row, body);
      return row;
    }
    if (method === 'POST' && path === '/ip/pool/add') {
      if (options.poolRejected) fail('unknown parameter ranges');
      const row = { '.id': id(), ...body };
      state.pools.push(row);
      return row;
    }
    if (method === 'GET' && path === '/ip/pool') return state.pools;
    if (method === 'POST' && path === '/ip/dhcp-server/add') {
      const row = { '.id': id(), name: body.name, interface: body.interface, 'lease-time': body['lease-time'] };
      // Some RouterOS builds silently drop address-pool on REST add - this is
      // the reported "Address Pool: unknown" state.
      if (!options.dhcpAddDropsPool) row['address-pool'] = body['address-pool'];
      state.dhcp.push(row);
      return row;
    }
    if (method === 'GET' && path === '/ip/dhcp-server') return state.dhcp;
    if (method === 'PATCH' && path.startsWith('/ip/dhcp-server/')) {
      const row = state.dhcp.find((s) => s['.id'] === path.split('/').pop());
      // Older REST builds only accept `pool`, not `address-pool`.
      if (options.dhcpPatchRejectsAddressPool && body['address-pool'] !== undefined) fail('unknown parameter address-pool');
      if (body.pool !== undefined) row['address-pool'] = body.pool;
      if (body['address-pool'] !== undefined && !options.dhcpPatchRejectsAddressPool) row['address-pool'] = body['address-pool'];
      return row;
    }
    if (method === 'POST' && path === '/ip/dhcp-server/network/add') {
      const row = { '.id': id(), ...body };
      state.networks.push(row);
      return row;
    }
    if (method === 'GET' && path === '/ip/hotspot/profile') return state.hotspotProfiles;
    if (method === 'POST' && path === '/ip/hotspot/profile/add') {
      const row = { '.id': id(), ...body };
      state.hotspotProfiles.push(row);
      return row;
    }
    if (method === 'POST' && path === '/ip/hotspot/add') {
      const row = { '.id': id(), ...body };
      state.hotspotServers.push(row);
      return row;
    }
    if (method === 'PUT' && path.startsWith('/ip/hotspot/')) {
      const row = state.hotspotServers.find((s) => s['.id'] === path.split('/').pop());
      if (row) Object.assign(row, body);
      return row;
    }
    if (method === 'GET' && path === '/ip/hotspot/user/profile') return state.userProfiles;
    if (method === 'POST' && path === '/ip/hotspot/user/profile/add') {
      const row = { '.id': id(), ...body };
      state.userProfiles.push(row);
      return row;
    }
    if (method === 'POST' && path === '/ip/hotspot/user/add') {
      const row = { '.id': id(), ...body };
      state.users.push(row);
      return row;
    }
    throw new Error(`fake router: unhandled ${method} ${path}`);
  };
  return state;
}

const baseConfig = {
  interface: 'bridge-lan',
  address: '10.0.100.1',
  poolStart: '10.0.100.10',
  poolEnd: '10.0.100.254',
  dnsServers: '8.8.8.8,8.8.4.4',
  dnsName: 'hotspot.local',
  adminUsername: 'admin',
  adminPassword: 'secret1',
};

test('bare address gets a /24 instead of RouterOS defaulting to /32', async () => {
  const state = fakeRouter();
  const result = await mt.setupHotspot(1, { ...baseConfig });

  assert.equal(state.addresses.length, 1);
  assert.equal(state.addresses[0].address, '10.0.100.1/24');
  assert.equal(result.address, 'bridge-lan 10.0.100.1/24');
  // DHCP network must be the NETWORK address of that /24, gateway .1
  assert.equal(state.networks[0].address, '10.0.100.0/24');
  assert.equal(state.networks[0].gateway, '10.0.100.1');
});

test('a leftover bare /32 address is repaired in place', async () => {
  const state = fakeRouter({ addresses: [{ '.id': '*old', address: '10.0.100.1/32', interface: 'bridge-lan', comment: 'Hotspot' }] });
  const result = await mt.setupHotspot(1, { ...baseConfig });

  assert.equal(state.addresses.length, 1, 'must not add a duplicate entry');
  assert.equal(state.addresses[0].address, '10.0.100.1/24');
  assert.equal(result.addressRepaired, '10.0.100.1/32 -> 10.0.100.1/24');
});

test('DHCP server created without a pool link is healed to the setup pool', async () => {
  const state = fakeRouter({ dhcpAddDropsPool: true, dhcpPatchRejectsAddressPool: true });
  const result = await mt.setupHotspot(1, { ...baseConfig });

  assert.equal(state.pools.length, 1);
  assert.equal(state.pools[0].name, 'hs-pool-bridge-lan');
  assert.equal(state.dhcp.length, 1);
  assert.equal(state.dhcp[0]['address-pool'], 'hs-pool-bridge-lan', 'the "unknown" pool must be re-linked');
  assert.ok(result.dhcpRepaired, 'repair should be reported');
  assert.ok(state.calls.some((c) => c.startsWith('PATCH /ip/dhcp-server/')), 'heal must PATCH the server');
});

test('missing pool fails loudly instead of leaving a DHCP server on "unknown"', async () => {
  fakeRouter({ poolRejected: true });
  await assert.rejects(
    () => mt.setupHotspot(1, { ...baseConfig }),
    /Address pool 'hs-pool-bridge-lan' is missing/
  );
});

test('invalid hotspot addresses are rejected before any router write', async () => {
  for (const address of ['not-an-ip', '10.0.100.999', '10.0.100.1/31', '10.0.100.1/2']) {
    const state = fakeRouter();
    await assert.rejects(() => mt.setupHotspot(1, { ...baseConfig, address }), /Invalid/);
    assert.equal(state.calls.length, 0, `${address} must not reach the router`);
  }
});
