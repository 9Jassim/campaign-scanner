import { db } from './db';
import { sendWhatsApp, hasWhatsAppCredentials } from './whatsapp';
import {
  BATCH_LIMIT,
  SEND_SPACING_MS,
  decideRetry,
  nextRetryDate,
} from './retry-policy';

/**
 * Drains the WhatsApp retry queue — receipts whose confirmation message was
 * rate-limited at scan time and is still owed to the customer.
 *
 * Run by the daily cron (scripts/message-retry.ts on Railway). One pass a
 * day, sends paced a
 * second apart, and every outcome either resolves the row (sent / failed /
 * skipped → row deleted) or reschedules it for tomorrow — a row can never be
 * tried twice in one run, and a receipt that is no longer `pending` is dropped
 * without sending, so nothing can double-message a customer.
 */

export interface RetrySummary {
  /** Rows that were due this run. */
  due: number;
  sent: number;
  /** Still throttled — rescheduled for tomorrow. */
  rateLimited: number;
  /** Permanently failed (hard error or attempts exhausted). */
  failed: number;
  /** Store no longer has WhatsApp credentials. */
  skipped: number;
  /** Receipt was no longer pending — resolved elsewhere, nothing sent. */
  dropped: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processRetryQueue(): Promise<RetrySummary> {
  const now = new Date();
  const rows = await db.retryQueue.findMany({
    where: { nextRetryAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: BATCH_LIMIT,
    include: {
      receipt: {
        include: { contact: true, store: true },
      },
    },
  });

  const summary: RetrySummary = {
    due: rows.length,
    sent: 0,
    rateLimited: 0,
    failed: 0,
    skipped: 0,
    dropped: 0,
  };

  let first = true;
  for (const row of rows) {
    const { receipt } = row;

    // Only a receipt still waiting on its message may be retried. Anything
    // else was resolved some other way — never send for it.
    if (receipt.messageStatus !== 'pending') {
      await db.retryQueue.delete({ where: { id: row.id } });
      summary.dropped++;
      continue;
    }

    // Credentials can be removed after a scan; sending is impossible then and
    // waiting will not help.
    if (!hasWhatsAppCredentials(receipt.store)) {
      await db.$transaction([
        db.receipt.update({
          where: { id: receipt.id },
          data: { messageStatus: 'skipped' },
        }),
        db.retryQueue.delete({ where: { id: row.id } }),
      ]);
      summary.skipped++;
      continue;
    }

    // Pace the sends — draining a queue at full speed into the API that
    // throttled us is how the queue got here in the first place.
    if (!first) await sleep(SEND_SPACING_MS);
    first = false;

    const result = await sendWhatsApp(receipt.store, {
      name: receipt.contact.name,
      phone: receipt.contact.phone,
      entries: receipt.entries,
      // The CURRENT total, not the scan-time one: the customer may have
      // scanned again since, and the total must be true on the day the
      // message finally arrives.
      totalEntries: receipt.contact.totalEntries,
    });

    const decision = decideRetry(result, row.attempts);
    switch (decision.kind) {
      case 'sent':
        await db.$transaction([
          db.receipt.update({
            where: { id: receipt.id },
            data: {
              wamid: decision.wamid,
              messageStatus: 'sent',
              messageError: null,
            },
          }),
          db.retryQueue.delete({ where: { id: row.id } }),
        ]);
        summary.sent++;
        break;

      case 'retry-later':
        await db.$transaction([
          db.retryQueue.update({
            where: { id: row.id },
            data: {
              attempts: { increment: 1 },
              lastError: decision.error,
              nextRetryAt: nextRetryDate(now),
            },
          }),
          db.receipt.update({
            where: { id: receipt.id },
            data: { messageError: decision.error },
          }),
        ]);
        summary.rateLimited++;
        break;

      case 'gave-up':
      case 'failed':
        await db.$transaction([
          db.receipt.update({
            where: { id: receipt.id },
            data: { messageStatus: 'failed', messageError: decision.error },
          }),
          db.retryQueue.delete({ where: { id: row.id } }),
        ]);
        summary.failed++;
        break;

      case 'skipped':
        // sendWhatsApp saw no credentials (race with the check above).
        await db.$transaction([
          db.receipt.update({
            where: { id: receipt.id },
            data: { messageStatus: 'skipped' },
          }),
          db.retryQueue.delete({ where: { id: row.id } }),
        ]);
        summary.skipped++;
        break;
    }
  }

  console.log(
    `[retry-queue] due=${summary.due} sent=${summary.sent} ` +
      `rateLimited=${summary.rateLimited} failed=${summary.failed} ` +
      `skipped=${summary.skipped} dropped=${summary.dropped}`,
  );
  return summary;
}
