import fs from 'fs';
import path from 'path';
import { NodeMcuDevice, NodeMcuFirmwareType } from './nodemcu';

/*
 * The registered coin machines. This file used to be read and written only by
 * the admin device routes; the wallet needs it too, because the amount of money
 * a customer inserted is only trustworthy when the controller talks to a machine
 * IT knows about - never to an address a phone typed in.
 */

const DEVICES_FILE = path.join(__dirname, '..', '..', 'data', 'nodemcu-devices.json');

export function loadDevices(): NodeMcuDevice[] {
  try {
    const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Devices registered before firmware types existed are all JuanFi boards.
    return parsed.map((device: NodeMcuDevice) => ({
      ...device,
      firmwareType: firmwareTypeOf(device),
    }));
  } catch {
    return [];
  }
}

export function firmwareTypeOf(device: Partial<NodeMcuDevice> | undefined): NodeMcuFirmwareType {
  return device && device.firmwareType === 'aircoins' ? 'aircoins' : 'juanfi';
}

export function saveDevices(devices: NodeMcuDevice[]): void {
  fs.mkdirSync(path.dirname(DEVICES_FILE), { recursive: true });
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
}

export function findDevice(id: number): NodeMcuDevice | undefined {
  return loadDevices().find((d) => d.id === id);
}

/** Look up a machine by the address the portal used (exact IPv4 match). */
export function findDeviceByIp(ip: any): NodeMcuDevice | undefined {
  const wanted = String(ip || '').trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(wanted)) return undefined;
  return loadDevices().find((d) => String(d.ip || '').trim() === wanted);
}
