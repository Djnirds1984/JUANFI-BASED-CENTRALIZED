import fs from 'fs';
import path from 'path';

/*
 * The coin machine (sub-vendo / NodeMCU) is reached DIRECTLY by the customer's
 * phone: the portal posts /topUp and /checkCoin to `vendorIpAddress`, and only
 * the resulting credit goes through the controller. Two things therefore have to
 * stay true or INSERT COIN fails with "Coin slot is not available" on a machine
 * the admin panel happily shows as online:
 *
 *  1. the address the portal posts to must be a machine that still exists, and
 *  2. an UNAUTHENTICATED hotspot client must be allowed to reach it at all.
 *
 * Both are handled here so the panel, the portal and the router agree on one
 * list of machines.
 */

const ROUTER_CONFIG_PATH = path.join(__dirname, '..', '..', 'hotspot', 'assets', 'js', 'config.js');
const DEVICES_FILE = path.join(__dirname, '..', '..', 'data', 'nodemcu-devices.json');

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

export interface VendoConfigShape {
  isMultiVendo: boolean;
  vendorIpAddress: string;
  multiVendoAddresses: Array<{ vendoIp: string }>;
}

/**
 * `vendorIpAddress` is the default machine, and the admin UI edits it separately
 * from the machine list - so when a sub-vendo changes IP the list is updated and
 * the default silently keeps pointing at the old address. Never hand the portal a
 * default that is not one of the machines it can actually display: fall back to
 * the first listed vendo. Without a list the single default stays as configured.
 */
export function resolveVendorIp<T extends VendoConfigShape>(cfg: T): T {
  const list = (cfg.multiVendoAddresses || [])
    .map(v => String(v && v.vendoIp || '').trim())
    .filter(ip => !!ip);
  if (!cfg.isMultiVendo || list.length === 0) return cfg;
  if (list.includes(String(cfg.vendorIpAddress || '').trim())) return cfg;
  return { ...cfg, vendorIpAddress: list[0] };
}

/**
 * Every address a phone may have to reach to insert a coin: the machines in the
 * generated hotspot config plus the ones registered in the panel.
 */
export function listVendoAddresses(): string[] {
  const ips = new Set<string>();

  try {
    const content = fs.readFileSync(ROUTER_CONFIG_PATH, 'utf8');
    const def = content.match(/var\s+vendorIpAddress\s*=\s*"([^"]*)"/);
    const multi = content.match(/var\s+isMultiVendo\s*=\s*(true|false)/);
    const listed: Array<{ vendoIp: string }> = [];
    const arrayMatch = content.match(/var\s+multiVendoAddresses\s*=\s*\[([\s\S]*?)\];/);
    if (arrayMatch) {
      const ipRe = /vendoIp:\s*"([^"]*)"/g;
      let m;
      while ((m = ipRe.exec(arrayMatch[1])) !== null) listed.push({ vendoIp: m[1].trim() });
    }
    // Resolve before collecting: a default that no listed machine matches is the
    // dead address that broke INSERT COIN, and it must not get a router rule.
    const cfg = resolveVendorIp({
      isMultiVendo: multi ? multi[1] === 'true' : listed.length > 0,
      vendorIpAddress: def ? def[1].trim() : '',
      multiVendoAddresses: listed,
    });
    for (const ip of [cfg.vendorIpAddress, ...listed.map(v => v.vendoIp)]) {
      if (IP_RE.test(ip)) ips.add(ip);
    }
  } catch { /* no hotspot config on disk yet */ }

  try {
    const parsed = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
    for (const d of Array.isArray(parsed) ? parsed : []) {
      const ip = String(d && d.ip || '').trim();
      if (IP_RE.test(ip)) ips.add(ip);
    }
  } catch { /* no registered machines yet */ }

  return Array.from(ips);
}

/*
 * ---------------------------------------------------------------------------
 * hotspot/assets/js/config.js - the file the portal is built from. Parsing and
 * generating live here so the admin page, the portal endpoint and the
 * "register this machine" step of sub-vendo provisioning cannot drift apart.
 * ---------------------------------------------------------------------------
 */

export interface VendoEntry {
  vendoName: string;
  vendoIp: string;
  chargingEnable: boolean;
  eloadEnable: boolean;
  hotspotAddress?: string;
  interfaceName?: string;
}

export interface SubVendoConfig extends VendoConfigShape {
  isMultiVendo: boolean;
  multiVendoOption: number;
  multiVendoAddresses: VendoEntry[];
  loginOption: number;
  dataRateOption: boolean;
  vendorIpAddress: string;
  chargingEnable: boolean;
  eloadEnable: boolean;
  showPauseTime: boolean;
  showMemberLogin: boolean;
  showExtendTimeButton: boolean;
  disableVoucherInput: boolean;
  macAsVoucherCode: boolean;
  qrCodeVoucherPurchase: boolean;
  controllerApiUrl: string;
  sessionCookieName: string;
}

export function parseConfigJs(content: string): SubVendoConfig {
  const getBool = (name: string): boolean => {
    const match = content.match(new RegExp(`var\\s+${name}\\s*=\\s*(true|false)\\s*;`));
    return match ? match[1] === 'true' : false;
  };

  const getNum = (name: string): number => {
    const match = content.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
    return match ? parseInt(match[1], 10) : 0;
  };

  const getStr = (name: string): string => {
    const match = content.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"\\s*;`));
    return match ? match[1] : '';
  };

  const parseVendoAddresses = (): VendoEntry[] => {
    const arrayMatch = content.match(/var\s+multiVendoAddresses\s*=\s*\[([\s\S]*?)\];/);
    if (!arrayMatch) return [];

    const arrayContent = arrayMatch[1];
    const entries: VendoEntry[] = [];
    const objectRegex = /\{([^}]+)\}/g;
    let objMatch;

    while ((objMatch = objectRegex.exec(arrayContent)) !== null) {
      const objContent = objMatch[1];
      const entry: VendoEntry = {
        vendoName: '',
        vendoIp: '',
        chargingEnable: false,
        eloadEnable: false,
      };

      const nameMatch = objContent.match(/vendoName:\s*"([^"]*)"/);
      if (nameMatch) entry.vendoName = nameMatch[1];

      const ipMatch = objContent.match(/vendoIp:\s*"([^"]*)"/);
      if (ipMatch) entry.vendoIp = ipMatch[1];

      const chargingMatch = objContent.match(/chargingEnable:\s*(true|false)/);
      if (chargingMatch) entry.chargingEnable = chargingMatch[1] === 'true';

      const eloadMatch = objContent.match(/eloadEnable:\s*(true|false)/);
      if (eloadMatch) entry.eloadEnable = eloadMatch[1] === 'true';

      const hotspotMatch = objContent.match(/hotspotAddress:\s*"([^"]*)"/);
      if (hotspotMatch) entry.hotspotAddress = hotspotMatch[1];

      const interfaceMatch = objContent.match(/interfaceName:\s*"([^"]*)"/);
      if (interfaceMatch) entry.interfaceName = interfaceMatch[1];

      entries.push(entry);
    }

    return entries;
  };

  return {
    isMultiVendo: getBool('isMultiVendo'),
    multiVendoOption: getNum('multiVendoOption'),
    multiVendoAddresses: parseVendoAddresses(),
    loginOption: getNum('loginOption'),
    dataRateOption: getBool('dataRateOption'),
    vendorIpAddress: getStr('vendorIpAddress'),
    chargingEnable: getBool('chargingEnable'),
    eloadEnable: getBool('eloadEnable'),
    showPauseTime: getBool('showPauseTime'),
    showMemberLogin: getBool('showMemberLogin'),
    showExtendTimeButton: getBool('showExtendTimeButton'),
    disableVoucherInput: getBool('disableVoucherInput'),
    macAsVoucherCode: getBool('macAsVoucherCode'),
    qrCodeVoucherPurchase: getBool('qrCodeVoucherPurchase'),
    controllerApiUrl: getStr('controllerApiUrl'),
    sessionCookieName: getStr('sessionCookieName'),
  };
}

export function generateConfigJs(config: SubVendoConfig): string {
  const vendoEntries = config.multiVendoAddresses.map((v) => {
    let entry = `\t{
\t\tvendoName: "${v.vendoName}",
\t\tvendoIp: "${v.vendoIp}",
\t\tchargingEnable: ${v.chargingEnable},
\t\teloadEnable: ${v.eloadEnable}`;
    if (v.hotspotAddress) {
      entry += `,
\t\thotspotAddress: "${v.hotspotAddress}"`;
    }
    if (v.interfaceName) {
      entry += `,
\t\tinterfaceName: "${v.interfaceName}"`;
    }
    entry += '\n\t}';
    return entry;
  });

  return `//this is to enable multi vendo setup, set to true when multi vendo is supported
var isMultiVendo = ${config.isMultiVendo};
// 0 = traditional (client choose a vendo) , 1 = auto select vendo base on hotspot address, 2 = interface name ( this will preserve one hotspot server ip only)
var multiVendoOption = ${config.multiVendoOption};

//list here all node mcu address for multi vendo setup
var multiVendoAddresses = [
${vendoEntries.join(',\n')}
];


//0 means its login by username only, 1 = means if login by username + password
var loginOption = ${config.loginOption}; //replace 1 if you want login voucher by username + password

var dataRateOption = ${config.dataRateOption}; //replace true if you enable data rates
//put here the default selected address
var vendorIpAddress = "${config.vendorIpAddress}";

var chargingEnable = ${config.chargingEnable}; //replace true if you enable charging, this can be override if multivendo setup

var eloadEnable = ${config.eloadEnable}; //replace true if you enable eload, this can be override if multivendo setup

//hide pause time / logout true = you want to show pause / logout button
var showPauseTime = ${config.showPauseTime};

//enable member login, true = if you want to enable member login
var showMemberLogin = ${config.showMemberLogin};

//enable extend time button for customers
var showExtendTimeButton = ${config.showExtendTimeButton};

//disable voucher input
var disableVoucherInput = ${config.disableVoucherInput};

//enable mac address as voucher code
var macAsVoucherCode = ${config.macAsVoucherCode};

var qrCodeVoucherPurchase = ${config.qrCodeVoucherPurchase};

// JuanFi centralized roaming session token support.
var controllerApiUrl = "${config.controllerApiUrl || ''}";
var sessionCookieName = "${config.sessionCookieName || 'juanfi_sid'}";
`;
}

/** Current on-disk sub-vendo config, or null when it has never been generated. */
export function readSubVendoConfig(): SubVendoConfig | null {
  try {
    return parseConfigJs(fs.readFileSync(ROUTER_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function writeSubVendoConfig(config: SubVendoConfig): void {
  fs.mkdirSync(path.dirname(ROUTER_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(ROUTER_CONFIG_PATH, generateConfigJs(config), 'utf8');
}

/**
 * Register (or rename) a coin machine in the portal config so the customer can
 * actually pick it and the portal posts its coin request to it. Adding a device
 * to the panel without this leaves the machine monitored but unusable, which is
 * half of the "coin slot is not available" reports.
 */
export function registerVendoMachine(
  name: string,
  ip: string
): { added: boolean; renamed: boolean; defaultSet: boolean } {
  const config = readSubVendoConfig() || parseConfigJs('');
  const entry = config.multiVendoAddresses.find((v) => String(v.vendoIp).trim() === ip);
  let added = false;
  let renamed = false;

  if (entry) {
    if (name && entry.vendoName !== name) {
      entry.vendoName = name;
      renamed = true;
    }
  } else {
    config.multiVendoAddresses.push({
      vendoName: name || `Vendo ${ip}`,
      vendoIp: ip,
      chargingEnable: false,
      eloadEnable: false,
    });
    added = true;
  }

  // The default has to be one of the machines, and a freshly registered one is
  // the address the operator is about to test with.
  let defaultSet = false;
  const known = config.multiVendoAddresses.map((v) => String(v.vendoIp).trim());
  if (!config.isMultiVendo || !known.includes(String(config.vendorIpAddress || '').trim())) {
    defaultSet = config.vendorIpAddress !== ip;
    config.vendorIpAddress = ip;
  }

  writeSubVendoConfig(config);
  return { added, renamed, defaultSet };
}
