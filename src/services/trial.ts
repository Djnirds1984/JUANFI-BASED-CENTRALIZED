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

export interface TrialClaim {
  claimed: boolean;
  /** Existing row that was overwritten (to restore on grant failure), if any. */
  previous?: { id: number; claimed_at: string };
}

export function getTrialSettings(db: any = getDb()): TrialSettings {
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  const row = db
    .prepare('SELECT trial_enabled, trial_minutes FROM system_settings WHERE id = 1')
    .get() as any;
  const minutes = parseInt(String(row?.trial_minutes ?? ''), 10);
  return {
    enabled: Number(row?.trial_enabled ?? 1) === 1,
    minutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 1440) : 15,
  };
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Atomically stamp today's claim. Returns claimed=false when this device
// already got its trial today.
export function claimTrial(db: any, routerId: number, macNoColon: string): TrialClaim {
  return db.transaction(() => {
    const row = db
      .prepare('SELECT id, claimed_at FROM trial_claims WHERE router_id = ? AND mac_address = ?')
      .get(routerId, macNoColon) as any;
    const today = localToday();
    if (row && String(row.claimed_at || '').slice(0, 10) === today) {
      return { claimed: false };
    }
    if (row) {
      // Store the LOCAL date stamp in claimed_at (renews at shop midnight),
      // while keeping the raw timestamp for audits.
      db.prepare("UPDATE trial_claims SET claimed_at = ? || ' ' || substr(datetime('now'), 12) WHERE id = ?")
        .run(today, row.id);
      return { claimed: true, previous: { id: row.id, claimed_at: row.claimed_at } };
    }
    db.prepare("INSERT INTO trial_claims (router_id, mac_address, claimed_at) VALUES (?, ?, ? || ' ' || substr(datetime('now'), 12))")
      .run(routerId, macNoColon, today);
    return { claimed: true };
  })();
}

// A failed grant (router down, credit error) must not burn the device's trial
// for the day - roll the claim back to exactly what it was before.
export function releaseTrialClaim(db: any, routerId: number, macNoColon: string, claim: TrialClaim): void {
  try {
    if (claim.previous) {
      db.prepare('UPDATE trial_claims SET claimed_at = ? WHERE id = ?')
        .run(claim.previous.claimed_at, claim.previous.id);
    } else {
      db.prepare('DELETE FROM trial_claims WHERE router_id = ? AND mac_address = ?')
        .run(routerId, macNoColon);
    }
  } catch (err: any) {
    console.error('trial: claim rollback failed:', err.message);
  }
}
