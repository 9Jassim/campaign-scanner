import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasSheetsCredentials } from '@/lib/google-sheets';
import AppNav from '@/components/app-nav';
import ImportFailoverClient from './import-failover-client';

export const dynamic = 'force-dynamic';

export default async function ImportFailoverPage() {
  const profile = await requireAdmin();
  const stores = await db.store.findMany({
    orderBy: { nameEn: 'asc' },
    select: { id: true, nameEn: true, failoverSheetId: true },
  });
  const credentialsReady = hasSheetsCredentials();

  return (
    <>
      <AppNav profile={profile} current="/admin/import-failover" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Import from failover sheet
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            When the portal is down, cashiers scan through a standalone Google
            Sheet that sends its own WhatsApp messages. Once the portal is back,
            pull those scans in here so the database stays complete. Preview
            first, then confirm. No WhatsApp is sent — the failover sheet already
            messaged the customers.
          </p>
        </div>

        {!credentialsReady && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            The Google service account is not configured, so no sheet can be
            read. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and
            GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.
          </p>
        )}

        <ImportFailoverClient stores={stores} disabled={!credentialsReady} />
      </main>
    </>
  );
}
