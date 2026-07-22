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
 * Pushes each store's data into its Google Sheets.
 *
 * Two sheets per store, synced back-to-back nightly:
 *
 * 1. The MIRROR sheet — a readable full copy (Contacts/Log/Raffle) people
 *    actually look at; its own Apps Script archives it weekly.
 * 2. The FAILOVER sheet — a standalone scanner used only during portal
 *    outages. Only its CONTACTS tab is synced, so its Apps Script knows every
 *    customer's cumulative entry total and outage messages state the right
 *    numbers. Its Log and Raffle tabs stay empty until an outage — they are
 *    what /admin/import-failover reads back in afterwards.
 *
 * The portal is the source of truth either way — this module never reads data
 * back out. A failover write failure never fails the mirror sync: it is logged,
 * recorded on the store (so /admin/sheets shows it red), and surfaced through
 * the cron's non-200 response.
 *
 * Run by the nightly cron and by the admin page, so it lives here rather than
 * in either. Row building stays in `lib/backup.ts`, which is pure and tested;
 * this is the part that needs a database and a network.
 */

export type SyncStatus = 'ok' | 'skipped' | 'refused' | 'failed';

export interface SyncResult {
  store: string;
  /** Mirror sheet outcome. */
  status: SyncStatus;
  detail: string;
  /** Failover-sheet Contacts push outcome — independent of the mirror's. */
  failoverStatus: SyncStatus;
  failoverDetail: string;
}

/** What syncStore needs to know about a store. */
export interface StoreSyncTarget {
  id: string;
  slug: string;
  googleSheetId: string | null;
  failoverSheetId: string | null;
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
    select: { id: true, slug: true, googleSheetId: true, failoverSheetId: true },
    orderBy: { slug: 'asc' },
  });

  const results: SyncResult[] = [];
  for (const store of stores) {
    // One store's failure must not stop the other's — they are separate
    // companies and neither should suffer for the other's misconfiguration.
    results.push(await syncStore(store, options));
  }
  return results;
}

/**
 * Sync one store: mirror sheet first, then the failover sheet's Contacts tab.
 * Never throws — each outcome comes back in the result, independently.
 */
export async function syncStore(
  target: StoreSyncTarget,
  options: SyncOptions = {},
): Promise<SyncResult> {
  let mirror: { status: SyncStatus; detail: string };
  if (!target.googleSheetId) {
    mirror = { status: 'skipped', detail: 'No Sheet ID set for this store.' };
  } else {
    try {
      mirror = await writeMirror(target.id, target.slug, target.googleSheetId, options);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[sheets-sync] ${target.slug}: FAILED — ${detail}`);
      mirror = { status: 'failed', detail };
    }
  }

  // Right after the mirror — and regardless of how the mirror fared: the two
  // sheets are independent, and outage-message accuracy shouldn't wait on a
  // mirror misconfiguration (or vice versa).
  const failover = await writeFailoverContacts(target, options);

  return record(target.id, {
    store: target.slug,
    status: mirror.status,
    detail: mirror.detail,
    failoverStatus: failover.status,
    failoverDetail: failover.detail,
  });
}

async function writeMirror(
  storeId: string,
  slug: string,
  sheetId: string,
  options: SyncOptions,
): Promise<{ status: SyncStatus; detail: string }> {
  const [contacts, receipts, entries] = await Promise.all([
    fetchContacts(storeId),
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
        return { status: 'refused', detail };
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
  return { status: 'ok', detail };
}

/**
 * Push current contacts into the failover sheet — Contacts tab ONLY. Log and
 * Raffle stay untouched: empty in normal times, and holding outage scans the
 * import needs when they are not.
 *
 * Refuses when the failover Log tab holds un-imported scans: overwriting
 * Contacts then would hand the outage script totals that are MISSING those
 * scans — exactly the inaccuracy this sync exists to prevent. Import first,
 * clear the sheet, and the next sync resumes.
 */
async function writeFailoverContacts(
  target: StoreSyncTarget,
  options: SyncOptions,
): Promise<{ status: SyncStatus; detail: string }> {
  if (!target.failoverSheetId) {
    return { status: 'skipped', detail: 'No failover Sheet ID set.' };
  }

  try {
    const logRows = await tabRowCount(target.failoverSheetId, LOG_TAB);
    if (logRows > 1) {
      const detail =
        `Refused: the failover sheet's Log tab holds ${logRows - 1} un-imported ` +
        `scan(s). Import them from the Failover page and clear the sheet; ` +
        `this sync then resumes on its own.`;
      console.error(`[sheets-sync] ${target.slug} failover: ${detail}`);
      return { status: 'refused', detail };
    }

    const contacts = await fetchContacts(target.id);
    const values = contactsValues(contacts);

    if (!options.force) {
      const existing = await tabRowCount(target.failoverSheetId, CONTACTS_TAB);
      if (!isSafeToOverwrite(existing, values.length)) {
        const detail =
          `Refused: writing '${CONTACTS_TAB}' would cut it from ${existing} to ` +
          `${values.length} rows. Use "Force" after deliberately clearing data.`;
        console.error(`[sheets-sync] ${target.slug} failover: ${detail}`);
        return { status: 'refused', detail };
      }
    }

    await overwriteTab(target.failoverSheetId, CONTACTS_TAB, values);
    const detail =
      `${contacts.length} contacts` + (options.force ? ' (forced)' : '');
    console.log(`[sheets-sync] ${target.slug} failover: wrote ${detail}`);
    return { status: 'ok', detail };
  } catch (err) {
    // Log-and-record, never throw: a broken failover sheet must not fail the
    // mirror sync. The admin sees it on /admin/sheets and in the cron result.
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[sheets-sync] ${target.slug} failover: FAILED — ${detail}`);
    return { status: 'failed', detail };
  }
}

/** Contact rows in the shape `contactsValues` wants — shared by both sheets. */
function fetchContacts(storeId: string) {
  return db.contact.findMany({
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
  });
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
        lastFailoverSyncAt: new Date(),
        lastFailoverSyncStatus: result.failoverStatus,
        lastFailoverSyncDetail: result.failoverDetail,
      },
    });
  } catch (err) {
    // Losing the audit trail must not turn a successful sync into a failure.
    console.error('[sheets-sync] could not record sync status:', err);
  }
  return result;
}
