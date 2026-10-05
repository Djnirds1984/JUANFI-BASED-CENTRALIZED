import { RouterOSAPI } from 'node-routeros';

export interface RouterConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface RouterSystemInfo {
  cpuLoad: number;
  memoryTotal: number;
  memoryUsed: number;
  uptime: number;
  version: string;
  boardName: string;
  identity: string;
}

export interface HotspotUser {
  '.id': string;
  name: string;
  password: string;
  profile: string;
  'uptime-limit'?: string;
  'bytes-in-quota'?: number;
  'bytes-out-quota'?: number;
  comment?: string;
  disabled?: string;
}

export interface ActiveConnection {
  '.id': string;
  user: string;
  address: string;
  mac: string;
  uptime: string;
  'bytes-in': number;
  'bytes-out': number;
}

class MikroTikService {
  private connections: Map<number, RouterOSAPI> = new Map();

  async connect(router: RouterConnection): Promise<void> {
    if (this.connections.has(router.id)) {
      await this.disconnect(router.id);
    }

    const client = new RouterOSAPI({
      host: router.host,
      port: router.port,
      user: router.username,
      password: router.password,
    });

    await client.connect();
    this.connections.set(router.id, client);
  }

  async disconnect(routerId: number): Promise<void> {
    const conn = this.connections.get(routerId);
    if (conn) {
      await conn.close();
      this.connections.delete(routerId);
    }
  }

  isConnected(routerId: number): boolean {
    const conn = this.connections.get(routerId);
    return conn !== undefined && conn.connected;
  }

  private getClient(routerId: number): RouterOSAPI {
    const conn = this.connections.get(routerId);
    if (!conn || !conn.connected) {
      throw new Error(`Router ${routerId} is not connected`);
    }
    return conn;
  }

  async getSystemInfo(routerId: number): Promise<RouterSystemInfo> {
    const client = this.getClient(routerId);

    const [resource, identity] = await Promise.all([
      client.write('/system/resource/print'),
      client.write('/system/identity/print'),
    ]);

    const res = resource[0] as any;
    const ident = identity[0] as any;

    const memTotal = parseInt(res['total-memory'] || '0');
    const memUsed = parseInt(res['used-memory'] || '0');

    return {
      cpuLoad: parseInt(res['cpu-load'] || '0'),
      memoryTotal: memTotal,
      memoryUsed: memUsed,
      uptime: this.parseUptime(res['uptime'] || '0'),
      version: res['version'] || 'unknown',
      boardName: res['board-name'] || 'unknown',
      identity: ident['name'] || 'unknown',
    };
  }

  async getHotspotUsers(routerId: number): Promise<HotspotUser[]> {
    const client = this.getClient(routerId);
    const users = await client.write('/ip/hotspot/user/print');
    return users as HotspotUser[];
  }

  async createHotspotUser(
    routerId: number,
    user: {
      username: string;
      password: string;
      profile: string;
      uptimeLimit?: string;
      bytesInQuota?: number;
      bytesOutQuota?: number;
      comment?: string;
    }
  ): Promise<void> {
    const client = this.getClient(routerId);

    const command: string[] = [
      `=name=${user.username}`,
      `=password=${user.password}`,
      `=profile=${user.profile}`,
    ];

    if (user.uptimeLimit) command.push(`=uptime-limit=${user.uptimeLimit}`);
    if (user.bytesInQuota) command.push(`=bytes-in-quota=${user.bytesInQuota}`);
    if (user.bytesOutQuota) command.push(`=bytes-out-quota=${user.bytesOutQuota}`);
    if (user.comment) command.push(`=comment=${user.comment}`);

    await client.write('/ip/hotspot/user/add', command);
  }

  async removeHotspotUser(routerId: number, userId: string): Promise<void> {
    const client = this.getClient(routerId);
    await client.write('/ip/hotspot/user/remove', [`.id=${userId}`]);
  }

  async disableHotspotUser(routerId: number, userId: string): Promise<void> {
    const client = this.getClient(routerId);
    await client.write('/ip/hotspot/user/disable', [`.id=${userId}`]);
  }

  async enableHotspotUser(routerId: number, userId: string): Promise<void> {
    const client = this.getClient(routerId);
    await client.write('/ip/hotspot/user/enable', [`.id=${userId}`]);
  }

  async getActiveConnections(routerId: number): Promise<ActiveConnection[]> {
    const client = this.getClient(routerId);
    const connections = await client.write('/ip/hotspot/active/print');
    return connections as ActiveConnection[];
  }

  async getHotspotProfiles(routerId: number): Promise<any[]> {
    const client = this.getClient(routerId);
    return await client.write('/ip/hotspot/user/profile/print');
  }

  async getQueues(routerId: number): Promise<any[]> {
    const client = this.getClient(routerId);
    return await client.write('/queue/simple/print');
  }

  async createQueue(
    routerId: number,
    queue: {
      name: string;
      target: string;
      maxLimit: string;
      burst?: string;
      priority?: number;
      comment?: string;
    }
  ): Promise<void> {
    const client = this.getClient(routerId);

    const command: string[] = [
      `=name=${queue.name}`,
      `=target=${queue.target}`,
      `=max-limit=${queue.maxLimit}`,
    ];

    if (queue.burst) command.push(`=burst=${queue.burst}`);
    if (queue.priority) command.push(`=priority=${queue.priority}`);
    if (queue.comment) command.push(`=comment=${queue.comment}`);

    await client.write('/queue/simple/add', command);
  }

  async removeQueue(routerId: number, queueId: string): Promise<void> {
    const client = this.getClient(routerId);
    await client.write('/queue/simple/remove', [`.id=${queueId}`]);
  }

  async getInterfaces(routerId: number): Promise<any[]> {
    const client = this.getClient(routerId);
    return await client.write('/interface/print');
  }

  async getInterfaceTraffic(routerId: number): Promise<any[]> {
    const client = this.getClient(routerId);
    return await client.write('/interface/monitor-traffic', ['=once=']);
  }

  disconnectAll(): void {
    for (const [id, conn] of this.connections) {
      conn.close().catch(() => {});
    }
    this.connections.clear();
  }

  private parseUptime(uptime: string): number {
    const match = uptime.match(/(\d+)w?(\d+)d?(\d+):(\d+):(\d+)/);
    if (!match) return 0;
    const weeks = parseInt(match[1] || '0');
    const days = parseInt(match[2] || '0');
    const hours = parseInt(match[3] || '0');
    const minutes = parseInt(match[4] || '0');
    const seconds = parseInt(match[5] || '0');
    return weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }
}

export const mikroTikService = new MikroTikService();
