const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
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
