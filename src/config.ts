import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
  dbPath: process.env.DB_PATH || './data/mikrotik-controller.db',
  logLevel: process.env.LOG_LEVEL || 'info',
  activeDevicesSyncSec: Math.max(1, parseInt(process.env.ACTIVE_DEVICES_SYNC_SEC || '5', 10) || 5),
  // LAN IP of this controller, used to auto-allow it in each router's walled
  // garden so the portal can reach /api/session before login. Empty = disabled.
  controllerLanIp: (process.env.CONTROLLER_LAN_IP || '').trim(),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
};
