import type { DateRange, RangePreset } from './types';

/**
 * Date-range and formatting helpers for analytics.
 *
 * Everything the dashboard measures is anchored to the BAHRAIN business day,
 * but timestamps are stored as naive UTC (see lib/datetime.ts). Bahrain is
 * UTC+3 year-round with no DST, so a Bahrain wall-clock midnight is a fixed
 * offset from UTC and these conversions are exact.
 */

const BAHRAIN_TZ = 'Asia/Bahrain';
const DAY_MS = 86_400_000;
/** Cap the daily chart's x-axis so "all time" can't draw thousands of points. */
const MAX_CHART_DAYS = 92;

/** The Bahrain calendar Y/M/D that a given instant falls on. */
function bahrainYMD(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BAHRAIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), day: get('day') };
}

/** UTC instant of Bahrain wall-clock midnight for the given calendar day. */
function bahrainMidnightUtc(y: number, m: number, day: number): Date {
  // Bahrain 00:00 (+03:00) is the previous UTC day at 21:00 — expressed as a
  // negative hour so Date.UTC normalises it.
  return new Date(Date.UTC(y, m - 1, day, -3, 0, 0));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function label(y: number, m: number, day: number): string {
  return `${y}-${pad(m)}-${pad(day)}`;
}

/**
 * Resolve the search params into a concrete range plus the matching previous
 * period. Unknown/absent presets fall back to the last 30 days.
 */
export function parseDateRange(searchParams: {
  range?: string;
  from?: string;
  to?: string;
}): DateRange {
  const now = new Date();
  const t = bahrainYMD(now);
  const todayStart = bahrainMidnightUtc(t.y, t.m, t.day);

  const preset = normalizePreset(searchParams.range);
  let start: Date;
  let end = now;
  let text: string;

  switch (preset) {
    case 'today':
      start = todayStart;
      text = 'Today';
      break;
    case '7d':
      start = new Date(todayStart.getTime() - 6 * DAY_MS);
      text = 'Last 7 days';
      break;
    case 'month':
      start = bahrainMidnightUtc(t.y, t.m, 1);
      text = 'This month';
      break;
    case 'all':
      // Campaign-era floor; the daily chart still clamps its own window.
      start = new Date(Date.UTC(2020, 0, 1));
      text = 'All time';
      break;
    case 'custom': {
      const from = parseBahrainDate(searchParams.from);
      const to = parseBahrainDate(searchParams.to);
      if (from && to && from <= to) {
        start = from;
        // Make the end inclusive of the whole "to" day.
        end = new Date(to.getTime() + DAY_MS);
        text = `${searchParams.from} → ${searchParams.to}`;
        break;
      }
      // Bad custom input → behave like the 30-day default.
      start = new Date(todayStart.getTime() - 29 * DAY_MS);
      text = 'Last 30 days';
      return finish('30d', start, end, text);
    }
    case '30d':
    default:
      start = new Date(todayStart.getTime() - 29 * DAY_MS);
      text = 'Last 30 days';
      break;
  }

  return finish(preset, start, end, text);
}

function finish(
  preset: RangePreset,
  start: Date,
  end: Date,
  text: string,
): DateRange {
  const span = end.getTime() - start.getTime();
  return {
    preset,
    start,
    end,
    previousEnd: start,
    previousStart: new Date(start.getTime() - span),
    label: text,
  };
}

function normalizePreset(raw?: string): RangePreset {
  const allowed: RangePreset[] = ['today', '7d', '30d', 'month', 'all', 'custom'];
  return (allowed as string[]).includes(raw ?? '')
    ? (raw as RangePreset)
    : '30d';
}

/** "YYYY-MM-DD" (interpreted as a Bahrain day) → UTC instant of its midnight. */
function parseBahrainDate(s?: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return bahrainMidnightUtc(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Ordered Bahrain day labels spanning [start, end], clamped to the most recent
 * MAX_CHART_DAYS so the line chart's axis stays readable even for "all time".
 */
export function bahrainDayLabels(start: Date, end: Date): string[] {
  const e = bahrainYMD(end);
  const endMidnight = bahrainMidnightUtc(e.y, e.m, e.day);

  const s = bahrainYMD(start);
  let startMidnight = bahrainMidnightUtc(s.y, s.m, s.day);

  const earliest = new Date(endMidnight.getTime() - (MAX_CHART_DAYS - 1) * DAY_MS);
  if (startMidnight < earliest) startMidnight = earliest;

  const labels: string[] = [];
  for (let ms = startMidnight.getTime(); ms <= endMidnight.getTime(); ms += DAY_MS) {
    const p = bahrainYMD(new Date(ms));
    labels.push(label(p.y, p.m, p.day));
  }
  return labels;
}

/** Mask a phone for display: keep the +973 prefix and last 4 digits. */
export function maskPhone(phone: string): string {
  if (!phone) return '';
  if (phone.length <= 6) return phone.replace(/\d(?=\d{2})/g, '*');
  return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}

/** Amounts render with 3 decimals (Bahraini fils) and thousands separators. */
export function formatBd(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Percentage change vs a previous value; null when there's no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
