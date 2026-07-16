'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { syncAllStores } from '@/lib/sheets-sync';

/**
 * Run the Google Sheets sync now, rather than waiting for tonight's cron.
 * Admin only — it writes to both companies' sheets.
 */
export async function syncNow(formData: FormData) {
  await requireAdmin();

  // Only ever from the explicit "force" button, which spells out what it does.
  const force = formData.get('force') === '1';

  let summary: string;
  try {
    const results = await syncAllStores({ force });
    summary = results.map((r) => `${r.store}: ${r.status}`).join(' · ');
  } catch (err) {
    summary = err instanceof Error ? err.message : String(err);
    redirect(`/admin/sheets?error=${encodeURIComponent(summary)}`);
  }

  revalidatePath('/admin/sheets');
  redirect(`/admin/sheets?ran=${encodeURIComponent(summary)}`);
}
