/**
 * Anti-tethering (connection sharing) guard.
 *
 * A client that shares its paid link forwards packets for another device. That
 * forward is the only difference the router can see between "the paying device"
 * and "the device behind it": the extra hop costs one TTL. Sending everything
 * the panel forwards *toward* a hotspot client with TTL 1 therefore leaves the
 * client itself working (a host accepts TTL 1) while a forwarded packet dies at
 * the client (1 -> 0). IPv6 has no TTL, so the same idea rides on the hop limit.
 *
 * The rules live on the router and carry one exact comment tag, so the panel
 * reads its state from what is actually enforcing instead of remembering a
 * toggle that could drift from the device.
 */

export const ANTI_TETHER_TAG = 'aircoins-anti-tether';

export interface TetherTargets {
  ipv4: string[];
  ipv6: string[];
}

export const NO_TARGETS: TetherTargets = { ipv4: [], ipv6: [] };

interface AddressRow {
  address?: string;
  interface?: string;
}

interface MangleRow {
  '.id'?: string;
  comment?: string;
  'dst-address'?: string;
  [key: string]: unknown;
}

function isIPv6Target(value: string): boolean {
  return value.includes(':');
}

/**
 * Turn an interface address into the network it covers, because a rule names
 * the subnet, not the gateway: 10.5.50.1/24 -> 10.5.50.0/24. Returns '' for
 * anything that is not a usable IPv4 address.
 */
export function v4Network(cidr: string): string {
  const [rawIp = '', rawPrefix] = String(cidr || '').trim().split('/');
  const octets = rawIp.split('.').map((part) => Number(part));
  if (octets.length !== 4) return '';
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return '';

  const prefix = rawPrefix === undefined || rawPrefix === '' ? 24 : Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) return '';

  const value = octets.reduce((acc, octet) => (acc * 256) + octet, 0);
  const mask = 2 ** (32 - prefix);
  const network = value - (value % mask);

  return `${[24, 16, 8, 0].map((shift) => Math.floor(network / 2 ** shift) % 256).join('.')}/${prefix}`;
}

/**
 * One target per hotspot interface address: a hotspot server runs on its own
 * interface, so that interface's address is exactly the client subnet. IPv4 is
 * normalized here so the rule list stays stable between runs; an IPv6 address
 * is handed to RouterOS in interface form and normalized by the router.
 */
export function tetherTargets(addresses: AddressRow[], hotspotInterfaces: string[]): TetherTargets {
  const interfaces = new Set(
    (Array.isArray(hotspotInterfaces) ? hotspotInterfaces : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  );
  const ipv4 = new Set<string>();
  const ipv6 = new Set<string>();

  for (const row of Array.isArray(addresses) ? addresses : []) {
    const name = String(row?.interface || '').trim();
    const address = String(row?.address || '').trim();
    if (!name || !address || !interfaces.has(name)) continue;

    if (isIPv6Target(address)) {
      ipv6.add(address.includes('/') ? address : `${address}/64`);
      continue;
    }

    const network = v4Network(address);
    if (network) ipv4.add(network);
  }

  return { ipv4: [...ipv4], ipv6: [...ipv6] };
}

/** A `/ip firewall mangle` (or `/ipv6 firewall mangle`) row for one subnet. */
export function tetherRule(target: string): Record<string, string> {
  if (isIPv6Target(target)) {
    return {
      chain: 'forward',
      action: 'change-hop-limit',
      'new-hop-limit': 'set:1',
      'dst-address': target,
      comment: ANTI_TETHER_TAG,
    };
  }
  return {
    chain: 'forward',
    action: 'change-ttl',
    'new-ttl': 'set:1',
    'dst-address': target,
    comment: ANTI_TETHER_TAG,
  };
}

/** Family a target belongs to, so it is written into the matching mangle menu. */
export function targetFamily(target: string): 'ip' | 'ipv6' {
  return isIPv6Target(target) ? 'ipv6' : 'ip';
}

/**
 * Only rules carrying the exact tag are ever read or removed - a near match
 * (an operator's own "anti-tether-OLD" rule) must survive untouched.
 */
export function isTetherRule(rule: MangleRow): boolean {
  return String(rule?.comment || '').trim() === ANTI_TETHER_TAG;
}

/** Networks the tagged rules currently cover, split by family, for the readout. */
export function coveredNetworks(rules: MangleRow[]): TetherTargets {
  const ipv4 = new Set<string>();
  const ipv6 = new Set<string>();

  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!isTetherRule(rule)) continue;
    const network = String(rule['dst-address'] || '').trim();
    if (!network) continue;
    (isIPv6Target(network) ? ipv6 : ipv4).add(network);
  }

  return { ipv4: [...ipv4], ipv6: [...ipv6] };
}

/** Targets the router should have but does not, i.e. the rules drifted. */
export function missingTargets(wanted: TetherTargets, covered: TetherTargets): TetherTargets {
  const missingV4 = wanted.ipv4.filter((network) => !covered.ipv4.includes(network));
  const missingV6 = wanted.ipv6.filter((network) => !covered.ipv6.includes(network));
  return { ipv4: missingV4, ipv6: missingV6 };
}
