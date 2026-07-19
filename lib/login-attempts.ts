import { db } from './db';
import {
  ACCOUNT_KEY_PREFIX,
  lockRemainingMs,
  registerFailure,
  type ThrottleKey,
} from './login-throttle';

/**
 * Persistence for sign-in throttling — reads and writes `login_attempts`.
 * The policy these calls enforce lives in `lib/login-throttle.ts`.
 *
 * Postgres rather than Redis: sign-in volume is a handful of staff, the
 * database is already provisioned, and it keeps the deployment to one service.
 */

const MINUTE = 60_000;
/** Settled rows older than this are swept up. */
const GC_AFTER_MS = 24 * 60 * MINUTE;

/**
 * Seconds until the caller may try again; 0 when no key is locked.
 *
 * Counted against the username whether or not that account exists, so a lockout
 * reveals nothing about which usernames are real.
 */
export async function retryAfterSeconds(
  keys: ThrottleKey[],
  now: Date = new Date(),
): Promise<number> {
  const rows = await db.loginAttempt.findMany({
    where: { key: { in: keys.map((k) => k.key) } },
  });
  const remaining = rows.reduce(
    (worst, row) => Math.max(worst, lockRemainingMs(row, now)),
    0,
  );
  return Math.ceil(remaining / 1000);
}

/** Count a failed attempt against every key. */
export async function recordFailure(
  keys: ThrottleKey[],
  now: Date = new Date(),
): Promise<void> {
  for (const { key, policy } of keys) {
    const existing = await db.loginAttempt.findUnique({ where: { key } });
    const next = registerFailure(existing, now, policy);
    await db.loginAttempt.upsert({
      where: { key },
      create: { key, ...next },
      update: next,
    });
  }
}

/**
 * Clear the account counter after a successful sign-in.
 *
 * The IP counter is left to expire on its own: it is shared, so one valid login
 * must not hand an attacker on the same address a fresh budget.
 */
export async function clearFailures(
  keys: ThrottleKey[],
  now: Date = new Date(),
): Promise<void> {
  const accountKeys = keys
    .filter((k) => k.key.startsWith(ACCOUNT_KEY_PREFIX))
    .map((k) => k.key);

  await db.loginAttempt.deleteMany({ where: { key: { in: accountKeys } } });

  // Opportunistic GC of settled rows so the table can't grow without bound.
  // Cheap, because successful logins are rare.
  await db.loginAttempt.deleteMany({
    where: {
      updatedAt: { lt: new Date(now.getTime() - GC_AFTER_MS) },
      lockedUntil: null,
    },
  });
}
