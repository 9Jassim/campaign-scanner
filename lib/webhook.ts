import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pure helpers for the Meta WhatsApp webhook.
 *
 * Meta does not guarantee event ordering and retries aggressively, so status
 * handling must be both monotonic (never regress `delivered` back to `sent`)
 * and idempotent (re-delivering the same event is a no-op).
 */

export type MessageStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped';

/**
 * Delivery progression. A status only ever moves forward through these ranks.
 * `failed` is handled separately — it can arrive at any point.
 */
const RANK: Record<string, number> = {
  skipped: 0,
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export interface StatusError {
  code?: number;
  title?: string;
  message?: string;
}

export interface StatusEvent {
  /** The wamid of the message this event refers to. */
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: StatusError[];
}

export interface IncomingMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
}

export interface WebhookValue {
  /** `phone_number_id` says which WABA number — and so which store — this is for. */
  metadata?: { phone_number_id?: string };
  statuses?: StatusEvent[];
  messages?: IncomingMessage[];
}

export interface WebhookPayload {
  entry?: Array<{ changes?: Array<{ value?: WebhookValue }> }>;
}

/**
 * Every `phone_number_id` the payload refers to, deduped.
 *
 * Read from an unverified body, which is safe for one purpose only: choosing
 * which app secret to check the signature against. A payload that lies about
 * its number simply fails verification against that store's secret.
 */
export function phoneNumberIdsIn(payload: WebhookPayload): string[] {
  const ids = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/** Render Meta's error array into a single readable string for the receipt. */
export function formatStatusError(errors?: StatusError[]): string | null {
  const err = errors?.[0];
  if (!err) return null;
  const detail = err.title ?? err.message ?? 'Message failed';
  return err.code ? `${err.code}: ${detail}` : detail;
}

/**
 * Decide how a status event changes a receipt.
 * Returns null when the event should be ignored (unknown status, or an
 * out-of-order event that would move the status backwards).
 */
export function resolveStatusUpdate(
  current: string | null,
  event: StatusEvent,
): { messageStatus: MessageStatus; messageError: string | null } | null {
  const incoming = event.status?.toLowerCase();
  if (!incoming) return null;

  // A failure can arrive at any point and always wins.
  if (incoming === 'failed') {
    return {
      messageStatus: 'failed',
      messageError: formatStatusError(event.errors) ?? 'Message failed',
    };
  }

  const incomingRank = RANK[incoming];
  if (incomingRank === undefined) return null; // status we don't track

  const currentRank = current !== null ? (RANK[current] ?? -1) : -1;
  if (incomingRank <= currentRank) return null; // stale / duplicate event

  return {
    messageStatus: incoming as MessageStatus,
    messageError: null, // reaching a delivery milestone clears prior errors
  };
}

/**
 * Verify Meta's `X-Hub-Signature-256` header against the raw request body.
 * Must be computed over the exact bytes Meta sent, not a re-serialized object.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  const received = signatureHeader.slice('sha256='.length);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Identify which candidate signed the body, or null if none did.
 *
 * Returns the candidate rather than a boolean on purpose. Each store is a
 * separate company with its own Meta app, so knowing that *someone* signed the
 * payload is not enough — the caller must know *who*, or one store's app could
 * sign a body carrying events for the other store's receipts.
 *
 * An empty candidate list means no store could be authenticated, so nothing
 * signed it: never treat that as permission to proceed.
 */
export function findSigner<T extends { secret: string }>(
  rawBody: string,
  signatureHeader: string | null,
  candidates: T[],
): T | null {
  return (
    candidates.find((candidate) =>
      verifySignature(rawBody, signatureHeader, candidate.secret),
    ) ?? null
  );
}
