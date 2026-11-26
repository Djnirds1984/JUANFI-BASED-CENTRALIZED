// One clock for the panel. A sale just after midnight in Manila is the new
// day's takings even though its UTC stamp still says the day before, so the
// offset is asserted here instead of trusted. (No database: the native sqlite
// binding is not built on every dev machine, and this only needs the constant.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/services/shopTime.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require }, { filename });
const { SHOP_OFFSET_MINUTES, SHOP_SQL_SHIFT, shopToday } = loaded.exports;

/** What `date(stamp, SHOP_SQL_SHIFT)` returns in SQLite. */
function shopDay(stamp) {
  const utc = Date.parse(stamp.replace(' ', 'T') + 'Z');
  return new Date(utc + SHOP_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

test('the shop clock is eight hours ahead of UTC', () => {
  assert.equal(SHOP_OFFSET_MINUTES, 8 * 60);
  assert.equal(SHOP_SQL_SHIFT, '+8 hours');
  // 16:23 UTC is 00:23 the next morning in the shop, so that sale is the 27th.
  assert.equal(shopDay('2026-11-26 16:23:55'), '2026-11-27');
  // And a morning sale stays on its own day instead of jumping back one.
  assert.equal(shopDay('2026-11-27 01:05:00'), '2026-11-27');
});

test('today is the day the shop is living in, not the UTC one', () => {
  const expected = new Date(Date.now() + SHOP_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
  assert.match(shopToday(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(shopToday(), expected);
});
