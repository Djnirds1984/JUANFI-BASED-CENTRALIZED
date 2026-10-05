import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/router/:routerId/queues', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const queues = await mikroTikService.getQueues(routerId);
    res.json(queues);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/queues', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const { name, target, maxLimit, burst, priority, comment } = req.body;

    if (!name || !target || !maxLimit) {
      res.status(400).json({ error: 'Name, target, and max-limit are required' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.createQueue(routerId, {
      name,
      target,
      maxLimit,
      burst,
      priority,
      comment,
    });

    res.status(201).json({ message: 'Queue created successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/queues/:queueId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const queueId = req.params.queueId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.removeQueue(routerId, queueId);
    res.json({ message: 'Queue removed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/profiles', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const profiles = db
      .prepare('SELECT * FROM bandwidth_profiles WHERE router_id = ? ORDER BY name')
      .all(routerId);
    res.json(profiles);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/router/:routerId/profiles', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const { name, rateLimit, burst, priority, description } = req.body;

    if (!name || !rateLimit) {
      res.status(400).json({ error: 'Name and rate-limit are required' });
      return;
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO bandwidth_profiles (router_id, name, rate_limit, burst, priority, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(routerId, name, rateLimit, burst || null, priority || 8, description || null);

    res.status(201).json({ message: 'Bandwidth profile created' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/router/:routerId/profiles/:profileId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM bandwidth_profiles WHERE id = ?').run(req.params.profileId);
    res.json({ message: 'Profile deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
