import crypto from 'crypto';
import { getDb } from '../database';
import { mikroTikService } from './mikrotik';

interface ChapContext {
  chapId: string;
  chapChallenge: string;
  createdAt: number;
}

const chapCache = new Map<string, ChapContext>();
const CHAP_TTL_MS = 5 * 60 * 1000;

export function storeChapContext(routerId: number, mac: string, chapId: string, chapChallenge: string): void {
  const key = `${routerId}:${mac}`;
  chapCache.set(key, { chapId, chapChallenge, createdAt: Date.now() });
}

export function consumeChapContext(routerId: number, mac: string): ChapContext | null {
  const key = `${routerId}:${mac}`;
  const ctx = chapCache.get(key);
  chapCache.delete(key);
  if (!ctx) return null;
  if (Date.now() - ctx.createdAt > CHAP_TTL_MS) return null;
  return ctx;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, ctx] of chapCache) {
    if (now - ctx.createdAt > CHAP_TTL_MS) chapCache.delete(key);
  }
}, 60 * 1000);

export interface PortalLoginResult {
  success: boolean;
  error?: string;
  sessionId?: string;
  profileName?: string;
  sessionTimeout?: number;
  redirectUrl?: string;
}

export interface PortalSessionInfo {
  username: string;
  sessionId: string;
  profileName?: string;
  startedAt: string;
  inputOctets: number;
  outputOctets: number;
  sessionTime: number;
  sessionTimeout: number;
  quotaTotal: number;
}

function validateChapResponse(
  chapIdHex: string,
  chapChallengeHex: string,
  password: string,
  chapResponseHex: string,
): boolean {
  const chapIdBuf = Buffer.from(chapIdHex, 'hex');
  const chapChallengeBuf = Buffer.from(chapChallengeHex, 'hex');
  const concat = Buffer.concat([chapIdBuf, Buffer.from(password, 'utf8'), chapChallengeBuf]);
  const expected = crypto.createHash('md5').update(concat).digest('hex');
  return expected.toLowerCase() === chapResponseHex.toLowerCase();
}

function findUser(routerId: number, username: string): { user: any; voucher: any; profile: any } | null {
  const db = getDb();

  const user = db.prepare(
    `SELECT id, username, password, profile, uptime_limit, bytes_in_quota, bytes_out_quota,
            disabled, radius_profile_id, first_login_at, expiry_at, shared_users
     FROM hotspot_users
     WHERE router_id = ? AND username = ? AND disabled = 0`
  ).get(routerId, username) as any;

  if (user) {
    if (user.expiry_at) {
      const now = new Date().toISOString();
      if (user.expiry_at < now) return null;
    }

    let profile: any = null;
    if (user.radius_profile_id) {
      profile = db.prepare('SELECT * FROM radius_profiles WHERE id = ? AND router_id = ?')
        .get(user.radius_profile_id, routerId) as any;
    }

    const voucher = db.prepare(
      `SELECT id, duration_minutes FROM vouchers
       WHERE router_id = ? AND code = ? AND is_used = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))`
    ).get(routerId, username) as any;

    return { user, voucher, profile };
  }

  const voucherOnly = db.prepare(
    `SELECT id, duration_minutes, expires_at, password, radius_profile_id
     FROM vouchers
     WHERE router_id = ? AND code = ? AND is_used = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).get(routerId, username) as any;

  if (voucherOnly) {
    let profile: any = null;
    if (voucherOnly.radius_profile_id) {
      profile = db.prepare('SELECT * FROM radius_profiles WHERE id = ? AND router_id = ?')
        .get(voucherOnly.radius_profile_id, routerId) as any;
    }
    return { user: null, voucher: voucherOnly, profile };
  }

  return null;
}

function computeSessionTimeout(found: { user: any; voucher: any; profile: any }): number {
  let timeout = 0;

  if (found.profile?.session_timeout > 0) {
    timeout = found.profile.session_timeout;
  }

  if (found.user?.uptime_limit && found.user.uptime_limit !== '00:00:00') {
    const parts = found.user.uptime_limit.split(':').map(Number);
    if (parts.length === 3) {
      const userTimeout = parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (timeout === 0 || userTimeout < timeout) timeout = userTimeout;
    }
  }

  if (found.voucher?.duration_minutes) {
    timeout = found.voucher.duration_minutes * 60;
  }

  return timeout;
}

async function authorizeOnMikroTik(routerId: number, mac: string, ip: string): Promise<string | null> {
  try {
    if (!mikroTikService.isConnected(routerId)) {
      console.warn(`[PortalAuth] Router ${routerId} not connected, skipping IP binding`);
      return null;
    }

    const result = await mikroTikService.createIpBinding(routerId, {
      type: 'bypassed',
      'mac-address': mac,
      address: ip,
      comment: `portal-auth:${Date.now()}`,
    });

    const bindingId = result?.['.id'] || result?.ret || null;
    console.log(`[PortalAuth] IP binding created on router ${routerId}: mac=${mac} ip=${ip} id=${bindingId}`);
    return bindingId;
  } catch (err) {
    console.error(`[PortalAuth] Failed to create IP binding on router ${routerId}:`, (err as Error).message);
    return null;
  }
}

async function deauthorizeOnMikroTik(routerId: number, bindingId: string): Promise<void> {
  try {
    if (!mikroTikService.isConnected(routerId)) return;
    await mikroTikService.deleteIpBinding(routerId, bindingId);
    console.log(`[PortalAuth] IP binding removed on router ${routerId}: id=${bindingId}`);
  } catch (err) {
    console.error(`[PortalAuth] Failed to remove IP binding on router ${routerId}:`, (err as Error).message);
  }
}

export async function portalLogin(params: {
  routerId: number;
  username: string;
  chapResponse?: string;
  mac: string;
  ip: string;
}): Promise<PortalLoginResult> {
  const { routerId, username, chapResponse, mac, ip } = params;

  if (!username) {
    return { success: false, error: 'Username is required' };
  }

  const db = getDb();

  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
  if (!router) {
    return { success: false, error: 'Router not found' };
  }
  if (router.portal_mode !== 'radius') {
    return { success: false, error: 'Router is not in RADIUS portal mode' };
  }

  const existingSession = db.prepare(
    `SELECT id FROM radius_sessions
     WHERE router_id = ? AND mac_address = ? AND status = 'active'`
  ).get(routerId, mac) as any;

  if (existingSession) {
    const sessionData = db.prepare(
      `SELECT rs.username, rs.session_id, rp.name as profile_name
       FROM radius_sessions rs
       LEFT JOIN radius_profiles rp ON rp.id = rs.profile_id
       WHERE rs.id = ?`
    ).get(existingSession.id) as any;

    return {
      success: true,
      sessionId: sessionData?.session_id,
      profileName: sessionData?.profile_name,
      redirectUrl: `/portal/${routerId}/status.html`,
    };
  }

  const found = findUser(routerId, username);
  if (!found) {
    console.log(`[PortalAuth] Login rejected: user=${username} router=${routerId} (not found/disabled/expired)`);
    return { success: false, error: 'Invalid username or password' };
  }

  const password = found.user?.password || found.voucher?.password || '';

  if (password && chapResponse) {
    const chapCtx = consumeChapContext(routerId, mac);
    if (!chapCtx) {
      console.log(`[PortalAuth] Login rejected: user=${username} router=${routerId} (no CHAP context)`);
      return { success: false, error: 'Session expired, please try again' };
    }
    if (!validateChapResponse(chapCtx.chapId, chapCtx.chapChallenge, password, chapResponse)) {
      console.log(`[PortalAuth] Login rejected: user=${username} router=${routerId} (CHAP mismatch)`);
      return { success: false, error: 'Invalid username or password' };
    }
  }

  const sessionTimeout = computeSessionTimeout(found);
  const sessionId = crypto.randomBytes(16).toString('hex');

  let profileId: number | null = null;
  let profileName: string | undefined;
  if (found.profile) {
    profileId = found.profile.id;
    profileName = found.profile.name;
  }

  db.prepare(
    `INSERT INTO radius_sessions
     (router_id, username, session_id, nas_ip, profile_id, status, started_at, updated_at,
      input_octets, output_octets, input_packets, output_packets, session_time, mac_address)
     VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'), 0, 0, 0, 0, 0, ?)`
  ).run(routerId, username, sessionId, ip, profileId, mac);

  if (found.user) {
    if (!found.user.first_login_at) {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      db.prepare('UPDATE hotspot_users SET first_login_at = ? WHERE id = ?').run(now, found.user.id);

      if (found.user.radius_profile_id && found.profile?.validity_period && found.profile.validity_period > 0) {
        const expiryMs = Date.now() + found.profile.validity_period * 1000;
        const expiryStr = new Date(expiryMs).toISOString().replace('T', ' ').slice(0, 19);
        db.prepare('UPDATE hotspot_users SET expiry_at = ? WHERE id = ?').run(expiryStr, found.user.id);
      } else if (found.profile?.validity_fixed_expiry) {
        db.prepare('UPDATE hotspot_users SET expiry_at = ? WHERE id = ?').run(found.profile.validity_fixed_expiry, found.user.id);
      }
    }
    db.prepare('UPDATE hotspot_users SET last_login_at = datetime(\'now\') WHERE id = ?').run(found.user.id);
  }

  if (found.voucher?.id) {
    db.prepare('UPDATE vouchers SET is_used = 1, used_at = datetime(\'now\') WHERE id = ?').run(found.voucher.id);
  }

  const bindingId = await authorizeOnMikroTik(routerId, mac, ip);

  if (bindingId) {
    db.prepare('UPDATE radius_sessions SET binding_id = ? WHERE session_id = ? AND router_id = ?')
      .run(bindingId, sessionId, routerId);
  }

  console.log(`[PortalAuth] Login accepted: user=${username} router=${routerId} session=${sessionId} timeout=${sessionTimeout}s`);

  return {
    success: true,
    sessionId,
    profileName,
    sessionTimeout: sessionTimeout || undefined,
    redirectUrl: `/portal/${routerId}/status.html`,
  };
}

export async function portalLogout(params: {
  routerId: number;
  username?: string;
  mac?: string;
  ip?: string;
}): Promise<{ success: boolean }> {
  const { routerId, username, mac, ip } = params;
  const db = getDb();

  let session: any = null;
  if (mac) {
    session = db.prepare(
      `SELECT id, session_id, username, binding_id FROM radius_sessions
       WHERE router_id = ? AND mac_address = ? AND status = 'active'
       ORDER BY started_at DESC LIMIT 1`
    ).get(routerId, mac) as any;
  }
  if (!session && username) {
    session = db.prepare(
      `SELECT id, session_id, username, binding_id FROM radius_sessions
       WHERE router_id = ? AND username = ? AND status = 'active'
       ORDER BY started_at DESC LIMIT 1`
    ).get(routerId, username) as any;
  }

  if (session) {
    if (session.binding_id) {
      await deauthorizeOnMikroTik(routerId, session.binding_id);
    }

    db.prepare(
      `UPDATE radius_sessions
       SET status = 'stopped', stopped_at = datetime('now'), updated_at = datetime('now'),
           terminate_cause = 'User-Request'
       WHERE id = ?`
    ).run(session.id);

    db.prepare(
      `UPDATE hotspot_users SET total_session_time = total_session_time + (
         SELECT session_time FROM radius_sessions WHERE id = ?
       ), last_logout_at = datetime('now')
       WHERE router_id = ? AND username = ?`
    ).run(session.id, routerId, session.username);

    console.log(`[PortalAuth] Logout: user=${session.username} router=${routerId} session=${session.session_id}`);
  }

  return { success: true };
}

export function getActiveSession(routerId: number, mac: string): PortalSessionInfo | null {
  const db = getDb();

  const session = db.prepare(
    `SELECT rs.username, rs.session_id, rs.started_at, rs.input_octets, rs.output_octets,
            rs.session_time, rp.name as profile_name, rp.session_timeout, rp.quota_total
     FROM radius_sessions rs
     LEFT JOIN radius_profiles rp ON rp.id = rs.profile_id
     WHERE rs.router_id = ? AND rs.mac_address = ? AND rs.status = 'active'
     ORDER BY rs.started_at DESC LIMIT 1`
  ).get(routerId, mac) as any;

  if (!session) return null;

  return {
    username: session.username,
    sessionId: session.session_id,
    profileName: session.profile_name,
    startedAt: session.started_at,
    inputOctets: session.input_octets,
    outputOctets: session.output_octets,
    sessionTime: session.session_time,
    sessionTimeout: session.session_timeout || 0,
    quotaTotal: session.quota_total || 0,
  };
}

export function updateSessionAccounting(routerId: number, mac: string, bytesIn: number, bytesOut: number, sessionTime: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE radius_sessions
     SET input_octets = ?, output_octets = ?, session_time = ?, updated_at = datetime('now')
     WHERE router_id = ? AND mac_address = ? AND status = 'active'`
  ).run(bytesIn, bytesOut, sessionTime, routerId, mac);
}
