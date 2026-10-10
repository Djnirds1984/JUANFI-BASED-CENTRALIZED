import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/router/:routerId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const profiles = db.prepare(
      `SELECT rp.*, 
       (SELECT COUNT(*) FROM hotspot_users hu WHERE hu.radius_profile_id = rp.id AND hu.disabled = 0) as user_count
       FROM radius_profiles rp
       WHERE rp.router_id = ?
       ORDER BY rp.is_default DESC, rp.name ASC`
    ).all(routerId);

    res.json(profiles);
  } catch (error: any) {
    console.error('Get RADIUS profiles error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/:profileId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileId = parseInt(req.params.profileId);
    const db = getDb();

    const profile = db.prepare(
      'SELECT * FROM radius_profiles WHERE id = ? AND router_id = ?'
    ).get(profileId, routerId) as any;

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    res.json(profile);
  } catch (error: any) {
    console.error('Get RADIUS profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const routerRow = db.prepare('SELECT id FROM routers WHERE id = ?').get(routerId);
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const {
      name, rate_rx, rate_tx, burst_rx, burst_tx,
      burst_threshold_rx, burst_threshold_tx, burst_time_rx, burst_time_tx,
      session_timeout, idle_timeout,
      quota_rx, quota_tx, quota_total,
      validity_period, validity_fixed_expiry,
      shared_users, price, is_default, description,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Profile name is required' });
      return;
    }

    if (is_default) {
      db.prepare('UPDATE radius_profiles SET is_default = 0 WHERE router_id = ?').run(routerId);
    }

    const result = db.prepare(
      `INSERT INTO radius_profiles
       (router_id, name, rate_rx, rate_tx, burst_rx, burst_tx, burst_threshold_rx, burst_threshold_tx,
        burst_time_rx, burst_time_tx, session_timeout, idle_timeout,
        quota_rx, quota_tx, quota_total, validity_period, validity_fixed_expiry,
        shared_users, price, is_default, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      routerId, name,
      rate_rx || 0, rate_tx || 0,
      burst_rx || 0, burst_tx || 0,
      burst_threshold_rx || 0, burst_threshold_tx || 0,
      burst_time_rx || 0, burst_time_tx || 0,
      session_timeout || 0, idle_timeout || 0,
      quota_rx || 0, quota_tx || 0, quota_total || 0,
      validity_period || 0, validity_fixed_expiry || null,
      shared_users || 1, price || 0, is_default ? 1 : 0, description || null,
    );

    res.status(201).json({ message: 'RADIUS profile created', id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Create RADIUS profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/:profileId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileId = parseInt(req.params.profileId);
    const db = getDb();

    const existing = db.prepare(
      'SELECT id FROM radius_profiles WHERE id = ? AND router_id = ?'
    ).get(profileId, routerId);

    if (!existing) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    const {
      name, rate_rx, rate_tx, burst_rx, burst_tx,
      burst_threshold_rx, burst_threshold_tx, burst_time_rx, burst_time_tx,
      session_timeout, idle_timeout,
      quota_rx, quota_tx, quota_total,
      validity_period, validity_fixed_expiry,
      shared_users, price, is_default, description,
    } = req.body;

    if (is_default) {
      db.prepare('UPDATE radius_profiles SET is_default = 0 WHERE router_id = ? AND id != ?').run(routerId, profileId);
    }

    db.prepare(
      `UPDATE radius_profiles SET
        name = ?, rate_rx = ?, rate_tx = ?, burst_rx = ?, burst_tx = ?,
        burst_threshold_rx = ?, burst_threshold_tx = ?, burst_time_rx = ?, burst_time_tx = ?,
        session_timeout = ?, idle_timeout = ?,
        quota_rx = ?, quota_tx = ?, quota_total = ?,
        validity_period = ?, validity_fixed_expiry = ?,
        shared_users = ?, price = ?, is_default = ?, description = ?,
        updated_at = datetime('now')
       WHERE id = ? AND router_id = ?`
    ).run(
      name, rate_rx || 0, rate_tx || 0, burst_rx || 0, burst_tx || 0,
      burst_threshold_rx || 0, burst_threshold_tx || 0, burst_time_rx || 0, burst_time_tx || 0,
      session_timeout || 0, idle_timeout || 0,
      quota_rx || 0, quota_tx || 0, quota_total || 0,
      validity_period || 0, validity_fixed_expiry || null,
      shared_users || 1, price || 0, is_default ? 1 : 0, description || null,
      profileId, routerId,
    );

    res.json({ message: 'RADIUS profile updated' });
  } catch (error: any) {
    console.error('Update RADIUS profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/:profileId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileId = parseInt(req.params.profileId);
    const db = getDb();

    const existing = db.prepare(
      'SELECT id FROM radius_profiles WHERE id = ? AND router_id = ?'
    ).get(profileId, routerId);

    if (!existing) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    const userCount = (db.prepare(
      'SELECT COUNT(*) as c FROM hotspot_users WHERE radius_profile_id = ?'
    ).get(profileId) as any)?.c || 0;

    if (userCount > 0) {
      db.prepare('UPDATE hotspot_users SET radius_profile_id = NULL WHERE radius_profile_id = ?').run(profileId);
    }

    db.prepare('DELETE FROM radius_profiles WHERE id = ? AND router_id = ?').run(profileId, routerId);
    res.json({ message: 'RADIUS profile deleted' });
  } catch (error: any) {
    console.error('Delete RADIUS profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
