import { getDb } from '../database';
import { findDevice } from './deviceRegistry';
import { getSettings, planCoinAllocation, recordRedeem } from './aircoins';
import { creditMacAccount, bindMacToken, propagateTimeToRouter } from './timeCredit';
import { mikroTikService } from './mikrotik';
import {
  AirCoinsSession, livePulses, previewSession, recordSettled,
} from './aircoinsSession';

/*
 * Turning a vendo's coins into time on a PC. Two callers reach this: the board
 * itself when it sells a bank on its own, and a portal coin session when the
 * customer presses SAVE. Both must credit through the same path as a coin
 * dropped at a JuanFi machine - bind the MAC, stack onto what is left, and push
 * the new expiry to the router - or the session would hand out time that the
 * router never learns about.
 */

export type AirCoinsSaleStatus = 'ok' | 'no-rate' | 'no-router' | 'unassigned' | 'error';

export interface AirCoinsSaleResult {
  status: AirCoinsSaleStatus;
  coins: number;
  minutes: number;
  spent: number;
  leftover: number;
  applied: string[];
  username: string;
  expiryAt: string;
  remainingSeconds: number;
  error?: string;
}

/** The router a vendo belongs to, preferring the one it is registered against. */
function vendoRouterId(preferred: number): number {
  const rows = getDb().prepare('SELECT id FROM routers WHERE is_active = 1 ORDER BY id').all() as any[];
  const ids = rows.map((row) => Number(row.id));
  const wanted = Number(preferred) || 0;
  if (wanted > 0) {
    if (mikroTikService.isConnected(wanted)) return wanted;
    if (ids.includes(wanted)) return wanted;
  }
  return ids.find((id) => mikroTikService.isConnected(id)) || wanted;
}

/**
 * Writes one row per sale attempt, successful or not. The coins left the
 * customer's pocket either way, so the shop has to be able to see them - a
 * failed credit is a sale to sort out, not a sale that never happened.
 */
function recordSale(opts: {
  deviceId: number;
  routerId?: number;
  mac?: string;
  coins: number;
  minutes?: number;
  status: AirCoinsSaleStatus;
  error?: string;
  /** Coin slot this batch belongs to; empty when the board sold alone. */
  sessionId?: string;
  /** That slot's running totals up to and including this row. */
  batchCoins?: number;
  batchMinutes?: number;
}): number {
  const coins = Math.max(0, Math.floor(Number(opts.coins) || 0));
  try {
    // A credit that has to be retried - no rate covers the amount, the router is
    // down - is the same coins coming back on the next poll. Logging it again
    // every couple of seconds would bury the real sales, so one row per attempt
    // window is enough for the operator to see it.
    if (opts.status === 'no-rate' || opts.status === 'error') {
      const seen = getDb().prepare(
        `SELECT id FROM aircoins_sales
          WHERE device_id = ? AND coins = ? AND status = ?
            AND created_at >= datetime('now', '-15 minutes')
          ORDER BY id DESC LIMIT 1`
      ).get(opts.deviceId, coins, opts.status) as any;
      if (seen) return Number(seen.id) || 0;
    }

    const result = getDb().prepare(
      `INSERT INTO aircoins_sales
         (device_id, router_id, mac, coins, minutes, status, error,
          session_id, batch_coins, batch_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.deviceId,
      Number(opts.routerId) || 0,
      String(opts.mac || ''),
      coins,
      Math.max(0, Math.floor(Number(opts.minutes) || 0)),
      opts.status,
      String(opts.error || '').slice(0, 200),
      String(opts.sessionId || ''),
      Math.max(0, Math.floor(Number(opts.batchCoins) || 0)),
      Math.max(0, Math.floor(Number(opts.batchMinutes) || 0)),
    );
    return Number(result.lastInsertRowid) || 0;
  } catch (error: any) {
    // A bookkeeping failure must never lose the sale itself.
    console.error('AirCoins sale log failed:', error.message);
    return 0;
  }
}

/**
 * Coins taken with no PC to credit: no fixed sale target on the box and no
 * MAC from the board. Recorded as revenue so the machine keeps selling and the
 * operator can see what came in, instead of the box refusing the bank forever.
 */
export function recordUnassignedSale(deviceId: number, coins: number, reason = 'No PC was open to credit'): number {
  recordRedeem(deviceId, coins, 0, reason);
  return recordSale({ deviceId, coins, minutes: 0, status: 'unassigned', error: reason });
}

export async function creditAirCoinsSale(
  deviceId: number,
  macNoColon: string,
  coins: number,
): Promise<AirCoinsSaleResult> {
  const settings = getSettings(deviceId);
  const plan = planCoinAllocation(settings.rates, coins);
  if (plan.minutes <= 0) {
    const base: AirCoinsSaleResult = {
      status: 'no-rate',
      coins,
      minutes: 0,
      spent: plan.spent,
      leftover: plan.leftover,
      applied: [],
      username: '',
      expiryAt: '',
      remainingSeconds: 0,
    };
    recordRedeem(deviceId, coins, 0, 'No rate covers this amount');
    recordSale({ deviceId, mac: macNoColon, coins, minutes: 0, status: 'no-rate', error: 'No rate covers this amount' });
    return base;
  }
  return creditAirCoinsTime(deviceId, macNoColon, {
    coins,
    minutes: plan.minutes,
    spent: plan.spent,
    leftover: plan.leftover,
    applied: plan.applied.map((rate) => rate.name),
  });
}

/**
 * Credits time that has already been priced. The coin slot prices the whole
 * bank the customer has fed - like JuanFi's calculateAddTime() over totalCoin -
 * and pays only the difference, so this is where a top-up in the middle of a
 * session lands.
 */
export async function creditAirCoinsTime(
  deviceId: number,
  macNoColon: string,
  credit: {
    coins: number; minutes: number; spent?: number; leftover?: number; applied?: string[];
    /** Coin slot the coins came from, so the ledger can group a feed's batches. */
    sessionId?: string;
    /** That slot's totals once this batch is paid, for the operator to check. */
    batchCoins?: number;
    batchMinutes?: number;
  },
): Promise<AirCoinsSaleResult> {
  const coins = Math.max(0, Math.floor(Number(credit.coins) || 0));
  const sessionId = String(credit.sessionId || '');
  const batchCoins = Math.max(0, Math.floor(Number(credit.batchCoins) || 0));
  const batchMinutes = Math.max(0, Math.floor(Number(credit.batchMinutes) || 0));
  const base: AirCoinsSaleResult = {
    status: 'ok',
    coins,
    minutes: Math.max(0, Math.floor(Number(credit.minutes) || 0)),
    spent: Math.max(0, Math.floor(Number(credit.spent) || coins)),
    leftover: Math.max(0, Math.floor(Number(credit.leftover) || 0)),
    applied: Array.isArray(credit.applied) ? credit.applied : [],
    username: '',
    expiryAt: '',
    remainingSeconds: 0,
  };
  if (base.minutes <= 0) return { ...base, status: 'no-rate' };

  const device = findDevice(deviceId);
  if (!device) {
    recordRedeem(deviceId, coins, 0, 'Device not found');
    recordSale({ deviceId, mac: macNoColon, coins, minutes: 0, status: 'error', error: 'Device not found', sessionId });
    return { ...base, status: 'error', error: 'Device not found' };
  }

  const routerId = vendoRouterId(device.routerId || 0);
  const db = getDb();
  const routerRow = db.prepare(
    'SELECT id, auth_mode, radius_local_users FROM routers WHERE id = ? AND is_active = 1'
  ).get(routerId) as any;
  if (!routerRow) {
    recordRedeem(deviceId, coins, 0, 'Router not found or inactive');
    recordSale({ deviceId, routerId, mac: macNoColon, coins, minutes: 0, status: 'no-router', error: 'Router not found or inactive', sessionId });
    return { ...base, status: 'no-router', error: 'Router not found or inactive' };
  }

  try {
    const authMode = routerRow.auth_mode || 'api';
    const hybridLocalUsers = Number(routerRow.radius_local_users) === 1;
    const { expiryAt, hadRemaining, accountUsername } = db.transaction(() =>
      creditMacAccount(db, routerId, macNoColon, base.minutes, authMode))();

    bindMacToken(routerId, macNoColon, accountUsername, expiryAt);
    await propagateTimeToRouter({
      db, routerId, macNoColon, authMode, hybridLocalUsers,
      isExtend: hadRemaining, expiryAt, hadRemaining, accountUsername,
      logTag: 'aircoins',
    });

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(expiryAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)
    );
    recordRedeem(deviceId, coins, base.minutes);
    recordSale({
      deviceId, routerId, mac: macNoColon, coins, minutes: base.minutes, status: 'ok',
      sessionId, batchCoins, batchMinutes,
    });
    console.log(`aircoins: vendo ${deviceId} took ${coins} -> ${base.minutes}min for ${macNoColon} (router ${routerId})`);
    return {
      ...base,
      status: 'ok',
      username: accountUsername,
      expiryAt,
      remainingSeconds,
    };
  } catch (error: any) {
    recordRedeem(deviceId, coins, 0, error.message);
    recordSale({ deviceId, routerId, mac: macNoColon, coins, minutes: 0, status: 'error', error: error.message, sessionId });
    console.error('AirCoins redeem error:', error);
    return { ...base, status: 'error', error: error.message };
  }
}

export interface AirCoinsSessionCredit {
  /** Pulses taken since the last settlement, i.e. what this call priced. */
  pulses: number;
  coins: number;
  minutes: number;
  leftover: number;
  result: AirCoinsSaleResult | null;
}

/** Sessions currently being priced, so two polls cannot pay the same coins. */
const settling = new Set<string>();

/**
 * Prices whatever the machine has taken for this slot and credits it. This is
 * JuanFi's `checkCoin`: every batch of coins is money the moment it lands, so it
 * is committed as soon as the session is polled - not held back until somebody
 * presses SAVE.
 *
 * The price is computed over the WHOLE bank, exactly like the vendo's own
 * calculateAddTime() over totalCoin, and only the difference is credited. Rates
 * are a ladder - 1 peso/10min, 5/1h, 10/2h - so pricing each pulse on its own
 * would hand out ten times the smallest rate for a 10-peso feed and never reach
 * the 2-hour one the operator set.
 *
 * The amount paid is remembered on the session, so polling twice cannot pay
 * twice, and a batch that no rate can cover is left for the next poll rather
 * than swallowed.
 */
export async function settleAirCoinsSession(
  deviceId: number,
  session: AirCoinsSession,
): Promise<AirCoinsSessionCredit> {
  const reported = livePulses(deviceId, session.id);
  const pulses = Math.max(0, reported - session.settledPulses);
  if (!reported) {
    return { pulses, coins: 0, minutes: 0, leftover: 0, result: null };
  }

  // Two callers reach this at once - the phone polling and the board's own
  // heartbeat - and both read the same stored session.
  if (settling.has(session.id)) {
    return { pulses, coins: 0, minutes: 0, leftover: 0, result: null };
  }
  settling.add(session.id);
  try {
    const total = previewSession(deviceId, reported);
    const paidSeconds = Math.max(0, Math.floor(session.settledSeconds || 0));
    const paidCoins = Math.max(0, Math.floor(session.coins || 0));
    const paidMinutes = Math.round(paidSeconds / 60);
    const minutes = Math.max(0, total.minutes - paidMinutes);
    const coins = Math.max(0, total.coins - paidCoins);

    if (coins <= 0 || minutes <= 0) {
      return { pulses, coins: 0, minutes: 0, leftover: total.leftover, result: null };
    }

    const result = await creditAirCoinsTime(deviceId, session.mac, {
      coins,
      minutes,
      spent: Math.max(0, total.coins - total.leftover),
      leftover: total.leftover,
      applied: total.applied,
      // The row shows the difference, these show what the whole feed came to:
      // a small batch stepping onto a bigger rate tier is the one row that
      // looks like a duplicate credit but is not.
      sessionId: session.id,
      batchCoins: paidCoins + coins,
      batchMinutes: paidMinutes + minutes,
    });
    if (result.status === 'ok') {
      // Only a batch that went through moves the watermark: a failed credit has to
      // stay unpaid so the customer's coins are still worth something next poll.
      recordSettled(session.id, reported, paidSeconds + minutes * 60, {
        coins: paidCoins + coins,
        minutes: paidMinutes + minutes,
      });
    }
    return { pulses, coins, minutes, leftover: total.leftover, result };
  } finally {
    settling.delete(session.id);
  }
}
