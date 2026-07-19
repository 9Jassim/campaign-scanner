/**
 * Sign-in throttling policy.
 *
 * The portal is on the open internet with password auth, so without a limit an
 * attacker can guess as fast as they can send requests, and nothing would
 * record that it was happening. Failures are counted per account and per IP;
 * once a key trips its limit it locks, and the lock doubles with each further
 * failure, so a brute force stalls almost immediately.
 *
 * Per-account limits are tight. Per-IP limits are deliberately loose: a shop's
 * cashiers all share one NAT address, and locking a whole store out mid-shift
 * would stop them scanning — a worse outcome than the attack for a business
 * whose tills depend on this.
 *
 * Pure by design (no database import) so the policy is unit-testable — the
 * reads and writes live in `lib/login-attempts.ts`.
 */

const MINUTE = 60_000;

export interface ThrottlePolicy {
  /** Failures allowed before the key locks. */
  maxFailures: number;
  /** Failures are forgotten once this long has passed since the first one. */
  windowMs: number;
  /** Lock duration on first trip; doubles per extra failure. */
  baseLockMs: number;
  /** Ceiling on the lock duration. */
  maxLockMs: number;
}

/** One account under attack: lock early, since only its owner is affected. */
export const ACCOUNT_POLICY: ThrottlePolicy = {
  maxFailures: 5,
  windowMs: 15 * MINUTE,
  baseLockMs: MINUTE,
  maxLockMs: 15 * MINUTE,
};

/** A whole shop shares this key — stay loose so typos can't lock the store. */
export const IP_POLICY: ThrottlePolicy = {
  maxFailures: 30,
  windowMs: 15 * MINUTE,
  baseLockMs: MINUTE,
  maxLockMs: 15 * MINUTE,
};

/** The stored state of one throttle key. */
export interface AttemptRecord {
  failures: number;
  firstFailedAt: Date;
  lockedUntil: Date | null;
}

export interface ThrottleKey {
  key: string;
  policy: ThrottlePolicy;
}

/** Milliseconds until this key unlocks; 0 when it is not locked. */
export function lockRemainingMs(
  record: AttemptRecord | null,
  now: Date,
): number {
  if (!record?.lockedUntil) return 0;
  return Math.max(0, record.lockedUntil.getTime() - now.getTime());
}

/**
 * Fold one more failure into a key's state.
 *
 * A key still serving a lock keeps its counter regardless of the window, so
 * waiting out the window mid-lock can't reset the escalation.
 */
export function registerFailure(
  record: AttemptRecord | null,
  now: Date,
  policy: ThrottlePolicy,
): AttemptRecord {
  const stillLocked = lockRemainingMs(record, now) > 0;
  const withinWindow =
    !!record &&
    (stillLocked ||
      now.getTime() - record.firstFailedAt.getTime() <= policy.windowMs);

  const failures = withinWindow ? record!.failures + 1 : 1;
  const firstFailedAt = withinWindow ? record!.firstFailedAt : now;

  let lockedUntil: Date | null = null;
  if (failures >= policy.maxFailures) {
    const steps = failures - policy.maxFailures;
    const lockMs = Math.min(policy.baseLockMs * 2 ** steps, policy.maxLockMs);
    lockedUntil = new Date(now.getTime() + lockMs);
  }

  return { failures, firstFailedAt, lockedUntil };
}

/** Prefix for the per-account key; `lib/login-attempts.ts` clears by it. */
export const ACCOUNT_KEY_PREFIX = 'user:';

/** The throttle keys a sign-in attempt counts against. */
export function throttleKeys(
  username: string,
  ip: string | null,
): ThrottleKey[] {
  const keys: ThrottleKey[] = [
    { key: `${ACCOUNT_KEY_PREFIX}${username}`, policy: ACCOUNT_POLICY },
  ];
  if (ip) keys.push({ key: `ip:${ip}`, policy: IP_POLICY });
  return keys;
}

/**
 * The client address, for per-IP throttling.
 *
 * Vercel sets `x-forwarded-for` itself and the client entry is first. Absent
 * locally, in which case throttling falls back to the account key alone.
 */
export function clientIp(request: Request | undefined): string | null {
  const forwarded = request?.headers.get('x-forwarded-for');
  if (!forwarded) return null;
  return forwarded.split(',')[0]?.trim() || null;
}

/** The `code` a lockout surfaces to the client, carrying the wait in seconds. */
export function lockoutCode(retryAfterSec: number): string {
  return `too_many_attempts:${retryAfterSec}`;
}

/** "45 seconds" / "1 minute" / "8 minutes" — how long until they may retry. */
function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Turn a failed sign-in's `code` into a message for the user.
 *
 * Naming the lockout plainly is safe: failures are counted against the username
 * whether or not the account exists, so a locked-out attacker probing a
 * made-up name sees exactly what they'd see for a real one. It gives away
 * nothing, and it stops a locked-out cashier thinking they mistyped.
 */
export function signInErrorMessage(code: string | undefined): string {
  const [reason, retryAfter] = (code ?? '').split(':');
  if (reason === 'too_many_attempts') {
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds) && seconds > 0
      ? `Too many failed attempts. Try again in ${formatWait(seconds)}.`
      : 'Too many failed attempts. Please try again shortly.';
  }
  return 'Invalid username or password';
}
