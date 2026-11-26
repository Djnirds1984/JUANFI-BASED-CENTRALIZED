/*
 * Which coin machine belongs to the network a phone is on.
 *
 * A hotspot hands out its leases per DHCP server, and every DHCP server is a
 * network: one SSID/VLAN, one subnet. Each sub-vendo is wired to one of those
 * networks, so the address the customer already has says which slot is theirs.
 * Asking them to pick from a list only invites them to feed somebody else's
 * machine - and the wrong pesos get credited to the wrong subnet's session.
 *
 * The rules are tried from most to least certain:
 *   address - the phone is the machine (its own portal page)
 *   subnet  - declared networks on the device, then the machine's own /24
 *   router  - only one machine provisioned on the phone's router
 *   only    - the panel knows exactly one machine at all
 * Anything else stays undecided and the portal keeps its old behaviour.
 */

export interface VendoCandidate {
  /** What the portal's dropdown uses as the value: an IP or `aircoins:<id>`. */
  value: string;
  name: string;
  /** Address the machine is reached on. Empty when the panel has none. */
  ip: string;
  /** Router this machine is provisioned on, 0 when unknown. */
  routerId: number;
  /** Explicit hotspot networks, e.g. ["10.0.200.0/24"]. May be empty. */
  subnets: string[];
}

export type AutoVendoReason = 'address' | 'subnet' | 'router' | 'only';

export interface AutoVendoChoice {
  value: string;
  name: string;
  reason: AutoVendoReason;
}

export function ipv4ToInt(ip: string): number | null {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = parseInt(part, 10);
    if (value > 255) return null;
    out = out * 256 + value;
  }
  return out;
}

function maskOf(bits: number): number {
  if (bits <= 0) return 0;
  return (0xffffffff << (32 - bits)) >>> 0;
}

/**
 * True when `ip` sits inside `subnet`. A bare address is read as its own /24,
 * which is what a router or device address means when it was typed without a
 * mask.
 */
export function ipInSubnet(ip: string, subnet: string): boolean {
  const addr = ipv4ToInt(ip);
  const raw = String(subnet || '').trim();
  if (addr === null || !raw) return false;
  const slash = raw.indexOf('/');
  const baseInt = ipv4ToInt(slash >= 0 ? raw.slice(0, slash) : raw);
  if (baseInt === null) return false;
  const bits = slash >= 0 ? parseInt(raw.slice(slash + 1), 10) : 24;
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const mask = maskOf(bits);
  return ((addr & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

export function autoSelectVendo(
  clientIp: string,
  routerId: number,
  candidates: VendoCandidate[],
): AutoVendoChoice | null {
  const usable = (candidates || []).filter((candidate) => candidate && candidate.value);
  if (usable.length === 0) return null;

  const pick = (candidate: VendoCandidate, reason: AutoVendoReason): AutoVendoChoice => ({
    value: candidate.value,
    name: candidate.name || candidate.value,
    reason,
  });

  const addr = ipv4ToInt(clientIp);
  if (addr !== null) {
    const sameAddress = usable.find((candidate) => ipv4ToInt(candidate.ip) === addr);
    if (sameAddress) return pick(sameAddress, 'address');

    // A segment names a machine only when exactly one machine claims it. Two
    // slots on one flat LAN (the usual small-shop wiring) would otherwise let
    // the first entry claim every lease on it - and then refuse those
    // customers the other slot that is right in front of them.
    const declared = usable.filter((candidate) =>
      (candidate.subnets || []).some((subnet) => ipInSubnet(clientIp, subnet)),
    );
    if (declared.length === 1) return pick(declared[0], 'subnet');
    if (declared.length === 0) {
      const sameNetwork = usable.filter((candidate) => ipInSubnet(clientIp, candidate.ip));
      if (sameNetwork.length === 1) return pick(sameNetwork[0], 'subnet');
    }
  }

  const onRouter = usable.filter((candidate) => routerId > 0 && candidate.routerId === routerId);
  if (onRouter.length === 1) return pick(onRouter[0], 'router');

  if (usable.length === 1) return pick(usable[0], 'only');
  return null;
}

/**
 * True when the pick came from the phone's own address - the machine wired to
 * that segment. `router` and `only` are fallbacks: they say "the panel has
 * nothing better", not "this is the machine in front of the customer", so a
 * portal must never lock a customer out on one of them.
 */
export function namesNetwork(choice: AutoVendoChoice | null): boolean {
  return !!choice && (choice.reason === 'address' || choice.reason === 'subnet');
}

/**
 * May a phone on `clientIp` pay the machine identified by `value` (a portal
 * value such as `aircoins:3` or an address) or by `ip`?
 *
 * Undecided networks always answer yes. The panel is the only route an AirCoins
 * box has, which also makes it the only place that can refuse the wrong one -
 * the portal's single visible machine is a courtesy, not the guarantee.
 */
export function vendoServesClient(
  clientIp: string,
  routerId: number,
  candidates: VendoCandidate[],
  value: string,
  ip = '',
): boolean {
  const usable = (candidates || []).filter((candidate) => candidate && candidate.value);
  const choice = autoSelectVendo(clientIp, routerId, usable);
  if (!namesNetwork(choice)) return true;

  // One machine, two possible names: the registry's `aircoins:<id>` and the
  // address the legacy list knows it by. Accept either on both sides, or a
  // re-registered box would refuse the very customer standing in front of it.
  const chosen = usable.find((candidate) => candidate.value === choice!.value);
  const identity = new Set<string>([choice!.value]);
  const chosenIp = chosen ? String(chosen.ip || '').trim() : '';
  if (chosenIp) identity.add(chosenIp);

  const wanted = String(value || '').trim();
  const machineIp = String(ip || '').trim();
  return identity.has(wanted) || (machineIp !== '' && identity.has(machineIp));
}
