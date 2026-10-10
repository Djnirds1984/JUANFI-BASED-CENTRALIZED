import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../database';
import { mikroTikService, RouterConnection } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';
import { getRadiusStatus, hasRadiusClients, startRadiusServer, stopRadiusServer, testRadiusConnectivity, getRadiusLogs, clearRadiusLogs } from '../services/radiusServer';

const router = Router();

router.use(authMiddleware);

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const routers = db.prepare('SELECT * FROM routers ORDER BY name').all();

    const routersWithStatus = (routers as any[]).map((r) => {
      const radiusClient = db.prepare('SELECT shared_secret, is_active FROM radius_clients WHERE router_id = ?').get(r.id) as any;
      return {
        ...r,
        connected: mikroTikService.isConnected(r.id),
        radius_enabled: radiusClient ? true : false,
        radius_shared_secret: radiusClient ? radiusClient.shared_secret : null,
        radius_active: radiusClient ? !!radiusClient.is_active : false,
      };
    });

    res.json(routersWithStatus);
  } catch (error) {
    console.error('Get routers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/radius/status', (req: Request, res: Response) => {
  try {
    res.json(getRadiusStatus());
  } catch (error) {
    console.error('Get RADIUS status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/radius/logs', (req: Request, res: Response) => {
  try {
    const routerId = req.query.router_id ? parseInt(req.query.router_id as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const logs = getRadiusLogs(routerId, Math.min(limit, 500));
    res.json(logs);
  } catch (error) {
    console.error('Get RADIUS logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/radius/logs', (req: Request, res: Response) => {
  try {
    const routerId = req.query.router_id ? parseInt(req.query.router_id as string) : undefined;
    clearRadiusLogs(routerId);
    res.json({ message: 'Logs cleared' });
  } catch (error) {
    console.error('Clear RADIUS logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id) as any;

    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const radiusClient = db.prepare('SELECT shared_secret, is_active FROM radius_clients WHERE router_id = ?').get(routerRow.id) as any;

    res.json({
      ...routerRow,
      connected: mikroTikService.isConnected(routerRow.id),
      radius_enabled: radiusClient ? true : false,
      radius_shared_secret: radiusClient ? radiusClient.shared_secret : null,
      radius_active: radiusClient ? !!radiusClient.is_active : false,
    });
  } catch (error) {
    console.error('Get router error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, host, port, username, password, description, use_rest_api, auth_mode, radius_shared_secret } = req.body;

    if (!name || !host || !username || !password) {
      res.status(400).json({ error: 'Name, host, username, and password are required' });
      return;
    }

    const db = getDb();
    const mode = auth_mode === 'radius' ? 'radius' : 'api';
    const result = db
      .prepare(
        'INSERT INTO routers (name, host, port, username, password, description, use_rest_api, auth_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(name, host, port || 8728, username, password, description || null, use_rest_api ? 1 : 0, mode);

    const routerId = result.lastInsertRowid as number;

    if (mode === 'radius') {
      const secret = radius_shared_secret || crypto.randomBytes(16).toString('hex');
      db.prepare(
        'INSERT INTO radius_clients (router_id, shared_secret, is_active) VALUES (?, ?, 1)'
      ).run(routerId, secret);
    }

    const routerConn: RouterConnection = {
      id: routerId,
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

    if (mode === 'radius' && hasRadiusClients()) {
      startRadiusServer();
    }

    res.status(201).json({
      id: routerId,
      name,
      host,
      port: port || 8728,
      username,
      description,
      use_rest_api: use_rest_api ? 1 : 0,
      auth_mode: mode,
      connected,
    });
  } catch (error) {
    console.error('Create router error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, host, port, username, password, description, is_active, use_rest_api, auth_mode, radius_shared_secret } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const newMode = auth_mode !== undefined ? (auth_mode === 'radius' ? 'radius' : 'api') : existing.auth_mode;

    db.prepare(
      `UPDATE routers SET name = ?, host = ?, port = ?, username = ?, password = ?, description = ?, is_active = ?, use_rest_api = ?, auth_mode = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      name || existing.name,
      host || existing.host,
      port || existing.port,
      username || existing.username,
      password || existing.password,
      description !== undefined ? description : existing.description,
      is_active !== undefined ? is_active : existing.is_active,
      use_rest_api !== undefined ? (use_rest_api ? 1 : 0) : existing.use_rest_api,
      newMode,
      req.params.id
    );

    const existingRadius = db.prepare('SELECT * FROM radius_clients WHERE router_id = ?').get(req.params.id) as any;

    if (newMode === 'radius') {
      if (!existingRadius) {
        const secret = radius_shared_secret || crypto.randomBytes(16).toString('hex');
        db.prepare(
          'INSERT INTO radius_clients (router_id, shared_secret, is_active) VALUES (?, ?, 1)'
        ).run(req.params.id, secret);
      } else if (radius_shared_secret) {
        db.prepare(
          `UPDATE radius_clients SET shared_secret = ?, is_active = 1, updated_at = datetime('now') WHERE router_id = ?`
        ).run(radius_shared_secret, req.params.id);
      } else {
        db.prepare(
          `UPDATE radius_clients SET is_active = 1, updated_at = datetime('now') WHERE router_id = ?`
        ).run(req.params.id);
      }
    } else if (existingRadius) {
      db.prepare('UPDATE radius_clients SET is_active = 0, updated_at = datetime(\'now\') WHERE router_id = ?').run(req.params.id);
    }

    if (hasRadiusClients()) {
      startRadiusServer();
    } else {
      stopRadiusServer();
    }

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
    db.prepare('DELETE FROM radius_clients WHERE router_id = ?').run(req.params.id);
    db.prepare('DELETE FROM routers WHERE id = ?').run(req.params.id);

    if (!hasRadiusClients()) {
      stopRadiusServer();
    }

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

router.post('/:id/radius/regenerate-secret', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(req.params.id) as any;

    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const newSecret = crypto.randomBytes(16).toString('hex');
    const existing = db.prepare('SELECT * FROM radius_clients WHERE router_id = ?').get(req.params.id) as any;

    if (existing) {
      db.prepare(
        `UPDATE radius_clients SET shared_secret = ?, updated_at = datetime('now') WHERE router_id = ?`
      ).run(newSecret, req.params.id);
    } else {
      db.prepare(
        'INSERT INTO radius_clients (router_id, shared_secret, is_active) VALUES (?, ?, 1)'
      ).run(req.params.id, newSecret);
      db.prepare(`UPDATE routers SET auth_mode = 'radius' WHERE id = ?`).run(req.params.id);
    }

    res.json({ shared_secret: newSecret });
  } catch (error) {
    console.error('Regenerate RADIUS secret error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/radius/test', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.id);
    const result = await testRadiusConnectivity(routerId);
    res.json(result);
  } catch (error) {
    console.error('RADIUS test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
