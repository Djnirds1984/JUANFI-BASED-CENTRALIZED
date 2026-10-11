import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../database';

const HOTSPOT_ROOT = path.resolve(__dirname, '..', '..', 'hotspot');

export interface PortalContext {
  routerId: number;
  mac: string;
  ip: string;
  username?: string;
  error?: string;
  linkOrig?: string;
  linkRedirect?: string;
  serverAddress?: string;
  interfaceName?: string;
  chapId?: string;
  chapChallenge?: string;
  linkLoginOnly?: string;
  linkLogout?: string;
  linkStatus?: string;
  // Status page variables
  bytesInNice?: string;
  bytesOutNice?: string;
  remainBytesTotalNice?: string;
  sessionTimeLeftSecs?: number;
  uptimeSecs?: number;
  refreshTimeoutSecs?: number;
  isLoggedIn?: boolean;
}

export function generateChapChallenge(): { chapId: string; chapChallenge: string } {
  const chapId = crypto.randomBytes(1).toString('hex');
  const chapChallenge = crypto.randomBytes(16).toString('hex');
  return { chapId, chapChallenge };
}

function readPortalFile(filePath: string): string | null {
  const fullPath = path.join(HOTSPOT_ROOT, filePath.replace(/\\/g, '/'));
  const realHotspot = path.resolve(HOTSPOT_ROOT);
  const realFull = path.resolve(fullPath);
  if (!realFull.startsWith(realHotspot + path.sep) && realFull !== realHotspot) return null;
  try {
    return fs.readFileSync(realFull, 'utf8');
  } catch {
    return null;
  }
}

export function getPortalFilePath(filePath: string): string | null {
  const fullPath = path.join(HOTSPOT_ROOT, filePath.replace(/\\/g, '/'));
  const realHotspot = path.resolve(HOTSPOT_ROOT);
  const realFull = path.resolve(fullPath);
  if (!realFull.startsWith(realHotspot + path.sep) && realFull !== realHotspot) return null;
  if (!fs.existsSync(realFull)) return null;
  return realFull;
}

function formatBytesNice(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

function buildContext(ctx: PortalContext): Record<string, string> {
  const db = getDb();
  const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(ctx.routerId) as any;

  const serverAddress = ctx.serverAddress || (routerRow ? routerRow.host : '');
  const interfaceName = ctx.interfaceName || `hotspot-vlan${ctx.routerId}`;
  const linkLoginOnly = ctx.linkLoginOnly || `/portal/${ctx.routerId}/login`;
  const linkLogout = ctx.linkLogout || `/portal/${ctx.routerId}/logout`;
  const linkStatus = ctx.linkStatus || `/portal/${ctx.routerId}/status.html`;

  const chap = (ctx.chapId !== undefined && ctx.chapChallenge !== undefined)
    ? { chapId: ctx.chapId, chapChallenge: ctx.chapChallenge }
    : generateChapChallenge();

  return {
    'mac': ctx.mac || '',
    'ip': ctx.ip || '',
    'username': ctx.username || '',
    'error': ctx.error || '',
    'link-orig': ctx.linkOrig || '',
    'link-redirect': ctx.linkRedirect || linkStatus,
    'server-address': serverAddress,
    'interface-name': interfaceName,
    'chap-id': chap.chapId,
    'chap-challenge': chap.chapChallenge,
    'link-login-only': linkLoginOnly,
    'link-login': linkLoginOnly,
    'link-logout': linkLogout,
    'link-status': linkStatus,
    'bytes-in-nice': ctx.bytesInNice || '0 B',
    'bytes-out-nice': ctx.bytesOutNice || '0 B',
    'remain-bytes-total-nice': ctx.remainBytesTotalNice || '0 B',
    'session-time-left-secs': String(ctx.sessionTimeLeftSecs || 0),
    'uptime-secs': String(ctx.uptimeSecs || 0),
    'refresh-timeout-secs': String(ctx.refreshTimeoutSecs || 30),
    'bytes-in': '0',
    'bytes-out': '0',
    'remain-bytes-total': '0',
    'session-time-left': '00:00:00',
    'uptime': '00:00:00',
    'login-by': 'mac',
    'popup': 'false',
  };
}

function processConditionals(html: string, vars: Record<string, string>): string {
  let result = html;

  // $(if chap-id)...$(endif)
  result = result.replace(/\$\(if chap-id\)([\s\S]*?)\$\((?:endif|\/if)\)/g, (match, content) => {
    return vars['chap-id'] ? content : '';
  });

  // $(if error)...$(endif)
  result = result.replace(/\$\(if error\)([\s\S]*?)\$\((?:endif|\/if)\)/g, (match, content) => {
    return vars['error'] ? content : '';
  });

  // $(if http-status == 302)...$(endif)
  result = result.replace(/\$\(if http-status == 302\)([\s\S]*?)\$\((?:endif|\/if)\)/g, (match, content) => {
    return content;
  });

  // $(if http-header == "Location")...$(endif)
  result = result.replace(/\$\(if http-header == "Location"\)([\s\S]*?)\$\((?:endif|\/if)\)/g, (match, content) => {
    return content;
  });

  // $(if refresh-timeout)...$(endif)
  result = result.replace(/\$\(if refresh-timeout\)([\s\S]*?)\$\((?:endif|\/if)\)/g, (match, content) => {
    return (parseInt(vars['refresh-timeout-secs'] || '0') > 0) ? content : '';
  });

  // $(if http-status == 200)...$(endif) — strip
  result = result.replace(/\$\(if http-status == 200\)([\s\S]*?)\$\((?:endif|\/if)\)/g, '');

  return result;
}

function replaceVariables(html: string, vars: Record<string, string>): string {
  let result = html;
  for (const [key, value] of Object.entries(vars)) {
    const pattern = new RegExp(`\\$\\(${escapeRegex(key)}\\)`, 'g');
    result = result.replace(pattern, value);
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderPortalFile(filePath: string, ctx: PortalContext): string | null {
  const content = readPortalFile(filePath);
  if (content === null) return null;

  const vars = buildContext(ctx);
  let result = processConditionals(content, vars);
  result = replaceVariables(result, vars);
  return result;
}

export function renderStatusPage(ctx: PortalContext): string | null {
  const db = getDb();

  const session = db.prepare(
    `SELECT rs.*, rp.name as profile_name, rp.session_timeout, rp.quota_total, rp.quota_rx, rp.quota_tx
     FROM radius_sessions rs
     LEFT JOIN radius_profiles rp ON rp.id = rs.profile_id
     WHERE rs.router_id = ? AND rs.username = ? AND rs.status = 'active'
     ORDER BY rs.started_at DESC LIMIT 1`
  ).get(ctx.routerId, ctx.username || '') as any;

  if (session) {
    ctx.bytesInNice = formatBytesNice(session.input_octets || 0);
    ctx.bytesOutNice = formatBytesNice(session.output_octets || 0);
    ctx.uptimeSecs = session.session_time || 0;

    const totalUsed = (session.input_octets || 0) + (session.output_octets || 0);
    if (session.quota_total && session.quota_total > 0) {
      const remain = Math.max(0, session.quota_total - totalUsed);
      ctx.remainBytesTotalNice = formatBytesNice(remain);
    } else {
      ctx.remainBytesTotalNice = 'Unlimited';
    }

    if (session.session_timeout && session.session_timeout > 0) {
      ctx.sessionTimeLeftSecs = Math.max(0, session.session_timeout - (session.session_time || 0));
    } else {
      ctx.sessionTimeLeftSecs = 0;
    }

    ctx.isLoggedIn = true;
  } else {
    ctx.isLoggedIn = false;
    ctx.bytesInNice = '0 B';
    ctx.bytesOutNice = '0 B';
    ctx.remainBytesTotalNice = '0 B';
    ctx.sessionTimeLeftSecs = 0;
    ctx.uptimeSecs = 0;
  }

  return renderPortalFile('status.html', ctx);
}
