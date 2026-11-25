import { getDb } from '../database';
import { mikroTikService } from './mikrotik';
import { sendDisconnectRequest, logRadiusEvent, isRadiusRunning } from './radiusServer';

/*
 * Zero-time enforcement.
 *
 * RADIUS only reads an account when a device logs in: it hands the router a
 * Session-Timeout and never looks at `expiry_at` again. So an account that runs
 * out - or one the operator deletes - keeps surfing until that granted time
 * drains, which is how a device shows "0 time" in the panel while still
 * downloading from the internet (a 2-hour free trial makes that window huge).
 *
 * This sweep makes the router agree with the panel within one tick: every live
 * session whose account has expired, was deleted, or is disabled is dropped.
 * The device then re-authenticates, gets the ordinary one-shot expired grace
 * (just enough to reach the portal) and is rejected after that.
 *
 * It is idempotent and cheap: only accounts that already have an `expiry_at`
 * are considered, so voucher accounts (governed by limit-uptime on the router)
 * and accounts without time tracking are never touched.
 */

const KICK_COOLDOWN_MS = 5 * 60 * 1000;

/** `claimed_at`/`expiry_at` text (`YYYY-MM-DD HH:MM:SS`, UTC) -> epoch ms. */
export function accountExpiryMs(expiryAt: any): number | null {
  const text = String(expiryAt ?? '').trim();
  if (!text) return null;
  const ms = new Date(text.replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** True when the account's paid time ended at or before `nowMs`. */
export function isAccountExpired(expiryAt: any, nowMs: number = Date.now()): boolean {
  const ms = accountExpiryMs(expiryAt);
  return ms !== null && ms <= nowMs;
}

/** MAC-shaped usernames compare equal in any separator/case. */
export function identityKey(value: any): string {
  const compact = String(value ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return compact.length === 12 ? compact : String(value ?? '').trim().toUpperCase();
}

export interface ExpirySweepReport {
  checked: number;
  expired: number;
  kicked: number;
  pending: number;
  details: Array<{ routerId: number; username: string; sessionId: string; ok: boolean; reason: string }>;
}

// A Disconnect-Request is fire-and-forget UDP: retrying it every tick would
// flood the NAS without proving anything, so one attempt per session every few
// minutes is enough for the accounting STOP to arrive.
const lastKickAt = new Map<string, number>();

function cooldownPassed(key: string, nowMs: number): boolean {
  const previous = lastKickAt.get(key);
  if (previous !== undefined && nowMs - previous < KICK_COOLDOWN_MS) return false;
  lastKickAt.set(key, nowMs);
  return true;
}

/**
 * One pass. `onlyRouterId` is for the panel's manual "enforce now" action;
 * the timer always runs it for every active router.
 */
export async function runHotspotExpirySweep(now: Date = new Date(), onlyRouterId?: number): Promise<ExpirySweepReport> {
  const db = getDb();
  const report: ExpirySweepReport = { checked: 0, expired: 0, kicked: 0, pending: 0, details: [] };
  const nowMs = now.getTime();

  let routers: any[] = [];
  try {
    routers = onlyRouterId
      ? (db.prepare('SELECT id, host FROM routers WHERE is_active = 1 AND id = ?').all(onlyRouterId) as any[])
      : (db.prepare('SELECT id, host FROM routers WHERE is_active = 1').all() as any[]);
  } catch (err) {
    console.error('[expiry] could not read routers:', (err as Error).message);
    return report;
  }

  // Accounts that exist somewhere (any router - a centralized account can
  // authenticate on any NAS), so a live session with no account at all can be
  // recognised as orphaned rather than as "someone else's" account.
  const knownAccounts = new Set<string>();
  // MACs whose account is currently disabled (paused/logged out): a live
  // session for one of these must not stay online either.
  const blockedAccounts = new Set<string>();
  try {
    for (const row of db.prepare('SELECT username, disabled FROM hotspot_users').all() as any[]) {
      const key = identityKey(row.username);
      if (!key) continue;
      if (Number(row.disabled) === 1) blockedAccounts.add(key);
      else knownAccounts.add(key);
    }
  } catch (err) {
    console.error('[expiry] could not read hotspot_users:', (err as Error).message);
  }

  for (const router of routers) {
    const routerId = Number(router.id);
    const nasIp = String(router.host || '').split(':')[0];
    let accounts: any[] = [];
    try {
      accounts = db.prepare(
        `SELECT id, username, expiry_at, disabled
         FROM hotspot_users WHERE router_id = ? AND expiry_at IS NOT NULL AND expiry_at <> ''`
      ).all(routerId) as any[];
    } catch (err) {
      console.error(`[expiry] could not read accounts for router ${routerId}:`, (err as Error).message);
      continue;
    }

    const expiredKeys = new Map<string, string>(); // identity -> expiry_at text
    for (const account of accounts) {
      if (!isAccountExpired(account.expiry_at, nowMs)) continue;
      const key = identityKey(account.username);
      if (key) expiredKeys.set(key, String(account.expiry_at));
    }
    report.expired += expiredKeys.size;

    let sessions: any[] = [];
    try {
      sessions = db.prepare(
        `SELECT id, username, session_id FROM radius_sessions
         WHERE router_id = ? AND status = 'active'`
      ).all(routerId) as any[];
    } catch (err) {
      console.error(`[expiry] could not read radius_sessions for router ${routerId}:`, (err as Error).message);
    }

    // The router's own active list covers sessions whose Accounting-Start never
    // reached us (RADIUS restart mid-login, lost UDP).
    let liveOnRouter: any[] = [];
    const needsRouterList = expiredKeys.size > 0 || blockedAccounts.size > 0;
    if (needsRouterList && mikroTikService.isConnected(routerId)) {
      try {
        liveOnRouter = await mikroTikService.getActiveConnections(routerId);
      } catch (err) {
        console.error(`[expiry] could not read active sessions from router ${routerId}:`, (err as Error).message);
      }
    }

    const targets = new Map<string, { username: string; sessionId: string; reason: string }>();

    for (const session of sessions) {
      const username = String(session.username || '');
      const key = identityKey(username);
      if (!key) continue;
      const expiryAt = expiredKeys.get(key);
      const orphan = !knownAccounts.has(key) && !blockedAccounts.has(key);
      const reason = expiryAt
        ? `account expired at ${expiryAt}`
        : blockedAccounts.has(key)
          ? 'account disabled'
          : orphan
            ? 'no account for this session (deleted)'
            : '';
      if (!reason) continue;
      targets.set(`${username.toLowerCase()}|${session.session_id}`, {
        username,
        sessionId: String(session.session_id || ''),
        reason,
      });
    }

    for (const conn of Array.isArray(liveOnRouter) ? liveOnRouter : []) {
      const username = String((conn as any).user || '');
      const key = identityKey(username);
      if (!key) continue;
      const expiryAt = expiredKeys.get(key);
      const reason = expiryAt
        ? `account expired at ${expiryAt}`
        : blockedAccounts.has(key)
          ? 'account disabled'
          : '';
      if (!reason) continue;
      // A session the router knows about but radius_sessions does not: kick it
      // through the API by username (no Acct-Session-Id to address it with).
      targets.set(`${username.toLowerCase()}|router`, {
        username,
        sessionId: String((conn as any)['.id'] || ''),
        reason,
      });
    }

    for (const target of targets.values()) {
      report.checked++;
      const cooldownKey = `${routerId}:${target.username.toLowerCase()}`;
      if (!cooldownPassed(cooldownKey, nowMs)) continue;

      let ok = false;
      if (target.sessionId && !target.sessionId.startsWith('*') && isRadiusRunning() && nasIp) {
        sendDisconnectRequest(routerId, target.sessionId, nasIp, target.username);
        ok = true;
      }
      if (!ok && mikroTikService.isConnected(routerId)) {
        try {
          ok = await mikroTikService.kickActiveSession(routerId, { username: target.username });
        } catch (err) {
          console.error(`[expiry] could not kick ${target.username} on router ${routerId}:`, (err as Error).message);
        }
      }

      if (ok) report.kicked++;
      else report.pending++;
      report.details.push({ routerId, username: target.username, sessionId: target.sessionId, ok, reason: target.reason });

      if (ok) {
        logRadiusEvent('accounting', `Expiry kick: ${target.reason} - session dropped`, routerId, target.username, nasIp);
        console.log(`[expiry] kicked ${target.username} on router ${routerId}: ${target.reason}`);
      }
    }
  }

  if (report.kicked || report.pending) {
    console.log(`[expiry] sweep: ${report.expired} expired account(s), ${report.kicked} kicked, ${report.pending} pending`);
  }
  return report;
}

let sweepInterval: NodeJS.Timeout | null = null;
let sweepInFlight = false;

export function startHotspotExpirySweep(intervalSeconds = 30): void {
  stopHotspotExpirySweep();

  const seconds = Math.max(10, intervalSeconds || 30);
  console.log(`Starting hotspot expiry sweep (every ${seconds}s)`);

  sweepInterval = setInterval(() => {
    if (sweepInFlight) return; // previous pass still running - skip this tick
    sweepInFlight = true;
    runHotspotExpirySweep()
      .catch((err) => console.error('Hotspot expiry sweep failed:', (err as Error).message))
      .finally(() => {
        sweepInFlight = false;
      });
  }, seconds * 1000);
}

export function stopHotspotExpirySweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
  sweepInFlight = false;
  lastKickAt.clear();
}
