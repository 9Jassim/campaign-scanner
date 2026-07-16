import { createHash } from 'node:crypto';

/**
 * Per-store locking for the scan flow.
 *
 * Concurrent scans must serialize within a store, but never across stores:
 * Morslon and Modern Sources are separate companies with independent data, and
 * a till in one must never wait on a till in the other.
 *
 * Postgres advisory locks are the right primitive here. A JS mutex would not
 * work — each serverless invocation has its own memory — and `SELECT FOR
 * UPDATE` on the store row would be heavier and less obvious.
 *
 * Pure by design (no database import) so it stays unit-testable; `lib/scan.ts`
 * does the locking.
 */

/** How long a scan waits for its store's lock before giving up. */
export const SCAN_LOCK_TIMEOUT = '10s';

/**
 * Advisory-lock key for a store.
 *
 * Advisory locks are keyed by a signed 64-bit integer but store ids are UUIDs,
 * so hash one into the other. Must be deterministic: two serverless instances
 * that derived different keys for the same store would serialize nothing.
 */
export function storeLockKey(storeId: string): bigint {
  return createHash('sha256').update(storeId).digest().readBigInt64BE(0);
}
