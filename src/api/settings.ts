import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

function readSettings() {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  const row = db.prepare('SELECT currency, updated_at FROM system_settings WHERE id = 1').get() as any;
  return {
    currency: row?.currency || 'PHP',
    updated_at: row?.updated_at || null,
  };
}

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(readSettings());
  } catch (error: any) {
    console.error('Get system settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/', (req: Request, res: Response) => {
  try {
    const currency = String(req.body?.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      res.status(400).json({ error: 'Currency must be a 3-letter ISO 4217 code' });
      return;
    }
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
    db.prepare("UPDATE system_settings SET currency = ?, updated_at = datetime('now') WHERE id = 1").run(currency);
    res.json(readSettings());
  } catch (error: any) {
    console.error('Update system settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
