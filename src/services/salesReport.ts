import fs from 'fs';
import path from 'path';
import { getDb } from '../database';
import { nodeMcuService, NodeMcuDevice } from './nodemcu';
import { firmwareTypeOf } from './deviceRegistry';
import { getSettings, getStatus, statusIsOnline } from './aircoins';

// Sales report aggregation across the three revenue sources:
//  - Sub-vendo / NodeMCU coin sales (device-side lifetime counters)
//  - AirCoins sub-vendo coin sales (per-sale ledger, so they date-filter)
//  - Redeemed vouchers (price recorded at generation)
//  - Paid GCash / PayMongo online payments
//
// Voucher, payment and AirCoins rows are date-filterable (UTC, matching
// datetime('now')). NodeMCU counters are cumulative on the device itself, so
// they are reported as lifetime / since-reset totals and cannot be filtered.

export interface AirCoinsSaleRow {
  id: number;
  deviceId: number;
  deviceName: string;
  mac: string;
  coins: number;
  minutes: number;
  status: string;
  error: string;
  createdAt: string;
}

/** Panel-recorded coin sales for one machine (the `aircoins_sales` ledger). */
export interface VendoLedgerTotals {
  sales: number;
  coins: number;
  minutes: number;
  customers: number;
}

export interface VendoSalesRow {
  id: number;
  name: string;
  ip: string;
  firmware: 'aircoins' | 'juanfi';
  online: boolean;
  lifetimeCoins: number;
  currentCoins: number;
  customerCount: number;
  /** Sales recorded by the panel inside the report range. */
  range: VendoLedgerTotals;
  /** Sales recorded by the panel since the ledger began. */
  ledger: VendoLedgerTotals;
  error?: string;
}

export interface SalesReport {
  from: string;
  to: string;
  vouchers: {
    count: number;
    amount: number;
    generatedCount: number;
    generatedAmount: number;
    rows: any[];
  };
  gcash: {
    count: number;
    amount: number;
    rows: any[];
  };
  aircoins: {
    count: number;
    amount: number;
    minutes: number;
    unassignedCount: number;
    unassignedAmount: number;
    failedCount: number;
    rows: AirCoinsSaleRow[];
  };
  vendo: {
    deviceCount: number;
    onlineCount: number;
    lifetimeCoins: number;
    currentCoins: number;
    customerCount: number;
    rangeCoins: number;
    rangeMinutes: number;
    rangeSales: number;
    devices: VendoSalesRow[];
  };
  totals: {
    voucherSales: number;
    gcashSales: number;
    aircoinsSales: number;
    periodTotal: number;
    vendoLifetimeCoins: number;
    vendoCurrentCoins: number;
  };
}

const DEVICES_FILE = path.join(__dirname, '..', '..', 'data', 'nodemcu-devices.json');

export function loadVendoDevices(): NodeMcuDevice[] {
  try {
    const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isDateStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Normalize the requested range; defaults to today (UTC). Swaps reversed bounds. */
export function normalizeRange(from?: string, to?: string): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  let f = isDateStr(from) ? from : today;
  let t = isDateStr(to) ? to : today;
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

const emptyLedger = (): VendoLedgerTotals => ({ sales: 0, coins: 0, minutes: 0, customers: 0 });

/** Fetch coin counters from every sub-vendo in parallel; offline devices are
 *  reported with online=false instead of failing the whole report. The ledger
 *  maps carry the panel-side sales, so each row can show its own revenue even
 *  when the board keeps no counters of its own. */
export async function fetchVendoSales(
  devices: NodeMcuDevice[],
  rangeLedger: Map<number, VendoLedgerTotals> = new Map(),
  allLedger: Map<number, VendoLedgerTotals> = new Map(),
): Promise<SalesReport['vendo']> {
  const rows: VendoSalesRow[] = await Promise.all(
    devices.map(async (d): Promise<VendoSalesRow> => {
      const firmware = firmwareTypeOf(d);
      const base = {
        id: d.id,
        name: d.name,
        ip: d.ip,
        firmware,
        range: rangeLedger.get(Number(d.id)) || emptyLedger(),
        ledger: allLedger.get(Number(d.id)) || emptyLedger(),
      };
      // An AirCoins box serves no page, so its counters come from the reports it
      // already sends - otherwise every one of them would show up as offline.
      if (firmware === 'aircoins') {
        const status = getStatus(Number(d.id));
        const online = statusIsOnline(status, getSettings(Number(d.id)).pollSeconds);
        // A box that never kept its own counters still has the panel ledger, so
        // the lifetime figures are whichever of the two is further along.
        return {
          ...base,
          online,
          lifetimeCoins: Math.max(Number(status?.coins) || 0, base.ledger.coins),
          currentCoins: status ? Number(status.bank) || 0 : 0,
          customerCount: Math.max(Number(status?.customers) || 0, base.ledger.customers),
          error: online ? undefined : 'not reporting yet',
        };
      }
      try {
        const dash = await nodeMcuService.getDashboard(d);
        return {
          ...base,
          online: true,
          lifetimeCoins: Number(dash.lifetimeCoins) || 0,
          currentCoins: Number(dash.currentCoins) || 0,
          customerCount: Number(dash.customerCount) || 0,
        };
      } catch (err: any) {
        return { ...base, online: false, lifetimeCoins: 0, currentCoins: 0, customerCount: 0, error: err?.message || 'unreachable' };
      }
    })
  );

  return {
    deviceCount: rows.length,
    onlineCount: rows.filter((r) => r.online).length,
    lifetimeCoins: rows.reduce((s, r) => s + r.lifetimeCoins, 0),
    currentCoins: rows.filter((r) => r.online).reduce((s, r) => s + r.currentCoins, 0),
    customerCount: rows.reduce((s, r) => s + r.customerCount, 0),
    rangeCoins: rows.reduce((s, r) => s + r.range.coins, 0),
    rangeMinutes: rows.reduce((s, r) => s + r.range.minutes, 0),
    rangeSales: rows.reduce((s, r) => s + r.range.sales, 0),
    devices: rows,
  };
}

export async function buildSalesReport(
  opts: { from?: string; to?: string; limit?: number } = {},
  vendoDevices?: NodeMcuDevice[]
): Promise<SalesReport> {
  const { from, to } = normalizeRange(opts.from, opts.to);
  const limit = Math.min(Math.max(parseInt(String(opts.limit ?? 1000), 10) || 1000, 1), 5000);
  const db = getDb();

  // Redeemed vouchers inside the range = realized voucher sales.
  const vAgg = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS amount
     FROM vouchers WHERE is_used = 1 AND date(used_at) BETWEEN ? AND ?`
  ).get(from, to) as any;
  const vRows = db.prepare(
    `SELECT v.id, v.code, v.username, v.profile, v.price, v.duration_minutes, v.used_at,
            v.router_id, r.name AS router_name
     FROM vouchers v LEFT JOIN routers r ON r.id = v.router_id
     WHERE v.is_used = 1 AND date(v.used_at) BETWEEN ? AND ?
     ORDER BY v.used_at DESC, v.id DESC LIMIT ?`
  ).all(from, to, limit) as any[];
  const vGen = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS amount
     FROM vouchers WHERE date(created_at) BETWEEN ? AND ?`
  ).get(from, to) as any;

  // Paid online payments inside the range = realized GCash sales.
  const pAgg = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount
     FROM payments WHERE status = 'paid' AND date(paid_at) BETWEEN ? AND ?`
  ).get(from, to) as any;
  const pRows = db.prepare(
    `SELECT id, reference, provider, mac_address, amount, minutes, paid_at, created_at
     FROM payments WHERE status = 'paid' AND date(paid_at) BETWEEN ? AND ?
     ORDER BY paid_at DESC, id DESC LIMIT ?`
  ).all(from, to, limit) as any[];

  // The same ledger, grouped per machine: this is what lets the device table
  // show each vendo's own takings instead of the board-side counters, which an
  // AirCoins box never maintained.
  const ledgerColumns = `
    SELECT device_id,
           SUM(CASE WHEN status IN ('ok', 'unassigned') THEN 1 ELSE 0 END) AS sales,
           SUM(CASE WHEN status IN ('ok', 'unassigned') THEN coins ELSE 0 END) AS coins,
           SUM(CASE WHEN status = 'ok' THEN minutes ELSE 0 END) AS minutes,
           COUNT(DISTINCT CASE WHEN status IN ('ok', 'unassigned') AND mac <> '' THEN mac END) AS customers
    FROM aircoins_sales`;
  const groupLedger = (list: any[]): Map<number, VendoLedgerTotals> => {
    const map = new Map<number, VendoLedgerTotals>();
    for (const row of list) {
      map.set(Number(row.device_id), {
        sales: Number(row.sales) || 0,
        coins: Number(row.coins) || 0,
        minutes: Number(row.minutes) || 0,
        customers: Number(row.customers) || 0,
      });
    }
    return map;
  };
  const rangeLedger = groupLedger(
    db.prepare(`${ledgerColumns} WHERE date(created_at) BETWEEN ? AND ? GROUP BY device_id`).all(from, to) as any[]
  );
  const allLedger = groupLedger(db.prepare(`${ledgerColumns} GROUP BY device_id`).all() as any[]);
  
  const vendo = await fetchVendoSales(vendoDevices ?? loadVendoDevices(), rangeLedger, allLedger);

  // AirCoins sales are logged per sale, so unlike the JuanFi counters they can
  // be filtered by date. Only coins that were actually banked - credited to a PC
  // or logged as unassigned - are revenue: a no-rate or error row is the same
  // coins waiting for a retry, and counting it would double the sale.
  const aAgg = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('ok', 'unassigned') THEN 1 ELSE 0 END), 0) AS n,
            COALESCE(SUM(CASE WHEN status IN ('ok', 'unassigned') THEN coins ELSE 0 END), 0) AS coins,
            COALESCE(SUM(CASE WHEN status = 'ok' THEN minutes ELSE 0 END), 0) AS minutes,
            COALESCE(SUM(CASE WHEN status = 'unassigned' THEN 1 ELSE 0 END), 0) AS unassigned_n,
            COALESCE(SUM(CASE WHEN status = 'unassigned' THEN coins ELSE 0 END), 0) AS unassigned_coins,
            COALESCE(SUM(CASE WHEN status IN ('no-rate', 'error') THEN 1 ELSE 0 END), 0) AS failed_n
     FROM aircoins_sales WHERE date(created_at) BETWEEN ? AND ?`
  ).get(from, to) as any;
  const aRowsRaw = db.prepare(
    `SELECT id, device_id, mac, coins, minutes, status, error, created_at
     FROM aircoins_sales WHERE date(created_at) BETWEEN ? AND ?
     ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(from, to, limit) as any[];
  const deviceNames = new Map<number, string>();
  for (const d of loadVendoDevices()) deviceNames.set(Number(d.id), d.name);
  const aRows: AirCoinsSaleRow[] = aRowsRaw.map((row) => ({
    id: Number(row.id),
    deviceId: Number(row.device_id),
    deviceName: deviceNames.get(Number(row.device_id)) || `Device ${row.device_id}`,
    mac: String(row.mac || ''),
    coins: Number(row.coins) || 0,
    minutes: Number(row.minutes) || 0,
    status: String(row.status || ''),
    error: String(row.error || ''),
    createdAt: String(row.created_at || ''),
  }));
  const aircoins = {
    count: Number(aAgg.n) || 0,
    amount: Number(aAgg.coins) || 0,
    minutes: Number(aAgg.minutes) || 0,
    unassignedCount: Number(aAgg.unassigned_n) || 0,
    unassignedAmount: Number(aAgg.unassigned_coins) || 0,
    failedCount: Number(aAgg.failed_n) || 0,
    rows: aRows,
  };

  const voucherSales = Number(vAgg.amount) || 0;
  const gcashSales = Number(pAgg.amount) || 0;
  const aircoinsSales = aircoins.amount;
  return {
    from,
    to,
    vouchers: {
      count: Number(vAgg.n) || 0,
      amount: voucherSales,
      generatedCount: Number(vGen.n) || 0,
      generatedAmount: Number(vGen.amount) || 0,
      rows: vRows,
    },
    gcash: { count: Number(pAgg.n) || 0, amount: gcashSales, rows: pRows },
    aircoins,
    vendo,
    totals: {
      voucherSales,
      gcashSales,
      aircoinsSales,
      periodTotal: voucherSales + gcashSales + aircoinsSales,
      vendoLifetimeCoins: vendo.lifetimeCoins,
      vendoCurrentCoins: vendo.currentCoins,
    },
  };
}