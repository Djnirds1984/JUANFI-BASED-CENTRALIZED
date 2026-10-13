import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/** MikroTik time (`00:45:10`, `1d02:30:00`, `02:30:00`) -> seconds. */
function mikrotikUptimeToSeconds(value: any): number {
  const str = String(value || '').trim();
  if (!str) return 0;
  const daysMatch = str.match(/^(\d+)d/);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 0;
  const clock = str.includes(':') ? str.slice(str.indexOf(':') - 2) : str;
  const parts = clock.split(':').map((p) => parseInt(p, 10) || 0);
  let seconds = days * 86400;
  if (parts.length === 3) seconds += parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds += parts[0] * 60 + parts[1];
  else if (parts.length === 1 && !daysMatch) seconds += parts[0] || 0;
  return Math.max(0, seconds);
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

  const upsert = db.transaction(() => {
    const existing = db.prepare(
      'SELECT id, expiry_at FROM hotspot_users WHERE router_id = ? AND username = ?'
    ).get(routerId, macNoColon) as any;

    let expiryAt: string;
    const now = new Date();

    if (existing) {
      if (isExtend && existing.expiry_at) {
        const currentExpiry = new Date(existing.expiry_at + 'Z').getTime();
        if (currentExpiry > now.getTime()) {
          expiryAt = new Date(currentExpiry + duration * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        } else {
          expiryAt = new Date(now.getTime() + duration * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        }
      } else {
        expiryAt = new Date(now.getTime() + duration * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      }
      db.prepare(
        `UPDATE hotspot_users SET disabled = 0, expiry_at = ?, updated_at = datetime('now'),
          source = ?, profile = 'default' WHERE id = ?`
      ).run(expiryAt, authMode === 'radius' ? 'radius' : 'api', existing.id);
    } else {
      expiryAt = new Date(now.getTime() + duration * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      db.prepare(
        `INSERT INTO hotspot_users (router_id, username, password, profile, comment, disabled, expiry_at, source)
         VALUES (?, ?, '', 'default', 'Coin-insert MAC user', 0, ?, ?)`
      ).run(routerId, macNoColon, expiryAt, authMode === 'radius' ? 'radius' : 'api');
    }
    return expiryAt;
  });

  try {
    const expiryAt = upsert();

    // Extend/top-up: NEVER kick/disconnect the live session here.
    // The live /ip/hotspot/active session keeps running and stays online;
    // the added minutes are stacked in expiry_at (wall clock). To make the
    // router's time-left reflect the new total WITHOUT dropping the device,
    // send a RADIUS CoA-Request (Session-Timeout) for the live session —
    // MikroTik updates the active session in place, no re-auth needed.
    // Best-effort only — never fail the payment.
    if (isExtend) {
      try {
        const sess = db.prepare(
          `SELECT session_id, nas_ip FROM radius_sessions
           WHERE router_id = ? AND username = ? AND status = 'active'
           ORDER BY updated_at DESC LIMIT 1`
        ).get(routerId, macNoColon) as any;
        if (sess?.session_id && sess?.nas_ip) {
          const { sendCoASessionTimeout } = await import('../services/radiusServer');
          const remainingSec = Math.max(
            1,
            Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
          );
          sendCoASessionTimeout(routerId, sess.session_id, sess.nas_ip, remainingSec);
        }
      } catch (coaErr: any) {
        console.error(`coin-auth: CoA extend failed for ${macNoColon} on router ${routerId}:`, coaErr.message);
      }
    }

    // Non-RADIUS (API) mode: MikroTik authenticates against its LOCAL hotspot
    // user list, so the MAC user must exist ON THE ROUTER or CHAP login is
    // rejected and the device stays in the captive portal with no internet.
    // (RADIUS mode needs no push — the router queries the panel DB.)
    if (authMode !== 'radius' && mikroTikService.isConnected(routerId)) {
      try {
        const routerUsers = await mikroTikService.getHotspotUsers(routerId);
        const existingOnRouter = routerUsers.find((u: any) => u.name === macNoColon);
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
          // Top-up on an already-logged-in device:
          // - validity expiration (panel DB expiry_at) stacks: remaining + new minutes.
          // - router session-time-left = limit-uptime MINUS accumulated uptime.
          //   Just raising limit-uptime alone leaves session-time-left stuck
          //   (e.g. at the first 6 min). So: add the new minutes to the CURRENT
          //   limit and reset the accumulated uptime counter, giving a fresh
          //   session-time-left equal to prior-remaining + new minutes.
          const oldLimitSec = mikrotikUptimeToSeconds(
            existingOnRouter['limit-uptime'] ?? (existingOnRouter as any)['uptime-limit']
          );
          const priorRemainingSec = oldLimitSec > 0
            ? Math.max(0, oldLimitSec - mikrotikUptimeToSeconds(existingOnRouter.uptime))
            : Math.max(0, Math.floor(msLeft / 1000));
          const newLimitSec = Math.max(60, (oldLimitSec > 0 ? oldLimitSec : priorRemainingSec) + duration * 60);
          await mikroTikService.resetHotspotUserCounters(routerId, macNoColon);
          await mikroTikService.setUserUptimeLimit(routerId, macNoColon, secondsToUptimeLimit(newLimitSec));
          if (existingOnRouter['.id']) {
            try { await mikroTikService.enableHotspotUser(routerId, existingOnRouter['.id']); } catch {}
          }
        }
      } catch (mtErr: any) {
        // Panel DB is authoritative for check-session; log but don't fail the
        // payment. The device can still retry login once the router syncs.
        console.error(`coin-auth: failed to push MAC user ${macNoColon} to router ${routerId}:`, mtErr.message);
      }
    }

    res.json({ success: true });
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
