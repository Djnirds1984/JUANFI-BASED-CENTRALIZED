import { Router, Request, Response } from 'express';
import {
  initSession,
  restoreSession,
  bindSession,
  updateSessionState,
  isValidToken,
} from '../services/deviceSessions';

const router = Router();

// ---------------------------------------------------------------------------
// Basic in-memory rate limiter (these endpoints are reachable pre-login)
// ---------------------------------------------------------------------------
const WINDOW_MS = 60_000;
const MAX_HITS = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request, res: Response, next: () => void): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (hits.size > 2000) {
    for (const [key, entry] of hits) {
      if (entry.resetAt < now) hits.delete(key);
    }
  }

  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > MAX_HITS) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

router.use(rateLimited);

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const normalizeBodyMac = (raw: any): string => String(raw || '').trim().toLowerCase().replace(/-/g, ':');

// POST /api/session/init - first visit: issue (or reuse) the permanent token
router.post('/init', (req: Request, res: Response) => {
  try {
    const mac = normalizeBodyMac(req.body?.mac);
    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'Valid mac is required' });
      return;
    }

    const result = initSession({
      mac,
      ip: req.body?.ip,
      server: req.body?.server,
      routerId: parseInt(req.body?.routerId || '1', 10) || 1,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/restore - roam: token + new MAC -> credentials + remaining
// Pure token+MAC design: the device carries the token, the server compares it
// against the stored token+MAC binding. Same token on a new MAC = same owner
// roaming -> rebind and restore the remaining time. No passwords, no prompts.
router.post('/restore', async (req: Request, res: Response) => {
  try {
    const token = req.body?.token;
    const mac = normalizeBodyMac(req.body?.mac);

    if (!isValidToken(token)) {
      res.status(400).json({ error: 'Valid token is required' });
      return;
    }
    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'Valid mac is required' });
      return;
    }

    const result = await restoreSession({
      token,
      mac,
      ip: req.body?.ip,
      server: req.body?.server,
      routerId: parseInt(req.body?.routerId || '1', 10) || 1,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/bind - after a successful login: token <-> MAC + username
router.post('/bind', (req: Request, res: Response) => {
  try {
    const mac = normalizeBodyMac(req.body?.mac);
    const username = String(req.body?.username || '').trim();

    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'Valid mac is required' });
      return;
    }
    if (!username) {
      res.status(400).json({ error: 'username is required' });
      return;
    }
    if (req.body?.token && !isValidToken(req.body.token)) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    const result = bindSession({
      token: req.body?.token,
      mac,
      username,
      server: req.body?.server,
      sessionTimeLeft: req.body?.sessionTimeLeft,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/session/state - status page heartbeat / pause / logout snapshots
router.post('/state', (req: Request, res: Response) => {
  try {
    const token = req.body?.token;
    if (!isValidToken(token)) {
      res.status(400).json({ error: 'Valid token is required' });
      return;
    }

    const result = updateSessionState({
      token,
      event: req.body?.event,
      remaining: req.body?.remaining,
    });

    if (!result.ok) {
      res.status(404).json(result);
      return;
    }

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
