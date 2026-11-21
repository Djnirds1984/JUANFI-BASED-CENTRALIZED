import { mikroTikService } from './mikrotik';
import { registerVendoMachine } from './vendoConfig';

/*
 * A coin machine only earns money when four separate things agree: the router
 * keeps its address, the router never asks it to log in, an UNAUTHENTICATED
 * phone is allowed to reach it, and the portal offers it in the vendo list.
 * Doing that by hand in Winbox is how machines end up half-configured - the
 * panel shows the NodeMCU online while INSERT COIN says "coin slot is not
 * available". Registering a device runs all four steps and reports each one.
 */

export interface ProvisionStep {
  step: 'mac' | 'static' | 'bypass' | 'walledGarden' | 'portalList';
  label: string;
  ok: boolean;
  detail: string;
}

export interface ProvisionResult {
  mac: string;
  steps: ProvisionStep[];
  ok: boolean;
}

const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

/** Colon-separated upper case, or '' when the value is not a MAC address. */
export function normalizeMac(value: any): string {
  const raw = String(value || '').trim().toUpperCase().replace(/-/g, ':');
  return MAC_RE.test(raw) ? raw : '';
}

const isTrue = (v: any): boolean => v === true || v === 'true' || v === 1 || v === '1';

function addrOf(value: any): string {
  return String(value || '').trim().split('/')[0];
}

function step(step: ProvisionStep['step'], label: string, ok: boolean, detail: string): ProvisionStep {
  return { step, label, ok, detail };
}

/**
 * The DHCP server responsible for an address: the one that handed out the
 * current lease, else the one serving the interface ARP learned it on, else the
 * only server on the router.
 */
async function findDhcpServer(routerId: number, ip: string, mac: string, lease: any): Promise<string> {
  if (lease && lease.server) return String(lease.server);

  const [servers, arp] = await Promise.all([
    mikroTikService.getDhcpServers(routerId),
    mikroTikService.getArpEntries(routerId),
  ]);
  const usable = servers.filter((s: any) => !isTrue(s.disabled));
  const viaArp = usable.find((s: any) => {
    const entry = arp.find((a: any) => addrOf(a.address) === ip);
    return entry && s.interface && String(entry.interface) === String(s.interface);
  });
  if (viaArp) return String(viaArp.name);
  if (usable.length === 1) return String(usable[0].name);
  return '';
}

/** Step 1: the machine must keep this address forever, or its walled-garden rule goes stale. */
async function makeIpStatic(routerId: number, name: string, ip: string, mac: string): Promise<ProvisionStep> {
  const label = 'Static IP (DHCP lease)';
  try {
    const leases = await mikroTikService.getDhcpLeases(routerId);
    const list = Array.isArray(leases) ? leases : [];
    const lease = list.find((l: any) => normalizeMac(l['mac-address']) === mac || normalizeMac(l['active-mac-address']) === mac)
      || list.find((l: any) => addrOf(l.address || l['active-address']) === ip);

    if (lease && !isTrue(lease.dynamic)) {
      const current = addrOf(lease.address || lease['active-address']);
      if (current && current !== ip) {
        return step('static', label, false, `lease ${lease['.id']} already pins this MAC to ${current}`);
      }
      return step('static', label, true, `already static (${ip} on ${lease.server || 'dhcp'})`);
    }

    if (lease) {
      await mikroTikService.makeDhcpLeaseStatic(routerId, String(lease['.id']));
      return step('static', label, true, `lease ${lease['.id']} made static (${ip})`);
    }

    const server = await findDhcpServer(routerId, ip, mac, lease);
    if (!server) {
      return step('static', label, false, 'no DHCP server could be matched to this address - create the lease in Winbox');
    }
    await mikroTikService.createDhcpLease(routerId, {
      address: ip,
      'mac-address': mac,
      server,
      comment: `JuanFi sub-vendo ${name}`,
    });
    return step('static', label, true, `static lease created for ${ip} on ${server}`);
  } catch (err) {
    return step('static', label, false, (err as Error).message);
  }
}

/** Step 2: the machine itself is infrastructure - it must never be asked to log in. */
async function bypassHotspotLogin(routerId: number, name: string, ip: string, mac: string): Promise<ProvisionStep> {
  const label = 'Hotspot bypass (IP binding)';
  const comment = `JuanFi sub-vendo ${name}`;
  try {
    const bindings = await mikroTikService.getIpBindings(routerId);
    const list = Array.isArray(bindings) ? bindings : [];
    const mine = list.filter((b: any) =>
      (mac !== '' && normalizeMac(b['mac-address']) === mac) || (mac === '' && addrOf(b.address) === ip));
    const wanted = { 'mac-address': mac, address: ip, type: 'bypassed', server: 'all', disabled: 'false', comment };

    // RouterOS refuses a MAC/address pair that another row already claims
    // ("such client already exists"), so duplicates left by an earlier build
    // have to go before the surviving row can be corrected.
    for (const extra of mine.slice(1)) {
      if (String(extra.comment || '').startsWith('JuanFi sub-vendo')) {
        await mikroTikService.deleteIpBinding(routerId, String(extra['.id']));
      }
    }

    if (!mine.length) {
      await mikroTikService.createIpBinding(routerId, wanted);
      return step('bypass', label, true, `bypassed binding created for ${ip}`);
    }

    const keep = mine[0];
    const correct = keep.type === 'bypassed' && addrOf(keep.address) === ip && !isTrue(keep.disabled);
    if (!correct) {
      await mikroTikService.updateIpBinding(routerId, String(keep['.id']), wanted);
      return step('bypass', label, true, `binding ${keep['.id']} updated to bypass ${ip}`);
    }

    return step('bypass', label, true, `already bypassed (binding ${keep['.id']})`);
  } catch (err) {
    const message = (err as Error).message;
    // The raw RouterOS answer is accurate but useless to an operator.
    const detail = message.includes('such client already exists')
      ? `${ip} or its MAC is bound twice in IP > Hotspot > IP Bindings - remove the extra row (${message})`
      : message;
    return step('bypass', label, false, detail);
  }
}

/** Step 3: a customer pays before logging in, so the machine must be outside the walled garden. */
async function allowBeforeLogin(routerId: number, ip: string): Promise<ProvisionStep> {
  const label = 'Walled garden (pay before login)';
  try {
    const [general, rules] = await Promise.all([
      mikroTikService.getWalledGarden(routerId),
      mikroTikService.getWalledGardenIp(routerId),
    ]);
    // Only the IP menu actually opens an address to an unauthenticated client; a
    // hostname-menu row with the same IP is accepted by RouterOS and installs no
    // firewall rule, so it must never count as "already allowed".
    const open = (Array.isArray(rules) ? rules : []).some((e: any) => addrOf(e['dst-address']) === ip);

    for (const dead of (Array.isArray(general) ? general : [])) {
      if (String(dead['dst-host'] || '').trim() !== ip) continue;
      if (!String(dead.comment || '').startsWith('sub-vendo coin machine')) continue;
      await mikroTikService.deleteWalledGarden(routerId, String(dead['.id']));
    }

    if (open) return step('walledGarden', label, true, `${ip} is already allowed`);

    await mikroTikService.createWalledGardenIp(routerId, {
      'dst-address': ip,
      action: 'accept',
      comment: 'sub-vendo coin machine (insert coin before login)',
    });
    return step('walledGarden', label, true, `${ip} allowed for unauthenticated clients`);
  } catch (err) {
    return step('walledGarden', label, false, (err as Error).message);
  }
}

/**
 * Register a sub-vendo on its router and in the portal config.
 * Every step is independent: a router that refuses one (offline, address already
 * used, no DHCP server) still gets the rest, and the caller sees what to fix.
 */
export async function provisionSubVendo(
  routerId: number,
  opts: { name: string; ip: string; mac?: string }
): Promise<ProvisionResult> {
  const steps: ProvisionStep[] = [];
  const ip = String(opts.ip || '').trim();

  let mac = normalizeMac(opts.mac);
  if (!mac) {
    // The machine answers ARP and holds a DHCP lease even when nobody typed its
    // MAC, so look it up instead of asking the operator to open Winbox.
    try {
      const [leases, arp] = await Promise.all([
        mikroTikService.getDhcpLeases(routerId),
        mikroTikService.getArpEntries(routerId),
      ]);
      const lease = (Array.isArray(leases) ? leases : [])
        .find((l: any) => addrOf(l.address || l['active-address']) === ip);
      mac = normalizeMac(lease && (lease['mac-address'] || lease['active-mac-address']))
        || normalizeMac((Array.isArray(arp) ? arp : []).find((a: any) => addrOf(a.address) === ip)?.['mac-address']);
    } catch { /* resolved below */ }
  }
  steps.push(step('mac', 'MAC address', !!mac,
    mac ? `${mac}${normalizeMac(opts.mac) ? ' (from the panel)' : ' (found on the router)'}`
      : 'unknown - the machine must be powered on and connected once'));

  // The portal list does not need the router, so it is written even when the
  // router is unreachable - a machine the customer can select is already better.
  try {
    const res = registerVendoMachine(opts.name, ip);
    steps.push(step('portalList', 'Portal vendo list', true, res.added
      ? `${opts.name} (${ip}) added to config.js${res.defaultSet ? ' and set as default' : ''}`
      : `${ip} is already listed${res.renamed ? ` as "${opts.name}"` : ''}${res.defaultSet ? ' and set as default' : ''}`));
  } catch (err) {
    steps.push(step('portalList', 'Portal vendo list', false, (err as Error).message));
  }

  if (!mikroTikService.isConnected(routerId)) {
    steps.push(step('static', 'Static IP (DHCP lease)', false, 'router is not connected'));
    steps.push(step('bypass', 'Hotspot bypass (IP binding)', false, 'router is not connected'));
    steps.push(step('walledGarden', 'Walled garden (pay before login)', false, 'router is not connected'));
    return { mac, steps, ok: false };
  }

  if (!mac) {
    const detail = 'MAC address unknown - power the machine on, then run it again';
    steps.push(step('static', 'Static IP (DHCP lease)', false, detail));
    steps.push(step('bypass', 'Hotspot bypass (IP binding)', false, detail));
  } else {
    steps.push(await makeIpStatic(routerId, opts.name, ip, mac));
    steps.push(await bypassHotspotLogin(routerId, opts.name, ip, mac));
  }
  steps.push(await allowBeforeLogin(routerId, ip));

  return { mac, steps, ok: steps.every((s) => s.ok) };
}
