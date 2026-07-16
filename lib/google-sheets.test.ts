import { describe, it, expect, beforeAll } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { buildServiceAccountJwt, hasSheetsCredentials } from './google-sheets';

const EMAIL = 'backup@campaign-scanner.iam.gserviceaccount.com';
let publicKey: string;
let privateKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  publicKey = pair.publicKey;
  privateKey = pair.privateKey;
});

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('service-account JWT', () => {
  it('is signed such that the public key verifies it', () => {
    // The whole point: Google will reject the assertion if the RS256 signature
    // over "header.claim" is not exactly right, and there is no SDK checking
    // our work here.
    const jwt = buildServiceAccountJwt(EMAIL, privateKey);
    const [header, claim, signature] = jwt.split('.');
    const ok = createVerify('RSA-SHA256')
      .update(`${header}.${claim}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });

  it('declares RS256, which is what Google requires', () => {
    const [header] = buildServiceAccountJwt(EMAIL, privateKey).split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
  });

  it('claims the spreadsheets scope for the right account', () => {
    const [, claim] = buildServiceAccountJwt(EMAIL, privateKey).split('.');
    const c = decode(claim);
    expect(c.iss).toBe(EMAIL);
    expect(c.scope).toBe('https://www.googleapis.com/auth/spreadsheets');
    expect(c.aud).toBe('https://oauth2.googleapis.com/token');
  });

  it('expires an hour out, which is Google’s maximum', () => {
    const now = 1_800_000_000;
    const [, claim] = buildServiceAccountJwt(EMAIL, privateKey, now).split('.');
    const c = decode(claim);
    expect(c.iat).toBe(now);
    expect(c.exp).toBe(now + 3600);
  });

  it('restores a key stored with literal \\n escapes', () => {
    // Vercel env vars cannot hold real newlines, so the key arrives escaped.
    // If this were not unescaped, signing would throw and every backup fail.
    const escaped = privateKey.replace(/\n/g, '\\n');
    expect(() => buildServiceAccountJwt(EMAIL, escaped)).not.toThrow();

    const jwt = buildServiceAccountJwt(EMAIL, escaped);
    const [header, claim, signature] = jwt.split('.');
    const ok = createVerify('RSA-SHA256')
      .update(`${header}.${claim}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });

  it('emits base64url, not base64 — a JWT with + or / is malformed', () => {
    const jwt = buildServiceAccountJwt(EMAIL, privateKey);
    expect(jwt).not.toMatch(/[+/=]/);
    expect(jwt.split('.')).toHaveLength(3);
  });
});

describe('credential detection', () => {
  it('reports configured only when both halves are present', () => {
    const saved = {
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    };
    try {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
      expect(hasSheetsCredentials()).toBe(false);

      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = EMAIL;
      expect(hasSheetsCredentials()).toBe(false); // key still missing

      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey;
      expect(hasSheetsCredentials()).toBe(true);
    } finally {
      if (saved.email) process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = saved.email;
      else delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      if (saved.key) process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = saved.key;
      else delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    }
  });
});
