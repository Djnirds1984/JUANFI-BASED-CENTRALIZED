// Which sub-vendo a phone may pay. The portal hides the others, but the panel
// is the only route an AirCoins box has, so the refusal has to live here too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/services/vendoAutoSelect.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { autoSelectVendo, namesNetwork, vendoServesClient, ipInSubnet } = vm.runInNewContext(
  `(function (exports) { ${compiled}\n return exports; })({})`,
);

// Two shops on one router: VLAN 10 feeds vendo 1, VLAN 20 feeds vendo 2. The
// third machine publishes its network explicitly because it sits on a
// management VLAN rather than the one the phones use.
const vendos = [
  { value: 'aircoins:1', name: 'Counter slot', ip: '10.0.10.5', routerId: 1, subnets: [] },
  { value: 'aircoins:2', name: 'Back room slot', ip: '10.0.20.5', routerId: 1, subnets: [] },
  { value: 'aircoins:3', name: 'Annex slot', ip: '10.0.99.5', routerId: 1, subnets: ['10.0.30.0/24'] },
  { value: '10.0.40.5', name: 'Legacy JuanFi', ip: '10.0.40.5', routerId: 1, subnets: [] },
];

test('a lease inside a machine\'s own /24 names that machine', () => {
  const choice = autoSelectVendo('10.0.20.77', 1, vendos);
  assert.equal(choice.value, 'aircoins:2');
  assert.equal(choice.reason, 'subnet');
  assert.ok(namesNetwork(choice));
});

test('a declared VLAN subnet beats the machine\'s own /24', () => {
  const choice = autoSelectVendo('10.0.30.77', 1, vendos);
  assert.equal(choice.value, 'aircoins:3');
  assert.equal(choice.reason, 'subnet');
  assert.ok(ipInSubnet('10.0.30.200', '10.0.30.0/24'));
  assert.ok(!ipInSubnet('10.0.31.200', '10.0.30.0/24'));
});

test('only an address or a subnet may lock a portal', () => {
  assert.equal(namesNetwork({ value: 'aircoins:1', name: 'Counter slot', reason: 'address' }), true);
  assert.equal(namesNetwork({ value: 'aircoins:1', name: 'Counter slot', reason: 'subnet' }), true);
  assert.equal(namesNetwork({ value: 'aircoins:1', name: 'Counter slot', reason: 'router' }), false);
  assert.equal(namesNetwork({ value: 'aircoins:1', name: 'Counter slot', reason: 'only' }), false);
  assert.equal(namesNetwork(null), false);
});

test('the machine on the phone\'s own network accepts the coins', () => {
  assert.equal(vendoServesClient('10.0.20.77', 1, vendos, 'aircoins:2', '10.0.20.5'), true);
  assert.equal(vendoServesClient('10.0.30.77', 1, vendos, 'aircoins:3', '10.0.99.5'), true,
    'the declared VLAN is enough, the machine sits on another segment');
  assert.equal(vendoServesClient('10.0.40.77', 1, vendos, '10.0.40.5', '10.0.40.5'), true,
    'a legacy JuanFi entry is matched by its address');
});

test('a phone on another VLAN is refused every machine but its own', () => {
  assert.equal(vendoServesClient('10.0.20.77', 1, vendos, 'aircoins:1', '10.0.10.5'), false);
  assert.equal(vendoServesClient('10.0.10.77', 1, vendos, 'aircoins:2', '10.0.20.5'), false);
  assert.equal(vendoServesClient('10.0.30.77', 1, vendos, 'aircoins:1', '10.0.10.5'), false);
});

test('an address already known wins over a neighbouring /24', () => {
  // The vendo's own portal page asks for itself.
  const choice = autoSelectVendo('10.0.10.5', 1, vendos);
  assert.equal(choice.reason, 'address');
  assert.equal(vendoServesClient('10.0.10.5', 1, vendos, 'aircoins:1', '10.0.10.5'), true);
});

test('undecided networks keep the old behaviour instead of guessing', () => {
  // A lease no machine claims, on a router with more than one machine: the
  // panel says nothing rather than refusing a paying customer.
  assert.equal(autoSelectVendo('192.168.50.9', 1, vendos), null);
  assert.equal(vendoServesClient('192.168.50.9', 1, vendos, 'aircoins:1', '10.0.10.5'), true);

  // No address at all (an old bookmark without the hotspot redirect).
  assert.equal(vendoServesClient('', 1, vendos, 'aircoins:1', '10.0.10.5'), true);

  // A single machine is a fallback, not a network: it still says yes. Which
  // fallback fired is incidental - router before only - but neither may lock.
  const single = [vendos[0]];
  assert.equal(autoSelectVendo('192.168.50.9', 1, single).reason, 'router');
  assert.equal(autoSelectVendo('192.168.50.9', 2, single).reason, 'only');
  assert.equal(namesNetwork(autoSelectVendo('192.168.50.9', 2, single)), false);
  assert.equal(vendoServesClient('192.168.50.9', 1, single, 'aircoins:1', '10.0.10.5'), true);
});

test('the machine\'s registered address also identifies it', () => {
  // A legacy config entry can name the same box by address while the registry
  // names it by id; the two must not be treated as different machines.
  assert.equal(vendoServesClient('10.0.10.77', 1, vendos, 'whatever', '10.0.10.5'), true);
});

test('two slots sharing one flat LAN lock neither of them', () => {
  // Small shops often wire every vendo to the same switch and SSID. The segment
  // then names no single machine, so the portal keeps its list and the panel
  // accepts either slot instead of stranding the one it did not pick.
  const flat = [
    { value: 'aircoins:7', name: 'Left slot', ip: '10.0.0.5', routerId: 1, subnets: [] },
    { value: 'aircoins:8', name: 'Right slot', ip: '10.0.0.6', routerId: 1, subnets: [] },
  ];
  assert.equal(autoSelectVendo('10.0.0.77', 1, flat), null);
  assert.equal(vendoServesClient('10.0.0.77', 1, flat, 'aircoins:7', '10.0.0.5'), true);
  assert.equal(vendoServesClient('10.0.0.77', 1, flat, 'aircoins:8', '10.0.0.6'), true);

  // The same is true when both declare that subnet by hand.
  const declared = flat.map((vendo) => ({ ...vendo, subnets: ['10.0.0.0/24'] }));
  assert.equal(namesNetwork(autoSelectVendo('10.0.0.77', 1, declared)), false);
});