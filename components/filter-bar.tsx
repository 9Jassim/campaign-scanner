import type { Store } from '@prisma/client';
import AutoSubmitSelect from './auto-submit-select';

/**
 * A GET-form filter bar: store selector + free-text search, plus any extra
 * controls passed as children (e.g. a status dropdown). Because it submits via
 * GET, all filter state lives in the URL and the page stays server-rendered.
 */
export default function FilterBar({
  action,
  stores,
  selectedStoreId,
  q,
  searchPlaceholder = 'Search…',
  allowAllStores = true,
  children,
}: {
  action: string;
  stores: Store[];
  selectedStoreId: string | null;
  q?: string;
  searchPlaceholder?: string;
  allowAllStores?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <form
      method="GET"
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10"
    >
      {stores.length > 1 && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-zinc-500">Store</span>
          <AutoSubmitSelect
            name="storeId"
            defaultValue={selectedStoreId ?? ''}
            className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
          >
            {allowAllStores && <option value="">All stores</option>}
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
      )}

      {stores.length === 1 && (
        <input type="hidden" name="storeId" value={selectedStoreId ?? ''} />
      )}

      <label className="flex flex-1 flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-500">Search</span>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder={searchPlaceholder}
          className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
        />
      </label>

      {children}

      <button
        type="submit"
        className="flex h-9 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:opacity-90"
      >
        Apply
      </button>
    </form>
  );
}
