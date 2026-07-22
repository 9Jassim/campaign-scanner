import { describe, it, expect } from 'vitest';
import {
  MAX_ATTEMPTS,
  decideRetry,
  nextRetryDate,
} from './retry-policy';

describe('decideRetry', () => {
  it('resolves a successful send with its wamid', () => {
    expect(decideRetry({ wamid: 'wamid.TEST' }, 0)).toEqual({
      kind: 'sent',
      wamid: 'wamid.TEST',
    });
  });

  it('reschedules a rate-limited send while attempts remain', () => {
    const d = decideRetry({ error: 'Rate limited', rateLimited: true }, 0);
    expect(d.kind).toBe('retry-later');
  });

  it('keeps rescheduling up to the second-to-last attempt', () => {
    const d = decideRetry(
      { error: 'Rate limited', rateLimited: true },
      MAX_ATTEMPTS - 2,
    );
    expect(d.kind).toBe('retry-later');
  });

  it('gives up when the attempt budget is exhausted', () => {
    const d = decideRetry(
      { error: 'Rate limited', rateLimited: true },
      MAX_ATTEMPTS - 1,
    );
    expect(d.kind).toBe('gave-up');
    if (d.kind === 'gave-up') {
      expect(d.error).toContain(`after ${MAX_ATTEMPTS} attempts`);
      expect(d.error).toContain('Rate limited');
    }
  });

  it('fails a hard error immediately — waiting will not fix a bad template', () => {
    const d = decideRetry({ error: 'Template not found' }, 0);
    expect(d).toEqual({ kind: 'failed', error: 'Template not found' });
  });

  it('skips when the store has no credentials', () => {
    expect(decideRetry({ skipped: true }, 0)).toEqual({ kind: 'skipped' });
  });

  it('treats a result with neither wamid nor error as a failure, not a success', () => {
    const d = decideRetry({}, 0);
    expect(d.kind).toBe('failed');
  });
});

describe('nextRetryDate', () => {
  it('schedules 20 hours out, so a daily cron never finds it "not quite due"', () => {
    const now = new Date('2026-07-22T07:00:00Z');
    const next = nextRetryDate(now);
    expect(next.toISOString()).toBe('2026-07-23T03:00:00.000Z');
    // Strictly less than 24h — that is the point.
    expect(next.getTime() - now.getTime()).toBeLessThan(24 * 60 * 60 * 1000);
  });
});
