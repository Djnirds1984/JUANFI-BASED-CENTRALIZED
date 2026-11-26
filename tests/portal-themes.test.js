const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const portalJsSource = fs.readFileSync(path.join(root, 'public/assets/js/portal.js'), 'utf8');
const themeSource = fs.readFileSync(path.join(root, 'public/js/portal-themes.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(root, 'public/portal.html'), 'utf8');
const hotspotHtml = fs.readFileSync(path.join(root, 'hotspot/login.html'), 'utf8');
const themes = vm.runInNewContext(themeSource + '\nPortalThemes;');

// Execute the actual file routes with an in-memory filesystem. Never load the
// production database, send router commands, or overwrite the portal on disk.
function portalApi() {
  const disk = new Map([[path.join(root, 'public/portal.html'), panelHtml]]);
  for (const file of ['login.html', 'status.html', 'logout.html']) {
    disk.set(path.join(root, 'hotspot', file), hotspotHtml);
  }
  const reads = [], writes = [];
  const fakeFs = {
    readFileSync(file) {
      reads.push(file);
      if (!disk.has(file)) throw new Error('Missing test fixture');
      return disk.get(file);
    },
    statSync() { return { mtime: new Date(0) }; },
    mkdirSync() {},
    writeFileSync(file, content) { writes.push(file); disk.set(file, content); },
  };
  const filename = path.join(root, 'src/api/portal.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, __dirname: path.dirname(filename), console,
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === '../database') return { EDITABLE_EXTENSIONS: new Set(['.html']), getPortalDefaultContent: () => null };
      if (name === '../middleware/auth') return { authMiddleware() {} };
      if (name === '../config') return { config: {} };
      if (name.startsWith('../services/')) return {};
      return require(name);
    },
  });
  function invoke(method, file, folder, body = {}) {
    const layer = exports.default.stack.find(layer => layer.route?.path === '/file/*' && layer.route.methods[method]);
    let code = 200, payload;
    const res = { status(value) { code = value; return this; }, json(value) { payload = value; } };
    layer.route.stack[0].handle({ query: { folder }, params: { 0: file }, body }, res);
    return { code, payload };
  }
  const calls = [];
  return {
    disk, reads, writes, calls, invoke,
    async getPortalFile(file, folder) {
      calls.push(['get', file, folder]);
      const result = invoke('get', file, folder);
      if (result.code !== 200) throw new Error(result.payload.error);
      return result.payload;
    },
    async savePortalFile(file, content, folder) {
      calls.push(['put', file, folder]);
      const result = invoke('put', file, folder, { content });
      if (result.code !== 200) throw new Error(result.payload.error);
      return result.payload;
    },
  };
}

function dashboard(api, tab = 'panel-page') {
  const nodes = new Map();
  const document = {
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    getElementById: id => nodes.get(id) || null,
  };
  const confirmations = [], notices = [];
  const app = vm.runInNewContext(appSource + '\nApp;', {
    document, api, PortalThemes: themes, console,
    confirm(message) { confirmations.push(message); return true; },
    clearTimeout() {}, setTimeout() {}, requestAnimationFrame(callback) { callback(); },
  });
  app.portalActiveTab = tab;
  app.toast = (message, type) => notices.push({ message, type });
  app.closePortalThemes = () => {};
  const renderPortal = app.renderPortal.bind(app);
  app.renderPortal = async () => {};
  return { app, document, nodes, confirmations, notices, renderPortal };
}

for (const theme of themes.getThemeList()) {
  test(`Panel Portal applies ${theme.id} only to the allowed portal.html path`, async () => {
    const api = portalApi();
    const { app, confirmations, notices } = dashboard(api);
    await app.applyPortalTheme(theme.id);
    assert.deepEqual(api.calls, [['get', 'portal.html', 'panel-page'], ['put', 'portal.html', 'panel-page']]);
    assert.equal(notices.at(-1).type, 'success');
    assert.match(confirmations[0], /portal\.html/);
    assert.doesNotMatch(confirmations[0], /login\.html/);
    assert.match(confirmations[0], /no router upload/);
    const saved = api.invoke('get', 'portal.html', 'panel-page').payload.content;
    assert.equal(saved, themes.applyTheme(panelHtml, theme, 'panel-page'));
    assert.equal(saved.slice(saved.indexOf('</head>')), panelHtml.slice(panelHtml.indexOf('</head>')));
    assert.ok(saved.includes(panelHtml.match(/<style>[\s\S]*?<\/style>/)[0]), 'base styles are preserved');
    if (theme.id !== 'default') {
      assert.equal((saved.match(/data-panel-theme=/g) || []).length, 1);
      assert.match(saved, /body#loginBody\s*\{/);
    }
    assert.doesNotMatch(saved, /href=["']assets\/css\/JuanFi\.css/);
    await app.applyPortalTheme('default');
    assert.equal(api.invoke('get', 'portal.html', 'panel-page').payload.content, panelHtml);
  });
}

test('successive panel themes replace one override and Default restores original HTML', () => {
  let html = panelHtml;
  for (const theme of themes.getThemeList().filter(theme => theme.css)) {
    html = themes.applyTheme(html, theme, 'panel-page');
    assert.equal((html.match(/data-panel-theme=/g) || []).length, 1);
    assert.equal(themes.applyTheme(html, theme, 'panel-page'), html, 'reapplication is idempotent');
  }
  assert.equal(themes.applyTheme(html, themes.getTheme('default'), 'panel-page'), panelHtml);
});

test('MikroTik themes still read and write all three hotspot pages', async () => {
  const api = portalApi();
  const { app, confirmations, notices } = dashboard(api, 'mikrotik');
  await app.applyPortalTheme('gaming');
  for (const method of ['get', 'put']) {
    assert.deepEqual(api.calls.filter(call => call[0] === method), [
      [method, 'login.html', 'hotspot'], [method, 'status.html', 'hotspot'], [method, 'logout.html', 'hotspot'],
    ]);
  }
  assert.match(confirmations[0], /Push All to Router/);
  assert.equal(notices.at(-1).type, 'success');
  const saved = api.invoke('get', 'login.html', 'hotspot').payload.content;
  assert.match(saved, /neonPulse/);
  assert.doesNotMatch(saved, /data-panel-theme/);
  assert.match(themes.applyTheme(saved, themes.getTheme('default')), /assets\/css\/JuanFi\.css/);
});

test('stub theme actions do not read or modify redirect pages', async () => {
  const api = portalApi();
  const { app, notices } = dashboard(api, 'stub');
  app.openPortalThemes();
  await app.applyPortalTheme('gaming');
  assert.equal(api.calls.length, 0);
  assert.ok(notices.every(notice => notice.message.includes('Panel Portal')));
});

test('panel path restrictions continue to reject legacy names and traversal for GET and PUT', () => {
  const api = portalApi();
  for (const file of ['login.html', 'status.html', 'logout.html', '../portal.html', '/portal.html', 'js/app.js', '..\\portal.html']) {
    for (const method of ['get', 'put']) {
      const result = api.invoke(method, file, 'panel-page', { content: 'must not write' });
      assert.equal(result.code, 400);
      assert.equal(result.payload.error, 'Invalid file path');
    }
  }
  assert.equal(api.reads.length, 0);
  assert.equal(api.writes.length, 0);
});

test('a failed page read saves nothing and leaves unsaved editor state intact', async () => {
  const api = portalApi();
  api.disk.delete(path.join(root, 'hotspot/status.html'));
  const { app, notices } = dashboard(api, 'mikrotik');
  app.portalDirty = true;
  await app.applyPortalTheme('sunrise');
  assert.equal(api.writes.length, 0);
  assert.equal(app.portalDirty, true);
  assert.equal(app._portalThemeApplying, false);
  assert.equal(notices.at(-1).type, 'error');
});

test('duplicate Apply clicks are ignored and the target folder is captured before I/O', async () => {
  const api = portalApi();
  const originalRead = api.getPortalFile;
  let release;
  api.getPortalFile = async (...args) => {
    await new Promise(resolve => { release = resolve; });
    return originalRead(...args);
  };
  const { app } = dashboard(api);
  const first = app.applyPortalTheme('gaming');
  await app.applyPortalTheme('sunrise');
  app.portalActiveTab = 'mikrotik';
  app.portalDirty = true;
  release();
  await first;
  assert.deepEqual(api.calls, [['get', 'portal.html', 'panel-page'], ['put', 'portal.html', 'panel-page']]);
  assert.equal(app.portalDirty, true, 'another tab must not lose dirty state');
});

test('panel preview uses the panel transformation and public asset root without saving', async () => {
  const api = portalApi();
  const { app, nodes } = dashboard(api);
  const preview = {};
  nodes.set('portal-preview', preview);
  app.portalCurrentFile = 'portal.html';
  await app.previewPortalTheme('gaming');
  assert.match(preview.srcdoc, /data-panel-theme/);
  assert.match(preview.srcdoc, /<base href="\/">/);
  assert.doesNotMatch(preview.srcdoc, /hotspot-assets/);
  assert.equal(api.writes.length, 0);
});

test('panel editor renders with connected routers but no router selector', async () => {
  const api = portalApi();
  api.getRouters = async () => [{ id: 1, name: 'Test router', connected: true }];
  api.getPortalFiles = async () => ({ files: [{ path: 'portal.html', editable: true, size: panelHtml.length }] });
  const { app, nodes, renderPortal } = dashboard(api);
  for (const id of ['page-content', 'portal-editor', 'portal-file-info', 'portal-save-btn', 'portal-reset-btn',
    'portal-toggle-preview', 'portal-upload-btn', 'portal-dirty', 'portal-preview']) {
    nodes.set(id, { style: {}, addEventListener() {} });
  }
  app.escapeHtml = value => String(value);
  app.selectedRouterId = 1;
  await renderPortal();
  assert.equal(app.portalCurrentFile, 'portal.html');
  assert.equal(nodes.get('portal-editor').value, panelHtml);
  assert.equal(nodes.get('portal-upload-btn').style.display, 'none');
  assert.ok(!nodes.get('page-content').innerHTML.includes('id="portal-router-select"'));
});

// ---- Portal coin sounds ----

const MP3_BYTES = Buffer.concat([Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000', 'binary'), Buffer.alloc(128, 0xff)]);
const WAV_BYTES = Buffer.concat([Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt ', 'binary'), Buffer.alloc(64)]);
const NOT_AUDIO = Buffer.from('this is not a sound file');
const SOUNDS_DIR = path.join(root, 'public/assets/uploads/sounds');

// Runs the real /sounds routes against an in-memory disk and settings row, so a
// test upload never lands in public/assets/uploads or the production database.
function soundsApi(initial = {}) {
  const row = {
    currency: 'PHP', company_name: 'MikroTik', logo_path: '',
    insert_coin_sound: initial.insert_coin || '', coin_drop_sound: initial.coin_drop || '',
    updated_at: null,
  };
  const fakeDb = {
    prepare(sql) {
      return {
        run(...params) {
          const set = sql.match(/SET\s+(\w+)\s*=\s*\?/);
          if (set) row[set[1]] = params[0];
        },
        get() { return { ...row }; },
      };
    },
  };
  const disk = new Map();
  const writes = [], unlinks = [];
  const fakeFs = {
    mkdirSync() {},
    existsSync(file) { return disk.has(file); },
    writeFileSync(file, content) { writes.push(file); disk.set(file, content); },
    unlinkSync(file) { unlinks.push(file); disk.delete(file); },
  };
  const filename = path.join(root, 'src/api/settings.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, __dirname: path.dirname(filename), console, Buffer, Date,
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === '../database') return { getDb: () => fakeDb };
      if (name === '../middleware/auth') return { authMiddleware() {} };
      // settings.ts validates the trial ceiling against the real constant; the
      // sandbox has no module tree of its own to resolve it from.
      if (name === '../services/trial') return { MAX_TRIAL_MINUTES: 1440 };
      return require(name);
    },
  });
  const layers = exports.default.stack;
  const route = (method, p) => layers.find(l => l.route?.path === p && l.route.methods[method]);
  function respond(method, p, handlerIndex, req) {
    let code = 200, payload;
    const res = { status(value) { code = value; return this; }, json(value) { payload = value; } };
    route(method, p).route.stack[handlerIndex].handle(req, res);
    return { code, payload };
  }
  return {
    row, disk, writes, unlinks,
    // The portal asks for the sounds while the device is still captive, so this
    // route has to sit in front of the auth middleware.
    isPublic() {
      const authIndex = layers.findIndex(l => !l.route && l.handle?.name === 'authMiddleware');
      const soundIndex = layers.findIndex(l => l.route?.path === '/sounds' && l.route.methods.get);
      return soundIndex !== -1 && (authIndex === -1 || soundIndex < authIndex);
    },
    read() { return respond('get', '/sounds', 0, {}); },
    upload(kind, body) { return respond('post', '/sounds/:kind', 1, { params: { kind }, body }); },
    remove(kind) { return respond('delete', '/sounds/:kind', 0, { params: { kind } }); },
  };
}

test('coin sound upload stores the bytes and records its URL, replacing cleanly', () => {
  const api = soundsApi();
  assert.ok(api.isPublic(), 'GET /settings/sounds must not require a login');
  const blank = api.read().payload;
  assert.equal(blank.insert_coin, '');
  assert.equal(blank.coin_drop, '');
  assert.equal(blank.defaults.insert_coin, '/hotspot-assets/assets/insertcoinbg.mp3');
  assert.equal(blank.defaults.coin_drop, '/hotspot-assets/assets/coin-received.mp3');

  const first = api.upload('insert-coin', MP3_BYTES);
  assert.equal(first.code, 200);
  assert.match(first.payload.insert_coin, /^\/assets\/uploads\/sounds\/insert-coin-\d+\.mp3$/);
  assert.equal(api.disk.get(api.writes[0]).length, MP3_BYTES.length);
  assert.equal(api.row.coin_drop_sound, '', 'the other slot is untouched');

  const second = api.upload('insert-coin', WAV_BYTES);
  assert.equal(second.code, 200);
  assert.match(second.payload.insert_coin, /\.wav$/, 'the extension follows the bytes, not the filename');
  assert.deepEqual(api.unlinks, [api.writes[0]], 'the replaced file is cleaned up');
  assert.equal(api.disk.size, 1);
});

test('unplayable, unknown and empty sound uploads are refused without touching the working file', () => {
  const stored = path.join(SOUNDS_DIR, 'insert-coin-1.mp3');
  const api = soundsApi({ insert_coin: '/assets/uploads/sounds/insert-coin-1.mp3' });
  api.disk.set(stored, MP3_BYTES);

  assert.equal(api.upload('insert-coin', NOT_AUDIO).code, 400);
  assert.equal(api.upload('theme-music', MP3_BYTES).code, 400);
  assert.equal(api.upload('coin-drop', Buffer.alloc(0)).code, 400);

  assert.deepEqual(api.writes, []);
  assert.deepEqual(api.unlinks, [], 'a refused upload must never delete the sound in use');
  assert.equal(api.row.insert_coin_sound, '/assets/uploads/sounds/insert-coin-1.mp3');
});

test('clearing a sound slot unlinks the file and leaves the built-in fallback', () => {
  const stored = path.join(SOUNDS_DIR, 'coin-drop-9.mp3');
  const api = soundsApi({ coin_drop: '/assets/uploads/sounds/coin-drop-9.mp3' });
  api.disk.set(stored, MP3_BYTES);

  const result = api.remove('coin-drop');
  assert.equal(result.code, 200);
  assert.equal(result.payload.coin_drop, '');
  assert.deepEqual(api.unlinks, [stored]);
  assert.ok(!api.disk.has(stored));
  assert.equal(api.read().payload.defaults.coin_drop, '/hotspot-assets/assets/coin-received.mp3');
});

test('Portal > Sounds tab renders both slots without a router or file request', async () => {
  const api = portalApi();
  api.getRouters = async () => { throw new Error('the Sounds tab must not need a router'); };
  api.getPortalFiles = async () => { throw new Error('the Sounds tab must not read the file tree'); };
  api.getPortalSounds = async () => ({
    insert_coin: '/assets/uploads/sounds/insert-coin-7.mp3', coin_drop: '',
    defaults: {
      insert_coin: '/hotspot-assets/assets/insertcoinbg.mp3',
      coin_drop: '/hotspot-assets/assets/coin-received.mp3',
    },
  });
  const { app, nodes, renderPortal } = dashboard(api, 'sounds');
  nodes.set('page-content', { innerHTML: '' });
  app.escapeHtml = value => String(value);
  await renderPortal();

  const html = nodes.get('page-content').innerHTML;
  assert.equal(api.writes.length, 0);
  assert.match(html, /Portal Coin Sounds/);
  assert.match(html, /App\.switchPortalTab\('sounds'\)/);
  assert.match(html, /src="\/assets\/uploads\/sounds\/insert-coin-7\.mp3"/, 'the custom sound is previewable');
  assert.match(html, /src="\/hotspot-assets\/assets\/coin-received\.mp3"/, 'an empty slot previews the built-in sound');
  assert.match(html, /id="sound-file-coin-drop"/);
  assert.equal((html.match(/\bdisabled\b/g) || []).length, 1, 'only the built-in slot has nothing to remove');
});

test('oversized and unselected audio never reach the server', async () => {
  const uploads = [];
  const api = portalApi();
  api.getPortalSounds = async () => ({ insert_coin: '', coin_drop: '', defaults: {} });
  api.uploadPortalSound = async (kind) => { uploads.push(kind); return {}; };
  const { app, nodes, notices } = dashboard(api, 'sounds');
  app.escapeHtml = value => String(value);
  app.renderPortal = async () => {};

  nodes.set('sound-file-insert-coin', { files: [{ name: 'huge.wav', size: 11 * 1024 * 1024 }] });
  nodes.set('sound-upload-insert-coin', { disabled: false, innerHTML: 'Upload' });
  await app.uploadPortalSound('insert-coin');
  assert.deepEqual(uploads, []);
  assert.match(notices.at(-1).message, /10 MB/);
  assert.equal(nodes.get('sound-upload-insert-coin').disabled, false, 'a rejected upload frees the button again');

  await app.uploadPortalSound('coin-drop');
  assert.deepEqual(uploads, []);
  assert.match(notices.at(-1).message, /Choose an audio file/);

  nodes.set('sound-file-coin-drop', { files: [{ name: 'ding.mp3', size: 2048 }] });
  await app.uploadPortalSound('coin-drop');
  assert.deepEqual(uploads, ['coin-drop']);
  assert.equal(notices.at(-1).type, 'success');
});

test('the portal loops the insert-coin sound from the click and blips on every coin', () => {
  const modal = portalJsSource.slice(portalJsSource.indexOf('function showModal'), portalJsSource.indexOf('function nodeMcuPost'));
  assert.match(modal, /playCoinSound\(insertCoinSound, true\);/, 'the loop starts inside the INSERT COIN tap');
  assert.match(modal, /stopCoinLoop\(\);/, 'closing the coin modal always silences the loop');
  const checkCoin = portalJsSource.slice(portalJsSource.indexOf('function checkCoin'), portalJsSource.indexOf('function saveVoucherAndLogin'));
  assert.match(checkCoin, /playCoinSound\(coinDropSound, true\);/, 'a separate sound per registered coin');
  assert.match(portalJsSource, /insertCoinSound\.loop = true;/);
  assert.match(portalJsSource, /insertCoinSound\.preload = 'none';/, 'a captive page reload must not re-download the sounds');
  assert.match(portalJsSource, /fetch\('\/api\/settings\/sounds'\)/);
  assert.match(portalJsSource, /\/hotspot-assets\/assets\/insertcoinbg\.mp3/, 'still playable if the request never lands');
  assert.match(portalJsSource, /if \(p && p\.catch\) p\.catch\(function\(\) \{\}\);/, 'a blocked play() must not break coin polling');
});

// The vendo rate table has two time columns: `minutes` (uptime the coins buy)
// and `validity` (how long the voucher CODE stays usable). Crediting validity
// turned a "10 peso / 2hour" rate whose validity is 4320 into a 3-day balance.
test('a coin insert credits the time the coins bought, never the rate validity', () => {
  const save = portalJsSource.slice(
    portalJsSource.indexOf('function saveVoucherAndLogin'),
    portalJsSource.indexOf('function refreshSessionAfterExtend')
  );
  assert.doesNotMatch(save, /durationMinutes: validityMin/, 'validity must never be sent as credited time');
  assert.match(save, /var creditMin = durationMin > 0 \? durationMin : \(parseInt\(data\.validity\) \|\| 0\);/);
  assert.match(save, /var durationMin = Math\.floor\(durationSec \/ 60\);/, 'timeAdded (seconds of uptime) is the paid time');
  assert.equal((save.match(/durationMinutes: creditMin/g) || []).length, 2,
    'the first login and the hit-less extend both credit the paid time');

  const promo = portalJsSource.slice(
    portalJsSource.indexOf('function loadPromoRates'),
    portalJsSource.indexOf('function loadChargingStations')
  );
  assert.match(promo, /secondsToDhms\(parseInt\(cols\[2\] \|\| '0'\) \* 60\)/,
    'the promo card shows the minutes the rate buys (cols[2]), not the code validity (cols[3])');
});
