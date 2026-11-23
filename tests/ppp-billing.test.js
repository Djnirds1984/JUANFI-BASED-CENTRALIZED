const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// PPPoE billing moves customers onto slow profiles and drops their sessions, so
// it is tested against an in-memory database plus a scripted RouterOS: no packet
// ever leaves the machine, and the controller database is never opened.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

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
  console.log('ppp billing tests: using in-memory node:sqlite fallback');
}

const { initializeDatabase, getDb } = require('../src/database');
initializeDatabase();
const db = getDb();

const jwt = require('jsonwebtoken');
const express = require('express');
const { mikroTikService: mt } = require('../src/services/mikrotik');
const billing = require('../src/services/pppBilling');

db.prepare("INSERT INTO routers (name, host, username, password, is_active) VALUES ('PPPOE-ROUTER', '10.9.9.1', 'admin', 'x', 1)").run();
const ROUTER_ID = db.prepare('SELECT id FROM routers ORDER BY id LIMIT 1').get().id;

// ---- scripted router ------------------------------------------------------------
// Secrets and live sessions behave like the real menus: a profile only changes
// when the secret exists, and a session only disappears when it is removed.
const secrets = new Map();
const activeSessions = [];
let routerConnected = true;
let liveServers = [];
const kicks = [];

function putSecret(username, profile, comment = '') {
  secrets.set(username, { id: `*sec-${secrets.size + 1}`, profile, comment });
}

mt.isConnected = () => routerConnected;
mt.setPppSecretProfile = async (_routerId, name, profile) => {
  const secret = secrets.get(name);
  if (!secret) return false;
  secret.profile = profile;
  return true;
};
mt.getPppSecrets = async () => [...secrets.entries()].map(([name, s]) => ({ '.id': s.id, name, profile: s.profile, comment: s.comment }));
mt.setPppSecretAttribute = async (_routerId, name, attr, value) => {
  const secret = secrets.get(name);
  if (!secret) return false;
  secret[attr] = value;
  return true;
};
// A real print hands back a fresh list every call, so the code under test cannot
// be tripped up by its own removals shifting the array it is walking.
mt.getPppActive = async () => activeSessions.map((s) => ({ ...s }));
mt.removePppActive = async (_routerId, id) => {
  const index = activeSessions.findIndex((s) => s['.id'] === id);
  if (index >= 0) activeSessions.splice(index, 1);
};
// Profiles are the router's own data. The real ones on the hEX are `default`
// (built-in), a rate-limited plan profile and the NON-PAYMENT one, so the mock
// carries the same shape: kebab-case properties, a `.id`, and default=true on
// the ones RouterOS shipped.
let liveProfiles = [
  { '.id': '*1', name: '10mbps', 'rate-limit': '10M/10M', 'local-address': '', 'remote-address': '', 'only-one': 'default', 'change-tcp-mss': 'default', 'use-ipv6': 'no', 'use-encryption': 'no', default: 'false' },
  { '.id': '*2', name: 'non-payment', 'rate-limit': '1M/1M', 'local-address': '172.16.44.1', 'remote-address': 'NON-PAYMENT', 'only-one': 'default', 'change-tcp-mss': 'default', 'use-ipv6': 'no', 'use-encryption': 'no', default: 'false' },
  { '.id': '*0', name: 'default', 'rate-limit': '', 'local-address': '', 'remote-address': '', default: 'true' },
];
// RouterOS has no way to un-set a profile address: an empty value answers
// "ambiguous value of pool" and even its own default token is refused, so the
// mock refuses them too and the panel is only allowed to send a real one.
function routerRejectsBlankAddresses(data) {
  for (const key of ['local-address', 'remote-address']) {
    if (data[key] === '') throw new Error(`400 Bad Request - invalid value for argument ${key}: ambiguous value of pool, more than one possible value matches input`);
  }
}

let nextProfileId = 10;
mt.getPppProfiles = async () => liveProfiles.map((p) => ({ ...p }));
mt.createPppProfile = async (_routerId, data) => {
  if (!data.name) throw new Error('400 Bad Request - name is required');
  if (liveProfiles.some((p) => p.name === data.name)) throw new Error('400 Bad Request - profile already exists');
  routerRejectsBlankAddresses(data);
  // RouterOS rejects a rate-limit it cannot parse, and `add` only takes what the
  // menu actually has - there is no comment on a profile.
  if (data['rate-limit'] && !/^\d+(\.\d+)?[kmgt]?(\/\d+(\.\d+)?[kmgt]?)?$/i.test(data['rate-limit'])) {
    throw new Error(`400 Bad Request - failure parsing rate-limit '${data['rate-limit']}'`);
  }
  const entry = { '.id': `*${nextProfileId++}`, default: 'false', 'only-one': 'default', 'change-tcp-mss': 'default', 'use-ipv6': 'no', 'use-encryption': 'no', 'local-address': '', 'remote-address': '', 'rate-limit': '', ...data };
  liveProfiles.push(entry);
  return { ret: entry['.id'] };
};
mt.updatePppProfile = async (_routerId, id, data) => {
  const entry = liveProfiles.find((p) => p['.id'] === id);
  if (!entry) throw new Error(`400 Bad Request - no such entry ${id}`);
  routerRejectsBlankAddresses(data);
  Object.assign(entry, data);
  return [];
};
mt.removePppProfile = async (_routerId, id) => {
  const before = liveProfiles.length;
  liveProfiles = liveProfiles.filter((p) => p['.id'] !== id);
  if (liveProfiles.length === before) throw new Error(`400 Bad Request - no such entry ${id}`);
  return {};
};
// /system/scheduler is where each account's own cut-off timer lives. A job with
// a name that already exists is a set, not a second job, and one-shot jobs run
// with interval=0s.
const schedulerJobs = new Map();
let nextJobId = 1;
mt.getSchedulerJobs = async () => [...schedulerJobs.values()].map((j) => ({ ...j }));
mt.setSchedulerJob = async (_routerId, job) => {
  if (!job.name) throw new Error('400 Bad Request - name is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(job['start-date'] || ''))) {
    throw new Error(`400 Bad Request - failure parsing start-date '${job['start-date']}'`);
  }
  if (!/^\d{2}:\d{2}:\d{2}$/.test(String(job['start-time'] || ''))) {
    throw new Error(`400 Bad Request - failure parsing start-time '${job['start-time']}'`);
  }
  const existing = schedulerJobs.get(job.name);
  if (existing) {
    Object.assign(existing, job);
    return { created: false, id: existing['.id'] };
  }
  const entry = { '.id': `*job${nextJobId++}`, disabled: 'false', ...job };
  schedulerJobs.set(job.name, entry);
  return { created: true, id: entry['.id'] };
};
mt.removeSchedulerJob = async (_routerId, name) => schedulerJobs.delete(name);
// Link state, because RouterOS marks a PPPoE server invalid while its port has
// no cable in it, and the panel has to tell that apart from a bad interface.
const interfaceLinks = new Map([['bridge1', false], ['ether5', true], ['ether7', true]]);
mt.getInterfaces = async () => [...interfaceLinks.entries()].map(([name, up]) => ({ name, running: up ? 'true' : 'false' }));
mt.createPppSecret = async (_routerId, data) => {
  putSecret(data.name, data.profile, data.comment || '');
  return { ret: secrets.get(data.name).id };
};
mt.removePppSecret = async (_routerId, id) => {
  for (const [name, secret] of secrets) {
    if (secret.id === id || name === id) {
      secrets.delete(name);
      const session = activeSessions.findIndex((s) => s.name === name);
      if (session >= 0) activeSessions.splice(session, 1);
      return {};
    }
  }
  throw new Error(`no such entry ${id}`);
};

// A PPPoE server has no name in RouterOS: it is the (interface, service-name)
// pair, added switched off, and REST answers an add with just {"ret":"*N"}.
let nextServerId = 1;
function routerBooleans(entry) {
  for (const key of ['one-session-per-host', 'disabled', 'accept-untagged']) {
    if (entry[key] === 'yes') entry[key] = 'true';
    else if (entry[key] === 'no') entry[key] = 'false';
  }
  return entry;
}
mt.getPppoeServers = async () => liveServers;
mt.createPppoeServer = async (_routerId, data) => {
  if (data.name !== undefined) throw new Error('400 Bad Request - unknown parameter name');
  if (!data.interface) throw new Error('400 Bad Request - interface is required');
  const clash = liveServers.find(
    (s) => s.interface === data.interface && (s['service-name'] || '') === (data['service-name'] || ''),
  );
  if (clash) throw new Error('400 Bad Request - failure: service the same name on the same interface already exists');
  const entry = routerBooleans({
    '.id': `*${nextServerId++}`,
    'service-name': '',
    'default-profile': 'default',
    authentication: 'pap,chap,mschap1,mschap2',
    'one-session-per-host': 'false',
    'max-sessions': 'unlimited',
    'max-mtu': 'auto',
    'max-mru': 'auto',
    'keepalive-timeout': '10',
    comment: '',
    disabled: 'true', // RouterOS always adds a brand new server disabled
    ...data,
  });
  liveServers.push(entry);
  return { ret: entry['.id'] };
};
mt.updatePppoeServer = async (_routerId, id, data) => {
  const entry = liveServers.find((s) => s['.id'] === id);
  if (!entry) throw new Error(`400 Bad Request - no such number ${id}`);
  if (data.name !== undefined) throw new Error('400 Bad Request - unknown parameter name');
  Object.assign(entry, routerBooleans({ ...data }));
  return [];
};
mt.removePppoeServer = async (_routerId, id) => {
  liveServers = liveServers.filter((s) => s['.id'] !== id);
  return {};
};
mt.setPppoeServerDisabled = async (_routerId, id, disabled) => {
  await mt.updatePppoeServer(_routerId, id, { disabled: disabled ? 'yes' : 'no' });
};

// ---- helpers --------------------------------------------------------------------

function makeCustomer(username, extra = {}) {
  const row = db.prepare(
    `INSERT INTO ppp_customers (router_id, name, username, password, profile, service, due_date, plan_id, billing_status, original_profile, billing_type)
     VALUES (?, ?, ?, 'pw', '10mbps', 'pppoe', ?, ?, ?, ?, ?)`
  ).run(
    ROUTER_ID,
    extra.name || username,
    username,
    extra.due_date || null,
    extra.plan_id || null,
    extra.billing_status || 'unbilled',
    extra.original_profile || null,
    extra.billing_type || 'postpaid',
  );
  putSecret(username, extra.routerProfile || '10mbps');
  activeSessions.push({ '.id': `sess-${username}`, name: username });
  return Number(row.lastInsertRowid);
}

function customer(username) {
  return db.prepare('SELECT * FROM ppp_customers WHERE username = ?').get(username);
}

// A plan is deliberately boring: a price, a cycle and the profile it hands out.
// Whether the subscriber paying it is postpaid or prepaid is decided on the
// account, so nothing here can express a billing model.
function makePlan(name, price, cycleDays, profile) {
  const row = db.prepare(
    'INSERT INTO billing_plans (router_id, name, price, cycle_days, pppoe_profile) VALUES (?, ?, ?, ?, ?)'
  ).run(ROUTER_ID, name, price, cycleDays, profile);
  return Number(row.lastInsertRowid);
}

const ADMIN_TOKEN = jwt.sign({ userId: 1, username: 'municipal', role: 'admin' }, process.env.JWT_SECRET);
let server, base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ppp', require('../src/api/ppp').default);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  billing.stopPppBillingSweep();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function call(path, { method = 'GET', body } = {}) {
  return fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---- due-date math --------------------------------------------------------------

test('a monthly cycle lands on the fixed cut-off day', () => {
  const settings = { enabled: 1, cutoff_day: 15 };
  // Paid up through 2026-11-15: paying again on 2026-11-20 buys the next cycle only.
  const { due } = billing.computeDueDate({
    anchorDate: '2026-11-15',
    settings,
    cycleDays: 30,
    today: new Date(2026, 10, 20),
  });
  assert.equal(iso(due), '2026-12-15');
});

test('paying during the grace period does not shift the cycle forward', () => {
  const settings = { enabled: 1, cutoff_day: 1 };
  const { due } = billing.computeDueDate({
    anchorDate: '2026-11-01',
    settings,
    cycleDays: 30,
    today: new Date(2026, 10, 28),
  });
  assert.equal(iso(due), '2026-12-01');
});

test('paying two cycles up front stacks them', () => {
  const settings = { enabled: 1, cutoff_day: 10 };
  const { due } = billing.computeDueDate({
    anchorDate: '2026-11-10',
    settings,
    cycleDays: 30,
    cycles: 3,
    today: new Date(2026, 10, 1),
  });
  assert.equal(iso(due), '2027-02-10');
});

test('a brand new subscription runs to the next cut-off day', () => {
  const settings = { enabled: 1, cutoff_day: 1 };
  const { due } = billing.computeDueDate({
    anchorDate: null,
    settings,
    cycleDays: 30,
    today: new Date(2026, 10, 22),
  });
  assert.equal(iso(due), '2026-12-01');

  // Paying ON the cut-off day must not expire the same day.
  const onCutOff = billing.computeDueDate({ anchorDate: null, settings, cycleDays: 30, today: new Date(2026, 10, 1) });
  assert.equal(iso(onCutOff.due), '2026-12-01');
});

test('an expired customer pays forward from today, never a date in the past', () => {
  const settings = { enabled: 1, cutoff_day: 5 };
  const { due } = billing.computeDueDate({
    anchorDate: '2026-02-05',
    settings,
    cycleDays: 30,
    today: new Date(2026, 10, 20),
  });
  assert.equal(iso(due), '2026-12-05');
});

test('weekly cycles roll by day count even with a cut-off day configured', () => {
  const settings = { enabled: 1, cutoff_day: 1 };
  // Still paid up to the 25th: the week is measured from there, not from today.
  const early = billing.computeDueDate({
    anchorDate: '2026-11-25',
    settings,
    cycleDays: 7,
    today: new Date(2026, 10, 20),
  });
  assert.equal(iso(early.due), '2026-12-02');

  // Already expired on the 10th: service restarts at the payment date.
  const late = billing.computeDueDate({
    anchorDate: '2026-11-10',
    settings,
    cycleDays: 7,
    today: new Date(2026, 10, 20),
  });
  assert.equal(iso(late.due), '2026-11-27');

  // With billing switched off, even a monthly plan is a plain 30-day roll from
  // the day the money came in.
  const off = billing.computeDueDate({
    anchorDate: '2026-11-10',
    settings: { enabled: 0, cutoff_day: 1 },
    cycleDays: 30,
    today: new Date(2026, 10, 20),
  });
  assert.equal(iso(off.due), '2026-12-20');
});

test('a cut-off day the month does not have clamps to its last day', () => {
  assert.equal(iso(billing.cutoffDateIn(new Date(2026, 1, 3), 28)), '2026-02-28');
  assert.equal(iso(billing.cutoffDateIn(new Date(2024, 1, 3), 31)), '2024-02-29');
  assert.equal(iso(billing.cutoffDateIn(new Date(2026, 1, 3), 31)), '2026-02-28');
  assert.equal(iso(billing.cutoffDateIn(new Date(2026, 8, 3), 31)), '2026-09-30');
  assert.equal(iso(billing.nextCutoffAfter(new Date(2026, 7, 30), 31)), '2026-08-31');
  assert.equal(iso(billing.nextCutoffAfter(new Date(2026, 7, 31), 31)), '2026-09-30');
});

test('grace and expiry time decide when the cut-off actually fires', () => {
  const settings = { grace_days: 3, expiry_time: '22:30' };
  const expiry = billing.expiryMoment('2026-11-15', settings);
  assert.equal(expiry.getTime(), new Date(2026, 10, 18, 22, 30, 0, 0).getTime());
  assert.equal(billing.expiryMoment('garbage', settings), null);
});

// ---- settings -------------------------------------------------------------------

test('billing settings default to off and persist an upsert', () => {
  const fresh = billing.getBillingSettings(ROUTER_ID);
  assert.equal(fresh.enabled, 0);
  assert.equal(fresh.non_payment_profile, 'non-payment');

  const saved = billing.saveBillingSettings(ROUTER_ID, {
    enabled: 1, cutoff_day: 15, grace_days: 5, expiry_time: '9:5', non_payment_profile: 'non-payment',
  });
  assert.equal(saved.enabled, 1);
  assert.equal(saved.cutoff_day, 15);
  assert.equal(saved.grace_days, 5);
  assert.equal(saved.expiry_time, '09:05');

  // A partial save must not silently switch billing back off.
  const patched = billing.saveBillingSettings(ROUTER_ID, { grace_days: 0 });
  assert.equal(patched.enabled, 1);
  assert.equal(patched.cutoff_day, 15);
  assert.equal(patched.grace_days, 0);
});

test('the cut-off day is clamped to a day every month has', () => {
  const saved = billing.saveBillingSettings(ROUTER_ID, { cutoff_day: 31 });
  assert.equal(saved.cutoff_day, 28);
});

// ---- payment and plan assignment ------------------------------------------------

test('assigning a plan pushes the bound profile and starts the clock', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 0, non_payment_profile: 'non-payment' });
  const planId = makePlan('Fiber 10', 1500, 30, '10mbps');
  const id = makeCustomer('roam-1');

  const result = await billing.assignPlan(ROUTER_ID, id, planId, { today: new Date(2026, 10, 22) });

  assert.equal(result.dueDate, '2026-12-01');
  assert.equal(result.billingStatus, 'active');
  assert.equal(result.routerSynced, true);
  assert.equal(secrets.get('roam-1').profile, '10mbps');
  assert.equal(activeSessions.some((s) => s.name === 'roam-1'), false, 'the live session is dropped so the profile applies');

  const row = customer('roam-1');
  assert.equal(row.plan_id, planId);
  assert.equal(row.billing_status, 'active');
  assert.equal(row.due_date, '2026-12-01');
});

test('recording a payment extends from the paid-up date and logs the money', async () => {
  const planId = makePlan('Fiber 20', 2000, 30, '10mbps');
  const id = makeCustomer('pay-1', { due_date: '2026-12-01', plan_id: planId, billing_status: 'active' });

  const result = await billing.recordPayment(ROUTER_ID, id, {
    planId, amount: 2000, paymentMethod: 'gcash', reference: 'OR-77', today: new Date(2026, 10, 20),
  });

  assert.equal(result.dueBefore, '2026-12-01');
  assert.equal(result.dueDate, '2027-01-01', 'one more month from what was already paid for');
  assert.equal(result.amount, 2000);

  const payment = db.prepare('SELECT * FROM ppp_payments WHERE customer_id = ?').get(id);
  assert.equal(payment.plan_id, planId);
  assert.equal(payment.payment_method, 'gcash');
  assert.equal(payment.reference, 'OR-77');
  assert.equal(payment.due_before, '2026-12-01');
  assert.equal(payment.due_after, '2027-01-01');
  assert.equal(payment.recorded_by, '');
  assert.equal(customer('pay-1').last_paid_at ? 1 : 0, 1);
});

test('a cut-off customer is restored the moment they pay', async () => {
  const planId = makePlan('Fiber 30', 2500, 30, '10mbps');
  const id = makeCustomer('late-1', {
    due_date: '2026-10-01', plan_id: planId, billing_status: 'cut-off', original_profile: '10mbps', routerProfile: 'non-payment',
  });

  const result = await billing.recordPayment(ROUTER_ID, id, {
    planId, cycles: 2, today: new Date(2026, 10, 22),
  });

  assert.equal(result.billingStatus, 'active');
  assert.equal(result.dueDate, '2027-01-01');
  assert.equal(secrets.get('late-1').profile, '10mbps');

  const row = customer('late-1');
  assert.equal(row.billing_status, 'active');
  assert.equal(row.original_profile, null, 'the pre-cut-off profile is only remembered while cut off');
});

test('the plan and due date are stamped on the router secret comment', async () => {
  const planId = makePlan('Fiber 5', 700, 30, '10mbps');
  const id = makeCustomer('stamp-1');
  secrets.get('stamp-1').comment = 'Rizal st. house 12';

  await billing.recordPayment(ROUTER_ID, id, { planId, today: new Date(2026, 10, 22) });

  assert.equal(secrets.get('stamp-1').comment, 'Rizal st. house 12 [Fiber 5 due 2026-12-01]');

  // Re-paying replaces the stamp instead of appending another one.
  await billing.recordPayment(ROUTER_ID, id, { planId, today: new Date(2026, 10, 25) });
  assert.equal(secrets.get('stamp-1').comment, 'Rizal st. house 12 [Fiber 5 due 2027-01-01]');
});

test('assigning an unknown plan or customer fails loudly', async () => {
  const id = makeCustomer('bad-1');
  await assert.rejects(() => billing.assignPlan(ROUTER_ID, id, 9999), /not found/i);
  assert.equal(await billing.assignPlan(ROUTER_ID, 9999, 1), null);
  assert.equal(await billing.recordPayment(ROUTER_ID, 9999, { planId: 1 }), null);
});

test('paying without a plan and without a default is refused', async () => {
  const id = makeCustomer('noplan-1');
  await assert.rejects(() => billing.recordPayment(ROUTER_ID, id, {}), /no billing plan/i);
});

// ---- the cut-off sweep ----------------------------------------------------------

test('the sweep transfers overdue subscribers and leaves everyone else alone', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 3, expiry_time: '00:00', non_payment_profile: 'non-payment' });
  const planId = makePlan('Sweep Plan', 1000, 30, '10mbps');
  makeCustomer('due-past', { due_date: '2026-10-01', plan_id: planId, billing_status: 'active' });
  makeCustomer('due-grace', { due_date: '2026-11-20', plan_id: planId, billing_status: 'active' });
  makeCustomer('due-future', { due_date: '2027-05-01', plan_id: planId, billing_status: 'active' });
  makeCustomer('due-none');

  const report = await billing.runCutoffSweep(new Date(2026, 10, 22, 12, 0, 0));

  assert.ok(report.cutOff >= 1);
  assert.equal(secrets.get('due-past').profile, 'non-payment');
  assert.equal(activeSessions.some((s) => s.name === 'due-past'), false, 'the session is dropped so the cap takes effect');
  assert.equal(customer('due-past').billing_status, 'cut-off');
  assert.equal(customer('due-past').original_profile, '10mbps');

  // Due 2026-11-20 + 3 days grace = 2026-11-23, so on the 22nd nothing happens yet.
  assert.equal(secrets.get('due-grace').profile, '10mbps');
  assert.equal(customer('due-grace').billing_status, 'active');
  assert.equal(secrets.get('due-future').profile, '10mbps');
  assert.equal(secrets.get('due-none').profile, '10mbps');
  assert.equal(customer('due-none').billing_status, 'unbilled');

  // Three days later the grace period is over too.
  await billing.runCutoffSweep(new Date(2026, 10, 24, 0, 5, 0));
  assert.equal(customer('due-grace').billing_status, 'cut-off');

  // And a third pass has nothing left to do - the sweep is idempotent.
  const third = await billing.runCutoffSweep(new Date(2026, 10, 24, 0, 5, 0));
  assert.deepEqual(third.details, [], 'customers already cut off are skipped');
});

test('a router that cannot be reached stays active and is retried', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 0, non_payment_profile: 'non-payment' });
  const planId = makePlan('Retry Plan', 900, 30, '10mbps');
  makeCustomer('offline-1', { due_date: '2026-10-01', plan_id: planId, billing_status: 'active' });

  routerConnected = false;
  const report = await billing.runCutoffSweep(new Date(2026, 10, 22));
  assert.equal(report.pending, 1);
  assert.equal(customer('offline-1').billing_status, 'active', 'nothing is marked cut-off that the router never applied');

  routerConnected = true;
  const retry = await billing.runCutoffSweep(new Date(2026, 10, 22));
  assert.ok(retry.details.some((d) => d.username === 'offline-1' && d.ok));
  assert.equal(customer('offline-1').billing_status, 'cut-off');
  assert.equal(secrets.get('offline-1').profile, 'non-payment');
  void planId;
});

test('the sweep only runs for routers with billing switched on', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 0 });
  const planId = makePlan('Gated Plan', 800, 30, '10mbps');
  db.prepare("INSERT INTO routers (name, host, username, password, is_active) VALUES ('OTHER-ROUTER', '10.9.9.2', 'admin', 'x', 1)").run();
  const otherRouter = db.prepare("SELECT id FROM routers WHERE name = 'OTHER-ROUTER'").get().id;
  const otherPlan = db.prepare('INSERT INTO billing_plans (router_id, name, price, cycle_days, pppoe_profile) VALUES (?, ?, ?, ?, ?)')
    .run(otherRouter, 'Other', 100, 30, '10mbps');
  db.prepare("INSERT INTO ppp_customers (router_id, name, username, password, profile, service, due_date, plan_id, billing_status) VALUES (?, 'other-1', 'other-1', 'pw', '10mbps', 'pppoe', '2026-10-01', ?, 'active')")
    .run(otherRouter, Number(otherPlan.lastInsertRowid));
  putSecret('other-1', '10mbps');

  const report = await billing.runCutoffSweep(new Date(2026, 10, 22), ROUTER_ID);
  assert.equal(report.details.some((d) => d.username === 'other-1'), false, 'onlyRouterId must not sweep other routers');

  await billing.runCutoffSweep(new Date(2026, 10, 22));
  assert.equal(secrets.get('other-1').profile, '10mbps', 'a router with no billing_settings row is never cut off');
  void planId;
});

test('startPppBillingSweep installs a timer and stop clears it', () => {
  billing.startPppBillingSweep(60);
  billing.stopPppBillingSweep();
  billing.stopPppBillingSweep(); // idempotent
  assert.ok(true);
});

// ---- overview -------------------------------------------------------------------

test('the billing overview counts each state once', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 3, expiry_time: '00:00' });
  const planId = makePlan('Overview Plan', 1234, 30, '10mbps');
  makeCustomer('view-active', { due_date: '2099-01-01', plan_id: planId, billing_status: 'active' });
  makeCustomer('view-duesoon', { due_date: '2026-11-24', plan_id: planId, billing_status: 'active' });
  makeCustomer('view-cut', { due_date: '2026-09-01', plan_id: planId, billing_status: 'cut-off' });
  makeCustomer('view-unbilled');

  const overview = billing.getBillingOverview(ROUTER_ID, new Date(2026, 10, 22));
  assert.ok(overview.total >= 4);
  assert.ok(overview.active >= 1);
  assert.ok(overview.dueSoon >= 1);
  assert.ok(overview.cutOff >= 1);
  assert.ok(overview.unbilled >= 1);
  assert.equal(typeof overview.collectedThisMonth, 'number');
});

// ---- HTTP surface ---------------------------------------------------------------

test('POST customers/:id/pay through the API restores service and answers with the new due date', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 0, non_payment_profile: 'non-payment' });
  const planId = makePlan('API Plan', 1500, 30, '10mbps');
  const id = makeCustomer('api-1', { due_date: '2026-11-01', billing_status: 'cut-off', routerProfile: 'non-payment' });

  const res = await call(`/api/ppp/router/${ROUTER_ID}/customers/${id}/pay`, {
    method: 'POST', body: { planId, cycles: 1, amount: 1500, paymentMethod: 'cash' },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.billingStatus, 'active');
  assert.equal(res.body.username, 'api-1');
  assert.equal(secrets.get('api-1').profile, '10mbps');
  assert.ok(res.body.dueDate > '2026-11-01');
});

test('the customers list carries the joined plan name', async () => {
  const res = await call(`/api/ppp/router/${ROUTER_ID}/customers`);
  assert.equal(res.status, 200);
  const joined = res.body.find((c) => c.username === 'api-1');
  assert.equal(joined.plan_name, 'API Plan');
  assert.equal(joined.plan_price, 1500);
});

test('plan CRUD over HTTP, and a plan with customers is hidden instead of deleted', async () => {
  const created = await call(`/api/ppp/router/${ROUTER_ID}/billing/plans`, {
    method: 'POST', body: { name: 'HTTP Plan', price: 999, cycleDays: 30, pppoeProfile: '10mbps', description: 'test' },
  });
  assert.equal(created.status, 201);

  const list = await call(`/api/ppp/router/${ROUTER_ID}/billing/plans`);
  const plan = list.body.find((p) => p.name === 'HTTP Plan');
  assert.equal(plan.cycle_days, 30);
  assert.equal(plan.currency, 'PHP');

  const missingProfile = await call(`/api/ppp/router/${ROUTER_ID}/billing/plans`, { method: 'POST', body: { name: 'No Profile' } });
  assert.equal(missingProfile.status, 400);

  const updated = await call(`/api/ppp/router/${ROUTER_ID}/billing/plans/${plan.id}`, { method: 'PUT', body: { price: 1200 } });
  assert.equal(updated.status, 200);

  const inUse = await call(`/api/ppp/router/${ROUTER_ID}/billing/plans/${plan.id}`, { method: 'DELETE' });
  assert.equal(inUse.status, 200);
  assert.equal(inUse.body.deactivated, undefined);
  assert.equal(db.prepare('SELECT id FROM billing_plans WHERE id = ?').get(plan.id), undefined, 'an unused plan is really deleted');

  // A plan that customers are on must only be hidden, so their history stays readable.
  await call(`/api/ppp/router/${ROUTER_ID}/billing/plans`, {
    method: 'POST', body: { name: 'Used Plan', price: 500, cycleDays: 30, pppoeProfile: '10mbps' },
  });
  const used = (await call(`/api/ppp/router/${ROUTER_ID}/billing/plans`)).body.find((p) => p.name === 'Used Plan');
  makeCustomer('plan-user', { plan_id: used.id });

  const deactivate = await call(`/api/ppp/router/${ROUTER_ID}/billing/plans/${used.id}`, { method: 'DELETE' });
  assert.equal(deactivate.body.deactivated, true);
  assert.equal(deactivate.body.customers, 1);
  assert.equal(db.prepare('SELECT is_active FROM billing_plans WHERE id = ?').get(used.id).is_active, 0);
});

test('billing settings reject an empty profile and the sweep endpoint answers', async () => {
  const bad = await call(`/api/ppp/router/${ROUTER_ID}/billing/settings`, {
    method: 'PUT', body: { enabled: 1, nonPaymentProfile: '   ' },
  });
  assert.equal(bad.status, 400);

  const good = await call(`/api/ppp/router/${ROUTER_ID}/billing/settings`, {
    method: 'PUT', body: { enabled: 1, cutoffDay: 15, graceDays: 2, expiryTime: '01:00', nonPaymentProfile: 'non-payment' },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.cutoff_day, 15);
  assert.equal(good.body.expiry_time, '01:00');

  const sweep = await call(`/api/ppp/router/${ROUTER_ID}/billing/sweep`, { method: 'POST' });
  assert.equal(sweep.status, 200);
  assert.ok(Array.isArray(sweep.body.details));

  const overview = await call(`/api/ppp/router/${ROUTER_ID}/billing/overview`);
  assert.equal(typeof overview.body.total, 'number');
});

test('PPPoE servers are identified by interface + service name, exactly like RouterOS', async () => {
  liveServers = [];
  nextServerId = 2; // *1 is handed to the Winbox entry below
  liveServers.push(
    { '.id': '*1', interface: 'ether5', 'service-name': 'xpeeder', 'default-profile': 'default', authentication: 'pap,chap', 'one-session-per-host': 'true', 'max-sessions': 'unlimited', 'max-mtu': 'auto', 'max-mru': 'auto', 'keepalive-timeout': '10', disabled: 'false', comment: 'made in winbox' },
  );

  const discovered = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`);
  assert.equal(discovered.status, 200);
  const imported = discovered.body.find((s) => s.name === 'ether5:xpeeder');
  assert.ok(imported, 'the Winbox server is adopted under its interface + service name');
  assert.equal(imported.on_router, 1);
  assert.equal(imported.running, 1);
  assert.equal(imported.interface, 'ether5');
  assert.equal(imported.mikrotik_id, '*1');

  // The same row must survive a second sync without duplicating.
  const again = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`);
  assert.equal(again.body.filter((s) => s.name === 'ether5:xpeeder').length, 1);

  const invalid = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`, { method: 'POST', body: { serviceName: 'isp' } });
  assert.equal(invalid.status, 400);

  const created = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`, {
    method: 'POST',
    body: { interface: 'bridge1', serviceName: 'isp', defaultProfile: '10mbps', authentication: 'pap', oneSessionPerHost: 1, maxSessions: 50, maxMtu: 1480, maxMru: 1480, keepaliveTimeout: '20', disabled: 0 },
  });
  assert.equal(created.status, 201);
  assert.equal(liveServers.length, 2);
  const onRouter = liveServers[1];
  assert.equal(onRouter['service-name'], 'isp');
  assert.equal(onRouter.name, undefined, 'RouterOS is never told a server name');
  assert.equal(onRouter.disabled, 'false', 'disabled: 0 means start it right away');
  assert.equal(created.body.server.name, 'bridge1:isp');
  assert.equal(created.body.server.mikrotik_id, onRouter['.id']);
  assert.equal(created.body.server.max_sessions, 50);

  const duplicate = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`, {
    method: 'POST', body: { interface: 'bridge1', serviceName: 'isp' },
  });
  assert.equal(duplicate.status, 409);

  const stored = db.prepare("SELECT * FROM pppoe_servers WHERE name = 'bridge1:isp'").get();
  assert.equal(stored.disabled, 0);

  const edited = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers/${stored.id}`, {
    method: 'PUT', body: { maxSessions: 10, disabled: 1 },
  });
  assert.equal(edited.status, 200);
  assert.equal(liveServers.find((s) => s['.id'] === onRouter['.id']).disabled, 'true', 'the router was told to disable it');
  const afterEdit = db.prepare('SELECT * FROM pppoe_servers WHERE id = ?').get(stored.id);
  assert.equal(afterEdit.max_sessions, 10);
  assert.equal(afterEdit.disabled, 1, 'the panel mirrors the switch the router took');

  const refreshed = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`);
  assert.equal(refreshed.body.find((s) => s.name === 'bridge1:isp').running, 0);

  // RouterOS marks a switched-on server invalid while the interface underneath
  // it cannot carry traffic, so the panel must not call that "Running", and it
  // should say whether the cause is just an unplugged cable.
  interfaceLinks.set('bridge1', false);
  Object.assign(liveServers.find((s) => s['.id'] === onRouter['.id']), { disabled: 'false', invalid: 'true' });
  const invalidLook = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`);
  const stranded = invalidLook.body.find((s) => s.name === 'bridge1:isp');
  assert.equal(stranded.invalid, 1);
  assert.equal(stranded.running, 0, 'an invalid server is not serving anybody');
  assert.equal(stranded.interface_down, 1, 'the panel knows the port has no link');

  interfaceLinks.set('bridge1', true);
  const stillBad = (await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`)).body.find((s) => s.name === 'bridge1:isp');
  assert.equal(stillBad.interface_down, 0, 'so the operator reaches for the cable, not the config');

  Object.assign(liveServers.find((s) => s['.id'] === onRouter['.id']), { disabled: 'false', invalid: 'false' });
  const healthy = (await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`)).body.find((s) => s.name === 'bridge1:isp');
  assert.equal(healthy.running, 1);
  assert.equal(healthy.invalid, 0);

  // Moving the server to another interface moves its identity, and the panel
  // follows the router instead of keeping a stale row behind.
  const moved = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers/${stored.id}`, {
    method: 'PUT', body: { interface: 'ether7' },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.server.name, 'ether7:isp');
  assert.equal(db.prepare("SELECT id FROM pppoe_servers WHERE name = 'bridge1:isp'").get(), undefined);
  assert.equal(liveServers.find((s) => s['.id'] === onRouter['.id']).interface, 'ether7');

  const blank = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers/${moved.body.server.id}`, { method: 'PUT', body: {} });
  assert.equal(blank.status, 400);

  const removed = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers/${moved.body.server.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(liveServers.some((s) => s['.id'] === onRouter['.id']), false);
  assert.equal(db.prepare("SELECT id FROM pppoe_servers WHERE name = 'ether7:isp'").get(), undefined);

  // A router that goes away mid-edit must not leave the panel claiming a change
  // that never happened.
  const winboxRow = db.prepare("SELECT * FROM pppoe_servers WHERE name = 'ether5:xpeeder'").get();
  routerConnected = false;
  const offline = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`, { method: 'POST', body: { interface: 'ether9' } });
  assert.equal(offline.status, 503);
  const offlineEdit = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers/${winboxRow.id}`, { method: 'PUT', body: { maxSessions: 4 } });
  assert.equal(offlineEdit.status, 503);
  routerConnected = true;

  const refused = mt.updatePppoeServer;
  mt.updatePppoeServer = async () => { throw new Error('400 Bad Request - unknown parameter name'); };
  const bad = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers/${winboxRow.id}`, { method: 'PUT', body: { maxSessions: 4 } });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /Router rejected the change/);
  assert.equal(db.prepare('SELECT max_sessions FROM pppoe_servers WHERE id = ?').get(winboxRow.id).max_sessions, winboxRow.max_sessions, 'the panel keeps the value the router still has');
  mt.updatePppoeServer = refused;

  // Something deleted in Winbox disappears from the sub-page on the next look.
  liveServers = liveServers.filter((s) => s['.id'] !== '*1');
  const afterWinboxDelete = await call(`/api/ppp/router/${ROUTER_ID}/pppoe-servers`);
  assert.deepEqual(afterWinboxDelete.body.map((s) => s.name), []);
});

test('a PPP customer can be created and edited over HTTP', async () => {
  const created = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST',
    body: { name: 'Juan Dela Cruz', username: 'juan-http', password: 'pw1234', profile: '10mbps', service: 'pppoe' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const row = db.prepare("SELECT * FROM ppp_customers WHERE username = 'juan-http'").get();
  assert.ok(row, 'the subscriber is stored with the source tag the API writes');
  assert.equal(row.source, 'api');
  // The router login is what PPPoE authenticates against, so it carries the
  // username; the display name only exists in the panel.
  assert.equal(secrets.get('juan-http').profile, '10mbps');
  assert.equal(secrets.get('Juan Dela Cruz'), undefined);

  const clash = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST',
    body: { name: 'Other Juan', username: 'juan-http', password: 'pw0000', profile: '10mbps' },
  });
  assert.equal(clash.status, 409);

  // Editing is a set on the same login, not a remove + re-add.
  const edited = await call(`/api/ppp/router/${ROUTER_ID}/customers/${row.id}`, {
    method: 'PUT', body: { password: 'pw9999', profile: 'non-payment' },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(secrets.get('juan-http').profile, 'non-payment');
  assert.equal(secrets.get('juan-http').password, 'pw9999');
  assert.equal(db.prepare('SELECT profile FROM ppp_customers WHERE id = ?').get(row.id).profile, 'non-payment');
  assert.equal(activeSessions.some((s) => s.name === 'juan-http'), false, 'the session is dropped so the new profile applies');

  const removed = await call(`/api/ppp/router/${ROUTER_ID}/customers/${row.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(db.prepare('SELECT id FROM ppp_customers WHERE id = ?').get(row.id), undefined);

  // If the panel row cannot be written, the login that was already pushed to the
  // router has to come back off, otherwise the subscriber keeps an account that
  // nobody can bill, edit or delete.
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('INSERT INTO ppp_customers')) throw new Error('database is locked');
    return realPrepare(sql);
  };
  const failed = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST',
    body: { name: 'Rollback Juan', username: 'juan-rollback', password: 'pw1234', profile: '10mbps' },
  });
  db.prepare = realPrepare;
  assert.equal(failed.status, 500);
  assert.equal(secrets.get('juan-rollback'), undefined, 'the orphan login was rolled back');
  assert.equal(db.prepare("SELECT id FROM ppp_customers WHERE username = 'juan-rollback'").get(), undefined);
});

test('profile picker comes from the router so plans can only bind to real profiles', async () => {
  const res = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.name), ['10mbps', 'non-payment', 'default']);
});

// ---- the router's own cut-off timer ----------------------------------------
// The panel sweep only runs while the panel is up, and a municipal box restarts
// for updates, so each account also gets a /system/scheduler job of its own -
// the same trick the reference Mikrotik-Billing-Manager uses, with the due
// minute the operator picked kept all the way through.

test('the due date keeps the minute the operator picked, not the global expiry time', () => {
  const settings = { enabled: 1, grace_days: 2, expiry_time: '00:00', non_payment_profile: 'non-payment' };
  const withClock = billing.expiryMoment('2026-12-01 23:59', settings);
  assert.equal(withClock.getHours(), 23);
  assert.equal(withClock.getMinutes(), 59);
  // Two days of grace, then 23:59 is still the cut-off instant.
  assert.equal(billing.formatDateTime(withClock), '2026-12-03 23:59:00');

  // A bare day has no clock of its own, so expiry_time still decides.
  const dayOnly = billing.expiryMoment('2026-12-01', settings);
  assert.equal(billing.formatDateTime(dayOnly), '2026-12-03 00:00:00');
});

test('a renewal lands on the same clock the account was billed with', () => {
  assert.equal(billing.formatDueKeepingClock('2026-11-30 23:59', new Date(2026, 11, 30)), '2026-12-30 23:59');
  assert.equal(billing.formatDueKeepingClock('2026-11-30', new Date(2026, 11, 30)), '2026-12-30');
});

test(`creating a subscriber with a plan and a due date arms that account's timer on the router`, async () => {
  billing.saveBillingSettings(ROUTER_ID, {
    enabled: 1, cutoff_day: 1, grace_days: 0, expiry_time: '00:00', non_payment_profile: 'non-payment',
  });
  const jobsBefore = schedulerJobs.size;
  const planId = makePlan('Fiber 10M monthly', 1200, 30, '10mbps');
  const future = new Date(Date.now() + 20 * 86400000);
  const dueDay = iso(future);

  const created = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST',
    body: {
      name: 'Armed Juan',
      username: 'armed-juan',
      password: 'pw1234',
      planId,
      installDate: `${dueDay} 08:30`,
      dueDate: `${dueDay} 23:59`,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  // The speed comes from the plan: the form never mentions a profile any more.
  assert.equal(secrets.get('armed-juan').profile, '10mbps');
  const row = db.prepare("SELECT * FROM ppp_customers WHERE username = 'armed-juan'").get();
  assert.equal(row.plan_id, planId);
  assert.equal(row.install_date, `${dueDay} 08:30`);
  assert.equal(row.due_date, `${dueDay} 23:59`);
  assert.equal(row.billing_status, 'active');
  assert.equal(row.scheduled_at, `${dueDay} 23:59:00`);

  const job = schedulerJobs.get('ppp-auto-kick-armed-juan');
  assert.ok(job, 'one scheduler job per account');
  assert.equal(job['start-date'], dueDay, 'RouterOS takes the ISO day the REST API accepts');
  assert.equal(job['start-time'], '23:59:00');
  assert.equal(job.interval, '0s', 'one-shot, so it does not fire again next month');
  assert.match(job['on-event'], /\/ppp secret set \[find where name="armed-juan"\] profile="non-payment"/);
  assert.match(job['on-event'], /\/ppp active remove \[find where name="armed-juan"\]/);

  // Moving the due date re-arms the same job instead of stacking a second one,
  // and deleting the account takes it off the router entirely.
  const later = new Date(Date.now() + 50 * 86400000);
  const moved = await call(`/api/ppp/router/${ROUTER_ID}/customers/${row.id}`, {
    method: 'PUT', body: { dueDate: `${iso(later)} 09:15` },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.scheduledAt, `${iso(later)} 09:15:00`);
  const rearmed = schedulerJobs.get('ppp-auto-kick-armed-juan');
  assert.equal(rearmed['.id'], job['.id'], 'the job is set, not recreated');
  assert.equal(rearmed['start-date'], iso(later));
  assert.equal(rearmed['start-time'], '09:15:00');
  assert.equal(schedulerJobs.size, jobsBefore + 1, 'moving the date re-arms it, it does not add a second timer');

  const removed = await call(`/api/ppp/router/${ROUTER_ID}/customers/${row.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(schedulerJobs.get('ppp-auto-kick-armed-juan'), undefined, 'no orphan timer left behind');
});

test(`a timer is never armed for a schedule that cannot fire or a router that is down`, async () => {
  billing.saveBillingSettings(ROUTER_ID, {
    enabled: 1, cutoff_day: 1, grace_days: 0, expiry_time: '00:00', non_payment_profile: 'non-payment',
  });

  // Already overdue: the sweep handles it, and a job with a past start-time
  // would fire the instant RouterOS accepted it.
  const past = await billing.scheduleAccountCutoff(ROUTER_ID, 'yesterday', `${iso(new Date(Date.now() - 86400000))} 10:00`, billing.getBillingSettings(ROUTER_ID));
  assert.equal(past.scheduledAt, null);
  assert.equal(past.skipped, 'already past');

  const unbilled = await billing.scheduleAccountCutoff(ROUTER_ID, 'no-due', null, billing.getBillingSettings(ROUTER_ID));
  assert.equal(unbilled.skipped, 'no due date');

  const disabled = await billing.scheduleAccountCutoff(ROUTER_ID, 'off', '2099-01-01 08:00', { ...billing.getBillingSettings(ROUTER_ID), enabled: 0 });
  assert.equal(disabled.skipped, 'billing disabled');

  // The router refuses the job: the account is still created, but the panel says
  // out loud that the on-router timer is missing.
  const refused = mt.setSchedulerJob;
  mt.setSchedulerJob = async () => { throw new Error('400 Bad Request - failure parsing start-date'); };
  const result = await billing.scheduleAccountCutoff(ROUTER_ID, 'refused-juan', '2099-01-01 08:00', billing.getBillingSettings(ROUTER_ID));
  mt.setSchedulerJob = refused;
  assert.equal(result.ok, false);
  assert.match(result.error, /failure parsing start-date/);
  assert.equal(schedulerJobs.get('ppp-auto-kick-refused-juan'), undefined);
});

// ---- PPPoE profiles sub-page ------------------------------------------------

test('profiles are read live from the router with who is using each one', async () => {
  putSecret('someone-on-10mbps', '10mbps');
  const res = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles`);
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.body.map((p) => [p.name, p]));

  assert.equal(byName['10mbps'].rate_limit, '10M/10M');
  assert.equal(byName['10mbps'].rx_limit, '10M');
  assert.equal(byName['10mbps'].tx_limit, '10M');
  assert.equal(byName['10mbps'].built_in, false);
  assert.ok(byName['10mbps'].secrets >= 1);
  assert.equal(byName['default'].built_in, true, 'RouterOS ships default and it must be marked');
  assert.equal(byName['non-payment'].remote_address, 'NON-PAYMENT', 'the remote pool is a name, not a range');
});

test('a profile can be added from the panel and keeps every property it was not given', async () => {
  const created = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles`, {
    method: 'POST',
    body: { name: '20M', rateLimit: '20M', localAddress: '10.20.0.1', remoteAddress: 'PPPOE' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const entry = liveProfiles.find((p) => p.name === '20M');
  assert.ok(entry, 'the profile is on the router');
  assert.equal(entry['rate-limit'], '20M/20M', 'one value means both directions');
  assert.equal(entry['local-address'], '10.20.0.1');
  assert.equal(entry['remote-address'], 'PPPOE');

  // A speed edit is a set: the addresses the operator did not touch stay put. A
  // PUT would replace the whole record and blank them.
  const edited = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/20M`, {
    method: 'PUT', body: { rateLimit: '30M/15M' },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(entry['rate-limit'], '30M/15M');
  assert.equal(entry['local-address'], '10.20.0.1');
  assert.equal(entry['remote-address'], 'PPPOE');

  const clash = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles`, {
    method: 'POST', body: { name: '20M', rateLimit: '5M' },
  });
  assert.equal(clash.status, 409);

  const renamed = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/20M`, {
    method: 'PUT', body: { name: '30M' },
  });
  assert.equal(renamed.status, 400);
  assert.match(renamed.body.error, /cannot be renamed/);

  const junkName = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles`, {
    method: 'POST', body: { name: 'bad"name;reboot' },
  });
  assert.equal(junkName.status, 400, 'a name lands inside RouterOS scripts, so it is validated on the way in');

  // The panel form always submits its text boxes, so a blank address arrives as
  // ''. RouterOS would answer "ambiguous value of pool" to that, which is why
  // the API drops it instead of forwarding it.
  const blankAddress = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles`, {
    method: 'POST',
    body: { name: '512k', rateLimit: '512k', localAddress: '', remoteAddress: '', onlyOne: 'default', changeTcpMss: 'default', useIpv6: 'default', useEncryption: 'default' },
  });
  assert.equal(blankAddress.status, 201, JSON.stringify(blankAddress.body));
  const made = liveProfiles.find((p) => p.name === '512k');
  assert.equal(made['rate-limit'], '512k/512k');
  assert.equal(made['local-address'], '', 'nothing was pushed, so RouterOS keeps its own default');

  // An edit that leaves the address box empty must not wipe a working pool.
  const keptBlank = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/non-payment`, {
    method: 'PUT', body: { rateLimit: '1M/1M', localAddress: '', remoteAddress: '' },
  });
  assert.equal(keptBlank.status, 200, JSON.stringify(keptBlank.body));
  const slow = liveProfiles.find((p) => p.name === 'non-payment');
  assert.equal(slow['local-address'], '172.16.44.1');
  assert.equal(slow['remote-address'], 'NON-PAYMENT');

  const clearedSpeed = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/512k`, {
    method: 'PUT', body: { rateLimit: '' },
  });
  assert.equal(clearedSpeed.status, 200, JSON.stringify(clearedSpeed.body));
  assert.equal(made['rate-limit'], '', 'an existing profile can have its cap removed');
});

test('a profile that is handed out or shipped by RouterOS cannot be deleted', async () => {
  const builtIn = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/default`, { method: 'DELETE' });
  assert.equal(builtIn.status, 400);
  assert.match(builtIn.body.error, /built-in/);

  // non-payment has a router login on it and is the billing cut-off profile.
  const inUse = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/non-payment`, { method: 'DELETE' });
  assert.equal(inUse.status, 409, JSON.stringify(inUse.body));
  assert.ok(liveProfiles.some((p) => p.name === 'non-payment'), 'the operator\'s own profile survives');

  const free = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/20M`, { method: 'DELETE' });
  assert.equal(free.status, 200, JSON.stringify(free.body));
  assert.equal(liveProfiles.some((p) => p.name === '20M'), false);

  // Something deleted in Winbox is simply gone from the panel's next look.
  const gone = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/no-longer-here`, { method: 'DELETE' });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.gone, true);
});

test(`changing a profile's speed reconnects the subscribers still on the old cap`, async () => {
  putSecret('live-on-10mbps', '10mbps');
  activeSessions.push({ '.id': 'sess-live-on-10mbps', name: 'live-on-10mbps' });
  const res = await call(`/api/ppp/router/${ROUTER_ID}/ppp-profiles/10mbps`, {
    method: 'PUT', body: { rateLimit: '15M/15M' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.reconnected >= 1);
  assert.equal(activeSessions.some((s) => s.name === 'live-on-10mbps'), false, 'RouterOS only reads the limit when the session connects');
});

test('the billing routes are behind authentication', async () => {
  const res = await fetch(`${base}/api/ppp/router/${ROUTER_ID}/billing/plans`).then((r) => ({ status: r.status }));
  assert.equal(res.status, 401);
});

// ---- prepaid and postpaid billing models ----------------------------------------
// Postpaid is the neighbourhood billing day: everyone owes on the same cut-off
// day and a few grace days are forgiven. Prepaid bought the period itself, so the
// anniversary follows the day the money arrived and nothing is forgiven. The model
// is sold with the account and not with the plan, so two neighbours on one price
// can be billed differently. The operator asked for it with a worked example -
// activated Nov 23, due Dec 23, paid Dec 25, next due Jan 25 - so that sentence is
// written down as a test.

test('an account is postpaid unless prepaid is asked for, and a typo is refused', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 3, expiry_time: '00:00', non_payment_profile: 'non-payment' });
  const planId = makePlan('Type Test Plan', 500, 30, '10mbps');

  const legacy = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST', body: { name: 'Plain Juan', username: 'type-default', password: 'pw', planId },
  });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.equal(legacy.body.billingType, 'postpaid', 'an account nobody described keeps today\'s rules');

  const prepaid = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST', body: { name: 'Prepaid Juan', username: 'type-prepaid', password: 'pw', planId, billingType: 'prepaid' },
  });
  assert.equal(prepaid.status, 201, JSON.stringify(prepaid.body));
  assert.equal(prepaid.body.billingType, 'prepaid');

  // Filed under postpaid, a misspelling would hand a prepaid subscriber grace days
  // nobody sold them, so it is rejected instead of guessed.
  const typo = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST', body: { name: 'Typo Juan', username: 'type-typo', password: 'pw', planId, billingType: 'pre-pay' },
  });
  assert.equal(typo.status, 400);
  assert.match(typo.body.error, /postpaid or prepaid/);

  // Editing the display name only must not silently re-bill the account as postpaid.
  const row = customer('type-prepaid');
  const rename = await call(`/api/ppp/router/${ROUTER_ID}/customers/${row.id}`, { method: 'PUT', body: { name: 'Prepaid Juanito' } });
  assert.equal(rename.status, 200, JSON.stringify(rename.body));
  assert.equal(customer('type-prepaid').billing_type, 'prepaid');
  assert.equal(customer('type-default').billing_type, 'postpaid');
});

test('a billing plan stays a price and a cycle, never a billing model', async () => {
  // The model briefly lived here. Sending one with a plan has to be ignored
  // rather than quietly deciding how the subscriber gets billed.
  const created = await call(`/api/ppp/router/${ROUTER_ID}/billing/plans`, {
    method: 'POST', body: { name: 'Plain Price Plan', price: 750, cycleDays: 30, pppoeProfile: '10mbps', planType: 'prepaid' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const plan = (await call(`/api/ppp/router/${ROUTER_ID}/billing/plans`)).body.find((p) => p.name === 'Plain Price Plan');
  assert.equal(plan.price, 750);
  assert.equal(plan.cycle_days, 30);
  assert.equal(plan.pppoe_profile, '10mbps');
  assert.ok(!('plan_type' in plan), 'the plans list no longer has a billing model to hand out');

  const planCols = db.prepare("PRAGMA table_info('billing_plans')").all().map((c) => c.name);
  assert.ok(!planCols.includes('plan_type'), `billing_plans still carries plan_type: ${planCols.join(', ')}`);
  const customerCols = db.prepare("PRAGMA table_info('ppp_customers')").all().map((c) => c.name);
  assert.ok(customerCols.includes('billing_type'), 'the account table is where the model lives');
});

test('a prepaid monthly cycle counts real months from the day the money arrives', () => {
  const settings = { enabled: 1, cutoff_day: 1, grace_days: 3 };

  // The example, exactly as given: due Dec 23, paid Dec 25, next due Jan 25.
  const late = billing.computeDueDate({ anchorDate: '2026-12-23', settings, cycleDays: 30, billingType: 'prepaid', today: new Date(2026, 11, 25) });
  assert.equal(iso(late.due), '2027-01-25');

  // Activated Nov 23, runs to Dec 23 - the activation day is the anniversary.
  const activated = billing.computeDueDate({ anchorDate: null, settings, cycleDays: 30, billingType: 'prepaid', today: new Date(2026, 10, 23) });
  assert.equal(iso(activated.due), '2026-12-23');

  // Paying early keeps the days already bought instead of burning them.
  const early = billing.computeDueDate({ anchorDate: '2026-12-30', settings, cycleDays: 30, billingType: 'prepaid', today: new Date(2026, 11, 10) });
  assert.equal(iso(early.due), '2027-01-30');

  // A month is a month, so a 31st has to land on a day that exists.
  const clamped = billing.computeDueDate({ anchorDate: '2027-01-31', settings, cycleDays: 30, billingType: 'prepaid', today: new Date(2027, 0, 31) });
  assert.equal(iso(clamped.due), '2027-02-28');

  // 90 days is sold as "3 months", so a prepaid quarter steps 3 months, not 90 days.
  const quarter = billing.computeDueDate({ anchorDate: '2026-12-25', settings, cycleDays: 90, billingType: 'prepaid', today: new Date(2026, 11, 25) });
  assert.equal(iso(quarter.due), '2027-03-25');

  // A prepaid account never snaps to the global cut-off day, a postpaid one still does.
  assert.equal(billing.planUsesFixedCutoff(settings, 30, 'prepaid'), false);
  assert.equal(billing.planUsesFixedCutoff(settings, 30, 'postpaid'), true);
  const postpaid = billing.computeDueDate({ anchorDate: '2026-12-23', settings, cycleDays: 30, billingType: 'postpaid', today: new Date(2026, 11, 25) });
  assert.equal(iso(postpaid.due), '2027-01-01', 'the same payment on a postpaid account still lands on the 1st');

  // Short cycles stay day-counted for both models.
  const weekly = billing.computeDueDate({ anchorDate: null, settings, cycleDays: 7, billingType: 'prepaid', today: new Date(2026, 10, 23) });
  assert.equal(iso(weekly.due), '2026-11-30');
});

test('grace belongs to postpaid accounts only, and an unbilled row keeps the router setting', () => {
  const settings = { enabled: 1, cutoff_day: 1, grace_days: 3, expiry_time: '00:00', non_payment_profile: 'non-payment' };
  assert.equal(billing.graceDaysFor('prepaid', settings), 0);
  assert.equal(billing.graceDaysFor('postpaid', settings), 3);
  assert.equal(billing.graceDaysFor(null, settings), 3, 'an unbilled/plan-less row is not punished');

  const due = '2027-01-25 23:59';
  const post = billing.expiryMoment(due, settings, billing.graceDaysFor('postpaid', settings));
  const pre = billing.expiryMoment(due, settings, billing.graceDaysFor('prepaid', settings));
  assert.equal(iso(post), '2027-01-28');
  assert.equal(iso(pre), '2027-01-25', 'a prepaid line expires on the due instant itself');
  assert.equal(pre.getHours(), 23, 'and still keeps the minute the operator picked');
});

test(`each account's own router timer is armed with its own grace`, async () => {
  const settings = billing.getBillingSettings(ROUTER_ID);
  // A fixed "now" keeps this readable: the same due date, two billing models.
  const now = new Date(2026, 10, 23);

  const pre = await billing.scheduleAccountCutoff(ROUTER_ID, 'prepaid-timer', '2027-01-25 23:59', { ...settings, grace_days: 3, billing_type: 'prepaid' }, now);
  assert.equal(pre.scheduledAt, '2027-01-25 23:59:00');
  const post = await billing.scheduleAccountCutoff(ROUTER_ID, 'postpaid-timer', '2027-01-25 23:59', { ...settings, grace_days: 3, billing_type: 'postpaid' }, now);
  assert.equal(post.scheduledAt, '2027-01-28 23:59:00');

  assert.equal(schedulerJobs.get('ppp-auto-kick-prepaid-timer')['start-date'], '2027-01-25');
  assert.equal(schedulerJobs.get('ppp-auto-kick-postpaid-timer')['start-date'], '2027-01-28');

  await billing.removeAccountCutoff(ROUTER_ID, 'prepaid-timer');
  await billing.removeAccountCutoff(ROUTER_ID, 'postpaid-timer');
});

test('a prepaid subscriber created without a due date is billed one real month', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 3, expiry_time: '00:00', non_payment_profile: 'non-payment' });
  const planId = makePlan('Prepaid Auto Due', 1200, 30, '10mbps');

  const created = await call(`/api/ppp/router/${ROUTER_ID}/customers`, {
    method: 'POST',
    body: { name: 'Auto Juan', username: 'auto-prepaid', password: 'pw', planId, billingType: 'prepaid' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const row = customer('auto-prepaid');
  assert.equal(row.due_date, iso(billing.addMonths(startOfToday, 1)), 'today the 23rd means the 23rd, not the cut-off day');
  assert.equal(row.profile, '10mbps');
});

test('paying a prepaid line on Dec 25 makes Jan 25 the new due date', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 3, expiry_time: '00:00', non_payment_profile: 'non-payment' });
  // One plan, two accounts, two models: what they pay is not how they are billed.
  const planId = makePlan('Dec25 Plan', 1200, 30, '10mbps');
  const customerId = makeCustomer('late-prepaid', {
    due_date: '2026-12-23', plan_id: planId, billing_status: 'cut-off', original_profile: '10mbps', billing_type: 'prepaid',
  });

  const paid = await billing.recordPayment(ROUTER_ID, customerId, { planId, today: new Date(2026, 11, 25) });
  assert.equal(paid.dueDate, '2027-01-25');
  assert.equal(paid.billingStatus, 'active');
  assert.equal(customer('late-prepaid').due_date, '2027-01-25');

  // The same money on the same day on the same plan, billed postpaid, buys the shared cut-off day.
  const postCustomer = makeCustomer('late-postpaid', {
    due_date: '2026-12-23', plan_id: planId, billing_status: 'cut-off', original_profile: '10mbps', billing_type: 'postpaid',
  });
  const postPaid = await billing.recordPayment(ROUTER_ID, postCustomer, { planId, today: new Date(2026, 11, 25) });
  assert.equal(postPaid.dueDate, '2027-01-01');
});

test('the customers list carries the billing type so the table can show it', async () => {
  const planId = makePlan('Typed In List', 900, 30, '10mbps');
  makeCustomer('typed-juan', { plan_id: planId, due_date: '2027-01-25', billing_status: 'active', billing_type: 'prepaid' });

  const list = await call(`/api/ppp/router/${ROUTER_ID}/customers`);
  assert.equal(list.status, 200);
  assert.equal(list.body.find((c) => c.username === 'typed-juan').billing_type, 'prepaid');
  assert.equal(list.body.find((c) => c.username === 'typed-juan').plan_name, 'Typed In List');
});

test('the sweep cuts a prepaid line on its due date but forgives a postpaid one', async () => {
  billing.saveBillingSettings(ROUTER_ID, { enabled: 1, cutoff_day: 1, grace_days: 3, expiry_time: '00:00', non_payment_profile: 'non-payment' });
  // Both accounts sit on one plan with one due date: only the model differs.
  const planId = makePlan('Sweep Plan Two Models', 700, 30, '10mbps');
  makeCustomer('due-prepaid', { due_date: '2026-11-20 23:59', plan_id: planId, billing_status: 'active', billing_type: 'prepaid' });
  makeCustomer('due-postpaid', { due_date: '2026-11-20 23:59', plan_id: planId, billing_status: 'active', billing_type: 'postpaid' });

  // Two days after that due date: still a grace day for one, already late for the other.
  const report = await billing.runCutoffSweep(new Date(2026, 10, 22, 12, 0), ROUTER_ID);
  assert.equal(customer('due-prepaid').billing_status, 'cut-off', 'prepaid has no grace to sit in');
  assert.equal(secrets.get('due-prepaid').profile, 'non-payment');
  assert.equal(customer('due-postpaid').billing_status, 'active');
  assert.equal(secrets.get('due-postpaid').profile, '10mbps');

  // The sweep report is what the panel logs, so the same two days must show up in
  // it as one cut and one left alone.
  assert.ok(report.details.some((d) => d.username === 'due-prepaid' && d.ok), JSON.stringify(report.details));
  assert.ok(!report.details.some((d) => d.username === 'due-postpaid'), 'a postpaid line inside its grace is not touched');
});

