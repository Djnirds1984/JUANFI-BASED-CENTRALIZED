import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { config } from '../config';
import {
  getPaymentSettings, savePaymentSettings, isPaymentEnabled,
  createPaymentRecord, makeReference, createPayMongoCheckout,
  verifyPayMongoSignature, handlePayMongoEvent, getPaymentByReference,
  listPayments, creditPayment,
  listPaymentRates, getPaymentRate, createPaymentRate, updatePaymentRate, deletePaymentRate,
} from '../services/payments';

const router = Router();

// ---------------------------------------------------------------------------
// Public (portal) endpoints
// ---------------------------------------------------------------------------
router.get('/config', (_req: Request, res: Response) => {
  const s = getPaymentSettings();
  res.json({
    enabled: isPaymentEnabled(),
    amount: s.amount,
    currency: s.currency,
    minutes: s.minutes,
    description: s.description,
    rates: listPaymentRates(true).filter((r) => r.amount > 0 && r.minutes > 0),
  });
});

// Create a PayMongo (GCash) checkout for this device.
router.post('/checkout', async (req: Request, res: Response) => {
  try {
    if (!isPaymentEnabled()) {
      res.status(400).json({ error: 'Online payment is not configured/enabled' });
      return;
    }
    const mac = String(req.body?.mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (mac.length !== 12) {
      res.status(400).json({ error: 'Valid mac is required' });
      return;
    }
    const routerId = parseInt(req.body?.routerId, 10) || undefined;
    const s = getPaymentSettings();

    // Price/time comes from the chosen online tier; fall back to the default.
    const rateId = parseInt(req.body?.rateId, 10) || 0;
    const rate = rateId ? getPaymentRate(rateId) : null;
    const amount = rate && rate.is_active ? rate.amount : s.amount;
    const minutes = rate && rate.is_active ? rate.minutes : s.minutes;
    const label = rate && rate.is_active && rate.label ? rate.label : s.description;

    if (!(amount > 0) || !(minutes > 0)) {
      res.status(400).json({ error: 'Selected rate has no price/time' });
      return;
    }

    const reference = makeReference();
    createPaymentRecord({ reference, routerId, mac, amount, minutes });

    const base = (config.panelPublicUrl || '').replace(/\/+$/, '');
    const q = `mac=${encodeURIComponent(mac)}${routerId ? `&router-id=${routerId}` : ''}`;
    const out = await createPayMongoCheckout({
      reference,
      amount,
      currency: s.currency,
      description: label,
      minutes,
      mac,
      routerId,
      successUrl: `${base}/?pay=success&${q}`,
      cancelUrl: `${base}/?pay=cancel&${q}`,
    });

    res.json({ checkoutUrl: out.checkoutUrl, reference, providerRef: out.providerRef, amount, minutes });
  } catch (error: any) {
    console.error('payment checkout error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/status/:reference', (req: Request, res: Response) => {
  const p = getPaymentByReference(req.params.reference);
  if (!p) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }
  res.json({ reference: p.reference, status: p.status, minutes: p.minutes, mac: p.mac_address });
});

// PayMongo webhook (public; signature-verified with the configured secret).
router.post('/paymongo/webhook', async (req: Request, res: Response) => {
  try {
    const settings = getPaymentSettings();
    const raw = (req as any).rawBody || JSON.stringify(req.body || {});
    const sig = req.headers['paymongo-signature'] as string | undefined;
    if (!verifyPayMongoSignature(raw, sig, settings.webhook_secret)) {
      console.warn('[payments] PayMongo webhook signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    const result = await handlePayMongoEvent(req.body);
    res.json(result);
  } catch (error: any) {
    console.error('payment webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------
router.use(authMiddleware);

router.get('/settings', (_req: Request, res: Response) => {
  res.json(getPaymentSettings());
});

router.put('/settings', (req: Request, res: Response) => {
  try {
    res.json(savePaymentSettings(req.body || {}));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/rates', (_req: Request, res: Response) => {
  res.json(listPaymentRates(false));
});

router.post('/rates', (req: Request, res: Response) => {
  try {
    res.status(201).json(createPaymentRate(req.body || {}));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/rates/:id', (req: Request, res: Response) => {
  try {
    const updated = updatePaymentRate(parseInt(req.params.id, 10), req.body || {});
    if (!updated) { res.status(404).json({ error: 'Rate not found' }); return; }
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/rates/:id', (req: Request, res: Response) => {
  try {
    const ok = deletePaymentRate(parseInt(req.params.id, 10));
    if (!ok) { res.status(404).json({ error: 'Rate not found' }); return; }
    res.json({ message: 'Rate deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/list', (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || '100'), 10) || 100;
  res.json(listPayments(limit));
});

router.post('/:reference/credit', async (req: Request, res: Response) => {
  try {
    res.json(await creditPayment(req.params.reference));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
