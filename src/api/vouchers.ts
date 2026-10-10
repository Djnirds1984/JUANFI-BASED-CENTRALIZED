import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

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
          expiresAt = expiry.toISOString();
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
