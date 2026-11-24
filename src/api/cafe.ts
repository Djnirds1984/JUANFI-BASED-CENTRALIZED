import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../database';
import { authMiddleware } from '../middleware/auth';
import { agentPanelUrl, agentVersion } from '../services/cafeDiscovery';
import {
  CafeError,
  addCafeMachine,
  agentHeartbeat,
  agentRelock,
  agentUnlock,
  cafeSummary,
  claimAgentMachine,
  clearBypass,
  applyBypass,
  getCafeMachine,
  getCafeSettings,
  hasAdminPassword,
  listCafeMachines,
  listCandidates,
  machineState,
  noteAgentHello,
  parseRateList,
  pauseCafeMachine,
  reconcileBindings,
  releaseCafeMachine,
  removeCafeMachine,
  resetCafeMachine,
  resolveMac,
  saveCafeSettings,
  setAdminPassword,
  startCafeSession,
  updateCafeMachine,
} from '../services/cafe';

const router = Router();

/**
 * The address the PC itself connected from. Node writes an IPv4 peer as
 * ::ffff:a.b.c.d, and that string is useless for looking the machine up in the
 * router's ARP table, so it comes back as a plain dotted quad.
 */
function clientIp(req: Request): string {
  const raw = String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim();
  const v4 = raw.replace(/^::ffff:/i, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return '';
  // Loopback means the request came from the panel's own box, so the agent's
  // self-reported address is the only useful one. Let the caller fall back to it.
  return /^127\./.test(v4) ? '' : v4;
}

function fail(res: Response, error: any): void {
  if (error instanceof CafeError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error('Pisonet error:', error);
  res.status(500).json({ error: (error as Error).message });
}

// ============================================================ agent endpoints
//
// These run before authMiddleware because a Windows desktop in a shop is not an
// admin session. Each one is scoped to a single machine by its token, which the
// panel hands out when the PC is added and which can only ever answer for that
// one machine - it cannot list, add or touch anything else.

/**
 * "A PC with the app installed exists here." No token, no authority. If the shop
 * has already added this desktop, the beacon is also how the PC collects its
 * token, so the technician never types one.
 */
router.post('/agent/hello', async (req: Request, res: Response) => {
  try {
    const ip = clientIp(req) || req.body?.ip;
    const result = noteAgentHello({
      hostname: req.body?.hostname,
      ip,
      mac: req.body?.mac,
      version: req.body?.version,
    });
    const token = claimAgentMachine({ hostname: req.body?.hostname, ip, mac: req.body?.mac });
    res.json({ ok: true, ...result, token });
  } catch (error) {
    fail(res, error);
  }
});

function agentToken(req: Request): string {
  const header = req.headers['x-cafe-token'];
  return String(Array.isArray(header) ? header[0] : header || req.body?.token || '').trim();
}

/**
 * The heartbeat is the whole protocol: the agent asks what its state is and the
 * panel answers with the lock flag and an absolute deadline. A machine whose
 * token is unknown gets 404 so the agent can say "this PC has not been added to
 * the shop yet" instead of failing silently.
 */
router.post('/agent/heartbeat', async (req: Request, res: Response) => {
  const token = agentToken(req);
  if (!token) {
    res.status(400).json({ error: 'X-Cafe-Token is required' });
    return;
  }
  try {
    const state = agentHeartbeat(token, {
      bootId: req.body?.bootId,
      ip: clientIp(req) || req.body?.ip,
      version: req.body?.version,
      hostname: req.body?.hostname,
    });
    if (!state) {
      res.status(404).json({ error: 'Unknown machine token' });
      return;
    }
    // Fill in the MAC the router already knows, so a PC added by hostname is
    // still bypassed correctly. Rate limited: this is router I/O.
    await maybeLearnMac(token, clientIp(req) || String(req.body?.ip || ''));
    res.json(state);
  } catch (error) {
    fail(res, error);
  }
});

const macLookups = new Map<string, number>();

async function maybeLearnMac(token: string, ip: string): Promise<void> {
  if (!ip) return;
  const db = getDb();
  const machine = db.prepare('SELECT id, router_id, mac_address FROM cafe_machines WHERE token = ?').get(token) as any;
  if (!machine || machine.mac_address) return;
  const last = macLookups.get(token) || 0;
  if (Date.now() - last < 60000) return;
  macLookups.set(token, Date.now());
  const mac = await resolveMac(Number(machine.router_id), ip);
  if (!mac) return;
  const pretty = mac.match(/.{2}/g)?.join(':') || '';
  const clash = db.prepare('SELECT id FROM cafe_machines WHERE router_id = ? AND mac_address = ? AND id <> ?').get(machine.router_id, pretty, machine.id);
  if (clash) return;
  db.prepare("UPDATE cafe_machines SET mac_address = ?, updated_at = datetime('now') WHERE id = ?").run(pretty, machine.id);
  await applyBypass({ ...machine, mac_address: pretty }).catch(() => undefined);
  console.log(`[pisonet] learned ${pretty} for machine ${machine.id} from the router`);
}

/** The admin password is typed on the PC, checked here, and never stored there. */
router.post('/agent/unlock', async (req: Request, res: Response) => {
  const token = agentToken(req);
  if (!token) {
    res.status(400).json({ error: 'X-Cafe-Token is required' });
    return;
  }
  try {
    const result = await agentUnlock(token, String(req.body?.password || ''));
    res.status(result.ok ? 200 : 401).json(result.ok ? result : { error: result.error });
  } catch (error) {
    fail(res, error);
  }
});

/** "Lock this machine again" from the agent's own settings window. */
router.post('/agent/relock', (req: Request, res: Response) => {
  const token = agentToken(req);
  if (!token) {
    res.status(400).json({ error: 'X-Cafe-Token is required' });
    return;
  }
  try {
    const result = agentRelock(token);
    res.status(result.ok ? 200 : 404).json(result.ok ? result : { error: result.error });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * HTTP twin of the UDP shout, for an agent that was handed a guess at the address
 * and wants to confirm it is really talking to a JuanFi panel.
 */
router.get('/discover', (_req: Request, res: Response) => {
  res.json({ panel: true, panelUrl: agentPanelUrl(), version: agentVersion() });
});

/**
 * The agent installer. Nothing in the exe is a secret - the token is handed out
 * per machine later - so a technician can pull it straight onto a USB stick from
 * the desktop being set up.
 */
/** Where the built agent can be found: a compiled dist/ tree and a ts-node checkout. */
function agentBinary(): string {
  const candidates = [
    path.join(__dirname, '..', 'cafe-client', 'dist', 'JuanFiCafe.exe'),
    path.join(__dirname, '..', '..', 'cafe-client', 'dist', 'JuanFiCafe.exe'),
    path.join(process.cwd(), 'cafe-client', 'dist', 'JuanFiCafe.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

router.get('/agent/download', (_req: Request, res: Response) => {
  const file = agentBinary();
  if (!file) {
    res.status(404).json({ error: 'The agent has not been built on this panel. Run cafe-client\\build.ps1.' });
    return;
  }
  res.download(file, 'JuanFiCafe.exe');
});

/** What to write into config.ini, with this panel's own address already filled in. */
router.get('/setup', (_req: Request, res: Response) => {
  const url = agentPanelUrl();
  res.json({
    panelUrl: url,
    version: agentVersion(),
    configIni: `[agent]\nServer=${url}\n`,
    // A one-liner a technician can paste into PowerShell on the desktop.
    installLine: `powershell -Command "Invoke-WebRequest ${url}/api/cafe/agent/download -OutFile $env:TEMP\\JuanFiCafe.exe"`,
  });
});

// ============================================================ admin endpoints

router.use(authMiddleware);

router.get('/router/:routerId/machines', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const settings = getCafeSettings(routerId);
    res.json({
      settings: { ...settings, admin_password_hash: undefined, has_admin_password: !!settings.admin_password_hash },
      rates: parseRateList(settings.rate_list),
      machines: listCafeMachines(routerId),
    });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/router/:routerId/cafe/settings', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const settings = getCafeSettings(routerId);
    res.json({
      settings: { ...settings, admin_password_hash: undefined },
      has_admin_password: hasAdminPassword(routerId),
      rates: parseRateList(settings.rate_list),
    });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/router/:routerId/cafe/settings', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const settings = saveCafeSettings(routerId, req.body || {});
    res.json({ settings: { ...settings, admin_password_hash: undefined }, rates: parseRateList(settings.rate_list) });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/router/:routerId/cafe/admin-password', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const password = String(req.body?.password || '');
    if (password && password.length < 4) {
      res.status(400).json({ error: 'The admin password needs at least 4 characters' });
      return;
    }
    await setAdminPassword(routerId, password);
    res.json({ message: password ? 'Admin password saved' : 'Admin password cleared', has_admin_password: !!password });
  } catch (error) {
    fail(res, error);
  }
});

/** Machines the app is installed on but nobody has added to the shop yet. */
router.get('/router/:routerId/cafe/candidates', (req: Request, res: Response) => {
  try {
    res.json({ candidates: listCandidates(parseInt(req.query.seconds as any) || 300) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/router/:routerId/cafe/resolve-mac', async (req: Request, res: Response) => {
  try {
    const mac = await resolveMac(parseInt(req.params.routerId), String(req.body?.ip || ''));
    res.json({ mac });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/router/:routerId/cafe/machines', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const machine = await addCafeMachine(routerId, req.body || {});
    res.status(201).json({ machine, token: machine.token });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/router/:routerId/cafe/machines/:id', async (req: Request, res: Response) => {
  try {
    const machine = await updateCafeMachine(parseInt(req.params.routerId), parseInt(req.params.id), req.body || {});
    res.json({ machine });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/router/:routerId/cafe/machines/:id', async (req: Request, res: Response) => {
  try {
    const removed = await removeCafeMachine(parseInt(req.params.routerId), parseInt(req.params.id));
    res.json({ message: removed ? 'Machine removed' : 'Machine not found', removed });
  } catch (error) {
    fail(res, error);
  }
});

/** Sell minutes. The same call starts a fresh hour and tops one already running. */
router.post('/router/:routerId/cafe/machines/:id/start', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const minutes = Number(req.body?.minutes);
    const machine = await startCafeSession(routerId, parseInt(req.params.id), minutes, Number(req.body?.amount) || 0, req.user?.username || '');
    res.json({ machine, state: machineState(machine, getCafeSettings(routerId)) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/router/:routerId/cafe/machines/:id/lock', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const machine = pauseCafeMachine(routerId, parseInt(req.params.id), 'client', req.user?.username || '', 'paused');
    res.json({ machine, state: machineState(machine, getCafeSettings(routerId)) });
  } catch (error) {
    fail(res, error);
  }
});

/** Hand the desktop to the shop owner without anyone touching a keyboard password. */
router.post('/router/:routerId/cafe/machines/:id/unlock', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const machine = pauseCafeMachine(routerId, parseInt(req.params.id), 'admin', req.user?.username || '', 'unlocked');
    res.json({ machine, state: machineState(machine, getCafeSettings(routerId)) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/router/:routerId/cafe/machines/:id/release', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const machine = await releaseCafeMachine(routerId, parseInt(req.params.id), req.user?.username || '');
    res.json({ machine, state: machineState(machine, getCafeSettings(routerId)) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/router/:routerId/cafe/machines/:id/reset', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const machine = resetCafeMachine(routerId, parseInt(req.params.id), req.user?.username || '');
    res.json({ machine, state: machineState(machine, getCafeSettings(routerId)) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/router/:routerId/cafe/machines/:id/bypass', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const machine = getCafeMachine(routerId, parseInt(req.params.id));
    if (!machine) {
      res.status(404).json({ error: 'Machine not found' });
      return;
    }
    if (req.body?.off === true) {
      await clearBypass(machine);
      res.json({ message: 'Bypass removed', synced: false });
      return;
    }
    const result = await applyBypass(machine);
    res.json({ message: result.synced ? 'Bypass written to the router' : `Bypass not applied: ${result.error}`, synced: result.synced, error: result.error });
  } catch (error) {
    fail(res, error);
  }
});

/** Show the shop owner the token the agent needs, for a PC that cannot beacon. */
router.get('/router/:routerId/cafe/machines/:id/token', (req: Request, res: Response) => {
  try {
    const machine = getCafeMachine(parseInt(req.params.routerId), parseInt(req.params.id));
    if (!machine) {
      res.status(404).json({ error: 'Machine not found' });
      return;
    }
    res.json({ token: machine.token });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/router/:routerId/cafe/sync', async (req: Request, res: Response) => {
  try {
    const report = await reconcileBindings(parseInt(req.params.routerId));
    res.json(report);
  } catch (error) {
    fail(res, error);
  }
});

router.get('/router/:routerId/cafe/summary', (req: Request, res: Response) => {
  try {
    res.json(cafeSummary(parseInt(req.params.routerId), parseInt(req.query.days as any) || 1));
  } catch (error) {
    fail(res, error);
  }
});

export default router;
