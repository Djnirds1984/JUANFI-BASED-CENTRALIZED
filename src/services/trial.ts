import { getDb } from '../database';

/*
 * Panel-tracked free trial (the portal TRIAL button).
 *
 * The router's own `login-by=trial` is deliberately removed by the panel on
 * radius-mode routers (activeDevices.disableTrialLogin): it authenticates
 * WITHOUT RADIUS, so the device shows "connected" with zero tracked time and
 * never appears in any session/expiry the panel manages. The portal trial
 * replaces it: the trial minutes are credited onto the device's MAC account
 * exactly like a coin insert (creditMacAccount + CoA), so pause/resume,
 * roam, top-ups and accounting all keep working on top of the free time.
 *
 * Scope: one claim per device (MAC) per router per calendar DAY, counted on
 * the server's local clock (shop midnight), not UTC - a trial that resets at
 * 8 AM because the box runs UTC would look broken to customers.
 */

export interface TrialSettings {
  enabled: boolean;
  minutes: number;
}

/**
 * Sanity ceiling for the free minutes, not a policy: the operator picks the
 * real length in Panel Settings. One day is the most the field accepts, so a
 * typo (e.g. 12000) cannot hand out a week of free internet. Abuse is stopped
 * by the per-MAC AND per-line (IP) daily claim, not by shortening the window.
 */
export const MAX_TRIAL_MINUTES = 1440;
export const DEFAULT_TRIAL_MINUTES = 15;

export interface TrialClaim {
  claimed: boolean;
  /** Existing MAC row that was overwritten (to restore on grant failure), if any. */
  previous?: { id: number; claimed_at: string };
  /** Existing per-IP row that was overwritten (to restore on grant failure), if any. */
  previousIp?: { id: number; claimed_at: string };
}

/** Loopback means the request came through the panel's own proxy - no client IP. */
function usableIp(value: any): string {
  const ip = String(value ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return '';
  if (ip.startsWith('127.') || ip === '0.0.0.0') return '';
  return ip;
}

export function getTrialSettings(db: any = getDb()): TrialSettings {
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  const row = db
    .prepare('SELECT trial_enabled, trial_minutes FROM system_settings WHERE id = 1')
    .get() as any;
  const minutes = parseInt(String(row?.trial_minutes ?? ''), 10);
  return {
    enabled: Number(row?.trial_enabled ?? 1) === 1,
    minutes: Number.isFinite(minutes) && minutes > 0
      ? Math.min(minutes, MAX_TRIAL_MINUTES)
      : DEFAULT_TRIAL_MINUTES,
  };
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Atomically stamp today's claim. Returns claimed=false when this device
// already got its trial today, or when the same line (IP) already claimed one.
//
// A phone that randomizes its MAC per connection used to look like a new device
// every time, so the per-MAC key alone could hand out the trial over and over.
// The device keeps its DHCP address within a visit, which makes the second key
// the one that actually holds.
export function claimTrial(db: any, routerId: number, macNoColon: string, ipAddress?: string): TrialClaim {
  return db.transaction(() => {
    const today = localToday();
    const ip = usableIp(ipAddress);

    const row = db
      .prepare('SELECT id, claimed_at FROM trial_claims WHERE router_id = ? AND mac_address = ?')
      .get(routerId, macNoColon) as any;
    if (row && String(row.claimed_at || '').slice(0, 10) === today) {
      return { claimed: false };
    }

    let ipRow: any = null;
    if (ip) {
      ipRow = db
        .prepare('SELECT id, claimed_at FROM trial_ip_claims WHERE router_id = ? AND ip_address = ?')
        .get(routerId, ip) as any;
      if (ipRow && String(ipRow.claimed_at || '').slice(0, 10) === today) {
        return { claimed: false };
      }
    }

    const claim: TrialClaim = { claimed: true };

    if (row) {
      // Store the LOCAL date stamp in claimed_at (renews at shop midnight),
      // while keeping the raw timestamp for audits.
      db.prepare("UPDATE trial_claims SET claimed_at = ? || ' ' || substr(datetime('now'), 12) WHERE id = ?")
        .run(today, row.id);
      claim.previous = { id: row.id, claimed_at: row.claimed_at };
    } else {
      db.prepare("INSERT INTO trial_claims (router_id, mac_address, claimed_at) VALUES (?, ?, ? || ' ' || substr(datetime('now'), 12))")
        .run(routerId, macNoColon, today);
    }

    if (ip) {
      if (ipRow) {
        db.prepare("UPDATE trial_ip_claims SET claimed_at = ? || ' ' || substr(datetime('now'), 12) WHERE id = ?")
          .run(today, ipRow.id);
        claim.previousIp = { id: ipRow.id, claimed_at: ipRow.claimed_at };
      } else {
        db.prepare("INSERT INTO trial_ip_claims (router_id, ip_address, claimed_at) VALUES (?, ?, ? || ' ' || substr(datetime('now'), 12))")
          .run(routerId, ip, today);
      }
    }

    return claim;
  })();
}

// A failed grant (router down, credit error) must not burn the device's trial
// for the day - roll both claims back to exactly what they were before.
export function releaseTrialClaim(db: any, routerId: number, macNoColon: string, claim: TrialClaim, ipAddress?: string): void {
  try {
    if (claim.previous) {
      db.prepare('UPDATE trial_claims SET claimed_at = ? WHERE id = ?')
        .run(claim.previous.claimed_at, claim.previous.id);
    } else {
      db.prepare('DELETE FROM trial_claims WHERE router_id = ? AND mac_address = ?')
        .run(routerId, macNoColon);
    }

    const ip = usableIp(ipAddress);
    if (ip) {
      if (claim.previousIp) {
        db.prepare('UPDATE trial_ip_claims SET claimed_at = ? WHERE id = ?')
          .run(claim.previousIp.claimed_at, claim.previousIp.id);
      } else {
        db.prepare('DELETE FROM trial_ip_claims WHERE router_id = ? AND ip_address = ?')
          .run(routerId, ip);
      }
    }
  } catch (err: any) {
    console.error('trial: claim rollback failed:', err.message);
  }
}
