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
import { mikroTikService } from './services/mikrotik';

import authRoutes from './api/auth';
import routerRoutes from './api/routers';
import hotspotRoutes from './api/hotspot';
import voucherRoutes from './api/vouchers';
import monitoringRoutes from './api/monitoring';
import portalRoutes from './api/portal';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/routers', routerRoutes);
app.use('/api/hotspot', hotspotRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/portal', portalRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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

    console.log('Starting monitoring scheduler...');
    startMonitoring(5);

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
