'use client';

import { useState } from 'react';
import { formatBd, formatNumber } from '@/lib/analytics/helpers';
import { formatDateTime } from '@/lib/datetime';
import type { TopCustomerRow } from '@/lib/analytics/types';

/**
 * Top customers by entries. Sortable by any column, masked phones with an
 * admin-only reveal, and a "show top 100" expansion (all 100 rows are already
 * loaded — the button just reveals the rest, no refetch).
 */

type SortKey =
  | 'totalEntries'
  | 'totalBd'
  | 'invoiceCount'
  | 'lastSeen'
  | 'name'
  | 'storeName';

const COLLAPSED = 20;

export default function TopCustomersTable({
  rows,
  canReveal,
  showStore,
}: {
  rows: TopCustomerRow[];
  canReveal: boolean;
  /** Show a store column — only useful when the list spans more than one. */
  showStore: boolean;
}) {
  const [sort, setSort] = useState<SortKey>('totalEntries');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const sorted = [...rows].sort((a, b) => {
    const factor = dir === 'asc' ? 1 : -1;
    if (sort === 'name') return factor * a.name.localeCompare(b.name);
    if (sort === 'storeName') {
      return factor * a.storeName.localeCompare(b.storeName);
    }
    if (sort === 'lastSeen') {
      return factor * ((a.lastSeen ?? '') < (b.lastSeen ?? '') ? -1 : 1);
    }
    return factor * (a[sort] - b[sort]);
  });

  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED);

  function toggle(key: SortKey) {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">Top customers</h2>
        <p className="py-8 text-center text-sm text-zinc-500">
          No customers yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Top customers</h2>
        {canReveal && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
          >
            {revealed ? 'Hide phone numbers' : 'Reveal phone numbers'}
          </button>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-black/10 text-xs text-zinc-500 dark:border-white/10">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <SortableTh label="Name" active={sort === 'name'} dir={dir} onClick={() => toggle('name')} />
              {showStore && (
                <SortableTh label="Store" active={sort === 'storeName'} dir={dir} onClick={() => toggle('storeName')} />
              )}
              <th className="px-2 py-2 font-medium">Phone</th>
              <SortableTh label="Entries" active={sort === 'totalEntries'} dir={dir} onClick={() => toggle('totalEntries')} align="right" />
              <SortableTh label="Total BD" active={sort === 'totalBd'} dir={dir} onClick={() => toggle('totalBd')} align="right" />
              <SortableTh label="Invoices" active={sort === 'invoiceCount'} dir={dir} onClick={() => toggle('invoiceCount')} align="right" />
              <SortableTh label="Last seen" active={sort === 'lastSeen'} dir={dir} onClick={() => toggle('lastSeen')} />
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => (
              <tr
                key={`${c.phoneMasked}-${i}`}
                className="border-b border-black/5 last:border-b-0 dark:border-white/5"
              >
                <td className="px-2 py-2 tabular-nums text-zinc-400">{i + 1}</td>
                <td className="px-2 py-2">{c.name}</td>
                {showStore && (
                  <td className="px-2 py-2">
                    <span className="inline-block whitespace-nowrap rounded-full bg-black/[.06] px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-white/[.1] dark:text-zinc-300">
                      {c.storeName}
                    </span>
                  </td>
                )}
                <td className="px-2 py-2 font-mono text-xs">
                  {revealed && c.phoneFull ? c.phoneFull : c.phoneMasked}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-medium">
                  {formatNumber(c.totalEntries)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatBd(c.totalBd)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatNumber(c.invoiceCount)}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-zinc-500">
                  {c.lastSeen ? formatDateTime(new Date(c.lastSeen)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 text-xs font-medium text-zinc-500 underline underline-offset-2 hover:no-underline"
        >
          {expanded
            ? `Show top ${COLLAPSED}`
            : `Show top ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th className={`px-2 py-2 font-medium ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <span className="text-[9px]">
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}
