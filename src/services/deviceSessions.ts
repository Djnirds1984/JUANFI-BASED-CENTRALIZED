import crypto from 'crypto';
import { getDb } from '../database';
import { mikroTikService } from './mikrotik';

/**
 * Roaming device sessions.
 *
 * One row per browser (`session_token`, never expires) with the *current* MAC
 * binding. When the phone roams to another SSID of the hotspot system the
 * portal posts the token + new MAC, we re-bind, kick the old live session and
 * restore the remaining time by setting `limit-uptime` on the hotspot user.
 */

const TOKEN_BYTES = 24; // 192-bit token -> 48 hex chars

const nowStamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function generateSessionToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

export function normalizeMac(raw: any): string {
  return String(raw || '').trim().toLowerCase().replace(/-/g, ':');
}

export function isValidToken(token: any): token is string {
  return typeof token === 'string' && /^[a-f0-9]{48}$/.test(token);
}

/** MikroTik time (`00:45:10`, `1d02:30:00`, `infinity`, ``) -> seconds. */
export function mikrotikTimeToSeconds(value: any): number {
  const str = String(value || '').trim().toLowerCase();
  if (!str || str === 'infinity' || str === 'unlimited') return Infinity;

  const daysMatch = str.match(/^(\d+)d/);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 0;

  const clock = str.includes(':') ? str.slice(str.indexOf(':') - 2) : str;
  const parts = clock.split(':').map((p) => parseInt(p, 10) || 0);
  let seconds = days * 86400;
  if (parts.length === 3) seconds += parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds += parts[0] * 60 + parts[1];
  else if (parts.length === 1 && !daysMatch) seconds += parts[0] || 0;
  return seconds;
}

/** Seconds -> MikroTik `limit-uptime` value (`00:45:10` / `1d02:30:00`). */
export function secondsToLimitUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const clock = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return days > 0 ? `${days}d${clock}` : clock;
}

/** Voucher / hotspot-user credentials so the portal can log back in silently. */
function lookupCredentials(username: string): { password: string | null; profile: string | null } {
  const db = getDb();
  const voucher = db
    .prepare('SELECT password, profile FROM vouchers WHERE username = ? ORDER BY id DESC LIMIT 1')
    .get(username) as any;
  if (voucher) return { password: voucher.password || null, profile: voucher.profile || null };

  const user = db
    .prepare('SELECT password, profile FROM hotspot_users WHERE username = ? ORDER BY id DESC LIMIT 1')
    .get(username) as any;
  if (user) return { password: user.password || null, profile: user.profile || null };

  return { password: null, profile: null };
}

/**
 * A MAC can only be bound to one session. If another session currently owns it
 * (e.g. the device logged in with a fresh browser on this SSID), unbind that
 * session instead of failing on the unique index.
 */
function freeMac(routerId: number, mac: string, exceptSessionId: number): void {
  if (!mac) return;
  const db = getDb();
  const holder = db
    .prepare('SELECT id FROM device_sessions WHERE router_id = ? AND mac_address = ? AND id <> ?')
    .get(routerId, mac, exceptSessionId) as any;
  if (holder) {
    db.prepare("UPDATE device_sessions SET mac_address = '', previous_mac = ?, last_seen = ? WHERE id = ?")
      .run(mac, nowStamp(), holder.id);
  }
}

export interface SessionInitResult {
  token: string;
  created: boolean;
}

/** First visit of a device: issue (or reuse) its permanent token. */
export function initSession(params: { mac: any; ip?: string; server?: string; routerId?: number }): SessionInitResult {
  const db = getDb();
  const routerId = params.routerId || 1;
  const mac = normalizeMac(params.mac);
  const now = nowStamp();

  if (mac) {
    const existing = db
      .prepare('SELECT session_token FROM device_sessions WHERE router_id = ? AND mac_address = ?')
      .get(routerId, mac) as any;
    if (existing) {
      db.prepare('UPDATE device_sessions SET last_seen = ? WHERE id = (SELECT id FROM device_sessions WHERE session_token = ?)')
        .run(now, existing.session_token);
      return { token: existing.session_token, created: false };
    }
  }

  const token = generateSessionToken();
  try {
    db.prepare(
      `INSERT INTO device_sessions (session_token, mac_address, router_id, hotspot_server, status, first_seen, last_seen)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).run(token, mac, routerId, params.server || '', now, now);
  } catch (err) {
    // Lost a race with a concurrent init for the same MAC - reuse the winner.
    const existing = mac
      ? (db.prepare('SELECT session_token FROM device_sessions WHERE router_id = ? AND mac_address = ?').get(routerId, mac) as any)
      : null;
    if (existing) return { token: existing.session_token, created: false };
    throw err;
  }

  return { token, created: true };
}

/** Look up a session by its (never expiring) token. */
export function getSessionByToken(token: any): any | null {
  if (!isValidToken(token)) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM device_sessions WHERE session_token = ?').get(token) as any;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null; // defensive: tokens are non-expiring
  return row;
}

export interface RestoreResult {
  restore: boolean;
  reason?: string;
  username?: string;
  password?: string | null;
  remaining?: number;
  rebind?: boolean;
  token?: string;
}

/**
 * Find the best live session for a username (used when the browser token was
 * lost on SSID switch — e.g. captive-portal mini-browser with isolated
 * storage — but the device already authenticated on another SSID/MAC).
 */
export function findSessionByUsername(username: string, routerId?: number): any | null {
  const name = String(username || '').trim();
  if (!name) return null;
  const db = getDb();
  const rows = (
    routerId
      ? db
          .prepare(
            `SELECT * FROM device_sessions WHERE username = ? AND router_id = ?
             ORDER BY is_online DESC, last_seen DESC, id DESC LIMIT 5`
          )
          .all(name, routerId)
      : db
          .prepare(
            `SELECT * FROM device_sessions WHERE username = ?
             ORDER BY is_online DESC, last_seen DESC, id DESC LIMIT 5`
          )
          .all(name)
  ) as any[];
  // Prefer a row that actually still has time left.
  return (
    rows.find((r) => Number(r.remaining_seconds) > 0) ||
    rows[0] ||
    null
  );
}

/**
 * Roam restore: the portal presents the cookie token (possibly from another
 * SSID, with a new MAC). We re-bind, kick the old live session and set
 * `limit-uptime` so the new login starts with the tracked remaining time.
 */
export async function restoreSession(params: {
  token: any;
  mac: any;
  ip?: string;
  server?: string;
  routerId?: number;
  username?: any;
}): Promise<RestoreResult> {
  let session = getSessionByToken(params.token);
  // Fallback: token cookie was lost on SSID switch (captive-portal browsers
  // isolate storage per SSID) but the user re-entered the same voucher.
  if (!session && params.username) {
    const r = Number(params.routerId) || 1;
    session = findSessionByUsername(params.username, r) || findSessionByUsername(params.username);
  }
  if (!session) return { restore: false, reason: 'unknown-token' };
  if (!session.username) return { restore: false, reason: 'never-logged-in' };
  if (session.status === 'expired' || session.remaining_seconds <= 0) {
    return { restore: false, reason: 'no-time-remaining', username: session.username };
  }

  const routerId = params.routerId || session.router_id;
  const newMac = normalizeMac(params.mac);
  const oldMac = session.mac_address;
  const rebind = !!newMac && !!oldMac && newMac !== oldMac;

  if (mikroTikService.isConnected(routerId)) {
    // 1) free the shared-users slot - the old session may still be live on SSID-A
    try {
      await mikroTikService.kickActiveSession(routerId, { mac: oldMac, username: session.username });
    } catch (err) {
      console.error(`restoreSession kick failed for session ${session.id}:`, (err as Error).message);
    }

    // 2) the next login must start with the remaining time. IMPORTANT:
    // `limit-uptime` is measured against the user's *accumulated* uptime, so
    // reset the counters first — otherwise the already-used time is subtracted
    // AGAIN from the new limit and the user loses time on every roam.
    try {
      await mikroTikService.resetHotspotUserCounters(routerId, session.username);
      const applied = await mikroTikService.setUserUptimeLimit(
        routerId,
        session.username,
        secondsToLimitUptime(session.remaining_seconds)
      );
      if (!applied) console.warn(`restoreSession: user ${session.username} not found on router ${routerId}`);
    } catch (err) {
      console.error(`restoreSession limit-uptime failed for session ${session.id}:`, (err as Error).message);
    }
  }

  const db = getDb();
  const now = nowStamp();
  try {
    const apply = db.transaction(() => {
      freeMac(routerId, newMac, session.id);
      if (rebind) {
        db.prepare(
          `UPDATE device_sessions SET mac_address = ?, previous_mac = ?,
             hotspot_server = COALESCE(NULLIF(?, ''), hotspot_server),
             last_rebind_at = ?, last_seen = ?, is_online = 0
           WHERE id = ?`
        ).run(newMac, oldMac, params.server || '', now, now, session.id);
        db.prepare(
          'INSERT INTO session_bindings (session_id, old_mac, new_mac, hotspot_server, reason) VALUES (?, ?, ?, ?, ?)'
        ).run(session.id, oldMac, newMac, params.server || '', 'roam');
      } else {
        db.prepare(
          `UPDATE device_sessions SET hotspot_server = COALESCE(NULLIF(?, ''), hotspot_server), last_seen = ? WHERE id = ?`
        ).run(params.server || '', now, session.id);
      }
    });
    apply();
  } catch (err) {
    console.error(`restoreSession DB update failed for session ${session.id}:`, (err as Error).message);
    return { restore: false, reason: 'db-error' };
  }

  return {
    restore: true,
    username: session.username,
    password: session.password || lookupCredentials(session.username).password,
    remaining: session.remaining_seconds,
    rebind,
    token: session.session_token,
  };
}

/**
 * Called by the portal right after a successful login on any SSID: finalises
 * the token <-> MAC binding and adopts MikroTik's session-time-left.
 */
export function bindSession(params: {
  token?: any;
  mac: any;
  username: string;
  server?: string;
  sessionTimeLeft?: any;
}): { ok: boolean; token: string; adoptToken?: string } {
  const db = getDb();
  const routerId = 1;
  const mac = normalizeMac(params.mac);
  const username = String(params.username || '');
  const now = nowStamp();
  const incomingToken = isValidToken(params.token) ? String(params.token) : null;

  let session = incomingToken ? getSessionByToken(incomingToken) : null;
  if (!session && mac) {
    session = db
      .prepare('SELECT * FROM device_sessions WHERE router_id = ? AND mac_address = ?')
      .get(routerId, mac) as any;
  }
  // Token is fresh (cookie was lost on SSID switch) but this voucher already
  // has a live session on the old MAC — adopt THAT row so its remaining time
  // is kept instead of starting a duplicate session with 0 time.
  let adoptedByUsername = false;
  if (username) {
    const owner = findSessionByUsername(username, routerId) || findSessionByUsername(username);
    if (owner && (!session || owner.id !== session.id)) {
      // Prefer the row that actually holds the voucher's time.
      if (!session || !session.username || Number(owner.remaining_seconds) > Number(session.remaining_seconds)) {
        // Retire the empty fresh-token row in favour of the real session.
        if (session && session.id !== owner.id && !session.username) {
          try {
            db.prepare('DELETE FROM device_sessions WHERE id = ?').run(session.id);
          } catch { /* keep both rows rather than failing login */ }
        }
        session = owner;
        adoptedByUsername = true;
      }
    }
  }
  if (!session) {
    session = getSessionByToken(initSession({ mac, server: params.server, routerId }).token);
  }
  if (!session) throw new Error('Could not create device session');

  const creds = lookupCredentials(username);
  const left = mikrotikTimeToSeconds(params.sessionTimeLeft);
  // When adopting by username after a roam, the status page reports the NEW
  // login's full limit-uptime (which we just set to the old remaining time),
  // so keep the tracked remaining instead of overwriting it.
  const remaining = left === Infinity || adoptedByUsername ? session.remaining_seconds : left;
  const macChanged = !!mac && !!session.mac_address && mac !== session.mac_address;

  const set: string[] = [];
  const args: any[] = [];
  const put = (column: string, value: any) => {
    set.push(`${column} = ?`);
    args.push(value);
  };

  if (mac) {
    freeMac(routerId, mac, session.id);
    put('mac_address', mac);
  }
  if (macChanged) put('previous_mac', session.mac_address);
  if (username) put('username', username);
  if (creds.password && !session.password) put('password', creds.password);
  if (creds.profile && !session.profile) put('profile', creds.profile);
  if (params.server) put('hotspot_server', params.server);
  if (left !== Infinity) {
    put('remaining_seconds', remaining);
    put('total_seconds', Math.max(session.total_seconds, remaining));
  }
  put('status', remaining <= 0 ? 'expired' : 'active');
  put('is_online', 1);
  put('last_seen', now);
  if (macChanged) put('last_rebind_at', now);

  const apply = db.transaction(() => {
    db.prepare(`UPDATE device_sessions SET ${set.join(', ')} WHERE id = ?`).run(...args, session.id);
    if (macChanged) {
      db.prepare(
        'INSERT INTO session_bindings (session_id, old_mac, new_mac, hotspot_server, reason) VALUES (?, ?, ?, ?, ?)'
      ).run(session.id, session.mac_address, mac, params.server || '', 'login');
    }
  });
  apply();

  // Tell the portal to adopt the surviving token when we merged a fresh
  // token into an older session row (roam with lost cookie).
  const adoptToken =
    adoptedByUsername && incomingToken && incomingToken !== session.session_token
      ? session.session_token
      : undefined;
  return { ok: true, token: session.session_token, ...(adoptToken ? { adoptToken } : {}) };
}


/** Portal status page / pause / logout events for a token. */
export function updateSessionState(params: {
  token: any;
  event?: string;
  remaining?: any;
}): { ok: boolean; reason?: string; remaining?: number } {
  const session = getSessionByToken(params.token);
  if (!session) return { ok: false, reason: 'unknown-token' };

  const db = getDb();
  const now = nowStamp();
  const event = String(params.event || 'active');

  let remaining = session.remaining_seconds;
  if (params.remaining !== undefined && params.remaining !== null && params.remaining !== '') {
    const left = mikrotikTimeToSeconds(params.remaining);
    if (left !== Infinity) remaining = Math.max(0, Math.floor(left));
  }

  let status = session.status;
  if (remaining <= 0) status = 'expired';
  else if (event === 'pause' || event === 'logout') status = 'paused';
  else if (event === 'active') status = 'active';

  const isOnline = event === 'active' ? 1 : 0;

  db.prepare(
    `UPDATE device_sessions SET remaining_seconds = ?, total_seconds = MAX(total_seconds, ?),
       status = ?, is_online = ?, last_seen = ? WHERE id = ?`
  ).run(remaining, remaining, status, isOnline, now, session.id);

  return { ok: true, remaining };
}

/**
 * Keep every session in sync with the live MikroTik sessions (runs from the
 * existing 5s background loop). While a device is offline its remaining time
 * freezes (pause semantics), matching the portal's pause/logout flow.
 */
export function syncSessionsWithDevices(routerId: number, live: any[]): void {
  const db = getDb();
  const now = nowStamp();

  const byMac = new Map<string, any>();
  const byUser = new Map<string, any>();
  for (const conn of live || []) {
    const mac = normalizeMac(conn.mac || conn['mac-address']);
    const user = String(conn.user || '');
    if (mac && !byMac.has(mac)) byMac.set(mac, conn);
    if (user && !byUser.has(user)) byUser.set(user, conn);
  }

  const sessions = db
    .prepare('SELECT * FROM device_sessions WHERE router_id = ?')
    .all(routerId) as any[];

  // Track which live connections are already represented by a session row so
  // we can seed the untracked ones below (keeps the Sessions tab in sync with
  // Active Devices even when the portal could not reach the controller).
  const trackedConns = new Set<any>();

  for (const session of sessions) {
    const conn =
      (session.mac_address && byMac.get(session.mac_address)) ||
      (session.username && byUser.get(session.username)) ||
      null;

    if (conn) trackedConns.add(conn);

    if (conn) {
      const left = mikrotikTimeToSeconds(conn['session-time-left']);
      const remaining = left === Infinity ? session.remaining_seconds : Math.max(0, Math.floor(left));
      const status = remaining <= 0 ? 'expired' : 'active';
      db.prepare(
        `UPDATE device_sessions SET remaining_seconds = ?, status = ?, is_online = 1, last_seen = ?,
           hotspot_server = COALESCE(NULLIF(?, ''), hotspot_server)
         WHERE id = ?`
      ).run(remaining, status, now, String(conn.server || ''), session.id);
    } else if (session.is_online === 1) {
      const status = session.remaining_seconds <= 0 ? 'expired' : 'paused';
      db.prepare('UPDATE device_sessions SET is_online = 0, status = ?, last_seen = ? WHERE id = ?')
        .run(status, now, session.id);
    } else if (session.status === 'active' && session.remaining_seconds <= 0) {
      db.prepare("UPDATE device_sessions SET status = 'expired' WHERE id = ?").run(session.id);
    }
  }

  // Seed a session row for every live connection that has no row yet. This is
  // the server-side counterpart of the portal's /session/init + /session/bind:
  // when a phone can't reach the controller pre-login (walled-garden), the
  // token never gets created, so the Sessions tab would stay empty even though
  // the device shows under Active Devices. Seeding here keeps them consistent.
  // We skip MAC-less connections so the (router_id, mac_address) unique index
  // stays clean; if a MAC slot is already taken we just update that row.
  const seedInsert = db.prepare(
    `INSERT INTO device_sessions (session_token, mac_address, router_id, hotspot_server, username, status,
        total_seconds, remaining_seconds, is_online, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`
  );

  for (const conn of live || []) {
    if (trackedConns.has(conn)) continue;
    const mac = normalizeMac(conn.mac || conn['mac-address']);
    if (!mac) continue; // only track connections we can dedupe by MAC

    // Respect the unique (router_id, mac_address) index: if a row already owns
    // this MAC under this router, adopt/refresh it instead of inserting a dup.
    const existing = db
      .prepare('SELECT id FROM device_sessions WHERE router_id = ? AND mac_address = ?')
      .get(routerId, mac) as any;
    if (existing) {
      db.prepare(
        `UPDATE device_sessions SET is_online = 1, status = 'active',
           hotspot_server = COALESCE(NULLIF(?, ''), hotspot_server),
           username = COALESCE(NULLIF(?, ''), username),
           last_seen = ? WHERE id = ?`
      ).run(String(conn.server || ''), String(conn.user || ''), now, existing.id);
      continue;
    }

    const left = mikrotikTimeToSeconds(conn['session-time-left']);
    // Unlimited sessions report "infinity"; store 0 remaining but keep the row
    // active - the next sync tick refines it from the live session-time-left.
    const remaining = left === Infinity ? 0 : Math.max(0, Math.floor(left));
    const token = generateSessionToken();
    seedInsert.run(
      token,
      mac,
      routerId,
      String(conn.server || ''),
      String(conn.user || ''),
      remaining,
      remaining,
      now,
      now
    );
  }
}

/** Admin listing of every session token ever issued for a router. */
export function listSessions(routerId: number): any[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, session_token, mac_address, previous_mac, username, profile, router_id, hotspot_server,
              total_seconds, remaining_seconds, status, is_online, first_seen, last_seen, last_rebind_at
       FROM device_sessions WHERE router_id = ?
       ORDER BY is_online DESC, last_seen DESC, id DESC`
    )
    .all(routerId) as any[];
}

/** Revoke a token (forces a fresh session on the device's next visit). */
export function deleteSession(sessionId: number): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM device_sessions WHERE id = ?').run(sessionId);
  return info.changes > 0;
}

