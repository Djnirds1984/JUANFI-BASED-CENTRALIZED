import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../database';
import { authMiddleware, clientAuthMiddleware } from '../middleware/auth';
import { mikroTikService } from '../services/mikrotik';
import { nodeMcuService } from '../services/nodemcu';
import { findDevice, findDeviceByIp, loadDevices } from '../services/deviceRegistry';
import { listPaymentRates } from '../services/payments';
import { grantMinutesToMac } from '../services/timeCredit';
import { deliverCode } from '../services/notify';
import {
  PESO, getWalletSettings, saveWalletSettings, validateRegistration, normalizeEmail, normalizeMac,
  findAccountByEmail, findAccountById, publicAccount, createAccount, authenticateAccount,
  signClientToken, verifyPin, revokeWalletSessions, credit, debit, spentTodayCentavos,
  issueAuthCode, matchAuthCode, consumeAuthCode, makeTopupCode, getTopupByCode, listOpenTopups,
  allowRate, pesosToCentavos, touchDevice, isKnownDevice,
} from '../services/wallet';

const router = Router();

const CODE_TTL_MIN = 30;

function clientIp(req: Request): string {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

/** Money the portal displays: whole and fractional pesos, never a float sum. */
function pesos(centavos: number): number {
  return Math.round(Number(centavos) || 0) / PESO;
}

/** The time packages a balance can be spent on - the GCash table, shared. */
function walletRates() {
  return listPaymentRates(true)
    .filter((r: any) => Number(r.amount) > 0 && Number(r.minutes) > 0)
    .map((r: any) => ({
      id: r.id,
      label: r.label,
      amount: Number(r.amount),
      amount_centavos: Math.round(Number(r.amount) * PESO),
      minutes: Number(r.minutes),
    }));
}

function requireWalletEnabled(res: Response): boolean {
  if (!getWalletSettings().enabled) {
    res.status(403).json({ error: 'Wallet is currently disabled' });
    return false;
  }
  return true;
}

/** The signed-in account row, re-read so a freeze/balance change applies at once. */
function currentAccount(req: Request): any {
  return findAccountById(Number(req.wallet?.accountId));
}

/*
 * Staff endpoints live on their own router with the panel's admin gate, and it
 * is mounted HERE - before the customer gate below. Express walks a router in
 * registration order, so mounting it after `router.use(clientAuthMiddleware)`
 * would make every /admin call bounce off the customer token check first.
 */
const admin = Router();
admin.use(authMiddleware);
router.use('/admin', admin);

// ---------------------------------------------------------------------------
// Public: what the portal needs before anyone signs in
// ---------------------------------------------------------------------------

router.get('/config', (_req: Request, res: Response) => {
  const s = getWalletSettings();
  res.json({
    enabled: s.enabled,
    require_verification: s.require_verification,
    rates: walletRates(),
    // Advisory: shown on the LOAD WALLET screen so customers know the smallest
    // note worth inserting. Coins are always credited at whatever the machine
    // reports - a customer's money is never refused because it came up short.
    min_topup: pesos(s.min_topup_centavos),
    min_convert: pesos(s.min_convert_centavos),
    daily_convert_limit: s.daily_convert_centavos > 0 ? pesos(s.daily_convert_centavos) : 0,
    coin_value: pesos(s.coin_value_centavos),
  });
});

// The portal offers one coin machine per registered panel device, so it can
// grey out a machine that is listed in config.js but was never added here (a
// wallet top-up needs the controller to be able to talk to that machine).
router.get('/machines', (_req: Request, res: Response) => {
  res.json({
    machines: loadDevices()
      .filter((d) => d.ip)
      .map((d) => ({ id: d.id, name: d.name, ip: d.ip })),
  });
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    if (!requireWalletEnabled(res)) return;
    if (!allowRate(`reg:${clientIp(req)}`, 8, 3600000)) {
      res.status(429).json({ error: 'Too many attempts from this device, please ask an agent' });
      return;
    }

    const invalid = validateRegistration(req.body);
    if (invalid) {
      res.status(400).json({ error: invalid.error });
      return;
    }
    const email = normalizeEmail(req.body.email);
    if (findAccountByEmail(email)) {
      res.status(409).json({ error: 'That email already has a wallet. Use FORGOT PASSWORD.' });
      return;
    }

    const settings = getWalletSettings();
    const mac = normalizeMac(req.body.mac);
    const routerId = parseInt(String(req.body.routerId || '0'), 10) || 0;
    const account = await createAccount({
      email,
      password: String(req.body.password),
      pin: String(req.body.pin || ''),
      full_name: req.body.full_name,
      mobile: req.body.mobile,
      mac,
      routerId,
      // Verification only holds the wallet back when the operator switched it
      // on; otherwise registration works immediately, which is what a customer
      // standing at a coin machine expects.
      verified: settings.require_verification ? false : true,
    });

    let delivery: any = { channel: 'none', delivered: false };
    if (settings.require_verification) {
      const code = issueAuthCode(account.id, 'verify', mac, 24 * 60);
      delivery = await deliverCode(
        { accountId: account.id, email: account.email, mac, routerId },
        'Confirm your wallet',
        `Welcome ${account.full_name || ''}. Confirm this wallet for ${account.email} with code ${code}. It is valid for 24 hours.`,
      );
    }

    console.log(`[wallet] registered ${account.email} (id ${account.id}) from ${mac || 'unknown device'}`);
    res.status(201).json({
      token: signClientToken(account),
      account: publicAccount(account),
      verification_required: settings.require_verification,
      code_sent_to: delivery.channel,
    });
  } catch (error: any) {
    console.error('Wallet register error:', error);
    res.status(400).json({ error: error.message || 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    if (!requireWalletEnabled(res)) return;
    const email = normalizeEmail(req.body.email);
    if (!allowRate(`login:${email}`, 10, 300000)) {
      res.status(429).json({ error: 'Too many sign-in attempts, wait a few minutes' });
      return;
    }
    const mac = normalizeMac(req.body.mac);
    const routerId = parseInt(String(req.body.routerId || '0'), 10) || 0;
    const result = await authenticateAccount(email, String(req.body.password || ''), mac, routerId);
    if (result.error) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({ token: result.token, account: publicAccount(result.account) });
  } catch (error: any) {
    console.error('Wallet login error:', error);
    res.status(500).json({ error: error.message });
  }
});

/*
 * Forgot password.
 *
 * The code is delivered into THIS DEVICE's portal chat, so it is only useful to
 * somebody holding a device that has used the account before. Without that rule
 * the endpoint would be an account-takeover button: type any email, read the
 * code in your own chat window. So an unknown device gets the same polite
 * answer and nothing is issued.
 */
router.post('/forgot', async (req: Request, res: Response) => {
  try {
    if (!requireWalletEnabled(res)) return;
    const email = normalizeEmail(req.body.email);
    const mac = normalizeMac(req.body.mac);
    const routerId = parseInt(String(req.body.routerId || '0'), 10) || 0;

    // One answer either way - the portal must not reveal who has a wallet.
    const generic = {
      ok: true,
      message: 'If that email has a wallet on this device, a restore code was sent to this device chat. Otherwise please see an agent with a valid ID.',
    };

    if (!allowRate(`forgot:${email}`, 3, 3600000) || !allowRate(`forgotip:${clientIp(req)}`, 6, 3600000)) {
      res.json(generic);
      return;
    }

    const account = findAccountByEmail(email);
    if (account && account.status === 'active' && isKnownDevice(account, mac)) {
      const code = issueAuthCode(account.id, 'reset', mac, CODE_TTL_MIN);
      await deliverCode(
        { accountId: account.id, email: account.email, mac, routerId },
        'Wallet password restore',
        `Code ${code} restores the password for ${account.email}. It expires in ${CODE_TTL_MIN} minutes and works only on this device.`,
      );
      console.log(`[wallet] reset code issued for ${account.email} on ${mac}`);
    }

    res.json(generic);
  } catch (error: any) {
    console.error('Wallet forgot error:', error);
    // Still 200 with the generic answer: a failure here must not tell the
    // caller whether the address exists.
    res.json({ ok: true, message: 'Request received. If a wallet matches, a code was sent to this device chat.' });
  }
});

router.post('/reset', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const mac = normalizeMac(req.body.mac);
    const password = String(req.body.password || '');
    const account = findAccountByEmail(email);

    const reject = { error: 'That code does not match or has expired' };
    if (!account) {
      res.status(400).json(reject);
      return;
    }
    if (password.length < 6 || password.length > 72) {
      res.status(400).json({ error: 'Password must be 6-72 characters' });
      return;
    }
    if (!allowRate(`reset:${email}`, 6, 900000)) {
      res.status(429).json({ error: 'Too many tries, request a new code' });
      return;
    }
    if (!mac || !isKnownDevice(account, mac)) {
      res.status(403).json({ error: 'Restore only works on a device this wallet has used before. Please see an agent.' });
      return;
    }

    const row = matchAuthCode(account.id, 'reset', String(req.body.code || ''), mac);
    if (!row) {
      res.status(400).json(reject);
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    getDb().prepare(
      `UPDATE wallet_accounts SET password_hash = ?, failed_logins = 0, locked_until = NULL,
         token_epoch = token_epoch + 1, updated_at = datetime('now') WHERE id = ?`
    ).run(hash, account.id);
    consumeAuthCode(row.id);

    // Every other device is signed out; this one keeps going so the customer is
    // not asked for the password they just changed.
    const fresh = findAccountById(account.id);
    console.log(`[wallet] password reset for ${fresh.email} on ${mac}`);
    res.json({ ok: true, token: signClientToken(fresh), account: publicAccount(fresh) });
  } catch (error: any) {
    console.error('Wallet reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Signed-in customer
// ---------------------------------------------------------------------------

router.use(clientAuthMiddleware);

router.get('/me', (req: Request, res: Response) => {
  const account = currentAccount(req);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json({
    account: publicAccount(account),
    verification_required: account.verified !== 1 && getWalletSettings().require_verification,
    rates: walletRates(),
    pending: listOpenTopups(account.id).map((t) => ({
      code: t.code, device_name: t.device_name, coins: t.coins, status: t.status, created_at: t.created_at,
    })),
  });
});

router.get('/transactions', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  const rows = getDb().prepare(
    'SELECT * FROM wallet_transactions WHERE account_id = ? ORDER BY id DESC LIMIT ?'
  ).all(req.wallet!.accountId, limit) as any[];
  res.json({
    transactions: rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: pesos(t.amount_centavos),
      balance: pesos(t.balance_after),
      minutes: t.minutes,
      device_name: t.device_name,
      mac_address: t.mac_address,
      note: t.note,
      created_by: t.created_by,
      created_at: t.created_at,
    })),
  });
});

/**
 * Start a coin top-up. The controller hands the machine a code that only this
 * account knows, so the coins land against a session the server can settle and
 * verify later - the phone never gets to state an amount.
 */
router.post('/topup/start', (req: Request, res: Response) => {
  try {
    if (!requireWalletEnabled(res)) return;
    const account = currentAccount(req);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    if (account.verified !== 1 && getWalletSettings().require_verification) {
      res.status(403).json({ error: 'Confirm your account first, then you can load it' });
      return;
    }
    if (!allowRate(`topup:${account.id}`, 12, 3600000)) {
      res.status(429).json({ error: 'Too many top-up attempts, please ask an agent' });
      return;
    }

    // The machine must be one the panel manages. Never use an address the
    // client typed: it would let a caller make the controller POST to any host.
    const requestedIp = String(req.body.vendoIp || '').trim();
    const requestedId = parseInt(String(req.body.deviceId || ''), 10);
    const device = Number.isFinite(requestedId) && requestedId > 0
      ? findDevice(requestedId)
      : findDeviceByIp(requestedIp);
    if (!device || !device.ip) {
      res.status(400).json({ error: 'This coin machine is not registered on the panel, so wallet loading is unavailable here. Please see an agent.' });
      return;
    }

    const code = makeTopupCode();
    getDb().prepare(
      `INSERT INTO wallet_topup_sessions (code, account_id, device_id, device_ip, device_name, router_id, client_mac)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      code, account.id, device.id, device.ip, device.name,
      parseInt(String(req.body.routerId || '0'), 10) || 0,
      normalizeMac(req.body.mac),
    );

    res.status(201).json({
      code,
      device_ip: device.ip,
      device_name: device.name,
      // The portal shows this so a customer knows how long an unclaimed session
      // stays claimable before the next person takes the machine.
      valid_minutes: getWalletSettings().topup_validity_min,
    });
  } catch (error: any) {
    console.error('Wallet topup start error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Collect the coins of a top-up session into the balance.
 *
 * The controller talks to the machine itself: /useVoucher returns that session's
 * accumulated coin total and clears it, so the number cannot be forged from the
 * phone and the same coins cannot be claimed twice. A crash between "machine
 * settled" and "ledger written" is recovered from the stored coin count instead
 * of asking the machine again (its counter is already gone).
 */
router.post('/topup/claim', async (req: Request, res: Response) => {
  const db = getDb();
  const code = String(req.body.code || '').trim().toUpperCase();
  try {
    const settings = getWalletSettings();
    const session = getTopupByCode(code);
    if (!session || session.account_id !== req.wallet!.accountId) {
      res.status(404).json({ error: 'Unknown top-up session' });
      return;
    }

    // Already credited: hand back the same result so a double tap or a flaky
    // network retry can never pay out twice.
    if (session.status === 'credited') {
      const account = findAccountById(session.account_id);
      const tx = db.prepare('SELECT * FROM wallet_transactions WHERE reference = ?').get(`topup:${code}`) as any;
      res.json({
        ok: true,
        already_claimed: true,
        coins: session.coins,
        amount: pesos(tx?.amount_centavos || 0),
        balance: pesos(account?.balance_centavos || 0),
      });
      return;
    }
    if (session.status === 'failed') {
      res.status(410).json({ error: 'That coin session was closed with no coins. Please start a new one.' });
      return;
    }

    let coins = Number(session.coins) || 0;
    if (session.status !== 'settled') {
      const result = await nodeMcuService.settleCoinSession(session.device_ip, session.code);
      if (result.status === 'unreachable') {
        // Leave the session open: the coins are still inside the machine and the
        // customer can claim again once it answers.
        res.status(502).json({ error: `The coin machine ${session.device_name || session.device_ip} did not answer. Your coins are safe - try again in a moment.` });
        return;
      }
      if (result.status === 'busy') {
        db.prepare("UPDATE wallet_topup_sessions SET status = 'failed', settled_at = datetime('now') WHERE id = ? AND status = 'open'")
          .run(session.id);
        res.status(409).json({ error: 'Another customer is using that machine now, so this session was closed. Please see an agent.' });
        return;
      }
      if (result.status === 'error') {
        res.status(502).json({ error: 'The machine rejected the claim. Please try again or see an agent.' });
        return;
      }
      coins = result.coins;
      if (coins <= 0) {
        db.prepare("UPDATE wallet_topup_sessions SET status = 'failed', coins = 0, settled_at = datetime('now') WHERE id = ?")
          .run(session.id);
        res.status(400).json({ error: 'No coins were inserted in that session' });
        return;
      }
      db.prepare("UPDATE wallet_topup_sessions SET status = 'settled', coins = ?, settled_at = datetime('now') WHERE id = ? AND status = 'open'")
        .run(coins, session.id);
    }

    const amountCentavos = coins * Math.max(1, settings.coin_value_centavos);
    const note = amountCentavos > settings.max_topup_centavos
      ? `Above the configured maximum (${pesos(settings.max_topup_centavos)}) - check machine rates`
      : '';
    const reference = `topup:${code}`;

    let tx: any;
    try {
      tx = db.transaction(() => {
        const row = credit(db, {
          accountId: session.account_id,
          kind: 'coin_topup',
          amountCentavos,
          reference,
          macAddress: session.client_mac,
          deviceId: session.device_id,
          deviceName: session.device_name,
          note,
          createdBy: 'portal',
        });
        db.prepare("UPDATE wallet_topup_sessions SET status = 'credited', tx_id = ? WHERE id = ?")
          .run(row.id, session.id);
        return row;
      })();
    } catch (dupErr: any) {
      // UNIQUE(reference): a concurrent retry already wrote this payout.
      if (String(dupErr.code || '').includes('CONSTRAINT')) {
        const account = findAccountById(session.account_id);
        res.json({
          ok: true,
          already_claimed: true,
          coins,
          amount: pesos(amountCentavos),
          balance: pesos(account?.balance_centavos || 0),
        });
        return;
      }
      throw dupErr;
    }

    // The machine also writes a hotspot user named after this code when it
    // settles coins (that is how it grants time to a normal customer). For a
    // wallet load that account is free internet nobody asked for, so remove it
    // straight away and flag it for the admin page if the router is unreachable.
    db.prepare("UPDATE wallet_topup_sessions SET cleanup_needed = 1 WHERE id = ?").run(session.id);
    const cleanup = await removeMachineUser(session.router_id, session.code);
    if (cleanup.ok) {
      db.prepare("UPDATE wallet_topup_sessions SET cleanup_needed = 0, cleanup_error = '' WHERE id = ?").run(session.id);
    } else {
      db.prepare('UPDATE wallet_topup_sessions SET cleanup_error = ? WHERE id = ?').run(cleanup.error || 'unknown', session.id);
      console.error(`[wallet] credited ${code} but could not remove router user "${session.code}": ${cleanup.error}`);
    }

    const account = findAccountById(session.account_id);
    console.log(`[wallet] ${account.email}: +${pesos(amountCentavos)} from ${coins} coin(s) at ${session.device_name}`);
    res.json({
      ok: true,
      coins,
      amount: pesos(amountCentavos),
      balance: pesos(account?.balance_centavos || 0),
      router_cleanup: cleanup.ok ? 'done' : 'pending',
      cleanup_error: cleanup.ok ? '' : cleanup.error,
    });
  } catch (error: any) {
    console.error('Wallet topup claim error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Claim failed' });
  }
});

/**
 * Spend wallet balance on internet time for the device this account is signed
 * in on. The debit and the time credit commit in ONE transaction: no state
 * where money left the wallet but the minutes did not land on the account.
 */
router.post('/convert', async (req: Request, res: Response) => {
  const db = getDb();
  try {
    if (!requireWalletEnabled(res)) return;
    const account = currentAccount(req);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    if (!allowRate(`convert:${account.id}`, 10, 60000)) {
      res.status(429).json({ error: 'Please wait a moment before the next purchase' });
      return;
    }

    const settings = getWalletSettings();
    const rateId = parseInt(String(req.body.rateId || ''), 10);
    const rate = walletRates().find((r) => r.id === rateId);
    if (!rate) {
      res.status(400).json({ error: 'Choose a valid time package' });
      return;
    }

    const macNoColon = String(req.body.mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(macNoColon)) {
      res.status(400).json({ error: 'This device could not be identified. Reload the portal and try again.' });
      return;
    }
    const routerId = parseInt(String(req.body.routerId || '0'), 10) || 0;
    const routerRow = db.prepare('SELECT id, auth_mode, radius_local_users FROM routers WHERE id = ? AND is_active = 1')
      .get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found or not active' });
      return;
    }

    if (rate.amount_centavos < settings.min_convert_centavos) {
      res.status(400).json({ error: `Smallest convertible package is ${pesos(settings.min_convert_centavos)}` });
      return;
    }
    if (settings.daily_convert_centavos > 0) {
      const spent = spentTodayCentavos(account.id);
      if (spent + rate.amount_centavos > settings.daily_convert_centavos) {
        res.status(400).json({
          error: `Daily limit reached (${pesos(settings.daily_convert_centavos)} per day). ${pesos(settings.daily_convert_centavos - spent)} left today.`,
        });
        return;
      }
    }
    if (!(await verifyPin(account, req.body.pin))) {
      res.status(403).json({ error: 'Wrong wallet PIN' });
      return;
    }

    const reference = `conv_${crypto.randomBytes(8).toString('hex')}`;
    const result = await grantMinutesToMac({
      db,
      routerId,
      macNoColon,
      durationMinutes: rate.minutes,
      authMode: routerRow.auth_mode || 'api',
      hybridLocalUsers: Number(routerRow.radius_local_users) === 1,
      logTag: 'wallet-convert',
      insideTx: (tx: any) => {
        debit(tx, {
          accountId: account.id,
          kind: 'time_purchase',
          amountCentavos: rate.amount_centavos,
          reference,
          minutes: rate.minutes,
          macAddress: normalizeMac(req.body.mac),
          note: rate.label || `${rate.minutes} minutes`,
          createdBy: 'portal',
        });
      },
    });

    const fresh = findAccountById(account.id);
    touchDevice(account.id, normalizeMac(req.body.mac), routerId);
    console.log(`[wallet] ${fresh.email}: -${pesos(rate.amount_centavos)} for ${rate.minutes}min on ${macNoColon}`);
    res.json({
      ok: true,
      minutes: rate.minutes,
      spent: pesos(rate.amount_centavos),
      balance: pesos(fresh.balance_centavos),
      remainingSeconds: result.remainingSeconds,
      username: result.accountUsername,
    });
  } catch (error: any) {
    console.error('Wallet convert error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Purchase failed' });
  }
});

router.post('/password', async (req: Request, res: Response) => {
  try {
    const account = currentAccount(req);
    const ok = await bcrypt.compare(String(req.body.current || ''), account.password_hash);
    if (!ok) {
      res.status(403).json({ error: 'Current password is wrong' });
      return;
    }
    const next = String(req.body.next || '');
    if (next.length < 6 || next.length > 72) {
      res.status(400).json({ error: 'New password must be 6-72 characters' });
      return;
    }
    const hash = await bcrypt.hash(next, 10);
    getDb().prepare(
      "UPDATE wallet_accounts SET password_hash = ?, token_epoch = token_epoch + 1, updated_at = datetime('now') WHERE id = ?"
    ).run(hash, account.id);
    const fresh = findAccountById(account.id);
    // Other devices are logged out by the epoch bump; this one keeps working.
    res.json({ ok: true, token: signClientToken(fresh), account: publicAccount(fresh) });
  } catch (error: any) {
    console.error('Wallet password error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/pin', async (req: Request, res: Response) => {
  try {
    const account = currentAccount(req);
    const pin = String(req.body.pin || '');
    if (pin && !/^\d{4}$/.test(pin)) {
      res.status(400).json({ error: 'Wallet PIN must be exactly 4 digits' });
      return;
    }
    // The PIN is what authorizes spending, so changing it takes the password -
    // a borrowed/unlocked device token alone must not be able to set a new PIN
    // and then buy time with it.
    const ok = await bcrypt.compare(String(req.body.current || ''), account.password_hash);
    if (!ok) {
      res.status(403).json({ error: 'Password is wrong' });
      return;
    }
    const hash = pin ? await bcrypt.hash(pin, 10) : '';
    getDb().prepare("UPDATE wallet_accounts SET pin_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, account.id);
    res.json({ ok: true, has_pin: !!pin });
  } catch (error: any) {
    console.error('Wallet pin error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Admin (the `admin` router itself is declared above, next to its mount)
// ---------------------------------------------------------------------------

/** Remove the hotspot user a coin machine created for a wallet code. */
async function removeMachineUser(routerId: number, name: string): Promise<{ ok: boolean; error?: string }> {
  if (!routerId) return { ok: false, error: 'no router recorded for this session' };
  if (!mikroTikService.isConnected(routerId)) return { ok: false, error: 'router not connected' };
  try {
    const users = await mikroTikService.getHotspotUsers(routerId);
    const hit = (Array.isArray(users) ? users : []).find((u: any) => String(u.name || '').toUpperCase() === String(name).toUpperCase());
    // Nothing there means the machine never wrote it, or an earlier purge
    // already removed it. Either way the job is done.
    if (!hit || !hit['.id']) return { ok: true };
    await mikroTikService.removeHotspotUser(routerId, hit['.id']);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

admin.get('/accounts', (req: Request, res: Response) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
  let sql = `
    SELECT id, email, full_name, mobile, balance_centavos, status, verified, created_at, last_login_at,
           registered_mac, last_mac,
           (SELECT COUNT(*) FROM wallet_transactions t WHERE t.account_id = wallet_accounts.id) AS tx_count
    FROM wallet_accounts`;
  const params: any[] = [];
  if (search) {
    sql += ' WHERE LOWER(email) LIKE ? OR LOWER(full_name) LIKE ? OR mobile LIKE ? OR last_mac LIKE ?';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY balance_centavos DESC, id DESC LIMIT ?';
  params.push(limit);

  const rows = getDb().prepare(sql).all(...params) as any[];
  res.json({
    accounts: rows.map((a) => ({ ...a, balance: pesos(a.balance_centavos), balance_centavos: undefined })),
  });
});

admin.get('/accounts/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const account = findAccountById(id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const transactions = (db.prepare(
    'SELECT * FROM wallet_transactions WHERE account_id = ? ORDER BY id DESC LIMIT 200'
  ).all(id) as any[]).map((t) => ({ ...t, amount: pesos(t.amount_centavos), balance: pesos(t.balance_after) }));
  const devices = db.prepare(
    'SELECT mac, router_id, first_seen, last_seen FROM wallet_devices WHERE account_id = ? ORDER BY last_seen DESC'
  ).all(id);
  const topups = db.prepare(
    'SELECT id, code, device_name, device_ip, coins, status, cleanup_needed, cleanup_error, created_at, settled_at FROM wallet_topup_sessions WHERE account_id = ? ORDER BY id DESC LIMIT 30'
  ).all(id);
  const openCode = db.prepare(
    `SELECT id, purpose, device_mac, expires_at, created_at FROM wallet_auth_codes
     WHERE account_id = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
  ).get(id);

  res.json({
    account: { ...publicAccount(account), registered_mac: account.registered_mac, last_mac: account.last_mac },
    transactions,
    devices,
    topups,
    open_code: openCode || null,
  });
});

/** Staff correction. A reason is mandatory - unlabeled money moves are unauditable. */
admin.post('/accounts/:id/adjust', (req: Request, res: Response) => {
  const db = getDb();
  try {
    const id = parseInt(req.params.id, 10);
    const account = findAccountById(id);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    const action = String(req.body.action || '');
    if (action !== 'credit' && action !== 'debit') {
      res.status(400).json({ error: 'action must be credit or debit' });
      return;
    }
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) {
      res.status(400).json({ error: 'A reason is required (at least 3 characters)' });
      return;
    }
    const centavos = pesosToCentavos(req.body.amount);
    if (!centavos) {
      res.status(400).json({ error: 'Enter an amount greater than 0' });
      return;
    }
    const reference = `adm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const actor = String(req.user?.username || 'admin');

    const row = db.transaction(() => {
      const args = {
        accountId: id,
        kind: action === 'credit' ? 'admin_credit' : 'admin_debit',
        amountCentavos: centavos,
        reference,
        note: reason.slice(0, 300),
        createdBy: actor,
      };
      return action === 'credit' ? credit(db, args) : debit(db, args);
    })();

    const fresh = findAccountById(id);
    console.log(`[wallet] ${actor} ${action}ed ${pesos(centavos)} on ${fresh.email}: ${reason}`);
    res.json({ ok: true, balance: pesos(fresh.balance_centavos), transaction_id: row.id });
  } catch (error: any) {
    console.error('Wallet adjust error:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

admin.post('/accounts/:id/status', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body.status || '');
  if (status !== 'active' && status !== 'frozen') {
    res.status(400).json({ error: 'status must be active or frozen' });
    return;
  }
  const account = findAccountById(id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  getDb().prepare("UPDATE wallet_accounts SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  // Freezing must also stop the token the customer is holding right now.
  if (status === 'frozen') revokeWalletSessions(id);
  res.json({ ok: true, status });
});

/** Set a known password so an agent can get a customer back in at the counter. */
admin.post('/accounts/:id/password', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const account = findAccountById(id);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const password = String(req.body.password || '').trim()
      || Array.from({ length: 8 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
    if (password.length < 6 || password.length > 72) {
      res.status(400).json({ error: 'Password must be 6-72 characters' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    getDb().prepare(
      `UPDATE wallet_accounts SET password_hash = ?, failed_logins = 0, locked_until = NULL,
         token_epoch = token_epoch + 1, updated_at = datetime('now') WHERE id = ?`
    ).run(hash, id);
    getDb().prepare("UPDATE wallet_auth_codes SET used_at = datetime('now') WHERE account_id = ? AND used_at IS NULL").run(id);
    console.log(`[wallet] ${req.user?.username || 'admin'} reset the password of ${account.email}`);
    // The temporary password is shown once, for the agent to hand over.
    res.json({ ok: true, temporary_password: password });
  } catch (error: any) {
    console.error('Wallet admin password error:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

admin.get('/summary', (_req: Request, res: Response) => {
  const db = getDb();
  const totals = db.prepare(
    `SELECT COUNT(*) AS accounts, COALESCE(SUM(balance_centavos), 0) AS balance FROM wallet_accounts`
  ).get() as any;
  const moved = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN amount_centavos > 0 THEN amount_centavos ELSE 0 END), 0) AS in_centavos,
       COALESCE(SUM(CASE WHEN amount_centavos < 0 THEN -amount_centavos ELSE 0 END), 0) AS out_centavos,
       COALESCE(SUM(CASE WHEN kind = 'time_purchase' THEN minutes ELSE 0 END), 0) AS minutes_sold
     FROM wallet_transactions WHERE date(created_at) = date('now')`
  ).get() as any;
  const pending = db.prepare(
    "SELECT COUNT(*) AS n FROM wallet_topup_sessions WHERE status = 'credited' AND cleanup_needed = 1"
  ).get() as any;
  res.json({
    accounts: Number(totals?.accounts || 0),
    total_balance: pesos(totals?.balance || 0),
    credited_today: pesos(moved?.in_centavos || 0),
    spent_today: pesos(moved?.out_centavos || 0),
    minutes_sold_today: Number(moved?.minutes_sold || 0),
    router_cleanup_pending: Number(pending?.n || 0),
  });
});

/** Credited loads whose router account could not be removed yet. */
admin.get('/topups', (req: Request, res: Response) => {
  const db = getDb();
  const onlyCleanup = String(req.query.cleanup || '') === '1';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
  const sql = `
    SELECT s.id, s.code, s.account_id, a.email, s.device_id, s.device_name, s.device_ip, s.router_id,
           s.client_mac, s.coins, s.status, s.cleanup_needed, s.cleanup_error, s.created_at, s.settled_at
    FROM wallet_topup_sessions s
    LEFT JOIN wallet_accounts a ON a.id = s.account_id
    ${onlyCleanup ? "WHERE s.status = 'credited' AND s.cleanup_needed = 1" : ''}
    ORDER BY s.id DESC LIMIT ?`;
  res.json({ topups: db.prepare(sql).all(limit) });
});

admin.post('/topups/:id/cleanup', async (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const session = db.prepare('SELECT * FROM wallet_topup_sessions WHERE id = ?').get(id) as any;
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const result = await removeMachineUser(session.router_id, session.code);
  if (result.ok) {
    db.prepare("UPDATE wallet_topup_sessions SET cleanup_needed = 0, cleanup_error = '' WHERE id = ?").run(id);
  } else {
    db.prepare('UPDATE wallet_topup_sessions SET cleanup_error = ? WHERE id = ?').run(result.error || 'unknown', id);
  }
  res.json({ ok: result.ok, error: result.error || '' });
});

admin.get('/settings', (_req: Request, res: Response) => {
  const s = getWalletSettings();
  res.json({
    ...s,
    min_topup: pesos(s.min_topup_centavos),
    max_topup: pesos(s.max_topup_centavos),
    min_convert: pesos(s.min_convert_centavos),
    daily_convert: pesos(s.daily_convert_centavos),
    coin_value: pesos(s.coin_value_centavos),
  });
});

admin.put('/settings', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const patch: any = {
      enabled: body.enabled,
      require_verification: body.require_verification,
    };
    // The browser sends pesos; store centavos.
    const fromPesos: Record<string, string> = {
      coin_value_centavos: 'coin_value',
      min_topup_centavos: 'min_topup',
      max_topup_centavos: 'max_topup',
      min_convert_centavos: 'min_convert',
      daily_convert_centavos: 'daily_convert',
    };
    for (const [column, field] of Object.entries(fromPesos)) {
      if (body[field] !== undefined) {
        const n = Number(body[field]);
        if (!Number.isFinite(n) || n < 0) {
          res.status(400).json({ error: `${field} must be a number` });
          return;
        }
        patch[column] = Math.round(n * PESO);
      }
    }
    if (body.topup_validity_min !== undefined) patch.topup_validity_min = body.topup_validity_min;

    const saved = saveWalletSettings(patch);
    res.json({
      ...saved,
      min_topup: pesos(saved.min_topup_centavos),
      max_topup: pesos(saved.max_topup_centavos),
      min_convert: pesos(saved.min_convert_centavos),
      daily_convert: pesos(saved.daily_convert_centavos),
      coin_value: pesos(saved.coin_value_centavos),
    });
  } catch (error: any) {
    console.error('Wallet settings error:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;
