import { Router, Request, Response, raw } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../database';
import { authMiddleware } from '../middleware/auth';
import { MAX_TRIAL_MINUTES } from '../services/trial';

const router = Router();

const LOGO_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'uploads', 'branding');
const LOGO_URL_PREFIX = '/assets/uploads/branding/';
const SOUND_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'uploads', 'sounds');
const SOUND_URL_PREFIX = '/assets/uploads/sounds/';
const DEFAULT_COMPANY_NAME = 'MikroTik';
// The artwork shipped with the panel. The portal falls back to it whenever no
// banner has been uploaded, so the hero card is never blank.
const DEFAULT_PORTAL_BANNER = '/assets/MainPic.PNG';

// The two coin sounds the customer portal plays. The URL column name is taken
// from this map only, so a request can never steer the UPDATE at another column.
const SOUND_COLUMNS: Record<string, string> = {
  'insert-coin': 'insert_coin_sound',
  'coin-drop': 'coin_drop_sound',
};

// Shipped sounds, used whenever an upload slot is empty. Served by the same
// origin as the portal, so an unauthenticated (still captive) phone can fetch
// them pre-login just like it fetches the portal page itself.
const DEFAULT_SOUNDS: Record<string, string> = {
  'insert-coin': '/hotspot-assets/assets/insertcoinbg.mp3',
  'coin-drop': '/hotspot-assets/assets/coin-received.mp3',
};

function readSettings() {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  const row = db
    .prepare('SELECT currency, company_name, logo_path, portal_banner, insert_coin_sound, coin_drop_sound, trial_enabled, trial_minutes, updated_at FROM system_settings WHERE id = 1')
    .get() as any;
  return {
    currency: row?.currency || 'PHP',
    company_name: row?.company_name || DEFAULT_COMPANY_NAME,
    logo_path: row?.logo_path || '',
    portal_banner: row?.portal_banner || '',
    insert_coin_sound: row?.insert_coin_sound || '',
    coin_drop_sound: row?.coin_drop_sound || '',
    trial_enabled: Number(row?.trial_enabled ?? 1) === 1,
    trial_minutes: parseInt(String(row?.trial_minutes ?? ''), 10) || 15,
    updated_at: row?.updated_at || null,
  };
}

function detectImageExt(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Audio format read from the bytes, never from the filename: the portal has to
 * serve the file with a working content type, and a browser refuses to play a
 * container it cannot decode - the coin slot would look silent and broken.
 */
function detectAudioExt(buf: Buffer): string | null {
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buf.length > 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['M4A ', 'M4B ', 'M4P ', 'mp42', 'isom'].includes(brand)) return 'm4a';
    return null;
  }
  // Frame sync: an empty layer field (00) is AAC/ADTS, anything else is MPEG
  // audio layer I/II/III. Telling them apart keeps the extension honest.
  if (buf.length > 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return (buf[1] & 0x06) === 0 ? 'aac' : 'mp3';
  }
  return null;
}

function removeSoundFile(soundPath: string) {
  if (!soundPath || !soundPath.startsWith(SOUND_URL_PREFIX)) return;
  const file = path.join(SOUND_DIR, path.basename(soundPath));
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (error: any) {
    console.error('Remove sound file error:', error);
  }
}

function soundPaths() {
  const settings = readSettings();
  return { insert_coin: settings.insert_coin_sound, coin_drop: settings.coin_drop_sound };
}

function bannerPaths() {
  return { portal_banner: readSettings().portal_banner, default_banner: DEFAULT_PORTAL_BANNER };
}

function removeBrandingFile(assetPath: string) {
  if (!assetPath || !assetPath.startsWith(LOGO_URL_PREFIX)) return;
  const file = path.join(LOGO_DIR, path.basename(assetPath));
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (error: any) {
    console.error('Remove branding file error:', error);
  }
}

// Public branding so the login screen can show the company name and logo
// before the admin authenticates, and so the customer portal can draw its own
// banner - a device that is still captive only reaches this address.
router.get('/branding', (_req: Request, res: Response) => {
  try {
    const settings = readSettings();
    res.json({
      company_name: settings.company_name,
      logo_path: settings.logo_path,
      portal_banner: settings.portal_banner,
      default_banner: DEFAULT_PORTAL_BANNER,
    });
  } catch (error: any) {
    console.error('Get branding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Public coin sounds so the customer portal can play them before anyone
// authenticates - the insert-coin loop starts while the device is still captive.
router.get('/sounds', (_req: Request, res: Response) => {
  try {
    const paths = soundPaths();
    res.json({
      insert_coin: paths.insert_coin,
      coin_drop: paths.coin_drop,
      defaults: {
        insert_coin: DEFAULT_SOUNDS['insert-coin'],
        coin_drop: DEFAULT_SOUNDS['coin-drop'],
      },
    });
  } catch (error: any) {
    console.error('Get sounds error:', error);
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

    // Portal free trial (TRIAL button). Minutes are clamped to a sane range so
    // a typo cannot hand out a week of "free" time - and so the grant matches
    // what the portal button advertises (MAX_TRIAL_MINUTES).
    if (req.body?.trial_enabled !== undefined) {
      updates.push('trial_enabled = ?');
      params.push(req.body.trial_enabled ? 1 : 0);
    }

    if (req.body?.trial_minutes !== undefined) {
      const trialMinutes = parseInt(String(req.body.trial_minutes), 10);
      if (!Number.isFinite(trialMinutes) || trialMinutes < 1 || trialMinutes > MAX_TRIAL_MINUTES) {
        res.status(400).json({ error: `Trial minutes must be between 1 and ${MAX_TRIAL_MINUTES}` });
        return;
      }
      updates.push('trial_minutes = ?');
      params.push(trialMinutes);
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
      removeBrandingFile(previous?.logo_path || '');

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
    removeBrandingFile(previous?.logo_path || '');
    res.json(readSettings());
  } catch (error: any) {
    console.error('Delete logo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Browsers label a picked picture from its own guess (and sometimes send no
// type at all), so the raw parser takes the generic octet-stream too. What the
// file really is comes from the magic-byte sniff, never from the label.
const IMAGE_BODY_TYPES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/octet-stream',
];

// The picture at the top of the customer portal. Same idiom as the logo: the
// bytes decide the extension, and the file in use is only removed once the new
// one is on disk and recorded - an interrupted upload never blanks the hero.
router.post(
  '/banner',
  raw({ type: IMAGE_BODY_TYPES, limit: '5mb' }),
  (req: Request, res: Response) => {
    try {
      const buf = req.body as Buffer;
      if (!buf || !Buffer.isBuffer(buf) || !buf.length) {
        res.status(400).json({ error: 'No banner image received' });
        return;
      }
      const ext = detectImageExt(buf);
      if (!ext) {
        res.status(400).json({ error: 'Banner must be a PNG, JPEG or WebP image' });
        return;
      }

      fs.mkdirSync(LOGO_DIR, { recursive: true });
      const db = getDb();
      db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
      const previous = db.prepare('SELECT portal_banner FROM system_settings WHERE id = 1').get() as any;

      const filename = `banner-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(LOGO_DIR, filename), buf);
      db.prepare("UPDATE system_settings SET portal_banner = ?, updated_at = datetime('now') WHERE id = 1").run(LOGO_URL_PREFIX + filename);
      removeBrandingFile(previous?.portal_banner || '');

      res.json(bannerPaths());
    } catch (error: any) {
      console.error('Upload banner error:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Clearing the banner falls back to the shipped artwork, it never leaves a hole.
router.delete('/banner', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
    const previous = db.prepare('SELECT portal_banner FROM system_settings WHERE id = 1').get() as any;
    db.prepare("UPDATE system_settings SET portal_banner = ?, updated_at = datetime('now') WHERE id = 1").run('');
    removeBrandingFile(previous?.portal_banner || '');
    res.json(bannerPaths());
  } catch (error: any) {
    console.error('Delete banner error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clients upload audio as a plain byte stream, so the raw parser accepts
// everything the browser might label the File with plus octet-stream, and the
// real format check is the magic-byte sniff above.
const AUDIO_BODY_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/ogg', 'audio/aac', 'audio/x-m4a', 'application/octet-stream',
];

router.post(
  '/sounds/:kind',
  raw({ type: AUDIO_BODY_TYPES, limit: '10mb' }),
  (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind || '');
      const column = SOUND_COLUMNS[kind];
      if (!column) {
        res.status(400).json({ error: 'Unknown sound - use insert-coin or coin-drop' });
        return;
      }
      const buf = req.body as Buffer;
      if (!buf || !Buffer.isBuffer(buf) || !buf.length) {
        res.status(400).json({ error: 'No audio file received' });
        return;
      }
      const ext = detectAudioExt(buf);
      if (!ext) {
        res.status(400).json({ error: 'That file is not playable audio - use MP3, WAV, OGG, M4A or AAC' });
        return;
      }

      fs.mkdirSync(SOUND_DIR, { recursive: true });
      const db = getDb();
      db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
      const previous = db.prepare(`SELECT ${column} FROM system_settings WHERE id = 1`).get() as any;

      const filename = `${kind}-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(SOUND_DIR, filename), buf);
      db.prepare(`UPDATE system_settings SET ${column} = ?, updated_at = datetime('now') WHERE id = 1`).run(SOUND_URL_PREFIX + filename);
      // Only drop the replaced file once the new one is on disk and recorded,
      // so a failed write can never leave the portal pointing at nothing.
      removeSoundFile(previous?.[column] || '');

      res.json(soundPaths());
    } catch (error: any) {
      console.error('Upload sound error:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Clearing a slot falls back to the shipped sound, it never mutes the portal.
router.delete('/sounds/:kind', (req: Request, res: Response) => {
  try {
    const column = SOUND_COLUMNS[String(req.params.kind || '')];
    if (!column) {
      res.status(400).json({ error: 'Unknown sound - use insert-coin or coin-drop' });
      return;
    }
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
    const previous = db.prepare(`SELECT ${column} FROM system_settings WHERE id = 1`).get() as any;
    db.prepare(`UPDATE system_settings SET ${column} = ?, updated_at = datetime('now') WHERE id = 1`).run('');
    removeSoundFile(previous?.[column] || '');
    res.json(soundPaths());
  } catch (error: any) {
    console.error('Delete sound error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
