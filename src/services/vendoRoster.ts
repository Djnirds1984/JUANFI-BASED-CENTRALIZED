import fs from 'fs';
import path from 'path';
import { loadDevices, firmwareTypeOf } from './deviceRegistry';
import { vendoServesClient } from './vendoAutoSelect';
import type { VendoCandidate } from './vendoAutoSelect';
import type { NodeMcuDevice } from './nodemcu';

/*
 * Who the coin machines are, and which one a customer's network owns.
 *
 * Two flows ask that question - INSERT COIN (time) and LOAD WALLET (balance) -
 * and they must never disagree: a portal that shows one machine while the
 * wallet credits another would put the customer's pesos in the wrong slot. So
 * the roster and the refusal live here, and both API modules read them from
 * here instead of each keeping its own idea of the list.
 */

export type HotspotVendo = {
  vendoName: string;
  vendoIp: string;
  chargingEnable: boolean;
  eloadEnable: boolean;
};

/** The JuanFi-style `multiVendoAddresses` array out of the hotspot's config.js. */
export function parseMultiVendoAddresses(content: string): HotspotVendo[] {
  const addresses: HotspotVendo[] = [];
  const arrayMatch = content.match(/var\s+multiVendoAddresses\s*=\s*\[([\s\S]*?)\];/);
  if (!arrayMatch) return addresses;
  const objRe = /\{([^}]+)\}/g;
  let objMatch;
  while ((objMatch = objRe.exec(arrayMatch[1])) !== null) {
    const block = objMatch[1];
    const nameM = block.match(/vendoName:\s*"([^"]*)"/);
    const ipM = block.match(/vendoIp:\s*"([^"]*)"/);
    const chM = block.match(/chargingEnable:\s*(true|false)/);
    const elM = block.match(/eloadEnable:\s*(true|false)/);
    if (ipM) {
      addresses.push({
        vendoName: nameM ? nameM[1] : '',
        vendoIp: ipM[1],
        chargingEnable: chM ? chM[1] === 'true' : false,
        eloadEnable: elM ? elM[1] === 'true' : false,
      });
    }
  }
  return addresses;
}

export function hotspotConfigPath(): string {
  return path.join(__dirname, '..', '..', 'hotspot', 'assets', 'js', 'config.js');
}

/**
 * Every machine a portal could offer, in the shape its picker uses: the
 * AirCoins ones from the registry, then the JuanFi ones from the hotspot's own
 * config.js. An address registered as AirCoins is skipped - the registry is
 * what the panel actually sells through, and showing both would list one box
 * twice.
 */
export function vendoCandidates(): VendoCandidate[] {
  let devices: NodeMcuDevice[] = [];
  try {
    devices = loadDevices().filter((device) => firmwareTypeOf(device) === 'aircoins');
  } catch {
    devices = [];
  }

  const airCoins: VendoCandidate[] = devices.map((device) => ({
    value: `aircoins:${device.id}`,
    name: device.name || `AirCoins ${device.id}`,
    ip: String(device.ip || '').trim(),
    routerId: Number(device.routerId) || 0,
    subnets: Array.isArray(device.hotspotSubnets) ? device.hotspotSubnets.map(String) : [],
  }));

  let legacy: HotspotVendo[] = [];
  try {
    legacy = parseMultiVendoAddresses(fs.readFileSync(hotspotConfigPath(), 'utf8'));
  } catch {
    legacy = [];
  }
  const ours = new Set(devices.map((device) => String(device.ip || '').trim()));

  return [
    ...airCoins,
    ...legacy
      .filter((vendo) => !ours.has(String(vendo.vendoIp || '').trim()))
      .map((vendo) => ({
        value: String(vendo.vendoIp || ''),
        name: vendo.vendoName || vendo.vendoIp,
        ip: String(vendo.vendoIp || ''),
        routerId: 0,
        subnets: [],
      })),
  ];
}

/**
 * Is this coin action aimed at a machine that is not on the customer's network?
 *
 * VLAN isolation already keeps the sub-vendos off each other's segments, but an
 * AirCoins box has no web server: every coin goes through this panel, so the
 * panel is the only place that can refuse the wrong one. The address comes from
 * the hotspot redirect - nginx makes every request look like this box, so the
 * browser is the last place the phone's own lease is still known. When the
 * panel cannot name the network it stays out of the way rather than guess.
 */
export function foreignVendo(source: any, vendo: { id: number; ip: string }): boolean {
  const clientIp = String(source?.ip || source?.clientIp || '').trim();
  if (!clientIp) return false;
  const routerId = parseInt(String(source?.routerId || '1'), 10) || 0;
  return !vendoServesClient(clientIp, routerId, vendoCandidates(), `aircoins:${vendo.id}`, vendo.ip);
}