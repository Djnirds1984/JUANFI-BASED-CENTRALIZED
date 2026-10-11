import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as zerotier from '../services/zerotier';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

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

export default router;
