import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../database';
import { config } from '../config';

export interface AdminUser {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
}

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
}

export async function initializeAdmin(): Promise<void> {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(config.adminUsername);

  if (!existing) {
    const hash = await bcrypt.hash(config.adminPassword, 10);
    db.prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)').run(
      config.adminUsername,
      hash,
      'admin'
    );
    console.log(`Default admin user created: ${config.adminUsername}`);
  }
}

export async function authenticate(username: string, password: string): Promise<string | null> {
  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username) as AdminUser | undefined;

  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  const payload: TokenPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    return null;
  }
}

export async function changePassword(userId: number, newPassword: string): Promise<void> {
  const hash = await bcrypt.hash(newPassword, 10);
  const db = getDb();
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, userId);
}
