import { requireManager, resolveActiveStore, canExport } from '@/lib/auth';
import { db } from '@/lib/db';
import AppNav from '@/components/app-nav';
import FilterBar from '@/components/filter-bar';
import ExportButton from '@/components/export-button';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 200;

export default async function ContactsPage({
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
        <AppNav profile={profile} current="/contacts" />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">
            Contacts
          </h1>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are not assigned to any store.
          </p>
        </main>
      </>
    );
  }

  const where: Prisma.ContactWhereInput = { storeId: store.id };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ];
  }

  const [contacts, total] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: { lastSeen: 'desc' },
      take: PAGE_LIMIT,
    }),
    db.contact.count({ where }),
  ]);

  return (
    <>
      <AppNav profile={profile} current="/contacts" />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <span className="text-sm text-zinc-500">· {store.nameEn}</span>
          </div>
          {canExport(profile) && (
            <ExportButton type="contacts" storeId={store.id} q={q} />
          )}
        </div>

        <FilterBar
          action="/contacts"
          stores={stores}
          selectedStoreId={store.id}
          q={q}
          searchPlaceholder="Search by name or phone"
          allowAllStores={false}
        />

        <p className="text-xs text-zinc-500">
          {total} contact{total === 1 ? '' : 's'}
          {total > PAGE_LIMIT ? ` (showing first ${PAGE_LIMIT})` : ''}
        </p>

        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 text-right font-medium">Total BD</th>
                <th className="px-3 py-2 text-right font-medium">Entries</th>
                <th className="px-3 py-2 text-right font-medium">Invoices</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-zinc-500"
                  >
                    No contacts found.
                  </td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-black/5 dark:border-white/5"
                  >
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.phone}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(c.totalBd).toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.totalEntries}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.invoiceCount}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">
                      {c.lastSeen ? c.lastSeen.toLocaleString() : '—'}
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
