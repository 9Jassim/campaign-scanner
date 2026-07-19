import { describe, it, expect, beforeAll } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
  buildServiceAccountJwt,
  hasSheetsCredentials,
  overwriteTab,
} from './google-sheets';

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

describe('writing a tab in batches', () => {
  const EMAIL2 = 'backup@x.iam.gserviceaccount.com';
  let calls: Array<{ method: string; url: string; rows: number; firstCell?: string }>;
  let realFetch: typeof globalThis.fetch;

  function stubFetch(existingRows: number) {
    calls = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'stub-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // The pre-write row count.
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ values: Array.from({ length: existingRows }, () => ['x']) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({
        method,
        url,
        rows: body.values?.length ?? 0,
        firstCell: body.values?.[0]?.[0],
      });
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
  }

  const restore = () => { globalThis.fetch = realFetch; };

  function rows(n: number): string[][] {
    return Array.from({ length: n }, (_, i) => [`row${i + 1}`]);
  }

  it('sends one request when the snapshot is small', async () => {
    stubFetch(0);
    try {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = EMAIL2;
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey;
      await overwriteTab('sheet1', 'Raffle', rows(500));
      expect(calls).toHaveLength(1);
      expect(calls[0].rows).toBe(500);
      expect(decodeURIComponent(calls[0].url)).toContain('Raffle!A1');
    } finally { restore(); }
  });

  it('splits a large snapshot into 10k-row batches at the right offsets', async () => {
    // 25,000 raffle entries is a plausible mid-campaign size, and well past the
    // point where a single request stops working.
    stubFetch(0);
    try {
      await overwriteTab('sheet1', 'Raffle', rows(25_000));
      expect(calls.map((c) => c.rows)).toEqual([10_000, 10_000, 5_000]);
      // Each batch must start exactly where the previous one ended, or rows
      // would be overwritten or left behind.
      const starts = calls.map((c) =>
        decodeURIComponent(c.url).match(/Raffle!A(\d+)/)?.[1],
      );
      expect(starts).toEqual(['1', '10001', '20001']);
      expect(calls[0].firstCell).toBe('row1');
      expect(calls[1].firstCell).toBe('row10001');
      expect(calls[2].firstCell).toBe('row20001');
    } finally { restore(); }
  });

  it('keeps no request above the batch size, however big the campaign gets', async () => {
    stubFetch(0);
    try {
      await overwriteTab('sheet1', 'Raffle', rows(300_000));
      expect(calls).toHaveLength(30);
      expect(Math.max(...calls.map((c) => c.rows))).toBe(10_000);
      // Every row is written exactly once.
      expect(calls.reduce((sum, c) => sum + c.rows, 0)).toBe(300_000);
    } finally { restore(); }
  });

  it('trims rows left over from a bigger previous snapshot', async () => {
    stubFetch(900); // sheet currently holds more than we are about to write
    try {
      await overwriteTab('sheet1', 'Raffle', rows(500));
      const clear = calls.find((c) => c.url.includes(':clear'));
      expect(clear).toBeDefined();
      expect(decodeURIComponent(clear!.url)).toContain('Raffle!A501:Z900');
    } finally { restore(); }
  });

  it('does not trim when the snapshot grew, which is the normal case', async () => {
    stubFetch(500);
    try {
      await overwriteTab('sheet1', 'Raffle', rows(900));
      expect(calls.some((c) => c.url.includes(':clear'))).toBe(false);
    } finally { restore(); }
  });
});
