import { RouterOSAPI } from 'node-routeros';
import net from 'net';
import crypto from 'crypto';
import { Client as SSHClient } from 'ssh2';

export interface RouterConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useRestApi?: boolean;
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
  private routerConfigs: Map<number, RouterConnection> = new Map();
  private reconnectTimers: Map<number, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<number, number> = new Map();
  private hasFlashCache: Map<number, boolean> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 5000;

  private async restApiCall(
    router: RouterConnection,
    method: string,
    path: string,
    body?: any
  ): Promise<any> {
    const protocol = router.port === 443 ? 'https' : 'http';
    const url = `${protocol}://${router.host}:${router.port}/rest${path}`;
    const auth = Buffer.from(`${router.username}:${router.password}`).toString('base64');

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`REST API ${method} ${path} failed: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`REST API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async connect(router: RouterConnection): Promise<void> {
    if (this.connections.has(router.id)) {
      await this.disconnect(router.id);
    }

    this.routerConfigs.set(router.id, router);
    this.reconnectAttempts.set(router.id, 0);

    if (router.useRestApi) {
      console.log(`REST API mode for router: ${router.name} (${router.host}:${router.port})`);
      return;
    }

    const client = new RouterOSAPI({
      host: router.host,
      port: router.port,
      user: router.username,
      password: router.password,
      timeout: 30,
      keepalive: true,
    });

    client.on('error', (err) => {
      console.error(`Router ${router.id} (${router.host}) error:`, err.message);
      if (this.connections.has(router.id)) {
        this.connections.delete(router.id);
        this.scheduleReconnect(router.id);
      }
    });

    try {
      await client.connect();
      this.connections.set(router.id, client);
      this.reconnectAttempts.set(router.id, 0);
      console.log(`Connected to router: ${router.name} (${router.host})`);
    } catch (err) {
      console.error(`Failed to connect to router ${router.id} (${router.host}):`, (err as Error).message);
      this.scheduleReconnect(router.id);
      throw err;
    }
  }

  private scheduleReconnect(routerId: number): void {
    const attempts = this.reconnectAttempts.get(routerId) || 0;
    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.warn(`Router ${routerId} reached max reconnection attempts`);
      return;
    }

    const existingTimer = this.reconnectTimers.get(routerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const delay = this.RECONNECT_DELAY * Math.pow(2, attempts);
    console.log(`Scheduling reconnect for router ${routerId} in ${delay}ms (attempt ${attempts + 1})`);

    const timer = setTimeout(async () => {
      const config = this.routerConfigs.get(routerId);
      if (!config) return;

      this.reconnectAttempts.set(routerId, attempts + 1);
      try {
        await this.connect(config);
      } catch (err) {
        console.error(`Reconnection failed for router ${routerId}:`, (err as Error).message);
      }
    }, delay);

    this.reconnectTimers.set(routerId, timer);
  }

  async disconnect(routerId: number): Promise<void> {
    const timer = this.reconnectTimers.get(routerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(routerId);
    }

    this.routerConfigs.delete(routerId);
    this.reconnectAttempts.delete(routerId);

    const conn = this.connections.get(routerId);
    if (conn) {
      conn.removeAllListeners('error');
      try {
        await conn.close();
      } catch {
        // Ignore close errors on already-dead connections
      }
      this.connections.delete(routerId);
    }
  }

  isConnected(routerId: number): boolean {
    const config = this.routerConfigs.get(routerId);
    if (config?.useRestApi) {
      return true;
    }
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
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const [resource, identity] = await Promise.all([
        this.restApiCall(config, 'GET', '/system/resource'),
        this.restApiCall(config, 'GET', '/system/identity'),
      ]);

      const res = Array.isArray(resource) ? resource[0] : resource;
      const ident = Array.isArray(identity) ? identity[0] : identity;

      const memTotal = parseInt(res?.['total-memory'] || '0');
      const memUsed = parseInt(res?.['used-memory'] || '0');

      return {
        cpuLoad: parseInt(res?.['cpu-load'] || '0'),
        memoryTotal: memTotal,
        memoryUsed: memUsed,
        uptime: this.parseUptime(res?.uptime || '0'),
        version: res?.version || 'unknown',
        boardName: res?.['board-name'] || 'unknown',
        identity: ident?.name || 'unknown',
      };
    }

    const client = this.getClient(routerId);

    try {
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
    } catch (err) {
      console.error(`getSystemInfo failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getHotspotUsers(routerId: number): Promise<HotspotUser[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const users = await this.restApiCall(config, 'GET', '/ip/hotspot/user');
      return Array.isArray(users) ? users : [];
    }

    const client = this.getClient(routerId);
    try {
      const users = await client.write('/ip/hotspot/user/print');
      return users as HotspotUser[];
    } catch (err) {
      console.error(`getHotspotUsers failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async createHotspotUser(
    routerId: number,
    user: {
      username: string;
      password?: string;
      profile: string;
      uptimeLimit?: string;
      bytesInQuota?: number;
      bytesOutQuota?: number;
      comment?: string;
    }
  ): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const body: any = {
        name: user.username,
        profile: user.profile,
      };
      if (user.password) body.password = user.password;
      if (user.uptimeLimit) body['limit-uptime'] = user.uptimeLimit;
      if (user.bytesInQuota) body['bytes-in-quota'] = user.bytesInQuota;
      if (user.bytesOutQuota) body['bytes-out-quota'] = user.bytesOutQuota;
      if (user.comment) body.comment = user.comment;

      await this.restApiCall(config, 'POST', '/ip/hotspot/user/add', body);
      return;
    }

    const client = this.getClient(routerId);

    const command: string[] = [
      `=name=${user.username}`,
      `=profile=${user.profile}`,
    ];

    if (user.password) command.push(`=password=${user.password}`);

    if (user.uptimeLimit) command.push(`=limit-uptime=${user.uptimeLimit}`);
    if (user.bytesInQuota) command.push(`=bytes-in-quota=${user.bytesInQuota}`);
    if (user.bytesOutQuota) command.push(`=bytes-out-quota=${user.bytesOutQuota}`);
    if (user.comment) command.push(`=comment=${user.comment}`);

    try {
      await client.write('/ip/hotspot/user/add', command);
    } catch (err) {
      console.error(`createHotspotUser failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async removeHotspotUser(routerId: number, userId: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'DELETE', `/ip/hotspot/user/${userId}`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write('/ip/hotspot/user/remove', [`.id=${userId}`]);
    } catch (err) {
      console.error(`removeHotspotUser failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async disableHotspotUser(routerId: number, userId: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'POST', `/ip/hotspot/user/${userId}/disable`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write('/ip/hotspot/user/disable', [`.id=${userId}`]);
    } catch (err) {
      console.error(`disableHotspotUser failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async enableHotspotUser(routerId: number, userId: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'POST', `/ip/hotspot/user/${userId}/enable`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write('/ip/hotspot/user/enable', [`.id=${userId}`]);
    } catch (err) {
      console.error(`enableHotspotUser failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getActiveConnections(routerId: number): Promise<ActiveConnection[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const connections = await this.restApiCall(config, 'GET', '/ip/hotspot/active');
      return Array.isArray(connections) ? connections : [];
    }

    const client = this.getClient(routerId);
    try {
      const connections = await client.write('/ip/hotspot/active/print');
      return connections as ActiveConnection[];
    } catch (err) {
      console.error(`getActiveConnections failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getHotspotProfiles(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const profiles = await this.restApiCall(config, 'GET', '/ip/hotspot/profile');
      return Array.isArray(profiles) ? profiles : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/ip/hotspot/profile/print');
    } catch (err) {
      console.error(`getHotspotProfiles failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getAddressPools(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const pools = await this.restApiCall(config, 'GET', '/ip/pool');
      return Array.isArray(pools) ? pools : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/ip/pool/print');
    } catch (err) {
      console.error(`getAddressPools failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async createHotspotProfile(routerId: number, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const restData = { ...data };
      if (restData['address-pool'] !== undefined) {
        restData.pool = restData['address-pool'];
        delete restData['address-pool'];
      }
      if (restData['install-queue'] !== undefined) {
        restData['install-queue'] = restData['install-queue'] === 'yes';
      }
      if (restData['mac-cookie'] !== undefined) {
        restData['mac-cookie'] = restData['mac-cookie'] === 'yes';
      }
      if (restData['split-user-domain'] !== undefined) {
        restData['split-user-domain'] = restData['split-user-domain'] === 'yes';
      }
      return await this.restApiCall(config, 'POST', '/ip/hotspot/profile/add', restData);
    }

    const client = this.getClient(routerId);
    try {
      const command = ['/ip/hotspot/profile/add'];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`createHotspotProfile failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async updateHotspotProfile(routerId: number, profileId: string, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const restData = { ...data };
      if (restData['address-pool'] !== undefined) {
        restData.pool = restData['address-pool'];
        delete restData['address-pool'];
      }
      if (restData['install-queue'] !== undefined) {
        restData['install-queue'] = restData['install-queue'] === 'yes';
      }
      if (restData['mac-cookie'] !== undefined) {
        restData['mac-cookie'] = restData['mac-cookie'] === 'yes';
      }
      if (restData['split-user-domain'] !== undefined) {
        restData['split-user-domain'] = restData['split-user-domain'] === 'yes';
      }
      return await this.restApiCall(config, 'PUT', `/ip/hotspot/profile/${profileId}`, restData);
    }

    const client = this.getClient(routerId);
    try {
      const command = [`/ip/hotspot/profile/set`, `.id=${profileId}`];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`updateHotspotProfile failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async deleteHotspotProfile(routerId: number, profileId: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'DELETE', `/ip/hotspot/profile/${profileId}`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write(['/ip/hotspot/profile/remove', `.id=${profileId}`]);
    } catch (err) {
      console.error(`deleteHotspotProfile failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getHotspotHosts(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const hosts = await this.restApiCall(config, 'GET', '/ip/hotspot/host');
      return Array.isArray(hosts) ? hosts : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/ip/hotspot/host/print');
    } catch (err) {
      console.error(`getHotspotHosts failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getDhcpLeases(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const leases = await this.restApiCall(config, 'GET', '/ip/dhcp-server/lease');
      return Array.isArray(leases) ? leases : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/ip/dhcp-server/lease/print');
    } catch (err) {
      console.error(`getDhcpLeases failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getHotspotServers(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const servers = await this.restApiCall(config, 'GET', '/ip/hotspot');
      return Array.isArray(servers) ? servers : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/ip/hotspot/print');
    } catch (err) {
      console.error(`getHotspotServers failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async createHotspotServer(routerId: number, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'POST', '/ip/hotspot/add', data);
    }

    const client = this.getClient(routerId);
    try {
      const command = ['/ip/hotspot/add'];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`createHotspotServer failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async updateHotspotServer(routerId: number, serverId: string, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'PUT', `/ip/hotspot/${serverId}`, data);
    }

    const client = this.getClient(routerId);
    try {
      const command = [`/ip/hotspot/set`, `.id=${serverId}`];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`updateHotspotServer failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async deleteHotspotServer(routerId: number, serverId: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'DELETE', `/ip/hotspot/${serverId}`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write(['/ip/hotspot/remove', `.id=${serverId}`]);
    } catch (err) {
      console.error(`deleteHotspotServer failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async setupHotspot(routerId: number, config: {
    interface: string;
    address: string;
    poolStart: string;
    poolEnd: string;
    dnsServers: string;
    dnsName: string;
    adminUsername: string;
    adminPassword: string;
  }): Promise<any> {
    const routerConfig = this.routerConfigs.get(routerId);
    const isRestApi = routerConfig?.useRestApi;

    const results: any = {};
    const skipIfExists = (err: any) => {
      const msg = String(err.message || err).toLowerCase();
      return msg.includes('already have such') || msg.includes('already exists') || msg.includes('duplicate') || msg.includes('such name exists') || msg.includes('with such') || msg.includes('unknown parameter');
    };

    try {
      // Step 1: Add IP address to interface
      const addressName = `${config.interface}-hotspot`;
      try {
        if (isRestApi) {
          await this.restApiCall(routerConfig!, 'POST', '/ip/address/add', {
            address: config.address,
            interface: config.interface,
            comment: 'Hotspot',
          });
        } else {
          const client = this.getClient(routerId);
          await client.write('/ip/address/add', [
            `=address=${config.address}`,
            `=interface=${config.interface}`,
            `=comment=Hotspot`,
          ]);
        }
        results.address = addressName;
      } catch (err: any) {
        if (!skipIfExists(err)) throw err;
        results.address = `${addressName} (already exists)`;
      }

      // Step 2: Create address pool
      const poolName = `hs-pool-${config.interface}`;
      try {
        if (isRestApi) {
          await this.restApiCall(routerConfig!, 'POST', '/ip/pool/add', {
            name: poolName,
            ranges: `${config.poolStart}-${config.poolEnd}`,
          });
        } else {
          const client = this.getClient(routerId);
          await client.write('/ip/pool/add', [
            `=name=${poolName}`,
            `=ranges=${config.poolStart}-${config.poolEnd}`,
          ]);
        }
        results.pool = poolName;
      } catch (err: any) {
        if (!skipIfExists(err)) throw err;
        results.pool = `${poolName} (already exists)`;
      }

      // Step 3: Create hotspot profile
      const profileName = `hsprof-${config.interface}`;
      try {
        if (isRestApi) {
          await this.restApiCall(routerConfig!, 'POST', '/ip/hotspot/profile/add', {
            name: profileName,
            pool: poolName,
            'dns-server': config.dnsServers,
            'dns-name': config.dnsName,
          });
        } else {
          const client = this.getClient(routerId);
          await client.write('/ip/hotspot/profile/add', [
            `=name=${profileName}`,
            `=address-pool=${poolName}`,
            `=dns-server=${config.dnsServers}`,
            `=dns-name=${config.dnsName}`,
          ]);
        }
        results.profile = profileName;
      } catch (err: any) {
        if (!skipIfExists(err)) throw err;
        results.profile = `${profileName} (already exists)`;
      }

      // Step 4: Create hotspot server
      const serverName = `hotspot-${config.interface}`;
      try {
        if (isRestApi) {
          const createResult = await this.restApiCall(routerConfig!, 'POST', '/ip/hotspot/add', {
            name: serverName,
            interface: config.interface,
            profile: profileName,
          });
          if (createResult && createResult['.id']) {
            try {
              await this.restApiCall(routerConfig!, 'PUT', `/ip/hotspot/${createResult['.id']}`, {
                pool: poolName,
              });
            } catch { /* pool linked through profile */ }
          }
        } else {
          const client = this.getClient(routerId);
          await client.write('/ip/hotspot/add', [
            `=name=${serverName}`,
            `=interface=${config.interface}`,
            `=address-pool=${poolName}`,
            `=profile=${profileName}`,
          ]);
        }
        results.server = serverName;
      } catch (err: any) {
        if (!skipIfExists(err)) throw err;
        results.server = `${serverName} (already exists)`;
      }

      // Step 5: Create user profile
      const userProfileName = 'default';
      try {
        if (isRestApi) {
          await this.restApiCall(routerConfig!, 'POST', '/ip/hotspot/user/profile/add', {
            name: userProfileName,
            'rate-limit': '1M/1M',
          });
        } else {
          const client = this.getClient(routerId);
          await client.write('/ip/hotspot/user/profile/add', [
            `=name=${userProfileName}`,
            `=address-pool=${poolName}`,
            `=rate-limit=1M/1M`,
          ]);
        }
        results.userProfile = userProfileName;
      } catch (err: any) {
        if (!skipIfExists(err)) throw err;
        results.userProfile = `${userProfileName} (already exists)`;
      }

      // Step 6: Create admin user
      try {
        if (isRestApi) {
          try {
            await this.restApiCall(routerConfig!, 'POST', '/ip/hotspot/user/profile/add', {
              name: userProfileName,
              'rate-limit': '1M/1M',
            });
          } catch (err: any) {
            if (!skipIfExists(err)) throw err;
          }
          await this.restApiCall(routerConfig!, 'POST', '/ip/hotspot/user/add', {
            name: config.adminUsername,
            password: config.adminPassword,
            profile: userProfileName,
            comment: 'Hotspot Admin',
          });
        } else {
          const client = this.getClient(routerId);
          try {
            await client.write('/ip/hotspot/user/profile/add', [
              `=name=${userProfileName}`,
              `=address-pool=${poolName}`,
              `=rate-limit=1M/1M`,
            ]);
          } catch (err: any) {
            if (!skipIfExists(err)) throw err;
          }
          await client.write('/ip/hotspot/user/add', [
            `=name=${config.adminUsername}`,
            `=password=${config.adminPassword}`,
            `=profile=${userProfileName}`,
            `=comment=Hotspot Admin`,
          ]);
        }
        results.adminUser = config.adminUsername;
      } catch (err: any) {
        if (!skipIfExists(err)) throw err;
        results.adminUser = `${config.adminUsername} (already exists)`;
      }

      return results;
    } catch (err) {
      console.error(`setupHotspot failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getWalledGarden(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const entries = await this.restApiCall(config, 'GET', '/ip/hotspot/walled-garden');
      return Array.isArray(entries) ? entries : [];
    }

    const client = this.getClient(routerId);
    try {
      const result = await client.write('/ip/hotspot/walled-garden/print');
      return Array.isArray(result) ? result : [];
    } catch (err) {
      console.log(`Walled garden query failed for router ${routerId}, returning empty array`);
      return [];
    }
  }

  async createWalledGarden(routerId: number, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'POST', '/ip/hotspot/walled-garden', data);
    }

    const client = this.getClient(routerId);
    try {
      const command = ['/ip/hotspot/walled-garden/add'];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`createWalledGarden failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async deleteWalledGarden(routerId: number, id: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'DELETE', `/ip/hotspot/walled-garden/${id}`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write(['/ip/hotspot/walled-garden/remove', `=.id=${id}`]);
    } catch (err) {
      console.error(`deleteWalledGarden failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async updateWalledGarden(routerId: number, id: string, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'PUT', `/ip/hotspot/walled-garden/${id}`, data);
    }

    const client = this.getClient(routerId);
    try {
      const command = [`/ip/hotspot/walled-garden/set`, `.id=${id}`];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`updateWalledGarden failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getIpBindings(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const bindings = await this.restApiCall(config, 'GET', '/ip/hotspot/ip-binding');
      return Array.isArray(bindings) ? bindings : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/ip/hotspot/ip-binding/print');
    } catch (err) {
      console.error(`getIpBindings failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async createIpBinding(routerId: number, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'POST', '/ip/hotspot/ip-binding', data);
    }

    const client = this.getClient(routerId);
    try {
      const command = ['/ip/hotspot/ip-binding/add'];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`createIpBinding failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async deleteIpBinding(routerId: number, id: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'DELETE', `/ip/hotspot/ip-binding/${id}`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write(['/ip/hotspot/ip-binding/remove', `=.id=${id}`]);
    } catch (err) {
      console.error(`deleteIpBinding failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async updateIpBinding(routerId: number, id: string, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'PUT', `/ip/hotspot/ip-binding/${id}`, data);
    }

    const client = this.getClient(routerId);
    try {
      const command = [`/ip/hotspot/ip-binding/set`, `.id=${id}`];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`updateIpBinding failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getHotspotCookie(routerId: number): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const cookie = await this.restApiCall(config, 'GET', '/ip/hotspot/cookie');
      return Array.isArray(cookie) && cookie.length > 0 ? cookie[0] : null;
    }

    const client = this.getClient(routerId);
    try {
      const result = await client.write('/ip/hotspot/cookie/print');
      return Array.isArray(result) && result.length > 0 ? result[0] : null;
    } catch (err) {
      console.log(`Cookie query failed for router ${routerId}, returning null`);
      return null;
    }
  }

  async getHotspotCookies(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const cookies = await this.restApiCall(config, 'GET', '/ip/hotspot/cookie');
      return Array.isArray(cookies) ? cookies : [];
    }

    const client = this.getClient(routerId);
    try {
      const result = await client.write('/ip/hotspot/cookie/print');
      return Array.isArray(result) ? result : [];
    } catch (err) {
      console.log(`Cookies query failed for router ${routerId}, returning empty array`);
      return [];
    }
  }

  async deleteHotspotCookie(routerId: number, cookieId: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'DELETE', `/ip/hotspot/cookie/${cookieId}`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write(['/ip/hotspot/cookie/remove', `=.id=${cookieId}`]);
    } catch (err) {
      console.error(`deleteHotspotCookie failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getUserProfiles(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const profiles = await this.restApiCall(config, 'GET', '/ip/hotspot/user/profile');
      return Array.isArray(profiles) ? profiles : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/ip/hotspot/user/profile/print');
    } catch (err) {
      console.error(`getUserProfiles failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async createUserProfile(routerId: number, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'POST', '/ip/hotspot/user/profile/add', data);
    }

    const client = this.getClient(routerId);
    try {
      const command = ['/ip/hotspot/user/profile/add'];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`createUserProfile failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async updateUserProfile(routerId: number, profileId: string, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      return await this.restApiCall(config, 'PUT', `/ip/hotspot/user/profile/${profileId}`, data);
    }

    const client = this.getClient(routerId);
    try {
      const command = [`/ip/hotspot/user/profile/set`, `.id=${profileId}`];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== '') {
          command.push(`=${key}=${value}`);
        }
      }
      return await client.write(command);
    } catch (err) {
      console.error(`updateUserProfile failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async deleteUserProfile(routerId: number, profileId: string): Promise<void> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      await this.restApiCall(config, 'DELETE', `/ip/hotspot/user/profile/${profileId}`);
      return;
    }

    const client = this.getClient(routerId);
    try {
      await client.write(['/ip/hotspot/user/profile/remove', `.id=${profileId}`]);
    } catch (err) {
      console.error(`deleteUserProfile failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async setHotspotCookie(routerId: number, data: any): Promise<any> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const existing = await this.getHotspotCookie(routerId);
      if (existing && existing['.id']) {
        return await this.restApiCall(config, 'PUT', `/ip/hotspot/cookie/${existing['.id']}`, data);
      }
      return await this.restApiCall(config, 'POST', '/ip/hotspot/cookie', data);
    }

    const client = this.getClient(routerId);
    try {
      const existing = await client.write('/ip/hotspot/cookie/print');
      if (Array.isArray(existing) && existing.length > 0 && existing[0]['.id']) {
        const command = ['/ip/hotspot/cookie/set', `=.id=${existing[0]['.id']}`];
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && value !== null && value !== '') {
            command.push(`=${key}=${value}`);
          }
        }
        return await client.write(command);
      } else {
        const command = ['/ip/hotspot/cookie/add'];
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && value !== null && value !== '') {
            command.push(`=${key}=${value}`);
          }
        }
        return await client.write(command);
      }
    } catch (err) {
      console.error(`setHotspotCookie failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getInterfaces(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const interfaces = await this.restApiCall(config, 'GET', '/interface');
      return Array.isArray(interfaces) ? interfaces : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/interface/print');
    } catch (err) {
      console.error(`getInterfaces failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getInterfaceTraffic(routerId: number): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);

    if (config?.useRestApi) {
      const traffic = await this.restApiCall(config, 'GET', '/interface/monitor-traffic?once=true');
      return Array.isArray(traffic) ? traffic : [];
    }

    const client = this.getClient(routerId);
    try {
      return await client.write('/interface/monitor-traffic', ['=once=']);
    } catch (err) {
      console.error(`getInterfaceTraffic failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  private async genericList(routerId: number, restPath: string, apiPath: string): Promise<any[]> {
    const config = this.routerConfigs.get(routerId);
    if (config?.useRestApi) {
      const result = await this.restApiCall(config, 'GET', restPath);
      return Array.isArray(result) ? result : [];
    }
    const client = this.getClient(routerId);
    try {
      return await client.write(apiPath);
    } catch (err) {
      console.error(`genericList ${apiPath} failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  private async genericCreate(routerId: number, restPath: string, apiPath: string, data: Record<string, any>): Promise<any> {
    const config = this.routerConfigs.get(routerId);
    if (config?.useRestApi) {
      return await this.restApiCall(config, 'POST', restPath, data);
    }
    const client = this.getClient(routerId);
    try {
      const params: string[] = [];
      for (const [key, value] of Object.entries(data)) {
        params.push(`=${key}=${value}`);
      }
      const result = await client.write(apiPath, params);
      return result[0] || {};
    } catch (err) {
      console.error(`genericCreate ${apiPath} failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  private async genericUpdate(routerId: number, restPath: string, apiPath: string, id: string, data: Record<string, any>): Promise<any> {
    const config = this.routerConfigs.get(routerId);
    if (config?.useRestApi) {
      return await this.restApiCall(config, 'PUT', `${restPath}/${id}`, data);
    }
    const client = this.getClient(routerId);
    try {
      const params: string[] = [`=.id=${id}`];
      for (const [key, value] of Object.entries(data)) {
        params.push(`=${key}=${value}`);
      }
      const result = await client.write(apiPath, params);
      return result[0] || {};
    } catch (err) {
      console.error(`genericUpdate ${apiPath} failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  private async genericDelete(routerId: number, restPath: string, apiPath: string, id: string): Promise<any> {
    const config = this.routerConfigs.get(routerId);
    if (config?.useRestApi) {
      return await this.restApiCall(config, 'DELETE', `${restPath}/${id}`);
    }
    const client = this.getClient(routerId);
    try {
      const result = await client.write(apiPath, [`=.id=${id}`]);
      return result[0] || {};
    } catch (err) {
      console.error(`genericDelete ${apiPath} failed for router ${routerId}:`, (err as Error).message);
      throw err;
    }
  }

  async getInterfaceList(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/list', '/interface/list/print');
  }
  async createInterfaceList(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/list/add', '/interface/list/add', data);
  }
  async updateInterfaceList(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/list', '/interface/list/set', id, data);
  }
  async deleteInterfaceList(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/list', '/interface/list/remove', id);
  }

  async getEthernet(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/ethernet', '/interface/ethernet/print');
  }
  async updateEthernet(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/ethernet', '/interface/ethernet/set', id, data);
  }

  async getVlans(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/vlan', '/interface/vlan/print');
  }
  async createVlan(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/vlan/add', '/interface/vlan/add', data);
  }
  async updateVlan(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/vlan', '/interface/vlan/set', id, data);
  }
  async deleteVlan(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/vlan', '/interface/vlan/remove', id);
  }

  async getBridges(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/bridge', '/interface/bridge/print');
  }
  async createBridge(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/bridge/add', '/interface/bridge/add', data);
  }
  async updateBridge(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/bridge', '/interface/bridge/set', id, data);
  }
  async deleteBridge(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/bridge', '/interface/bridge/remove', id);
  }

  async getEoIP(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/eoip', '/interface/eoip/print');
  }
  async createEoIP(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/eoip/add', '/interface/eoip/add', data);
  }
  async updateEoIP(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/eoip', '/interface/eoip/set', id, data);
  }
  async deleteEoIP(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/eoip', '/interface/eoip/remove', id);
  }

  async getIpTunnels(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/ipip', '/interface/ipip/print');
  }
  async createIpTunnel(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/ipip/add', '/interface/ipip/add', data);
  }
  async updateIpTunnel(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/ipip', '/interface/ipip/set', id, data);
  }
  async deleteIpTunnel(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/ipip', '/interface/ipip/remove', id);
  }

  async getGRE(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/gre', '/interface/gre/print');
  }
  async createGRE(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/gre/add', '/interface/gre/add', data);
  }
  async updateGRE(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/gre', '/interface/gre/set', id, data);
  }
  async deleteGRE(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/gre', '/interface/gre/remove', id);
  }

  async getVRRP(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/vrrp', '/interface/vrrp/print');
  }
  async createVRRP(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/vrrp/add', '/interface/vrrp/add', data);
  }
  async updateVRRP(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/vrrp', '/interface/vrrp/set', id, data);
  }
  async deleteVRRP(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/vrrp', '/interface/vrrp/remove', id);
  }

  async getBonding(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/bonding', '/interface/bonding/print');
  }
  async createBonding(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/bonding/add', '/interface/bonding/add', data);
  }
  async updateBonding(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/bonding', '/interface/bonding/set', id, data);
  }
  async deleteBonding(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/bonding', '/interface/bonding/remove', id);
  }

  async getMACsec(routerId: number): Promise<any[]> {
    return this.genericList(routerId, '/interface/macsec', '/interface/macsec/print');
  }
  async createMACsec(routerId: number, data: Record<string, any>): Promise<any> {
    return this.genericCreate(routerId, '/interface/macsec/add', '/interface/macsec/add', data);
  }
  async updateMACsec(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface/macsec', '/interface/macsec/set', id, data);
  }
  async deleteMACsec(routerId: number, id: string): Promise<any> {
    return this.genericDelete(routerId, '/interface/macsec', '/interface/macsec/remove', id);
  }

  async updateInterface(routerId: number, id: string, data: Record<string, any>): Promise<any> {
    return this.genericUpdate(routerId, '/interface', '/interface/set', id, data);
  }

  private async hasFlashDirectory(routerId: number): Promise<boolean> {
    if (this.hasFlashCache.has(routerId)) {
      return this.hasFlashCache.get(routerId)!;
    }

    const config = this.routerConfigs.get(routerId);
    if (!config) return false;

    try {
      if (config.useRestApi) {
        const protocol = config.port === 443 ? 'https' : 'http';
        const url = `${protocol}://${config.host}:${config.port}/rest/file/print`;
        const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Basic ${auth}` },
        });
        if (response.ok) {
          const files = await response.json();
          const hasFlash = Array.isArray(files) && files.some((f: any) => f.name && f.name.startsWith('flash/'));
          this.hasFlashCache.set(routerId, hasFlash);
          return hasFlash;
        }
      } else {
        const client = this.getClient(routerId);
        const files = await client.write('/file/print');
        const hasFlash = Array.isArray(files) && files.some((f: any) => f.name && f.name.startsWith('flash/'));
        this.hasFlashCache.set(routerId, hasFlash);
        return hasFlash;
      }
    } catch (err) {
      console.error(`Failed to check flash directory for router ${routerId}:`, (err as Error).message);
    }

    this.hasFlashCache.set(routerId, false);
    return false;
  }

  async uploadFile(routerId: number, filename: string, content: string | Buffer): Promise<void> {
    const config = this.routerConfigs.get(routerId);
    if (!config) {
      throw new Error(`Router ${routerId} not found`);
    }

    const hasFlash = await this.hasFlashDirectory(routerId);
    const remoteName = hasFlash
      ? (filename.startsWith('flash/') ? filename : `flash/${filename}`)
      : (filename.startsWith('flash/') ? filename.slice(6) : filename);

    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');

    if (config.useRestApi) {
      const protocol = config.port === 443 ? 'https' : 'http';
      const url = `${protocol}://${config.host}:${config.port}/rest/file/add?name=${encodeURIComponent(remoteName)}`;
      const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Basic ${auth}`,
        },
        body: data,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`REST upload failed: ${response.status} ${response.statusText}${text ? ' - ' + text.slice(0, 200) : ''}`);
      }
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let incoming: Buffer = Buffer.alloc(0);
      let state: 'login' | 'query' | 'removing' | 'adding' | 'final' = 'login';
      let settled = false;
      let chunkOffset = 0;
      let fileId = '';

      const timeout = setTimeout(() => {
        fail(new Error('File upload timed out'));
      }, 60000); // Increased from 30s to 60s for large files

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        reject(err);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.end();
        resolve();
      };

      const sendChunks = () => {
        const CHUNK = 8192;
        let totalSent = 0;
        let chunkIndex = 0;
        const chunks: Buffer[] = [];

        // Prepare all chunks
        while (chunkOffset < data.length) {
          const end = Math.min(chunkOffset + CHUNK, data.length);
          const chunk = data.subarray(chunkOffset, end);
          // Send with length encoding as per MikroTik API spec
          chunks.push(Buffer.concat([this.encodeApiLength(chunk.length), chunk]));
          totalSent += chunk.length;
          chunkOffset = end;
          chunkIndex++;
        }

        console.log(`[uploadFile] Prepared ${chunkIndex} chunks (${totalSent} bytes), sending with flush`);

        // Send all chunks sequentially with proper flushing
        let sendIndex = 0;
        const sendNext = () => {
          if (sendIndex < chunks.length) {
            const written = socket.write(chunks[sendIndex], () => {
              sendIndex++;
              sendNext();
            });
            if (!written) {
              // Wait for drain if buffer is full
              socket.once('drain', () => {
                sendIndex++;
                sendNext();
              });
            }
          } else {
            // All chunks sent, now send zero-length terminator
            console.log(`[uploadFile] All chunks sent, sending terminator`);
            socket.write(Buffer.from([0]), () => {
              console.log(`[uploadFile] Terminator sent, waiting for router response`);
              state = 'final';
            });
          }
        };

        sendNext();
      };

      socket.on('data', (buf: Buffer) => {
        incoming = Buffer.concat([incoming, buf]);
        let parsed = this.parseApiSentence(incoming);
        while (parsed) {
          incoming = parsed.rest;
          const words = parsed.sentence;
          const type = words[0] || '';

          console.log(`[uploadFile] State: ${state}, Received: ${type}`);

          if (type === '!fatal') {
            fail(new Error(words.slice(1).join(' ') || 'Router rejected the command'));
            return;
          }

          if (state === 'login' && type === '!done') {
            const ret = words.find((w) => w.startsWith('=ret='));
            if (ret && ret.length > 5) {
              const challengeHex = ret.slice(5);
              const challenge = Buffer.alloc(config.password.length + 17);
              challenge.write(String.fromCharCode(0) + config.password);
              challenge.write(challengeHex, config.password.length + 1, challengeHex.length / 2, 'hex');
              const resp = '00' + crypto.createHash('MD5').update(challenge).digest('hex');
              socket.write(this.buildApiSentence(['/login', `=name=${config.username}`, `=response=${resp}`]));
            } else {
              state = 'query';
              socket.write(this.buildApiSentence(['/file/print']));
            }
          } else if (state === 'query' && type === '!re') {
            const nameWord = words.find((w) => w.startsWith('=name='));
            const idWord = words.find((w) => w.startsWith('=.id='));
            if (nameWord && nameWord.slice(6) === remoteName && idWord) {
              fileId = idWord.slice(5);
            }
          } else if (state === 'query' && type === '!done') {
            console.log(`[uploadFile] Query done, fileId=${fileId || 'none'}`);
            if (fileId) {
              state = 'removing';
              socket.write(this.buildApiSentence(['/file/remove', `=.id=${fileId}`]));
            } else {
              state = 'adding';
              socket.write(this.buildApiSentence(['/file/add', `=name=${remoteName}`]));
            }
          } else if (state === 'removing' && type === '!done') {
            console.log(`[uploadFile] Remove done, adding file`);
            state = 'adding';
            socket.write(this.buildApiSentence(['/file/add', `=name=${remoteName}`]));
          } else if (state === 'adding' && type === '!re') {
            console.log(`[uploadFile] Ignoring !re in adding state`);
          } else if (state === 'adding' && type === '!done') {
            console.log(`[uploadFile] File created, sending ${data.length} bytes in chunks`);
            sendChunks();
          } else if (state === 'adding' && type === '!trap') {
            fail(new Error(words.slice(1).join(' ') || 'Failed to create file'));
            return;
          } else if (state === 'final' && type === '!trap') {
            const errorMsg = words.slice(1).join(' ') || 'Failed to write file content';
            console.log(`[uploadFile] Router rejected file content: ${errorMsg}`);
            fail(new Error(errorMsg));
            return;
          } else if (state === 'final' && type === '!done') {
            console.log(`[uploadFile] Upload complete`);
            succeed();
            return;
          } else {
            console.log(`[uploadFile] Unhandled: state=${state}, type=${type}, words=${words.join(', ')}`);
          }

          parsed = this.parseApiSentence(incoming);
        }
      });

      socket.on('error', (err) => {
        console.log(`[uploadFile] Socket error: ${err.message}`);
        fail(err);
      });
      socket.on('close', () => {
        console.log(`[uploadFile] Socket closed`);
        fail(new Error('Connection closed unexpectedly during file upload'));
      });

      socket.connect(config.port, config.host, () => {
        socket.write(this.buildApiSentence(['/login', `=name=${config.username}`, `=password=${config.password}`]));
      });
    });
  }

  async uploadFileSFTP(routerId: number, filename: string, content: string | Buffer): Promise<void> {
    const config = this.routerConfigs.get(routerId);
    if (!config) {
      throw new Error(`Router ${routerId} not found`);
    }

    const hasFlash = await this.hasFlashDirectory(routerId);
    const remotePath = hasFlash
      ? (filename.startsWith('flash/') ? filename : `flash/${filename}`)
      : (filename.startsWith('flash/') ? filename.slice(6) : filename);

    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');

    console.log(`[SFTP] Uploading ${data.length} bytes to ${remotePath} on ${config.host}`);

    return new Promise<void>((resolve, reject) => {
      const conn = new SSHClient();

      conn.on('ready', () => {
        console.log(`[SFTP] SSH connection established`);
        conn.sftp((err, sftp) => {
          if (err) {
            console.error(`[SFTP] SFTP error: ${err.message}`);
            reject(new Error(`SFTP connection failed: ${err.message}`));
            return;
          }

          console.log(`[SFTP] SFTP session opened, writing file`);

          // Ensure directory exists
          const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
          if (dir) {
            sftp.mkdir(dir, { mode: 0o755 }, (mkdirErr) => {
              if (mkdirErr) {
                console.log(`[SFTP] Directory may already exist: ${mkdirErr.message}`);
              }

              // Write file
              const writeStream = sftp.createWriteStream(remotePath);

              writeStream.on('close', () => {
                console.log(`[SFTP] File written successfully`);
                sftp.end();
                conn.end();
                resolve();
              });

              writeStream.on('error', (writeErr: Error) => {
                console.error(`[SFTP] Write error: ${writeErr.message}`);
                sftp.end();
                conn.end();
                reject(new Error(`File write failed: ${writeErr.message}`));
              });

              writeStream.write(data);
              writeStream.end();
            });
          } else {
            // No directory prefix, write directly
            const writeStream = sftp.createWriteStream(remotePath);

            writeStream.on('close', () => {
              console.log(`[SFTP] File written successfully`);
              sftp.end();
              conn.end();
              resolve();
            });

            writeStream.on('error', (writeErr: Error) => {
              console.error(`[SFTP] Write error: ${writeErr.message}`);
              sftp.end();
              conn.end();
              reject(new Error(`File write failed: ${writeErr.message}`));
            });

            writeStream.write(data);
            writeStream.end();
          }
        });
      });

      conn.on('error', (err) => {
        console.error(`[SFTP] Connection error: ${err.message}`);
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.connect({
        host: config.host,
        port: 22,
        username: config.username,
        password: config.password,
        readyTimeout: 30000,
      });
    });
  }

  private encodeApiLength(len: number): Buffer {
    if (len < 0x80) {
      return Buffer.from([len]);
    } else if (len < 0x4000) {
      const l = len | 0x8000;
      return Buffer.from([(l >> 8) & 0xff, l & 0xff]);
    } else if (len < 0x200000) {
      const l = len | 0xc00000;
      return Buffer.from([(l >> 16) & 0xff, (l >> 8) & 0xff, l & 0xff]);
    } else if (len < 0x10000000) {
      const l = len | 0xe0000000;
      const b = Buffer.alloc(4);
      b.writeUInt32BE(l >>> 0, 0);
      return b;
    }
    const b = Buffer.alloc(5);
    b[0] = 0xf0;
    b.writeUInt32BE(len >>> 0, 1);
    return b;
  }

  private buildApiSentence(words: string[]): Buffer {
    const parts: Buffer[] = [];
    for (const word of words) {
      const data = Buffer.from(word, 'utf8');
      parts.push(this.encodeApiLength(data.length));
      parts.push(data);
    }
    parts.push(Buffer.from([0]));
    return Buffer.concat(parts);
  }

  private parseApiSentence(buffer: Buffer): { sentence: string[]; rest: Buffer } | null {
    const words: string[] = [];
    let pos = 0;

    const readLength = (): number | null => {
      if (pos >= buffer.length) return null;
      const first = buffer[pos++];
      if (first & 0x80) {
        if ((first & 0xc0) === 0x80) {
          if (pos >= buffer.length) return null;
          return ((first & 0x3f) << 8) | buffer[pos++];
        }
        if ((first & 0xe0) === 0xc0) {
          if (pos + 1 >= buffer.length) return null;
          const len = ((first & 0x1f) << 16) | (buffer[pos] << 8) | buffer[pos + 1];
          pos += 2;
          return len;
        }
        if ((first & 0xf0) === 0xe0) {
          if (pos + 2 >= buffer.length) return null;
          const len = ((first & 0x0f) << 24) | (buffer[pos] << 16) | (buffer[pos + 1] << 8) | buffer[pos + 2];
          pos += 3;
          return len;
        }
        if (pos + 3 >= buffer.length) return null;
        const len = (buffer[pos] << 24) | (buffer[pos + 1] << 16) | (buffer[pos + 2] << 8) | buffer[pos + 3];
        pos += 4;
        return len >>> 0;
      }
      return first;
    };

    for (;;) {
      const len = readLength();
      if (len === null) return null;
      if (len === 0) break;
      if (pos + len > buffer.length) return null;
      words.push(buffer.subarray(pos, pos + len).toString('utf8'));
      pos += len;
    }

    return { sentence: words, rest: buffer.subarray(pos) };
  }

  disconnectAll(): void {
    for (const [id, timer] of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    for (const [id, conn] of this.connections) {
      conn.removeAllListeners('error');
      conn.close().catch(() => {});
    }
    this.connections.clear();
    this.routerConfigs.clear();
    this.reconnectAttempts.clear();
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
