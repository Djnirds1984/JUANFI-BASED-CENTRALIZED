import { Router, Request, Response } from 'express';
import os from 'os';
import { execSync } from 'child_process';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/system', (req: Request, res: Response) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;

    let diskTotal = 0;
    let diskUsed = 0;
    let diskFree = 0;
    try {
      const df = execSync('df -B1 / 2>/dev/null || echo ""').toString().trim().split('\n');
      if (df.length >= 2) {
        const parts = df[1].split(/\s+/);
        diskTotal = parseInt(parts[1]) || 0;
        diskUsed = parseInt(parts[2]) || 0;
        diskFree = parseInt(parts[3]) || 0;
      }
    } catch {
      // df not available (Windows)
    }

    const networkInterfaces = os.networkInterfaces();
    let wanIp = '';
    let lanIp = '';
    for (const [name, addrs] of Object.entries(networkInterfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          if (name.startsWith('eth') || name.startsWith('en') || name === 'wlan0') {
            lanIp = addr.address;
          }
        }
      }
    }

    const getCpuUsage = (): Promise<number> => {
      return new Promise((resolve) => {
        try {
          const stat1 = execSync('cat /proc/stat | head -1').toString().trim();
          const parts1 = stat1.split(/\s+/);
          const idle1 = parseInt(parts1[4]) || 0;
          const total1 = parts1.slice(1).reduce((sum, v) => sum + (parseInt(v) || 0), 0);

          setTimeout(() => {
            try {
              const stat2 = execSync('cat /proc/stat | head -1').toString().trim();
              const parts2 = stat2.split(/\s+/);
              const idle2 = parseInt(parts2[4]) || 0;
              const total2 = parts2.slice(1).reduce((sum, v) => sum + (parseInt(v) || 0), 0);

              const idleDelta = idle2 - idle1;
              const totalDelta = total2 - total1;
              const cpuPct = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
              resolve(cpuPct);
            } catch {
              resolve(0);
            }
          }, 500);
        } catch {
          resolve(0);
        }
      });
    };

    getCpuUsage().then((cpuLoad) => {
      res.json({
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()} ${os.arch()}`,
        cpuModel,
        cpuCores,
        cpuLoad,
        memoryTotal: totalMem,
        memoryUsed: usedMem,
        memoryPercent: Math.round((usedMem / totalMem) * 100),
        diskTotal,
        diskUsed,
        diskFree,
        diskPercent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0,
        uptime: Math.round(os.uptime()),
        nodeVersion: process.version,
        wanIp,
        lanIp,
      });
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/system', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const info = await mikroTikService.getSystemInfo(routerId);
    res.json(info);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/interfaces', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const interfaces = await mikroTikService.getInterfaces(routerId);
    res.json(interfaces);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/traffic', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const traffic = await mikroTikService.getInterfaceTraffic(routerId);
    res.json(traffic);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/history', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const { hours } = req.query;
    const limitHours = parseInt((hours as string) || '24');

    const logs = db
      .prepare(
        `SELECT * FROM monitoring_logs
         WHERE router_id = ? AND recorded_at >= datetime('now', ?)
         ORDER BY recorded_at DESC`
      )
      .all(routerId, `-${limitHours} hours`);

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const routers = db.prepare('SELECT * FROM routers WHERE is_active = 1').all() as any[];

    const summary = await Promise.all(
      routers.map(async (r) => {
        const connected = mikroTikService.isConnected(r.id);
        let systemInfo = null;

        if (connected) {
          try {
            systemInfo = await mikroTikService.getSystemInfo(r.id);
          } catch (err) {
            // ignore
          }
        }

        return {
          id: r.id,
          name: r.name,
          host: r.host,
          connected,
          systemInfo,
        };
      })
    );

    res.json({
      totalRouters: routers.length,
      connectedRouters: summary.filter((s) => s.connected).length,
      routers: summary,
    });
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
