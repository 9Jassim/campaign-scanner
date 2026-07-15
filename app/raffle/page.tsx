import { requireManager, resolveActiveStore, canExport } from '@/lib/auth';
import { db } from '@/lib/db';
import AppNav from '@/components/app-nav';
import FilterBar from '@/components/filter-bar';
import ExportButton from '@/components/export-button';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 300;

export default async function RafflePage({
  searchParams,
}: {
  searchParams: { storeId?: string; q?: string };
}) {
  const profile = await requireManager();
  const { stores, store } = await resolveActiveStore(
    profile,
    searchParams.storeId,
  );
  const q = searchParams.q?.trim() ?? '';

  if (!store) {
    return (
      <>
        <AppNav profile={profile} current="/raffle" />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">
            Raffle entries
          </h1>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are not assigned to any store.
          </p>
        </main>
      </>
    );
  }

  const where: Prisma.RaffleEntryWhereInput = { storeId: store.id };
  if (q) {
    const or: Prisma.RaffleEntryWhereInput[] = [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { invoiceId: { contains: q, mode: 'insensitive' } },
    ];
    const asNumber = Number(q);
    if (Number.isInteger(asNumber)) or.push({ entryNumber: asNumber });
    where.OR = or;
  }

  const [entries, total] = await Promise.all([
    db.raffleEntry.findMany({
      where,
      orderBy: { entryNumber: 'asc' },
      take: PAGE_LIMIT,
    }),
    db.raffleEntry.count({ where }),
  ]);

  return (
    <>
      <AppNav profile={profile} current="/raffle" />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Raffle entries
            </h1>
            <span className="text-sm text-zinc-500">· {store.nameEn}</span>
          </div>
          {canExport(profile) && (
            <ExportButton type="raffle" storeId={store.id} q={q} />
          )}
        </div>

        <FilterBar
          action="/raffle"
          stores={stores}
          selectedStoreId={store.id}
          q={q}
          searchPlaceholder="Search by name, phone, invoice, or entry #"
          allowAllStores={false}
        />

        <p className="text-xs text-zinc-500">
          {total} entr{total === 1 ? 'y' : 'ies'}
          {total > PAGE_LIMIT ? ` (showing first ${PAGE_LIMIT})` : ''}
        </p>

        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-right font-medium">Entry #</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-zinc-500"
                  >
                    No raffle entries found.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t border-black/5 dark:border-white/5"
                  >
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {e.entryNumber}
                    </td>
                    <td className="px-3 py-2 font-medium">{e.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.phone}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.invoiceId}</td>
                    <td className="px-3 py-2 text-zinc-500">
                      {e.createdAt ? e.createdAt.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
