import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, changePassword, verifyPassword } from '../services/auth';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const token = await authenticate(username, password);

    if (!token) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password are required' });
      return;
    }

    if (String(newPassword).length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'New password must differ from the current password' });
      return;
    }

    const valid = await verifyPassword(req.user!.userId, String(currentPassword));
    if (!valid) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }

    await changePassword(req.user!.userId, String(newPassword));
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authMiddleware, (req: Request, res: Response) => {
  res.json({
    id: req.user!.userId,
    username: req.user!.username,
    role: req.user!.role,
  });
});

export default router;
