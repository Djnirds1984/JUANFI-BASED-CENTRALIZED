import crypto from 'crypto';
import { getDb } from '../database';
import { config } from '../config';

/**
 * Online payments (PayMongo / GCash).
 *
 * Admin configures the PayMongo keys + price/time in the "Online Payment" tab;
 * the portal shows a PAY GCASH button which creates a PayMongo Checkout Session;
 * PayMongo calls our webhook when it is paid and we credit the device.
 */

export interface PaymentSettings {
  enabled: boolean;
  provider: string;
  public_key: string;
  secret_key: string;
  webhook_secret: string;
  currency: string;
  amount: number;
  minutes: number;
  description: string;
}

export function getPaymentSettings(): PaymentSettings {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO payment_settings (id) VALUES (1)').run();
  const row = db.prepare('SELECT * FROM payment_settings WHERE id = 1').get() as any;
  return {
    enabled: !!row.enabled,
    provider: row.provider || 'paymongo',
    public_key: row.public_key || '',
    secret_key: row.secret_key || '',
    webhook_secret: row.webhook_secret || '',
    currency: row.currency || 'PHP',
    amount: Number(row.amount) || 0,
    minutes: parseInt(row.minutes, 10) || 0,
    description: row.description || 'Internet Time',
  };
}

export function savePaymentSettings(patch: Partial<PaymentSettings>): PaymentSettings {
  const db = getDb();
  const cur = getPaymentSettings();
  const next: PaymentSettings = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : cur.enabled,
    provider: patch.provider || cur.provider,
    public_key: patch.public_key !== undefined ? String(patch.public_key) : cur.public_key,
    secret_key: patch.secret_key !== undefined ? String(patch.secret_key) : cur.secret_key,
    webhook_secret: patch.webhook_secret !== undefined ? String(patch.webhook_secret) : cur.webhook_secret,
    currency: (patch.currency || cur.currency).toUpperCase(),
    amount: patch.amount !== undefined ? Number(patch.amount) || 0 : cur.amount,
    minutes: patch.minutes !== undefined ? parseInt(String(patch.minutes), 10) || 0 : cur.minutes,
    description: patch.description !== undefined ? String(patch.description) : cur.description,
  };
  db.prepare(
    `UPDATE payment_settings SET enabled = ?, provider = ?, public_key = ?, secret_key = ?,
       webhook_secret = ?, currency = ?, amount = ?, minutes = ?, description = ?,
       updated_at = datetime('now') WHERE id = 1`
  ).run(
    next.enabled ? 1 : 0, next.provider, next.public_key, next.secret_key, next.webhook_secret,
    next.currency, next.amount, next.minutes, next.description
  );
  return next;
}

export function createPaymentRecord(params: {
  reference: string; routerId?: number; mac: string; amount: number; minutes: number;
}): void {
  getDb().prepare(
    `INSERT INTO payments (reference, provider, router_id, mac_address, amount, minutes, status)
     VALUES (?, 'paymongo', ?, ?, ?, ?, 'pending')`
  ).run(params.reference, params.routerId ?? null, params.mac, params.amount, params.minutes);
}

export function getPaymentByReference(reference: string): any {
  return getDb().prepare('SELECT * FROM payments WHERE reference = ?').get(reference) as any;
}

export function listPayments(limit = 100): any[] {
  return getDb().prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}

export interface PaymentRate {
  id?: number;
  label: string;
  amount: number;
  minutes: number;
  is_active: boolean;
  sort_order: number;
}

function mapRate(r: any): any {
  return {
    id: r.id,
    label: r.label || '',
    amount: Number(r.amount) || 0,
    minutes: parseInt(r.minutes, 10) || 0,
    is_active: !!r.is_active,
    sort_order: parseInt(r.sort_order, 10) || 0,
  };
}

export function listPaymentRates(onlyActive = false): any[] {
  const db = getDb();
  const q = onlyActive
    ? 'SELECT * FROM payment_rates WHERE is_active = 1 ORDER BY sort_order ASC, amount ASC'
    : 'SELECT * FROM payment_rates ORDER BY sort_order ASC, amount ASC';
  return (db.prepare(q).all() as any[]).map(mapRate);
}

export function getPaymentRate(id: number): any {
  const row = getDb().prepare('SELECT * FROM payment_rates WHERE id = ?').get(id) as any;
  return row ? mapRate(row) : null;
}

export function createPaymentRate(r: any): any {
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO payment_rates (label, amount, minutes, is_active, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(
    String(r?.label || '').trim(),
    Number(r?.amount) || 0,
    parseInt(String(r?.minutes), 10) || 0,
    r?.is_active === false ? 0 : 1,
    parseInt(String(r?.sort_order), 10) || 0
  );
  return getPaymentRate(Number(info.lastInsertRowid));
}

export function updatePaymentRate(id: number, r: any): any {
  const db = getDb();
  const cur = getPaymentRate(id);
  if (!cur) return null;
  db.prepare(
    'UPDATE payment_rates SET label = ?, amount = ?, minutes = ?, is_active = ?, sort_order = ? WHERE id = ?'
  ).run(
    r?.label !== undefined ? String(r.label).trim() : cur.label,
    r?.amount !== undefined ? (Number(r.amount) || 0) : cur.amount,
    r?.minutes !== undefined ? (parseInt(String(r.minutes), 10) || 0) : cur.minutes,
    r?.is_active !== undefined ? (r.is_active ? 1 : 0) : (cur.is_active ? 1 : 0),
    r?.sort_order !== undefined ? (parseInt(String(r.sort_order), 10) || 0) : cur.sort_order,
    id
  );
  return getPaymentRate(id);
}

export function deletePaymentRate(id: number): boolean {
  const info = getDb().prepare('DELETE FROM payment_rates WHERE id = ?').run(id);
  return info.changes > 0;
}

/** Whether online payment is usable (enabled + keys + at least one tier). */
export function isPaymentEnabled(): boolean {
  const s = getPaymentSettings();
  if (!s.enabled || !s.secret_key) return false;
  const rates = listPaymentRates(true).filter((r) => r.amount > 0 && r.minutes > 0);
  return rates.length > 0 || (s.amount > 0 && s.minutes > 0);
}

export function makeReference(): string {
  return 'pay_' + crypto.randomBytes(10).toString('hex');
}

/** Create a PayMongo Checkout Session (GCash) and return its URL. */
export async function createPayMongoCheckout(params: {
  reference: string;
  amount: number;
  currency: string;
  description: string;
  minutes: number;
  mac: string;
  routerId?: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ checkoutUrl: string; providerRef: string }> {
  const settings = getPaymentSettings();
  if (!settings.secret_key) throw new Error('PayMongo secret key is not configured');

  const auth = 'Basic ' + Buffer.from(settings.secret_key + ':').toString('base64');
  const body = {
    data: {
      attributes: {
        line_items: [
          {
            currency: params.currency || settings.currency || 'PHP',
            amount: Math.round(params.amount * 100), // centavos
            name: params.description || settings.description || 'Internet Time',
            quantity: 1,
          },
        ],
        payment_method_types: ['gcash'],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        description: params.description || settings.description || 'Internet Time',
        metadata: {
          reference: params.reference,
          mac: params.mac,
          routerId: String(params.routerId ?? ''),
          minutes: String(params.minutes),
        },
      },
    },
  };

  const res = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.errors?.[0]?.detail || json?.errors?.[0]?.code || `PayMongo error (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const attrs = json?.data?.attributes || {};
  const checkoutUrl = attrs.checkout_url || '';
  const providerRef = json?.data?.id || '';
  if (!checkoutUrl) throw new Error('PayMongo did not return a checkout URL');
  return { checkoutUrl, providerRef };
}

/** Verify the `paymongo-signature` header (HMAC-SHA256 of `<t>.<rawBody>`). */
export function verifyPayMongoSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!secret) return true; // no webhook secret configured -> can't verify (accept)
  if (!signatureHeader) return false;
  const parts: Record<string, string> = {};
  for (const piece of signatureHeader.split(',')) {
    const i = piece.indexOf('=');
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  const t = parts.t;
  const sig = parts.li || parts.te;
  if (!t || !sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

/** Mark a payment paid and credit the device (stacks time + CoA via coin-auth). */
export async function creditPayment(reference: string, providerRef?: string): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const payment = getPaymentByReference(reference);
  if (!payment) return { ok: false, message: `Unknown payment reference ${reference}` };
  if (payment.status === 'paid') return { ok: true, message: 'Already credited' };

  db.prepare(
    "UPDATE payments SET status = 'paid', paid_at = datetime('now'), provider_ref = COALESCE(?, provider_ref) WHERE id = ?"
  ).run(providerRef ?? null, payment.id);

  // Reuse the panel's coin top-up path: stack expiry + CoA + token bind.
  try {
    const macHex = String(payment.mac_address || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (macHex.length === 12) {
      const res = await fetch(`http://127.0.0.1:${config.port}/api/vouchers/coin-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: macHex, durationMinutes: payment.minutes, routerId: payment.router_id }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.error('[payments] credit coin-auth failed:', res.status, t);
        return { ok: false, message: `Credited DB but coin-auth returned ${res.status}` };
      }
    }
  } catch (err: any) {
    console.error('[payments] credit error:', err.message);
    return { ok: false, message: err.message };
  }

  console.log(`[payments] credited ${payment.minutes} min to ${payment.mac_address} (ref ${reference})`);
  return { ok: true, message: `Credited ${payment.minutes} min` };
}

/** Handle a PayMongo webhook payload. */
export async function handlePayMongoEvent(payload: any): Promise<{ ok: boolean; message: string }> {
  try {
    const eventType = payload?.data?.attributes?.type || '';
    const resource = payload?.data?.attributes?.data;
    const attrs = resource?.attributes || {};
    const metadata = attrs.metadata || {};
    let reference = String(metadata.reference || '');

    // checkout_session events wrap the payment in attributes.payments[]
    if (!reference && Array.isArray(attrs.payments)) {
      for (const p of attrs.payments) {
        const m = p?.attributes?.metadata;
        if (m?.reference) { reference = String(m.reference); break; }
      }
    }
    if (!reference && attrs.reference) reference = String(attrs.reference);

    const providerRef = String(resource?.id || '');

    if (!eventType.startsWith('payment') && !eventType.startsWith('checkout_session')) {
      return { ok: true, message: `Ignored event ${eventType}` };
    }
    if (!reference) return { ok: false, message: 'No reference in webhook payload' };

    return await creditPayment(reference, providerRef);
  } catch (err: any) {
    console.error('[payments] webhook error:', err.message);
    return { ok: false, message: err.message };
  }
}
