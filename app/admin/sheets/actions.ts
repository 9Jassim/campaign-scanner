'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { syncAllStores, syncStore } from '@/lib/sheets-sync';

/**
 * Manual Google Sheets syncs, for admins who don't want to wait for tonight's
 * cron. Admin only: these write to both companies' sheets.
 */

function done(summary: string): never {
  revalidatePath('/admin/sheets');
  redirect(`/admin/sheets?ran=${encodeURIComponent(summary)}`);
}

function failed(message: string): never {
  redirect(`/admin/sheets?error=${encodeURIComponent(message)}`);
}

/** Sync one store. Forcing is per-store only — see the note on syncAll. */
export async function syncOneStore(formData: FormData) {
  await requireAdmin();

  const storeId = String(formData.get('storeId') ?? '');
  const force = formData.get('force') === '1';
  if (!storeId) failed('Missing store.');

  const store = await db.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      slug: true,
      nameEn: true,
      googleSheetId: true,
      failoverSheetId: true,
    },
  });
  if (!store) failed('Unknown store.');

  // Never throws — a failure comes back as the result, and is also recorded on
  // the store so the page shows it.
  const result = await syncStore(store, { force });
  done(
    `${store.nameEn} — mirror ${result.status}: ${result.detail} · ` +
      `failover ${result.failoverStatus}: ${result.failoverDetail}`,
  );
}

/**
 * Sync every store.
 *
 * Deliberately has no force option: forcing lets a sheet shrink, so it should
 * be a decision made about one store at a time rather than applied to both
 * companies with a single click.
 */
export async function syncAll() {
  await requireAdmin();

  let results;
  try {
    results = await syncAllStores();
  } catch (err) {
    failed(err instanceof Error ? err.message : String(err));
  }
  done(
    results
      .map((r) => `${r.store}: ${r.status} (failover ${r.failoverStatus})`)
      .join(' · '),
  );
}
