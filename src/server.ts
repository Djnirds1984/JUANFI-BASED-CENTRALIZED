import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { initializeDatabase, closeDb } from './database';
import { initializeAdmin } from './services/auth';
import { startMonitoring, stopMonitoring, reconnectRouters } from './services/monitor';
import { startActiveDeviceSync, stopActiveDeviceSync } from './services/activeDevices';
import { startPppBillingSweep, stopPppBillingSweep } from './services/pppBilling';
import { startCafeTicker, stopCafeTicker } from './services/cafe';
import { startCafeDiscovery, stopCafeDiscovery } from './services/cafeDiscovery';
import { mikroTikService } from './services/mikrotik';
import { startRadiusServer, stopRadiusServer, hasRadiusClients } from './services/radiusServer';
import { startHotspotExpirySweep, stopHotspotExpirySweep } from './services/hotspotExpiry';
import * as turso from './services/turso';

import authRoutes from './api/auth';
import routerRoutes from './api/routers';
import hotspotRoutes from './api/hotspot';
import pppRoutes from './api/ppp';
import voucherRoutes from './api/vouchers';
import monitoringRoutes from './api/monitoring';
import portalRoutes from './api/portal';
import subvendoRoutes from './api/subvendo';
import nodemcuRoutes from './api/nodemcu';
import paymentRoutes from './api/payments';
import interfaceRoutes from './api/interfaces';
import sessionRoutes from './api/session';
import radiusProfileRoutes from './api/radiusProfiles';
import radiusSessionRoutes from './api/radiusSessions';
import radiusSettingsRoutes from './api/radiusSettings';
import toolsRoutes from './api/tools';
import settingsRoutes from './api/settings';
import chatRoutes from './api/chat';
import salesRoutes from './api/sales';
import walletRoutes from './api/wallet';
import cafeRoutes from './api/cafe';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));
app.use(cors());
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf ? buf.toString('utf8') : ''; } }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// The captive-portal webview on a phone caches the sign-in page and its
// scripts hard, and it is exactly the client that must pick up a new
// roam-restore behaviour the moment it roams. A stale cached portal.js/session.js
// silently replays the old (slow) login flow and the popup never closes, so
// force revalidation of the portal documents and the portal logic - the ETag
// still answers with a cheap 304 when nothing changed.
const PORTAL_NO_CACHE = /^\/(|portal\.html|assets\/js\/(portal|session|wallet)\.js)$/;
app.use((req, res, next) => {
  if (PORTAL_NO_CACHE.test(req.path)) {
    res.set('Cache-Control', 'no-cache, must-revalidate');
  }
  next();
});

// index:false so GET / falls through to the portal route below instead of
// serving the admin SPA's index.html (admin is served at /admin).
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
app.use('/hotspot-assets', express.static(path.join(__dirname, '..', 'hotspot')));
app.use('/stub-assets', express.static(path.join(__dirname, '..', 'stub')));

app.use('/api/auth', authRoutes);
app.use('/api/routers', routerRoutes);
app.use('/api/hotspot', hotspotRoutes);
app.use('/api/ppp', pppRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/subvendo', subvendoRoutes);
app.use('/api/nodemcu', nodemcuRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/interfaces', interfaceRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/radius-profiles', radiusProfileRoutes);
app.use('/api/radius-sessions', radiusSessionRoutes);
app.use('/api/radius', radiusSettingsRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/cafe', cafeRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Admin panel routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Portal route (for stub mode redirect target)
app.get('/', (req, res) => {
  // Serve portal page - this will be implemented in Phase 5
  // For now, serve a placeholder
  res.sendFile(path.join(__dirname, '..', 'public', 'portal.html'));
});

// Catch-all for 404
app.get('*', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

io.on('connection', (socket) => {
  console.log('WebSocket client connected');

  socket.on('disconnect', () => {
    console.log('WebSocket client disconnected');
  });
});

async function bootstrap(): Promise<void> {
  try {
    console.log('Initializing database...');
    initializeDatabase();

    console.log('Initializing admin user...');
    await initializeAdmin();

    console.log('Reconnecting to saved routers...');
    reconnectRouters();

    if (hasRadiusClients()) {
      console.log('Starting RADIUS server...');
      startRadiusServer();
    }

    console.log('Starting monitoring scheduler...');
    startMonitoring(5);

    console.log('Starting active devices sync...');
    startActiveDeviceSync(config.activeDevicesSyncSec);

    console.log('Starting PPP billing sweep...');
    startPppBillingSweep(60);

    console.log('Starting hotspot expiry sweep...');
    startHotspotExpirySweep(30);

    console.log('Starting pisonet meter...');
    startCafeTicker(10);
    startCafeDiscovery();

    console.log('Checking Turso cloud sync...');
    const tursoPull = await turso.pullIfLocalEmpty();
    console.log(`[Turso] ${tursoPull.message}`);
    const tursoConfig = turso.getConfig();
    if (tursoConfig?.autoSync) {
      turso.startAutoSync(tursoConfig.autoSyncInterval || 10000);
    }

    server.listen(config.port, config.host, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════════╗');
      console.log('║   MikroTik Controller Server                 ║');
      console.log('╠══════════════════════════════════════════════╣');
      console.log(`║   URL: http://${config.host}:${config.port}              ║`);
      console.log(`║   API: http://${config.host}:${config.port}/api        ║`);
      console.log('╠══════════════════════════════════════════════╣');
      console.log('║   Default login: admin / admin123            ║');
      console.log('║   CHANGE PASSWORD ON FIRST LOGIN!            ║');
      console.log('╚══════════════════════════════════════════════╝');
      console.log('');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

function shutdown(): void {
  console.log('\nShutting down...');
  stopMonitoring();
  stopActiveDeviceSync();
  stopPppBillingSweep();
  stopHotspotExpirySweep();
  stopCafeTicker();
  stopCafeDiscovery();
  stopRadiusServer();
  mikroTikService.disconnectAll();
  closeDb();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Prevent crashes from unhandled errors (e.g. router connection timeouts)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

bootstrap();

export { app, server, io };
