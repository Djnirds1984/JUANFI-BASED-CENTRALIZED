const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleFile = path.join(root, 'src/services/antiTether.ts');
const compiled = ts.transpileModule(fs.readFileSync(moduleFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
// Same realm on purpose: a vm context would hand back arrays with a foreign
// prototype, and deepStrictEqual compares those.
const moduleExports = {};
new Function('exports', compiled)(moduleExports);
const {
  ANTI_TETHER_TAG, v4Network, tetherTargets, tetherRule, targetFamily,
  isTetherRule, coveredNetworks, missingTargets,
} = moduleExports;

test('v4Network masks the gateway address down to its subnet', () => {
  assert.equal(v4Network('10.5.50.1/24'), '10.5.50.0/24');
  assert.equal(v4Network('192.168.88.1/22'), '192.168.88.0/22');
  assert.equal(v4Network('172.16.5.130/25'), '172.16.5.128/25');
  assert.equal(v4Network('10.0.0.5'), '10.0.0.0/24', 'a bare address is treated as /24');
  assert.equal(v4Network('10.0.0.9/32'), '10.0.0.9/32');
});

test('v4Network refuses anything that is not a usable IPv4 network', () => {
  assert.equal(v4Network(''), '');
  assert.equal(v4Network('nonsense'), '');
  assert.equal(v4Network('10.0.0.300/24'), '');
  assert.equal(v4Network('10.0.0.1/0'), '');
  assert.equal(v4Network('10.0.0.1/33'), '');
});

test('tetherTargets keeps only hotspot interfaces and splits families', () => {
  const addresses = [
    { address: '10.5.50.1/24', interface: 'hotspot1' },
    { address: '10.5.50.1/24', interface: 'hotspot1' },
    { address: '192.168.88.1/24', interface: 'lan' },
    { address: '2001:db8:1::1/64', interface: 'hotspot1' },
    { address: '', interface: 'hotspot1' },
  ];
  const targets = tetherTargets(addresses, ['hotspot1', '']);
  assert.deepEqual(targets.ipv4, ['10.5.50.0/24']);
  assert.deepEqual(targets.ipv6, ['2001:db8:1::1/64']);
});

test('tetherTargets is empty when no hotspot server exists', () => {
  const targets = tetherTargets([{ address: '10.5.50.1/24', interface: 'lan' }], []);
  assert.deepEqual(targets, { ipv4: [], ipv6: [] });
});

test('tetherRule forwards with TTL 1 and never touches other chains', () => {
  assert.deepEqual(tetherRule('10.5.50.0/24'), {
    chain: 'forward',
    action: 'change-ttl',
    'new-ttl': 'set:1',
    'dst-address': '10.5.50.0/24',
    comment: ANTI_TETHER_TAG,
  });
  assert.deepEqual(tetherRule('2001:db8:1::/64'), {
    chain: 'forward',
    action: 'change-hop-limit',
    'new-hop-limit': 'set:1',
    'dst-address': '2001:db8:1::/64',
    comment: ANTI_TETHER_TAG,
  });
  assert.equal(targetFamily('10.5.50.0/24'), 'ip');
  assert.equal(targetFamily('2001:db8:1::/64'), 'ipv6');
});

test('only the exact tag counts as a panel rule', () => {
  assert.equal(isTetherRule({ comment: ANTI_TETHER_TAG }), true);
  assert.equal(isTetherRule({ comment: '  aircoins-anti-tether  ' }), true);
  assert.equal(isTetherRule({ comment: 'aircoins-anti-tether-OLD' }), false);
  assert.equal(isTetherRule({ comment: 'operator rule' }), false);
  assert.equal(isTetherRule({}), false);
  assert.equal(isTetherRule(undefined), false);
});

test('coveredNetworks ignores foreign rules and missing dst-address', () => {
  const covered = coveredNetworks([
    { comment: ANTI_TETHER_TAG, 'dst-address': '10.5.50.0/24' },
    { comment: ANTI_TETHER_TAG, 'dst-address': '2001:db8:1::1/64' },
    { comment: ANTI_TETHER_TAG },
    { comment: 'mine', 'dst-address': '10.9.9.0/24' },
  ]);
  assert.deepEqual(covered, { ipv4: ['10.5.50.0/24'], ipv6: ['2001:db8:1::1/64'] });
});

test('missingTargets reports a subnet the router lost', () => {
  const wanted = { ipv4: ['10.5.50.0/24', '10.5.60.0/24'], ipv6: [] };
  const covered = { ipv4: ['10.5.50.0/24'], ipv6: [] };
  assert.deepEqual(missingTargets(wanted, covered), { ipv4: ['10.5.60.0/24'], ipv6: [] });
});

test('service, API and panel are wired to the shared contract', () => {
  const service = fs.readFileSync(path.join(root, 'src/services/mikrotik.ts'), 'utf8');
  assert.match(service, /from '\.\/antiTether'/);
  assert.match(service, /async getAntiTethering\(routerId: number\)/);
  assert.match(service, /async setAntiTethering\(routerId: number, enabled: boolean\)/);
  assert.match(service, /\/ipv6\/firewall\/mangle/);
  assert.match(service, /\/ipv6\/address/);

  const api = fs.readFileSync(path.join(root, 'src/api/hotspot.ts'), 'utf8');
  assert.match(api, /router\.get\('\/router\/:routerId\/anti-tethering'/);
  assert.match(api, /router\.put\('\/router\/:routerId\/anti-tethering'/);
  assert.match(api, /typeof req\.body\?\.enabled !== 'boolean'/);

  const client = fs.readFileSync(path.join(root, 'public/js/api.js'), 'utf8');
  assert.match(client, /async getAntiTethering\(routerId\)/);
  assert.match(client, /async setAntiTethering\(routerId, enabled\)/);

  const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
  assert.match(app, /data-tab="anti-tethering">Anti-Tethering/);
  assert.match(app, /async loadAntiTethering\(container\)/);
  assert.match(app, /async toggleAntiTethering\(enabled\)/);
  assert.match(app, /case 'anti-tethering': await this\.loadAntiTethering\(container\); break;/);
});
