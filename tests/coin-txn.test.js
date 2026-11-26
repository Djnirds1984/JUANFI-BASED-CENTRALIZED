// One feed, one transaction. The id is minted when the first coin is counted
// and the whole feed is sold under it, so the ledger cannot show a ₱10 feed as
// three separate sales. The session store is a JSON file, so this runs without
// the native sqlite binding.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coin-txn-'));

/** Load a service straight from TS, with the modules it needs stubbed. */
function load(name, stubs) {
  const filename = path.join(root, 'src/services', name);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (id) => (stubs[id] ? stubs[id] : require(id));
  const sandbox = {
    module: loaded, exports: loaded.exports, require: localRequire,
    process, Buffer, console,
    __dirname: path.dirname(filename), __filename: filename,
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(compiled, sandbox, { filename });
  return loaded.exports;
}

const shopTime = load('shopTime.ts', {});

const session = load('aircoinsSession.ts', {
  // The session store is a JSON file; the shop clock is the real one.
  './shopTime': shopTime,
  './aircoins': {
    airCoinsDataDir: () => dataDir,
    getSettings: () => ({ pulsesPerCoin: 1, coinValue: 1, rates: [] }),
    getStatus: () => null,
    planCoinAllocation: () => ({ minutes: 0, spent: 0, leftover: 0, applied: [] }),
  },
});

test('the first coin mints the id the whole feed is sold under', () => {
  const slot = session.openSession(1, '', '4C3488A431ED', 1, 'time');
  // Nothing is charged for opening the slot, so there is no transaction yet.
  assert.equal(slot.txnId, undefined);

  const txn = session.stampSessionTxn(slot.id);
  assert.match(txn, /^TX-\d{8}-[0-9A-F]{6}$/);
  // Second and third coins reuse it instead of starting a new sale.
  assert.equal(session.stampSessionTxn(slot.id), txn);
  assert.equal(session.findSessionById(slot.id).txnId, txn);
});

test('two feeds never share a transaction id', () => {
  const first = session.openSession(2, '', 'AABBCCDDEEFF', 1, 'time');
  const second = session.openSession(2, '', 'AABBCCDDEEFF', 1, 'time');
  const a = session.stampSessionTxn(first.id);
  const b = session.stampSessionTxn(second.id);
  assert.notEqual(a, b);
});

test('the ledger keeps one row per slot, with the transaction id on it', () => {
  const sale = fs.readFileSync(path.join(root, 'src/services/aircoinsSale.ts'), 'utf8');
  // A slot's batch moves the existing row forward; only a board-alone sale inserts.
  assert.match(sale, /if \(sessionId\) return writeSlotSale\(/);
  assert.match(sale, /SELECT id FROM aircoins_sales\s+WHERE session_id = \? ORDER BY id LIMIT 1/);
  assert.match(sale, /UPDATE aircoins_sales/);

  const schema = fs.readFileSync(path.join(root, 'src/database.ts'), 'utf8');
  assert.match(schema, /txn_id TEXT NOT NULL DEFAULT ''/);
  // Old per-batch rows are folded on start-up, so the report shows one row each.
  assert.match(schema, /HAVING COUNT\(\*\) > 1/);
});
