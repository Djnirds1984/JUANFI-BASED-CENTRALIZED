import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getPortalDefaultContent, listHotspotFiles, EDITABLE_EXTENSIONS } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';
import { config } from '../config';
import { getDb } from '../database';

const router = Router();

// Public endpoint — portal page needs vendo config pre-login
router.get('/vendo-config', (req: Request, res: Response) => {
  try {
    const configPath = path.join(__dirname, '..', '..', 'hotspot', 'assets', 'js', 'config.js');
    let content = '';
    try {
      content = fs.readFileSync(configPath, 'utf8');
    } catch {
      res.status(404).json({ error: 'Config file not found' });
      return;
    }

    const getBool = (name: string): boolean => {
      const m = content.match(new RegExp(`var\\s+${name}\\s*=\\s*(true|false)\\s*;`));
      return m ? m[1] === 'true' : false;
    };
    const getNum = (name: string): number => {
      const m = content.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
      return m ? parseInt(m[1], 10) : 0;
    };
    const getStr = (name: string): string => {
      const m = content.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"\\s*;`));
      return m ? m[1] : '';
    };

    const addresses: Array<{ vendoName: string; vendoIp: string; chargingEnable: boolean; eloadEnable: boolean }> = [];
    const arrayMatch = content.match(/var\s+multiVendoAddresses\s*=\s*\[([\s\S]*?)\];/);
    if (arrayMatch) {
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
    }

    res.json({
      isMultiVendo: getBool('isMultiVendo'),
      multiVendoOption: getNum('multiVendoOption'),
      multiVendoAddresses: addresses,
      vendorIpAddress: getStr('vendorIpAddress'),
      chargingEnable: getBool('chargingEnable'),
      eloadEnable: getBool('eloadEnable'),
      loginOption: getNum('loginOption'),
      dataRateOption: getBool('dataRateOption'),
      macAsVoucherCode: getBool('macAsVoucherCode'),
    });
  } catch (error: any) {
    console.error('vendo-config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Public endpoint — check if MAC has valid session for auto-login
router.get('/check-session', (req: Request, res: Response) => {
  try {
    const macWithColons = String(req.query.mac || '').trim().toLowerCase().replace(/-/g, ':');
    const macNoColons = macWithColons.replace(/:/g, '').toUpperCase();
    const routerId = parseInt(String(req.query.routerId || '1'), 10);

    console.log(`[check-session] Request: mac=${macWithColons}, macNoColons=${macNoColons}, routerId=${routerId}`);

    if (!macWithColons || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(macWithColons)) {
      console.log(`[check-session] Invalid MAC format`);
      res.status(400).json({ error: 'Valid MAC is required' });
      return;
    }

    const db = getDb();

    // Check if hotspot_user exists for this MAC (username = MAC without colons)
    const hotspotUser = db.prepare(
      'SELECT id, username FROM hotspot_users WHERE router_id = ? AND username = ? AND disabled = 0'
    ).get(routerId, macNoColons) as any;

    console.log(`[check-session] hotspot_user lookup:`, hotspotUser ? `Found id=${hotspotUser.id}` : 'NOT FOUND');

    if (!hotspotUser) {
      console.log(`[check-session] No hotspot_user found, returning hasSession=false`);
      res.json({ hasSession: false });
      return;
    }

    // Check if voucher exists for this MAC
    const voucher = db.prepare(
      `SELECT id, duration_minutes, used_at, is_used
       FROM vouchers
       WHERE router_id = ? AND code = ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(routerId, macNoColons) as any;

    console.log(`[check-session] voucher lookup:`, voucher ? `Found id=${voucher.id}, duration=${voucher.duration_minutes}min, is_used=${voucher.is_used}, used_at=${voucher.used_at}` : 'NOT FOUND');

    if (!voucher || voucher.duration_minutes <= 0) {
      console.log(`[check-session] No valid voucher found, returning hasSession=false`);
      res.json({ hasSession: false });
      return;
    }

    // Check device_sessions for remaining time
    const session = db.prepare(
      `SELECT remaining_seconds, last_seen
       FROM device_sessions
       WHERE mac_address = ? AND router_id = ?
       ORDER BY last_seen DESC LIMIT 1`
    ).get(macWithColons, routerId) as any;

    console.log(`[check-session] device_session lookup:`, session ? `Found remaining=${session.remaining_seconds}s` : 'NOT FOUND');

    let hasValidTime = false;
    let remainingSeconds = 0;

    // Priority 1: device_sessions has remaining time (but sanity check - must be > 60s)
    // The sync function might set a small value if MikroTik hasn't fully calculated session time yet
    if (session && session.remaining_seconds > 60) {
      hasValidTime = true;
      remainingSeconds = session.remaining_seconds;
      console.log(`[check-session] Using device_sessions remaining time: ${remainingSeconds}s`);
    }
    // Priority 2: calculate from voucher duration + used_at
    else if (voucher.duration_minutes > 0 && voucher.used_at) {
      const usedAt = new Date(voucher.used_at + 'Z').getTime();
      const expiresAt = usedAt + voucher.duration_minutes * 60 * 1000;
      const now = Date.now();
      if (expiresAt > now) {
        hasValidTime = true;
        remainingSeconds = Math.floor((expiresAt - now) / 1000);
        console.log(`[check-session] Calculated from voucher: ${remainingSeconds}s remaining`);
      } else {
        console.log(`[check-session] Voucher expired`);
      }
    }
    // Priority 3: voucher exists with duration but used_at is NULL (just created or reset)
    else if (voucher.duration_minutes > 0 && !voucher.used_at) {
      // Voucher was created/reset but not yet used - treat as having full time
      hasValidTime = true;
      remainingSeconds = voucher.duration_minutes * 60;
      console.log(`[check-session] Voucher not yet used, full time: ${remainingSeconds}s`);
    }

    console.log(`[check-session] Result: hasSession=${hasValidTime}, remainingSeconds=${remainingSeconds}, username=${macNoColons}`);
    res.json({
      hasSession: hasValidTime,
      remainingSeconds,
      username: macNoColons,
    });
  } catch (error: any) {
    console.error('[check-session] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.use(authMiddleware);

function getFolderRoot(folder?: string): string {
  if (folder === 'panel-page') {
    return path.resolve(__dirname, '..', '..', 'public');
  }
  return path.resolve(__dirname, '..', '..', folder === 'stub' ? 'stub' : 'hotspot');
}

function resolveDiskPath(filePath: string, folder?: string): string {
  const root = getFolderRoot(folder);
  if (folder === 'panel-page') {
    return path.join(root, 'portal.html');
  }
  return path.join(root, filePath.replace(/\\/g, '/'));
}

function validatePortalPath(filePath: string, folder?: string): boolean {
  if (folder === 'panel-page') {
    return filePath === 'portal.html';
  }
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  const root = getFolderRoot(folder);
  const full = path.resolve(root, normalized);
  return full.startsWith(root + path.sep) || full === root;
}

function isEditable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return EDITABLE_EXTENSIONS.has(ext);
}

function getFolder(req: Request): string {
  const folder = (req.query.folder as string) || (req.body && req.body.folder) || 'hotspot';
  if (folder === 'stub') return 'stub';
  if (folder === 'panel-page') return 'panel-page';
  return 'hotspot';
}

function replaceStubPlaceholders(content: string, routerId: number): string {
  const panelIp = config.controllerLanIp || config.host;
  const panelPort = config.port;
  return content
    .replace(/ROUTER_ID_PLACEHOLDER/g, String(routerId))
    .replace(/PANEL_URL_PLACEHOLDER/g, panelIp)
    .replace(/:3000/g, `:${panelPort}`);
}

router.get('/', (req: Request, res: Response) => {
  try {
    const folder = getFolder(req);

    // Special case: panel-page folder only has portal.html
    if (folder === 'panel-page') {
      const portalPath = path.join(getFolderRoot('panel-page'), 'portal.html');
      let mtime: string | null = null;
      let size = 0;
      try {
        const stat = fs.statSync(portalPath);
        mtime = stat.mtime.toISOString();
        size = stat.size;
      } catch {}
      res.json({
        files: [{
          path: 'portal.html',
          editable: true,
          size,
          modified: mtime,
        }],
        folder: 'panel-page',
      });
      return;
    }

    const files = listHotspotFiles(folder);
    const root = getFolderRoot(folder);
    const result = files.map((f) => {
      const diskPath = resolveDiskPath(f.path, folder);
      let mtime: string | null = null;
      try {
        mtime = fs.statSync(diskPath).mtime.toISOString();
      } catch {}
      return {
        path: f.path,
        editable: f.editable,
        size: f.size,
        modified: mtime,
      };
    });

    res.json({ files: result, folder });
  } catch (error) {
    console.error('Get portal files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/file/*', (req: Request, res: Response) => {
  try {
    const folder = getFolder(req);
    const filePath = req.params[0];
    if (!validatePortalPath(filePath, folder)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    if (!isEditable(filePath)) {
      res.status(400).json({ error: 'File is not editable (binary asset)' });
      return;
    }

    const diskPath = resolveDiskPath(filePath, folder);
    let content: string | null = null;
    let mtime: string | null = null;

    try {
      content = fs.readFileSync(diskPath, 'utf8');
      mtime = fs.statSync(diskPath).mtime.toISOString();
    } catch {}

    if (content === null) {
      content = getPortalDefaultContent(filePath, folder);
      if (content === null) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
    }

    res.json({ path: filePath, content, updated_at: mtime });
  } catch (error) {
    console.error('Get portal file error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/file/*', (req: Request, res: Response) => {
  try {
    const folder = getFolder(req);
    const filePath = req.params[0];
    if (!validatePortalPath(filePath, folder)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    if (!isEditable(filePath)) {
      res.status(400).json({ error: 'File is not editable (binary asset)' });
      return;
    }

    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const diskPath = resolveDiskPath(filePath, folder);
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, content, 'utf8');

    res.json({ message: 'File saved' });
  } catch (error: any) {
    console.error('Save portal file error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/reset/*', (req: Request, res: Response) => {
  try {
    const folder = getFolder(req);
    const filePath = req.params[0];
    if (!validatePortalPath(filePath, folder)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    if (!isEditable(filePath)) {
      res.status(400).json({ error: 'File is not editable (binary asset)' });
      return;
    }

    const content = getPortalDefaultContent(filePath, folder);
    if (content === null) {
      res.status(500).json({ error: 'Default template not found on server' });
      return;
    }

    const diskPath = resolveDiskPath(filePath, folder);
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, content, 'utf8');

    res.json({ message: 'File reset to default' });
  } catch (error: any) {
    console.error('Reset portal file error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/push-file/:routerId', async (req: Request, res: Response) => {
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

    const folder = getFolder(req);
    const { file: filePath } = req.body;
    if (!filePath || typeof filePath !== 'string') {
      res.status(400).json({ error: 'file is required' });
      return;
    }

    if (!validatePortalPath(filePath, folder)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    const routerPath = `hotspot/${filePath}`;
    const editable = isEditable(filePath);

    if (editable) {
      const diskPath = resolveDiskPath(filePath, folder);
      let content: string;
      try {
        content = fs.readFileSync(diskPath, 'utf8');
      } catch {
        const def = getPortalDefaultContent(filePath, folder);
        if (!def) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        content = def;
      }
      if (folder === 'stub') {
        content = replaceStubPlaceholders(content, routerId);
      }
      await mikroTikService.uploadFileSFTP(routerId, routerPath, content);
    } else {
      const fullPath = path.join(getFolderRoot(folder), filePath);
      const data = fs.readFileSync(fullPath);
      await mikroTikService.uploadFileSFTP(routerId, routerPath, data);
    }

    res.json({ message: `${filePath} pushed to router` });
  } catch (error: any) {
    console.error('Push single portal file error:', error);
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

    const folder = getFolder(req);
    const root = getFolderRoot(folder);
    const allFiles = listHotspotFiles(folder);
    const results: { file: string; ok: boolean; error?: string }[] = [];

    for (const f of allFiles) {
      try {
        const routerPath = `hotspot/${f.path}`;
        if (f.editable) {
          const diskPath = resolveDiskPath(f.path, folder);
          let content: string;
          try {
            content = fs.readFileSync(diskPath, 'utf8');
          } catch {
            const def = getPortalDefaultContent(f.path, folder);
            if (!def) {
              results.push({ file: f.path, ok: false, error: 'File not found' });
              continue;
            }
            content = def;
          }
          if (folder === 'stub') {
            content = replaceStubPlaceholders(content, routerId);
          }
          await mikroTikService.uploadFileSFTP(routerId, routerPath, content);
        } else {
          const fullPath = path.join(root, f.path);
          const data = fs.readFileSync(fullPath);
          await mikroTikService.uploadFileSFTP(routerId, routerPath, data);
        }
        results.push({ file: f.path, ok: true });
      } catch (err: any) {
        results.push({ file: f.path, ok: false, error: err.message });
      }
    }

    const failed = results.filter((r) => !r.ok);
    res.json({
      message: failed.length === 0
        ? `All ${results.length} files pushed to router`
        : `${failed.length} of ${results.length} file(s) failed to push`,
      results,
    });
  } catch (error: any) {
    console.error('Push portal files error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
