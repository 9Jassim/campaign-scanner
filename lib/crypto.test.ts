import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, isEncryptionConfigured } from './crypto';

const KEY = randomBytes(32).toString('base64');

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

describe('encryption of Meta access tokens', () => {
  it('round-trips a token (settings encrypts → sender decrypts)', () => {
    const token = 'EAAG1234fakeMetaAccessToken_xyz';
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it('round-trips unicode and long values', () => {
    const value = 'مرسلون-token-' + 'x'.repeat(500);
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const token = 'same-token';
    expect(encrypt(token)).not.toBe(encrypt(token));
  });

  it('does not leak the plaintext into the ciphertext', () => {
    const token = 'super-secret-token';
    expect(encrypt(token)).not.toContain(token);
  });

  it('fails to decrypt when the key is wrong (tamper/rotation safety)', () => {
    const payload = encrypt('token');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => decrypt(payload)).toThrow();
    process.env.ENCRYPTION_KEY = KEY;
  });

  it('rejects a key that is not 32 bytes', () => {
    process.env.ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(() => encrypt('token')).toThrow(/32 bytes/);
    process.env.ENCRYPTION_KEY = KEY;
  });

  it('reports whether encryption is configured', () => {
    expect(isEncryptionConfigured()).toBe(true);
    delete process.env.ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    process.env.ENCRYPTION_KEY = KEY;
  });
});
