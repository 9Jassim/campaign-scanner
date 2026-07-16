import { requireManager, resolveActiveStore, canExport } from '@/lib/auth';
import { db } from '@/lib/db';
import AppNav from '@/components/app-nav';
import FilterBar from '@/components/filter-bar';
import AutoSubmitSelect from '@/components/auto-submit-select';
import ExportButton from '@/components/export-button';
import StatusBadge from '@/components/status-badge';
import Pagination, { parsePageParam } from '@/components/pagination';
import { formatDateTime } from '@/lib/datetime';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;
const STATUSES = [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
  'skipped',
];

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: {
    storeId?: string;
    q?: string;
    status?: string;
    page?: string;
  };
}) {
  const profile = await requireManager();
  const { stores, store } = await resolveActiveStore(
    profile,
    searchParams.storeId,
  );
  const q = searchParams.q?.trim() ?? '';
  const status = STATUSES.includes(searchParams.status ?? '')
    ? searchParams.status!
    : '';

  if (!store) {
    return (
      <>
        <AppNav profile={profile} current="/receipts" />
        <main className="mx-auto w-full max-w-6xl flex-1 p-6">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">
            Receipts
          </h1>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are not assigned to any store.
          </p>
        </main>
      </>
    );
  }

  const where: Prisma.ReceiptWhereInput = { storeId: store.id };
  if (status) where.messageStatus = status;
  if (q) {
    where.OR = [
      { invoiceId: { contains: q, mode: 'insensitive' } },
      { contact: { name: { contains: q, mode: 'insensitive' } } },
      { contact: { phone: { contains: q } } },
    ];
  }

  // Count first so an out-of-range ?page can be clamped rather than showing
  // an empty list.
  const total = await db.receipt.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(parsePageParam(searchParams.page), totalPages);

  const receipts = await db.receipt.findMany({
    where,
    include: {
      contact: { select: { name: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
  });

  return (
    <>
      <AppNav profile={profile} current="/receipts" />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
            <span className="text-sm text-zinc-500">· {store.nameEn}</span>
          </div>
          {canExport(profile) && (
            <ExportButton
              type="receipts"
              storeId={store.id}
              q={q}
              status={status}
            />
          )}
        </div>

        <FilterBar
          action="/receipts"
          stores={stores}
          selectedStoreId={store.id}
          q={q}
          searchPlaceholder="Search by invoice, name, or phone"
          allowAllStores={false}
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-zinc-500">Status</span>
            <AutoSubmitSelect
              name="status"
              defaultValue={status}
              className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </AutoSubmitSelect>
          </label>
        </FilterBar>

        <p className="text-xs text-zinc-500">
          {total} receipt{total === 1 ? '' : 's'}
        </p>

        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Entries</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Cashier</th>
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-zinc-500"
                  >
                    No receipts found.
                  </td>
                </tr>
              ) : (
                receipts.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-black/5 dark:border-white/5"
                  >
                    <td className="px-3 py-2 text-zinc-500">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.invoiceId}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.contact.name}</div>
                      <div className="font-mono text-xs text-zinc-500">
                        {r.contact.phone}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(r.amount).toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.entries}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={r.messageStatus}
                        error={r.messageError}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {r.cashierEmail ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          basePath="/receipts"
          params={{ storeId: store.id, q, status }}
          page={page}
          totalPages={totalPages}
          totalItems={total}
          perPage={PER_PAGE}
        />
      </main>
    </>
  );
}
