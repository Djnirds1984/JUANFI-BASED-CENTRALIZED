import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';
import {
  creditMacAccount, bindMacToken, secondsToUptimeLimit, propagateTimeToRouter,
} from '../services/timeCredit';

const router = Router();

// Time crediting lives in services/timeCredit so a coin insert, a voucher
// redemption and a wallet purchase all stack time identically.

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
  let hybridLocalUsers = false; // router.radius_local_users: 1 = hybrid fallback

  if (bodyRouterId) {
    routerId = parseInt(bodyRouterId, 10);
    const routerRow = db.prepare(
      'SELECT id, auth_mode, radius_local_users FROM routers WHERE id = ? AND is_active = 1'
    ).get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found or not active' });
      return;
    }
    authMode = routerRow.auth_mode || 'api';
    hybridLocalUsers = Number(routerRow.radius_local_users) === 1;
  } else if (serverAddress) {
    const hostOnly = serverAddress.split(':')[0];
    const routerRow = db.prepare(
      "SELECT id, auth_mode, radius_local_users FROM routers WHERE host = ? AND is_active = 1"
    ).get(hostOnly) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found or not active' });
      return;
    }
    routerId = routerRow.id;
    authMode = routerRow.auth_mode || 'api';
    hybridLocalUsers = Number(routerRow.radius_local_users) === 1;
  } else {
    res.status(400).json({ error: 'routerId or serverAddress is required' });
    return;
  }
  const isExtend = extend === true;
  const duration = parseInt(durationMinutes) || 0;
  console.log(`coin-auth: request mac=${macNoColon} routerId=${routerId} authMode=${authMode} extend=${isExtend} duration=${duration}min`);

  try {
    const { expiryAt, hadRemaining, accountUsername } = db.transaction(() =>
      creditMacAccount(db, routerId, macNoColon, duration, authMode))();

    bindMacToken(routerId, macNoColon, accountUsername, expiryAt);

    // CoA the live session, refresh the router's local user, purge leftovers.
    // Lives in services/timeCredit because the wallet buys time the exact same
    // way and must not drift from the coin path.
    await propagateTimeToRouter({
      db,
      routerId,
      macNoColon,
      authMode,
      hybridLocalUsers,
      isExtend,
      expiryAt,
      hadRemaining,
      accountUsername,
      logTag: 'coin-auth',
    });

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
    );
    res.json({ success: true, remainingSeconds, extended: isExtend || hadRemaining });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public endpoint: redeem a GENERATED voucher code from the panel portal
// while MAC-as-voucher mode is on. The voucher's minutes are credited to the
// device's MAC identity (exactly like a coin insert) and the voucher is marked
// used in the SAME transaction; the portal then logs in as the MAC. One
// account per device keeps pause/resume, roam and later top-ups working.
router.post('/redeem', async (req: Request, res: Response) => {
  const { mac, code, routerId: bodyRouterId } = req.body;
  const macNoColon = String(mac || '').replace(/:/g, '').replace(/-/g, '').toUpperCase();
  const codeClean = String(code || '').trim().toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(macNoColon) || !codeClean || !bodyRouterId) {
    res.status(400).json({ error: 'mac (12 hex chars), code and routerId are required' });
    return;
  }
  const routerId = parseInt(bodyRouterId, 10);
  const db = getDb();
  const routerRow = db.prepare(
    'SELECT id, auth_mode, radius_local_users FROM routers WHERE id = ? AND is_active = 1'
  ).get(routerId) as any;
  if (!routerRow) {
    res.status(404).json({ error: 'Router not found or not active' });
    return;
  }
  const authMode = routerRow.auth_mode || 'api';

  const voucher = db.prepare('SELECT * FROM vouchers WHERE router_id = ? AND UPPER(code) = ?')
    .get(routerId, codeClean) as any;
  if (!voucher) {
    res.status(404).json({ error: 'Invalid voucher code' });
    return;
  }
  if (Number(voucher.is_used) === 1) {
    res.status(409).json({ error: 'Voucher already used' });
    return;
  }
  if (voucher.expires_at && new Date(String(voucher.expires_at).replace(' ', 'T') + 'Z').getTime() <= Date.now()) {
    res.status(410).json({ error: 'Voucher expired' });
    return;
  }
  const minutes = parseInt(voucher.duration_minutes) || 0;
  if (minutes <= 0) {
    res.status(400).json({ error: 'Voucher has no time value' });
    return;
  }

  try {
    // Mark-used + credit in ONE transaction: any failure rolls back both, so
    // the voucher is never lost nor double-spent.
    const { expiryAt, accountUsername } = db.transaction(() => {
      const marked = db.prepare(
        `UPDATE vouchers SET is_used = 1, used_at = datetime('now') WHERE id = ? AND is_used = 0`
      ).run(voucher.id);
      if (marked.changes !== 1) {
        const e: any = new Error('Voucher already used');
        e.status = 409;
        throw e;
      }
      return creditMacAccount(db, routerId, macNoColon, minutes, authMode);
    })();

    // The voucher's own account must not stay usable after redemption.
    db.prepare('UPDATE hotspot_users SET disabled = 1 WHERE router_id = ? AND username = ?')
      .run(routerId, voucher.username);

    bindMacToken(routerId, macNoColon, accountUsername, expiryAt);

    // API mode only: the router needs a LOCAL MAC user for the CHAP login.
    // RADIUS mode authenticates the MAC account directly (no local user).
    if (authMode !== 'radius' && mikroTikService.isConnected(routerId)) {
      try {
        const routerUsers = await mikroTikService.getHotspotUsers(routerId);
        const normalize = (v: any) => String(v || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
        const existingOnRouter = routerUsers.find((u: any) =>
          normalize(u.name) === macNoColon || normalize(u.name) === accountUsername);
        const msLeft = new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now();
        const limit = secondsToUptimeLimit(Math.max(60, Math.floor(msLeft / 1000)));
        if (!existingOnRouter) {
          await mikroTikService.createHotspotUser(routerId, {
            username: accountUsername, password: '', profile: 'default',
            uptimeLimit: limit, comment: 'Voucher-redeem MAC user',
          });
        } else {
          await mikroTikService.resetHotspotUserCounters(routerId, String(existingOnRouter.name));
          await mikroTikService.setUserUptimeLimit(routerId, String(existingOnRouter.name), limit);
          if (existingOnRouter['.id']) {
            try { await mikroTikService.enableHotspotUser(routerId, existingOnRouter['.id']); } catch {}
          }
        }
        // Remove the voucher's local user so the code cannot login directly.
        const voucherOnRouter = routerUsers.find((u: any) => u.name === voucher.username);
        if (voucherOnRouter && voucherOnRouter['.id']) {
          try { await mikroTikService.removeHotspotUser(routerId, voucherOnRouter['.id']); } catch {}
        }
      } catch (mtErr: any) {
        console.error(`redeem: router push failed for ${macNoColon}:`, mtErr.message);
      }
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
    );
    console.log(`redeem: voucher ${codeClean} -> ${accountUsername} (+${minutes}min, remaining ${remainingSeconds}s) router=${routerId}`);
    res.json({ success: true, remainingSeconds, username: accountUsername });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
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
    const { count, profile, durationMinutes, dataLimitMb, prefix, codeLength, radiusProfileId, usePassword, price } = req.body;

    const quantity = Math.min(count || 1, 100);
    const codeLen = Math.min(Math.max(parseInt(codeLength) || 8, 4), 20);
    // Selling price per voucher (optional, for sales tracking / display).
    const priceValue = price === undefined || price === null || price === '' ? 0 : Number(price);
    if (!Number.isFinite(priceValue) || priceValue < 0 || priceValue > 1000000) {
      res.status(400).json({ error: 'price must be a number from 0 to 1000000' });
      return;
    }
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
      `INSERT INTO vouchers (router_id, code, username, password, profile, duration_minutes, data_limit_mb, expires_at, radius_profile_id, price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertHotspotUserStmt = db.prepare(
      `INSERT INTO hotspot_users (router_id, username, password, comment, radius_profile_id, disabled)
       VALUES (?, ?, ?, ?, ?, 0)`
    );

    const insertMany = db.transaction(() => {
      for (let i = 0; i < quantity; i++) {
        const code = prefix ? `${prefix}-${generateCode(codeLen)}` : generateCode(codeLen);
        const username = code;

        // Voucher validity is NOT the session length: a 60-min voucher must
        // stay redeemable until it is used, not expire 60 min after it was
        // generated (expires_at = created + duration made every voucher
        // "expired" before a customer could ever enter it).
        insertStmt.run(
          routerId,
          code,
          username,
          null,
          isRadius ? radiusProfileName : (profile || 'default'),
          durationMinutes || null,
          dataLimitMb || null,
          null,
          isRadius ? rProfileId : null,
          priceValue
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
          price: priceValue,
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
