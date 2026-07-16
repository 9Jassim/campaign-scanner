import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  BCRYPT_COST,
  ABSENT_USER_HASH,
} from './password';

describe('password hashing', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(
      true,
    );
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('hashes at the agreed cost', async () => {
    const hash = await hashPassword('whatever');
    expect(hash.startsWith(`$2b$${String(BCRYPT_COST).padStart(2, '0')}$`)).toBe(
      true,
    );
  });

  it('keeps the absent-user hash at the same cost as real hashes', () => {
    // If the cost drifts apart, an unknown email takes measurably less time
    // than a real one and the timing gap enumerates accounts again.
    expect(
      ABSENT_USER_HASH.startsWith(`$2b$${String(BCRYPT_COST).padStart(2, '0')}$`),
    ).toBe(true);
  });

  it('rejects every password for an account that does not exist', async () => {
    // Includes the passwords an attacker would try first, in case the
    // placeholder were ever seeded from a known string.
    for (const guess of ['', 'password', '123456', 'admin', 'admin@123']) {
      expect(await verifyPassword(guess, null)).toBe(false);
      expect(await verifyPassword(guess, undefined)).toBe(false);
    }
  });

  it('is a usable bcrypt hash, so the comparison really runs', async () => {
    // A malformed hash would make bcrypt return early (or throw), reopening
    // the timing gap this constant exists to close.
    const started = Date.now();
    await verifyPassword('anything', null);
    expect(Date.now() - started).toBeGreaterThan(10);
  });
});
