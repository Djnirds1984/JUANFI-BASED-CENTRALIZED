import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../database';
import { nodeMcuService, NodeMcuDevice } from '../services/nodemcu';
import { authMiddleware } from '../middleware/auth';
import { initSession } from '../services/deviceSessions';
import { mikroTikService } from '../services/mikrotik';
import { provisionSubVendo } from '../services/vendoProvision';
import { loadDevices, saveDevices, findDevice, firmwareTypeOf } from '../services/deviceRegistry';
import {
  saveSettings, regenerateKey, queueCommand,
  acknowledgeCommand, findDeviceIdByKey, recordStatus, getStatus,
  statusIsOnline, submitClaim, findClaimByToken, findClaim, approveClaim,
  rejectClaim, loadClaims, normalizeMac, forgetDevice, getSettings,
} from '../services/aircoins';
import {
  SESSION_POLL_SECONDS, findSession, findSessionById, finishSession, sessionIsLive,
  sessionRemainingMs,
} from '../services/aircoinsSession';
import { creditAirCoinsSale, recordUnassignedSale, settleAirCoinsSession } from '../services/aircoinsSale';

const router = Router();

// Unauthenticated endpoint for NodeMCU coin-insert reporting
// NodeMCU calls this after creating a user on MikroTik via local auth
router.post('/coin-insert', (req: Request, res: Response) => {
  try {
    const { router_id, username, mac, ip, session_timeout } = req.body;

    if (!router_id || !username) {
      res.status(400).json({ error: 'router_id and username are required' });
      return;
    }

    const db = getDb();

    // Validate router exists and is active
    const routerRow = db.prepare('SELECT id, name FROM routers WHERE id = ? AND is_active = 1').get(router_id) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found or inactive' });
      return;
    }

    // Generate unique session ID
    const sessionId = 'coin_' + crypto.randomBytes(8).toString('hex');

    // Create radius_sessions record
    const sessionTimeout = parseInt(session_timeout || '28800', 10);
    db.prepare(`
      INSERT INTO radius_sessions (router_id, username, session_id, nas_ip, status, started_at, updated_at, mac_address, session_time)
      VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'), ?, ?)
    `).run(router_id, username, sessionId, ip || '', mac || '', sessionTimeout);

    // Generate or reuse a permanent device session token for roaming support.
    // When the device browser loads the portal on another SSID, the token cookie
    // lets the panel restore the session even if the MAC has changed.
    let token: string | null = null;
    if (mac) {
      try {
        const result = initSession({ mac, ip: ip || '', server: '', routerId: router_id });
        token = result.token;
      } catch (err: any) {
        console.error('Failed to init device session token:', err.message);
      }
    }

    res.json({ success: true, session_id: sessionId, token });
  } catch (error: any) {
    console.error('Coin-insert endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

/*
 * AirCoins machine endpoints. Our own firmware has no web UI, so the only way
 * it learns anything is by asking: it polls /aircoins/status, reads the config
 * version from the reply, and re-fetches /aircoins/config when that version
 * changed. Every call is authenticated by the per-device key the panel shows
 * on the AirCoins subpage, never by an admin session - a machine in the field
 * must not be able to read the panel.
 */

function airCoinsDeviceId(key: any): number | null {
  const deviceId = findDeviceIdByKey(key);
  if (!deviceId) return null;
  const device = findDevice(deviceId);
  if (!device || firmwareTypeOf(device) !== 'aircoins') return null;
  return deviceId;
}

function settleDeviceRouter(device: NodeMcuDevice): number {
  return device.routerId || resolveVendoRouterId();
}

router.get('/aircoins/config', (req: Request, res: Response) => {
  try {
    const deviceId = airCoinsDeviceId(req.query.key);
    if (!deviceId) { res.status(401).json({ error: 'Unknown device key' }); return; }
    const device = findDevice(deviceId)!;
    const settings = getSettings(deviceId);
    res.json({
      status: 'ok',
      version: settings.version,
      device: { id: device.id, name: device.name, ip: device.ip, mac: device.mac || '' },
      settings: {
        clientMac: settings.clientMac,
        coinPin: settings.coinPin,
        buzzerPin: settings.buzzerPin,
        ledPin: settings.ledPin,
        slotLockPin: settings.slotLockPin,
        slotTriggerType: settings.slotTriggerType,
        coinValue: settings.coinValue,
        pulsesPerCoin: settings.pulsesPerCoin,
        pulseDebounceMs: settings.pulseDebounceMs,
        coinWaitSeconds: settings.coinWaitSeconds,
        maxCoins: settings.maxCoins,
        abuseCount: settings.abuseCount,
        banMinutes: settings.banMinutes,
        rates: settings.rates,
        thankYouSeconds: settings.thankYouSeconds,
        buzzer: settings.buzzer,
        pollSeconds: settings.pollSeconds,
        pendingCommand: settings.pendingCommand,
      },
    });
  } catch (error: any) {
    console.error('AirCoins config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Heartbeat: records what the machine reports and hands back the config version
// plus any command the operator queued. One call does liveness, change
// detection and control, so the device needs no inbound port at all.
//
// It also carries the coin session, because this is the only line the board
// opens. What the vendo would answer for itself in a JuanFi box - how much of
// the slot's money is already paid for - is answered here instead.
router.post('/aircoins/status', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const deviceId = airCoinsDeviceId(body.key || req.query.key);
    if (!deviceId) { res.status(401).json({ error: 'Unknown device key' }); return; }

    recordStatus(deviceId, body);
    if (body.commandDone) acknowledgeCommand(deviceId, String(body.commandDone));
    const settings = getSettings(deviceId);

    // A session whose window ran out is paid for, not discarded: the customer
    // already dropped the coins. JuanFi commits an expired slot the same way,
    // and doing it on the heartbeat means a closed browser tab cannot cost them
    // their money.
    let session = findSession(deviceId);
    if (session && session.status === 'open' && !sessionIsLive(session)) {
      const credited = await settleAirCoinsSession(deviceId, session);
      // Settling already wrote the running totals onto the session; finishing it
      // only stamps the status, or those coins would be counted twice.
      const after = findSessionById(session.id) || session;
      session = finishSession(session.id, 'expired', {
        coins: after.coins,
        minutes: after.minutes,
        error: credited.result && credited.result.status !== 'ok' ? (credited.result.error || '') : '',
      });
    }

    // A finished session keeps being repeated until the board reports it gone:
    // that last reply is what tells the machine how much of its own bank the
    // panel has already sold, so it does not offer those coins a second time.
    const held = String(body.sessionId || '');
    let handoff: { id: string; paidPulses: number; expiresInMs: number } | null = null;
    if (sessionIsLive(session)) {
      handoff = {
        id: session!.id,
        paidPulses: session!.settledPulses,
        expiresInMs: sessionRemainingMs(session),
      };
    } else if (session && held && held === session.id) {
      handoff = { id: session.id, paidPulses: session.settledPulses, expiresInMs: 0 };
    }

    // A wired slot-lock relay powers the acceptor only while a session is open,
    // so the board has to notice a fresh INSERT COIN within a second or two -
    // that poll interval is the delay the customer feels before the slot clicks on.
    const gated = settings.slotLockPin >= 0;
    res.json({
      status: 'ok',
      version: settings.version,
      // While a customer stands at the slot the board has to report every couple
      // of seconds, or the phone waits for a coin count that never arrives.
      pollSeconds: handoff || gated ? SESSION_POLL_SECONDS : settings.pollSeconds,
      pendingCommand: settings.pendingCommand,
      serverTime: new Date().toISOString(),
      session: handoff,
    });
  } catch (error: any) {
    console.error('AirCoins status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/*
 * A board keeps a coin bank until the panel says it is sold: its POST times out
 * after 15s, and a reply that never lands leaves the coins banked and the same
 * amount offered again. Without a key that retry would credit the pesos twice,
 * so the board stamps every bank it offers with one and the panel replays the
 * answer it already gave instead of crediting again. A board on older firmware
 * sends no key and keeps the old behaviour.
 */
function cachedRedeem(deviceId: number, redeemKey: string): any | null {
  if (!redeemKey) return null;
  try {
    const row = getDb().prepare(
      'SELECT response FROM aircoins_redeems WHERE device_id = ? AND redeem_key = ?'
    ).get(deviceId, redeemKey) as any;
    if (!row) return null;
    return JSON.parse(String(row.response || '{}'));
  } catch (error: any) {
    console.error('AirCoins redeem memo read failed:', error.message);
    return null;
  }
}

/** Remembers a sale that went through, so the same bank cannot be paid twice. */
function rememberRedeem(deviceId: number, redeemKey: string, payload: any): void {
  if (!redeemKey) return;
  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO aircoins_redeems (device_id, redeem_key, response)
       VALUES (?, ?, ?)`
    ).run(deviceId, redeemKey, JSON.stringify(payload));
    // A bank is confirmed within seconds; a month is already generous.
    db.prepare("DELETE FROM aircoins_redeems WHERE created_at < datetime('now', '-30 days')").run();
  } catch (error: any) {
    console.error('AirCoins redeem memo write failed:', error.message);
  }
}

// The coins bought the time, so the panel decides how much time - not the
// machine. Same credit path as a portal coin insert, so a vendo sale stacks
// onto whatever the customer already has and survives a pause or a roam.
router.post('/aircoins/redeem', async (req: Request, res: Response) => {
  const body = req.body || {};
  const deviceId = airCoinsDeviceId(body.key);
  if (!deviceId) { res.status(401).json({ error: 'Unknown device key' }); return; }

  const settings = getSettings(deviceId);
  // The panel owns the target, so its copy wins: an older firmware that still
  // has an empty sale target is credited to whatever the operator set here.
  const macNoColon = String(body.mac || settings.clientMac || '').replace(/[:\-]/g, '').toUpperCase();
  const coins = Math.floor(Number(body.amount) || 0);
  if (coins <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }

  // The same bank offered again: answer with the sale that already went through
  // rather than paying for these pesos a second time.
  const redeemKey = String(body.redeemKey || '').slice(0, 64);
  const memo = cachedRedeem(deviceId, redeemKey);
  if (memo) { res.json({ ...memo, duplicate: true }); return; }

  if (!/^[0-9A-F]{12}$/.test(macNoColon)) {
    // No fixed sale target and nobody opened the portal for this bank. The coins
    // are still money the shop took, so they are logged rather than refused - and
    // the board is told they are sold, or it would offer the same bank forever.
    const saleId = recordUnassignedSale(deviceId, coins, 'No fixed sale target and no open session');
    const payload = {
      status: 'ok',
      minutes: 0,
      spent: coins,
      leftover: 0,
      applied: [],
      username: '',
      expiryAt: '',
      remainingSeconds: 0,
      unassigned: true,
      saleId,
    };
    rememberRedeem(deviceId, redeemKey, payload);
    res.json(payload);
    return;
  }

  const result = await creditAirCoinsSale(deviceId, macNoColon, coins);
  if (result.status === 'no-rate') {
    res.json({ status: 'no-rate', amount: coins, leftover: result.leftover });
    return;
  }
  if (result.status === 'no-router') { res.status(404).json({ error: result.error }); return; }
  if (result.status !== 'ok') { res.status(500).json({ error: result.error || 'Could not credit this sale' }); return; }

  const payload = {
    status: 'ok',
    minutes: result.minutes,
    spent: result.spent,
    leftover: result.leftover,
    applied: result.applied,
    username: result.username,
    expiryAt: result.expiryAt,
    remainingSeconds: result.remainingSeconds,
  };
  rememberRedeem(deviceId, redeemKey, payload);
  res.json(payload);
});

/*
 * Pairing requests. A vendo that has never been registered boots into the
 * `Aircoins_setup` access point, joins the shop WiFi and posts here. The answer
 * stays "pending" until an admin accepts it on the AirCoins subpage, so the
 * machine cannot register itself.
 */
router.post('/aircoins/claim', (req: Request, res: Response) => {
  try {
    const claim = submitClaim(req.body || {});
    const approved = claim.status === 'approved' && claim.deviceId ? getSettings(claim.deviceId) : null;
    console.log(`aircoins: pairing request from ${claim.mac} (${claim.ip || 'no ip'}) -> ${claim.status}`);
    res.json({
      status: claim.status,
      token: claim.token,
      claimId: claim.id,
      deviceId: claim.deviceId,
      deviceKey: approved ? approved.deviceKey : '',
      pollSeconds: approved ? approved.pollSeconds : 5,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// The machine repeats this while it waits on the setup screen, and again after
// the admin accepts to collect the key it needs for every later call.
router.get('/aircoins/claim/status', (req: Request, res: Response) => {
  const claim = findClaimByToken(req.query.token);
  if (!claim) { res.status(404).json({ error: 'Unknown pairing token' }); return; }
  if (claim.status !== 'approved' || !claim.deviceId) {
    res.json({ status: claim.status, token: claim.token });
    return;
  }
  const device = findDevice(claim.deviceId);
  if (!device) {
    // The machine was deleted while it still held this token. Minting it a key
    // here would resurrect the vendo the operator just removed, so close the
    // request and let it go back to its setup page.
    rejectClaim(claim.id);
    res.json({ status: 'rejected', token: claim.token });
    return;
  }
  const settings = getSettings(claim.deviceId);
  res.json({
    status: 'approved',
    token: claim.token,
    deviceId: claim.deviceId,
    deviceKey: settings.deviceKey,
    pollSeconds: settings.pollSeconds,
    routerId: device ? device.routerId || 0 : 0,
    name: device ? device.name : '',
  });
});

router.use(authMiddleware);

/**
 * The router a coin machine belongs to: the one the operator picked when it is
 * connected, otherwise the first connected router. Saving a device without a
 * router still works, the provisioning steps just report it.
 */
function resolveVendoRouterId(requested?: any): number {
  const rows = getDb().prepare('SELECT id FROM routers WHERE is_active = 1 ORDER BY id').all() as any[];
  const ids = rows.map((r) => Number(r.id));
  const wanted = parseInt(String(requested || ''), 10);
  if (Number.isFinite(wanted) && wanted > 0) {
    if (mikroTikService.isConnected(wanted)) return wanted;
    if (ids.includes(wanted)) return wanted;
  }
  return ids.find((id) => mikroTikService.isConnected(id)) || (Number.isFinite(wanted) ? wanted : 0);
}

router.get('/devices', (_req: Request, res: Response) => {
  const devices = loadDevices();
  res.json({ devices });
});

router.post('/devices', async (req: Request, res: Response) => {
  const { name, ip, username, password, mac } = req.body;
  if (!name || !ip) {
    res.status(400).json({ error: 'name and ip are required' });
    return;
  }

  const devices = loadDevices();
  const id = devices.length > 0 ? Math.max(...devices.map((d) => d.id)) + 1 : 1;
  const routerId = resolveVendoRouterId(req.body.routerId);
  const device: NodeMcuDevice = {
    id,
    name: name || 'NodeMCU',
    ip,
    username: username || 'admin',
    password: password || '',
    firmwareType: req.body.firmwareType === 'aircoins' ? 'aircoins' : 'juanfi',
    ...(mac ? { mac } : {}),
    ...(routerId ? { routerId } : {}),
  };
  devices.push(device);
  saveDevices(devices);

  // Registering the machine is only half of it: the router has to keep its
  // address, skip its login and let customers pay it before they log in.
  // `provision: false` stores the device only.
  if (req.body.provision === false) {
    res.json({ device });
    return;
  }
  try {
    const result = await provisionSubVendo(routerId, { name: device.name, ip, mac });
    if (result.mac && !device.mac) {
      device.mac = result.mac;
      device.routerId = routerId;
      saveDevices(devices);
    }
    res.json({ device, provision: result });
  } catch (err: any) {
    // The device is saved; report what could not be applied instead of losing it.
    res.json({ device, provision: { mac: '', ok: false, steps: [], error: err.message } });
  }
});

// Re-run the router side of the registration (new address, replaced board, or a
// machine that was added while the router was offline).
router.post('/devices/:id/provision', async (req: Request, res: Response) => {
  const device = findDevice(parseInt(req.params.id));
  if (!device) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  try {
    const routerId = resolveVendoRouterId(req.body?.routerId || device.routerId);
    const result = await provisionSubVendo(routerId, { name: device.name, ip: device.ip, mac: device.mac });
    if (result.mac && !device.mac) {
      device.mac = result.mac;
      saveDevices(loadDevices().map((d) => (d.id === device.id ? { ...d, mac: result.mac, routerId } : d)));
    }
    res.json({ provision: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/devices/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const devices = loadDevices();
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const { name, ip, username, password, mac, routerId, firmwareType } = req.body;
  if (name !== undefined) devices[idx].name = name;
  if (ip !== undefined) devices[idx].ip = ip;
  if (username !== undefined) devices[idx].username = username;
  if (password !== undefined) devices[idx].password = password;
  if (firmwareType !== undefined) devices[idx].firmwareType = firmwareType === 'aircoins' ? 'aircoins' : 'juanfi';
  if (mac !== undefined) devices[idx].mac = mac;
  if (routerId !== undefined) devices[idx].routerId = routerId;
  saveDevices(devices);
  nodeMcuService.clearSession(id);
  res.json({ device: devices[idx] });
});

router.delete('/devices/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const devices = loadDevices();
  const filtered = devices.filter((d) => d.id !== id);
  if (filtered.length === devices.length) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  saveDevices(filtered);
  nodeMcuService.clearSession(id);
  // An AirCoins machine keeps nothing locally, so its settings, key and reported
  // status would outlive the row and let a deleted vendo keep selling.
  forgetDevice(id);
  res.json({ message: 'Device removed' });
});

router.get('/devices/:id/dashboard', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const dashboard = await nodeMcuService.getDashboard(device);
    res.json(dashboard);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/config', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const config = await nodeMcuService.getSystemConfig(device);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/devices/:id/config', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.saveSystemConfig(device, req.body);
    res.json({ message: 'Configuration saved. Device is restarting...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/rates', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const rates = await nodeMcuService.getRates(device);
    res.json({ rates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/devices/:id/rates', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.saveRates(device, req.body.rates);
    res.json({ message: 'Rates saved' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/restart', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.restartSystem(device);
    res.json({ message: 'Restart command sent' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/restart-mikrotik', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.restartMikrotik(device);
    res.json({ message: 'MikroTik restart command sent' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/reset-stats', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const { type } = req.body;
    if (!['lifeTimeCount', 'coinCount', 'customerCount'].includes(type)) {
      res.status(400).json({ error: 'Invalid reset type' });
      return;
    }
    await nodeMcuService.resetStatistic(device, type);
    res.json({ message: `Statistics reset: ${type}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/active-users', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const raw = await nodeMcuService.getActiveUsers(device);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/kick-user', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const { mac } = req.body;
    if (!mac) { res.status(400).json({ error: 'mac is required' }); return; }
    await nodeMcuService.kickActiveUser(device, mac);
    res.json({ message: 'User kicked' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/sales', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const raw = await nodeMcuService.getSalesDetail(device);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/logs', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const raw = await nodeMcuService.getSystemLogs(device);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/generate-vouchers', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const { amount, qty, prefix, addToSales } = req.body;
    if (!amount || !qty) { res.status(400).json({ error: 'amount and qty are required' }); return; }
    const raw = await nodeMcuService.generateVouchers(device, amount, qty, prefix || 'P', !!addToSales);
    res.json({ raw });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/scan-ssid', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const ssids = await nodeMcuService.scanSSID(device);
    res.json({ ssids });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:id/toggle-night-light', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    await nodeMcuService.toggleNightLight(device);
    res.json({ message: 'Night light toggled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/devices/:id/ping', async (req: Request, res: Response) => {
  try {
    const device = findDevice(parseInt(req.params.id));
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    const result = await nodeMcuService.ping(device);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/*
 * AirCoins settings. These are the only copy that exists: the machine keeps no
 * local form and serves no admin page, so what is stored here is exactly what
 * the next config pull will apply.
 */

// Machines sitting on their setup access point, waiting for a human to say yes.
router.get('/aircoins/claims', (_req: Request, res: Response) => {
  res.json({ claims: loadClaims().filter((claim) => claim.status === 'pending') });
});

router.post('/aircoins/claims/:id/approve', async (req: Request, res: Response) => {
  const claim = findClaim(parseInt(req.params.id));
  if (!claim) { res.status(404).json({ error: 'Pairing request not found' }); return; }
  if (claim.status === 'rejected') { res.status(409).json({ error: 'This request was rejected' }); return; }

  const devices = loadDevices();
  const routerId = resolveVendoRouterId(req.body && req.body.routerId);
  let device = devices.find((d) => normalizeMac(d.mac) === claim.mac);

  if (!device) {
    device = {
      id: devices.length > 0 ? Math.max(...devices.map((d) => d.id)) + 1 : 1,
      name: (req.body && req.body.name) || claim.name || 'AirCoins Vendo',
      ip: claim.ip || '',
      username: '',
      password: '',
      mac: claim.mac,
      firmwareType: 'aircoins',
      ...(routerId ? { routerId } : {}),
    };
    devices.push(device);
  } else {
    // A board that was re-flashed or re-addressed comes back with the same
    // MAC; accepting it again must update the machine, not duplicate it.
    device.firmwareType = 'aircoins';
    if (claim.ip) device.ip = claim.ip;
    if (routerId) device.routerId = routerId;
  }
  saveDevices(devices);

  // Settings first: this is what mints the device key the vendo is waiting for.
  const settings = getSettings(device.id);
  approveClaim(claim.id, device.id);

  // The router side is best-effort. The machine is registered either way and
  // the operator can re-run it from the device list.
  let provision: any = null;
  try {
    provision = await provisionSubVendo(routerId, { name: device.name, ip: device.ip, mac: device.mac });
    if (provision.mac && !device.mac) {
      device.mac = provision.mac;
      saveDevices(loadDevices().map((d) => (d.id === device!.id ? { ...d, mac: provision.mac } : d)));
    }
  } catch (err: any) {
    provision = { mac: '', ok: false, steps: [], error: err.message };
  }

  res.json({ message: 'Vendo accepted', device, settings, provision });
});

router.post('/aircoins/claims/:id/reject', (req: Request, res: Response) => {
  const claim = rejectClaim(parseInt(req.params.id));
  if (!claim) { res.status(404).json({ error: 'Pairing request not found' }); return; }
  res.json({ message: 'Pairing request rejected' });
});

// Every coin value and rate, the PC the box credits, plus the key the firmware
// needs and what the machine last reported about itself.
router.get('/devices/:id/aircoins', (req: Request, res: Response) => {
  const device = findDevice(parseInt(req.params.id));
  if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
  if (firmwareTypeOf(device) !== 'aircoins') {
    res.status(409).json({ error: 'This device is not an AirCoins sub-vendo' });
    return;
  }
  const settings = getSettings(device.id);
  const status = getStatus(device.id);
  res.json({
    device,
    settings,
    status,
    online: statusIsOnline(status, settings.pollSeconds),
  });
});

router.put('/devices/:id/aircoins', (req: Request, res: Response) => {
  const device = findDevice(parseInt(req.params.id));
  if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
  if (firmwareTypeOf(device) !== 'aircoins') {
    res.status(409).json({ error: 'This device is not an AirCoins sub-vendo' });
    return;
  }
  res.json({ message: 'Settings saved', settings: saveSettings(device.id, req.body) });
});

router.post('/devices/:id/aircoins/key', (req: Request, res: Response) => {
  const device = findDevice(parseInt(req.params.id));
  if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
  if (firmwareTypeOf(device) !== 'aircoins') {
    res.status(409).json({ error: 'This device is not an AirCoins sub-vendo' });
    return;
  }
  res.json({ message: 'Device key replaced. Re-flash or re-enter it on the vendo.', settings: regenerateKey(device.id) });
});

router.post('/devices/:id/aircoins/command', (req: Request, res: Response) => {
  const device = findDevice(parseInt(req.params.id));
  if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
  if (firmwareTypeOf(device) !== 'aircoins') {
    res.status(409).json({ error: 'This device is not an AirCoins sub-vendo' });
    return;
  }
  const command = String(req.body && req.body.command || '');
  if (!['restart', 'sync'].includes(command)) {
    res.status(400).json({ error: 'command must be restart or sync' });
    return;
  }
  res.json({
    message: command === 'restart' ? 'Restart queued for the next poll' : 'Config refresh queued',
    settings: queueCommand(device.id, command),
  });
});

export default router;
