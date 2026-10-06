import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getDb, getPortalDefaultContent } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const CONFIG_PATH = 'assets/js/config.js';
const ROUTER_CONFIG_PATH = 'hotspot/assets/js/config.js';

interface VendoEntry {
  vendoName: string;
  vendoIp: string;
  chargingEnable: boolean;
  eloadEnable: boolean;
  hotspotAddress?: string;
  interfaceName?: string;
}

interface SubVendoConfig {
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
}

function parseConfigJs(content: string): SubVendoConfig {
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
  };
}

function generateConfigJs(config: SubVendoConfig): string {
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
`;
}

router.get('/config', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT content FROM portal_files WHERE path = ?').get(CONFIG_PATH) as any;
    const content = row ? row.content : getPortalDefaultContent(CONFIG_PATH);

    if (!content) {
      res.status(404).json({ error: 'Config file not found' });
      return;
    }

    const config = parseConfigJs(content);
    res.json(config);
  } catch (error) {
    console.error('Get SubVendo config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/config', (req: Request, res: Response) => {
  try {
    const config: SubVendoConfig = req.body;

    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: 'Invalid config data' });
      return;
    }

    const content = generateConfigJs(config);

    const db = getDb();
    db.prepare(
      `INSERT INTO portal_files (path, content, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
    ).run(CONFIG_PATH, content);

    const filePath = path.join(__dirname, '..', '..', ROUTER_CONFIG_PATH);
    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (err: any) {
      console.warn(`Could not write config file to disk: ${err.message}`);
    }

    res.json({ message: 'Config saved', content });
  } catch (error: any) {
    console.error('Save SubVendo config error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/push/:routerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (isNaN(routerId)) {
      res.status(400).json({ error: 'Invalid router id' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const db = getDb();
    const row = db.prepare('SELECT content FROM portal_files WHERE path = ?').get(CONFIG_PATH) as any;
    if (!row) {
      res.status(404).json({ error: 'Config file not found in database' });
      return;
    }

    await mikroTikService.uploadFile(routerId, ROUTER_CONFIG_PATH, row.content);
    res.json({ message: 'Config pushed to router' });
  } catch (error: any) {
    console.error('Push SubVendo config error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
