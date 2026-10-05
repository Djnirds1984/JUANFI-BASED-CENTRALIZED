import { mikroTikService, RouterConnection } from './mikrotik';
import { getDb } from '../database';

let monitoringInterval: NodeJS.Timeout | null = null;

export function startMonitoring(intervalMinutes: number = 5): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  console.log(`Starting monitoring scheduler (every ${intervalMinutes} minutes)`);

  collectMetrics().catch((err) => console.error('Initial metrics collection failed:', err));

  monitoringInterval = setInterval(() => {
    collectMetrics().catch((err) => console.error('Metrics collection failed:', err));
  }, intervalMinutes * 60 * 1000);
}

export function stopMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

async function collectMetrics(): Promise<void> {
  const db = getDb();
  const routers = db.prepare('SELECT * FROM routers WHERE is_active = 1').all() as any[];

  for (const router of routers) {
    if (!mikroTikService.isConnected(router.id)) {
      try {
        const conn: RouterConnection = {
          id: router.id,
          name: router.name,
          host: router.host,
          port: router.port,
          username: router.username,
          password: router.password,
        };
        await mikroTikService.connect(conn);
      } catch (err) {
        console.warn(`Cannot connect to router ${router.name} (${router.host}) for monitoring`);
        continue;
      }
    }

    try {
      const info = await mikroTikService.getSystemInfo(router.id);

      db.prepare(
        `INSERT INTO monitoring_logs (router_id, cpu_load, memory_total, memory_used, uptime, version)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(router.id, info.cpuLoad, info.memoryTotal, info.memoryUsed, info.uptime, info.version);

      console.log(`[${router.name}] CPU: ${info.cpuLoad}%, MEM: ${info.memoryUsed}/${info.memoryTotal}`);
    } catch (err: any) {
      console.error(`Failed to collect metrics from ${router.name}:`, err.message);
    }
  }
}

export function reconnectRouters(): void {
  const db = getDb();
  const routers = db.prepare('SELECT * FROM routers WHERE is_active = 1').all() as any[];

  for (const router of routers) {
    const conn: RouterConnection = {
      id: router.id,
      name: router.name,
      host: router.host,
      port: router.port,
      username: router.username,
      password: router.password,
    };

    mikroTikService
      .connect(conn)
      .then(() => console.log(`Connected to router: ${router.name}`))
      .catch((err: any) => console.warn(`Could not connect to router ${router.name}: ${err.message}`));
  }
}
