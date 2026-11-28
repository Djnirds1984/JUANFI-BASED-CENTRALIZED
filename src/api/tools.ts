import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as zerotier from '../services/zerotier';
import * as turso from '../services/turso';
import fs from 'fs';
import { config } from '../config';
import { findFirmware, listFirmware } from '../services/firmwareStore';

const router = Router();

router.use(authMiddleware);

// --- ZeroTier ---

// Get ZeroTier status
router.get('/zerotier/status', (req: Request, res: Response) => {
  try {
    const status = zerotier.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Install ZeroTier
router.post('/zerotier/install', async (req: Request, res: Response) => {
  try {
    const result = await zerotier.installZeroTier();
    res.json({ success: true, message: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message, permissionDenied: error.message.includes('PERMISSION_DENIED') });
  }
});

// Join a ZeroTier network
router.post('/zerotier/join', (req: Request, res: Response) => {
  try {
    const { networkId } = req.body;
    if (!networkId) {
      res.status(400).json({ error: 'networkId is required' });
      return;
    }

    const result = zerotier.joinNetwork(networkId);
    res.json({ success: true, message: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Leave a ZeroTier network
router.post('/zerotier/leave', (req: Request, res: Response) => {
  try {
    const { networkId } = req.body;
    if (!networkId) {
      res.status(400).json({ error: 'networkId is required' });
      return;
    }

    const result = zerotier.leaveNetwork(networkId);
    res.json({ success: true, message: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Database Backup / Restore ---

// Download database backup
router.get('/database/backup', (req: Request, res: Response) => {
  try {
    const dbPath = config.dbPath;
    if (!fs.existsSync(dbPath)) {
      res.status(404).json({ error: 'Database file not found' });
      return;
    }

    const stat = fs.statSync(dbPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `mikrotik-controller-backup-${timestamp}.db`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(dbPath);
    stream.pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Restore database from upload
router.post('/database/restore', (req: Request, res: Response) => {
  try {
    const { data } = req.body;
    if (!data) {
      res.status(400).json({ error: 'No database file data provided' });
      return;
    }

    const dbPath = config.dbPath;
    const backupPath = dbPath + '.pre-restore-' + Date.now() + '.bak';

    // Backup current database before overwriting
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
    }

    // Write the uploaded database
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(dbPath, buffer);

    res.json({
      success: true,
      message: 'Database restored successfully. Restart the panel to apply changes.',
      backupPath,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Firmware images (SubVendo Flasher) ---

// The browser does the flashing over Web Serial; all this side does is hand out
// the .bin. Which folders are searched, and what counts as an image, is shared
// with the over-the-air endpoint a vendo uses, so the panel has one answer to
// "what firmware is on this box" - see services/firmwareStore.

// List the images the panel can offer, newest first.
router.get('/firmware', (_req: Request, res: Response) => {
  try {
    res.json({ files: listFirmware() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download one image as raw bytes.
router.get('/firmware/:name', (req: Request, res: Response) => {
  try {
    const name = String(req.params.name || '');
    const full = findFirmware(name);
    if (!full) {
      res.status(404).json({ error: 'Firmware not found' });
      return;
    }

    const stat = fs.statSync(full);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-cache');

    fs.createReadStream(full).pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Turso Cloud Database ---

// Get Turso config
router.get('/turso/config', (req: Request, res: Response) => {
  try {
    const cfg = turso.getConfig();
    res.json({
      url: cfg?.url || '',
      authToken: cfg?.authToken ? cfg.authToken.slice(0, 8) + '...' : '',
      configured: !!cfg?.url && !!cfg?.authToken,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Save Turso config
router.post('/turso/config', (req: Request, res: Response) => {
  try {
    const { url, authToken, autoSync, autoSyncInterval } = req.body;
    if (!url || !authToken) {
      res.status(400).json({ error: 'url and authToken are required' });
      return;
    }
    turso.saveConfig(url, authToken, autoSync || false, autoSyncInterval || 10000);

    // Apply the switch now instead of waiting for the next restart, and fill the
    // cloud the moment Turso is turned on: activating it should mean every table
    // is already up there, not "will be after a reboot".
    if (autoSync) {
      turso.startAutoSync(autoSyncInterval || 10000);
    } else {
      turso.stopAutoSync();
    }
    turso
      .syncToCloud(true)
      .then((result) => console.log(`[Turso] Initial upload: ${result.message}`))
      .catch((err) => console.warn('[Turso] Initial upload failed:', err.message));

    res.json({
      success: true,
      message: autoSync ? 'Configuration saved — uploading this panel to Turso now' : 'Turso configuration saved',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test Turso connection
router.post('/turso/test', async (req: Request, res: Response) => {
  try {
    const result = await turso.testConnection();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sync to Turso cloud
router.post('/turso/sync', async (req: Request, res: Response) => {
  try {
    const result = await turso.syncToCloud();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Restore from Turso cloud
router.post('/turso/restore', async (req: Request, res: Response) => {
  try {
    const result = await turso.restoreFromCloud();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
