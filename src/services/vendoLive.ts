import { getDb } from '../database';
import { findDevice } from './deviceRegistry';
import {
  findSession, livePulses, previewSession, sessionIsLive, sessionRemainingMs, sessionTxnId,
} from './aircoinsSession';
import { vendoCandidates } from './vendoRoster';
import { vendoServesClient } from './vendoAutoSelect';
import { SHOP_SQL_SHIFT, shopToday } from './shopTime';

/*
 * The live numbers for one coin machine.
 *
 * The board only reports what it can see from its own side - uptime, firmware,
 * pulse counters - and knows nothing about who is paying or who is online: on
 * an AirCoins box the panel holds every session, so the panel is also the only
 * place that can say how many customers are connected right now, how much this
 * slot has taken in pesos, and which transaction is open on it.
 *
 * "Connected" is the machine's own network, not the whole router: the same rule
 * the portal uses to decide which slot a phone may feed (its own /24 plus the
 * subnets declared on the device). A shop on VLAN 2001 therefore sees only the
 * customers standing in front of its coin slot.
 */

export interface VendoLiveSale {
  coins: number;
  minutes: number;
  mac: string;
  txnId: string;
  at: string;
}

export interface VendoLiveSummary {
  /** Pesos this slot has taken, all time and on the shop day. */
  coinsTotal: number;
  coinsToday: number;
  /** Transactions (one feed each), all time and today. */
  sales: number;
  salesToday: number;
  /** Minutes credited by those coins, all time and today. */
  minutesTotal: number;
  minutesToday: number;
  /** Devices online on this machine's network right now. */
  customersLive: number;
  /** Distinct devices that paid today - who actually dropped a coin. */
  customersToday: number;
  lastSale: VendoLiveSale | null;
  /** The slot being fed right now, if any. */
  slot: { txnId: string; coins: number; remainMs: number } | null;
}

const ledgerTotals = (deviceId: number, today: string, dayFilter: boolean) => {
  const day = dayFilter ? ` AND date(created_at, '${SHOP_SQL_SHIFT}') = ?` : '';
  const params: any[] = dayFilter ? [deviceId, today] : [deviceId];
  return getDb().prepare(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('ok', 'unassigned') THEN coins ELSE 0 END), 0) AS coins,
            COALESCE(SUM(CASE WHEN status IN ('ok', 'unassigned') THEN 1 ELSE 0 END), 0) AS sales,
            COALESCE(SUM(CASE WHEN status = 'ok' THEN minutes ELSE 0 END), 0) AS minutes,
            COUNT(DISTINCT CASE WHEN status IN ('ok', 'unassigned') AND mac <> '' THEN mac END) AS customers
       FROM aircoins_sales WHERE device_id = ?${day}`
  ).get(...params) as any;
};

/** Devices online on the networks this machine serves. */
function customersOnline(deviceId: number, routerId: number, deviceIp: string, deviceMac: string): number {
  if (!routerId) return 0;
  const value = `aircoins:${deviceId}`;
  const candidates = vendoCandidates();
  const key = (mac: any) => String(mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  const selfMac = key(deviceMac);
  const rows = getDb().prepare(
    "SELECT ip_address, mac_address FROM active_devices WHERE router_id = ? AND status = 'active'"
  ).all(routerId) as any[];
  return rows.filter((row) => {
    const ip = String(row.ip_address || '').trim();
    // The coin box is on that same network, and it is not a customer.
    if (ip === '' || ip === deviceIp) return false;
    if (selfMac && key(row.mac_address) === selfMac) return false;
    return vendoServesClient(ip, routerId, candidates, value, deviceIp);
  }).length;
}

export function vendoLiveSummary(deviceId: number): VendoLiveSummary {
  const device = findDevice(deviceId);
  const routerId = Number(device?.routerId) || 0;
  const deviceIp = String(device?.ip || '').trim();
  const deviceMac = String(device?.mac || '').trim();
  const today = shopToday();

  const all = ledgerTotals(deviceId, today, false);
  const day = ledgerTotals(deviceId, today, true);

  const last = getDb().prepare(
    `SELECT coins, minutes, mac, txn_id, created_at FROM aircoins_sales
      WHERE device_id = ? AND status IN ('ok', 'unassigned')
      ORDER BY created_at DESC, id DESC LIMIT 1`
  ).get(deviceId) as any;

  let slot: VendoLiveSummary['slot'] = null;
  const session = findSession(deviceId);
  if (sessionIsLive(session)) {
    const pulses = Math.max(Number(session!.settledPulses) || 0, livePulses(deviceId, session!.id));
    // previewSession prices the bank the way a sale does, so the figure on the
    // card is the pesos these coins are worth - not a pulse count.
    const preview = previewSession(deviceId, pulses);
    slot = {
      txnId: sessionTxnId(session!),
      coins: preview.coins,
      remainMs: sessionRemainingMs(session),
    };
  }

  return {
    coinsTotal: Number(all.coins) || 0,
    coinsToday: Number(day.coins) || 0,
    sales: Number(all.sales) || 0,
    salesToday: Number(day.sales) || 0,
    minutesTotal: Number(all.minutes) || 0,
    minutesToday: Number(day.minutes) || 0,
    customersLive: customersOnline(deviceId, routerId, deviceIp, deviceMac),
    customersToday: Number(day.customers) || 0,
    lastSale: last ? {
      coins: Number(last.coins) || 0,
      minutes: Number(last.minutes) || 0,
      mac: String(last.mac || ''),
      txnId: String(last.txn_id || ''),
      at: String(last.created_at || ''),
    } : null,
    slot,
  };
}
