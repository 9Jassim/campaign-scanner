import { createSign } from 'node:crypto';

/**
 * Minimal Google Sheets client.
 *
 * Talks to the REST API directly with a service-account JWT rather than pulling
 * in `googleapis`, which is enormous and would weigh on every cold start for the
 * three calls we actually make. The same reasoning as `lib/crypto.ts` and
 * `lib/webhook.ts`, which hand-roll AES-GCM and HMAC.
 *
 * Setup (done once, by hand, in Google Cloud):
 *   1. Enable the Google Sheets API.
 *   2. Create a service account and download its JSON key.
 *   3. Share each store's sheet with the service account email as Editor.
 *   4. Put the sheet id (from its URL) in Settings for that store.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const REQUEST_TIMEOUT_MS = 30_000;

/** Whether a service account is configured (without throwing). */
export function hasSheetsCredentials(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build the signed assertion Google exchanges for an access token.
 * Exported for testing — the signature is checked against the public key there.
 */
export function buildServiceAccountJwt(
  email: string,
  privateKey: string,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(
      // Vercel env vars can't hold real newlines, so the key is stored with
      // literal \n escapes and restored here.
      privateKey.replace(/\\n/g, '\n'),
    );
  return `${signingInput}.${base64url(signature)}`;
}

// Access tokens last an hour; reuse within a warm instance rather than paying
// for a token exchange on every tab we write.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not set',
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildServiceAccountJwt(email, privateKey),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new Error(
      `Google token exchange failed (HTTP ${res.status}): ${
        data?.error_description ?? data?.error ?? 'no access_token returned'
      }`,
    );
  }

  cachedToken = {
    token: data.access_token,
    // Retire it a minute early so a call can't start on a token that expires
    // mid-flight.
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return cachedToken.token;
}

async function sheetsFetch(
  path: string,
  init: RequestInit & { method: string },
): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } })?.error?.message ??
      `HTTP ${res.status}`;
    throw new Error(`Google Sheets API: ${message}`);
  }
  return data;
}

/** How many rows a tab currently holds (including its header). */
export async function tabRowCount(
  sheetId: string,
  tab: string,
): Promise<number> {
  const data = (await sheetsFetch(
    `${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${tab}!A:A`)}`,
    { method: 'GET' },
  )) as { values?: unknown[][] };
  return data.values?.length ?? 0;
}

/**
 * Rows per write request.
 *
 * The whole snapshot in one request stops working as the campaign grows: a
 * six-month raffle can reach hundreds of thousands of entries, and at ~90 bytes
 * a row that is a payload Google rejects or times out on. 10k rows is roughly
 * 1 MB, comfortably inside the limits, and keeps each request quick enough that
 * a retry is cheap.
 */
const ROWS_PER_REQUEST = 10_000;

/**
 * Replace a tab's contents with `values` (row 1 being the header).
 *
 * Writes in batches, then trims any rows left over from a longer previous
 * snapshot. Deliberately not clear-then-write: that leaves the tab empty in
 * between, so a failure at the wrong moment would wipe the backup rather than
 * leave the old copy in place. Since the data only grows, the trim is usually
 * a no-op.
 *
 * Batches are written top-down, and the tabs large enough to need several are
 * append-only in a stable order (raffle by entry number, log by time), so a
 * failure partway leaves the earlier rows correct and the later ones stale —
 * never scrambled — and the next sync repairs it.
 */
export async function overwriteTab(
  sheetId: string,
  tab: string,
  values: string[][],
): Promise<void> {
  const id = encodeURIComponent(sheetId);
  const before = await tabRowCount(sheetId, tab);

  for (let offset = 0; offset < values.length; offset += ROWS_PER_REQUEST) {
    const chunk = values.slice(offset, offset + ROWS_PER_REQUEST);
    const firstRow = offset + 1; // Sheets rows are 1-based
    await sheetsFetch(
      `${id}/values/${encodeURIComponent(
        `${tab}!A${firstRow}`,
      )}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: chunk }) },
    );
  }

  if (before > values.length) {
    await sheetsFetch(
      `${id}/values/${encodeURIComponent(
        `${tab}!A${values.length + 1}:Z${before}`,
      )}:clear`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }
}
