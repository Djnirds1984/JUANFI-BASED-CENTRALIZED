const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

/**
 * Table rows in the admin SPA call back into the App object through inline
 * onclick strings, so those handler names are plain text: nothing checks them at
 * compile time or at load time. Renaming or forgetting a method ships silently and
 * the button simply stops reacting - which is how the PPP customer Edit button
 * died (it pointed at a showEditCustomerModal that was never written).
 */
function definedMethods() {
  const names = new Set();
  for (const match of appSource.matchAll(/^ {2}(?:async )?([A-Za-z0-9_]+)\s*\(/gm)) names.add(match[1]);
  for (const match of appSource.matchAll(/^ {2}([A-Za-z0-9_]+):\s*(?:async )?(?:function\b|\()/gm)) names.add(match[1]);
  return names;
}

function handlerCalls() {
  const calls = new Map();
  for (const match of appSource.matchAll(/App\.([A-Za-z0-9_]+)\s*\(/g)) {
    const line = appSource.slice(0, match.index).split('\n').length;
    if (!calls.has(match[1])) calls.set(match[1], []);
    calls.get(match[1]).push(line);
  }
  return calls;
}

test('every inline App.* click handler is a method that exists', () => {
  const defined = definedMethods();
  const dead = [...handlerCalls()].filter(([name]) => !defined.has(name));
  assert.deepEqual(
    dead.map(([name, lines]) => `${name} (lines ${lines.join(', ')})`),
    [],
    'these buttons would throw on click and look dead to the operator'
  );
});

test('the customer table wires Edit to the form that supports edit mode', () => {
  assert.match(
    appSource,
    /onclick="App\.showAddCustomerModal\(\$\{c\.id\}\)">Edit</,
    'Edit must open showAddCustomerModal(customerId)'
  );
  assert.ok(
    !appSource.includes('App.showEditCustomerModal('),
    'showEditCustomerModal does not exist on App'
  );

  // The same form serves both modes, and edit mode has its own submit path.
  assert.match(appSource, /action: \(\) => \(isEdit \? this\.submitEditCustomer\(customerId\) : this\.submitAddCustomer\(\)\)/);
});

test('an unarmed row says why instead of only saying it is unarmed', () => {
  const cell = appSource.slice(appSource.indexOf('renderScheduledCell(customer)'));
  const body = cell.slice(0, cell.indexOf('\n  },'));
  // Billing switched off arms nothing on purpose, and that is the case operators
  // hit most, so it must not be reported as a missing timer.
  assert.match(body, /_pppBillingEnabled/, 'the cell must know whether billing is on');
  assert.match(body, /billing off/);
  assert.match(body, /router timer not armed/);
  // Prepaid accounts are armed on the due date itself, so the cell cannot add the
  // router-wide grace to every row.
  assert.match(body, /graceDaysFor\(customer\)/);
});

test('the customer and pay forms show which billing model was picked', () => {
  // Choosing the plan has to rewrite the due-date explanation, otherwise "prepaid"
  // is one more word an operator has to already understand.
  assert.match(appSource, /onchange="App\.renderCustomerDueHint\(\)"/, 'the plan picker must refresh the hint');
  assert.match(appSource, /id="customer-due-hint"/);
  assert.match(appSource, /Prepaid plan: the router cuts this line on the due date itself/);

  // The Pay preview mirrors the server, so a prepaid line must not be snapped to
  // the fixed cut-off day in the text the operator reads before saving.
  const start = appSource.indexOf('updatePayPreview() {');
  const preview = appSource.slice(start, appSource.indexOf('\n  },', start));
  assert.match(preview, /plan_type/, 'the preview has to know the billing model');
  assert.match(preview, /addMonthsLocal/);

  // An overdue prepaid account is not "in grace", it is late.
  const badgeStart = appSource.indexOf('renderBillingBadge(customer) {');
  const badge = appSource.slice(badgeStart, appSource.indexOf('\n  },', badgeStart));
  assert.match(badge, /graceDaysFor\(customer\)/);
  assert.match(badge, /'Grace' : 'Overdue'/);
});
