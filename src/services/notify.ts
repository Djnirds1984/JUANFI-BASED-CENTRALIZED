import { getDb } from '../database';

/*
 * One place that decides how a customer gets a code.
 *
 * Today the controller has no mail account, so codes are posted into the
 * device's own portal CHAT thread - the customer is already looking at that
 * window, and it needs no internet, no credentials and no new dependency.
 *
 * The moment an SMTP account exists this becomes a configuration change, not a
 * code change: set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM in
 * .env and `npm install nodemailer`. Nothing in src/api/wallet.ts moves, because
 * every caller only knows deliverCode().
 */

export interface DeliveryTarget {
  accountId: number;
  email: string;
  /** Chat thread identity: MAC with colons, as chat_threads stores it. */
  mac: string;
  routerId: number;
}

export interface DeliveryResult {
  channel: 'email' | 'chat' | 'none';
  delivered: boolean;
  error?: string;
}

function parseRouterId(value: any): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Write a system message into the device's chat thread. Mirrors the thread +
 * counters that api/chat.ts maintains, so the admin inbox and the portal widget
 * both show it without a reload hack.
 */
function postChatMessage(mac: string, routerId: number, body: string): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO chat_threads (mac, router_id) VALUES (?, ?)').run(mac, routerId);
  const thread = db.prepare('SELECT id FROM chat_threads WHERE mac = ? AND router_id = ?').get(mac, routerId) as any;
  if (!thread) throw new Error('chat thread unavailable');
  db.prepare(
    'INSERT INTO chat_messages (thread_id, sender, body, image_path, read_by_admin, read_by_user) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(thread.id, 'admin', body, '', 1, 0);
  const preview = body.length > 120 ? `${body.slice(0, 117)}...` : body;
  db.prepare(
    "UPDATE chat_threads SET last_message_at = datetime('now'), last_preview = ? WHERE id = ?",
  ).run(preview, thread.id);
}

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Send mail when (and only when) an SMTP account is configured. nodemailer is
 * loaded lazily so the controller still boots - and the wallet still works -
 * without the package installed.
 */
async function sendEmail(to: string, subject: string, text: string): Promise<DeliveryResult> {
  if (!to) return { channel: 'email', delivered: false, error: 'no address on account' };
  let nodemailer: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nodemailer = require('nodemailer');
  } catch {
    return { channel: 'email', delivered: false, error: 'nodemailer is not installed' };
  }
  const port = parseInt(process.env.SMTP_PORT || '465', 10) || 465;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
  return { channel: 'email', delivered: true };
}

/**
 * Deliver a one-time code to the customer. Chat is the fallback whenever mail
 * is unavailable or fails, so a request never dies silently - and the code is
 * always readable by staff on the admin page as a last resort.
 */
export async function deliverCode(
  target: DeliveryTarget,
  subject: string,
  text: string,
): Promise<DeliveryResult> {
  if (smtpConfigured()) {
    try {
      return await sendEmail(target.email, subject, text);
    } catch (err: any) {
      console.error(`[wallet] mail to ${target.email} failed, falling back to chat:`, err.message);
    }
  }

  const mac = String(target.mac || '').trim().toLowerCase();
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
    try {
      postChatMessage(mac, parseRouterId(target.routerId), `${subject}\n\n${text}`);
      return { channel: 'chat', delivered: true };
    } catch (err: any) {
      console.error('[wallet] chat delivery failed:', err.message);
      return { channel: 'chat', delivered: false, error: err.message };
    }
  }

  return { channel: 'none', delivered: false, error: 'no delivery channel for this device' };
}
