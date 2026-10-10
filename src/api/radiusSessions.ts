import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { sendDisconnectRequest } from '../services/radiusServer';
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
