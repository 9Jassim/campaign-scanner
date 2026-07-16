import { describe, it, expect } from 'vitest';
import { storeLockKey } from './store-lock';

const MORSLON = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const MODERN = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('per-store advisory lock keys', () => {
  it('gives a store the same key every time', () => {
    // Deterministic across processes and deploys, or two serverless instances
    // would take different locks and serialize nothing.
    expect(storeLockKey(MORSLON)).toBe(storeLockKey(MORSLON));
  });

  it('gives different stores different keys', () => {
    // This is what keeps one shop's tills from blocking the other's.
    expect(storeLockKey(MORSLON)).not.toBe(storeLockKey(MODERN));
  });

  it('fits in a signed 64-bit integer, which is what Postgres accepts', () => {
    // Literals like 2n need an ES2020 target; this project sits below it.
    const MIN = BigInt('-9223372036854775808');
    const MAX = BigInt('9223372036854775807');
    for (const id of [MORSLON, MODERN, '', 'not-a-uuid', 'x'.repeat(500)]) {
      const key = storeLockKey(id);
      expect(typeof key).toBe('bigint');
      expect(key).toBeGreaterThanOrEqual(MIN);
      expect(key).toBeLessThanOrEqual(MAX);
    }
  });

  it('does not collide for ids differing in one character', () => {
    const a = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const b = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
    expect(storeLockKey(a)).not.toBe(storeLockKey(b));
  });
});
