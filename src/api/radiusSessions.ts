import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { sendDisconnectRequest, sendCoASessionTimeout } from '../services/radiusServer';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/router/:routerId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();
    const { status, limit } = req.query;

    let query = `SELECT rs.*, rp.name as profile_name
                 FROM radius_sessions rs
                 LEFT JOIN radius_profiles rp ON rp.id = rs.profile_id
                 WHERE rs.router_id = ?`;
    const params: any[] = [routerId];

    if (status === 'active') {
      query += ` AND rs.status = 'active'`;
    } else if (status === 'stopped') {
      query += ` AND rs.status = 'stopped'`;
    }

    query += ` ORDER BY rs.started_at DESC LIMIT ?`;
    params.push(limit ? parseInt(limit as string) : 100);

    const sessions = db.prepare(query).all(...params);
    res.json(sessions);
  } catch (error: any) {
    console.error('Get RADIUS sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/active', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const sessions = db.prepare(
      `SELECT rs.*, rp.name as profile_name
       FROM radius_sessions rs
       LEFT JOIN radius_profiles rp ON rp.id = rs.profile_id
       WHERE rs.router_id = ? AND rs.status = 'active'
       ORDER BY rs.started_at DESC`
    ).all(routerId);

    res.json(sessions);
  } catch (error: any) {
    console.error('Get active RADIUS sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add time to the USER behind a session (admin top-up, not a voucher/coin).
// Stacks the account's expiry and applies it to the live session with a CoA,
// so no disconnect is needed.
router.post('/router/:routerId/:sessionId/extend', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const sessionId = parseInt(req.params.sessionId);
    const minutes = parseInt(req.body?.minutes, 10);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      res.status(400).json({ error: 'minutes (a positive number) is required' });
      return;
    }

    const db = getDb();
    const session = db.prepare(
      'SELECT * FROM radius_sessions WHERE id = ? AND router_id = ?'
    ).get(sessionId, routerId) as any;

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const username = String(session.username || '');
    if (!username) {
      res.status(400).json({ error: 'Session has no username' });
      return;
    }

    // Account lookup, tolerating the router's username casing / MAC separators.
    const mac = username.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const macMatch = mac.length === 12 ? mac : '';
    const user = db.prepare(
      `SELECT id, username, expiry_at FROM hotspot_users
       WHERE router_id = ? AND disabled = 0
         AND (LOWER(username) = LOWER(?)
              OR ( ? <> '' AND UPPER(REPLACE(REPLACE(username, ':', ''), '-', '')) = ?))
       ORDER BY id DESC LIMIT 1`
    ).get(routerId, username, macMatch, macMatch) as any;

    if (!user) {
      res.status(404).json({ error: 'No hotspot user found for this session' });
      return;
    }

    const now = Date.now();
    const current = user.expiry_at
      ? new Date(String(user.expiry_at).replace(' ', 'T') + 'Z').getTime()
      : 0;
    const expiryAt = new Date((current > now ? current : now) + minutes * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(
      "UPDATE hotspot_users SET disabled = 0, expiry_at = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(expiryAt, user.id);

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
    );

    // Apply to the live session with a CoA (no disconnect).
    let coa = 'none';
    try {
      const realId = session.session_id && !String(session.session_id).startsWith('coin_')
        ? String(session.session_id) : '';
      const routerRow = db.prepare('SELECT host FROM routers WHERE id = ?').get(routerId) as any;
      const nasIp = String(routerRow?.host || '').split(':')[0];

      let framedIp = '';
      if (mikroTikService.isConnected(routerId)) {
        const live = await mikroTikService.getActiveConnections(routerId);
        const conn = (Array.isArray(live) ? live : []).find((c: any) =>
          String(c.user || '').toLowerCase() === username.toLowerCase() ||
          (macMatch && String(c.mac || c['mac-address'] || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase() === macMatch)
        );
        if (conn) framedIp = String(conn.address || '').split('/')[0].split(':')[0];
      }

      if (realId && session.nas_ip) {
        sendCoASessionTimeout(routerId, realId, session.nas_ip, remainingSeconds, username, framedIp || undefined);
        coa = 'session-id';
      } else if (nasIp) {
        sendCoASessionTimeout(routerId, '', nasIp, remainingSeconds, username, framedIp || undefined);
        coa = 'user-name';
      }
    } catch (coaErr: any) {
      console.error('extend session CoA error:', coaErr.message);
    }

    res.json({
      message: `Added ${minutes} min to ${user.username}`,
      username: user.username,
      remainingSeconds,
      coa,
    });
  } catch (error: any) {
    console.error('Extend session error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/:sessionId/terminate', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const sessionId = parseInt(req.params.sessionId);
    const db = getDb();

    const session = db.prepare(
      `SELECT * FROM radius_sessions WHERE id = ? AND router_id = ? AND status = 'active'`
    ).get(sessionId, routerId) as any;

    if (!session) {
      res.status(404).json({ error: 'Active session not found' });
      return;
    }

    sendDisconnectRequest(routerId, session.session_id, session.nas_ip || '');

    db.prepare(
      `UPDATE radius_sessions SET status = 'stopped', stopped_at = datetime('now'),
       terminate_cause = 'Admin-Reset' WHERE id = ?`
    ).run(sessionId);

    res.json({ message: 'Session terminated, Disconnect-Request sent to NAS' });
  } catch (error: any) {
    console.error('Terminate RADIUS session error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/:sessionId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const sessionId = parseInt(req.params.sessionId);
    const db = getDb();

    const session = db.prepare(
      `SELECT * FROM radius_sessions WHERE id = ? AND router_id = ? AND status = 'active'`
    ).get(sessionId, routerId) as any;

    if (session) {
      sendDisconnectRequest(routerId, session.session_id, session.nas_ip || '');
      db.prepare(
        `UPDATE radius_sessions SET status = 'stopped', stopped_at = datetime('now'),
         terminate_cause = 'Admin-Reset' WHERE id = ?`
      ).run(sessionId);
    }

    db.prepare('DELETE FROM radius_sessions WHERE id = ? AND router_id = ?').run(sessionId, routerId);
    res.json({ message: 'Session removed' });
  } catch (error: any) {
    console.error('Delete RADIUS session error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/stats', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const activeCount = (db.prepare(
      `SELECT COUNT(*) as c FROM radius_sessions WHERE router_id = ? AND status = 'active'`
    ).get(routerId) as any)?.c || 0;

    const todaySessions = (db.prepare(
      `SELECT COUNT(*) as c FROM radius_sessions
       WHERE router_id = ? AND started_at >= date('now')`
    ).get(routerId) as any)?.c || 0;

    const totalBytes = (db.prepare(
      `SELECT COALESCE(SUM(input_octets), 0) as total_in,
              COALESCE(SUM(output_octets), 0) as total_out
       FROM radius_sessions
       WHERE router_id = ? AND started_at >= date('now')`
    ).get(routerId) as any) || { total_in: 0, total_out: 0 };

    res.json({
      activeSessions: activeCount,
      todaySessions,
      todayBytesIn: totalBytes.total_in,
      todayBytesOut: totalBytes.total_out,
    });
  } catch (error: any) {
    console.error('Get RADIUS session stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
