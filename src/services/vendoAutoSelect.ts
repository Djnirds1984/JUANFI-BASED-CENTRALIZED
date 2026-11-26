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

    const declared = usable.find((candidate) =>
      (candidate.subnets || []).some((subnet) => ipInSubnet(clientIp, subnet)),
    );
    if (declared) return pick(declared, 'subnet');

    const sameNetwork = usable.find((candidate) => ipInSubnet(clientIp, candidate.ip));
    if (sameNetwork) return pick(sameNetwork, 'subnet');
  }

  const onRouter = usable.filter((candidate) => routerId > 0 && candidate.routerId === routerId);
  if (onRouter.length === 1) return pick(onRouter[0], 'router');

  if (usable.length === 1) return pick(usable[0], 'only');
  return null;
}
