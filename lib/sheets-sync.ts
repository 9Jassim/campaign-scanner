import { db } from './db';
import {
  CONTACTS_TAB,
  LOG_TAB,
  RAFFLE_TAB,
  contactsValues,
  isSafeToOverwrite,
  logValues,
  raffleValues,
} from './backup';
import { hasSheetsCredentials, overwriteTab, tabRowCount } from './google-sheets';

/**
 * Pushes each store's data into its Google Sheet.
 *
 * The sheet is a readable copy people actually look at, refreshed nightly, and
 * the sheet's own Apps Script archives it weekly. The portal is the source of
 * truth either way — nothing is ever read back out.
 *
 * Run by the nightly cron and by the admin page, so it lives here rather than
 * in either. Row building stays in `lib/backup.ts`, which is pure and tested;
 * this is the part that needs a database and a network.
 */

export type SyncStatus = 'ok' | 'skipped' | 'refused' | 'failed';

export interface SyncResult {
  store: string;
  status: SyncStatus;
  detail: string;
}

export interface SyncOptions {
  /**
   * Write even if it would delete rows.
   *
   * Only ever set from a deliberate admin action. The guard exists because a
   * shrinking snapshot usually means something is wrong; the one time it is
   * expected is right after the database is cleared, when the sheet still holds
   * the old rows.
   */
  force?: boolean;
}

/** Sync every store that has a Sheet ID. Never throws. */
export async function syncAllStores(
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  if (!hasSheetsCredentials()) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not set',
    );
  }

  const stores = await db.store.findMany({
    select: { id: true, slug: true, googleSheetId: true },
    orderBy: { slug: 'asc' },
  });

  const results: SyncResult[] = [];
  for (const store of stores) {
    // One store's failure must not stop the other's — they are separate
    // companies and neither should suffer for the other's misconfiguration.
    results.push(await syncStore(store.id, store.slug, store.googleSheetId, options));
  }
  return results;
}

/** Sync one store. Never throws: the outcome comes back as a result. */
export async function syncStore(
  storeId: string,
  slug: string,
  sheetId: string | null,
  options: SyncOptions = {},
): Promise<SyncResult> {
  if (!sheetId) {
    return record(storeId, {
      store: slug,
      status: 'skipped',
      detail: 'No Sheet ID set for this store.',
    });
  }

  try {
    return record(storeId, await writeStore(storeId, slug, sheetId, options));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[sheets-sync] ${slug}: FAILED — ${detail}`);
    return record(storeId, { store: slug, status: 'failed', detail });
  }
}

async function writeStore(
  storeId: string,
  slug: string,
  sheetId: string,
  options: SyncOptions,
): Promise<SyncResult> {
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

  if (!options.force) {
    // Check every tab before writing any: a snapshot that would shrink one tab
    // is wrong about the whole store, so don't half-apply it.
    for (const [tab, values] of tabs) {
      const existing = await tabRowCount(sheetId, tab);
      if (!isSafeToOverwrite(existing, values.length)) {
        const detail =
          `Refused: writing '${tab}' would cut it from ${existing} to ${values.length} rows. ` +
          `The sheet holds more than the database does. Nothing was written — ` +
          `use "Sync now (force)" if the sheet is holding rows you meant to delete.`;
        console.error(`[sheets-sync] ${slug}: ${detail}`);
        return { store: slug, status: 'refused', detail };
      }
    }
  }

  for (const [tab, values] of tabs) {
    await overwriteTab(sheetId, tab, values);
  }

  const detail =
    `${contacts.length} contacts, ${receipts.length} receipts, ` +
    `${entries.length} raffle entries` +
    (options.force ? ' (forced)' : '');
  console.log(`[sheets-sync] ${slug}: wrote ${detail}`);
  return { store: slug, status: 'ok', detail };
}

/** Save the outcome on the store so the admin page can show it. */
async function record(storeId: string, result: SyncResult): Promise<SyncResult> {
  try {
    await db.store.update({
      where: { id: storeId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: result.status,
        lastSyncDetail: result.detail,
      },
    });
  } catch (err) {
    // Losing the audit trail must not turn a successful sync into a failure.
    console.error('[sheets-sync] could not record sync status:', err);
  }
  return result;
}
