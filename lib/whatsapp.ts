import type { Store } from '@prisma/client';
import { decrypt } from './crypto';

/**
 * WhatsApp sending via the Meta Cloud API.
 *
 * Each store has its own WABA credentials, stored on the `stores` row. The
 * access token is encrypted at rest and decrypted here at call time.
 */

const GRAPH_VERSION = 'v21.0';
const REQUEST_TIMEOUT_MS = 15_000;

const DEFAULT_TEMPLATE = 'campaign_entry_confirmation';
const DEFAULT_LANG = 'ar';

/** Meta error codes that indicate throttling rather than a permanent failure. */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

export interface SendParams {
  /** Customer name as scanned. */
  name: string;
  /** Normalized phone (`+<digits>`); converted to digits-only for the API. */
  phone: string;
  /** Entries earned on this receipt. */
  entries: number;
  /** Customer's total entries after this receipt. */
  totalEntries: number;
}

export interface SendResult {
  wamid?: string;
  error?: string;
  /** True when Meta throttled us — the caller should queue a retry. */
  rateLimited?: boolean;
  /** True when the store has no WhatsApp credentials configured. */
  skipped?: boolean;
}

/** Whether the store is configured to send WhatsApp messages. */
export function hasWhatsAppCredentials(store: Store): boolean {
  return Boolean(store.metaPhoneNumberId && store.metaAccessTokenEncrypted);
}

function textParam(text: string) {
  return { type: 'text' as const, text };
}

/**
 * Build the Cloud API request body.
 *
 * The template uses positional variables {{1}}–{{12}} and Meta matches them by
 * array order, so this order is load-bearing — see the mapping table in
 * PROJECT_BRIEF.md. Exported for unit testing.
 */
export function buildTemplatePayload(store: Store, params: SendParams) {
  const entriesStr = String(params.entries);
  const totalStr = String(params.totalEntries);

  return {
    messaging_product: 'whatsapp',
    to: params.phone.replace(/\D/g, ''), // digits only, no '+'
    type: 'template',
    template: {
      name: store.metaTemplateName || DEFAULT_TEMPLATE,
      language: { code: store.metaTemplateLang || DEFAULT_LANG },
      components: [
        {
          type: 'body',
          parameters: [
            textParam(params.name), // 1  customer name
            textParam(store.nameAr), // 2  store name (AR)
            textParam(entriesStr), // 3  entries this receipt
            textParam(store.campaignNameAr ?? ''), // 4  campaign name (AR)
            textParam(totalStr), // 5  total entries
            textParam(store.prizeAr ?? ''), // 6  prize (AR)
            textParam(params.name), // 7  customer name (repeat)
            textParam(store.nameEn), // 8  store name (EN)
            textParam(entriesStr), // 9  entries this receipt (repeat)
            textParam(store.campaignNameEn ?? ''), // 10 campaign name (EN)
            textParam(totalStr), // 11 total entries (repeat)
            textParam(store.prizeEn ?? ''), // 12 prize (EN)
          ],
        },
      ],
    },
  };
}

/**
 * Send the entry-confirmation template to a customer.
 *
 * Never throws: all failures are returned as `error` so the caller can record
 * them on the receipt without failing the scan.
 */
export async function sendWhatsApp(
  store: Store,
  params: SendParams,
): Promise<SendResult> {
  if (!hasWhatsAppCredentials(store)) {
    return { skipped: true };
  }

  let token: string;
  try {
    token = decrypt(store.metaAccessTokenEncrypted!);
  } catch {
    return { error: 'Could not decrypt the stored Meta access token' };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${store.metaPhoneNumberId}/messages`;
  const payload = buildTemplatePayload(store, params);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const code = data?.error?.code;
      const message =
        data?.error?.message ?? `Meta API error (HTTP ${res.status})`;
      return {
        error: message,
        rateLimited: res.status === 429 || RATE_LIMIT_CODES.has(code),
      };
    }

    // Success looks like { messages: [{ id: "wamid.xxx" }] }
    const wamid: string | undefined = data?.messages?.[0]?.id;
    if (!wamid) {
      return { error: 'Meta API accepted the request but returned no message ID' };
    }
    return { wamid };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { error: 'Meta API request timed out' };
    }
    return {
      error: err instanceof Error ? err.message : 'Meta API request failed',
    };
  }
}
