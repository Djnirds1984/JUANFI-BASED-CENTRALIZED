import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/*
 * AirCoins sub-vendos run our own firmware: there is no web interface on the
 * machine at all. Every operational setting lives here instead, and the vendo
 * pulls its config with a per-device key. The panel is therefore the only place
 * a rate, a coin value or a screen message can be changed - the device itself
 * exposes nothing to configure.
 *
 * JuanFi machines are unaffected: they keep their own admin page and the
 * /api/nodemcu/devices/:id/config + rates routes. This module only describes
 * the AirCoins type.
 */

export interface AirCoinsRate {
  name: string;
  price: number;
  minutes: number;
}

export interface AirCoinsSettings {
  /** Bumped on every save; the machine re-fetches when it changes. */
  version: number;
  /** Secret the machine presents when it pulls config or reports coins. */
  deviceKey: string;
  /**
   * The PC this box sells time to. One coin box sits beside one seat, and the
   * box has no screen to ask which, so the target is set here.
   */
  clientMac: string;
  /** GPIO numbers on the vendo; -1 switches that device off. */
  coinPin: number;
  buzzerPin: number;
  ledPin: number;
  slotLockPin: number;
  /** Pesos credited by one pulse of the coin acceptor. */
  coinValue: number;
  /** Pulses the acceptor sends for a single coin. */
  pulsesPerCoin: number;
  /** How long the slot keeps waiting for more coins before it settles. */
  coinWaitSeconds: number;
  /** Highest amount one sale may reach, 0 = no cap. */
  maxCoins: number;
  /** Pulses without a settled sale before the slot bans itself. */
  abuseCount: number;
  banMinutes: number;
  rates: AirCoinsRate[];
  /** Seconds the slot stays closed after a sale, so the change is noticed. */
  thankYouSeconds: number;
  buzzer: boolean;
  /** Seconds between config pulls. */
  pollSeconds: number;
  /** '' | 'restart' | 'sync' - picked up on the next poll, then acked. */
  pendingCommand: string;
  updatedAt: string;
}

export interface AirCoinsStatus {
  lastSeen: string | null;
  ip: string;
  mac: string;
  firmwareVersion: string;
  uptimeSeconds: number;
  coins: number;
  customers: number;
  routerConnected: boolean;
  freeHeap: number;
  // Coin pulses the acceptor has produced since boot. The panel shows this
  // because it is the only way to tell a dead wire from a refused sale: a
  // machine that never sells but counts pulses has a wiring problem, and one
  // that counts nothing has never seen a coin at all.
  pulses: number;
  bank: number;
  lastCoins: number;
  lastMinutes: number;
  lastRedeemAt: string | null;
  lastError: string;
}

const DEFAULT_RATES: AirCoinsRate[] = [
  { name: '1 peso / 10min', price: 1, minutes: 10 },
  { name: '5 peso / 1hour', price: 5, minutes: 60 },
  { name: '10 peso / 2hours', price: 10, minutes: 120 },
];

const COMMANDS = ['', 'restart', 'sync'];

/** Runtime data lives beside the device registry; tests point this elsewhere. */
export function airCoinsDataDir(): string {
  return process.env.AIRCOINS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}

function settingsFile(): string {
  return path.join(airCoinsDataDir(), 'aircoins-settings.json');
}

function statusFile(): string {
  return path.join(airCoinsDataDir(), 'aircoins-status.json');
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

export function newDeviceKey(): string {
  return crypto.randomBytes(16).toString('hex');
}

function toInt(value: any, fallback: number, min: number, max: number): number {
  const parsed = parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toText(value: any, fallback: string, maxLength: number): string {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function sanitizeRates(value: any, fallback: AirCoinsRate[]): AirCoinsRate[] {
  if (!Array.isArray(value)) return fallback;
  const rates = value
    .map((rate: any) => ({
      name: toText(rate && rate.name, '', 40),
      price: toInt(rate && rate.price, 0, 0, 100000),
      minutes: toInt(rate && rate.minutes, 0, 0, 525600),
    }))
    .filter((rate) => rate.name && rate.price > 0 && rate.minutes > 0)
    .slice(0, 40);
  return rates.length ? rates : fallback;
}

export function defaultSettings(deviceKey = newDeviceKey()): AirCoinsSettings {
  return {
    version: 1,
    deviceKey,
    clientMac: '',
    coinPin: 4,      // NodeMCU D2
    buzzerPin: 14,   // NodeMCU D5
    ledPin: 2,       // NodeMCU D4, onboard LED
    slotLockPin: -1,
    coinValue: 1,
    pulsesPerCoin: 1,
    coinWaitSeconds: 10,
    maxCoins: 0,
    abuseCount: 20,
    banMinutes: 5,
    rates: DEFAULT_RATES.map((rate) => ({ ...rate })),
    thankYouSeconds: 5,
    buzzer: true,
    pollSeconds: 30,
    pendingCommand: '',
    updatedAt: new Date().toISOString(),
  };
}

export function loadAllSettings(): Record<string, AirCoinsSettings> {
  const raw = readJson<Record<string, AirCoinsSettings>>(settingsFile(), {});
  return raw && typeof raw === 'object' ? raw : {};
}

export function getSettings(deviceId: number): AirCoinsSettings {
  const all = loadAllSettings();
  const existing = all[String(deviceId)];
  if (existing && existing.deviceKey) return { ...defaultSettings(existing.deviceKey), ...existing };

  // First look at a machine creates its key, so the operator can copy it to the
  // firmware the moment the device is added.
  const created = defaultSettings();
  all[String(deviceId)] = created;
  writeJson(settingsFile(), all);
  return created;
}

export function saveSettings(deviceId: number, patch: any): AirCoinsSettings {
  const all = loadAllSettings();
  const current = getSettings(deviceId);
  const rates = sanitizeRates(patch && patch.rates, current.rates);
  const next: AirCoinsSettings = {
    ...current,
    clientMac: patch && patch.clientMac !== undefined
      ? normalizeMac(patch.clientMac).slice(0, 12)
      : current.clientMac,
    coinPin: toInt(patch && patch.coinPin, current.coinPin, -1, 16),
    buzzerPin: toInt(patch && patch.buzzerPin, current.buzzerPin, -1, 16),
    ledPin: toInt(patch && patch.ledPin, current.ledPin, -1, 16),
    slotLockPin: toInt(patch && patch.slotLockPin, current.slotLockPin, -1, 16),
    coinValue: toInt(patch && patch.coinValue, current.coinValue, 1, 100000),
    pulsesPerCoin: toInt(patch && patch.pulsesPerCoin, current.pulsesPerCoin, 1, 1000),
    coinWaitSeconds: toInt(patch && patch.coinWaitSeconds, current.coinWaitSeconds, 1, 600),
    maxCoins: toInt(patch && patch.maxCoins, current.maxCoins, 0, 1000000),
    abuseCount: toInt(patch && patch.abuseCount, current.abuseCount, 0, 10000),
    banMinutes: toInt(patch && patch.banMinutes, current.banMinutes, 0, 10080),
    rates,
    thankYouSeconds: toInt(patch && patch.thankYouSeconds, current.thankYouSeconds, 1, 120),
    buzzer: patch && patch.buzzer !== undefined ? !!patch.buzzer : current.buzzer,
    pollSeconds: toInt(patch && patch.pollSeconds, current.pollSeconds, 5, 3600),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  all[String(deviceId)] = next;
  writeJson(settingsFile(), all);
  return next;
}

export function regenerateKey(deviceId: number): AirCoinsSettings {
  const all = loadAllSettings();
  const current = getSettings(deviceId);
  const next = {
    ...current,
    deviceKey: newDeviceKey(),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  all[String(deviceId)] = next;
  writeJson(settingsFile(), all);
  return next;
}

/** Constant-time key check: a vendo key is a bearer credential. */
function keyMatches(candidate: any, expected: string): boolean {
  const supplied = String(candidate || '');
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function findDeviceIdByKey(key: any): number | null {
  if (!key) return null;
  const all = loadAllSettings();
  for (const [id, settings] of Object.entries(all)) {
    if (settings && keyMatches(key, settings.deviceKey)) return parseInt(id, 10);
  }
  return null;
}

export function queueCommand(deviceId: number, command: string): AirCoinsSettings {
  const wanted = COMMANDS.includes(command) ? command : '';
  const all = loadAllSettings();
  const current = getSettings(deviceId);
  const next = {
    ...current,
    pendingCommand: wanted,
    version: wanted ? current.version + 1 : current.version,
    updatedAt: new Date().toISOString(),
  };
  all[String(deviceId)] = next;
  writeJson(settingsFile(), all);
  return next;
}

export function acknowledgeCommand(deviceId: number, command: string): AirCoinsSettings {
  const all = loadAllSettings();
  const current = getSettings(deviceId);
  if (!current.pendingCommand || current.pendingCommand !== command) return current;
  const next = { ...current, pendingCommand: '', updatedAt: new Date().toISOString() };
  all[String(deviceId)] = next;
  writeJson(settingsFile(), all);
  return next;
}

/**
 * The greedy plan the firmware used to run locally: buy the most expensive rate
 * the remaining coins can still pay for, over and over. Keeping it in the panel
 * means a rate change never needs a reflash.
 */
export function planCoinAllocation(rates: AirCoinsRate[], amount: number): {
  minutes: number;
  spent: number;
  leftover: number;
  applied: AirCoinsRate[];
} {
  const usable = (Array.isArray(rates) ? rates : [])
    .filter((rate) => rate && rate.price > 0 && rate.minutes > 0)
    .sort((a, b) => b.price - a.price);
  let remaining = Math.max(0, Math.floor(Number(amount) || 0));
  const applied: AirCoinsRate[] = [];
  let minutes = 0;
  let guard = 0;

  while (usable.length && guard < 100000) {
    guard += 1;
    const rate = usable.find((candidate) => candidate.price <= remaining);
    if (!rate) break;
    applied.push(rate);
    minutes += rate.minutes;
    remaining -= rate.price;
  }

  const spent = Math.max(0, Math.floor(Number(amount) || 0)) - remaining;
  return { minutes, spent, leftover: remaining, applied };
}

export function loadStatus(): Record<string, AirCoinsStatus> {
  const raw = readJson<Record<string, AirCoinsStatus>>(statusFile(), {});
  return raw && typeof raw === 'object' ? raw : {};
}

export function getStatus(deviceId: number): AirCoinsStatus | null {
  return loadStatus()[String(deviceId)] || null;
}

export function recordStatus(deviceId: number, payload: any): AirCoinsStatus {
  const all = loadStatus();
  const current = all[String(deviceId)] || {
    lastSeen: null, ip: '', mac: '', firmwareVersion: '', uptimeSeconds: 0,
    coins: 0, customers: 0, routerConnected: false, freeHeap: 0,
    pulses: 0, bank: 0,
    lastCoins: 0, lastMinutes: 0, lastRedeemAt: null, lastError: '',
  };
  // The machine reports what went wrong on its own side; keep the last message
  // until it either reports another one or a sale clears it.
  const reportedError = toText(payload && payload.lastError, '', 200);
  const next: AirCoinsStatus = {
    ...current,
    lastSeen: new Date().toISOString(),
    ip: toText(payload && payload.ip, current.ip, 40),
    mac: toText(payload && payload.mac, current.mac, 40).toUpperCase(),
    firmwareVersion: toText(payload && payload.firmwareVersion, current.firmwareVersion, 30),
    uptimeSeconds: toInt(payload && payload.uptime, current.uptimeSeconds, 0, 2147483647),
    coins: toInt(payload && payload.coins, current.coins, 0, 2147483647),
    customers: toInt(payload && payload.customers, current.customers, 0, 2147483647),
    routerConnected: payload && payload.routerConnected !== undefined ? !!payload.routerConnected : current.routerConnected,
    freeHeap: toInt(payload && payload.freeHeap, current.freeHeap, 0, 2147483647),
    pulses: toInt(payload && payload.pulses, current.pulses || 0, 0, 2147483647),
    bank: toInt(payload && payload.bank, current.bank || 0, 0, 2147483647),
    lastError: reportedError || current.lastError,
  };
  all[String(deviceId)] = next;
  writeJson(statusFile(), all);
  return next;
}

export function recordRedeem(deviceId: number, coins: number, minutes: number, error = ''): AirCoinsStatus {
  const all = loadStatus();
  const current = getStatus(deviceId) || recordStatus(deviceId, {});
  const next: AirCoinsStatus = {
    ...current,
    lastCoins: coins,
    lastMinutes: minutes,
    lastRedeemAt: new Date().toISOString(),
    lastError: error.slice(0, 200),
  };
  all[String(deviceId)] = next;
  writeJson(statusFile(), all);
  return next;
}

/** A machine is online when it spoke recently enough for its own poll interval. */
export function statusIsOnline(status: AirCoinsStatus | null, pollSeconds: number): boolean {
  if (!status || !status.lastSeen) return false;
  const seen = new Date(status.lastSeen).getTime();
  if (!Number.isFinite(seen)) return false;
  const windowMs = Math.max(180, (Number(pollSeconds) || 30) * 3) * 1000;
  return Date.now() - seen <= windowMs;
}

/*
 * Pairing. A machine that was never registered boots into its own setup access
 * point and asks to be let in: it posts what it is (MAC, address, name) and
 * waits. Nothing is registered until an admin accepts the request, and the
 * device key is only handed out after that - so someone standing next to the
 * vendo cannot join it to the panel on their own.
 */

export interface AirCoinsClaim {
  id: number;
  token: string;
  mac: string;
  ip: string;
  name: string;
  ssid: string;
  firmwareVersion: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  lastSeen: string;
  deviceId: number | null;
}

function claimsFile(): string {
  return path.join(airCoinsDataDir(), 'aircoins-claims.json');
}

export function normalizeMac(value: any): string {
  return String(value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

function writeClaims(claims: AirCoinsClaim[]): void {
  writeJson(claimsFile(), claims);
}

function pruneClaims(claims: AirCoinsClaim[]): AirCoinsClaim[] {
  const now = Date.now();
  const kept = claims.filter((claim) => {
    if (claim.status !== 'rejected') return true;
    const asked = new Date(claim.requestedAt).getTime();
    return Number.isFinite(asked) && now - asked < 60 * 60 * 1000;
  });
  return kept.slice(-100);
}

export function loadClaims(): AirCoinsClaim[] {
  const raw = readJson<AirCoinsClaim[]>(claimsFile(), []);
  if (!Array.isArray(raw)) return [];
  return raw.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
}

export function findClaim(id: number): AirCoinsClaim | null {
  return loadClaims().find((claim) => claim.id === id) || null;
}

export function findClaimByToken(token: any): AirCoinsClaim | null {
  const wanted = String(token || '');
  if (!wanted) return null;
  return loadClaims().find((claim) => claim.token === wanted) || null;
}

/**
 * Record a pairing request. A machine repeats this while it waits, so the same
 * MAC keeps its claim (and its token) instead of filling the list with copies.
 */
export function submitClaim(payload: any): AirCoinsClaim {
  const mac = normalizeMac(payload && payload.mac);
  if (!mac) throw new Error('mac is required');
  const now = new Date().toISOString();
  const claims = loadClaims();
  const existing = claims.find((claim) => claim.mac === mac && claim.status !== 'rejected');

  if (existing) {
    existing.ip = toText(payload.ip, existing.ip, 40);
    existing.name = toText(payload.name, existing.name, 40);
    existing.ssid = toText(payload.ssid, existing.ssid, 33);
    existing.firmwareVersion = toText(payload.firmwareVersion, existing.firmwareVersion, 30);
    existing.lastSeen = now;
    writeClaims(pruneClaims(claims));
    return existing;
  }

  const claim: AirCoinsClaim = {
    id: claims.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    token: crypto.randomBytes(16).toString('hex'),
    mac,
    ip: toText(payload.ip, '', 40),
    name: toText(payload.name, 'AirCoins Vendo', 40),
    ssid: toText(payload.ssid, '', 33),
    firmwareVersion: toText(payload.firmwareVersion, '', 30),
    status: 'pending',
    requestedAt: now,
    lastSeen: now,
    deviceId: null,
  };
  claims.push(claim);
  writeClaims(pruneClaims(claims));
  return claim;
}

export function approveClaim(id: number, deviceId: number): AirCoinsClaim | null {
  const claims = loadClaims();
  const claim = claims.find((item) => item.id === id);
  if (!claim) return null;
  claim.status = 'approved';
  claim.deviceId = deviceId;
  claim.lastSeen = new Date().toISOString();
  writeClaims(pruneClaims(claims));
  return claim;
}

export function rejectClaim(id: number): AirCoinsClaim | null {
  const claims = loadClaims();
  const claim = claims.find((item) => item.id === id);
  if (!claim) return null;
  claim.status = 'rejected';
  claim.lastSeen = new Date().toISOString();
  writeClaims(pruneClaims(claims));
  return claim;
}
