import { db } from '@/lib/db';
import {
  resolveStatusUpdate,
  verifySignature,
  type StatusEvent,
} from '@/lib/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta WhatsApp webhook.
 *
 * GET  — the subscribe handshake: echo hub.challenge when the verify token matches.
 * POST — delivery status events (update the matching receipt by wamid) and
 *        inbound customer messages (logged for support to review).
 *
 * This route is public (excluded from auth in auth.config.ts); it authenticates
 * Meta via the verify token on GET and the payload signature on POST.
 */

// ---------------------------------------------------------------------------
// GET: verification handshake
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const expected = process.env.WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    console.error('WEBHOOK_VERIFY_TOKEN is not set; rejecting verification.');
    return new Response('Forbidden', { status: 403 });
  }

  if (mode === 'subscribe' && token === expected) {
    // Meta expects the raw challenge back as plain text.
    return new Response(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

// ---------------------------------------------------------------------------
// POST: events
// ---------------------------------------------------------------------------

interface WebhookValue {
  metadata?: { phone_number_id?: string };
  statuses?: StatusEvent[];
  messages?: IncomingMessage[];
}

interface IncomingMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
}

export async function POST(request: Request) {
  // Read the raw body: the signature is computed over the exact bytes sent.
  const raw = await request.text();

  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) {
    const signature = request.headers.get('x-hub-signature-256');
    if (!verifySignature(raw, signature, appSecret)) {
      // A wrong META_APP_SECRET rejects every real event from Meta, which
      // looks identical to "no events arriving" — so say so loudly.
      console.error(
        '[webhook] REJECTED: bad X-Hub-Signature-256. Check META_APP_SECRET matches your Meta app secret (or unset it to disable verification).',
      );
      return new Response('Invalid signature', { status: 403 });
    }
  }

  let payload: { entry?: Array<{ changes?: Array<{ value?: WebhookValue }> }> };
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed body will never succeed on retry — ack it so Meta stops.
    return new Response('OK', { status: 200 });
  }

  try {
    let statusCount = 0;
    let messageCount = 0;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        for (const status of value.statuses ?? []) {
          statusCount++;
          await applyStatusEvent(status);
        }
        for (const message of value.messages ?? []) {
          messageCount++;
          await logIncomingMessage(message, value.metadata?.phone_number_id);
        }
      }
    }

    // Meta delivers status events under the `messages` webhook field. If this
    // logs 0 statuses, the subscription is missing rather than the code failing.
    console.log(
      `[webhook] received: ${statusCount} status event(s), ${messageCount} inbound message(s)`,
    );
  } catch (err) {
    // Return 500 so Meta retries — every write here is idempotent, so a
    // replay is safe and we'd rather retry than silently drop a status.
    console.error('Webhook processing failed:', err);
    return new Response('Processing error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

/** Advance the matching receipt's delivery status. */
async function applyStatusEvent(event: StatusEvent) {
  const wamid = event.id;
  if (!wamid) return;

  const receipt = await db.receipt.findFirst({
    where: { wamid },
    select: { id: true, messageStatus: true },
  });
  if (!receipt) {
    // e.g. a message sent from another tool, or one whose wamid we never saved.
    console.warn(
      `[webhook] status '${event.status}' for unknown wamid ${wamid} — no matching receipt`,
    );
    return;
  }

  const update = resolveStatusUpdate(receipt.messageStatus, event);
  if (!update) {
    console.log(
      `[webhook] ignored '${event.status}' for ${wamid} (current='${receipt.messageStatus}': duplicate, stale, or untracked)`,
    );
    return;
  }

  await db.receipt.update({
    where: { id: receipt.id },
    data: update,
  });
  console.log(
    `[webhook] ${wamid}: ${receipt.messageStatus} -> ${update.messageStatus}` +
      (update.messageError ? ` (${update.messageError})` : ''),
  );
}

/** Log a customer's inbound message so support can review it. */
async function logIncomingMessage(
  message: IncomingMessage,
  phoneNumberId?: string,
) {
  if (!message.id) return;

  // Meta retries — don't log the same message twice.
  const existing = await db.customerMessage.findFirst({
    where: { wamid: message.id },
    select: { id: true },
  });
  if (existing) return;

  // Map the receiving number back to the store that owns it.
  const store = phoneNumberId
    ? await db.store.findFirst({
        where: { metaPhoneNumberId: phoneNumberId },
        select: { id: true },
      })
    : null;

  await db.customerMessage.create({
    data: {
      storeId: store?.id ?? null,
      fromPhone: message.from ? `+${message.from.replace(/\D/g, '')}` : '',
      messageText: message.text?.body ?? null,
      messageType: message.type ?? null,
      wamid: message.id,
    },
  });
}
