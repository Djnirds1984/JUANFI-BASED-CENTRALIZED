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

router.get('/router/:routerId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const { status, limit, offset } = req.query;
    let query = 'SELECT * FROM vouchers WHERE router_id = ?';
    const params: any[] = [routerId];

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

    const total = (db
      .prepare('SELECT COUNT(*) as count FROM vouchers WHERE router_id = ?')
      .get(routerId) as any).count;

    res.json({ vouchers, total });
  } catch (error) {
    console.error('Get vouchers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/router/:routerId/generate', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const { count, profile, durationMinutes, dataLimitMb, prefix } = req.body;

    const quantity = Math.min(count || 1, 100);
    const db = getDb();

    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const vouchers: any[] = [];
    const insertStmt = db.prepare(
      `INSERT INTO vouchers (router_id, code, username, password, profile, duration_minutes, data_limit_mb, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let mikrotikSuccess = 0;
    let mikrotikFailed = 0;

    const insertMany = db.transaction(() => {
      for (let i = 0; i < quantity; i++) {
        const code = prefix ? `${prefix}-${generateCode()}` : generateCode();
        const username = code;
        const password = generateCode(6);

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
          password,
          profile || 'default',
          durationMinutes || null,
          dataLimitMb || null,
          expiresAt
        );

        if (mikroTikService.isConnected(routerId)) {
          const hours = Math.floor(durationMinutes / 60);
          const mins = durationMinutes % 60;
          mikroTikService.createHotspotUser(routerId, {
            username,
            password,
            profile: profile || 'default',
            uptimeLimit: durationMinutes ? `${hours}:${String(mins).padStart(2, '0')}:00` : undefined,
            comment: `Voucher: ${code}`,
          })
            .then(() => { mikrotikSuccess++; })
            .catch((err) => {
              mikrotikFailed++;
              console.error('Failed to create hotspot user:', err);
            });
        }

        vouchers.push({
          code,
          username,
          password,
          profile: profile || 'default',
          durationMinutes,
          dataLimitMb,
        });
      }
    });

    insertMany();

    // Wait for MikroTik operations to complete
    await new Promise(resolve => setTimeout(resolve, 1500));

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

router.delete('/router/:routerId/:voucherId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const voucher = db
      .prepare('SELECT * FROM vouchers WHERE id = ? AND router_id = ?')
      .get(req.params.voucherId, routerId(req)) as any;

    if (!voucher) {
      res.status(404).json({ error: 'Voucher not found' });
      return;
    }

    db.prepare('DELETE FROM vouchers WHERE id = ?').run(req.params.voucherId);
    res.json({ message: 'Voucher deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

function routerId(req: Request): number {
  return parseInt(req.params.routerId);
}

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
