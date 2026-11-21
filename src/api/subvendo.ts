import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getPortalDefaultContent } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { resolveVendorIp, parseConfigJs, generateConfigJs, SubVendoConfig } from '../services/vendoConfig';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const CONFIG_PATH = 'assets/js/config.js';
const ROUTER_CONFIG_PATH = 'hotspot/assets/js/config.js';

// Parsing and generating of config.js, and the config shape itself, live in
// services/vendoConfig so that the portal endpoint, this page and sub-vendo
// provisioning share one definition.

router.get('/config', (req: Request, res: Response) => {
  try {
    const diskPath = path.join(__dirname, '..', '..', ROUTER_CONFIG_PATH);
    let content: string | null = null;

    try {
      content = fs.readFileSync(diskPath, 'utf8');
    } catch {}

    if (!content) {
      content = getPortalDefaultContent(CONFIG_PATH);
      if (!content) {
        res.status(404).json({ error: 'Config file not found' });
        return;
      }
    }

    res.json(parseConfigJs(content));
  } catch (error) {
    console.error('Get SubVendo config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/config', (req: Request, res: Response) => {
  try {
    const config: SubVendoConfig = req.body;

    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: 'Invalid config data' });
      return;
    }

    const content = generateConfigJs(resolveVendorIp(config));

    const filePath = path.join(__dirname, '..', '..', ROUTER_CONFIG_PATH);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');

    res.json({ message: 'Config saved', content });
  } catch (error: any) {
    console.error('Save SubVendo config error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/push/:routerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (isNaN(routerId)) {
      res.status(400).json({ error: 'Invalid router id' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const filePath = path.join(__dirname, '..', '..', ROUTER_CONFIG_PATH);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      res.status(404).json({ error: 'Config file not found' });
      return;
    }

    await mikroTikService.uploadFileSFTP(routerId, ROUTER_CONFIG_PATH, content);
    res.json({ message: 'Config pushed to router' });
  } catch (error: any) {
    console.error('Push SubVendo config error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
