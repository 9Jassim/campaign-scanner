/**
 * Date formatting for the portal.
 *
 * Timestamps are stored in UTC (Postgres `timestamp without time zone`, session
 * TimeZone=GMT). Both stores trade in Bahrain, so every date is rendered in
 * Bahrain time no matter where the server or the viewer is.
 *
 * The zone must be passed explicitly: these are server components, so a bare
 * `toLocaleString()` follows the *server's* zone — UTC on Vercel — which
 * rendered every invoice 3 hours early in production while looking correct on a
 * Bahraini dev machine.
 */

/** Bahrain is UTC+3 year-round — no daylight saving. */
export const CAMPAIGN_TIMEZONE = 'Asia/Bahrain';

/** Shown in place of a missing date. */
const EMPTY = '—';

// Built once at module load: constructing an Intl formatter is expensive and
// these run per-row over pages of up to 100 rows.

/** `15/07/2026, 14:35` — day-first, as read in Bahrain. */
const uiFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMPAIGN_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  // hourCycle rather than `hour12: false`, which can render midnight as "24:00".
  hourCycle: 'h23',
});

/** `2026-07-15 14:35:11` — sortable, and Excel parses it as a datetime. */
const csvFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAMPAIGN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `2026-07-15` — the calendar date in Bahrain, for filenames. */
const dateOnlyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAMPAIGN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Format a timestamp for on-screen display, in Bahrain time. */
export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return EMPTY;
  return uiFormatter.format(d);
}

/**
 * Format a timestamp for a CSV cell, in Bahrain time. Empty string for a
 * missing date so the column stays blank rather than showing a dash.
 */
export function formatDateTimeCsv(d: Date | null | undefined): string {
  if (!d) return '';
  // en-CA yields "2026-07-15, 14:35:11"; drop the comma for a clean cell.
  return csvFormatter.format(d).replace(', ', ' ');
}

/**
 * Today's calendar date in Bahrain (`YYYY-MM-DD`).
 *
 * Not `toISOString().slice(0, 10)`: between midnight and 03:00 Bahrain time
 * that is still yesterday in UTC, so an export would carry the wrong date.
 */
export function todayInBahrain(now: Date = new Date()): string {
  return dateOnlyFormatter.format(now);
}
