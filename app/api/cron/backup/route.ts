import { timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import {
  CONTACTS_TAB,
  LOG_TAB,
  RAFFLE_TAB,
  contactsValues,
  isSafeToOverwrite,
  logValues,
  raffleValues,
} from '@/lib/backup';
import {
  hasSheetsCredentials,
  overwriteTab,
  tabRowCount,
} from '@/lib/google-sheets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A full snapshot of three tabs for every store; well past the default 10s.
export const maxDuration = 300;

/**
 * Weekly backup: replace each store's Google Sheet with a full snapshot.
 *
 * The sheet is a human-readable backup, and its own Apps Script archives it
 * weekly. Because every sync writes a COMPLETE snapshot rather than a delta,
 * the archive captures a valid copy whenever it runs — ordering the two jobs
 * only decides how fresh the archive is, never whether it is complete.
 *
 * Triggered by Vercel Cron (see vercel.json). Public route (no session), so it
 * authenticates with CRON_SECRET, which Vercel sends as a bearer token.
 */

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unset = refuse, never run unauthenticated

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface StoreResult {
  store: string;
  status: 'ok' | 'skipped' | 'refused' | 'failed';
  detail: string;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    console.error('[backup] refused: bad or missing CRON_SECRET');
    return new Response('Unauthorized', { status: 401 });
  }

  if (!hasSheetsCredentials()) {
    console.error(
      '[backup] GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY are not set — nothing was backed up.',
    );
    return Response.json(
      { ok: false, error: 'Google service account not configured' },
      { status: 503 },
    );
  }

  const stores = await db.store.findMany({
    select: { id: true, slug: true, googleSheetId: true },
    orderBy: { slug: 'asc' },
  });

  const results: StoreResult[] = [];
  for (const store of stores) {
    if (!store.googleSheetId) {
      results.push({
        store: store.slug,
        status: 'skipped',
        detail: 'no Sheet ID set in Settings',
      });
      continue;
    }
    // One store's failure must not stop the other's backup.
    try {
      results.push(await backupStore(store.id, store.slug, store.googleSheetId));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[backup] ${store.slug}: FAILED — ${detail}`);
      results.push({ store: store.slug, status: 'failed', detail });
    }
  }

  const failed = results.some((r) => r.status === 'failed' || r.status === 'refused');
  console.log(
    `[backup] done: ${results.map((r) => `${r.store}=${r.status}`).join(' ')}`,
  );
  // 500 makes a broken backup visible in Vercel's cron history instead of
  // looking like a success that quietly wrote nothing.
  return Response.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
}

async function backupStore(
  storeId: string,
  slug: string,
  sheetId: string,
): Promise<StoreResult> {
  const [contacts, receipts, entries] = await Promise.all([
    db.contact.findMany({
      where: { storeId },
      orderBy: { lastSeen: 'desc' },
      select: {
        name: true,
        phone: true,
        totalBd: true,
        totalEntries: true,
        lastSeen: true,
        invoiceCount: true,
        invoiceIds: true,
      },
    }),
    db.receipt.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        invoiceId: true,
        amount: true,
        entries: true,
        totalEntriesAtTime: true,
        messageStatus: true,
        messageError: true,
        wamid: true,
        cashierNote: true,
        contact: { select: { name: true, phone: true } },
      },
    }),
    db.raffleEntry.findMany({
      where: { storeId },
      orderBy: { entryNumber: 'asc' },
      select: {
        entryNumber: true,
        name: true,
        phone: true,
        invoiceId: true,
        createdAt: true,
      },
    }),
  ]);

  const tabs: Array<[string, string[][]]> = [
    [CONTACTS_TAB, contactsValues(contacts)],
    [LOG_TAB, logValues(receipts)],
    [RAFFLE_TAB, raffleValues(entries)],
  ];

  // Check every tab before writing any: a snapshot that would shrink one tab is
  // wrong about the whole store, so don't half-apply it.
  for (const [tab, values] of tabs) {
    const existing = await tabRowCount(sheetId, tab);
    if (!isSafeToOverwrite(existing, values.length)) {
      const detail =
        `refusing to shrink '${tab}' from ${existing} to ${values.length} rows — ` +
        `the sheet holds more than the database does. Nothing was written.`;
      console.error(`[backup] ${slug}: ${detail}`);
      return { store: slug, status: 'refused', detail };
    }
  }

  for (const [tab, values] of tabs) {
    await overwriteTab(sheetId, tab, values);
  }

  const detail = `${contacts.length} contacts, ${receipts.length} receipts, ${entries.length} raffle entries`;
  console.log(`[backup] ${slug}: wrote ${detail}`);
  return { store: slug, status: 'ok', detail };
}
