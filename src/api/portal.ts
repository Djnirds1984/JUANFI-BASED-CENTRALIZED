import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getPortalDefaultContent, listHotspotFiles, EDITABLE_EXTENSIONS } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { resolveVendorIp } from '../services/vendoConfig';
import { authMiddleware } from '../middleware/auth';
import { config } from '../config';
import { getDb } from '../database';
import { mikrotikTimeToSeconds, secondsToLimitUptime, generateSessionToken } from '../services/deviceSessions';
import { grantMinutesToMac } from '../services/timeCredit';
import { getTrialSettings, claimTrial, releaseTrialClaim } from '../services/trial';
import { findDevice, loadDevices, firmwareTypeOf } from '../services/deviceRegistry';
import { autoSelectVendo, namesNetwork } from '../services/vendoAutoSelect';
import { foreignVendo, hotspotConfigPath, parseMultiVendoAddresses, vendoCandidates } from '../services/vendoRoster';
import type { VendoCandidate } from '../services/vendoAutoSelect';
import type { NodeMcuDevice } from '../services/nodemcu';
import { getSettings, getStatus, statusIsOnline } from '../services/aircoins';
import {
  AirCoinsSession, findSession, findSessionById, finishSession, livePulses,
  openSession, previewSession, sessionIsLive, sessionRemainingMs, sessionTtlSeconds,
} from '../services/aircoinsSession';
import { settleAirCoinsSession } from '../services/aircoinsSale';

const router = Router();

// Public endpoint — portal page needs vendo config pre-login
router.get('/vendo-config', (req: Request, res: Response) => {
  try {
    const configPath = hotspotConfigPath();
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

    const addresses = parseMultiVendoAddresses(content);

    // INSERT COIN is posted straight to vendorIpAddress, and the dropdown the
    // portal shows is built from multiVendoAddresses. When those disagree the
    // phone talks to a machine that is not there, so resolve the default against
    // the list before the portal ever sees it.
    const cfg: any = resolveVendorIp({
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

    // Panel-tracked free trial (TRIAL button). Lives in system_settings, not
    // the NodeMCU config file, and rides along here so the portal needs no
    // second pre-login fetch.
    try {
      const trial = getTrialSettings();
      cfg.trialEnabled = trial.enabled;
      cfg.trialMinutes = trial.minutes;
    } catch { /* button stays hidden */ }

    // AirCoins machines, listed separately from the JuanFi array. A JuanFi vendo
    // runs its own web server and the phone posts coins straight to it; ours has
    // no port at all, so the phone has to go through the panel and these
    // entries carry a device id rather than an address to call.
    let airCoinsDevices: NodeMcuDevice[] = [];
    try {
      airCoinsDevices = loadDevices().filter((device) => firmwareTypeOf(device) === 'aircoins');
    } catch {
      airCoinsDevices = [];
    }
    const airCoinsVendos = airCoinsDevices.map((device) => ({
      deviceId: device.id,
      vendoName: device.name || `AirCoins ${device.id}`,
      vendoIp: device.ip || '',
    }));

    // The legacy config.js still lists the address of a box that has since been
    // registered as AirCoins, and showing both would put the same vendo in the
    // dropdown twice - one entry the phone can reach, one it cannot. The
    // registry wins: it is what the panel actually sold through.
    const ours = new Set(airCoinsVendos.map((vendo) => String(vendo.vendoIp || '').trim()));
    cfg.multiVendoAddresses = (cfg.multiVendoAddresses || [])
      .filter((vendo: any) => !ours.has(String(vendo.vendoIp || '').trim()));
    cfg.aircoinsVendos = airCoinsVendos;

    // Which machine serves the network this phone is on. The hotspot hands out
    // leases per DHCP server, so the customer's own address already names the
    // sub-vendo of their SSID - they should never have to pick one. The browser
    // sends the address from the MikroTik redirect because nginx makes the real
    // client look like 127.0.0.1 here (same reason as the trial claim).
    const clientIp = String(req.query.ip || '').trim();
    const clientRouterId = parseInt(String(req.query.routerId || ''), 10) || 0;
    const candidates: VendoCandidate[] = vendoCandidates();
    const auto = autoSelectVendo(clientIp, clientRouterId, candidates);
    cfg.autoVendo = auto ? auto.value : '';
    cfg.autoVendoName = auto ? auto.name : '';
    cfg.autoVendoReason = auto ? auto.reason : '';

    // The phone's own address names the machine it may pay. From that moment
    // the portal is locked to it and the other sub-vendos are not sent at all,
    // so a stale localStorage entry or a hand-picked value cannot aim this
    // customer's pesos at somebody else's slot. A fallback pick ("the only one
    // on this router") only preselects - it never locks.
    const locked = namesNetwork(auto);
    if (locked) {
      const chosen = candidates.find((candidate) => candidate.value === auto!.value);
      const keep = new Set([auto!.value, chosen ? chosen.ip : ''].filter((value) => !!value));
      cfg.multiVendoAddresses = (cfg.multiVendoAddresses || [])
        .filter((vendo: any) => keep.has(String(vendo.vendoIp || '').trim()));
      cfg.aircoinsVendos = airCoinsVendos
        .filter((vendo) => keep.has(`aircoins:${vendo.deviceId}`) || keep.has(String(vendo.vendoIp || '').trim()));
    }
    cfg.vendoLocked = locked;
    cfg.lockedVendo = locked ? auto!.value : '';
    cfg.lockedVendoName = locked ? auto!.name : '';

    res.json(cfg);
  } catch (error: any) {
    console.error('vendo-config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Public endpoint — check if MAC has valid session for auto-login
router.get('/check-session', async (req: Request, res: Response) => {
  try {
    const macWithColons = String(req.query.mac || '').trim().toLowerCase().replace(/-/g, ':');
    const macNoColons = macWithColons.replace(/:/g, '').toUpperCase();
    const routerId = parseInt(String(req.query.routerId || '1'), 10);

    if (!macWithColons || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(macWithColons)) {
      res.status(400).json({ error: 'Valid MAC is required' });
      return;
    }

    const db = getDb();

    // The account behind this MAC. Normally username = MAC without colons, but
    // after a roam the device presents a NEW MAC while the account keeps the
    // ORIGINAL identity (restoreSession rebinds the token, not the account).
    // Resolve the original identity via the token-bound session so the portal
    // still sees the restored time instead of "no session".
    // Match case/separator-insensitively (mirrors RADIUS findHotspotUser): an
    // exact `username = ?` missed colon-form MAC accounts (`da:e4:...`) and
    // lower-case variants, reporting "no session" while the device was online.
    const accountFor = (username: string): any => {
      const key = String(username || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
      return db.prepare(
        `SELECT id, username, expiry_at FROM hotspot_users
         WHERE router_id = ? AND disabled = 0
           AND (LOWER(username) = LOWER(?)
                OR (? <> '' AND UPPER(REPLACE(REPLACE(username, ':', ''), '-', '')) = ?))
         ORDER BY id DESC LIMIT 1`
      ).get(routerId, username, key.length === 12 ? key : '', key);
    };

    let effectiveUsername = macNoColons;
    let hotspotUser = accountFor(macNoColons);
    if (!hotspotUser) {
      const bound = db.prepare(
        `SELECT username FROM device_sessions
         WHERE router_id = ? AND mac_address = ? AND username <> ''
         ORDER BY last_seen DESC LIMIT 1`
      ).get(routerId, macWithColons) as any;
      if (bound && bound.username) {
        effectiveUsername = String(bound.username).trim().toUpperCase();
        hotspotUser = accountFor(effectiveUsername);
      }
    }
    if (!hotspotUser) {
      // RADIUS records MAC -> account aliases (device_macs). Use the same
      // mapping so the portal resolves the paid account exactly like RADIUS
      // does when the device logs in under its current MAC.
      const alias = db.prepare(
        'SELECT username FROM device_macs WHERE mac_address = ?'
      ).get(macWithColons) as any;
      if (alias && alias.username) {
        effectiveUsername = String(alias.username).trim().toUpperCase();
        hotspotUser = accountFor(effectiveUsername);
      }
    }

    // The panel's Active Devices tab shows the router's live `session-time-left`
    // (polled every second). The portal must show the SAME value, so read it the
    // same way instead of deriving it from the account's wall-clock expiry_at.
    // `expiry_at` is only a last-resort fallback for a device with paid time
    // that is not currently online.
    const macKey = macNoColons.toLowerCase();
    let remainingSeconds = 0;
    let resolved = false;

    // 1) Live MikroTik active session - exactly what the panel renders.
    //    When found, its value is authoritative (0 = expired), so the fallbacks
    //    below must NOT re-introduce stale time. Match by the device's CURRENT
    //    MAC or by the resolved (original) username — after a roam these differ.
    let liveChecked = false;
    let online = false;
    try {
      if (mikroTikService.isConnected(routerId)) {
        liveChecked = true;
        const live = await mikroTikService.getActiveConnections(routerId);
        const conn = (Array.isArray(live) ? live : []).find((c: any) => {
          const connMac = String(c.mac || c['mac-address'] || '').toLowerCase().replace(/[^0-9a-f]/g, '');
          const connUser = String(c.user || '').toUpperCase();
          return (!!connMac && connMac === macKey) || (!!connUser && connUser === effectiveUsername);
        });
        if (conn) {
          online = true;
          // A live connection can also reveal the identity when no session row
          // bound this MAC yet (e.g. token lost, device logged in manually).
          const connUser = String(conn.user || '').toUpperCase();
          if (!hotspotUser && connUser) {
            effectiveUsername = connUser;
            hotspotUser = accountFor(effectiveUsername);
          }
          const left = mikrotikTimeToSeconds(conn['session-time-left']);
          if (left !== Infinity) {
            remainingSeconds = Math.max(0, Math.floor(left));
            resolved = true;
          }
        }
      }
    } catch (liveErr: any) {
      console.error('check-session live lookup failed:', liveErr.message);
    }

    // No account for this MAC (directly, via the roaming binding, or via a
    // live session). It may still be PAUSED: pause disables the account (so
    // RADIUS rejects re-auth and time cannot drain) but keeps the frozen
    // balance in device_sessions. Report it so the portal shows the paused
    // panel with a RESUME button instead of "no session".
    if (!hotspotUser) {
      const pausedAcct = db.prepare(
        'SELECT id, username FROM hotspot_users WHERE router_id = ? AND username = ? AND paused = 1'
      ).get(routerId, effectiveUsername) as any;
      if (pausedAcct) {
        const sess = db.prepare(
          `SELECT remaining_seconds FROM device_sessions
           WHERE router_id = ? AND (mac_address = ? OR (username <> '' AND UPPER(username) = ?))
           ORDER BY last_seen DESC LIMIT 1`
        ).get(routerId, macWithColons, effectiveUsername) as any;
        const frozen = sess ? Math.max(0, Math.floor(Number(sess.remaining_seconds) || 0)) : 0;
        if (frozen > 0) {
          res.json({
            hasSession: true,
            remainingSeconds: frozen,
            expiresAt: null,
            online: false,
            liveChecked,
            paused: true,
            username: effectiveUsername,
          });
          return;
        }
      }
      res.json({ hasSession: false });
      return;
    }

    // Consumed time must not be reported from stale snapshots: when the
    // resolved account's wall-clock expiry has passed, any stored balance
    // (active_devices / device_sessions) is already spent. Reporting it made
    // the portal count down phantom seconds and auto-login forever instead
    // of letting the router show the captive portal. A LIVE session above
    // still wins — that is the one-shot expired-grace window.
    if (!resolved && hotspotUser.expiry_at) {
      const hsExp = new Date(String(hotspotUser.expiry_at).replace(' ', 'T') + 'Z').getTime();
      if (Number.isFinite(hsExp) && hsExp <= Date.now()) {
        res.json({
          hasSession: false,
          remainingSeconds: 0,
          expiresAt: null,
          online,
          liveChecked,
          paused: false,
          username: effectiveUsername,
        });
        return;
      }
    }

    // 2) Synced mirror in active_devices (background sync, every few seconds).
    if (!resolved) {
      const active = db.prepare(
        `SELECT session_time_left FROM active_devices
         WHERE router_id = ? AND status = 'active'
           AND (REPLACE(REPLACE(LOWER(mac_address), ':', ''), '-', '') = ? OR UPPER(user) = ?)
         ORDER BY last_seen DESC, id DESC LIMIT 1`
      ).get(routerId, macKey, effectiveUsername) as any;
      if (active && active.session_time_left) {
        const left = mikrotikTimeToSeconds(active.session_time_left);
        if (left !== Infinity && left > 0) {
          remainingSeconds = Math.max(0, Math.floor(left));
          resolved = true;
        }
      }
    }

    // 3) Synced device session record.
    if (!resolved) {
      const session = db.prepare(
        `SELECT remaining_seconds FROM device_sessions
         WHERE router_id = ? AND (mac_address = ? OR (username <> '' AND UPPER(username) = ?))
         ORDER BY is_online DESC, last_seen DESC, id DESC LIMIT 1`
      ).get(routerId, macWithColons, effectiveUsername) as any;
      const secs = session ? Math.max(0, Math.floor(Number(session.remaining_seconds) || 0)) : 0;
      if (secs > 0) {
        remainingSeconds = secs;
        resolved = true;
      }
    }

    // 4) Last resort: the account's wall-clock validity.
    if (!resolved) {
      if (hotspotUser.expiry_at) {
        const expiryMs = new Date(String(hotspotUser.expiry_at).replace(' ', 'T') + 'Z').getTime();
        const validitySec = Math.floor((expiryMs - Date.now()) / 1000);
        remainingSeconds = validitySec > 0 ? validitySec : 0;
      } else {
        remainingSeconds = 0;
      }
    }

    // `online` is true only when the device has a LIVE session on the router.
    // `hasSession` only means "time is available" (it can be true while the
    // device is offline, from the stored paid validity). The portal must use
    // `online` to decide connected vs disconnected, otherwise a device that is
    // not logged in sees the connected panel and its top-up tries to extend a
    // session that does not exist.
    res.json({
      hasSession: remainingSeconds > 0,
      remainingSeconds,
      expiresAt: hotspotUser.expiry_at || null,
      online,
      liveChecked,
      paused: false,
      username: effectiveUsername,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  try {
    const mac = String(req.body.mac || req.query.mac || '').trim().toLowerCase().replace(/-/g, ':');
    const routerId = parseInt(String(req.body.routerId || req.query.routerId || '1'), 10);

    if (!mac || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      res.status(400).json({ error: 'Valid MAC is required' });
      return;
    }

    const macNoColons = mac.replace(/:/g, '').toUpperCase();
    const db = getDb();

    // Case/separator tolerant so logout targets the real account row.
    // Clear `paused` too: a logout forfeits the balance, it must not look like
    // a paused session (which would offer RESUME) on the next portal visit.
    db.prepare(
      `UPDATE hotspot_users SET disabled = 1, paused = 0, expiry_at = NULL, updated_at = datetime('now')
       WHERE router_id = ?
         AND (LOWER(username) = LOWER(?)
              OR UPPER(REPLACE(REPLACE(username, ':', ''), '-', '')) = ?)`
    ).run(routerId, macNoColons, macNoColons);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Resolve the account behind a MAC the same way check-session does: normally
// username = MAC without colons, but after a roam the device presents a NEW
// MAC while the account keeps the ORIGINAL identity (token binding).
function resolvePortalIdentity(db: any, routerId: number, macWithColons: string, macNoColons: string, pausedOnly: boolean): { username: string; acct: any } | null {
  const filter = pausedOnly ? 'paused = 1' : 'disabled = 0';
  let acct = db.prepare(
    `SELECT id, username, expiry_at, paused FROM hotspot_users WHERE router_id = ? AND username = ? AND ${filter}`
  ).get(routerId, macNoColons) as any;
  let username = macNoColons;
  if (!acct) {
    const bound = db.prepare(
      `SELECT username FROM device_sessions
       WHERE router_id = ? AND mac_address = ? AND username <> ''
       ORDER BY last_seen DESC LIMIT 1`
    ).get(routerId, macWithColons) as any;
    if (bound && bound.username) {
      username = String(bound.username).trim().toUpperCase();
      acct = db.prepare(
        `SELECT id, username, expiry_at, paused FROM hotspot_users WHERE router_id = ? AND username = ? AND ${filter}`
      ).get(routerId, username) as any;
    }
  }
  if (!acct) return null;
  return { username: String(acct.username).trim().toUpperCase(), acct };
}

// Frozen balance for a paused identity (device_sessions is the canonical store).
function pausedBalance(db: any, routerId: number, macWithColons: string, username: string): number {
  const sess = db.prepare(
    `SELECT remaining_seconds FROM device_sessions
     WHERE router_id = ? AND (mac_address = ? OR (username <> '' AND UPPER(username) = ?))
     ORDER BY last_seen DESC LIMIT 1`
  ).get(routerId, macWithColons, username) as any;
  return sess ? Math.max(0, Math.floor(Number(sess.remaining_seconds) || 0)) : 0;
}

// POST /api/portal/pause — freeze the remaining time. Kicks the live session
// (router stops counting), disables the account so RADIUS rejects re-auth
// (time cannot drain while away) and stores the balance in device_sessions.
// The wall-clock expiry_at is cleared; resume rebuilds it from the balance.
router.post('/pause', async (req: Request, res: Response) => {
  try {
    const mac = String(req.body.mac || req.query.mac || '').trim().toLowerCase().replace(/-/g, ':');
    const routerId = parseInt(String(req.body.routerId || req.query.routerId || '1'), 10);
    if (!mac || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      res.status(400).json({ error: 'Valid MAC is required' });
      return;
    }
    const macNoColons = mac.replace(/:/g, '').toUpperCase();
    const db = getDb();

    const ident = resolvePortalIdentity(db, routerId, mac, macNoColons, false)
      || resolvePortalIdentity(db, routerId, mac, macNoColons, true);
    if (!ident) {
      res.status(404).json({ error: 'No account for this device' });
      return;
    }
    const { username, acct } = ident;

    // Already paused: idempotent success with the frozen balance.
    if (acct.paused) {
      res.json({ success: true, alreadyPaused: true, remainingSeconds: pausedBalance(db, routerId, mac, username), username });
      return;
    }

    // Remaining time: live session-time-left (authoritative) > stored session
    // balance > wall-clock expiry. Same precedence as check-session.
    let remaining = 0;
    try {
      if (mikroTikService.isConnected(routerId)) {
        const live = await mikroTikService.getActiveConnections(routerId);
        const conn = (Array.isArray(live) ? live : []).find((c: any) => {
          const connMac = String(c.mac || c['mac-address'] || '').toLowerCase().replace(/[^0-9a-f]/g, '');
          const connUser = String(c.user || '').toUpperCase();
          return (!!connMac && connMac === macNoColons.toLowerCase()) || (!!connUser && connUser === username);
        });
        if (conn) {
          const left = mikrotikTimeToSeconds(conn['session-time-left']);
          if (left !== Infinity) remaining = Math.max(0, Math.floor(left));
        }
      }
    } catch (liveErr: any) {
      console.error('pause live lookup failed:', liveErr.message);
    }
    if (remaining <= 0) remaining = pausedBalance(db, routerId, mac, username);
    if (remaining <= 0 && acct.expiry_at) {
      const expiryMs = new Date(String(acct.expiry_at).replace(' ', 'T') + 'Z').getTime();
      if (Number.isFinite(expiryMs)) remaining = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
    }
    if (remaining <= 0) {
      res.status(400).json({ error: 'No time remaining to pause' });
      return;
    }

    // Kick the live session so the router stops counting down immediately.
    try {
      if (mikroTikService.isConnected(routerId)) {
        await mikroTikService.kickActiveSession(routerId, { mac, username });
      }
    } catch (kickErr: any) {
      console.warn('pause kick failed (account is disabled anyway):', kickErr.message);
    }

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const apply = db.transaction(() => {
      db.prepare(
        `UPDATE hotspot_users SET disabled = 1, paused = 1, expiry_at = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(acct.id);
      // Upsert the session row that holds the frozen balance. Prefer the row
      // that owns this MAC, else the one bound to the account username.
      let sess = db.prepare(
        'SELECT id FROM device_sessions WHERE router_id = ? AND mac_address = ?'
      ).get(routerId, mac) as any;
      if (!sess) {
        sess = db.prepare(
          `SELECT id FROM device_sessions WHERE router_id = ? AND username <> '' AND UPPER(username) = ?
           ORDER BY last_seen DESC LIMIT 1`
        ).get(routerId, username) as any;
      }
      if (sess) {
        // Free the MAC slot from any other holder (unique index) before rebinding.
        db.prepare(
          `UPDATE device_sessions SET mac_address = '' WHERE router_id = ? AND mac_address = ? AND id <> ?`
        ).run(routerId, mac, sess.id);
        db.prepare(
          `UPDATE device_sessions SET mac_address = ?, username = ?, remaining_seconds = ?,
             status = 'paused', is_online = 0, last_seen = ? WHERE id = ?`
        ).run(mac, username, remaining, now, sess.id);
      } else {
        db.prepare(
          `INSERT INTO device_sessions (session_token, mac_address, router_id, username, status,
             total_seconds, remaining_seconds, is_online, first_seen, last_seen)
           VALUES (?, ?, ?, ?, 'paused', ?, ?, 0, ?, ?)`
        ).run(generateSessionToken(), mac, routerId, username, remaining, remaining, now, now);
      }
    });
    apply();

    console.log(`portal pause: ${username} on router ${routerId} frozen at ${remaining}s`);
    res.json({ success: true, remainingSeconds: remaining, username });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/portal/resume — unfreeze: re-enable the account with
// expiry_at = now + frozen balance (RADIUS then grants exactly that as
// Session-Timeout on the portal's re-login) and reset the router counters so
// the full balance applies. The portal submits the CHAP login right after.
router.post('/resume', async (req: Request, res: Response) => {
  try {
    const mac = String(req.body.mac || req.query.mac || '').trim().toLowerCase().replace(/-/g, ':');
    const routerId = parseInt(String(req.body.routerId || req.query.routerId || '1'), 10);
    if (!mac || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      res.status(400).json({ error: 'Valid MAC is required' });
      return;
    }
    const macNoColons = mac.replace(/:/g, '').toUpperCase();
    const db = getDb();

    const ident = resolvePortalIdentity(db, routerId, mac, macNoColons, true);
    if (!ident) {
      res.status(404).json({ error: 'No paused session for this device' });
      return;
    }
    const { username, acct } = ident;
    const remaining = pausedBalance(db, routerId, mac, username);
    if (remaining <= 0) {
      res.status(400).json({ error: 'No paused time to resume' });
      return;
    }

    const expiryAt = new Date(Date.now() + remaining * 1000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(
      `UPDATE hotspot_users SET disabled = 0, paused = 0, expiry_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(expiryAt, acct.id);
    db.prepare(
      `UPDATE device_sessions SET status = 'active', is_online = 0, remaining_seconds = ?, last_seen = datetime('now')
       WHERE router_id = ? AND (mac_address = ? OR (username <> '' AND UPPER(username) = ?))`
    ).run(remaining, routerId, mac, username);

    // The next login must start with the FULL balance: reset accumulated
    // counters and set limit-uptime (local-auth fallback; RADIUS mode derives
    // Session-Timeout from expiry_at). Mirrors restoreSession's roam logic.
    try {
      if (mikroTikService.isConnected(routerId)) {
        await mikroTikService.resetHotspotUserCounters(routerId, username);
        await mikroTikService.setUserUptimeLimit(routerId, username, secondsToLimitUptime(remaining));
      }
    } catch (limitErr: any) {
      console.warn('resume limit-uptime failed (RADIUS expiry still applies):', limitErr.message);
    }

    console.log(`portal resume: ${username} on router ${routerId} with ${remaining}s`);
    res.json({ success: true, remainingSeconds: remaining, username, expiresAt: expiryAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/portal/trial — the portal TRIAL button. The router's own trial
// login is removed by the panel on radius routers (it bypasses RADIUS: the
// device goes "connected" with zero tracked time), so the trial is granted as
// REAL MAC-account time — the exact coin-insert path (creditMacAccount +
// CoA). One claim per device per day; the grant stacks on any leftover time.
router.post('/trial', async (req: Request, res: Response) => {
  try {
    const macNoColon = String(req.body?.mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const routerId = parseInt(String(req.body?.routerId || '1'), 10);
    // The portal knows the device's own address (it arrives in the redirect),
    // and it is the only client identity that survives a randomized MAC. The
    // panel itself sees 127.0.0.1 through nginx, so req.ip is useless here.
    // Only a private address is accepted: anything else cannot be a hotspot
    // client and would just be a way to skip the per-line claim.
    const rawIp = String(req.body?.ip || '').trim();
    const clientIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(rawIp) ? rawIp : '';
    if (!/^[0-9A-F]{12}$/.test(macNoColon)) {
      res.status(400).json({ error: 'Valid MAC is required' });
      return;
    }
    const db = getDb();
    const routerRow = db.prepare(
      'SELECT id, auth_mode, radius_local_users FROM routers WHERE id = ? AND is_active = 1'
    ).get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found or not active' });
      return;
    }
    const trial = getTrialSettings(db);
    if (!trial.enabled || trial.minutes <= 0) {
      res.status(400).json({ error: 'Free trial is not available right now' });
      return;
    }

    const claim = claimTrial(db, routerId, macNoColon, clientIp);
    if (!claim.claimed) {
      res.status(429).json({ error: 'Trial already used today. Please come back tomorrow or buy a voucher.' });
      return;
    }

    try {
      // Treat it like a top-up: never kick a live session, CoA the added time
      // in place (a device can claim the trial while still connected).
      const grant = await grantMinutesToMac({
        db,
        routerId,
        macNoColon,
        durationMinutes: trial.minutes,
        authMode: routerRow.auth_mode || 'api',
        hybridLocalUsers: Number(routerRow.radius_local_users) === 1,
        logTag: 'trial',
      });
      console.log(`trial: ${macNoColon} on router ${routerId} +${trial.minutes}min (total ${grant.remainingSeconds}s)`);
      res.json({
        success: true,
        minutes: trial.minutes,
        remainingSeconds: grant.remainingSeconds,
        username: grant.accountUsername,
      });
    } catch (grantErr: any) {
      // A transient failure must not burn the device's trial for the day.
      releaseTrialClaim(db, routerId, macNoColon, claim, clientIp);
      res.status(500).json({ error: grantErr.message || 'Trial grant failed' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/*
 * AirCoins coin slot.
 *
 * A JuanFi machine serves these answers itself; an AirCoins board has no web
 * server and no idea who is paying, so the panel holds the session and the
 * phone talks to it here. The answers keep the JuanFi field names on purpose,
 * so the portal keeps one way of reading a coin slot: `status`, `errorCode`,
 * `totalCoin` (pesos), `timeAdded` (seconds).
 */

function airCoinsVendo(id: any): { id: number; name: string; ip: string } | null {
  const deviceId = parseInt(String(id || ''), 10);
  if (!Number.isFinite(deviceId) || deviceId <= 0) return null;
  const device = findDevice(deviceId);
  if (!device || firmwareTypeOf(device) !== 'aircoins') return null;
  return { id: device.id, name: device.name || `AirCoins ${device.id}`, ip: String(device.ip || '').trim() };
}

/*
 * Is this coin action aimed at a machine that is not on the customer's network?
 * The rule itself lives in services/vendoRoster so LOAD WALLET applies exactly
 * the same one as INSERT COIN.
 */

function sessionPesos(deviceId: number, session: AirCoinsSession): number {
  // What is in the box right now, paid or not: a batch no rate could cover is
  // still the customer's money and belongs on the total.
  const counted = Math.max(session.settledPulses, livePulses(deviceId, session.id));
  return previewSession(deviceId, counted).coins;
}

// PROMO RATES for a machine with no web server of its own. A JuanFi vendo
// answers /getRates straight from its own rate table; this is the same ladder
// the panel prices the coins with, so the quote and the credit cannot disagree.
router.get('/coins/rates', (req: Request, res: Response) => {
  try {
    const vendo = airCoinsVendo(req.query.deviceId);
    if (!vendo) {
      res.status(404).json({ error: 'Unknown vendo' });
      return;
    }
    if (foreignVendo(req.query, vendo)) {
      res.status(403).json({ error: 'This coin machine is not on your network' });
      return;
    }
    const settings = getSettings(vendo.id);
    res.json({
      vendoName: vendo.name,
      coinValue: settings.coinValue,
      pulsesPerCoin: settings.pulsesPerCoin,
      rates: settings.rates.map((rate) => ({ name: rate.name, price: rate.price, minutes: rate.minutes })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// INSERT COIN: opens the slot for this phone, or says who already has it.
router.post('/coins/topup', (req: Request, res: Response) => {
  try {
    const vendo = airCoinsVendo(req.body?.deviceId);
    if (!vendo) {
      res.json({ status: 'false', errorCode: 'coin.slot.notavailable' });
      return;
    }

    // The customer has to be on this machine's own network. Closing the slot
    // later is not re-checked: the session is already bound to this vendo and
    // to this MAC, and a coin dropped before a VLAN change must still count.
    if (foreignVendo(req.body, vendo)) {
      res.json({ status: 'false', errorCode: 'coin.slot.wrong.network' });
      return;
    }

    const macNoColon = String(req.body?.mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(macNoColon)) {
      res.status(400).json({ status: 'false', errorCode: 'invalid.mac' });
      return;
    }

    // A machine that has not reported for three polls is not taking coins.
    // Saying so now is kinder than a customer dropping pesos into a dead box.
    const settings = getSettings(vendo.id);
    if (!statusIsOnline(getStatus(vendo.id), settings.pollSeconds)) {
      res.json({ status: 'false', errorCode: 'coin.slot.offline' });
      return;
    }

    // One slot is one physical place, so a second phone pressing INSERT COIN
    // while another customer's coins are in the box is told it is busy - the
    // same answer JuanFi gives when it is already holding a voucher.
    const existing = findSession(vendo.id);
    if (sessionIsLive(existing) && existing!.mac !== macNoColon) {
      res.json({ status: 'false', errorCode: 'coinslot.busy' });
      return;
    }
    // A slot the wallet opened is a balance load. Adopting it here would settle
    // those pesos as internet time instead of money, so INSERT COIN leaves it
    // alone until the wallet closes it.
    if (sessionIsLive(existing) && existing!.purpose === 'wallet') {
      res.json({ status: 'false', errorCode: 'coinslot.busy' });
      return;
    }

    const routerId = parseInt(String(req.body?.routerId || '1'), 10) || 1;
    const session = sessionIsLive(existing)
      ? existing!
      : openSession(vendo.id, String(req.body?.voucher || ''), macNoColon, routerId);

    res.json({
      status: 'true',
      voucher: session.voucher,
      sessionId: session.id,
      deviceId: vendo.id,
      vendoName: vendo.name,
      // JuanFi's wait is in milliseconds; the browser uses both to draw the
      // countdown it shows while the customer feeds the slot.
      waitTime: sessionTtlSeconds() * 1000,
      remainTime: sessionRemainingMs(session),
      pollSeconds: 1,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'false', errorCode: 'server.error' });
  }
});

// Polling while the customer feeds the slot. Each batch of coins is credited
// the moment it is seen - that is this session's version of /useVoucher for
// every coin group, so walking away does not lose what was already dropped.
router.post('/coins/check', async (req: Request, res: Response) => {
  try {
    const vendo = airCoinsVendo(req.body?.deviceId);
    const session = vendo ? findSessionById(String(req.body?.sessionId || '')) : null;
    if (!vendo || !session || session.deviceId !== vendo.id) {
      res.json({ status: 'false', errorCode: 'coin.slot.notavailable' });
      return;
    }
    // A wallet slot is not a time sale: settling it here would turn a balance
    // load into free internet. The wallet has its own peek and claim routes.
    if (session.purpose === 'wallet') {
      res.json({ status: 'false', errorCode: 'coin.slot.notavailable' });
      return;
    }

    const credited = await settleAirCoinsSession(vendo.id, session);
    const fresh = findSessionById(session.id) || session;
    const waitTime = sessionTtlSeconds() * 1000;

    if (!sessionIsLive(fresh)) {
      res.json({
        status: 'false', errorCode: 'coins.wait.expired',
        remainTime: 0, timeAdded: fresh.settledSeconds,
        totalCoin: sessionPesos(vendo.id, fresh), waitTime,
      });
      return;
    }

    if (credited.result && credited.result.status === 'ok') {
      res.json({
        status: 'true',
        newCoin: credited.coins,
        // Cumulative, like the vendo's own timeAdded: the time all the coins in
        // this slot have bought so far - which is what the customer watches.
        timeAdded: fresh.settledSeconds,
        totalCoin: sessionPesos(vendo.id, fresh),
        remainTime: sessionRemainingMs(fresh),
        waitTime,
      });
      return;
    }

    res.json({
      status: 'false',
      errorCode: credited.result && credited.result.status === 'no-rate' ? 'coins.no.rate' : 'coin.not.inserted',
      remainTime: sessionRemainingMs(fresh),
      timeAdded: fresh.settledSeconds,
      totalCoin: sessionPesos(vendo.id, fresh),
      waitTime,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'false', errorCode: 'server.error' });
  }
});

// SAVE. The coins were already credited batch by batch, so this only closes the
// session and reports what it was worth - asking the voucher route again would
// pay the same pesos a second time.
async function closeAirCoinsSession(
  body: any,
  status: 'saved' | 'cancelled',
): Promise<any> {
  const vendo = airCoinsVendo(body?.deviceId);
  const session = vendo ? findSessionById(String(body?.sessionId || '')) : null;
  if (!vendo || !session || session.deviceId !== vendo.id) {
    return { code: 200, payload: { status: 'false', errorCode: 'coin.slot.notavailable' } };
  }
  // Only LOAD WALLET may close its own slot: closing it here would credit the
  // coins as time and leave the wallet top-up holding a session nobody owns.
  if (session.purpose === 'wallet') {
    return { code: 200, payload: { status: 'false', errorCode: 'coin.slot.notavailable' } };
  }
  if (session.status !== 'open') {
    return {
      code: 200,
      payload: {
        status: 'true', totalCoin: session.coins, timeAdded: session.settledSeconds,
        minutes: session.minutes, alreadyClosed: session.status,
      },
    };
  }

  const credited = await settleAirCoinsSession(vendo.id, session);
  const fresh = findSessionById(session.id) || session;
  // The totals already live on the session - settle wrote them - so finishing
  // only stamps the status, or a settle would be counted twice.
  const done = finishSession(session.id, status, {
    coins: fresh.coins,
    minutes: fresh.minutes,
    error: credited.result && credited.result.status !== 'ok' ? (credited.result.error || '') : '',
  });

  return {
    code: 200,
    payload: {
      status: 'true',
      totalCoin: done ? done.coins : fresh.coins,
      timeAdded: done ? done.settledSeconds : fresh.settledSeconds,
      minutes: done ? done.minutes : fresh.minutes,
      remainingSeconds: credited.result ? credited.result.remainingSeconds : 0,
      username: credited.result ? credited.result.username : '',
    },
  };
}

router.post('/coins/use', async (req: Request, res: Response) => {
  try {
    const reply = await closeAirCoinsSession(req.body || {}, 'saved');
    res.status(reply.code).json(reply.payload);
  } catch (error: any) {
    res.status(500).json({ status: 'false', errorCode: 'server.error' });
  }
});

// CANCEL still keeps what was dropped: JuanFi's cancel expires the slot and
// commits it, and a customer who walks away deserves the same.
router.post('/coins/cancel', async (req: Request, res: Response) => {
  try {
    const reply = await closeAirCoinsSession(req.body || {}, 'cancelled');
    res.status(reply.code).json(reply.payload);
  } catch (error: any) {
    res.status(500).json({ status: 'false', errorCode: 'server.error' });
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
  // Per-router panel_url override takes precedence over the global config.
  // This lets each router point to a different panel IP/URL (useful when the
  // SBC moves between networks).
  const db = getDb();
  const routerRow = db.prepare('SELECT panel_url FROM routers WHERE id = ?').get(routerId) as any;
  const routerPanelUrl = routerRow?.panel_url?.trim() || '';

  // Full base URL including scheme + optional port, so the portal can be served
  // through nginx (PANEL_PUBLIC_URL) instead of the raw node port.
  const base = routerPanelUrl || config.panelPublicUrl;
  const hostOnly = base.replace(/^https?:\/\//, '');
  return content
    .replace(/ROUTER_ID_PLACEHOLDER/g, String(routerId))
    .replace(/https?:\/\/PANEL_URL_PLACEHOLDER:\d+/g, base)
    .replace(/https?:\/\/PANEL_URL_PLACEHOLDER/g, base)
    .replace(/PANEL_URL_PLACEHOLDER/g, hostOnly);
}

// Re-push every stub file with freshly replaced placeholders. Used after a
// router's panel_url / portal_mode changes so the uploaded stubs never keep a
// stale redirect host (e.g. the localhost fallback from an earlier push).
export async function pushStubFiles(routerId: number): Promise<void> {
  for (const f of listHotspotFiles('stub')) {
    if (!f.editable) continue;
    const diskPath = resolveDiskPath(f.path, 'stub');
    let content: string;
    try {
      content = fs.readFileSync(diskPath, 'utf8');
    } catch {
      const def = getPortalDefaultContent(f.path, 'stub');
      if (!def) continue;
      content = def;
    }
    content = replaceStubPlaceholders(content, routerId);
    await mikroTikService.uploadFileSFTP(routerId, `hotspot/${f.path}`, content);
  }
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
