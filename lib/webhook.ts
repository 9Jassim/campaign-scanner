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
