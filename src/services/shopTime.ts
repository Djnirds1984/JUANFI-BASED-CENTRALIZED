/*
 * The clock the shop actually reads.
 *
 * SQLite stamps every row with `datetime('now')`, which is UTC. In Manila a
 * sale at 00:23 belongs to the new day, not the one before it, so both the day
 * filters and the numbers on screen have to shift by the same offset - otherwise
 * "today" splits in two at 08:00 and a morning report shows yesterday's takings.
 *
 * Every query that groups by a day uses SHOP_SQL_SHIFT; the browser mirrors the
 * same offset in `App.shopTzMinutes` for the stamps it renders.
 */
export const SHOP_OFFSET_MINUTES = 8 * 60;

/** SQLite date modifier, used as `date(column, '${SHOP_SQL_SHIFT}')`. */
export const SHOP_SQL_SHIFT = '+8 hours';

/** Today's date (YYYY-MM-DD) on the shop clock. */
export function shopToday(): string {
  return new Date(Date.now() + SHOP_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}
