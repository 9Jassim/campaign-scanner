import { requireManager, getUserStores } from '@/lib/auth';
import { isEncryptionConfigured } from '@/lib/crypto';
import AppNav from '@/components/app-nav';
import AutoSubmitSelect from '@/components/auto-submit-select';
import { saveStoreSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { storeId?: string; saved?: string };
}) {
  const profile = await requireManager();
  const stores = await getUserStores(profile);

  if (stores.length === 0) {
    return (
      <>
        <AppNav profile={profile} current="/settings" />
        <main className="mx-auto w-full max-w-3xl flex-1 p-6">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are not assigned to any store.
          </p>
        </main>
      </>
    );
  }

  const store =
    stores.find((s) => s.id === searchParams.storeId) ?? stores[0];
  const saved = searchParams.saved === '1';
  const encryptionReady = isEncryptionConfigured();

  return (
    <>
      <AppNav profile={profile} current="/settings" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          {stores.length > 1 && (
            <form method="GET" action="/settings">
              <AutoSubmitSelect
                name="storeId"
                defaultValue={store.id}
                className="rounded-md border border-black/10 bg-transparent px-3 py-1.5 text-sm dark:border-white/15"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn}
                  </option>
                ))}
              </AutoSubmitSelect>
            </form>
          )}
        </div>

        {saved && (
          <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
            Settings saved.
          </p>
        )}

        <form action={saveStoreSettings} className="flex flex-col gap-6">
          <input type="hidden" name="storeId" value={store.id} />

          <Section title="Store">
            <Field name="nameEn" label="Name (English)" defaultValue={store.nameEn} required />
            <Field name="nameAr" label="Name (Arabic)" defaultValue={store.nameAr} required rtl />
            <Field
              name="bdPerEntry"
              label="BD per entry"
              defaultValue={String(store.bdPerEntry)}
              inputMode="decimal"
            />
          </Section>

          <Section title="Campaign">
            <Field name="campaignNameEn" label="Campaign name (English)" defaultValue={store.campaignNameEn ?? ''} />
            <Field name="campaignNameAr" label="Campaign name (Arabic)" defaultValue={store.campaignNameAr ?? ''} rtl />
            <Field name="prizeEn" label="Prize (English)" defaultValue={store.prizeEn ?? ''} />
            <Field name="prizeAr" label="Prize (Arabic)" defaultValue={store.prizeAr ?? ''} rtl />
          </Section>

          <Section title="WhatsApp (Meta)">
            <Field name="metaPhoneNumberId" label="Phone number ID" defaultValue={store.metaPhoneNumberId ?? ''} />
            <Field name="metaTemplateName" label="Template name" defaultValue={store.metaTemplateName ?? ''} />
            <Field name="metaTemplateLang" label="Template language" defaultValue={store.metaTemplateLang ?? ''} />

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">
                Access token{' '}
                <span className="font-normal text-zinc-400">
                  {store.metaAccessTokenEncrypted
                    ? '(a token is saved — leave blank to keep it)'
                    : '(not set)'}
                </span>
              </span>
              <input
                type="password"
                name="metaAccessToken"
                autoComplete="off"
                disabled={!encryptionReady}
                placeholder={
                  encryptionReady
                    ? 'Enter a new token to replace'
                    : 'Set ENCRYPTION_KEY to enable'
                }
                className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-white/15"
              />
              {!encryptionReady && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  ENCRYPTION_KEY is not configured, so the access token cannot be
                  saved yet.
                </span>
              )}
            </label>
          </Section>

          <Section title="Google Sheets">
            <Field name="googleSheetId" label="Sheet ID (optional)" defaultValue={store.googleSheetId ?? ''} />
          </Section>

          <div>
            <button
              type="submit"
              className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              Save settings
            </button>
          </div>
        </form>
      </main>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  name,
  label,
  defaultValue,
  required,
  rtl,
  inputMode,
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
  rtl?: boolean;
  inputMode?: 'decimal';
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        inputMode={inputMode}
        dir={rtl ? 'rtl' : undefined}
        autoComplete="off"
        className="rounded-md border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
      />
    </label>
  );
}
