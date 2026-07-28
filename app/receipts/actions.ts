'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUserProfile } from '@/lib/auth';
import { resendReceipt } from '@/lib/resend';

/**
 * Admin action: re-send the WhatsApp confirmation for one failed receipt.
 *
 * Admin-only — a manager must not be able to send messages by POSTing this.
 * Redirects back to the exact filtered/sorted/paged view the button was on,
 * carrying a one-line `resent` flash the page shows.
 */
export async function resendReceiptAction(formData: FormData) {
  const profile = await getCurrentUserProfile();
  if (!profile || profile.role !== 'admin') {
    throw new Error('Only admins can resend messages');
  }

  const receiptId = String(formData.get('receiptId') ?? '');
  const returnTo = sanitizeReturn(String(formData.get('returnTo') ?? '/receipts'));
  if (!receiptId) redirect(returnTo);

  let flash: string;
  try {
    const result = await resendReceipt(profile, receiptId);
    flash = result.error ? `${result.status} — ${result.error}` : result.status;
  } catch (err) {
    flash = err instanceof Error ? err.message : 'Resend failed';
  }

  revalidatePath('/receipts');
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}resent=${encodeURIComponent(flash)}`);
}

/**
 * Keep the redirect internal (no open redirect) and strip any stale `resent`
 * flag so it doesn't pile up across repeated resends.
 */
function sanitizeReturn(v: string): string {
  if (!v.startsWith('/receipts')) return '/receipts';
  const [path, query] = v.split('?');
  if (!query) return path;
  const sp = new URLSearchParams(query);
  sp.delete('resent');
  const q = sp.toString();
  return q ? `${path}?${q}` : path;
}
