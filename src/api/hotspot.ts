import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/router/:routerId', async (req: Request, res: Response) => {
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

    const users = await mikroTikService.getHotspotUsers(routerId);
    res.json(users);
  } catch (error: any) {
    console.error('Get hotspot users error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/local', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const users = db
      .prepare('SELECT * FROM hotspot_users WHERE router_id = ? ORDER BY created_at DESC')
      .all(routerId);
    res.json(users);
  } catch (error) {
    console.error('Get local hotspot users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/router/:routerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const { username, password, profile, uptimeLimit, bytesInQuota, bytesOutQuota, comment } = req.body;

    if (!username || !password || !profile) {
      res.status(400).json({ error: 'Username, password, and profile are required' });
      return;
    }

    const db = getDb();
    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    if (mikroTikService.isConnected(routerId)) {
      await mikroTikService.createHotspotUser(routerId, {
        username,
        password,
        profile,
        uptimeLimit,
        bytesInQuota,
        bytesOutQuota,
        comment,
      });
    }

    db.prepare(
      `INSERT INTO hotspot_users (router_id, username, password, profile, uptime_limit, bytes_in_quota, bytes_out_quota, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(routerId, username, password, profile, uptimeLimit || '00:00:00', bytesInQuota || 0, bytesOutQuota || 0, comment || null);

    res.status(201).json({ message: 'Hotspot user created successfully' });
  } catch (error: any) {
    console.error('Create hotspot user error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/:mikrotikUserId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const mikrotikUserId = req.params.mikrotikUserId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.removeHotspotUser(routerId, mikrotikUserId);
    res.json({ message: 'Hotspot user removed successfully' });
  } catch (error: any) {
    console.error('Delete hotspot user error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/:mikrotikUserId/disable', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const mikrotikUserId = req.params.mikrotikUserId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.disableHotspotUser(routerId, mikrotikUserId);
    res.json({ message: 'User disabled' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/:mikrotikUserId/enable', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const mikrotikUserId = req.params.mikrotikUserId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.enableHotspotUser(routerId, mikrotikUserId);
    res.json({ message: 'User enabled' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/active', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const connections = await mikroTikService.getActiveConnections(routerId);
    res.json(connections);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/profiles', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const profiles = await mikroTikService.getHotspotProfiles(routerId);
    res.json(profiles);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/pools', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const pools = await mikroTikService.getAddressPools(routerId);
    res.json(pools);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/profiles', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.createHotspotProfile(routerId, req.body);
    res.status(201).json({ message: 'Server profile created successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/profile/:profileId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileId = req.params.profileId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.updateHotspotProfile(routerId, profileId, req.body);
    res.json({ message: 'Server profile updated successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/profile/:profileId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileId = req.params.profileId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.deleteHotspotProfile(routerId, profileId);
    res.json({ message: 'Server profile deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/hosts', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const [hosts, leases] = await Promise.all([
      mikroTikService.getHotspotHosts(routerId),
      mikroTikService.getDhcpLeases(routerId),
    ]);

    const leaseMap = new Map<string, string>();
    for (const lease of leases) {
      if (lease['mac-address'] && lease['host-name']) {
        leaseMap.set(lease['mac-address'].toLowerCase(), lease['host-name']);
      }
    }

    const enrichedHosts = hosts.map((host: any) => ({
      ...host,
      'host-name': leaseMap.get(host['mac-address']?.toLowerCase() || '') || '',
    }));

    res.json(enrichedHosts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/servers', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const servers = await mikroTikService.getHotspotServers(routerId);
    res.json(servers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/servers', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.createHotspotServer(routerId, req.body);
    res.status(201).json({ message: 'Hotspot server created successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/server/:serverId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const serverId = req.params.serverId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.updateHotspotServer(routerId, serverId, req.body);
    res.json({ message: 'Hotspot server updated successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/server/:serverId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const serverId = req.params.serverId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.deleteHotspotServer(routerId, serverId);
    res.json({ message: 'Hotspot server deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/walled-garden', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const entries = await mikroTikService.getWalledGarden(routerId);
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/walled-garden', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.createWalledGarden(routerId, req.body);
    res.status(201).json({ message: 'Walled garden entry created successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/walled-garden/:entryId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const entryId = req.params.entryId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.updateWalledGarden(routerId, entryId, req.body);
    res.json({ message: 'Walled garden entry updated successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/walled-garden/:entryId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const entryId = req.params.entryId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.deleteWalledGarden(routerId, entryId);
    res.json({ message: 'Walled garden entry deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/cookie', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const cookie = await mikroTikService.getHotspotCookie(routerId);
    res.json(cookie || {});
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/cookie', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.setHotspotCookie(routerId, req.body);
    res.json({ message: 'Cookie settings updated successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/cookies', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const cookies = await mikroTikService.getHotspotCookies(routerId);
    res.json(cookies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/cookie/:cookieId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const cookieId = req.params.cookieId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.deleteHotspotCookie(routerId, cookieId);
    res.json({ message: 'Cookie deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/user-profiles', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const profiles = await mikroTikService.getUserProfiles(routerId);
    res.json(profiles);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/user-profiles', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.createUserProfile(routerId, req.body);
    res.status(201).json({ message: 'User profile created successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/user-profile/:profileId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileId = req.params.profileId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.updateUserProfile(routerId, profileId, req.body);
    res.json({ message: 'User profile updated successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/user-profile/:profileId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileId = req.params.profileId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.deleteUserProfile(routerId, profileId);
    res.json({ message: 'User profile deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/ip-bindings', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const bindings = await mikroTikService.getIpBindings(routerId);
    res.json(bindings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/ip-bindings', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.createIpBinding(routerId, req.body);
    res.status(201).json({ message: 'IP binding created successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/ip-binding/:bindingId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const bindingId = req.params.bindingId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.updateIpBinding(routerId, bindingId, req.body);
    res.json({ message: 'IP binding updated successfully', data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/ip-binding/:bindingId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const bindingId = req.params.bindingId;

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    await mikroTikService.deleteIpBinding(routerId, bindingId);
    res.json({ message: 'IP binding deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/setup', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const {
      interface: interfaceName,
      address,
      poolStart,
      poolEnd,
      dnsServers,
      dnsName,
      adminUsername,
      adminPassword,
    } = req.body;

    if (!interfaceName || !address || !poolStart || !poolEnd || !dnsName || !adminUsername || !adminPassword) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const result = await mikroTikService.setupHotspot(routerId, {
      interface: interfaceName,
      address,
      poolStart,
      poolEnd,
      dnsServers: dnsServers || '8.8.8.8,8.8.4.4',
      dnsName,
      adminUsername,
      adminPassword,
    });

    res.json({ message: 'Hotspot setup completed successfully', data: result });
  } catch (error: any) {
    console.error('Hotspot setup error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
