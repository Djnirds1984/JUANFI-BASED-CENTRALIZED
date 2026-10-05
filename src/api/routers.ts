import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { mikroTikService, RouterConnection } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const routers = db.prepare('SELECT * FROM routers ORDER BY name').all();

    const routersWithStatus = (routers as any[]).map((r) => ({
      ...r,
      connected: mikroTikService.isConnected(r.id),
    }));

    res.json(routersWithStatus);
  } catch (error) {
    console.error('Get routers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);

    if (!router) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    res.json({
      ...(router as any),
      connected: mikroTikService.isConnected((router as any).id),
    });
  } catch (error) {
    console.error('Get router error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, host, port, username, password, description, use_rest_api } = req.body;

    if (!name || !host || !username || !password) {
      res.status(400).json({ error: 'Name, host, username, and password are required' });
      return;
    }

    const db = getDb();
    const result = db
      .prepare(
        'INSERT INTO routers (name, host, port, username, password, description, use_rest_api) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(name, host, port || 8728, username, password, description || null, use_rest_api ? 1 : 0);

    const routerConn: RouterConnection = {
      id: result.lastInsertRowid as number,
      name,
      host,
      port: port || 8728,
      username,
      password,
      useRestApi: !!use_rest_api,
    };

    let connected = false;
    try {
      await mikroTikService.connect(routerConn);
      connected = true;
    } catch (err) {
      console.warn('Could not connect to router:', err);
    }

    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      host,
      port: port || 8728,
      username,
      description,
      use_rest_api: use_rest_api ? 1 : 0,
      connected,
    });
  } catch (error) {
    console.error('Create router error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, host, port, username, password, description, is_active, use_rest_api } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    db.prepare(
      `UPDATE routers SET name = ?, host = ?, port = ?, username = ?, password = ?, description = ?, is_active = ?, use_rest_api = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      name || (existing as any).name,
      host || (existing as any).host,
      port || (existing as any).port,
      username || (existing as any).username,
      password || (existing as any).password,
      description !== undefined ? description : (existing as any).description,
      is_active !== undefined ? is_active : (existing as any).is_active,
      use_rest_api !== undefined ? (use_rest_api ? 1 : 0) : (existing as any).use_rest_api,
      req.params.id
    );

    res.json({ message: 'Router updated successfully' });
  } catch (error) {
    console.error('Update router error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id);

    if (!existing) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    await mikroTikService.disconnect(parseInt(req.params.id));
    db.prepare('DELETE FROM routers WHERE id = ?').run(req.params.id);

    res.json({ message: 'Router deleted successfully' });
  } catch (error) {
    console.error('Delete router error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/connect', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id) as any;

    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const routerConn: RouterConnection = {
      id: routerRow.id,
      name: routerRow.name,
      host: routerRow.host,
      port: routerRow.port,
      username: routerRow.username,
      password: routerRow.password,
      useRestApi: !!routerRow.use_rest_api,
    };

    await mikroTikService.connect(routerConn);
    res.json({ message: 'Connected successfully', connected: true });
  } catch (error: any) {
    console.error('Connect router error:', error);
    res.status(500).json({ error: `Connection failed: ${error.message}` });
  }
});

router.post('/:id/disconnect', async (req: Request, res: Response) => {
  try {
    await mikroTikService.disconnect(parseInt(req.params.id));
    res.json({ message: 'Disconnected successfully', connected: false });
  } catch (error) {
    console.error('Disconnect router error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    if (!mikroTikService.isConnected(parseInt(req.params.id))) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const info = await mikroTikService.getSystemInfo(parseInt(req.params.id));
    res.json(info);
  } catch (error: any) {
    console.error('Get status error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
