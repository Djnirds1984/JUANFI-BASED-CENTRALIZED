import { getDb } from '../database';
import { mikroTikService } from './mikrotik';

/**
 * PPPoE subscription billing.
 *
 * A customer is bound to a billing plan; a plan is bound to a RouterOS PPP
 * profile. Payment extends `due_date`; when the due date (plus the grace
 * period) passes, the customer is moved to the non-payment profile - that is
 * the whole cut-off model. RouterOS only reads a secret's profile when the
 * session is created, so every profile change is followed by a disconnect so
 * the new speed cap actually applies instead of waiting for a reconnect.
 */

export interface BillingSettings {
  router_id: number;
  enabled: number;
  cutoff_day: number;
  grace_days: number;
  expiry_time: string;
  non_payment_profile: string;
  default_plan_id: number | null;
}

export interface BillingPlan {
  id: number;
  router_id: number;
  name: string;
  price: number;
  cycle_days: number;
  currency: string;
  pppoe_profile: string;
  description: string | null;
  is_active: number;
}

export const DEFAULT_BILLING_SETTINGS: Omit<BillingSettings, 'router_id'> = {
  enabled: 0,
  cutoff_day: 1,
  grace_days: 3,
  expiry_time: '00:00',
  non_payment_profile: 'non-payment',
  default_plan_id: null,
};

// Cycles shorter than this roll forward by day count; a monthly (or longer)
// plan locks onto the fixed cut-off day instead, which is what makes a
// neighbourhood bill everyone on the same day.
const MONTHLY_CYCLE_MIN_DAYS = 28;

// ---------------------------------------------------------------- dates

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Last day that actually exists in `month` (0-based) - Feb 30 becomes Feb 28/29. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Local-midnight date from a `YYYY-MM-DD` string. Invalid input returns null. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!match) return null;
  const date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/** The cut-off date inside the month `date` belongs to. */
export function cutoffDateIn(date: Date, cutoffDay: number): Date {
  const day = Math.min(Math.max(1, Math.round(cutoffDay) || 1), daysInMonth(date.getFullYear(), date.getMonth()));
  return new Date(date.getFullYear(), date.getMonth(), day);
}

/** First cut-off date strictly after `date`. */
export function nextCutoffAfter(date: Date, cutoffDay: number): Date {
  const inMonth = cutoffDateIn(date, cutoffDay);
  if (inMonth > date) return inMonth;
  return cutoffDateIn(new Date(date.getFullYear(), date.getMonth() + 1, 1), cutoffDay);
}

export function planUsesFixedCutoff(settings: Pick<BillingSettings, 'enabled'>, cycleDays: number): boolean {
  return Number(settings.enabled) === 1 && cycleDays >= MONTHLY_CYCLE_MIN_DAYS;
}

/**
 * Work out the next due date.
 *
 * The anchor is the customer's current due date, never today, so a customer who
 * pays early (or pays while sitting in the grace period) keeps the time they
 * already paid for instead of losing the days in between. Only once the anchor
 * is in the past do we start counting from today.
 */
export function computeDueDate(opts: {
  anchorDate: string | null | undefined;
  settings: Pick<BillingSettings, 'enabled' | 'cutoff_day'>;
  cycleDays: number;
  cycles?: number;
  today?: Date;
}): { due: Date; anchor: Date } {
  const today = startOfDay(opts.today || new Date());
  const anchorRaw = parseDateOnly(opts.anchorDate);
  const anchor = anchorRaw && anchorRaw > today ? anchorRaw : today;
  const cycles = Math.max(1, Math.round(opts.cycles || 1));
  const cycleDays = Math.max(1, Math.round(opts.cycleDays) || 30);

  if (!planUsesFixedCutoff(opts.settings, cycleDays)) {
    return { due: addDays(anchor, cycleDays * cycles), anchor };
  }

  // `anchor` is either a future cut-off date (still paid up) or today. Stepping
  // one cut-off at a time keeps everyone on the same day of the month, and an
  // early payment simply buys the next cycle(s) instead of wasting days.
  let due = anchor;
  for (let i = 0; i < cycles; i++) {
    due = nextCutoffAfter(due, opts.settings.cutoff_day);
  }
  return { due, anchor };
}

/** When a paid period really ends: due date + grace days, at the configured hour. */
export function expiryMoment(
  dueDate: string,
  settings: Pick<BillingSettings, 'grace_days' | 'expiry_time'>
): Date | null {
  const due = parseDateOnly(dueDate);
  if (!due) return null;
  const moment = addDays(due, Math.max(0, Math.round(settings.grace_days) || 0));
  const [hour, minute] = String(settings.expiry_time || '00:00').split(':').map((v) => parseInt(v, 10));
  moment.setHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0);
  return moment;
}

// ---------------------------------------------------------------- settings / plans

export function getBillingSettings(routerId: number): BillingSettings {
  const db = getDb();
  const row = db.prepare('SELECT * FROM billing_settings WHERE router_id = ?').get(routerId) as any;
  if (row) return { ...DEFAULT_BILLING_SETTINGS, ...row };
  return { router_id: routerId, ...DEFAULT_BILLING_SETTINGS };
}

export function saveBillingSettings(
  routerId: number,
  patch: Partial<Omit<BillingSettings, 'router_id'>>
): BillingSettings {
  const db = getDb();
  const current = getBillingSettings(routerId);
  const next: BillingSettings = {
    router_id: routerId,
    enabled: patch.enabled === undefined ? current.enabled : (Number(patch.enabled) ? 1 : 0),
    cutoff_day: patch.cutoff_day === undefined ? current.cutoff_day : Math.min(28, Math.max(1, Math.round(Number(patch.cutoff_day)) || 1)),
    grace_days: patch.grace_days === undefined ? current.grace_days : Math.min(28, Math.max(0, Math.round(Number(patch.grace_days)) || 0)),
    expiry_time: patch.expiry_time === undefined ? current.expiry_time : normalizeTime(patch.expiry_time),
    non_payment_profile: (patch.non_payment_profile ?? current.non_payment_profile) || DEFAULT_BILLING_SETTINGS.non_payment_profile,
    default_plan_id:
      patch.default_plan_id === undefined
        ? current.default_plan_id
        : (patch.default_plan_id === null || patch.default_plan_id === 0 ? null : Number(patch.default_plan_id)),
  };

  db.prepare(
    `INSERT INTO billing_settings (router_id, enabled, cutoff_day, grace_days, expiry_time, non_payment_profile, default_plan_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(router_id) DO UPDATE SET
       enabled = excluded.enabled,
       cutoff_day = excluded.cutoff_day,
       grace_days = excluded.grace_days,
       expiry_time = excluded.expiry_time,
       non_payment_profile = excluded.non_payment_profile,
       default_plan_id = excluded.default_plan_id,
       updated_at = excluded.updated_at`
  ).run(
    next.router_id,
    next.enabled,
    next.cutoff_day,
    next.grace_days,
    next.expiry_time,
    String(next.non_payment_profile),
    next.default_plan_id,
  );

  return getBillingSettings(routerId);
}

function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{1,2})/.exec(String(value || '').trim());
  if (!match) return '00:00';
  const hour = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function listBillingPlans(routerId: number, includeInactive = true): BillingPlan[] {
  const db = getDb();
  const sql = includeInactive
    ? 'SELECT * FROM billing_plans WHERE router_id = ? ORDER BY price ASC, name ASC'
    : 'SELECT * FROM billing_plans WHERE router_id = ? AND is_active = 1 ORDER BY price ASC, name ASC';
  return db.prepare(sql).all(routerId) as BillingPlan[];
}

export function getBillingPlan(routerId: number, planId: number): BillingPlan | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM billing_plans WHERE id = ? AND router_id = ?').get(planId, routerId) as BillingPlan) || null;
}

// ---------------------------------------------------------------- router side effects

/**
 * Push a profile onto the secret and drop the live session so it takes effect.
 * The router is reachable-or-not at all hours of the day, so a failure here is
 * reported instead of thrown - the database stays the source of truth and the
 * sweep retries.
 */
async function applyProfileOnRouter(
  routerId: number,
  username: string,
  profile: string
): Promise<{ synced: boolean; disconnected: boolean; error?: string }> {
  try {
    if (!mikroTikService.isConnected(routerId)) {
      return { synced: false, disconnected: false, error: 'router not connected' };
    }
    const found = await mikroTikService.setPppSecretProfile(routerId, username, profile);
    // A secret that does not exist on the router (customer added offline, or a
    // RADIUS-backed router) is not a billing failure - the profile is still
    // correct in our database and will be pushed when the secret appears.
    const disconnected = found ? await mikroTikService.disconnectPppSession(routerId, username) : false;
    return { synced: found, disconnected, error: found ? undefined : 'secret not found on router' };
  } catch (err) {
    return { synced: false, disconnected: false, error: (err as Error).message };
  }
}

/** Stamp the paid period onto the secret comment so Winbox shows it too. */
async function stampSecretComment(routerId: number, username: string, plan: BillingPlan | null, dueDate: string | null): Promise<void> {
  try {
    if (!mikroTikService.isConnected(routerId)) return;
    const secrets = await mikroTikService.getPppSecrets(routerId);
    const secret = (Array.isArray(secrets) ? secrets : []).find((s: any) => s.name === username);
    if (!secret) return;
    const base = String(secret.comment || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    const stamp = plan && dueDate ? `[${plan.name} due ${dueDate}]` : dueDate ? `[due ${dueDate}]` : '';
    const comment = `${base}${stamp ? ' ' + stamp : ''}`.trim();
    if (comment === String(secret.comment || '')) return;
    await mikroTikService.setPppSecretAttribute(routerId, username, 'comment', comment);
  } catch (err) {
    console.error(`[billing] comment stamp failed for ${username} on router ${routerId}:`, (err as Error).message);
  }
}

// ---------------------------------------------------------------- customer billing

export interface BillingResult {
  customerId: number;
  username: string;
  planId: number | null;
  planName: string | null;
  dueBefore: string | null;
  dueDate: string | null;
  billingStatus: string;
  profile: string;
  amount: number;
  routerSynced: boolean;
  disconnected: boolean;
  warning?: string;
}

function describeRouterFailure(result: { synced: boolean; error?: string }): string | undefined {
  if (result.synced) return undefined;
  return result.error || 'router update failed';
}

/** Bind a customer to a plan and start the clock. No money changes hands. */
export async function assignPlan(
  routerId: number,
  customerId: number,
  planId: number,
  opts: { cycles?: number; today?: Date } = {}
): Promise<BillingResult | null> {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
  if (!customer) return null;
  const plan = getBillingPlan(routerId, planId);
  if (!plan) throw new Error('Billing plan not found on this router');

  const settings = getBillingSettings(routerId);
  const { due } = computeDueDate({
    anchorDate: null,
    settings,
    cycleDays: plan.cycle_days,
    cycles: opts.cycles || 1,
    today: opts.today,
  });
  const dueDate = formatDateOnly(due);

  const routerResult = await applyProfileOnRouter(routerId, customer.username, plan.pppoe_profile);
  await stampSecretComment(routerId, customer.username, plan, dueDate);

  db.prepare(
    `UPDATE ppp_customers
     SET plan_id = ?, profile = ?, due_date = ?, billing_status = 'active',
         original_profile = NULL, updated_at = datetime('now')
     WHERE id = ? AND router_id = ?`
  ).run(plan.id, plan.pppoe_profile, dueDate, customerId, routerId);

  return {
    customerId,
    username: customer.username,
    planId: plan.id,
    planName: plan.name,
    dueBefore: customer.due_date || null,
    dueDate,
    billingStatus: 'active',
    profile: plan.pppoe_profile,
    amount: 0,
    routerSynced: routerResult.synced,
    disconnected: routerResult.disconnected,
    warning: describeRouterFailure(routerResult),
  };
}

/**
 * Record a payment. The new due date is measured from the date the customer was
 * already paid up to, so paying during the grace period does not push the cycle
 * forward and short-change them.
 */
export async function recordPayment(
  routerId: number,
  customerId: number,
  input: {
    planId?: number | null;
    cycles?: number;
    amount?: number | null;
    paymentMethod?: string;
    reference?: string | null;
    note?: string | null;
    recordedBy?: string;
    today?: Date;
  } = {}
): Promise<BillingResult | null> {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
  if (!customer) return null;

  const settings = getBillingSettings(routerId);
  const planId = input.planId ?? customer.plan_id ?? settings.default_plan_id;
  if (!planId) throw new Error('No billing plan selected and no default plan configured');
  const plan = getBillingPlan(routerId, Number(planId));
  if (!plan) throw new Error('Billing plan not found on this router');

  const cycles = Math.max(1, Math.round(input.cycles || 1));
  const { due, anchor } = computeDueDate({
    anchorDate: customer.due_date,
    settings,
    cycleDays: plan.cycle_days,
    cycles,
    today: input.today,
  });
  const dueDate = formatDateOnly(due);
  const amount = input.amount === null || input.amount === undefined ? plan.price * cycles : Number(input.amount);

  const routerResult = await applyProfileOnRouter(routerId, customer.username, plan.pppoe_profile);
  await stampSecretComment(routerId, customer.username, plan, dueDate);

  const insertPayment = db.prepare(
    `INSERT INTO ppp_payments (router_id, customer_id, plan_id, amount, cycle_days, payment_method, reference, due_before, due_after, recorded_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateCustomer = db.prepare(
    `UPDATE ppp_customers
     SET plan_id = ?, profile = ?, due_date = ?, billing_status = 'active',
         original_profile = NULL, last_paid_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND router_id = ?`
  );
  db.transaction(() => {
    insertPayment.run(
      routerId,
      customerId,
      plan.id,
      amount,
      plan.cycle_days * cycles,
      input.paymentMethod || 'cash',
      input.reference ?? null,
      customer.due_date || formatDateOnly(anchor),
      dueDate,
      input.recordedBy || '',
      input.note ?? null,
    );
    updateCustomer.run(plan.id, plan.pppoe_profile, dueDate, customerId, routerId);
  })();

  return {
    customerId,
    username: customer.username,
    planId: plan.id,
    planName: plan.name,
    dueBefore: customer.due_date || null,
    dueDate,
    billingStatus: 'active',
    profile: plan.pppoe_profile,
    amount,
    routerSynced: routerResult.synced,
    disconnected: routerResult.disconnected,
    warning: describeRouterFailure(routerResult),
  };
}

/** Move a customer onto the non-payment profile without touching the due date. */
export async function cutOffCustomer(
  routerId: number,
  customerId: number,
  opts: { profile?: string } = {}
): Promise<BillingResult | null> {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
  if (!customer) return null;
  if (customer.billing_status === 'cut-off' && customer.profile === (opts.profile || getBillingSettings(routerId).non_payment_profile)) {
    return {
      customerId,
      username: customer.username,
      planId: customer.plan_id,
      planName: null,
      dueBefore: customer.due_date || null,
      dueDate: customer.due_date || null,
      billingStatus: 'cut-off',
      profile: customer.profile,
      amount: 0,
      routerSynced: true,
      disconnected: false,
    };
  }

  const settings = getBillingSettings(routerId);
  const profile = opts.profile || settings.non_payment_profile;
  const routerResult = await applyProfileOnRouter(routerId, customer.username, profile);

  // Only flip the status when the router actually took the new profile: a
  // router that is offline right now must be retried on the next sweep.
  if (routerResult.synced) {
    db.prepare(
      `UPDATE ppp_customers
       SET profile = ?, original_profile = COALESCE(original_profile, profile),
           billing_status = 'cut-off', updated_at = datetime('now')
       WHERE id = ? AND router_id = ?`
    ).run(profile, customerId, routerId);
  }

  return {
    customerId,
    username: customer.username,
    planId: customer.plan_id,
    planName: null,
    dueBefore: customer.due_date || null,
    dueDate: customer.due_date || null,
    billingStatus: routerResult.synced ? 'cut-off' : String(customer.billing_status || 'active'),
    profile,
    amount: 0,
    routerSynced: routerResult.synced,
    disconnected: routerResult.disconnected,
    warning: describeRouterFailure(routerResult),
  };
}

// ---------------------------------------------------------------- cut-off sweep

export interface SweepReport {
  checked: number;
  cutOff: number;
  pending: number;
  details: Array<{ routerId: number; customerId: number; username: string; ok: boolean; error?: string }>;
}

/**
 * One pass over every router with billing switched on (or just `onlyRouterId`
 * when the panel asks for one router). Runs on a timer, so it has to be cheap
 * and idempotent: customers already in `cut-off` are skipped, and a router we
 * could not reach stays `active` and is picked up next pass.
 */
export async function runCutoffSweep(now: Date = new Date(), onlyRouterId?: number): Promise<SweepReport> {
  const db = getDb();
  const report: SweepReport = { checked: 0, cutOff: 0, pending: 0, details: [] };
  let enabled: any[] = [];

  try {
    enabled = onlyRouterId
      ? (db.prepare('SELECT * FROM billing_settings WHERE enabled = 1 AND router_id = ?').all(onlyRouterId) as any[])
      : (db.prepare('SELECT * FROM billing_settings WHERE enabled = 1').all() as any[]);
  } catch (err) {
    console.error('[billing] sweep could not read billing_settings:', (err as Error).message);
    return report;
  }

  for (const settings of enabled) {
    const routerId = Number(settings.router_id);
    let due: any[] = [];
    try {
      due = db
        .prepare(
          `SELECT id, username, due_date, profile, billing_status FROM ppp_customers
           WHERE router_id = ? AND due_date IS NOT NULL AND due_date != ''
             AND COALESCE(billing_status, 'unbilled') NOT IN ('cut-off', 'suspended')
           ORDER BY due_date ASC`
        )
        .all(routerId) as any[];
    } catch (err) {
      console.error(`[billing] sweep could not read customers for router ${routerId}:`, (err as Error).message);
      continue;
    }

    for (const row of due) {
      const expiry = expiryMoment(row.due_date, settings);
      if (!expiry || expiry > now) continue;
      report.checked++;

      try {
        const result = await cutOffCustomer(routerId, row.id, { profile: settings.non_payment_profile });
        const ok = !!result?.routerSynced;
        report.details.push({ routerId, customerId: row.id, username: row.username, ok, error: result?.warning });
        if (ok) report.cutOff++;
        else report.pending++;
      } catch (err) {
        report.pending++;
        report.details.push({ routerId, customerId: row.id, username: row.username, ok: false, error: (err as Error).message });
        console.error(`[billing] cut-off failed for ${row.username} on router ${routerId}:`, (err as Error).message);
      }
    }
  }

  if (report.cutOff || report.pending) {
    console.log(`[billing] cut-off sweep: ${report.cutOff} transferred, ${report.pending} pending retry`);
  }
  return report;
}

let sweepInterval: NodeJS.Timeout | null = null;
let sweepInFlight = false;

export function startPppBillingSweep(intervalSeconds = 60): void {
  stopPppBillingSweep();

  const seconds = Math.max(15, intervalSeconds || 60);
  console.log(`Starting PPP billing sweep (every ${seconds}s)`);

  sweepInterval = setInterval(() => {
    if (sweepInFlight) return; // previous pass still running - skip this tick
    sweepInFlight = true;
    runCutoffSweep()
      .catch((err) => console.error('PPP billing sweep failed:', err.message))
      .finally(() => {
        sweepInFlight = false;
      });
  }, seconds * 1000);
}

export function stopPppBillingSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
  sweepInFlight = false;
}

// ---------------------------------------------------------------- reporting

export interface BillingOverview {
  total: number;
  active: number;
  dueSoon: number;
  grace: number;
  cutOff: number;
  unbilled: number;
  collectedToday: number;
  collectedThisMonth: number;
}

export function getBillingOverview(routerId: number, now: Date = new Date()): BillingOverview {
  const db = getDb();
  const settings = getBillingSettings(routerId);
  const overview: BillingOverview = {
    total: 0,
    active: 0,
    dueSoon: 0,
    grace: 0,
    cutOff: 0,
    unbilled: 0,
    collectedToday: 0,
    collectedThisMonth: 0,
  };

  const customers = db
    .prepare(`SELECT due_date, billing_status FROM ppp_customers WHERE router_id = ?`)
    .all(routerId) as any[];

  for (const row of customers) {
    overview.total++;
    const status = String(row.billing_status || 'unbilled');
    if (status === 'cut-off') overview.cutOff++;
    else if (status === 'unbilled' || !row.due_date) overview.unbilled++;
    else {
      const expiry = expiryMoment(row.due_date, settings);
      if (expiry && expiry > now) {
        overview.active++;
        const due = parseDateOnly(row.due_date);
        // "Due soon" is about the paid period itself, grace included or not.
        if (due && due.getTime() - now.getTime() <= 3 * 86400000) overview.dueSoon++;
      } else if (expiry) {
        overview.grace++;
      } else {
        overview.unbilled++;
      }
    }
  }

  const sums = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN amount ELSE 0 END), 0) AS today,
         COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN amount ELSE 0 END), 0) AS month
       FROM ppp_payments WHERE router_id = ?`
    )
    .get(routerId) as any;
  overview.collectedToday = Number(sums?.today || 0);
  overview.collectedThisMonth = Number(sums?.month || 0);

  return overview;
}
