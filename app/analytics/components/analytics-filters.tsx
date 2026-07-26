import Link from 'next/link';
import AutoSubmitSelect from '@/components/auto-submit-select';
import type { RangePreset, StoreOption } from '@/lib/analytics/types';

/**
 * Date-range presets (as links, so state stays in the URL and the page stays
 * server-rendered), a custom range form, and — for admins with more than one
 * store — a store selector. Managers with a single store see no selector.
 */

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

export default function AnalyticsFilters({
  preset,
  store,
  from,
  to,
  isAdmin,
  stores,
}: {
  preset: RangePreset;
  store: string;
  from?: string;
  to?: string;
  isAdmin: boolean;
  stores: StoreOption[];
}) {
  // Keep the active store on every preset link.
  const withStore = (params: Record<string, string>) => {
    const sp = new URLSearchParams(params);
    if (store) sp.set('store', store);
    return `/analytics?${sp.toString()}`;
  };

  const showStoreFilter = isAdmin && stores.length > 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => {
          const active = p.key === preset;
          return (
            <Link
              key={p.key}
              href={withStore({ range: p.key })}
              className={
                active
                  ? 'rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background'
                  : 'rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[.04] dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[.06]'
              }
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {showStoreFilter && (
          <form method="GET" action="/analytics">
            <input type="hidden" name="range" value={preset} />
            {preset === 'custom' && from && <input type="hidden" name="from" value={from} />}
            {preset === 'custom' && to && <input type="hidden" name="to" value={to} />}
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-zinc-500">Store</span>
              <AutoSubmitSelect
                name="store"
                defaultValue={store}
                className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
              >
                <option value="">All stores</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn}
                  </option>
                ))}
              </AutoSubmitSelect>
            </label>
          </form>
        )}

        <form method="GET" action="/analytics" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="range" value="custom" />
          {store && <input type="hidden" name="store" value={store} />}
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-zinc-500">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-zinc-500">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            />
          </label>
          <button
            type="submit"
            className="flex h-9 items-center justify-center rounded-full border border-black/10 px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
          >
            Apply range
          </button>
        </form>
      </div>
    </div>
  );
}
