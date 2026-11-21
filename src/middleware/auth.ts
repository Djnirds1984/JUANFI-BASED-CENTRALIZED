import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../services/auth';
import { verifyClientToken, WalletTokenPayload } from '../services/wallet';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      wallet?: WalletTokenPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  // A customer wallet token must never reach an admin route. Normally the two
  // secrets differ, but this also covers CLIENT_JWT_SECRET being pointed at the
  // admin secret in .env.
  if (!payload || (payload as any).scope) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = payload;
  next();
}

/**
 * Customer wallet session. Separate from authMiddleware on purpose: a signed-in
 * customer may read and spend their OWN wallet, and nothing else.
 */
export function clientAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please sign in to your account' });
    return;
  }

  const payload = verifyClientToken(authHeader.substring(7));
  if (!payload) {
    res.status(401).json({ error: 'Session expired, please sign in again' });
    return;
  }

  req.wallet = payload;
  next();
}
