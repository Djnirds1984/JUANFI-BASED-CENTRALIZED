const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'public/js/api.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const vendoredPath = path.join(root, 'public/js/esptool-js.js');

// Execute the real firmware routes against an in-memory filesystem: the test
// must not depend on which release binaries happen to sit in the checkout.
function toolsApi() {
  const files = new Map(); // full path -> { content, mtimeMs, isFile }
  const dirs = new Map();
  const streams = [];

  const fakeFs = {
    readdirSync(dir) {
      if (!dirs.has(dir)) {
        const error = new Error(`ENOENT: ${dir}`);
        error.code = 'ENOENT';
        throw error;
      }
      return dirs.get(dir).slice();
    },
    statSync(target) {
      if (!files.has(target)) {
        const error = new Error(`ENOENT: ${target}`);
        error.code = 'ENOENT';
        throw error;
      }
      const entry = files.get(target);
      return {
        isFile: () => entry.isFile !== false,
        size: entry.content.length,
        mtimeMs: entry.mtimeMs,
      };
    },
    createReadStream(target) {
      const entry = files.get(target);
      streams.push(target);
      return {
        pipe(destination) {
          destination.write(Buffer.from(entry.content));
          destination.end();
          return destination;
        },
      };
    },
    existsSync() { return false; },
  };

  const filename = path.join(root, 'src/api/tools.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;

  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    __dirname: path.dirname(filename),
    console,
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === '../middleware/auth') return { authMiddleware() {} };
      if (name === '../services/zerotier') return {};
      if (name === '../services/turso') return {};
      if (name === '../config') return { config: { dbPath: path.join(root, 'data/test.db') } };
      return require(name);
    },
  });

  function invoke(routePath, method = 'get', { params = {}, body = {} } = {}) {
    const layer = exports.default.stack.find(
      (entry) => entry.route && entry.route.path === routePath && entry.route.methods[method]
    );
    assert.ok(layer, `route ${method.toUpperCase()} ${routePath} is not registered`);

    const headers = {};
    let code = 200;
    let payload = null;
    let written = '';
    let ended = false;
    const res = {
      setHeader(key, value) { headers[key.toLowerCase()] = value; },
      status(value) { code = value; return this; },
      json(value) { payload = value; return this; },
      write(chunk) { written += String(chunk); return true; },
      end() { ended = true; },
    };

    layer.route.stack[0].handle({ query: {}, params, body }, res);
    return { code, payload, headers, written, ended };
  }

  return { files, dirs, streams, invoke };
}

function addImage(store, dir, name, { size = 4, mtimeMs = 1, isFile = true, content = 'E9X' } = {}) {
  if (!store.dirs.has(dir)) store.dirs.set(dir, []);
  store.dirs.get(dir).push(name);
  store.files.set(path.join(dir, name), { content, mtimeMs, isFile });
}

test('GET /firmware merges both folders, drops duplicates and non-images, newest first', () => {
  const api = toolsApi();
  const releaseDir = path.join(root, 'aircoins-nodemcu');
  const deployDir = path.join(root, 'firmware');

  addImage(api, releaseDir, 'AirCoins-v1.4.0.bin', { mtimeMs: 100 });
  addImage(api, releaseDir, 'AirCoins-v1.4.3.bin', { mtimeMs: 300 });
  addImage(api, releaseDir, 'notes.txt', { mtimeMs: 400 });
  addImage(api, releaseDir, 'folder.bin', { mtimeMs: 500, isFile: false });
  // The deploy copy of the same release must not appear twice.
  addImage(api, deployDir, 'AirCoins-v1.4.3.bin', { mtimeMs: 300 });

  const result = api.invoke('/firmware');

  assert.equal(result.code, 200);
  // Array.from, not .map: the payload arrays are built inside the VM realm.
  const names = Array.from(result.payload.files, (file) => file.name);
  assert.deepEqual(names, ['AirCoins-v1.4.3.bin', 'AirCoins-v1.4.0.bin']);
  assert.equal(result.payload.files[0].version, '1.4.3');
  assert.equal(result.payload.files[0].modified, 300);
});

test('GET /firmware survives a missing folder', () => {
  const api = toolsApi();
  addImage(api, path.join(root, 'aircoins-nodemcu'), 'AirCoins-v1.4.3.bin', { mtimeMs: 10 });

  const result = api.invoke('/firmware');

  assert.equal(result.code, 200);
  assert.equal(result.payload.files.length, 1);
});

test('GET /firmware/:name streams the image as octet-stream', () => {
  const api = toolsApi();
  const releaseDir = path.join(root, 'aircoins-nodemcu');
  addImage(api, releaseDir, 'AirCoins-v1.4.3.bin', { content: 'E9-FIRMWARE' });

  const result = api.invoke('/firmware/:name', 'get', { params: { name: 'AirCoins-v1.4.3.bin' } });

  assert.equal(result.code, 200);
  assert.equal(result.headers['content-type'], 'application/octet-stream');
  assert.equal(result.headers['content-disposition'], 'attachment; filename="AirCoins-v1.4.3.bin"');
  assert.equal(result.headers['content-length'], 'E9-FIRMWARE'.length);
  assert.equal(result.written, 'E9-FIRMWARE');
  assert.equal(result.ended, true);
});

test('GET /firmware/:name refuses anything but a plain .bin name', () => {
  const api = toolsApi();
  const releaseDir = path.join(root, 'aircoins-nodemcu');
  addImage(api, releaseDir, 'AirCoins-v1.4.3.bin');
  // On disk, but not reachable through the route.
  api.files.set(path.join(root, 'data/secret.bin'), { content: 'NOPE', mtimeMs: 1 });

  for (const name of ['../../../data/secret.bin', '..%2Fsecret.bin', 'secret.bin', 'AirCoins-v1.4.3.bin.exe', '']) {
    const result = api.invoke('/firmware/:name', 'get', { params: { name } });
    assert.equal(result.code, 404, `${name || '(empty)'} should not resolve`);
    assert.equal(result.written, '');
  }
  assert.equal(api.streams.length, 0);
});

test('the vendored esptool-js bundle is a self-contained ESM module', () => {
  const source = fs.readFileSync(vendoredPath, 'utf8');

  assert.ok(source.length > 100000, 'bundle looks truncated');
  assert.match(source.slice(0, 400), /esptool-js/);
  assert.match(source.slice(0, 400), /Apache-2\.0/);
  assert.match(source, /export\{[^}]*\bESPLoader\b/);
  assert.match(source, /export\{[^}]*\bTransport\b/);
  // A bare import would need a bundler this project does not have.
  assert.equal(/^\s*import\s/m.test(source), false);
  assert.equal(/\brequire\(/.test(source), false);
});

test('the Tools page wires the flasher tab to the serial backend', () => {
  assert.match(appSource, /data-toolstab="flasher"[^>]*>SubVendo Flasher</);
  assert.match(appSource, /this\._toolsTab === 'flasher'\)\s*\{\s*await this\.renderFlasherContent\(container\)/);
  assert.match(appSource, /import\('\/js\/esptool-js\.js'\)/);
  assert.match(appSource, /navigator\.serial\.requestPort\(\)/);
  assert.match(appSource, /new mod\.ESPLoader\(/);
  assert.match(appSource, /await loader\.main\(\)/);
  assert.match(appSource, /await st\.loader\.writeFlash\(/);
  // A full ESP8266 image goes to the start of flash, and the flash parameters
  // baked in by PlatformIO stay untouched.
  assert.match(appSource, /fileArray: \[\{ data, address: 0 \}\]/);
  assert.match(appSource, /flashSize: 'keep'/);
  assert.match(appSource, /flashMode: 'keep'/);
  assert.match(appSource, /flashFreq: 'keep'/);
  // Erasing also wipes the stored shop Wi-Fi and device key, so it is opt-in.
  assert.match(appSource, /const eraseAll = !!\(eraseBox && eraseBox\.checked\)/);
  assert.match(appSource, /id="fw-erase">/);
  assert.doesNotMatch(appSource, /id="fw-erase"[^>]*checked/);
  // The port must not stay locked after leaving the page.
  assert.match(appSource, /clearChatPollers\(\);\s*this\.closeFlasherPort\(\);/);
});

test('the client fetches the firmware list and the raw image', () => {
  assert.match(apiSource, /async listFirmware\(\) \{\s*return this\.get\('\/tools\/firmware'\)/);
  assert.match(apiSource, /async getFirmwareBinary\(name\)/);
  assert.match(apiSource, /arrayBuffer\(\)/);
  assert.match(apiSource, /tools\/firmware\/\$\{encodeURIComponent\(name\)\}/);
});

test('the flasher panel and its console have styles', () => {
  for (const selector of ['.flasher-grid', '.flasher-panel', '.flasher-progress-bar', '.flasher-log', '.flasher-notice']) {
    assert.ok(cssSource.includes(selector + ' {'), `${selector} has no rule`);
  }
});
