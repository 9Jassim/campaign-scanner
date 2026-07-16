import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatDateTimeCsv,
  todayInBahrain,
  CAMPAIGN_TIMEZONE,
} from './datetime';

describe('Bahrain time formatting', () => {
  it('renders a stored UTC timestamp in Bahrain time (+3)', () => {
    // A real receipt: stored as 11:35 UTC, rung up at 14:35 in the shop.
    // Vercel runs in UTC, so the old toLocaleString() showed 11:35 here.
    const d = new Date('2026-07-15T11:35:11.897Z');
    expect(formatDateTime(d)).toBe('15/07/2026, 14:35');
  });

  it('rolls over to the next day for a late-evening UTC timestamp', () => {
    // 22:30 UTC is already 01:30 the next morning in Bahrain.
    const d = new Date('2026-07-15T22:30:00.000Z');
    expect(formatDateTime(d)).toBe('16/07/2026, 01:30');
  });

  it('renders midnight as 00:00, not 24:00', () => {
    const d = new Date('2026-07-15T21:00:00.000Z'); // 00:00 on the 16th
    expect(formatDateTime(d)).toBe('16/07/2026, 00:00');
  });

  it('stays at +3 in both winter and summer (Bahrain has no DST)', () => {
    expect(formatDateTime(new Date('2026-01-15T09:00:00.000Z'))).toBe(
      '15/01/2026, 12:00',
    );
    expect(formatDateTime(new Date('2026-07-15T09:00:00.000Z'))).toBe(
      '15/07/2026, 12:00',
    );
  });

  it('shows a dash for a missing date', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('formats CSV cells as sortable Bahrain-time datetimes', () => {
    const d = new Date('2026-07-15T11:35:11.897Z');
    expect(formatDateTimeCsv(d)).toBe('2026-07-15 14:35:11');
  });

  it('leaves a CSV cell blank rather than dashed for a missing date', () => {
    expect(formatDateTimeCsv(null)).toBe('');
  });

  it('dates an export by the Bahrain day, not the UTC day', () => {
    // 01:00 in Bahrain on the 16th is still 22:00 on the 15th in UTC, so
    // toISOString().slice(0, 10) would have named the file with yesterday.
    const justAfterMidnight = new Date('2026-07-15T22:00:00.000Z');
    expect(todayInBahrain(justAfterMidnight)).toBe('2026-07-16');
  });

  it('pins the campaign timezone to Bahrain', () => {
    expect(CAMPAIGN_TIMEZONE).toBe('Asia/Bahrain');
  });
});
