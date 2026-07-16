import { Prisma } from '@prisma/client';
import type { Contact, Receipt, Store, UserProfile } from '@prisma/client';
import { db } from './db';
import { normalizePhone } from './barcode';
import { SCAN_LOCK_TIMEOUT, storeLockKey } from './store-lock';
import { sendWhatsApp, hasWhatsAppCredentials } from './whatsapp';

export interface ScanInput {
  invoiceId: string;
  name: string;
  phone: string;
  amount: number;
  note?: string | null;
}

/** Outcome of the WhatsApp send attempt for this scan. */
export interface ScanMessageResult {
  status: 'sent' | 'failed' | 'skipped' | 'pending';
  wamid?: string;
  error?: string;
  /** Rate-limited and queued for retry. */
  queuedForRetry?: boolean;
}

export interface ScanResult {
  receipt: Receipt;
  contact: Contact;
  entries: number;
  message: ScanMessageResult;
}

/**
 * A scan error the API can map to a 4xx response with a clear message.
 */
export class ScanError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'validation'
      | 'duplicate'
      | 'below_minimum'
      | 'conflict'
      | 'busy' = 'validation',
  ) {
    super(message);
    this.name = 'ScanError';
  }
}

/**
 * Process a scan atomically: duplicate check, contact upsert, receipt creation,
 * and raffle-entry generation. The WhatsApp send happens after the commit.
 *
 * Concurrency: each scan takes a Postgres advisory lock keyed to its store, so
 * scans in one store queue behind each other while the two stores stay fully
 * independent — a Modern Sources till is never blocked by a Morslon scan. The
 * lock releases automatically when the transaction ends.
 *
 * The lock is what makes the read-then-write steps safe (invoice check, contact
 * upsert, and above all `MAX(entry_number) + 1`).
 */
export async function processScan(
  store: Store,
  cashier: UserProfile,
  input: ScanInput,
): Promise<ScanResult> {
  const invoiceId = input.invoiceId?.trim();
  const name = input.name?.trim();
  const phone = input.phone ? normalizePhone(input.phone) : '';
  const amount = input.amount;

  if (!invoiceId || !name || !phone || !(amount > 0)) {
    throw new ScanError('Missing required fields (invoice, name, phone, amount)');
  }

  const bdPerEntry = Number(store.bdPerEntry);
  const entries = Math.floor(amount / bdPerEntry);
  if (entries < 1) {
    throw new ScanError(
      `Minimum ${store.bdPerEntry} BD required for 1 entry`,
      'below_minimum',
    );
  }

  const willSend = hasWhatsAppCredentials(store);

  const committed = await runScanTransaction();

  // --- WhatsApp (outside the transaction: a send failure must not roll back
  // the scan, and holding the store's lock across a network call would stall
  // every other till in that shop). ---
  const message = await deliverWhatsApp(store, committed, {
    name,
    phone,
    entries,
    willSend,
  });

  return { ...committed, message };

  async function runScanTransaction() {
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.$transaction(
        async (tx) => {
          // Don't wait forever behind a stuck scan — fail cleanly instead.
          await tx.$executeRawUnsafe(
            `SET LOCAL statement_timeout = '${SCAN_LOCK_TIMEOUT}'`,
          );

          // Serialize scans within this store, and only this store. Everything
          // below reads-then-writes, so it must happen under the lock.
          //
          // $executeRaw, not $queryRaw: the function returns `void`, and the
          // Neon adapter cannot deserialize a void column (UnsupportedNative-
          // DataType). $executeRaw only counts rows, so it never looks.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${storeLockKey(store.id)}::bigint)`;

          // Duplicate check (the unique constraint is the real guard; this
          // gives a clean error before we do any writes).
          const existing = await tx.receipt.findFirst({
            where: { storeId: store.id, invoiceId },
            select: { id: true },
          });
          if (existing) {
            throw new ScanError(
              `Invoice ${invoiceId} already scanned`,
              'duplicate',
            );
          }

          // Upsert contact by (storeId, phone).
          const existingContact = await tx.contact.findUnique({
            where: { storeId_phone: { storeId: store.id, phone } },
          });

          let contact: Contact;
          if (existingContact) {
            contact = await tx.contact.update({
              where: { id: existingContact.id },
              data: {
                name, // update name in case of a typo correction
                totalBd: { increment: amount },
                totalEntries: { increment: entries },
                invoiceCount: { increment: 1 },
                invoiceIds: { push: invoiceId },
                lastSeen: new Date(),
              },
            });
          } else {
            contact = await tx.contact.create({
              data: {
                storeId: store.id,
                name,
                phone,
                totalBd: new Prisma.Decimal(amount),
                totalEntries: entries,
                invoiceCount: 1,
                invoiceIds: [invoiceId],
              },
            });
          }

          // Create the receipt.
          const receipt = await tx.receipt.create({
            data: {
              storeId: store.id,
              contactId: contact.id,
              invoiceId,
              amount: new Prisma.Decimal(amount),
              entries,
              totalEntriesAtTime: contact.totalEntries,
              cashierNote: input.note ?? null,
              cashierUserId: cashier.id,
              cashierEmail: cashier.email,
              // Sending happens after the transaction commits; stores without
              // WhatsApp credentials stay 'skipped'.
              messageStatus: willSend ? 'pending' : 'skipped',
            },
          });

          // Next sequential entry number for this store. Safe only because the
          // advisory lock above is held AND we read at Read Committed, so this
          // sees rows the previous scan committed while we waited.
          const agg = await tx.raffleEntry.aggregate({
            where: { storeId: store.id },
            _max: { entryNumber: true },
          });
          const startNumber = (agg._max.entryNumber ?? 0) + 1;

          await tx.raffleEntry.createMany({
            data: Array.from({ length: entries }, (_, i) => ({
              storeId: store.id,
              receiptId: receipt.id,
              contactId: contact.id,
              entryNumber: startNumber + i,
              name,
              phone,
              invoiceId,
            })),
          });

            return { receipt, contact, entries };
          },
          {
            // Read Committed, NOT Serializable — and the advisory lock depends
            // on it. Serializable freezes the transaction's snapshot at its
            // first statement, which here is the lock acquisition itself. A
            // scan that queued would take the lock and then still read the
            // world as it was before the winner committed, so MAX(entry_number)
            // would come back stale and it would allocate a duplicate anyway:
            // the lock would appear to work while protecting nothing. Read
            // Committed re-reads per statement, so waiting actually pays off.
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            // Must exceed statement_timeout so a lock wait surfaces as our own
            // 'busy' error rather than Prisma tearing the transaction down.
            timeout: 15_000,
          },
        );
      } catch (err) {
        // A ScanError is our own verdict (e.g. duplicate invoice) — never retry
        // it, or a real duplicate would be attempted three times over.
        if (err instanceof ScanError) throw err;

        // Waited out the lock: another till in this store is mid-scan and stuck.
        if (isStatementTimeout(err)) {
          throw new ScanError(
            'System busy, please try again',
            'busy',
          );
        }

        // Unique violation → a concurrent scan beat our pre-check.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const target = String(err.meta?.target ?? '');
          if (target.includes('invoice')) {
            throw new ScanError(
              `Invoice ${invoiceId} already scanned`,
              'duplicate',
            );
          }
          // Anything else unique — realistically (store_id, entry_number) —
          // means our allocation raced despite the lock. Retrying re-reads the
          // max and picks the next free number; this used to fall through to a
          // 500 and lose the scan.
          if (attempt < maxAttempts) continue;
        }

        // Transient serialization/write conflict → retry a couple of times.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034' &&
          attempt < maxAttempts
        ) {
          continue;
        }

        throw err;
      }
    }
  }
}

/**
 * Whether the transaction was cancelled by `statement_timeout` — which here
 * means it gave up waiting for the store's advisory lock.
 *
 * Postgres reports SQLSTATE 57014; Prisma surfaces raw-query failures without a
 * dedicated code, so match on what it does give us.
 */
function isStatementTimeout(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('57014') ||
    message.includes('canceling statement due to statement timeout')
  );
}

/**
 * Send the WhatsApp confirmation and record the outcome on the receipt.
 * Never throws — a messaging failure must not fail an already-committed scan.
 */
async function deliverWhatsApp(
  store: Store,
  committed: { receipt: Receipt; contact: Contact },
  params: {
    name: string;
    phone: string;
    entries: number;
    willSend: boolean;
  },
): Promise<ScanMessageResult> {
  if (!params.willSend) {
    return { status: 'skipped' };
  }

  try {
    const result = await sendWhatsApp(store, {
      name: params.name,
      phone: params.phone,
      entries: params.entries,
      totalEntries: committed.contact.totalEntries,
    });

    if (result.skipped) return { status: 'skipped' };

    if (result.wamid) {
      await db.receipt.update({
        where: { id: committed.receipt.id },
        data: { wamid: result.wamid, messageStatus: 'sent', messageError: null },
      });
      return { status: 'sent', wamid: result.wamid };
    }

    // Rate limited → keep it pending and queue a retry rather than marking it
    // permanently failed.
    if (result.rateLimited) {
      await db.$transaction([
        db.receipt.update({
          where: { id: committed.receipt.id },
          data: { messageStatus: 'pending', messageError: result.error ?? null },
        }),
        db.retryQueue.create({
          data: {
            receiptId: committed.receipt.id,
            lastError: result.error ?? 'Rate limited',
          },
        }),
      ]);
      return {
        status: 'pending',
        error: result.error,
        queuedForRetry: true,
      };
    }

    await db.receipt.update({
      where: { id: committed.receipt.id },
      data: { messageStatus: 'failed', messageError: result.error ?? null },
    });
    return { status: 'failed', error: result.error };
  } catch (err) {
    // Defensive: never let a messaging problem surface as a failed scan.
    const error =
      err instanceof Error ? err.message : 'Unexpected WhatsApp send error';
    console.error('WhatsApp send failed:', err);
    try {
      await db.receipt.update({
        where: { id: committed.receipt.id },
        data: { messageStatus: 'failed', messageError: error },
      });
    } catch {
      // ignore — the scan itself is already safely committed
    }
    return { status: 'failed', error };
  }
}
