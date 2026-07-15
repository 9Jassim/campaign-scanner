import { Prisma } from '@prisma/client';
import type { Contact, Receipt, Store, UserProfile } from '@prisma/client';
import { db } from './db';
import { normalizePhone } from './barcode';
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
      | 'conflict' = 'validation',
  ) {
    super(message);
    this.name = 'ScanError';
  }
}

/**
 * Process a scan atomically: duplicate check, contact upsert, receipt creation,
 * and raffle-entry generation. WhatsApp sending is intentionally not performed
 * here yet — receipts are created with `messageStatus: 'skipped'`.
 *
 * The transaction runs at Serializable isolation so concurrent cashier scans in
 * the same store cannot allocate the same raffle entry number; on a transient
 * write conflict we retry a few times.
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
  // the scan, and we never want to hold a Serializable txn open across a
  // network call). ---
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

          // Next sequential entry number for this store.
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
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        // Unique violation → most likely a duplicate invoice from a concurrent
        // scan that beat our pre-check.
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
