import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

// --- PPPoE Active Connections ---

router.get('/router/:routerId/active', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const connections = await mikroTikService.getPppActive(routerId);
    res.json(connections);
  } catch (error: any) {
    console.error('Get PPPoE active connections error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- PPP Customers (local) ---

router.get('/router/:routerId/customers', (_req: Request, res: Response) => {
  try {
    const routerId = parseInt((_req as any).params.routerId);
    const db = getDb();

    const customers = db
      .prepare(
        `SELECT * FROM ppp_customers WHERE router_id = ? ORDER BY created_at DESC`
      )
      .all(routerId);
    res.json(customers);
  } catch (error) {
    console.error('Get PPP customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/router/:routerId/customers', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const {
      name,
      username,
      password,
      profile,
      service,
      localAddress,
      remoteAddress,
      uptimeLimit,
      bytesInQuota,
      bytesOutQuota,
      comment,
    } = req.body;

    if (!name || !username || !password || !profile) {
      res.status(400).json({ error: 'Name, username, password, and profile are required' });
      return;
    }

    const db = getDb();
    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    if (mikroTikService.isConnected(routerId)) {
      await mikroTikService.createPppSecret(routerId, {
        name,
        password,
        profile,
        service: service || 'pppoe',
        localAddress,
        remoteAddress,
        comment,
      });
    }

    const source = routerRow.auth_mode === 'radius' ? 'radius' : 'api';

    db.prepare(
      `INSERT INTO ppp_customers (router_id, name, username, password, profile, service, local_address, remote_address, uptime_limit, bytes_in_quota, bytes_out_quota, comment, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      routerId,
      name,
      username,
      password,
      profile,
      service || 'pppoe',
      localAddress || null,
      remoteAddress || null,
      uptimeLimit || '00:00:00',
      bytesInQuota || 0,
      bytesOutQuota || 0,
      comment || null,
      source
    );

    res.status(201).json({ message: 'PPP customer created successfully' });
  } catch (error: any) {
    console.error('Create PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
});


router.put('/router/:routerId/customers/:customerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);
    const {
      name,
      username,
      password,
      profile,
      service,
      localAddress,
      remoteAddress,
      uptimeLimit,
      bytesInQuota,
      bytesOutQuota,
      comment,
    } = req.body;

    const db = getDb();
    const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
    if (!customer) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }

    if (mikroTikService.isConnected(routerId)) {
      // MikroTik does not support renaming a secret; remove + re-add to apply changes.
      await mikroTikService.removePppSecret(routerId, customer['.id'] || String(customer.id));
      await mikroTikService.createPppSecret(routerId, {
        name: name || customer.name,
        password: password || customer.password,
        profile: profile || customer.profile,
        service: service || customer.service || 'pppoe',
        localAddress: localAddress ?? customer.local_address,
        remoteAddress: remoteAddress ?? customer.remote_address,
        comment: comment ?? customer.comment,
      });
    }

    db.prepare(
      `UPDATE ppp_customers
       SET name = COALESCE(?, name), username = COALESCE(?, username), password = COALESCE(?, password),
           profile = COALESCE(?, profile), service = COALESCE(?, service), local_address = COALESCE(?, local_address),
           remote_address = COALESCE(?, remote_address), uptime_limit = COALESCE(?, uptime_limit),
           bytes_in_quota = COALESCE(?, bytes_in_quota), bytes_out_quota = COALESCE(?, bytes_out_quota),
           comment = COALESCE(?, comment), updated_at = datetime('now')
       WHERE id = ? AND router_id = ?`
    ).run(
      name, username, password, profile, service,
      localAddress ?? null, remoteAddress ?? null,
      uptimeLimit ?? null, bytesInQuota ?? null, bytesOutQuota ?? null,
      comment ?? null,
      customerId, routerId
    );

    res.json({ message: 'PPP customer updated successfully' });
  } catch (error: any) {
    console.error('Update PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
});


router.delete('/router/:routerId/customers/:customerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);

    const db = getDb();
    const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
    if (!customer) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }

    if (mikroTikService.isConnected(routerId)) {
      await mikroTikService.removePppSecret(routerId, customer['.id'] || String(customer.id));
    }

    db.prepare('DELETE FROM ppp_customers WHERE id = ? AND router_id = ?').run(customerId, routerId);

    res.json({ message: 'PPP customer deleted successfully' });
  } catch (error: any) {
    console.error('Delete PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/customers/:customerId/enable', async (req: Request, res: Response) => {
  return togglePppCustomer(req, res, 0);
});

router.post('/router/:routerId/customers/:customerId/disable', async (req: Request, res: Response) => {
  return togglePppCustomer(req, res, 1);
});

async function togglePppCustomer(req: Request, res: Response, disabled: number) {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);

    const db = getDb();
    const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
    if (!customer) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }

    if (mikroTikService.isConnected(routerId)) {
      if (disabled === 1) {
        await mikroTikService.disablePppSecret(routerId, customer['.id'] || String(customer.id));
      } else {
        await mikroTikService.enablePppSecret(routerId, customer['.id'] || String(customer.id));
      }
    }

    db.prepare(
      'UPDATE ppp_customers SET disabled = ?, updated_at = datetime(\'now\') WHERE id = ? AND router_id = ?'
    ).run(disabled, customerId, routerId);

    res.json({ message: `PPP customer ${disabled === 1 ? 'disabled' : 'enabled'} successfully` });
  } catch (error: any) {
    console.error('Toggle PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
}

export default router;



