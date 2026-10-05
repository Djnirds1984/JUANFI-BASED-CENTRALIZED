import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/router/:routerId/system', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const info = await mikroTikService.getSystemInfo(routerId);
    res.json(info);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/interfaces', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const interfaces = await mikroTikService.getInterfaces(routerId);
    res.json(interfaces);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/traffic', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const traffic = await mikroTikService.getInterfaceTraffic(routerId);
    res.json(traffic);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/history', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const { hours } = req.query;
    const limitHours = parseInt((hours as string) || '24');

    const logs = db
      .prepare(
        `SELECT * FROM monitoring_logs
         WHERE router_id = ? AND recorded_at >= datetime('now', ?)
         ORDER BY recorded_at DESC`
      )
      .all(routerId, `-${limitHours} hours`);

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const routers = db.prepare('SELECT * FROM routers WHERE is_active = 1').all() as any[];

    const summary = await Promise.all(
      routers.map(async (r) => {
        const connected = mikroTikService.isConnected(r.id);
        let systemInfo = null;

        if (connected) {
          try {
            systemInfo = await mikroTikService.getSystemInfo(r.id);
          } catch (err) {
            // ignore
          }
        }

        return {
          id: r.id,
          name: r.name,
          host: r.host,
          connected,
          systemInfo,
        };
      })
    );

    res.json({
      totalRouters: routers.length,
      connectedRouters: summary.filter((s) => s.connected).length,
      routers: summary,
    });
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
