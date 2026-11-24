/**
 * Pisonet: pay-per-minute Windows desktops.
 *
 * A hotspot session cannot meter a desktop. The machine would have to stay
 * logged in for the whole visit and a dropped Wi-Fi link would look like bought
 * time, so instead every cafe PC is left permanently BYPASSED on the router and
 * the countdown lives here, on the panel, with a small Windows agent on the PC
 * asking for its remaining seconds a few times a minute.
 *
 * That split matters for two failure modes:
 *   - The panel dies. The agent keeps the deadline it was last given and still
 *     locks the machine, because it compares its own clock to an absolute
 *     instant rather than counting down a number it was handed.
 *   - The PC is rebooted. The agent starts again from the Run key in client mode,
 *     and the panel notices the new boot id and drops any admin unlock, so
 *     "reboot to get the desktop back" can never be used to finish a game
 *     without paying.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../database';
import { mikroTikService } from './mikrotik';

export interface CafeSettings {
  router_id: number;
  enabled: number;
  currency: string;
  rate_list: string;
  default_minutes: number;
  admin_password_hash: string;
  pause_on_admin: number;
  updated_at: string;
}

export interface MachineState {
  locked: boolean;
  mode: 'client' | 'admin';
  secondsLeft: number;
  expiresAt: string | null;
  name: string;
  currency: string;
  /** Absolute UTC instant the agent must lock at, so the panel may disappear. */
  lockAt: string | null;
}

// ---------------------------------------------------------------- clock

// Every deadline in this module is UTC in the same shape the rest of the panel
// writes expiry timestamps: "YYYY-MM-DD HH:MM:SS", read back with an explicit Z.
function sqlUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function parseSql(value: any): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const iso = text.includes('T') ? text : text.replace(' ', 'T');
  const stamped = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const time = new Date(stamped).getTime();
  return Number.isFinite(time) ? new Date(time) : null;
}

function nowSql(value: any): number {
  const date = parseSql(value);
  return date ? date.getTime() : 0;
}

// ---------------------------------------------------------------- settings

export function getCafeSettings(routerId: number): CafeSettings {
  const db = getDb();
  const row = db.prepare('SELECT * FROM cafe_settings WHERE router_id = ?').get(routerId) as CafeSettings | undefined;
  if (row) return row;
  return {
    router_id: routerId,
    enabled: 0,
    currency: 'PHP',
    rate_list: '15 Minutes#15#10|30 Minutes#30#15|1 Hour#60#20|2 Hours#120#35',
    default_minutes: 60,
    admin_password_hash: '',
    pause_on_admin: 1,
    updated_at: '',
  };
}

export function saveCafeSettings(routerId: number, patch: Partial<CafeSettings>): CafeSettings {
  const db = getDb();
  const current = getCafeSettings(routerId);
  const next = {
    enabled: patch.enabled === undefined ? current.enabled : (Number(patch.enabled) === 1 ? 1 : 0),
    currency: String(patch.currency ?? (current.currency || 'PHP')).slice(0, 8),
    rate_list: String(patch.rate_list ?? current.rate_list).slice(0, 2000),
    default_minutes: clampMinutes(patch.default_minutes, current.default_minutes),
    pause_on_admin: patch.pause_on_admin === undefined ? current.pause_on_admin : (Number(patch.pause_on_admin) === 1 ? 1 : 0),
  };
  db.prepare(
    `INSERT INTO cafe_settings (router_id, enabled, currency, rate_list, default_minutes, admin_password_hash, pause_on_admin, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(router_id) DO UPDATE SET
       enabled = excluded.enabled,
       currency = excluded.currency,
       rate_list = excluded.rate_list,
       default_minutes = excluded.default_minutes,
       pause_on_admin = excluded.pause_on_admin,
       updated_at = excluded.updated_at`
  ).run(routerId, next.enabled, next.currency, next.rate_list, next.default_minutes, current.admin_password_hash, next.pause_on_admin);
  return getCafeSettings(routerId);
}

function clampMinutes(value: any, fallback: number, min = 1): number {
  const floor = Number.isFinite(Number(fallback)) ? Math.round(Number(fallback)) : min;
  if (value === undefined || value === null || value === '') return Math.max(min, floor);
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return Math.max(min, floor);
  return Math.min(24 * 60, Math.max(min, n));
}

/** The quick-add buttons on the Pisonet page, parsed out of rate_list. */
export function parseRateList(raw: string): Array<{ label: string; minutes: number; amount: number }> {
  return String(raw || '')
    .split('|')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, minutes, amount] = line.split('#');
      return {
        label: String(label || '').trim() || `${minutes || '?'} min`,
        minutes: Math.round(Number(minutes)) || 0,
        amount: Math.round((Number(amount) || 0) * 100) / 100,
      };
    })
    .filter((rate) => rate.minutes > 0);
}

export async function setAdminPassword(routerId: number, plain: string): Promise<void> {
  const db = getDb();
  const hash = plain ? await bcrypt.hash(String(plain), 10) : '';
  const defaults = getCafeSettings(routerId);
  // The row has to be created with the same starter values a first read hands out.
  // A bare two-column insert would leave the schema default of an empty rate list,
  // so setting a password alone would silently delete the shop's price buttons.
  db.prepare(
    `INSERT INTO cafe_settings (router_id, enabled, currency, rate_list, default_minutes, admin_password_hash, pause_on_admin, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(router_id) DO UPDATE SET
       admin_password_hash = excluded.admin_password_hash,
       updated_at = excluded.updated_at`
  ).run(routerId, defaults.enabled, defaults.currency, defaults.rate_list, defaults.default_minutes, hash, defaults.pause_on_admin);
}

/**
 * An unlocked cafe machine has no password of its own to guess at, so the shop
 * owner's password is per router. Never configured means nobody can unlock from
 * the keyboard: the panel is then the only way to hand a machine to an admin.
 */
export async function verifyAdminPassword(routerId: number, plain: string): Promise<boolean> {
  const settings = getCafeSettings(routerId);
  if (!settings.admin_password_hash) return false;
  return bcrypt.compare(String(plain || ''), settings.admin_password_hash);
}

export function hasAdminPassword(routerId: number): boolean {
  return !!String(getCafeSettings(routerId).admin_password_hash || '');
}

// ---------------------------------------------------------------- machines

export function listCafeMachines(routerId: number): any[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM cafe_machines WHERE router_id = ? ORDER BY name COLLATE NOCASE').all(routerId) as any[];
  const now = Date.now();
  return rows.map((row) => ({ ...row, seconds_left: remainingSeconds(row, now), online: isOnline(row) }));
}

export function getCafeMachine(routerId: number, id: number): any | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM cafe_machines WHERE id = ? AND router_id = ?').get(id, routerId) as any) || null;
}

function requireMachine(routerId: number, id: number): any {
  const machine = getCafeMachine(routerId, id);
  if (!machine) throw new CafeError(404, 'Machine not found');
  return machine;
}

export class CafeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeMac(value: any): string {
  return String(value || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
}

function prettyMac(key: string): string {
  return key.match(/.{2}/g)?.join(':') || '';
}

export function makeAgentToken(): string {
  return crypto.randomBytes(20).toString('hex');
}

/**
 * Adopt a PC into the shop. `candidateId` is the row the agent beaconed in, and
 * taking it marks it added so it stops showing up as "not added yet".
 */
export async function addCafeMachine(
  routerId: number,
  input: { name?: string; macAddress?: string; hostname?: string; ipAddress?: string; deviceId?: number; candidateId?: number; minutes?: number }
): Promise<any> {
  const db = getDb();
  const macKey = normalizeMac(input.macAddress);
  const hostname = String(input.hostname || '').trim().slice(0, 64);
  const name = String(input.name || '').trim().slice(0, 48) || hostname || (macKey ? prettyMac(macKey) : '');
  if (!name) throw new CafeError(400, 'Give the machine a name, a hostname or a MAC address');
  if (!macKey && !input.deviceId) throw new CafeError(400, 'A MAC address is needed so the machine can be bypassed on the router');

  if (macKey) {
    const clash = db.prepare('SELECT id, name FROM cafe_machines WHERE router_id = ? AND mac_address = ?').get(routerId, prettyMac(macKey)) as any;
    if (clash) throw new CafeError(409, `${clash.name} is already using that MAC address`);
  }

  const token = makeAgentToken();
  // An adopt with no starter minutes must not sell an hour by accident.
  const minutes = clampMinutes(input.minutes, 0, 0);
  const result = db
    .prepare(
      `INSERT INTO cafe_machines (router_id, name, mac_address, ip_address, hostname, device_id, token, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'client', datetime('now'), datetime('now'))`
    )
    .run(routerId, name, macKey ? prettyMac(macKey) : '', String(input.ipAddress || '').trim(), hostname, input.deviceId || null, token);

  const id = Number(result.lastInsertRowid);
  if (input.candidateId) {
    db.prepare("UPDATE cafe_candidates SET added = 1, last_seen = datetime('now') WHERE id = ?").run(Number(input.candidateId));
  }
  logSession(routerId, id, 'added', minutes, 0, 'token issued', 'admin');

  const machine = requireMachine(routerId, id);
  await applyBypass(machine).catch((err) => {
    // The PC is still registered; the sweep retries the router side.
    console.warn(`[pisonet] ${name}: bypass could not be written (${(err as Error).message})`);
  });
  if (minutes > 0) await startCafeSession(routerId, id, minutes, 0, 'signup');
  return requireMachine(routerId, id);
}

export async function updateCafeMachine(
  routerId: number,
  id: number,
  patch: { name?: string; macAddress?: string; ipAddress?: string; hostname?: string }
): Promise<any> {
  const db = getDb();
  const machine = requireMachine(routerId, id);
  const name = patch.name === undefined ? machine.name : String(patch.name).trim().slice(0, 48) || machine.name;
  const macKey = patch.macAddress === undefined ? normalizeMac(machine.mac_address) : normalizeMac(patch.macAddress);
  const ip = patch.ipAddress === undefined ? machine.ip_address : String(patch.ipAddress).trim();
  const hostname = patch.hostname === undefined ? machine.hostname : String(patch.hostname).trim().slice(0, 64);
  db.prepare(
    "UPDATE cafe_machines SET name = ?, mac_address = ?, ip_address = ?, hostname = ?, updated_at = datetime('now') WHERE id = ? AND router_id = ?"
  ).run(name, macKey ? prettyMac(macKey) : '', ip, hostname, id, routerId);
  if (macKey) await applyBypass({ ...machine, name, mac_address: prettyMac(macKey), ip_address: ip }).catch(() => undefined);
  return requireMachine(routerId, id);
}

export async function removeCafeMachine(routerId: number, id: number): Promise<boolean> {
  const db = getDb();
  const machine = getCafeMachine(routerId, id);
  if (!machine) return false;
  await clearBypass(machine).catch((err) => console.warn(`[pisonet] could not clear the binding for ${machine.name}:`, (err as Error).message));
  db.prepare('DELETE FROM cafe_machines WHERE id = ? AND router_id = ?').run(id, routerId);
  return true;
}

// ---------------------------------------------------------------- the meter

/** Frozen or live, how many paid seconds this machine still has. */
export function remainingSeconds(machine: any, now: number = Date.now()): number {
  const end = nowSql(machine?.expires_at);
  if (!end) return 0;
  // While paused the deadline is measured from the instant it stopped, not from
  // now, which is what keeps banked time from draining on the lock screen.
  const reference = machine.running ? now : nowSql(machine.paused_at) || now;
  return Math.max(0, Math.floor((end - reference) / 1000));
}

function isOnline(machine: any): boolean {
  const seen = nowSql(machine?.last_seen);
  return !!seen && Date.now() - seen < 90 * 1000;
}

/** Fold frozen time back into a live deadline without extending it. */
function liveDeadline(machine: any, now: number): number {
  if (machine.running) return Math.max(nowSql(machine.expires_at), now);
  return now + remainingSeconds(machine, now) * 1000;
}

/**
 * Sell minutes. A machine with time still on the clock is extended from where it
 * stood, and one that had run out starts fresh from this instant, so a customer
 * who let their hour expire is not credited the idle time.
 */
export async function startCafeSession(
  routerId: number,
  id: number,
  minutes: number,
  amount = 0,
  operator = '',
  detail?: string
): Promise<any> {
  const db = getDb();
  const machine = requireMachine(routerId, id);
  const add = Math.round(Number(minutes) || 0);
  if (!Number.isFinite(add) || add < 1 || add > 24 * 60) throw new CafeError(400, 'Minutes must be a whole number from 1 to 1440');

  const now = Date.now();
  const base = liveDeadline(machine, now);
  const expiresAt = sqlUtc(new Date(base + add * 60000));
  db.prepare(
    `UPDATE cafe_machines
     SET expires_at = ?, paused_at = NULL, running = 1, mode = 'client', updated_at = datetime('now')
     WHERE id = ? AND router_id = ?`
  ).run(expiresAt, id, routerId);
  logSession(routerId, id, machine.running && remainingSeconds(machine, now) > 0 ? 'extended' : 'started', add, amount, detail || '', operator);
  await applyBypass(machine).catch(() => undefined);
  return requireMachine(routerId, id);
}

/**
 * Stop charging. Used by the panel's Lock button, by an admin taking the machine
 * over, and when an admin hands it back, and it never spends the time still on
 * the clock.
 */
export function pauseCafeMachine(routerId: number, id: number, mode: 'client' | 'admin' = 'client', operator = '', event = 'paused'): any {
  const db = getDb();
  const machine = requireMachine(routerId, id);
  if (!machine.running && machine.mode === mode) return machine;
  const now = Date.now();
  // Fold whatever was still live into an absolute deadline, then stop the clock at
  // this instant: remaining time is measured from paused_at, so a machine sitting
  // on the lock screen costs the customer nothing.
  const expiresAt = sqlUtc(new Date(liveDeadline(machine, now)));
  const frozen = sqlUtc(new Date(now));
  db.prepare(
    `UPDATE cafe_machines
     SET running = 0, expires_at = ?, paused_at = ?, mode = ?, unlocked_at = ?, updated_at = datetime('now')
     WHERE id = ? AND router_id = ?`
  ).run(expiresAt, frozen, mode, mode === 'admin' ? frozen : null, id, routerId);
  logSession(routerId, id, event, 0, 0, '', operator);
  return requireMachine(routerId, id);
}

/** Put a machine back on the customer clock after an admin walkabout. */
export async function releaseCafeMachine(routerId: number, id: number, operator = ''): Promise<any> {
  const machine = requireMachine(routerId, id);
  if (machine.mode !== 'admin') return machine;
  // Deliberately still paused: the next customer has not paid yet, so the desktop
  // goes back to the lock screen with whatever time was banked before the service.
  return pauseCafeMachine(routerId, id, 'client', operator, 'released');
}

/** Wipe the paid time: the shop is closing or the machine is being reset. */
export function resetCafeMachine(routerId: number, id: number, operator = ''): any {
  const db = getDb();
  const machine = requireMachine(routerId, id);
  db.prepare("UPDATE cafe_machines SET expires_at = NULL, paused_at = NULL, running = 0, mode = 'client', unlocked_at = NULL, updated_at = datetime('now') WHERE id = ? AND router_id = ?")
    .run(id, routerId);
  logSession(routerId, id, 'reset', 0, 0, machine.running ? 'time cleared' : '', operator);
  return requireMachine(routerId, id);
}

/** What the agent is told on every heartbeat. */
export function machineState(machine: any, settings: CafeSettings, now: number = Date.now()): MachineState {
  const secondsLeft = remainingSeconds(machine, now);
  const admin = machine.mode === 'admin';
  const locked = !admin && (!machine.running || secondsLeft <= 0);
  // Hand over an absolute instant, not a number to count down, so the agent's
  // lock survives the panel being unreachable. Only a live meter has one: a paused
  // or unstarted machine is locked now, whatever time is still in the bank.
  const lockAt = admin || !machine.running ? null : machine.expires_at;
  return {
    locked,
    mode: admin ? 'admin' : 'client',
    secondsLeft,
    expiresAt: machine.expires_at || null,
    name: String(machine.name || ''),
    currency: settings.currency,
    lockAt,
  };
}

// ---------------------------------------------------------------- agent side

function logSession(routerId: number, machineId: number, event: string, minutes: number, amount: number, detail = '', operator = ''): void {
  const db = getDb();
  db.prepare('INSERT INTO cafe_sessions (router_id, machine_id, event, minutes, amount, detail, operator) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(routerId, machineId, event, Math.round(Number(minutes) || 0), Math.round((Number(amount) || 0) * 100) / 100, String(detail || '').slice(0, 200), String(operator || '').slice(0, 32));
}

/**
 * The beacon an install sends before anybody has added it. Nothing here is
 * trusted beyond "a PC with this hostname exists at this address", and the only
 * thing it can change is the candidate list the Add dialog reads.
 */
export function noteAgentHello(input: { hostname?: string; ip?: string; mac?: string; version?: string }): { known: boolean; machineId?: number } {
  const db = getDb();
  const hostname = String(input.hostname || '').trim().slice(0, 64);
  const ip = usableIp(input.ip);
  if (!hostname && !ip) throw new CafeError(400, 'hostname or ip is required');
  const macKey = normalizeMac(input.mac);
  db.prepare(
    `INSERT INTO cafe_candidates (hostname, ip_address, mac_address, agent_version, first_seen, last_seen)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(hostname, ip_address) DO UPDATE SET
       mac_address = CASE WHEN excluded.mac_address <> '' THEN excluded.mac_address ELSE cafe_candidates.mac_address END,
       agent_version = excluded.agent_version,
       last_seen = datetime('now')`
  ).run(hostname || '?', ip, macKey ? prettyMac(macKey) : '', String(input.version || '').slice(0, 24));

  const match = macKey
    ? (db.prepare('SELECT id FROM cafe_machines WHERE mac_address = ? ORDER BY id LIMIT 1').get(prettyMac(macKey)) as any)
    : (db.prepare('SELECT id FROM cafe_machines WHERE hostname <> \'\' AND hostname = ? ORDER BY id LIMIT 1').get(hostname) as any);
  if (match) db.prepare("UPDATE cafe_candidates SET added = 1, last_seen = datetime('now') WHERE hostname = ? OR mac_address = ?").run(hostname, prettyMac(macKey));
  return { known: !!match, machineId: match ? Number(match.id) : undefined };
}

export function listCandidates(seconds = 300): any[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM cafe_candidates
       WHERE added = 0 AND last_seen >= datetime('now', ?) ORDER BY last_seen DESC LIMIT 100`
    )
    .all(`-${Math.max(30, seconds)} seconds`) as any[];
}

/**
 * An agent that was installed before anybody added it has no token. Once the shop
 * adds the desktop, the PC picks its own token up here by proving it is the
 * machine the panel recorded - same MAC the router reported, or the same hostname
 * when no MAC is on file - so nobody has to type a 40-character string on a
 * customer keyboard.
 *
 * Only a machine that has never phoned home can be claimed, which keeps a token
 * that is already in use from being handed to a second PC.
 */
export function claimAgentMachine(input: { hostname?: string; ip?: string; mac?: string }): string | null {
  const db = getDb();
  const macKey = normalizeMac(input.mac);
  const ip = String(input.ip || '').trim();
  const hostname = String(input.hostname || '').trim().toLowerCase();
  const unseen = db.prepare('SELECT * FROM cafe_machines WHERE last_seen IS NULL').all() as any[];
  for (const machine of unseen) {
    const recorded = normalizeMac(machine.mac_address);
    if (recorded && macKey && recorded === macKey) return machine.token;
    if (!recorded && hostname && String(machine.hostname || '').toLowerCase() === hostname) return machine.token;
    if (!recorded && !hostname && ip && String(machine.ip_address || '').trim() === ip) return machine.token;
  }
  return null;
}

/**
 * The agent's every-few-seconds call. It is the liveness signal for the panel and
 * the moment the machine learns its boot id, which is how a reboot that was meant
 * to escape the lock instead hands the desktop straight back to the customer.
 */
export function agentHeartbeat(token: string, input: { bootId?: string; ip?: string; version?: string; hostname?: string }): (MachineState & { machineId: number; paused: boolean }) | null {
  const db = getDb();
  const machine = db.prepare('SELECT * FROM cafe_machines WHERE token = ?').get(String(token || '')) as any;
  if (!machine) return null;

  const now = Date.now();
  const bootId = String(input.bootId || '').slice(0, 40);
  let mode = machine.mode;
  // A different boot id means Windows went through its own startup, and whatever
  // the shop owner unlocked before the reboot is gone with it.
  if (bootId && machine.boot_id && bootId !== machine.boot_id && mode === 'admin') {
    mode = 'client';
    // paused_at deliberately stays where the admin handover put it: the meter is
    // read from that instant, so moving it to now would quietly spend the banked
    // time the shop owner was protecting.
    db.prepare("UPDATE cafe_machines SET mode = 'client', unlocked_at = NULL WHERE id = ?").run(machine.id);
    logSession(machine.router_id, machine.id, 'rebooted', 0, 0, 'admin unlock dropped', 'agent');
  }
  db.prepare(
    `UPDATE cafe_machines
     SET last_seen = datetime('now'),
         ip_address = COALESCE(NULLIF(?, ''), ip_address),
         hostname = COALESCE(NULLIF(?, ''), hostname),
         agent_version = COALESCE(NULLIF(?, ''), agent_version),
         boot_id = COALESCE(NULLIF(?, ''), boot_id)
     WHERE id = ?`
  ).run(usableIp(input.ip), String(input.hostname || '').trim().slice(0, 64), String(input.version || '').trim().slice(0, 24), bootId, machine.id);

  const fresh = { ...machine, mode } as any;
  const settings = getCafeSettings(machine.router_id);
  const state = machineState(fresh, settings, now);
  // The ticker only sees machines that phone home while Windows is up, so the
  // expiry event is written here too: the person watching the table gets the
  // truth on the very next heartbeat instead of after the next tick.
  if (machine.running && machine.mode !== 'admin' && state.secondsLeft <= 0) {
    db.prepare('UPDATE cafe_machines SET running = 0, paused_at = ? WHERE id = ?').run(sqlUtc(new Date(now)), machine.id);
    logSession(machine.router_id, machine.id, 'expired', 0, 0, '', 'agent');
  }
  return { ...state, machineId: Number(machine.id), paused: !machine.running };
}

/** The keyboard-side unlock, verified against the panel so no password is stored on a customer PC. */
export async function agentUnlock(token: string, password: string): Promise<{ ok: boolean; state?: MachineState & { machineId: number }; error?: string }> {
  const db = getDb();
  const machine = db.prepare('SELECT * FROM cafe_machines WHERE token = ?').get(String(token || '')) as any;
  if (!machine) return { ok: false, error: 'This machine is not registered with the panel' };
  const settings = getCafeSettings(machine.router_id);
  if (!settings.admin_password_hash) return { ok: false, error: 'No admin password is set for this router. Set it on the Pisonet page.' };
  if (!(await verifyAdminPassword(machine.router_id, password))) {
    logSession(machine.router_id, machine.id, 'unlock-denied', 0, 0, 'bad admin password', 'agent');
    return { ok: false, error: 'Wrong admin password' };
  }
  const updated = pauseCafeMachine(machine.router_id, machine.id, 'admin', 'agent', 'unlocked');
  const state = machineState(updated, settings);
  return { ok: true, state: { ...state, machineId: Number(machine.id) } };
}

/** "Lock now" from the agent's own settings window, so a technician can hand a
 *  serviced machine back without walking to the panel. */
export function agentRelock(token: string): { ok: boolean; state?: MachineState & { machineId: number }; error?: string } {
  const db = getDb();
  const machine = db.prepare('SELECT * FROM cafe_machines WHERE token = ?').get(String(token || '')) as any;
  if (!machine) return { ok: false, error: 'This machine is not registered with the panel' };
  const updated = pauseCafeMachine(machine.router_id, machine.id, 'client', 'agent', 'released');
  const state = machineState(updated, getCafeSettings(machine.router_id));
  return { ok: true, state: { ...state, machineId: Number(machine.id) } };
}

// ---------------------------------------------------------------- router side

const BINDING_COMMENT = (id: number): string => `JuanFi pisonet ${id}`;

/**
 * An address of 127.x means the panel was poked from its own machine - a local
 * test, or a proxy that forgot to send X-Forwarded-For. It says nothing about
 * where the desktop is, and trusting it would overwrite the address the shop typed
 * in, which is the one the router is asked for a MAC against.
 */
function usableIp(value: any): string {
  const ip = String(value || '').trim().slice(0, 45);
  return !ip || /^127\./.test(ip) || ip === '::1' ? '' : ip;
}

/**
 * A desktop must reach the internet the instant the shop owner presses Start, and
 * a hotspot login in the way of that is a support call at 2am. An IP binding of
 * type=bypassed makes the machine never see a login page at all; the timer is the
 * only gate, and it lives on the PC.
 */
export async function applyBypass(machine: any): Promise<{ synced: boolean; error?: string }> {
  const routerId = Number(machine.router_id);
  const mac = normalizeMac(machine.mac_address);
  if (!mac) return { synced: false, error: 'no MAC address on file' };
  if (!mikroTikService.isConnected(routerId)) return { synced: false, error: 'router not connected' };
  const comment = BINDING_COMMENT(Number(machine.id));
  try {
    const bindings = await mikroTikService.getIpBindings(routerId);
    const owned = bindings.filter((b: any) => b.comment === comment);
    // RouterOS calls the value 'bypassed', not 'bypass' - the same word the
    // RADIUS device access modes use, and what the router itself writes back.
    const data = { 'mac-address': prettyMac(mac), type: 'bypassed', server: 'all', disabled: 'false', comment };
    if (owned.length) {
      await mikroTikService.updateIpBinding(routerId, owned[0]['.id'], data);
      for (const extra of owned.slice(1)) await mikroTikService.deleteIpBinding(routerId, extra['.id']);
    } else {
      await mikroTikService.createIpBinding(routerId, data);
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, error: (err as Error).message };
  }
}

export async function clearBypass(machine: any): Promise<void> {
  const routerId = Number(machine.router_id);
  if (!mikroTikService.isConnected(routerId)) return;
  const comment = BINDING_COMMENT(Number(machine.id));
  const bindings = await mikroTikService.getIpBindings(routerId);
  for (const binding of bindings.filter((b: any) => b.comment === comment)) {
    await mikroTikService.deleteIpBinding(routerId, binding['.id']);
  }
}

/**
 * A PC that beaconed its address but not its MAC: the router knows the mapping,
 * so ask it rather than making the shop owner read it off a sticker.
 */
export async function resolveMac(routerId: number, ip: string): Promise<string> {
  const address = String(ip || '').trim();
  if (!address || !mikroTikService.isConnected(routerId)) return '';
  try {
    const arp = await mikroTikService.getArpEntries(routerId);
    const hit = (Array.isArray(arp) ? arp : []).find((entry: any) => String(entry.address || '').trim() === address);
    if (hit?.['mac-address']) return normalizeMac(hit['mac-address']);
  } catch { /* fall through to the lease table */ }
  try {
    const leases = await mikroTikService.getDhcpLeases(routerId);
    const hit = (Array.isArray(leases) ? leases : []).find((lease: any) => String(lease.address || '').trim() === address);
    if (hit?.['mac-address']) return normalizeMac(hit['mac-address']);
  } catch { /* the caller can still type the MAC in by hand */ }
  return '';
}

/** Re-push every bypass, for a router that was offline when machines were added. */
export async function reconcileBindings(routerId: number): Promise<{ checked: number; fixed: number; skipped?: string }> {
  const db = getDb();
  const machines = db.prepare("SELECT * FROM cafe_machines WHERE router_id = ? AND mac_address <> ''").all(routerId) as any[];
  if (!mikroTikService.isConnected(routerId)) return { checked: machines.length, fixed: 0, skipped: 'router not connected' };
  let fixed = 0;
  for (const machine of machines) {
    const bindings = await mikroTikService.getIpBindings(routerId).catch(() => [] as any[]);
    const owned = bindings.filter((b: any) => b.comment === BINDING_COMMENT(Number(machine.id)));
    const live = owned.find((b: any) => ![true, 'true', 'yes', 1, '1'].includes(b.disabled) && String(b.type || '') === 'bypassed');
    if (!live) {
      const result = await applyBypass(machine);
      if (result.synced) fixed++;
    } else if (owned.length > 1) {
      for (const extra of owned.filter((b: any) => b !== live)) await mikroTikService.deleteIpBinding(routerId, extra['.id']);
    }
  }
  return { checked: machines.length, fixed };
}

// ---------------------------------------------------------------- sales

export function cafeSummary(routerId: number, days = 1): any {
  const db = getDb();
  const since = sqlUtc(new Date(Date.now() - Math.max(1, days) * 86400000));
  const totals = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(minutes), 0) AS minutes, COUNT(*) AS sales FROM cafe_sessions WHERE router_id = ? AND event IN ('started', 'extended') AND created_at >= ?")
    .get(routerId, since) as any;
  const recent = db
    .prepare(
      `SELECT s.*, m.name AS machine FROM cafe_sessions s
       LEFT JOIN cafe_machines m ON m.id = s.machine_id
       WHERE s.router_id = ? ORDER BY s.created_at DESC LIMIT 50`
    )
    .all(routerId) as any[];
  return {
    amount: Math.round((Number(totals?.amount) || 0) * 100) / 100,
    minutes: Number(totals?.minutes) || 0,
    sales: Number(totals?.sales) || 0,
    recent,
  };
}

// ---------------------------------------------------------------- ticker

let ticker: NodeJS.Timeout | null = null;

/**
 * Machines only phone home while Windows is up, so this is the pass that notices
 * the ones that ran out and are sitting locked with nobody watching, and it is
 * what retries a bypass the router refused. It changes nothing the agent has not
 * already been told, which is why it is safe to run often.
 */
export function cafeTick(now: number = Date.now()): { expired: number; rechecked: number } {
  const db = getDb();
  let expired = 0;
  let rechecked = 0;
  try {
    const running = db.prepare('SELECT * FROM cafe_machines WHERE running = 1 AND mode <> \'admin\' AND expires_at IS NOT NULL').all() as any[];
    for (const machine of running) {
      if (remainingSeconds(machine, now) > 0) continue;
      db.prepare("UPDATE cafe_machines SET running = 0, paused_at = ? WHERE id = ?").run(sqlUtc(new Date(now)), machine.id);
      logSession(machine.router_id, machine.id, 'expired', 0, 0, '', 'timer');
      expired++;
    }
    const stale = db.prepare("SELECT * FROM cafe_machines WHERE mac_address <> '' AND (last_seen IS NULL OR last_seen < datetime('now', '-10 minutes')) LIMIT 5").all() as any[];
    for (const machine of stale) {
      rechecked++;
      // Fire-and-forget on purpose: the tick has to stay cheap, and applyBypass
      // reports a refusal instead of throwing.
      void applyBypass(machine);
    }
    // The hello beacon needs no credentials, so the candidate list is what an
    // unadded PC can grow. A week of silence means that PC is gone.
    db.prepare("DELETE FROM cafe_candidates WHERE added = 0 AND last_seen < datetime('now', '-7 days')").run();
  } catch (err) {
    console.error('[pisonet] tick failed:', (err as Error).message);
  }
  return { expired, rechecked };
}

export function startCafeTicker(intervalSeconds = 10): void {
  stopCafeTicker();
  const seconds = Math.max(5, intervalSeconds || 10);
  ticker = setInterval(() => cafeTick(), seconds * 1000);
  if (typeof ticker.unref === 'function') ticker.unref();
  console.log(`[pisonet] meter ticking every ${seconds}s`);
}

export function stopCafeTicker(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}
