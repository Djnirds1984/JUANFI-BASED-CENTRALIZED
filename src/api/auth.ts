import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, changePassword } from '../services/auth';
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
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    await changePassword(req.user!.userId, newPassword);
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
