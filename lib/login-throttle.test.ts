import { describe, it, expect } from 'vitest';
import {
  registerFailure,
  lockRemainingMs,
  throttleKeys,
  clientIp,
  lockoutCode,
  signInErrorMessage,
  ACCOUNT_POLICY,
  IP_POLICY,
  type AttemptRecord,
} from './login-throttle';

const MINUTE = 60_000;
const T0 = new Date('2026-07-16T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

/** Replay `count` consecutive failures, all at T0 unless a clock is given. */
function failTimes(count: number, clock: (i: number) => Date = () => T0) {
  let record: AttemptRecord | null = null;
  for (let i = 0; i < count; i++) {
    record = registerFailure(record, clock(i), ACCOUNT_POLICY);
  }
  return record!;
}

describe('sign-in throttling', () => {
  it('does not lock a user who mistypes a few times', () => {
    const record = failTimes(4);
    expect(record.failures).toBe(4);
    expect(lockRemainingMs(record, T0)).toBe(0);
  });

  it('locks the account on the 5th consecutive failure', () => {
    const record = failTimes(5);
    expect(lockRemainingMs(record, T0)).toBe(MINUTE);
  });

  it('doubles the lock on each further failure, up to a 15 minute cap', () => {
    // The point of the escalation: guessing gets exponentially more expensive.
    expect(lockRemainingMs(failTimes(5), T0)).toBe(1 * MINUTE);
    expect(lockRemainingMs(failTimes(6), T0)).toBe(2 * MINUTE);
    expect(lockRemainingMs(failTimes(7), T0)).toBe(4 * MINUTE);
    expect(lockRemainingMs(failTimes(8), T0)).toBe(8 * MINUTE);
    expect(lockRemainingMs(failTimes(9), T0)).toBe(15 * MINUTE); // capped
    expect(lockRemainingMs(failTimes(30), T0)).toBe(15 * MINUTE); // stays capped
  });

  it('forgives failures once the window passes, so a typo today is not held against you tomorrow', () => {
    const stale: AttemptRecord = {
      failures: 4,
      firstFailedAt: T0,
      lockedUntil: null,
    };
    const next = registerFailure(stale, at(16 * MINUTE), ACCOUNT_POLICY);
    expect(next.failures).toBe(1);
    expect(next.firstFailedAt).toEqual(at(16 * MINUTE));
  });

  it('cannot be freed early by waiting out the window while still locked', () => {
    // An escalated lock can outlive the 15-minute window: here the account is
    // locked until T0+29 but the window closed at T0+15. Without the
    // still-locked guard, an attempt in that gap would look like a fresh start
    // and hand back an unlocked account.
    const deepLock: AttemptRecord = {
      failures: 9,
      firstFailedAt: T0,
      lockedUntil: at(29 * MINUTE),
    };
    expect(lockRemainingMs(deepLock, at(20 * MINUTE))).toBe(9 * MINUTE);

    const next = registerFailure(deepLock, at(20 * MINUTE), ACCOUNT_POLICY);
    expect(next.failures).toBe(10); // not reset to 1
    expect(next.firstFailedAt).toEqual(T0);
    expect(lockRemainingMs(next, at(20 * MINUTE))).toBe(15 * MINUTE);
  });

  it('unlocks once the lock expires', () => {
    const record = failTimes(5); // locked for 1 minute
    expect(lockRemainingMs(record, at(30_000))).toBe(30_000);
    expect(lockRemainingMs(record, at(MINUTE))).toBe(0);
    expect(lockRemainingMs(record, at(5 * MINUTE))).toBe(0);
  });

  it('reports no lock for a key that has never failed', () => {
    expect(lockRemainingMs(null, T0)).toBe(0);
  });

  it('tolerates far more failures from one IP than from one account', () => {
    // A shop's cashiers share a NAT address; 5 typos between them must not
    // lock the store out.
    let record: AttemptRecord | null = null;
    for (let i = 0; i < 29; i++) record = registerFailure(record, T0, IP_POLICY);
    expect(lockRemainingMs(record, T0)).toBe(0);

    record = registerFailure(record, T0, IP_POLICY); // 30th
    expect(lockRemainingMs(record, T0)).toBe(MINUTE);
  });

  it('counts an attempt against both the account and the IP', () => {
    const keys = throttleKeys('cashier1', '1.2.3.4');
    expect(keys.map((k) => k.key)).toEqual(['user:cashier1', 'ip:1.2.3.4']);
  });

  it('falls back to the account key alone when there is no IP (local dev)', () => {
    const keys = throttleKeys('cashier1', null);
    expect(keys.map((k) => k.key)).toEqual(['user:cashier1']);
  });

  it('takes the client address from the first x-forwarded-for entry', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' },
    });
    expect(clientIp(req)).toBe('203.0.113.7');
  });

  it('returns no IP when the header is absent', () => {
    expect(clientIp(new Request('https://example.com'))).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });
});

describe('what the user is told', () => {
  it('reads back a lockout the server emitted', () => {
    // Round-trip: auth.ts builds the code, the sign-in form parses it. If the
    // two ever drift apart the lockout would read as "Invalid username".
    expect(signInErrorMessage(lockoutCode(60))).toBe(
      'Too many failed attempts. Try again in 1 minute.',
    );
    expect(signInErrorMessage(lockoutCode(900))).toBe(
      'Too many failed attempts. Try again in 15 minutes.',
    );
    expect(signInErrorMessage(lockoutCode(45))).toBe(
      'Too many failed attempts. Try again in 45 seconds.',
    );
  });

  it('rounds a part-minute wait up, so the user never retries too early', () => {
    expect(signInErrorMessage(lockoutCode(61))).toContain('2 minutes');
    expect(signInErrorMessage(lockoutCode(119))).toContain('2 minutes');
  });

  it('says nothing about whether the account exists', () => {
    // The generic wording is the whole point: a wrong password and an unknown
    // username must be indistinguishable.
    expect(signInErrorMessage('credentials')).toBe(
      'Invalid username or password',
    );
    expect(signInErrorMessage(undefined)).toBe('Invalid username or password');
  });

  it('degrades to a sensible message if the wait is malformed', () => {
    expect(signInErrorMessage('too_many_attempts:')).toBe(
      'Too many failed attempts. Please try again shortly.',
    );
    expect(signInErrorMessage('too_many_attempts:abc')).toBe(
      'Too many failed attempts. Please try again shortly.',
    );
  });
});
