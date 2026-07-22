import { Prisma } from '@prisma/client';
import { db } from './db';
import { readTab } from './google-sheets';
import { SCAN_LOCK_TIMEOUT, storeLockKey } from './store-lock';
import {
  FAILOVER_LOG_TAB,
  parseFailoverLog,
  type ParsedRow,
} from './failover-import';

/**
 * Database + Google Sheets side of the failover import.
 *
 * `previewImport` reads the sheet and reports what *would* happen without
 * touching the database. `runImport` re-reads the sheet fresh, writes each new
 * scan under the store's advisory lock, and records one audit-log entry.
 *
 * It never sends WhatsApp: the failover scanner already messaged the customer,
 * so imported receipts are marked `sent-via-failover` and keep whatever wamid
 * the sheet carried. Row building for the DB mirrors `lib/scan.ts` minus the
 * send.
 */

/** The range that covers every Log column (Timestamp … Cashier Note). */
const LOG_RANGE = `${FAILOVER_LOG_TAB}!A:J`;

/** Marks a receipt whose message was sent by the failover scanner, not us. */
export const FAILOVER_MESSAGE_STATUS = 'sent-via-failover';

export type RowStatus = 'new' | 'duplicate' | 'error';

export interface PreviewRow {
  row: number;
  status: RowStatus;
  invoiceId: string;
  name: string;
  phone: string;
  amount: number | null;
  entries: number | null;
  error?: string;
}

export interface PreviewReport {
  ok: true;
  storeId: string;
  storeName: string;
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: PreviewRow[];
}

export interface ImportReport {
  success: true;
  storeId: string;
  storeName: string;
  totalRows: number;
  imported: number;
  skippedAsDuplicates: number;
  errors: { row: number; invoiceId: string; error: string }[];
  importedAt: string; // ISO
}

export interface Failure {
  ok: false;
  error: string;
}

type StoreRow = {
  id: string;
  nameEn: string;
  bdPerEntry: Prisma.Decimal;
  failoverSheetId: string | null;
};

async function loadStore(storeId: string): Promise<StoreRow | null> {
  return db.store.findUnique({
    where: { id: storeId },
    select: { id: true, nameEn: true, bdPerEntry: true, failoverSheetId: true },
  });
}

/** Turn a raw Sheets API error into something an admin can act on. */
function friendlySheetError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission/i.test(msg)) {
    const who =
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? 'the service account';
    return `The sheet is not shared with the service account (${who}). Share it as an Editor and try again.`;
  }
  if (/unable to parse range/i.test(msg)) {
    return `The sheet has no "${FAILOVER_LOG_TAB}" tab.`;
  }
  if (/not found|requested entity/i.test(msg)) {
    return 'Sheet not found — check the Sheet ID is correct.';
  }
  return msg;
}

/** Which of `invoiceIds` already exist in this store (single query). */
async function existingInvoiceIds(
  storeId: string,
  invoiceIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(invoiceIds.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const found = await db.receipt.findMany({
    where: { storeId, invoiceId: { in: unique } },
    select: { invoiceId: true },
  });
  return new Set(found.map((r) => r.invoiceId));
}

/** Read + parse the failover Log. Shared by preview and confirm. */
async function readAndParse(
  store: StoreRow,
  sheetId: string,
): Promise<
  | { ok: true; sheetId: string; bdPerEntry: number; rows: ReturnType<typeof parseFailoverLog>['rows'] }
  | Failure
> {
  const sid = (sheetId || store.failoverSheetId || '').trim();
  if (!sid) return { ok: false, error: 'No failover Sheet ID provided.' };

  let grid: string[][];
  try {
    grid = await readTab(sid, LOG_RANGE);
  } catch (err) {
    return { ok: false, error: friendlySheetError(err) };
  }

  const bdPerEntry = Number(store.bdPerEntry);
  const { headerError, rows } = parseFailoverLog(grid, bdPerEntry);
  if (headerError) return { ok: false, error: headerError };

  return { ok: true, sheetId: sid, bdPerEntry, rows };
}

/**
 * Read the failover sheet and report what an import would do — new vs duplicate
 * vs error, per row. No database writes, no audit entry.
 */
export async function previewImport(
  storeId: string,
  sheetId: string,
): Promise<PreviewReport | Failure> {
  const store = await loadStore(storeId);
  if (!store) return { ok: false, error: 'Unknown store.' };

  const parsed = await readAndParse(store, sheetId);
  if (!parsed.ok) return parsed;

  const invoiceIds = parsed.rows.flatMap((r) =>
    r.ok ? [r.parsed.invoiceId] : [],
  );
  const existing = await existingInvoiceIds(storeId, invoiceIds);

  const rows: PreviewRow[] = parsed.rows.map((r) => {
    if (!r.ok) {
      return {
        row: r.error.row,
        status: 'error',
        invoiceId: r.error.invoiceId,
        name: '',
        phone: '',
        amount: null,
        entries: null,
        error: r.error.error,
      };
    }
    const p = r.parsed;
    return {
      row: p.row,
      status: existing.has(p.invoiceId) ? 'duplicate' : 'new',
      invoiceId: p.invoiceId,
      name: p.name,
      phone: p.phone,
      amount: p.amount,
      entries: p.entries,
    };
  });

  return {
    ok: true,
    storeId,
    storeName: store.nameEn,
    totalRows: rows.length,
    newCount: rows.filter((r) => r.status === 'new').length,
    duplicateCount: rows.filter((r) => r.status === 'duplicate').length,
    errorCount: rows.filter((r) => r.status === 'error').length,
    rows,
  };
}

/**
 * Import one parsed row under the store's advisory lock: duplicate check,
 * contact upsert, receipt (marked sent-via-failover), and sequential raffle
 * entries. Mirrors the scan transaction in `lib/scan.ts` without any WhatsApp
 * send. Returns whether the row was written or skipped as a duplicate.
 */
async function importRow(
  storeId: string,
  p: ParsedRow,
): Promise<'imported' | 'duplicate'> {
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = '${SCAN_LOCK_TIMEOUT}'`,
        );
        // Serialize against live scans and other imported rows in this store,
        // so MAX(entry_number)+1 below stays correct even mid-recovery.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${storeLockKey(storeId)}::bigint)`;

        const existing = await tx.receipt.findFirst({
          where: { storeId, invoiceId: p.invoiceId },
          select: { id: true },
        });
        if (existing) return 'duplicate' as const;

        const existingContact = await tx.contact.findUnique({
          where: { storeId_phone: { storeId, phone: p.phone } },
        });

        let contact;
        if (existingContact) {
          contact = await tx.contact.update({
            where: { id: existingContact.id },
            data: {
              name: p.name,
              totalBd: { increment: p.amount },
              totalEntries: { increment: p.entries },
              invoiceCount: { increment: 1 },
              invoiceIds: { push: p.invoiceId },
              lastSeen: new Date(),
            },
          });
        } else {
          contact = await tx.contact.create({
            data: {
              storeId,
              name: p.name,
              phone: p.phone,
              totalBd: new Prisma.Decimal(p.amount),
              totalEntries: p.entries,
              invoiceCount: 1,
              invoiceIds: [p.invoiceId],
            },
          });
        }

        const receipt = await tx.receipt.create({
          data: {
            storeId,
            contactId: contact.id,
            invoiceId: p.invoiceId,
            amount: new Prisma.Decimal(p.amount),
            entries: p.entries,
            totalEntriesAtTime: contact.totalEntries,
            cashierNote: p.note,
            // Sent by the failover scanner, not the portal. Keep its wamid if it
            // gave us one; there is deliberately no send here.
            wamid: p.wamid,
            messageStatus: FAILOVER_MESSAGE_STATUS,
          },
        });

        const agg = await tx.raffleEntry.aggregate({
          where: { storeId },
          _max: { entryNumber: true },
        });
        const startNumber = (agg._max.entryNumber ?? 0) + 1;

        await tx.raffleEntry.createMany({
          data: Array.from({ length: p.entries }, (_, i) => ({
            storeId,
            receiptId: receipt.id,
            contactId: contact.id,
            entryNumber: startNumber + i,
            name: p.name,
            phone: p.phone,
            invoiceId: p.invoiceId,
          })),
        });

        return 'imported' as const;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15_000,
      },
    );
  } catch (err) {
    // A concurrent insert of the same invoice raced our pre-check — that is a
    // duplicate, not a failure.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      String(err.meta?.target ?? '').includes('invoice')
    ) {
      return 'duplicate';
    }
    throw err;
  }
}

/**
 * Re-read the failover sheet and import every new scan. Per-row transactions,
 * so one bad row never rolls back the rest. Writes a single audit-log entry
 * summarising the run. Does not clear the sheet — a human does that after
 * checking the result.
 */
export async function runImport(
  storeId: string,
  sheetId: string,
  userId: string,
): Promise<ImportReport | Failure> {
  const store = await loadStore(storeId);
  if (!store) return { ok: false, error: 'Unknown store.' };

  const parsed = await readAndParse(store, sheetId);
  if (!parsed.ok) return parsed;

  const errors: { row: number; invoiceId: string; error: string }[] = [];
  let imported = 0;
  let skipped = 0;

  for (const r of parsed.rows) {
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    try {
      const outcome = await importRow(storeId, r.parsed);
      if (outcome === 'imported') imported++;
      else skipped++;
    } catch (err) {
      errors.push({
        row: r.parsed.row,
        invoiceId: r.parsed.invoiceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const report: ImportReport = {
    success: true,
    storeId,
    storeName: store.nameEn,
    totalRows: parsed.rows.length,
    imported,
    skippedAsDuplicates: skipped,
    errors,
    importedAt: new Date().toISOString(),
  };

  // One audit entry per run. A failure to record it must not fail the import —
  // the scans are already committed.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'failover_import',
        entityType: 'store',
        entityId: storeId,
        changes: {
          sheetId: parsed.sheetId,
          totalRows: report.totalRows,
          imported,
          skipped,
          errors,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error('[failover-import] could not write audit log:', err);
  }

  return report;
}
