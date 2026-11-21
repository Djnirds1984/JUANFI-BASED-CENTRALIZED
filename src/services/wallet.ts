import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../database';
import { config } from '../config';

/*
 * Customer wallet: the money rules live here, the HTTP shape lives in
 * src/api/wallet.ts.
 *
 * Two invariants everything else depends on:
 *
 * 1. Money is INTEGER centavos (1 peso = 100) and never a float. Every amount
 *    that arrives from a browser is converted once, at the edge, and rejected
 *    if it is not a whole number of centavos.
 * 2. wallet_accounts.balance_centavos is only ever changed through
 *    credit()/debit() below, which write an append-only wallet_transactions row
 *    with the resulting balance. So the ledger always explains the balance, and
 *    a retried request cannot double-spend: the reference column is UNIQUE.
 */

export const PESO = 100;

export interface WalletSettings {
  enabled: boolean;
  coin_value_centavos: number;
  min_topup_centavos: number;
  max_topup_centavos: number;
  min_convert_centavos: number;
  daily_convert_centavos: number;
  require_verification: boolean;
  topup_validity_min: number;
  updated_at: string | null;
}

export interface WalletTokenPayload {
  scope: 'wallet';
  accountId: number;
  email: string;
  /** Bumped on password change / freeze so old tokens stop working. */
  epoch: number;
}

function asInt(value: any, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

export function getWalletSettings(): WalletSettings {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO wallet_settings (id) VALUES (1)').run();
  const row = db.prepare('SELECT * FROM wallet_settings WHERE id = 1').get() as any;
  return {
    enabled: Number(row?.enabled) === 1,
    coin_value_centavos: asInt(row?.coin_value_centavos, PESO),
    min_topup_centavos: asInt(row?.min_topup_centavos, PESO),
    max_topup_centavos: asInt(row?.max_topup_centavos, 500000),
    min_convert_centavos: asInt(row?.min_convert_centavos, PESO),
    daily_convert_centavos: asInt(row?.daily_convert_centavos, 0),
    require_verification: Number(row?.require_verification) === 1,
    topup_validity_min: asInt(row?.topup_validity_min, 15),
    updated_at: row?.updated_at || null,
  };
}

// Only these columns are writable, and each is coerced to an integer, so a
// crafted request body can never point the UPDATE at another column or store
// text in a money field.
const SETTINGS_LIMITS: Record<string, [number, number]> = {
  coin_value_centavos: [1, 1000000],
  min_topup_centavos: [0, 10000000],
  max_topup_centavos: [100, 100000000],
  min_convert_centavos: [0, 10000000],
  daily_convert_centavos: [0, 100000000],
  topup_validity_min: [1, 240],
};

export function saveWalletSettings(patch: any): WalletSettings {
  const db = getDb();
  getWalletSettings();
  const sets: string[] = [];
  const values: any[] = [];

  if (patch?.enabled !== undefined) { sets.push('enabled = ?'); values.push(patch.enabled ? 1 : 0); }
  if (patch?.require_verification !== undefined) {
    sets.push('require_verification = ?');
    values.push(patch.require_verification ? 1 : 0);
  }
  for (const [column, [min, max]] of Object.entries(SETTINGS_LIMITS)) {
    if (patch?.[column] === undefined || patch?.[column] === '') continue;
    const n = asInt(patch[column], NaN);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw Object.assign(new Error(`${column} must be between ${min} and ${max}`), { status: 400 });
    }
    sets.push(`${column} = ?`);
    values.push(n);
  }

  if (sets.length) {
    db.prepare(`UPDATE wallet_settings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = 1`)
      .run(...values);
  }
  return getWalletSettings();
}

// ---------------------------------------------------------------------------
// Input validation (shared by register / admin create)
// ---------------------------------------------------------------------------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: any): string {
  return String(value || '').trim().toLowerCase().slice(0, 120);
}

export function validateRegistration(input: any): { error: string } | null {
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || '');
  const pin = String(input?.pin || '');
  const name = String(input?.full_name || '').trim();
  const mobile = String(input?.mobile || '').trim();

  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address' };
  if (password.length < 6 || password.length > 72) return { error: 'Password must be 6-72 characters' };
  if (pin && !/^\d{4}$/.test(pin)) return { error: 'Wallet PIN must be exactly 4 digits' };
  if (name.length > 60) return { error: 'Name is too long' };
  if (mobile && !/^[0-9+\-\s()]{4,20}$/.test(mobile)) return { error: 'Enter a valid mobile number' };
  return null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function signClientToken(account: { id: number; email: string; token_epoch: number }): string {
  const payload: WalletTokenPayload = {
    scope: 'wallet',
    accountId: account.id,
    email: account.email,
    epoch: account.token_epoch || 0,
  };
  return jwt.sign(payload, config.clientJwtSecret, { expiresIn: config.clientTokenTtl } as jwt.SignOptions);
}

/**
 * Verify a customer token and re-check it against the row. A token is only good
 * while the account exists, is active and still on the same token_epoch, so
 * freezing an account or resetting its password signs the customer out.
 */
export function verifyClientToken(token: string): WalletTokenPayload | null {
  let payload: WalletTokenPayload;
  try {
    payload = jwt.verify(token, config.clientJwtSecret) as WalletTokenPayload;
  } catch {
    return null;
  }
  if (!payload || payload.scope !== 'wallet' || !payload.accountId) return null;

  const row = getDb()
    .prepare('SELECT id, email, status, verified, token_epoch FROM wallet_accounts WHERE id = ?')
    .get(payload.accountId) as any;
  if (!row || row.status !== 'active') return null;
  if (Number(row.token_epoch || 0) !== Number(payload.epoch || 0)) return null;
  return { scope: 'wallet', accountId: row.id, email: row.email, epoch: Number(row.token_epoch || 0) };
}

export function revokeWalletSessions(accountId: number): void {
  getDb().prepare('UPDATE wallet_accounts SET token_epoch = token_epoch + 1 WHERE id = ?').run(accountId);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function findAccountByEmail(email: string): any {
  return getDb().prepare('SELECT * FROM wallet_accounts WHERE email = ?').get(normalizeEmail(email)) as any;
}

export function findAccountById(id: number): any {
  return getDb().prepare('SELECT * FROM wallet_accounts WHERE id = ?').get(id) as any;
}

export function publicAccount(account: any) {
  return {
    id: account.id,
    email: account.email,
    full_name: account.full_name,
    mobile: account.mobile,
    // Centavos for anything computing with it, pesos for anything showing it.
    balance_centavos: Number(account.balance_centavos || 0),
    balance: Number(account.balance_centavos || 0) / PESO,
    status: account.status,
    verified: Number(account.verified) === 1,
    has_pin: !!account.pin_hash,
    created_at: account.created_at,
    last_login_at: account.last_login_at,
  };
}

export async function createAccount(input: {
  email: string;
  password: string;
  pin?: string;
  full_name?: string;
  mobile?: string;
  mac?: string;
  routerId?: number;
  verified?: boolean;
}): Promise<any> {
  const db = getDb();
  const email = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const pinHash = input.pin ? await bcrypt.hash(String(input.pin), 10) : '';
  const mac = normalizeMac(input.mac);

  const info = db.prepare(
    `INSERT INTO wallet_accounts (email, password_hash, pin_hash, full_name, mobile, verified, registered_mac, registered_router_id, last_mac)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    email,
    passwordHash,
    pinHash,
    String(input.full_name || '').trim().slice(0, 60),
    String(input.mobile || '').trim().slice(0, 20),
    input.verified === false ? 0 : 1,
    mac,
    asInt(input.routerId, 0),
    mac,
  );

  const account = findAccountById(Number(info.lastInsertRowid));
  if (mac) touchDevice(account.id, mac, asInt(input.routerId, 0));
  return account;
}

/** Normalize any MAC spelling to aa:bb:cc:dd:ee:ff (chat/thread identity form). */
export function normalizeMac(value: any): string {
  const hex = String(value || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return '';
  return hex.match(/.{2}/g)!.join(':');
}

export function touchDevice(accountId: number, mac: string, routerId: number): void {
  if (!mac) return;
  const db = getDb();
  db.prepare(
    `INSERT INTO wallet_devices (account_id, mac, router_id) VALUES (?, ?, ?)
     ON CONFLICT(account_id, mac) DO UPDATE SET last_seen = datetime('now'), router_id = excluded.router_id`
  ).run(accountId, mac, asInt(routerId, 0));
}

/**
 * True when this device has used the account before. Password-restore codes are
 * only delivered to a recognized device, because the code lands in that
 * device's own portal chat - otherwise anyone could reset anyone's account by
 * typing their email.
 */
export function isKnownDevice(account: any, mac: string): boolean {
  if (!mac) return false;
  const db = getDb();
  const linked = db
    .prepare('SELECT 1 AS ok FROM wallet_devices WHERE account_id = ? AND mac = ? LIMIT 1')
    .get(account.id, mac) as any;
  if (linked) return true;
  const registered = normalizeMac(account.registered_mac) || normalizeMac(account.last_mac);
  return !!registered && registered === mac;
}

export async function authenticateAccount(
  email: string,
  password: string,
  mac: string,
  routerId: number,
): Promise<{ token?: string; account?: any; error?: string }> {
  const db = getDb();
  const account = findAccountByEmail(email);

  // Same message whether or not the address exists - the portal must not
  // become a way to find out who has a wallet.
  const invalid = { error: 'Wrong email or password' };
  if (!account) return invalid;

  if (account.status !== 'active') return { error: 'This account is frozen. Please see an agent.' };
  if (account.locked_until && new Date(String(account.locked_until).replace(' ', 'T') + 'Z') > new Date()) {
    return { error: 'Too many failed attempts. Try again in a few minutes.' };
  }

  const ok = await bcrypt.compare(password, account.password_hash);
  if (!ok) {
    // 5 wrong tries lock the account for 15 minutes; brute-forcing a 6-char
    // password over the LAN must not be free.
    const fails = Number(account.failed_logins || 0) + 1;
    const lock = fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19) : null;
    db.prepare('UPDATE wallet_accounts SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .run(lock ? 0 : fails, lock, account.id);
    return lock ? { error: 'Too many failed attempts. Account locked for 15 minutes.' } : invalid;
  }

  db.prepare(
    `UPDATE wallet_accounts SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now'),
       last_mac = CASE WHEN ? <> '' THEN ? ELSE last_mac END, updated_at = datetime('now')
     WHERE id = ?`
  ).run(mac || '', mac || '', account.id);
  touchDevice(account.id, mac, routerId);

  const fresh = findAccountById(account.id);
  return { token: signClientToken(fresh), account: fresh };
}

export async function verifyPin(account: any, pin: any): Promise<boolean> {
  if (!account.pin_hash) return true;
  const value = String(pin || '');
  if (!/^\d{4}$/.test(value)) return false;
  return bcrypt.compare(value, account.pin_hash);
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface LedgerArgs {
  accountId: number;
  kind: string;
  amountCentavos: number;
  reference: string;
  minutes?: number;
  macAddress?: string;
  deviceId?: number | null;
  deviceName?: string;
  note?: string;
  createdBy?: string;
}

/**
 * Add money. Call inside a transaction when it must commit alongside another
 * write (that is what grantMinutesToMac's insideTx hook is for).
 */
export function credit(db: any, args: LedgerArgs): any {
  return postEntry(db, args, Math.abs(asInt(args.amountCentavos, 0)));
}

/** Spend money. Throws with .status 400 when the balance cannot cover it. */
export function debit(db: any, args: LedgerArgs): any {
  const amount = Math.abs(asInt(args.amountCentavos, 0));
  if (amount <= 0) throw Object.assign(new Error('Enter an amount'), { status: 400 });
  const account = db.prepare('SELECT balance_centavos FROM wallet_accounts WHERE id = ?').get(args.accountId) as any;
  if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (Number(account.balance_centavos) < amount) {
    throw Object.assign(new Error('Insufficient wallet balance'), { status: 400 });
  }
  return postEntry(db, args, -amount);
}

function postEntry(db: any, args: LedgerArgs, signedAmount: number): any {
  const account = db.prepare('SELECT balance_centavos FROM wallet_accounts WHERE id = ?').get(args.accountId) as any;
  if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  const balanceAfter = Number(account.balance_centavos) + signedAmount;
  if (balanceAfter < 0) {
    throw Object.assign(new Error('Insufficient wallet balance'), { status: 400 });
  }

  const info = db.prepare(
    `INSERT INTO wallet_transactions
       (account_id, kind, amount_centavos, balance_after, minutes, mac_address, device_id, device_name, reference, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.accountId,
    args.kind,
    signedAmount,
    balanceAfter,
    Math.max(0, asInt(args.minutes, 0)),
    args.macAddress || '',
    args.deviceId ?? null,
    args.deviceName || '',
    args.reference,
    String(args.note || '').slice(0, 300),
    args.createdBy || 'portal',
  );

  db.prepare(
    "UPDATE wallet_accounts SET balance_centavos = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(balanceAfter, args.accountId);

  return db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(info.lastInsertRowid) as any;
}

/** Pesos already spent from the wallet today (UTC, matching datetime('now')). */
export function spentTodayCentavos(accountId: number): number {
  const row = getDb().prepare(
    `SELECT COALESCE(SUM(-amount_centavos), 0) AS spent FROM wallet_transactions
     WHERE account_id = ? AND amount_centavos < 0 AND kind <> 'admin_debit' AND date(created_at) = date('now')`
  ).get(accountId) as any;
  return Number(row?.spent || 0);
}

// ---------------------------------------------------------------------------
// One-shot codes (password restore, later email verification)
// ---------------------------------------------------------------------------

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Codes are 6 digits so they can be read over the counter or typed on a phone,
 * and they are single-use, device-bound and short-lived. Only the hash is
 * stored, so a database copy cannot be used to take over accounts.
 */
export function issueAuthCode(accountId: number, purpose: string, deviceMac: string, ttlMinutes: number): string {
  const db = getDb();
  // Invalidate anything outstanding for this account + purpose first.
  db.prepare('UPDATE wallet_auth_codes SET used_at = datetime(\'now\') WHERE account_id = ? AND purpose = ? AND used_at IS NULL')
    .run(accountId, purpose);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    'INSERT INTO wallet_auth_codes (account_id, purpose, code_hash, device_mac, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(accountId, purpose, sha256(code), deviceMac || '', expires);
  return code;
}

export function peekAuthCode(accountId: number, purpose: string): any {
  return getDb().prepare(
    `SELECT * FROM wallet_auth_codes
     WHERE account_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now')
     ORDER BY id DESC LIMIT 1`
  ).get(accountId, purpose) as any;
}

/** Returns the matching live code row, or null. Consumes nothing by itself. */
export function matchAuthCode(accountId: number, purpose: string, code: string, deviceMac: string): any {
  const row = peekAuthCode(accountId, purpose);
  if (!row) return null;
  if (row.device_mac && deviceMac && row.device_mac !== deviceMac) return null;
  if (!row.device_mac && deviceMac) return null;
  const candidate = String(code || '').trim();
  if (!candidate) return null;
  return sha256(candidate) === row.code_hash ? row : null;
}

export function consumeAuthCode(codeId: number): void {
  getDb().prepare("UPDATE wallet_auth_codes SET used_at = datetime('now') WHERE id = ?").run(codeId);
}

// ---------------------------------------------------------------------------
// Top-up sessions
// ---------------------------------------------------------------------------

export function makeTopupCode(): string {
  // The machine treats this as a hotspot username, so: no spaces, no commas,
  // short, and unguessable. 'W' marks it as a wallet session in the router list.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = 'W';
  const bytes = crypto.randomBytes(9);
  for (let i = 0; i < 9; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function getTopupByCode(code: string): any {
  return getDb().prepare('SELECT * FROM wallet_topup_sessions WHERE code = ?').get(String(code || '').trim().toUpperCase()) as any;
}

export function listOpenTopups(accountId: number): any[] {
  return getDb().prepare(
    `SELECT * FROM wallet_topup_sessions
     WHERE account_id = ? AND status IN ('open', 'settled') ORDER BY id DESC LIMIT 5`
  ).all(accountId) as any[];
}

// ---------------------------------------------------------------------------
// Small in-process limiter (same shape the chat endpoints use)
// ---------------------------------------------------------------------------

const buckets = new Map<string, number[]>();

export function allowRate(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] > 600000) buckets.delete(k);
    }
  }
  return true;
}

/** Parse a peso amount from a user into whole centavos. Null when unusable. */
export function pesosToCentavos(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const centavos = Math.round(n * PESO);
  return centavos > 0 ? centavos : null;
}
