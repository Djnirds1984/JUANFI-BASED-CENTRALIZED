import dotenv from 'dotenv';
import os from 'os';

dotenv.config();

// Fallback when CONTROLLER_LAN_IP is not set: pick the first non-internal
// IPv4 address, skipping virtual interfaces (ZeroTier, Docker, WireGuard).
function detectLanIp(): string {
  const skip = /^(zt|zabra|docker|veth|br-|tailscale|wg|ham|lo)/i;
  const ifaces = os.networkInterfaces();
  const names = Object.keys(ifaces).sort((a, b) => (skip.test(a) ? 1 : 0) - (skip.test(b) ? 1 : 0));
  for (const name of names) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '';
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
  dbPath: process.env.DB_PATH || './data/mikrotik-controller.db',
  logLevel: process.env.LOG_LEVEL || 'info',
  activeDevicesSyncSec: Math.max(1, parseInt(process.env.ACTIVE_DEVICES_SYNC_SEC || '5', 10) || 5),
  // LAN IP of this controller as seen by hotspot clients. Used to auto-allow it
  // in each router's walled garden and to build stub portal redirect URLs.
  // Falls back to auto-detected LAN IP when not set.
  controllerLanIp: (process.env.CONTROLLER_LAN_IP || '').trim() || detectLanIp(),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  radiusAuthPort: Math.max(1, parseInt(process.env.RADIUS_AUTH_PORT || '1812', 10)),
  radiusAcctPort: Math.max(1, parseInt(process.env.RADIUS_ACCT_PORT || '1813', 10)),
  // RFC 5176 CoA / Disconnect port (MikroTik default 3799).
  radiusCoaPort: Math.max(1, parseInt(process.env.RADIUS_COA_PORT || '3799', 10)),
};
