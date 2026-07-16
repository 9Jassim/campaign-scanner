import type { Store } from '@prisma/client';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import {
  findSigner,
  phoneNumberIdsIn,
  resolveStatusUpdate,
  type IncomingMessage,
  type StatusEvent,
  type WebhookPayload,
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
 *
 * The two stores are separate companies with separate Meta apps, and this one
 * URL serves both. So a request is not merely "signed or not" — it is signed by
 * exactly one store's app, and may only touch that store's rows.
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

type SigningStore = Pick<Store, 'id' | 'slug' | 'metaPhoneNumberId'>;
interface SigningCandidate {
  store: SigningStore;
  secret: string;
}

export async function POST(request: Request) {
  // Read the raw body: the signature is computed over the exact bytes sent.
  const raw = await request.text();

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed body will never succeed on retry — ack it so Meta stops.
    return new Response('OK', { status: 200 });
  }

  // Untrusted at this point. The phone number ids only decide *which* secrets
  // are worth checking; a payload that names someone else's number just fails
  // to verify against that store's secret.
  const phoneNumberIds = phoneNumberIdsIn(payload);
  if (phoneNumberIds.length === 0) {
    console.error(
      '[webhook] REJECTED: payload names no phone_number_id, so it cannot be ' +
        'attributed to a store. Dropping (a retry would not help).',
    );
    return new Response('OK', { status: 200 });
  }

  const candidates = await signingCandidates(phoneNumberIds);
  if (candidates.length === 0) {
    // Our configuration is incomplete, not Meta's fault. 503 asks Meta to retry
    // so the events can still land once the settings are fixed.
    console.error(
      `[webhook] CANNOT VERIFY: no usable app secret for phone_number_id(s) ` +
        `${phoneNumberIds.join(', ')}. Check the store's Phone number ID and ` +
        `App secret in Settings, and ENCRYPTION_KEY. Asking Meta to retry.`,
    );
    return new Response('Webhook not configured', { status: 503 });
  }

  const signer = findSigner(
    raw,
    request.headers.get('x-hub-signature-256'),
    candidates,
  );
  if (!signer) {
    // A wrong secret rejects every real event from Meta, which looks identical
    // to "no events arriving" — so say so loudly.
    console.error(
      `[webhook] REJECTED: bad X-Hub-Signature-256 (tried ${candidates.length} ` +
        `app secret(s): ${candidates.map((c) => c.store.slug).join(', ')}). ` +
        "Check each store's Meta app secret in Settings.",
    );
    return new Response('Invalid signature', { status: 403 });
  }

  try {
    let statusCount = 0;
    let messageCount = 0;
    let forgedCount = 0;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // One body is signed by one app. A change inside it addressed to a
        // different store did not come from that store — refuse it rather than
        // let one company write to the other's receipts.
        if (value.metadata?.phone_number_id !== signer.store.metaPhoneNumberId) {
          forgedCount++;
          console.error(
            `[webhook] REJECTED change for phone_number_id ` +
              `${value.metadata?.phone_number_id}: this body was signed by ` +
              `'${signer.store.slug}', which does not own that number.`,
          );
          continue;
        }

        for (const status of value.statuses ?? []) {
          statusCount++;
          await applyStatusEvent(status, signer.store);
        }
        for (const message of value.messages ?? []) {
          messageCount++;
          await logIncomingMessage(message, signer.store);
        }
      }
    }

    // Meta delivers status events under the `messages` webhook field. If this
    // logs 0 statuses, the subscription is missing rather than the code failing.
    console.log(
      `[webhook] ${signer.store.slug}: ${statusCount} status event(s), ` +
        `${messageCount} inbound message(s)` +
        (forgedCount ? `, ${forgedCount} rejected as cross-store` : ''),
    );
  } catch (err) {
    // Return 500 so Meta retries — every write here is idempotent, so a
    // replay is safe and we'd rather retry than silently drop a status.
    console.error('Webhook processing failed:', err);
    return new Response('Processing error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

/**
 * The stores that could legitimately have signed a payload naming these phone
 * number ids, each with the secret to check.
 *
 * An empty result means the payload cannot be authenticated at all — the caller
 * must reject it. There is deliberately no "no secrets configured, allow
 * everything" path: that used to make a broken ENCRYPTION_KEY silently disable
 * verification, exactly when it was most needed.
 */
async function signingCandidates(
  phoneNumberIds: string[],
): Promise<SigningCandidate[]> {
  const stores = await db.store.findMany({
    where: { metaPhoneNumberId: { in: phoneNumberIds } },
    select: {
      id: true,
      slug: true,
      metaPhoneNumberId: true,
      metaAppSecretEncrypted: true,
    },
  });

  const candidates: SigningCandidate[] = [];
  for (const store of stores) {
    const secret = appSecretFor(store);
    if (secret) candidates.push({ store, secret });
  }
  return candidates;
}

/** The app secret to verify a store's payloads with, or null if none is usable. */
function appSecretFor(
  store: Pick<Store, 'slug' | 'metaAppSecretEncrypted'>,
): string | null {
  if (store.metaAppSecretEncrypted) {
    try {
      return decrypt(store.metaAppSecretEncrypted);
    } catch {
      console.error(
        `[webhook] could not decrypt the Meta app secret for store ` +
          `'${store.slug}' — check ENCRYPTION_KEY. Refusing to skip ` +
          `verification for this store.`,
      );
      return null;
    }
  }

  // Fallback while a store is still being onboarded onto its own Meta app.
  const envSecret = process.env.META_APP_SECRET;
  if (envSecret) {
    console.warn(
      `[webhook] store '${store.slug}' has no app secret of its own; falling ` +
        `back to META_APP_SECRET. Set a per-store App secret in Settings — ` +
        `while two stores share one secret, either app can sign for the other.`,
    );
    return envSecret;
  }

  console.error(
    `[webhook] store '${store.slug}' has no Meta app secret configured, so its ` +
      `events cannot be verified. Set one in Settings.`,
  );
  return null;
}

/** Advance the matching receipt's delivery status, within the signing store. */
async function applyStatusEvent(event: StatusEvent, store: SigningStore) {
  const wamid = event.id;
  if (!wamid) return;

  // Scoped to the signing store: a wamid alone is not proof of ownership.
  const receipt = await db.receipt.findFirst({
    where: { wamid, storeId: store.id },
    select: { id: true, messageStatus: true },
  });
  if (!receipt) {
    // e.g. a message sent from another tool, or one whose wamid we never saved.
    console.warn(
      `[webhook] status '${event.status}' for wamid ${wamid} — no matching ` +
        `receipt in store '${store.slug}'`,
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
  store: SigningStore,
) {
  if (!message.id) return;

  // Meta retries — don't log the same message twice.
  const existing = await db.customerMessage.findFirst({
    where: { wamid: message.id },
    select: { id: true },
  });
  if (existing) return;

  await db.customerMessage.create({
    data: {
      // The signing store owns the number this arrived on — no second lookup.
      storeId: store.id,
      fromPhone: message.from ? `+${message.from.replace(/\D/g, '')}` : '',
      messageText: message.text?.body ?? null,
      messageType: message.type ?? null,
      wamid: message.id,
    },
  });
}
