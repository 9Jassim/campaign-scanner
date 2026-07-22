import type { SendResult } from './whatsapp';

/**
 * Retry policy for rate-limited WhatsApp sends.
 *
 * When Meta throttles a send, the scan commits anyway and a `retry_queue` row
 * is created (see `lib/scan.ts`). A daily cron drains the queue — once a day on
 * purpose: a tight retry loop against a throttling API is how you stay
 * throttled, and a customer message arriving a day late beats ten arriving at
 * once.
 *
 * This module is the pure decision logic; the database/network side lives in
 * `lib/retry-runner.ts`.
 */

/**
 * Total send attempts a receipt gets (the original + retries) before it is
 * marked permanently failed. At one retry a day, this is roughly a working
 * week of trying.
 */
export const MAX_ATTEMPTS = 5;

/** Pause between consecutive sends, so the drain never re-triggers the limit. */
export const SEND_SPACING_MS = 1000;

/** Queue rows processed per run — bounded so the cron fits its time budget. */
export const BATCH_LIMIT = 200;

/**
 * When a still-throttled row should be tried again. 20 hours, not 24: the cron
 * fires daily, and a full-day interval plus clock jitter would make rows
 * perpetually "not quite due" and slip a day each time.
 */
export function nextRetryDate(now: Date): Date {
  return new Date(now.getTime() + 20 * 60 * 60 * 1000);
}

export type RetryDecision =
  | { kind: 'sent'; wamid: string }
  | { kind: 'retry-later'; error: string }
  | { kind: 'gave-up'; error: string }
  | { kind: 'failed'; error: string }
  | { kind: 'skipped' };

/**
 * What to do with a queue row given the send outcome and how many attempts the
 * receipt has already burned (`attempts` counts previous tries, so this run is
 * attempt `attempts + 1`).
 */
export function decideRetry(
  result: SendResult,
  attempts: number,
): RetryDecision {
  if (result.skipped) return { kind: 'skipped' };
  if (result.wamid) return { kind: 'sent', wamid: result.wamid };

  const error = result.error ?? 'Unknown send error';

  if (result.rateLimited) {
    // Still throttled. Another day, another try — until the budget runs out.
    if (attempts + 1 < MAX_ATTEMPTS) return { kind: 'retry-later', error };
    return {
      kind: 'gave-up',
      error: `Gave up after ${attempts + 1} attempts: ${error}`,
    };
  }

  // A non-throttle error (bad number, template rejected, token broken) will
  // not fix itself by waiting — fail it now so someone sees it.
  return { kind: 'failed', error };
}
