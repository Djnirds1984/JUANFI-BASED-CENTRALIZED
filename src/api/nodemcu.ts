import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { nodeMcuService, NodeMcuDevice } from '../services/nodemcu';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const DEVICES_FILE = path.join(__dirname, '..', '..', 'data', 'nodemcu-devices.json');

function loadDevices(): NodeMcuDevice[] {
  try {
    const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveDevices(devices: NodeMcuDevice[]): void {
  fs.mkdirSync(path.dirname(DEVICES_FILE), { recursive: true });
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
}

function findDevice(id: number): NodeMcuDevice | undefined {
  return loadDevices().find((d) => d.id === id);
}

router.get('/devices', (_req: Request, res: Response) => {
  const devices = loadDevices();
  res.json({ devices });
});

router.post('/devices', (req: Request, res: Response) => {
  const { name, ip, username, password } = req.body;
  if (!name || !ip) {
    res.status(400).json({ error: 'name and ip are required' });
    return;
  }

  const devices = loadDevices();
  const id = devices.length > 0 ? Math.max(...devices.map((d) => d.id)) + 1 : 1;
  const device: NodeMcuDevice = {
    id,
    name: name || 'NodeMCU',
    ip,
    username: username || 'admin',
    password: password || '',
  };
  devices.push(device);
  saveDevices(devices);
  res.json({ device });
});

router.put('/devices/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const devices = loadDevices();
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const { name, ip, username, password } = req.body;
  if (name !== undefined) devices[idx].name = name;
  if (ip !== undefined) devices[idx].ip = ip;
  if (username !== undefined) devices[idx].username = username;
  if (password !== undefined) devices[idx].password = password;
  saveDevices(devices);
  nodeMcuService.clearSession(id);
  res.json({ device: devices[idx] });
});

router.delete('/devices/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const devices = loadDevices();
  const filtered = devices.filter((d) => d.id !== id);
  if (filtered.length === devices.length) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  saveDevices(filtered);
  nodeMcuService.clearSession(id);
  res.json({ message: 'Device removed' });
});

router.get('/devices/:id/dashboard', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const dashboard = await nodeMcuService.getDashboard(device);
    res.json(dashboard);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/config', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const config = await nodeMcuService.getSystemConfig(device);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/devices/:id/config', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.saveSystemConfig(device, req.body);
    res.json({ message: 'Configuration saved. Device is restarting...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/rates', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const rates = await nodeMcuService.getRates(device);
    res.json({ rates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/devices/:id/rates', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.saveRates(device, req.body.rates);
    res.json({ message: 'Rates saved' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/restart', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.restartSystem(device);
    res.json({ message: 'Restart command sent' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/restart-mikrotik', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.restartMikrotik(device);
    res.json({ message: 'MikroTik restart command sent' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/reset-stats', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const { type } = req.body;
    if (!['lifeTimeCount', 'coinCount', 'customerCount'].includes(type)) {
      res.status(400).json({ error: 'Invalid reset type' });
      return;
    }
    await nodeMcuService.resetStatistic(device, type);
    res.json({ message: `Statistics reset: ${type}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/active-users', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const raw = await nodeMcuService.getActiveUsers(device);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/kick-user', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const { mac } = req.body;
    if (!mac) { res.status(400).json({ error: 'mac is required' }); return; }
    await nodeMcuService.kickActiveUser(device, mac);
    res.json({ message: 'User kicked' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/sales', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const raw = await nodeMcuService.getSalesDetail(device);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/logs', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const raw = await nodeMcuService.getSystemLogs(device);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/generate-vouchers', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const { amount, qty, prefix, addToSales } = req.body;
    if (!amount || !qty) { res.status(400).json({ error: 'amount and qty are required' }); return; }
    const raw = await nodeMcuService.generateVouchers(device, amount, qty, prefix || 'P', !!addToSales);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/scan-ssid', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const ssids = await nodeMcuService.scanSSID(device);
    res.json({ ssids });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/toggle-night-light', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.toggleNightLight(device);
    res.json({ message: 'Night light toggled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/ping', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const result = await nodeMcuService.ping(device);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
