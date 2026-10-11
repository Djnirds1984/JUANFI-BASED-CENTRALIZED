import { execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface ZeroTierStatus {
  installed: boolean;
  version?: string;
  address?: string;
  online: boolean;
  networks: ZeroTierNetwork[];
}

export interface ZeroTierNetwork {
  id: string;
  name: string;
  status: string;
  type: string;
  mac: string;
  mtu: number;
  broadcast: boolean;
  bridging: boolean;
  routeViaZeroTier: boolean;
  assignedAddresses: string[];
}

const isWindows = process.platform === 'win32';
const zerotierCli = isWindows ? 'zerotier-cli' : 'zerotier-cli';

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (error: any) {
    throw new Error(error.message || 'Command failed');
  }
}

export function checkInstalled(): boolean {
  try {
    runCommand(`${zerotierCli} version`);
    return true;
  } catch {
    return false;
  }
}

export function getVersion(): string {
  try {
    return runCommand(`${zerotierCli} version`);
  } catch {
    return 'Not installed';
  }
}

export function getStatus(): ZeroTierStatus {
  const installed = checkInstalled();

  if (!installed) {
    return {
      installed: false,
      online: false,
      networks: [],
    };
  }

  try {
    const version = getVersion();
    const statusOutput = runCommand(`${zerotierCli} status`);

    // Parse status output: "200 info <address> <version> ONLINE"
    const statusMatch = statusOutput.match(/200 info (\S+) (\S+) (\S+)/);
    const address = statusMatch?.[1] || '';
    const online = statusMatch?.[3] === 'ONLINE';

    const networks = getNetworks();

    return {
      installed: true,
      version,
      address,
      online,
      networks,
    };
  } catch (error: any) {
    return {
      installed: true,
      online: false,
      networks: [],
    };
  }
}

export function getNetworks(): ZeroTierNetwork[] {
  try {
    const listOutput = runCommand(`${zerotierCli} listnetworks -j`);
    const networks = JSON.parse(listOutput);

    return networks.map((net: any) => ({
      id: net.nwid || '',
      name: net.name || 'Unnamed',
      status: net.status || 'UNKNOWN',
      type: net.type || 'PRIVATE',
      mac: net.mac || '',
      mtu: net.mtu || 0,
      broadcast: net.broadcast || false,
      bridging: net.bridging || false,
      routeViaZeroTier: net.routeViaZeroTier || false,
      assignedAddresses: net.assignedAddresses || [],
    }));
  } catch {
    return [];
  }
}

export function joinNetwork(networkId: string): string {
  try {
    const result = runCommand(`${zerotierCli} join ${networkId}`);
    return result;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to join network');
  }
}

export function leaveNetwork(networkId: string): string {
  try {
    const result = runCommand(`${zerotierCli} leave ${networkId}`);
    return result;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to leave network');
  }
}

export async function installZeroTier(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (isWindows) {
      // Windows installation
      const installerUrl = 'https://download.zerotier.com/dist/ZeroTier%20One.msi';
      const installerPath = path.join(__dirname, '..', '..', 'data', 'ZeroTier-Installer.msi');

      fs.mkdirSync(path.dirname(installerPath), { recursive: true });

      // Download installer
      exec(`curl -L "${installerUrl}" -o "${installerPath}"`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error('Failed to download ZeroTier installer'));
          return;
        }

        // Run installer silently
        exec(`msiexec /i "${installerPath}" /quiet /norestart`, (error, stdout, stderr) => {
          if (error) {
            reject(new Error('Failed to install ZeroTier'));
            return;
          }
          resolve('ZeroTier installed successfully. Please restart the panel.');
        });
      });
    } else {
      // Linux installation
      exec('curl -s https://install.zerotier.com | sudo bash', (error, stdout, stderr) => {
        if (error) {
          reject(new Error('Failed to install ZeroTier'));
          return;
        }
        resolve('ZeroTier installed successfully');
      });
    }
  });
}
