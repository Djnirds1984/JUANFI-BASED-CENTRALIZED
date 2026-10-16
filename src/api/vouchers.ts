import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';
import { mikrotikTimeToSeconds, initSession, bindSession } from '../services/deviceSessions';

const router = Router();

/**
 * MikroTik time (`8m18s`, `1h2m3s`, `00:45:10`, `1d02:30:00`) -> seconds.
 * Uses the shared parser (RouterOS returns compact durations like `8m18s`);
 * empty / `infinity` counts as 0 here.
 */
function mikrotikUptimeToSeconds(value: any): number {
  const seconds = mikrotikTimeToSeconds(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

/** Seconds -> MikroTik `limit-uptime` value (`00:45:10` / `1d02:30:00`). */
function secondsToUptimeLimit(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const clock = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return days > 0 ? `${days}d${clock}` : clock;
}

// Public endpoint for coin-insert flow — MAC-AS-VOUCHER ONLY.
// Creates/extends the hotspot_user whose username is the device MAC
// (no colons, UPPERCASE) so the upcoming auto-login authenticates the
// same identity. Random NodeMCU vouchers are never used for auth here.
router.post('/coin-auth', async (req: Request, res: Response) => {
  const { mac, durationMinutes, serverAddress, routerId: bodyRouterId, extend } = req.body;

  // Normalize: accept AA:BB:.. / AA-BB-.. / AABB.. in any case, store AABB.. UPPER.
  const macNoColon = String(mac || '').replace(/:/g, '').replace(/-/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(macNoColon) || !durationMinutes) {
    res.status(400).json({ error: 'mac (12 hex chars) and durationMinutes are required' });
    return;
  }

  const db = getDb();
  let routerId: number;
  let authMode = 'api';

  if (bodyRouterId) {
    routerId = parseInt(bodyRouterId, 10);
    const routerRow = db.prepare(
      'SELECT id, auth_mode FROM routers WHERE id = ? AND is_active = 1'
    ).get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found or not active' });
      return;
    }
    authMode = routerRow.auth_mode || 'api';
  } else if (serverAddress) {
    const hostOnly = serverAddress.split(':')[0];
    const routerRow = db.prepare(
      "SELECT id, auth_mode FROM routers WHERE host = ? AND is_active = 1"
    ).get(hostOnly) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found or not active' });
      return;
    }
    routerId = routerRow.id;
    authMode = routerRow.auth_mode || 'api';
  } else {
    res.status(400).json({ error: 'routerId or serverAddress is required' });
    return;
  }
  const isExtend = extend === true;
  const duration = parseInt(durationMinutes) || 0;
  console.log(`coin-auth: request mac=${macNoColon} routerId=${routerId} authMode=${authMode} extend=${isExtend} duration=${duration}min`);

  const upsert = db.transaction(() => {
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
    const existing = db.prepare(
      `SELECT id, expiry_at FROM hotspot_users
       WHERE router_id = ?
         AND (LOWER(username) = LOWER(?)
              OR UPPER(REPLACE(REPLACE(username, ':', ''), '-', '')) = ?)
       ORDER BY id DESC LIMIT 1`
    ).get(routerId, macNoColon, macNoColon) as any;

    let expiryAt: string;
    let hadRemaining = false;
    const now = new Date();
    const addMs = duration * 60 * 1000;

    if (existing) {
      // ALWAYS stack onto unused time - whether or not the portal flagged this
      // as an "extend". A new coin insert must ADD to any remaining time, never
      // reset it (otherwise the leftover time is lost before the new time is
      // applied - the captive-popup "time disappears then adds" bug).
      const currentExpiry = existing.expiry_at
        ? new Date(String(existing.expiry_at).replace(' ', 'T') + 'Z').getTime()
        : 0;
      if (currentExpiry > now.getTime()) {
        hadRemaining = true;
        expiryAt = new Date(currentExpiry + addMs).toISOString().replace('T', ' ').slice(0, 19);
      } else {
        expiryAt = new Date(now.getTime() + addMs).toISOString().replace('T', ' ').slice(0, 19);
      }
      db.prepare(
        `UPDATE hotspot_users SET disabled = 0, expiry_at = ?, updated_at = datetime('now'),
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
        routerId, macNoColon,
        defaultProfile?.name || 'default',
        expiryAt,
        authMode === 'radius' ? 'radius' : 'api',
        defaultProfile?.id ?? null
      );
    }
    return { expiryAt, hadRemaining };
  });

  try {
    const { expiryAt, hadRemaining } = upsert();

    // Bind a permanent roaming session token to this MAC + account NOW (server
    // side), so the panel DB already holds the mac+token+time binding even if
    // the portal's own bind never runs. On roam, /session/restore finds it and
    // restores the remaining time on the new SSID/MAC.
    try {
      const macColon = macNoColon.toLowerCase().match(/.{2}/g)?.join(':') || '';
      const tokenRemaining = Math.max(
        0,
        Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
      );
      if (macColon) {
        const init = initSession({ mac: macColon, ip: '', server: '', routerId });
        bindSession({ token: init.token, mac: macColon, username: macNoColon, sessionTimeLeft: tokenRemaining, routerId });
        console.log(`coin-auth: bound session token for ${macNoColon} (remaining ${tokenRemaining}s)`);
      }
    } catch (bindErr: any) {
      console.error(`coin-auth: token bind failed for ${macNoColon}:`, bindErr.message);
    }

    // Extend/top-up: NEVER kick/disconnect the live session here.
    // The live /ip/hotspot/active session keeps running and stays online;
    // the added minutes are stacked in expiry_at (wall clock). To make the
    // router's time-left reflect the new total WITHOUT dropping the device,
    // send a RADIUS CoA-Request (Session-Timeout) for the live session —
    // MikroTik updates the active session in place, no re-auth needed.
    // Best-effort only — never fail the payment.
    if (isExtend || hadRemaining) {
      try {
        const { sendCoASessionTimeout } = await import('../services/radiusServer');
        const remainingSec = Math.max(
          1,
          Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
        );

        // Case-insensitive match: the router may report the user in a different
        // case than the panel identity. Ignore synthetic 'coin_' ids - MikroTik
        // only accepts a REAL RADIUS Acct-Session-Id.
        const sess = db.prepare(
          `SELECT session_id, nas_ip, username FROM radius_sessions
           WHERE router_id = ? AND LOWER(username) = LOWER(?) AND status = 'active'
           ORDER BY updated_at DESC LIMIT 1`
        ).get(routerId, macNoColon) as any;
        const realSessionId = sess?.session_id && !String(sess.session_id).startsWith('coin_')
          ? String(sess.session_id) : '';

        if (realSessionId && sess?.nas_ip) {
          console.log(`coin-auth: CoA extend ${macNoColon} -> Session-Timeout=${remainingSec}s on router ${routerId} (session ${realSessionId})`);
          sendCoASessionTimeout(routerId, realSessionId, sess.nas_ip, remainingSec, String(sess.username || macNoColon));
        } else {
          // No real accounting session id. Look up the LIVE active session so we
          // can CoA by the router's actual username + the device IP
          // (Framed-IP-Address) - MikroTik can match a session by those even
          // without Acct-Session-Id.
          const routerRow = db.prepare('SELECT host FROM routers WHERE id = ?').get(routerId) as any;
          const nasIp = String(routerRow?.host || '').split(':')[0];
          let coaUser = macNoColon;
          let coaIp = '';
          try {
            if (mikroTikService.isConnected(routerId)) {
              const live = await mikroTikService.getActiveConnections(routerId);
              const macKey = macNoColon.toLowerCase();
              const conn = (Array.isArray(live) ? live : []).find((c: any) =>
                String(c.mac || c['mac-address'] || '').toLowerCase().replace(/[^0-9a-f]/g, '') === macKey
              );
              if (conn) {
                coaUser = String(conn.user || coaUser);
                coaIp = String(conn.address || '').split('/')[0].split(':')[0];
                console.log(`coin-auth: live active entry for ${macNoColon}: user="${coaUser}" ip=${coaIp} timeLeft=${conn['session-time-left']}`);
              } else {
                const macs = (Array.isArray(live) ? live : [])
                  .map((c: any) => String(c.mac || c['mac-address'] || c.user || '').toLowerCase())
                  .filter(Boolean);
                console.log(`coin-auth: ${macNoColon} not in the router's live active list (live=${macs.join(',') || 'none'})`);
              }
            }
          } catch (liveErr: any) {
            console.log(`coin-auth: live lookup failed: ${liveErr.message}`);
          }
          const recent = db.prepare(
            `SELECT username, session_id, status, updated_at FROM radius_sessions
             WHERE router_id = ? ORDER BY updated_at DESC LIMIT 3`
          ).all(routerId) as any[];
          console.log(`coin-auth: no real RADIUS session for ${macNoColon} - User-Name/Framed-IP CoA user="${coaUser}" ip=${coaIp || '-'} to ${nasIp || 'unknown'}; recent=${JSON.stringify(recent)}`);
          if (nasIp) sendCoASessionTimeout(routerId, '', nasIp, remainingSec, coaUser, coaIp || undefined);
        }
      } catch (coaErr: any) {
        console.error(`coin-auth: CoA extend failed for ${macNoColon} on router ${routerId}:`, coaErr.message);
      }
    }

    // Push the new limit to the router's LOCAL hotspot user - API mode ONLY.
    //
    // In RADIUS mode the router authenticates AND accounts via RADIUS, so we
    // must NOT create or update local users: MikroTik checks the local user list
    // first, so a local MAC user lets the device bypass RADIUS (and RADIUS
    // accounting) entirely. Live extensions go through the CoA above.
    if (authMode !== 'radius' && mikroTikService.isConnected(routerId)) {
      try {
        const routerUsers = await mikroTikService.getHotspotUsers(routerId);

        // The router may store this user with the MAC in a different shape
        // (e.g. `12:41:20:FB:81:24`, `12-41-20-FB-81-24`, lower case) while the
        // panel identity is the MAC without colons. Match on the normalized MAC
        // so we extend the ACTUAL live user instead of silently creating a
        // second, unused one (which is why "time added" had no effect).
        const normalizeUserName = (v: any) => String(v || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
        const existingOnRouter = routerUsers.find((u: any) => normalizeUserName(u.name) === macNoColon);
        const routerUserName = existingOnRouter ? String(existingOnRouter.name) : macNoColon;
        const msLeft = new Date(expiryAt + 'Z').getTime() - Date.now();

        if (!existingOnRouter) {
          await mikroTikService.createHotspotUser(routerId, {
            username: macNoColon,
            password: '',
            profile: 'default',
            uptimeLimit: secondsToUptimeLimit(Math.max(60, Math.floor(msLeft / 1000))),
            comment: 'Coin-insert MAC user (panel portal)',
          });
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
            `coin-auth: extend ${macNoColon} on router ${routerId} -> user "${routerUserName}" ` +
            `paidRemaining ${paidRemainingSec}s + uptime ${uptimeSec}s (reset=${resetOk}) = ` +
            `limit ${newLimitSec}s (${secondsToUptimeLimit(newLimitSec)}), set=${setOk}`
          );
          if (!setOk) {
            console.error(
              `coin-auth: router user "${routerUserName}" not found on router ${routerId} - time NOT added`
            );
          }
          if (existingOnRouter['.id']) {
            try { await mikroTikService.enableHotspotUser(routerId, existingOnRouter['.id']); } catch {}
          }
        }
      } catch (mtErr: any) {
        // Panel DB is authoritative for check-session; log but don't fail the
        // payment. The device can still retry login once the router syncs.
        console.error(`coin-auth: failed to push MAC user ${macNoColon} to router ${routerId}:`, mtErr.message);
      }
    } else if (authMode === 'radius') {
      // FULL RADIUS: the router authenticates AND accounts via RADIUS, so we
      // never create/update a local user - extension is done with the CoA above.
      console.log(`coin-auth: full-RADIUS mode - no local user written for ${macNoColon} (RADIUS auth + CoA only)`);
    } else {
      console.log(
        `coin-auth: router push SKIPPED for ${macNoColon} (router ${routerId} not connected, ` +
        `authMode=${authMode}, isExtend=${isExtend}) - time added to DB only`
      );
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
    );
    res.json({ success: true, remainingSeconds, extended: isExtend || hadRemaining });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.use(authMiddleware);

function generateCode(length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

router.get('/router/:routerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const { status, limit, offset, type } = req.query;

    const routerRow = db.prepare('SELECT auth_mode FROM routers WHERE id = ?').get(routerId) as any;
    const isRadius = routerRow?.auth_mode === 'radius';

    let routerUsers: any[] = [];
    if (!isRadius && mikroTikService.isConnected(routerId)) {
      try {
        routerUsers = await mikroTikService.getHotspotUsers(routerId);
      } catch (err) {
        console.error('Failed to fetch router users:', (err as Error).message);
      }
    }

    const activeUsernames = new Set(
      routerUsers
        .filter((u: any) => u.disabled !== 'true')
        .map((u: any) => u.name)
    );

    if (!isRadius) {
      if (activeUsernames.size > 0) {
        const placeholders = Array.from(activeUsernames).map(() => '?').join(',');
        const syncStmt = db.prepare(
          `UPDATE vouchers SET is_used = 1, used_at = datetime('now')
           WHERE router_id = ? AND username IN (${placeholders}) AND is_used = 0`
        );
        syncStmt.run(routerId, ...Array.from(activeUsernames));

        const deleteStmt = db.prepare(
          `DELETE FROM vouchers WHERE router_id = ? AND is_used = 1 AND username NOT IN (${placeholders})`
        );
        deleteStmt.run(routerId, ...Array.from(activeUsernames));
      } else {
        db.prepare('DELETE FROM vouchers WHERE router_id = ? AND is_used = 1').run(routerId);
      }
    }

    let query = 'SELECT * FROM vouchers WHERE router_id = ?';
    const params: any[] = [routerId];

    if (type === 'radius') {
      query += ' AND radius_profile_id IS NOT NULL';
    } else if (type === 'api') {
      query += ' AND (radius_profile_id IS NULL OR radius_profile_id = 0)';
    }

    if (status === 'used') {
      query += ' AND is_used = 1';
    } else if (status === 'unused') {
      query += ' AND is_used = 0';
    }

    query += ' ORDER BY created_at DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(parseInt(limit as string));
    }
    if (offset) {
      query += ' OFFSET ?';
      params.push(parseInt(offset as string));
    }

    const vouchers = db.prepare(query).all(...params);

    const totalQuery = type === 'radius'
      ? 'SELECT COUNT(*) as count FROM vouchers WHERE router_id = ? AND radius_profile_id IS NOT NULL'
      : type === 'api'
        ? 'SELECT COUNT(*) as count FROM vouchers WHERE router_id = ? AND (radius_profile_id IS NULL OR radius_profile_id = 0)'
        : 'SELECT COUNT(*) as count FROM vouchers WHERE router_id = ?';

    const total = (db.prepare(totalQuery).get(routerId) as any).count;

    if (isRadius) {
      const profiles = db.prepare('SELECT id, name FROM radius_profiles').all() as any[];
      const profileMap: Record<number, string> = {};
      for (const p of profiles) profileMap[p.id] = p.name;
      for (const v of vouchers as any[]) {
        v.radius_profile_name = v.radius_profile_id ? (profileMap[v.radius_profile_id] || null) : null;
      }
    }

    res.json({ vouchers, total, routerUsers });
  } catch (error) {
    console.error('Get vouchers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/router/:routerId/generate', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const { count, profile, durationMinutes, dataLimitMb, prefix, codeLength, radiusProfileId, usePassword } = req.body;

    const quantity = Math.min(count || 1, 100);
    const codeLen = Math.min(Math.max(parseInt(codeLength) || 8, 4), 20);
    const db = getDb();

    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const isRadius = routerRow.auth_mode === 'radius';
    const rProfileId = radiusProfileId ? parseInt(radiusProfileId) : null;

    let radiusProfileName = 'default';
    if (isRadius && rProfileId) {
      const rp = db.prepare('SELECT name FROM radius_profiles WHERE id = ?').get(rProfileId) as any;
      if (rp) radiusProfileName = rp.name;
    }

    const vouchers: any[] = [];
    const insertStmt = db.prepare(
      `INSERT INTO vouchers (router_id, code, username, password, profile, duration_minutes, data_limit_mb, expires_at, radius_profile_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertHotspotUserStmt = db.prepare(
      `INSERT INTO hotspot_users (router_id, username, password, comment, radius_profile_id, disabled)
       VALUES (?, ?, ?, ?, ?, 0)`
    );

    const insertMany = db.transaction(() => {
      for (let i = 0; i < quantity; i++) {
        const code = prefix ? `${prefix}-${generateCode(codeLen)}` : generateCode(codeLen);
        const username = code;

        let expiresAt: string | null = null;
        if (durationMinutes) {
          const expiry = new Date();
          expiry.setMinutes(expiry.getMinutes() + durationMinutes);
          expiresAt = expiry.toISOString().replace('T', ' ').slice(0, 19);
        }

        insertStmt.run(
          routerId,
          code,
          username,
          null,
          isRadius ? radiusProfileName : (profile || 'default'),
          durationMinutes || null,
          dataLimitMb || null,
          expiresAt,
          isRadius ? rProfileId : null
        );

        if (isRadius) {
          const password = usePassword ? generateCode(8) : '';
          insertHotspotUserStmt.run(
            routerId,
            username,
            password,
            `Voucher: ${code}`,
            rProfileId
          );
        }

        vouchers.push({
          code,
          username,
          password: null,
          profile: isRadius ? radiusProfileName : (profile || 'default'),
          durationMinutes,
          dataLimitMb,
          radiusProfileId: isRadius ? rProfileId : null,
        });
      }
    });

    insertMany();

    let mikrotikSuccess = 0;
    let mikrotikFailed = 0;

    if (mikroTikService.isConnected(routerId) && !isRadius) {
      for (const v of vouchers) {
        try {
          const hours = v.durationMinutes ? Math.floor(v.durationMinutes / 60) : 0;
          const mins = v.durationMinutes ? v.durationMinutes % 60 : 0;
          await mikroTikService.createHotspotUser(routerId, {
            username: v.username,
            profile: v.profile,
            uptimeLimit: v.durationMinutes ? `${hours}:${String(mins).padStart(2, '0')}:00` : undefined,
            comment: `Voucher: ${v.code}`,
          });
          mikrotikSuccess++;
        } catch (err) {
          mikrotikFailed++;
          console.error(`Failed to create hotspot user ${v.username}:`, (err as Error).message);
        }
      }
    }

    res.status(201).json({
      message: `Generated ${quantity} voucher(s)`,
      vouchers,
      mikrotik: {
        connected: mikroTikService.isConnected(routerId),
        success: mikrotikSuccess,
        failed: mikrotikFailed,
      },
    });
  } catch (error: any) {
    console.error('Generate vouchers error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/:voucherId/use', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(
      `UPDATE vouchers SET is_used = 1, used_at = datetime('now') WHERE id = ? AND is_used = 0`
    ).run(req.params.voucherId);

    res.json({ message: 'Voucher marked as used' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/router/:routerId/:voucherId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const voucherId = req.params.voucherId;
    const db = getDb();

    const voucher = db
      .prepare('SELECT * FROM vouchers WHERE id = ? AND router_id = ?')
      .get(voucherId, routerId) as any;

    if (!voucher) {
      res.status(404).json({ error: 'Voucher not found' });
      return;
    }

    const routerRow = db.prepare('SELECT auth_mode FROM routers WHERE id = ?').get(routerId) as any;

    if (mikroTikService.isConnected(routerId) && routerRow?.auth_mode !== 'radius') {
      try {
        const routerUsers = await mikroTikService.getHotspotUsers(routerId);
        const routerUser = routerUsers.find((u: any) => u.name === voucher.username);
        if (routerUser && routerUser['.id']) {
          await mikroTikService.removeHotspotUser(routerId, routerUser['.id']);
        }
      } catch (err) {
        console.error('Failed to delete user from router:', (err as Error).message);
      }
    }

    if (routerRow?.auth_mode === 'radius') {
      db.prepare('DELETE FROM hotspot_users WHERE router_id = ? AND username = ?').run(routerId, voucher.username);
    }

    db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucherId);
    res.json({ message: 'Voucher deleted' });
  } catch (error) {
    console.error('Delete voucher error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/router/:routerId/:code/lookup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const voucher = db
      .prepare('SELECT * FROM vouchers WHERE router_id = ? AND code = ?')
      .get(parseInt(req.params.routerId), req.params.code);

    if (!voucher) {
      res.status(404).json({ error: 'Voucher not found' });
      return;
    }

    res.json(voucher);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/router/:routerId/print', (req: Request, res: Response) => {
  try {
    const rid = parseInt(req.params.routerId);
    const { voucherIds } = req.body;

    const db = getDb();
    let vouchers: any[];

    if (voucherIds && voucherIds.length > 0) {
      const placeholders = voucherIds.map(() => '?').join(',');
      vouchers = db
        .prepare(`SELECT * FROM vouchers WHERE router_id = ? AND id IN (${placeholders})`)
        .all(rid, ...voucherIds);
    } else {
      vouchers = db
        .prepare('SELECT * FROM vouchers WHERE router_id = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 50')
        .all(rid);
    }

    res.json({ vouchers });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
