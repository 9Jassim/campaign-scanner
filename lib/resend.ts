import type { UserProfile } from '@prisma/client';
import { db } from './db';
import { assertStoreAccess } from './auth';
import { hasWhatsAppCredentials, sendWhatsApp } from './whatsapp';

/**
 * Re-send the WhatsApp confirmation for a single receipt.
 *
 * For clearing messages that failed for a reason that has since been fixed —
 * e.g. a template recategorised to Utility after hitting 131049. Uses the
 * contact's CURRENT total so a message sent late still states the right number.
 *
 * Never auto-called: only an admin action triggers it. Refuses to re-send a
 * message that already reached the customer, so a stray click can't
 * double-message anyone.
 */

export interface ResendResult {
  status: string;
  error?: string;
}

/** Statuses that mean the customer already got it — don't send again. */
const ALREADY_DELIVERED = new Set(['sent', 'delivered', 'read']);

export async function resendReceipt(
  profile: UserProfile,
  receiptId: string,
): Promise<ResendResult> {
  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    include: { store: true, contact: true },
  });
  if (!receipt) throw new Error('Receipt not found');

  // Admin-only is enforced by the caller; scope to an accessible store too.
  await assertStoreAccess(profile, receipt.storeId);

  if (ALREADY_DELIVERED.has(receipt.messageStatus ?? '')) {
    return {
      status: receipt.messageStatus ?? '',
      error: 'Already sent to the customer — not resending.',
    };
  }

  if (!hasWhatsAppCredentials(receipt.store)) {
    await db.receipt.update({
      where: { id: receipt.id },
      data: { messageStatus: 'skipped' },
    });
    return { status: 'skipped', error: 'This store has no WhatsApp credentials.' };
  }

  const result = await sendWhatsApp(receipt.store, {
    name: receipt.contact.name,
    phone: receipt.contact.phone,
    entries: receipt.entries,
    totalEntries: receipt.contact.totalEntries,
  });

  if (result.skipped) {
    await db.receipt.update({
      where: { id: receipt.id },
      data: { messageStatus: 'skipped' },
    });
    return { status: 'skipped' };
  }

  if (result.wamid) {
    await db.receipt.update({
      where: { id: receipt.id },
      data: { wamid: result.wamid, messageStatus: 'sent', messageError: null },
    });
    return { status: 'sent' };
  }

  // Rate-limited → back to pending and onto the daily retry queue, exactly as a
  // fresh scan would handle it.
  if (result.rateLimited) {
    await db.$transaction([
      db.receipt.update({
        where: { id: receipt.id },
        data: { messageStatus: 'pending', messageError: result.error ?? null },
      }),
      db.retryQueue.create({
        data: { receiptId: receipt.id, lastError: result.error ?? 'Rate limited' },
      }),
    ]);
    return { status: 'pending', error: result.error };
  }

  await db.receipt.update({
    where: { id: receipt.id },
    data: { messageStatus: 'failed', messageError: result.error ?? null },
  });
  return { status: 'failed', error: result.error };
}
