import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { airCoinsDataDir, getSettings, getStatus, planCoinAllocation } from './aircoins';

/*
 * A coin session for an AirCoins machine.
 *
 * The JuanFi firmware holds the session on the board: /topUp opens the slot,
 * every /checkCoin reports the coins taken so far and re-opens it, /useVoucher
 * commits the time and /cancelTopUp ends it early. The slot expires on its own
 * and commits whatever was taken, so a customer who walks away is still paid.
 *
 * An AirCoins board cannot do that: it has no web server and no idea who is
 * paying - it only asks the panel for config and reports what it counted. So
 * the panel holds the same session instead, with the same four answers, and the
 * portal keeps the same client logic. What the board contributes is the count:
 * while a session is live it reports every couple of seconds and holds the bank
 * until the panel says how many pulses it has already paid for.
 *
 * One session per machine. A coin slot is a physical place, so a second customer
 * pressing INSERT COIN while the first is still dropping coins is told the
 * machine is busy instead of the two of them sharing a bank.
 */

export type AirCoinsSessionStatus = 'open' | 'saved' | 'cancelled' | 'expired' | 'replaced';

export interface AirCoinsSession {
  id: string;
  deviceId: number;
  /** What the phone presented, mirroring JuanFi's currentActiveVoucher. */
  voucher: string;
  /** PC this session credits, without separators. Same identity, no colons. */
  mac: string;
  routerId: number;
  status: AirCoinsSessionStatus;
  startedAt: string;
  expiresAt: string;
  /**
   * How many of the board's session pulses are already paid for. The board gets
   * this back as an absolute value, never as an amount to subtract, so a reply
   * lost in the air costs one round trip instead of paying the same coin twice.
   */
  settledPulses: number;
  /** Seconds of time priced for settledPulses. */
  settledSeconds: number;
  /** Result of the commit, once there is one. */
  minutes: number;
  coins: number;
  error: string;
}

interface SessionStore {
  sessions: Record<string, AirCoinsSession>;
}

/**
 * How long the slot waits for a coin. The portal draws this as a countdown and
 * closes the dialog (and the session) when it runs out, so the panel and the
 * screen must agree on one number.
 */
const DEFAULT_TTL_SECONDS = 60;

function storeFile(): string {
  return path.join(airCoinsDataDir(), 'aircoins-sessions.json');
}

function loadStore(): SessionStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as SessionStore;
    return {
      sessions: raw && raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
    };
  } catch {
    return { sessions: {} };
  }
}

function saveStore(store: SessionStore): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2), 'utf8');
}

export function sessionTtlSeconds(): number {
  const wanted = parseInt(String(process.env.AIRCOINS_SESSION_SECONDS || ''), 10);
  if (!Number.isFinite(wanted) || wanted < 30) return DEFAULT_TTL_SECONDS;
  return Math.min(wanted, 1800);
}

/** How often the board must report while a session is live. */
export const SESSION_POLL_SECONDS = 2;

export function findSession(deviceId: number): AirCoinsSession | null {
  return loadStore().sessions[String(deviceId)] || null;
}

export function findSessionById(id: string): AirCoinsSession | null {
  const wanted = String(id || '');
  if (!wanted) return null;
  for (const session of Object.values(loadStore().sessions)) {
    if (session.id === wanted) return session;
  }
  return null;
}

/** True only while the session is open and inside its window. */
export function sessionIsLive(session: AirCoinsSession | null): boolean {
  if (!session || session.status !== 'open') return false;
  const ends = new Date(session.expiresAt).getTime();
  return Number.isFinite(ends) && ends > Date.now();
}

export function sessionRemainingMs(session: AirCoinsSession | null): number {
  if (!session) return 0;
  const ends = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, ends - Date.now());
}

export function openSession(deviceId: number, voucher: string, mac: string, routerId: number): AirCoinsSession {
  const store = loadStore();
  const previous = store.sessions[String(deviceId)];
  if (previous && previous.status === 'open') previous.status = 'replaced';

  const now = Date.now();
  const identity = String(mac || voucher || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  const session: AirCoinsSession = {
    id: crypto.randomBytes(8).toString('hex'),
    deviceId,
    voucher: String(voucher || identity).toUpperCase(),
    mac: identity,
    routerId: Number(routerId) || 0,
    status: 'open',
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionTtlSeconds() * 1000).toISOString(),
    settledPulses: 0,
    settledSeconds: 0,
    minutes: 0,
    coins: 0,
    error: '',
  };
  store.sessions[String(deviceId)] = session;
  saveStore(store);
  return session;
}

export function finishSession(
  id: string,
  status: AirCoinsSessionStatus,
  patch: Partial<AirCoinsSession> = {},
): AirCoinsSession | null {
  const store = loadStore();
  for (const key of Object.keys(store.sessions)) {
    const session = store.sessions[key];
    if (session.id !== id) continue;
    store.sessions[key] = { ...session, ...patch, status };
    saveStore(store);
    return store.sessions[key];
  }
  return null;
}

export function recordSettled(
  id: string,
  pulses: number,
  seconds: number,
  totals?: { coins?: number; minutes?: number },
): AirCoinsSession | null {
  const store = loadStore();
  for (const key of Object.keys(store.sessions)) {
    const session = store.sessions[key];
    if (session.id !== id) continue;
    const patch: Partial<AirCoinsSession> = { settledPulses: pulses, settledSeconds: seconds };
    // The running totals a cumulative price needs: what the customer has
    // already been paid for out of this slot, in pesos and minutes.
    if (totals && typeof totals.coins === 'number') patch.coins = Math.max(0, Math.floor(totals.coins));
    if (totals && typeof totals.minutes === 'number') patch.minutes = Math.max(0, Math.floor(totals.minutes));
    store.sessions[key] = { ...session, ...patch };
    saveStore(store);
    return store.sessions[key];
  }
  return null;
}

/** Drops a machine's session, used when the vendo is deleted from the panel. */
export function forgetSession(deviceId: number): void {
  const store = loadStore();
  if (!store.sessions[String(deviceId)]) return;
  delete store.sessions[String(deviceId)];
  saveStore(store);
}

/**
 * Pulses the board says it has taken for the session it is holding. It reports
 * the session id with them, so coins banked before the session opened - or left
 * over from the previous customer - are never credited to this one.
 */
export function livePulses(deviceId: number, sessionId: string): number {
  const status = getStatus(deviceId);
  if (!status || status.sessionId !== sessionId) return 0;
  return Math.max(0, Math.floor(Number(status.sessionPulses) || 0));
}

export interface SessionPreview {
  pulses: number;
  coins: number;
  minutes: number;
  leftover: number;
  /** Names of the rates the coins bought, for the sales ledger. */
  applied: string[];
}

/** What the coins in the slot are worth, priced exactly like a sale. */
export function previewSession(deviceId: number, pulses: number): SessionPreview {
  const settings = getSettings(deviceId);
  const perCoin = Math.max(1, settings.pulsesPerCoin);
  const value = Math.max(1, settings.coinValue);
  const wholeCoins = Math.floor(Math.max(0, pulses) / perCoin);
  const coins = wholeCoins * value;
  const plan = planCoinAllocation(settings.rates, coins);
  return {
    pulses: Math.max(0, Math.floor(pulses)),
    coins,
    minutes: plan.minutes,
    leftover: plan.leftover,
    applied: plan.applied.map((rate) => rate.name),
  };
}
