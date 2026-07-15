import { requireManager, resolveActiveStore, canExport } from '@/lib/auth';
import { db } from '@/lib/db';
import AppNav from '@/components/app-nav';
import FilterBar from '@/components/filter-bar';
import ExportButton from '@/components/export-button';
import StatusBadge from '@/components/status-badge';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 200;
/** Cap invoices shown per contact — a six-month campaign can rack them up. */
const RECEIPTS_PER_CONTACT = 50;

/** Shared column template so the header and each summary row line up. */
const ROW_GRID =
  'grid grid-cols-[1.25rem_2fr_1.5fr_1fr_0.8fr_0.8fr_1.5fr] items-center gap-3';

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
      include: {
        // The invoice IDs are on the contact, but the amount and entry count
        // per invoice live on the receipt — so read them from there.
        receipts: {
          select: {
            id: true,
            invoiceId: true,
            amount: true,
            entries: true,
            createdAt: true,
            messageStatus: true,
            messageError: true,
          },
          orderBy: { createdAt: 'desc' },
          take: RECEIPTS_PER_CONTACT,
        },
      },
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
          {contacts.length > 0 && ' · click a contact to see their invoices'}
        </p>

        <div className="overflow-x-auto">
          <div className="min-w-[720px] rounded-lg border border-black/10 dark:border-white/10">
            {/* Header */}
            <div
              className={`${ROW_GRID} border-b border-black/10 bg-zinc-100 px-3 py-2 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:bg-zinc-900`}
            >
              <span />
              <span className="font-medium">Name</span>
              <span className="font-medium">Phone</span>
              <span className="text-right font-medium">Total BD</span>
              <span className="text-right font-medium">Entries</span>
              <span className="text-right font-medium">Invoices</span>
              <span className="font-medium">Last seen</span>
            </div>

            {contacts.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-zinc-500">
                No contacts found.
              </p>
            ) : (
              contacts.map((c) => (
                <details
                  key={c.id}
                  className="border-b border-black/5 last:border-b-0 dark:border-white/5"
                >
                  <summary
                    className={`${ROW_GRID} cursor-pointer list-none px-3 py-2 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04] [&::-webkit-details-marker]:hidden`}
                  >
                    <span className="disclosure-chevron inline-flex text-zinc-400">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M7 5l6 5-6 5V5z" />
                      </svg>
                    </span>
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="truncate font-mono text-xs">{c.phone}</span>
                    <span className="text-right tabular-nums">
                      {Number(c.totalBd).toFixed(3)}
                    </span>
                    <span className="text-right tabular-nums">
                      {c.totalEntries}
                    </span>
                    <span className="text-right tabular-nums">
                      {c.invoiceCount}
                    </span>
                    <span className="truncate text-zinc-500">
                      {c.lastSeen ? c.lastSeen.toLocaleString() : '—'}
                    </span>
                  </summary>

                  <InvoiceList
                    receipts={c.receipts}
                    invoiceCount={c.invoiceCount}
                  />
                </details>
              ))
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function InvoiceList({
  receipts,
  invoiceCount,
}: {
  receipts: Array<{
    id: string;
    invoiceId: string;
    amount: Prisma.Decimal;
    entries: number;
    createdAt: Date | null;
    messageStatus: string | null;
    messageError: string | null;
  }>;
  invoiceCount: number;
}) {
  if (receipts.length === 0) {
    return (
      <p className="px-3 pb-3 pl-10 text-xs text-zinc-500">
        No invoices recorded for this contact.
      </p>
    );
  }

  return (
    <div className="bg-zinc-50 px-3 pb-3 pl-10 pt-1 dark:bg-zinc-900/40">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="py-1 font-medium">Invoice</th>
            <th className="py-1 font-medium">Date</th>
            <th className="py-1 text-right font-medium">Amount (BD)</th>
            <th className="py-1 text-right font-medium">Entries</th>
            <th className="py-1 font-medium">WhatsApp</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr
              key={r.id}
              className="border-t border-black/5 dark:border-white/5"
            >
              <td className="py-1.5 font-mono text-xs">{r.invoiceId}</td>
              <td className="py-1.5 text-zinc-500">
                {r.createdAt ? r.createdAt.toLocaleString() : '—'}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {Number(r.amount).toFixed(3)}
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.entries}</td>
              <td className="py-1.5">
                <StatusBadge status={r.messageStatus} error={r.messageError} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {invoiceCount > receipts.length && (
        <p className="pt-2 text-xs text-zinc-400">
          Showing the {receipts.length} most recent of {invoiceCount} invoices.
        </p>
      )}
    </div>
  );
}
