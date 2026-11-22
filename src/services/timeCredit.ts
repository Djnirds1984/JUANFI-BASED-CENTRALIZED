import { mikroTikService } from './mikrotik';
import { initSession, bindSession, mikrotikTimeToSeconds } from './deviceSessions';
import { purgeLocalDeviceUsers } from './activeDevices';

/*
 * One implementation of "give N minutes to this device's MAC identity and make
 * the router show it live".
 *
 * It used to live inside the coin-auth route alone. The wallet needs exactly the
 * same behaviour when a customer converts balance to time, and a second copy of
 * this logic is how paid time starts drifting between the money paths (stacking,
 * paused balances, roam identity, CoA vs local users). So coin inserts, voucher
 * redemptions and wallet conversions all come through here.
 */

/** Seconds -> MikroTik `limit-uptime` value (`00:45:10` / `1d02:30:00`). */
export function secondsToUptimeLimit(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const clock = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return days > 0 ? `${days}d${clock}` : clock;
}

/**
 * MikroTik time (`8m18s`, `1h2m3s`, `00:45:10`, `1d02:30:00`) -> seconds.
 * Uses the shared parser (RouterOS returns compact durations like `8m18s`);
 * empty / `infinity` counts as 0 here.
 */
export function mikrotikUptimeToSeconds(value: any): number {
  const seconds = mikrotikTimeToSeconds(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

/**
 * Credit `duration` minutes onto the MAC identity account, stacking on any
 * remaining (or frozen paused) balance. Shared by coin-auth, voucher redeem and
 * the wallet so all three behave exactly like a coin insert. Plain function: the
 * CALLER wraps it in a transaction (redeem combines it with the voucher
 * mark-used update; nested transactions are not portable).
 */
export function creditMacAccount(db: any, routerId: number, macNoColon: string, duration: number, authMode: string) {
  // RADIUS mode: give the coin-insert account the router's DEFAULT RADIUS
  // profile so rate-limit / idle-timeout come from the profile (the coin's
  // own paid time still becomes the Session-Timeout).
  const defaultProfile = authMode === 'radius'
    ? (db.prepare('SELECT id, name FROM radius_profiles WHERE router_id = ? AND is_default = 1 LIMIT 1')
        .get(routerId) as any)
    : null;

  // Match tolerating the router's username casing / MAC separators so we
  // update the EXISTING account instead of inserting a duplicate row (which
  // left the real account disabled/expired and auth kept failing).
  let accountUsername = macNoColon;
  let existing = db.prepare(
    `SELECT id, expiry_at, paused FROM hotspot_users
     WHERE router_id = ?
       AND (LOWER(username) = LOWER(?)
            OR UPPER(REPLACE(REPLACE(username, ':', ''), '-', '')) = ?)
     ORDER BY id DESC LIMIT 1`
  ).get(routerId, macNoColon, macNoColon) as any;

  // After a roam the device presents a NEW MAC while the account keeps the
  // ORIGINAL username (token binding). Resolve the same identity check-session
  // uses so the coin stacks onto the real account (and its frozen paused
  // balance) instead of creating a duplicate account for the new MAC.
  const macColon = macNoColon.toLowerCase().match(/.{2}/g)?.join(':') || '';
  if (!existing && macColon) {
    const bound = db.prepare(
      `SELECT username FROM device_sessions
       WHERE router_id = ? AND mac_address = ? AND username <> ''
       ORDER BY last_seen DESC LIMIT 1`
    ).get(routerId, macColon) as any;
    if (bound && bound.username) {
      accountUsername = String(bound.username).trim().toUpperCase();
      existing = db.prepare(
        `SELECT id, expiry_at, paused FROM hotspot_users WHERE router_id = ? AND username = ?
         ORDER BY id DESC LIMIT 1`
      ).get(routerId, accountUsername) as any;
    }
  }

  let expiryAt: string;
  let hadRemaining = false;
  const now = new Date();
  const addMs = duration * 60 * 1000;

  if (existing) {
    // ALWAYS stack onto unused time - whether or not the portal flagged this
    // as an "extend". A new coin insert must ADD to any remaining time, never
    // reset it (otherwise the leftover time is lost before the new time is
    // applied - the captive-popup "time disappears then adds" bug).
    let currentExpiry = existing.expiry_at
      ? new Date(String(existing.expiry_at).replace(' ', 'T') + 'Z').getTime()
      : 0;
    // Paused account: pause cleared expiry_at and froze the balance in
    // device_sessions. Stack the coin onto that frozen balance (and unpause
    // via the UPDATE below) so no paid time is lost.
    if (existing.paused) {
      const sess = db.prepare(
        `SELECT remaining_seconds FROM device_sessions
         WHERE router_id = ? AND (mac_address = ? OR (username <> '' AND UPPER(username) = ?))
         ORDER BY last_seen DESC LIMIT 1`
      ).get(routerId, macColon, accountUsername) as any;
      const frozen = sess ? Math.max(0, Math.floor(Number(sess.remaining_seconds) || 0)) : 0;
      if (frozen > 0) currentExpiry = now.getTime() + frozen * 1000;
    }
    if (currentExpiry > now.getTime()) {
      hadRemaining = true;
      expiryAt = new Date(currentExpiry + addMs).toISOString().replace('T', ' ').slice(0, 19);
    } else {
      expiryAt = new Date(now.getTime() + addMs).toISOString().replace('T', ' ').slice(0, 19);
    }
    db.prepare(
      `UPDATE hotspot_users SET disabled = 0, paused = 0, expiry_at = ?, updated_at = datetime('now'),
        source = ?, profile = COALESCE(NULLIF(profile, ''), ?),
        radius_profile_id = COALESCE(radius_profile_id, ?) WHERE id = ?`
    ).run(
      expiryAt,
      authMode === 'radius' ? 'radius' : 'api',
      defaultProfile?.name || 'default',
      defaultProfile?.id ?? null,
      existing.id
    );
  } else {
    expiryAt = new Date(now.getTime() + addMs).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(
      `INSERT INTO hotspot_users (router_id, username, password, profile, comment, disabled, expiry_at, source, radius_profile_id)
       VALUES (?, ?, '', ?, 'Coin-insert MAC user', 0, ?, ?, ?)`
    ).run(
      routerId, accountUsername,
      defaultProfile?.name || 'default',
      expiryAt,
      authMode === 'radius' ? 'radius' : 'api',
      defaultProfile?.id ?? null
    );
  }
  return { expiryAt, hadRemaining, accountUsername };
}

// Bind a permanent roaming session token to this MAC + account (server side)
// so the panel DB holds the mac+token+time binding even if the portal's own
// bind never runs. On roam, /session/restore finds it and restores the time.
export function bindMacToken(routerId: number, macNoColon: string, accountUsername: string, expiryAt: string): void {
  try {
    const macColon = macNoColon.toLowerCase().match(/.{2}/g)?.join(':') || '';
    const tokenRemaining = Math.max(
      0,
      Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
    );
    if (macColon) {
      const init = initSession({ mac: macColon, ip: '', server: '', routerId });
      bindSession({ token: init.token, mac: macColon, username: accountUsername, sessionTimeLeft: tokenRemaining, routerId });
      console.log(`mac-credit: bound session token for ${macColon} -> ${accountUsername} (remaining ${tokenRemaining}s)`);
    }
  } catch (bindErr: any) {
    console.error(`mac-credit: token bind failed for ${macNoColon}:`, bindErr.message);
  }
}

export interface PropagateParams {
  db: any;
  routerId: number;
  macNoColon: string;
  authMode: string;
  hybridLocalUsers: boolean;
  isExtend: boolean;
  expiryAt: string;
  hadRemaining: boolean;
  accountUsername: string;
  /** Prefix for log lines so a wallet purchase is traceable in journalctl. */
  logTag?: string;
}

/**
 * Make the stacked `expiryAt` visible to the live device WITHOUT dropping it,
 * then keep the router's own user list consistent with the panel.
 *
 * Best-effort by design: the panel DB is the source of truth for time, so a
 * router that is offline or rejects a write must never fail a payment the
 * customer already made.
 */
export async function propagateTimeToRouter(params: PropagateParams): Promise<void> {
  const {
    db, routerId, macNoColon, authMode, hybridLocalUsers, isExtend,
    expiryAt, hadRemaining, accountUsername,
  } = params;
  const logTag = params.logTag || 'coin-auth';

  // Extend/top-up: NEVER kick/disconnect the live session here.
  // The live /ip/hotspot/active session keeps running and stays online;
  // the added minutes are stacked in expiry_at (wall clock). To make the
  // router's time-left reflect the new total WITHOUT dropping the device,
  // send a RADIUS CoA-Request (Session-Timeout) for the live session —
  // MikroTik updates the active session in place, no re-auth needed.
  //
  // RouterOS matches that CoA BY THE CLIENT IP ONLY (an Acct-Session-Id or
  // User-Name keyed request gets CoA-NAK / Error-Cause 406), and the panel does
  // not store the device's address, so the live session is read from the router
  // first. No live session means there is nothing to extend - the stacked
  // expiry_at is handed out by the next Access-Accept.
  if (isExtend || hadRemaining) {
    try {
      const { sendCoASessionTimeout } = await import('./radiusServer');
      const remainingSec = Math.max(
        1,
        Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
      );

      const routerRow = db.prepare('SELECT host FROM routers WHERE id = ?').get(routerId) as any;
      const nasIp = String(routerRow?.host || '').split(':')[0];
      const macKey = macNoColon.toLowerCase();
      let live: any = null;
      if (nasIp && mikroTikService.isConnected(routerId)) {
        try {
          const conns = await mikroTikService.getActiveConnections(routerId);
          live = (Array.isArray(conns) ? conns : []).find((c: any) =>
            String(c.mac || c['mac-address'] || '').toLowerCase().replace(/[^0-9a-f]/g, '') === macKey ||
            String(c.user || '').toUpperCase() === String(accountUsername).toUpperCase()) || null;
        } catch (liveErr: any) {
          console.log(`${logTag}: live session lookup on router ${routerId} failed: ${liveErr.message}`);
        }
      }

      if (!live) {
        console.log(
          `${logTag}: ${macNoColon} is not in router ${routerId}'s live session list - ` +
          `${remainingSec}s saved on the account for its next login`
        );
      } else {
        const usedSec = mikrotikUptimeToSeconds(live.uptime);
        const framedIp = String(live.address || '').split('/')[0].split(':')[0];
        // The router keeps counting from the session's existing uptime, so the
        // used part is added back inside the sender: the device must be left
        // with `remainingSec`, not `remainingSec - usedSec`.
        const sent = sendCoASessionTimeout(routerId, nasIp, {
          remainingSeconds: remainingSec,
          framedIp,
          username: String(live.user || accountUsername),
          uptimeSeconds: usedSec,
        });
        console.log(
          `${logTag}: CoA extend ${macNoColon} on router ${routerId} -> ip=${framedIp || '-'} ` +
          `user="${live.user || accountUsername}" paid remaining ${remainingSec}s (session used ${usedSec}s) ${sent ? 'requested' : 'NOT SENT'}`
        );
      }
    } catch (coaErr: any) {
      console.error(`${logTag}: CoA extend failed for ${macNoColon} on router ${routerId}:`, coaErr.message);
    }
  }

  // Push the new limit to the router's LOCAL hotspot user - API mode ONLY.
  //
  // In RADIUS mode the router authenticates AND accounts via RADIUS, so we
  // must NOT create or update local users: MikroTik checks the local user list
  // first, so a local MAC user lets the device bypass RADIUS (and RADIUS
  // accounting) entirely. Live extensions go through the CoA above.
  // Pure RADIUS (radius_local_users=0): never touch the router's local list.
  // Hybrid (radius_local_users=1): reuse/refresh an existing local user.
  const writeLocalUsers = authMode !== 'radius' || hybridLocalUsers;
  if (writeLocalUsers && mikroTikService.isConnected(routerId)) {
    try {
      const routerUsers = await mikroTikService.getHotspotUsers(routerId);

      // The router may store this user with the MAC in a different shape
      // (e.g. `12:41:20:FB:81:24`, `12-41-20-FB-81-24`, lower case) while the
      // panel identity is the MAC without colons. Match on the normalized MAC
      // so we extend the ACTUAL live user instead of silently creating a
      // second, unused one (which is why "time added" had no effect).
      const normalizeUserName = (v: any) => String(v || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
      const existingOnRouter = routerUsers.find((u: any) =>
        normalizeUserName(u.name) === macNoColon || normalizeUserName(u.name) === accountUsername);
      const routerUserName = existingOnRouter ? String(existingOnRouter.name) : accountUsername;
      const msLeft = new Date(expiryAt + 'Z').getTime() - Date.now();

      if (!existingOnRouter) {
        if (authMode === 'radius') {
          console.log(`${logTag}: hybrid RADIUS - no local user for ${macNoColon} to reuse (RADIUS auth + CoA)`);
        } else {
          await mikroTikService.createHotspotUser(routerId, {
            username: accountUsername,
            password: '',
            profile: 'default',
            uptimeLimit: secondsToUptimeLimit(Math.max(60, Math.floor(msLeft / 1000))),
            comment: 'Coin-insert MAC user (panel portal)',
          });
        }
      } else {
        // Top-up on an already-logged-in device.
        //
        // expiryAt is ALREADY the stacked expiry (prior remaining + new
        // minutes), so we must not add `duration` on top of a value derived
        // from it (that double-credits).
        //
        // Live `session-time-left` = limit-uptime - accumulated uptime, so:
        //   - known limit   -> remaining = limit - uptime, and the new limit
        //                      must restore that remaining (+ new minutes).
        //   - unknown limit -> trust the stacked expiry (already includes the
        //                      added time).
        // `reset-counters` zeroes the accumulated uptime so the new limit is
        // shown immediately; if the reset fails we keep the old limit as the
        // base so the uptime is still accounted for.
        if (authMode === 'radius') {
          console.log(`${logTag}: hybrid RADIUS - reusing existing local user "${routerUserName}" for ${macNoColon}`);
        }
        const uptimeSec = mikrotikUptimeToSeconds(existingOnRouter.uptime);
        // Make the router's user limit reflect the panel's PAID remaining time
        // exactly (expiryAt is already the stacked total, so `msLeft` is the
        // new remaining). Live `session-time-left = limit-uptime - uptime`, so:
        //   - after a successful counter reset (uptime -> 0): limit = remaining
        //   - if the reset fails:                             limit = uptime + remaining
        // Either way the router shows the panel's remaining, which also heals
        // any drift/inflation left over from earlier top-ups.
        const paidRemainingSec = Math.max(0, Math.floor(msLeft / 1000));
        const resetOk = await mikroTikService.resetHotspotUserCounters(routerId, routerUserName);
        const newLimitSec = Math.max(60, paidRemainingSec + (resetOk ? 0 : uptimeSec));

        const setOk = await mikroTikService.setUserUptimeLimit(
          routerId,
          routerUserName,
          secondsToUptimeLimit(newLimitSec)
        );
        console.log(
          `${logTag}: extend ${macNoColon} on router ${routerId} -> user "${routerUserName}" ` +
          `paidRemaining ${paidRemainingSec}s + uptime ${uptimeSec}s (reset=${resetOk}) = ` +
          `limit ${newLimitSec}s (${secondsToUptimeLimit(newLimitSec)}), set=${setOk}`
        );
        if (!setOk) {
          console.error(
            `${logTag}: router user "${routerUserName}" not found on router ${routerId} - time NOT added`
          );
        }
        if (existingOnRouter['.id']) {
          try { await mikroTikService.enableHotspotUser(routerId, existingOnRouter['.id']); } catch {}
        }
      }
    } catch (mtErr: any) {
      // Panel DB is authoritative for check-session; log but don't fail the
      // payment. The device can still retry login once the router syncs.
      console.error(`${logTag}: failed to push MAC user ${macNoColon} to router ${routerId}:`, mtErr.message);
    }
  } else if (authMode === 'radius') {
    // FULL RADIUS: the router authenticates AND accounts via RADIUS, so we
    // never create/update a local user - extension is done with the CoA above.
    console.log(`${logTag}: pure RADIUS - no local user written for ${macNoColon} (RADIUS auth + CoA only)`);

    // AUTO-PURGE (no manual step): on a SUCCESSFUL credit in FULL RADIUS
    // mode (radius + not hybrid), remove any leftover LOCAL device users
    // (MAC/rate-named) so RADIUS is the only auth path. MikroTik checks the
    // local user list BEFORE RADIUS, so a stale local user would shadow RADIUS
    // and block this top-up once its limit runs out. Best-effort - never fail
    // the payment; skipped when the router is offline (background sync covers it).
    if (!hybridLocalUsers && mikroTikService.isConnected(routerId)) {
      try {
        const purged = await purgeLocalDeviceUsers(routerId);
        if (purged > 0) {
          console.log(`${logTag}: auto-purged ${purged} leftover local device user(s) on router ${routerId} (full RADIUS)`);
        }
      } catch (purgeErr: any) {
        console.error(`${logTag}: auto-purge of local device users failed on router ${routerId}:`, purgeErr.message);
      }
    }
  } else {
    console.log(
      `${logTag}: router push SKIPPED for ${macNoColon} (router ${routerId} not connected, ` +
      `authMode=${authMode}, isExtend=${isExtend}) - time added to DB only`
    );
  }
}

/**
 * Credit `durationMinutes` onto a device and propagate it - the single entry
 * point used by the wallet (and any future money path). Returns the same shape
 * the coin route reports to the portal so the UI can share one refresh path.
 *
 * `insideTx` runs in the SAME transaction as the credit. The wallet uses it to
 * debit the balance: either both the money leaves the wallet and the time lands
 * on the device, or nothing happens. Without this hook a crash between the two
 * writes could spend a balance without delivering the time (or hand out time it
 * was never paid for).
 */
export async function grantMinutesToMac(params: {
  db: any;
  routerId: number;
  macNoColon: string;
  durationMinutes: number;
  authMode: string;
  hybridLocalUsers?: boolean;
  logTag?: string;
  insideTx?: (db: any) => void;
}): Promise<{ expiryAt: string; remainingSeconds: number; accountUsername: string; hadRemaining: boolean }> {
  const { db, routerId, macNoColon, durationMinutes, authMode } = params;
  const hybridLocalUsers = params.hybridLocalUsers === true;

  const { expiryAt, hadRemaining, accountUsername } = db.transaction(() => {
    if (params.insideTx) params.insideTx(db);
    return creditMacAccount(db, routerId, macNoColon, durationMinutes, authMode);
  })();

  bindMacToken(routerId, macNoColon, accountUsername, expiryAt);

  await propagateTimeToRouter({
    db,
    routerId,
    macNoColon,
    authMode,
    hybridLocalUsers,
    // A wallet purchase is always a top-up on whatever the device has, so treat
    // it like an extend: never kick a live session, always CoA it.
    isExtend: true,
    expiryAt,
    hadRemaining,
    accountUsername,
    logTag: params.logTag,
  });

  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
  );
  return { expiryAt, remainingSeconds, accountUsername, hadRemaining };
}
