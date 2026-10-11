import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as zerotier from '../services/zerotier';

const router = Router();

router.use(authMiddleware);

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
    res.status(500).json({ error: error.message });
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

export default router;
