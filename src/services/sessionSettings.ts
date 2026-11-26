import { getDb } from '../database';

/**
 * Session behaviour settings (panel > RADIUS > Session Settings).
 *
 * Kept on the single-row `system_settings` table so a settings write is one
 * UPDATE and the 5s device sync can read the flag without joining anything.
 */

export interface SessionSettings {
  auto_pause_offline: boolean;
  updated_at: string | null;
}

export interface SessionCounts {
  pausedAccounts: number;
  offlineSessions: number;
}

function settingsRow(): any {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  return db
    .prepare('SELECT auto_pause_offline, updated_at FROM system_settings WHERE id = 1')
    .get() as any;
}

export function getSessionSettings(): SessionSettings {
  const row = settingsRow();
  return {
    auto_pause_offline: Number(row?.auto_pause_offline ?? 0) === 1,
    updated_at: row?.updated_at || null,
  };
}

/**
 * Read on every sync tick (5s). Returns false whenever the flag is unreadable
 * so a broken settings row can never start freezing customers' time.
 */
export function isAutoPauseOfflineEnabled(): boolean {
  try {
    return getSessionSettings().auto_pause_offline;
  } catch (error: any) {
    console.error('auto-pause flag read failed:', error.message);
    return false;
  }
}

export function setSessionSettings(patch: { auto_pause_offline?: boolean }): SessionSettings {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO system_settings (id) VALUES (1)').run();
  if (typeof patch.auto_pause_offline === 'boolean') {
    db.prepare(
      "UPDATE system_settings SET auto_pause_offline = ?, updated_at = datetime('now') WHERE id = 1"
    ).run(patch.auto_pause_offline ? 1 : 0);
  }
  return getSessionSettings();
}

/** How many frozen balances are waiting for the customer to RESUME. */
export function sessionCounts(): SessionCounts {
  const db = getDb();
  const paused = db
    .prepare('SELECT COUNT(*) AS v FROM hotspot_users WHERE paused = 1')
    .get() as any;
  const offline = db
    .prepare(
      `SELECT COUNT(*) AS v FROM device_sessions
       WHERE is_online = 0 AND status <> 'expired' AND remaining_seconds > 0`
    )
    .get() as any;
  return {
    pausedAccounts: Number(paused?.v) || 0,
    offlineSessions: Number(offline?.v) || 0,
  };
}
