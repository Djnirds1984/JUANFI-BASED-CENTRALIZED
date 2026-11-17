import { Router, Request, Response, raw } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../database';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const LOGO_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'uploads', 'branding');
const LOGO_URL_PREFIX = '/assets/uploads/branding/';
const DEFAULT_COMPANY_NAME = 'MikroTik';

function readSettings() {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  const row = db
    .prepare('SELECT currency, company_name, logo_path, updated_at FROM system_settings WHERE id = 1')
    .get() as any;
  return {
    currency: row?.currency || 'PHP',
    company_name: row?.company_name || DEFAULT_COMPANY_NAME,
    logo_path: row?.logo_path || '',
    updated_at: row?.updated_at || null,
  };
}

function detectImageExt(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function removeLogoFile(logoPath: string) {
  if (!logoPath || !logoPath.startsWith(LOGO_URL_PREFIX)) return;
  const file = path.join(LOGO_DIR, path.basename(logoPath));
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (error: any) {
    console.error('Remove logo file error:', error);
  }
}

// Public branding so the login screen can show the company name and logo
// before the admin authenticates.
router.get('/branding', (_req: Request, res: Response) => {
  try {
    const settings = readSettings();
    res.json({ company_name: settings.company_name, logo_path: settings.logo_path });
  } catch (error: any) {
    console.error('Get branding error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.use(authMiddleware);

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
    const updates: string[] = [];
    const params: any[] = [];

    if (req.body?.currency !== undefined) {
      const currency = String(req.body.currency || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        res.status(400).json({ error: 'Currency must be a 3-letter ISO 4217 code' });
        return;
      }
      updates.push('currency = ?');
      params.push(currency);
    }

    if (req.body?.company_name !== undefined) {
      const companyName = String(req.body.company_name || '').trim().slice(0, 40);
      if (!companyName) {
        res.status(400).json({ error: 'Panel name cannot be empty' });
        return;
      }
      updates.push('company_name = ?');
      params.push(companyName);
    }

    if (!updates.length) {
      res.status(400).json({ error: 'No settings provided' });
      return;
    }

    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
    db.prepare(
      `UPDATE system_settings SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = 1`,
    ).run(...params);
    res.json(readSettings());
  } catch (error: any) {
    console.error('Update system settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/logo',
  raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
  (req: Request, res: Response) => {
    try {
      const buf = req.body as Buffer;
      if (!buf || !Buffer.isBuffer(buf) || !buf.length) {
        res.status(400).json({ error: 'No logo image received' });
        return;
      }
      const ext = detectImageExt(buf);
      if (!ext) {
        res.status(400).json({ error: 'Logo must be a PNG, JPEG or WebP image' });
        return;
      }

      fs.mkdirSync(LOGO_DIR, { recursive: true });
      const db = getDb();
      db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
      const previous = db.prepare('SELECT logo_path FROM system_settings WHERE id = 1').get() as any;

      const filename = `logo-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(LOGO_DIR, filename), buf);
      const logoPath = LOGO_URL_PREFIX + filename;

      db.prepare("UPDATE system_settings SET logo_path = ?, updated_at = datetime('now') WHERE id = 1").run(logoPath);
      removeLogoFile(previous?.logo_path || '');

      res.json(readSettings());
    } catch (error: any) {
      console.error('Upload logo error:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

router.delete('/logo', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
    const previous = db.prepare('SELECT logo_path FROM system_settings WHERE id = 1').get() as any;
    db.prepare("UPDATE system_settings SET logo_path = '', updated_at = datetime('now') WHERE id = 1").run();
    removeLogoFile(previous?.logo_path || '');
    res.json(readSettings());
  } catch (error: any) {
    console.error('Delete logo error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
