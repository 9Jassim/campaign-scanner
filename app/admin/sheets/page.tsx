import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasSheetsCredentials } from '@/lib/google-sheets';
import { formatDateTime } from '@/lib/datetime';
import AppNav from '@/components/app-nav';
import { syncAll, syncOneStore } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  ok: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  skipped: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  refused: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
};

export default async function SheetsPage({
  searchParams,
}: {
  searchParams: { ran?: string; error?: string };
}) {
  const profile = await requireAdmin();
  const stores = await db.store.findMany({
    orderBy: { nameEn: 'asc' },
    select: {
      id: true,
      nameEn: true,
      googleSheetId: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      lastSyncDetail: true,
    },
  });
  const credentialsReady = hasSheetsCredentials();
  /** Nothing to sync without both a service account and somewhere to write. */
  const canSync = (sheetId: string | null) =>
    credentialsReady && Boolean(sheetId);

  return (
    <>
      <AppNav profile={profile} current="/admin/sheets" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Google Sheets sync
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every night the portal replaces each store&apos;s Contacts, Log and
            Raffle tabs with a fresh copy, so the sheet is a readable view of the
            portal. The sheet&apos;s own script archives it weekly. Nothing is
            ever read back out — the portal stays the source of truth.
          </p>
        </div>

        {!credentialsReady && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            The Google service account is not configured, so no store can sync.
            Set GOOGLE_SERVICE_ACCOUNT_EMAIL and
            GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.
          </p>
        )}

        {searchParams.ran && (
          <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
            Sync ran — {searchParams.ran}
          </p>
        )}
        {searchParams.error && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {searchParams.error}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {stores.map((store) => (
            <div
              key={store.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">{store.nameEn}</h2>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[store.lastSyncStatus ?? ''] ??
                    'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {store.lastSyncStatus ?? 'never synced'}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="text-zinc-500">Last sync</dt>
                <dd className="tabular-nums">
                  {formatDateTime(store.lastSyncAt)}
                </dd>

                <dt className="text-zinc-500">Sheet</dt>
                <dd>
                  {store.googleSheetId ? (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${store.googleSheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:no-underline"
                    >
                      Open sheet
                    </a>
                  ) : (
                    <span className="text-zinc-500">
                      No Sheet ID — set one in Settings, or this store is skipped.
                    </span>
                  )}
                </dd>

                {store.lastSyncDetail && (
                  <>
                    <dt className="text-zinc-500">Detail</dt>
                    <dd className="text-zinc-600 dark:text-zinc-400">
                      {store.lastSyncDetail}
                    </dd>
                  </>
                )}
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <form action={syncOneStore}>
                  <input type="hidden" name="storeId" value={store.id} />
                  <button
                    type="submit"
                    disabled={!canSync(store.googleSheetId)}
                    className="flex h-9 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
                  >
                    Sync this store
                  </button>
                </form>

                <form action={syncOneStore}>
                  <input type="hidden" name="storeId" value={store.id} />
                  <input type="hidden" name="force" value="1" />
                  <button
                    type="submit"
                    disabled={!canSync(store.googleSheetId)}
                    className="flex h-9 items-center justify-center rounded-full border border-amber-400 px-4 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-40 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                  >
                    Force
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-black/10 pt-4 dark:border-white/10">
          <form action={syncAll}>
            <button
              type="submit"
              disabled={!credentialsReady}
              className="flex h-11 items-center justify-center rounded-full border border-black/10 px-6 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/[.06]"
            >
              Sync all stores
            </button>
          </form>
          <span className="text-xs text-zinc-500">
            The same thing tonight&apos;s job does.
          </span>
        </div>

        <p className="text-xs text-zinc-500">
          A sync refuses to write when it would delete rows — that usually means
          something is wrong rather than that rows really went away.{' '}
          <strong className="font-medium">Force</strong> overrides that and lets
          a sheet shrink to match the portal. Use it after deliberately clearing
          data, and not otherwise. It is offered per store on purpose: letting a
          sheet lose rows is worth deciding one store at a time.
        </p>
      </main>
    </>
  );
}
