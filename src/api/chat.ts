import { Router, Request, Response, raw } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../database';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const CHAT_IMAGE_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'chat');
const CHAT_IMAGE_PREFIX = '/uploads/chat/';
const MAX_TEXT = 1000;

function normalizeIdentity(macRaw: unknown, ipRaw: unknown): string {
  const mac = String(macRaw || '').trim().toLowerCase().replace(/-/g, ':');
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return mac;
  const ip = String(ipRaw || '').trim();
  if (/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return `ip:${ip}`;
  return '';
}

function parseRouterId(value: unknown): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ensureThread(mac: string, routerId: number) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO chat_threads (mac, router_id) VALUES (?, ?)').run(mac, routerId);
  return db.prepare('SELECT * FROM chat_threads WHERE mac = ? AND router_id = ?').get(mac, routerId) as any;
}

function previewFor(body: string, imagePath: string): string {
  if (imagePath) return '[Image]';
  return body.length > 120 ? `${body.slice(0, 117)}...` : body;
}

function detectImageExt(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function saveChatImage(buf: Buffer): string | null {
  const ext = detectImageExt(buf);
  if (!ext) return null;
  fs.mkdirSync(CHAT_IMAGE_DIR, { recursive: true });
  const name = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(CHAT_IMAGE_DIR, name), buf);
  return CHAT_IMAGE_PREFIX + name;
}

function removeChatImage(imagePath: string) {
  if (!imagePath || !imagePath.startsWith(CHAT_IMAGE_PREFIX)) return;
  try {
    const file = path.join(CHAT_IMAGE_DIR, path.basename(imagePath));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (error: any) {
    console.error('Remove chat image error:', error);
  }
}

const rateBuckets = new Map<string, number[]>();
function allowRate(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (bucket.length >= limit) {
    rateBuckets.set(key, bucket);
    return false;
  }
  bucket.push(now);
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] > 600000) rateBuckets.delete(k);
    }
  }
  return true;
}

function insertMessage(thread: any, sender: 'user' | 'admin', body: string, imagePath: string) {
  const db = getDb();
  const readByAdmin = sender === 'admin' ? 1 : 0;
  const readByUser = sender === 'user' ? 1 : 0;
  const info = db
    .prepare(
      'INSERT INTO chat_messages (thread_id, sender, body, image_path, read_by_admin, read_by_user) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(thread.id, sender, body, imagePath, readByAdmin, readByUser);

  if (sender === 'user') {
    db.prepare(
      "UPDATE chat_threads SET last_message_at = datetime('now'), last_preview = ?, unread_admin = unread_admin + 1 WHERE id = ?",
    ).run(previewFor(body, imagePath), thread.id);
  } else {
    db.prepare(
      "UPDATE chat_threads SET last_message_at = datetime('now'), last_preview = ? WHERE id = ?",
    ).run(previewFor(body, imagePath), thread.id);
  }

  return db
    .prepare('SELECT id, thread_id, sender, body, image_path, created_at FROM chat_messages WHERE id = ?')
    .get(info.lastInsertRowid) as any;
}

// ---- Public portal endpoints (no auth: guests can chat before buying time) ----

router.get('/thread', (req: Request, res: Response) => {
  try {
    const mac = normalizeIdentity(req.query.mac, req.query.ip);
    if (!mac) {
      res.status(400).json({ error: 'Device identity required' });
      return;
    }
    const db = getDb();
    const thread = db
      .prepare('SELECT * FROM chat_threads WHERE mac = ? AND router_id = ?')
      .get(mac, parseRouterId(req.query.routerId)) as any;
    if (!thread) {
      res.json({ thread: null, messages: [], unread: 0 });
      return;
    }
    const after = parseInt(String(req.query.after || '0'), 10) || 0;
    const messages = db
      .prepare(
        'SELECT id, sender, body, image_path, created_at FROM chat_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT 200',
      )
      .all(thread.id, after);
    const unread = db
      .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id = ? AND sender = 'admin' AND read_by_user = 0")
      .get(thread.id) as any;

    res.json({
      thread: { id: thread.id, mac: thread.mac, router_id: thread.router_id },
      messages,
      unread: unread?.n || 0,
    });
  } catch (error: any) {
    console.error('Chat thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/messages', (req: Request, res: Response) => {
  try {
    const mac = normalizeIdentity(req.body?.mac, req.body?.ip);
    if (!mac) {
      res.status(400).json({ error: 'Device identity required' });
      return;
    }
    const body = String(req.body?.body || '').trim().slice(0, MAX_TEXT);
    if (!body) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }
    if (!allowRate(`text:${mac}`, 10, 60000)) {
      res.status(429).json({ error: 'Too many messages, please slow down' });
      return;
    }

    const thread = ensureThread(mac, parseRouterId(req.body?.routerId));
    const message = insertMessage(thread, 'user', body, '');
    res.json({ message });
  } catch (error: any) {
    console.error('Chat send error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/messages/image',
  raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
  (req: Request, res: Response) => {
    try {
      const mac = normalizeIdentity(req.query.mac, req.query.ip);
      if (!mac) {
        res.status(400).json({ error: 'Device identity required' });
        return;
      }
      const buf = req.body as Buffer;
      if (!buf || !Buffer.isBuffer(buf) || !buf.length) {
        res.status(400).json({ error: 'No image received' });
        return;
      }
      if (!allowRate(`image:${mac}`, 1, 5000)) {
        res.status(429).json({ error: 'Please wait before sending another image' });
        return;
      }
      const imagePath = saveChatImage(buf);
      if (!imagePath) {
        res.status(400).json({ error: 'Image must be PNG, JPEG or WebP' });
        return;
      }

      const thread = ensureThread(mac, parseRouterId(req.query.routerId));
      const message = insertMessage(thread, 'user', '', imagePath);
      res.json({ message });
    } catch (error: any) {
      console.error('Chat image error:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

router.post('/read', (req: Request, res: Response) => {
  try {
    const mac = normalizeIdentity(req.body?.mac, req.body?.ip);
    if (!mac) {
      res.status(400).json({ error: 'Device identity required' });
      return;
    }
    const db = getDb();
    const thread = db
      .prepare('SELECT id FROM chat_threads WHERE mac = ? AND router_id = ?')
      .get(mac, parseRouterId(req.body?.routerId)) as any;
    if (thread) {
      db.prepare("UPDATE chat_messages SET read_by_user = 1 WHERE thread_id = ? AND sender = 'admin'").run(thread.id);
    }
    res.json({ ok: true });
  } catch (error: any) {
    console.error('Chat read error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Admin endpoints ----

router.use(authMiddleware);

router.get('/threads', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const threads = db
      .prepare(
        `SELECT t.id, t.mac, t.router_id, t.last_message_at, t.last_preview, t.unread_admin, t.created_at,
                r.name AS router_name
         FROM chat_threads t
         LEFT JOIN routers r ON r.id = t.router_id
         ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
         LIMIT 200`,
      )
      .all();
    res.json(threads);
  } catch (error: any) {
    console.error('Chat threads error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/threads/:id/messages', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as any;
    if (!thread) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    db.prepare("UPDATE chat_messages SET read_by_admin = 1 WHERE thread_id = ? AND sender = 'user'").run(id);
    db.prepare('UPDATE chat_threads SET unread_admin = 0 WHERE id = ?').run(id);

    const before = parseInt(String(req.query.before || '0'), 10) || 0;
    const messages = before
      ? db
          .prepare(
            'SELECT id, thread_id, sender, body, image_path, created_at FROM chat_messages WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT 50',
          )
          .all(id, before)
          .reverse()
      : db
          .prepare(
            'SELECT id, thread_id, sender, body, image_path, created_at FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 50',
          )
          .all(id)
          .reverse();

    res.json({ thread, messages });
  } catch (error: any) {
    console.error('Chat messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/threads/:id/messages', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as any;
    if (!thread) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const body = String(req.body?.body || '').trim().slice(0, MAX_TEXT);
    if (!body) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }
    const message = insertMessage(thread, 'admin', body, '');
    res.json({ message });
  } catch (error: any) {
    console.error('Chat reply error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post(
  '/threads/:id/image',
  raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
  (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const db = getDb();
      const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as any;
      if (!thread) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const buf = req.body as Buffer;
      if (!buf || !Buffer.isBuffer(buf) || !buf.length) {
        res.status(400).json({ error: 'No image received' });
        return;
      }
      const imagePath = saveChatImage(buf);
      if (!imagePath) {
        res.status(400).json({ error: 'Image must be PNG, JPEG or WebP' });
        return;
      }
      const message = insertMessage(thread, 'admin', '', imagePath);
      res.json({ message });
    } catch (error: any) {
      console.error('Chat admin image error:', error);
      res.status(500).json({ error: error.message });
    }
  },
);

router.post('/threads/:id/read', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    db.prepare("UPDATE chat_messages SET read_by_admin = 1 WHERE thread_id = ? AND sender = 'user'").run(id);
    db.prepare('UPDATE chat_threads SET unread_admin = 0 WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error: any) {
    console.error('Chat admin read error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/unread', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COALESCE(SUM(unread_admin), 0) AS unread FROM chat_threads').get() as any;
    const last = db
      .prepare("SELECT COALESCE(MAX(id), 0) AS last_id FROM chat_messages WHERE sender = 'user'")
      .get() as any;
    res.json({ unread: row?.unread || 0, last_id: last?.last_id || 0 });
  } catch (error: any) {
    console.error('Chat unread error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/threads/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const images = db
      .prepare("SELECT image_path FROM chat_messages WHERE thread_id = ? AND image_path != ''")
      .all(id) as any[];
    db.prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(id);
    db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
    images.forEach((row) => removeChatImage(row.image_path));
    res.json({ ok: true });
  } catch (error: any) {
    console.error('Chat delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
