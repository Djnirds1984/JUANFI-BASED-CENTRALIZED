import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getSessionSettings, sessionCounts, setSessionSettings } from '../services/sessionSettings';

const router = Router();

router.use(authMiddleware);

/**
 * RADIUS > Session Settings.
 *
 * `autoPauseOffline` is read live by the 5s device sync
 * (services/deviceSessions.ts), so flipping it here takes effect on the next
 * tick without touching the router or restarting anything.
 */
router.get('/session-settings', (_req: Request, res: Response) => {
  try {
    const settings = getSessionSettings();
    res.json({
      autoPauseOffline: settings.auto_pause_offline,
      updatedAt: settings.updated_at,
      ...sessionCounts(),
    });
  } catch (error: any) {
    console.error('Get session settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/session-settings', (req: Request, res: Response) => {
  try {
    const value = req.body ? req.body.autoPauseOffline : undefined;
    if (typeof value !== 'boolean') {
      res.status(400).json({ error: 'autoPauseOffline must be true or false' });
      return;
    }
    const settings = setSessionSettings({ auto_pause_offline: value });
    console.log(`session settings: auto-pause offline ${settings.auto_pause_offline ? 'enabled' : 'disabled'}`);
    res.json({
      autoPauseOffline: settings.auto_pause_offline,
      updatedAt: settings.updated_at,
      ...sessionCounts(),
    });
  } catch (error: any) {
    console.error('Update session settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
