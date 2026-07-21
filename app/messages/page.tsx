import { requireManager, resolveActiveStore } from '@/lib/auth';
import { db } from '@/lib/db';
import AppNav from '@/components/app-nav';
import FilterBar from '@/components/filter-bar';
import Pagination, { parsePageParam } from '@/components/pagination';
import { formatDateTime } from '@/lib/datetime';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

/**
 * Messages customers have sent to the store's WhatsApp number.
 *
 * Read-only on purpose. The number is registered with the Cloud API, so
 * replying from here would mean rebuilding a chat client and living inside
 * WhatsApp's 24-hour reply window; staff contact customers themselves instead.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: { storeId?: string; q?: string; page?: string };
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
        <AppNav profile={profile} current="/messages" />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">
            Messages
          </h1>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are not assigned to any store.
          </p>
        </main>
      </>
    );
  }

  const where: Prisma.CustomerMessageWhereInput = { storeId: store.id };
  if (q) {
    where.OR = [
      { fromPhone: { contains: q } },
      { messageText: { contains: q, mode: 'insensitive' } },
    ];
  }

  const total = await db.customerMessage.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(parsePageParam(searchParams.page), totalPages);

  const messages = await db.customerMessage.findMany({
    where,
    orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
  });

  // Who wrote in — looked up ONLY within this store. The two stores are
  // separate companies, so a sender who is a customer of the other one must
  // read as unknown here rather than leak across.
  const senders = [...new Set(messages.map((m) => m.fromPhone))];
  const contacts = senders.length
    ? await db.contact.findMany({
        where: { storeId: store.id, phone: { in: senders } },
        select: { phone: true, name: true, totalEntries: true },
      })
    : [];
  const byPhone = new Map(contacts.map((c) => [c.phone, c]));

  return (
    <>
      <AppNav profile={profile} current="/messages" />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
          <span className="text-sm text-zinc-500">· {store.nameEn}</span>
        </div>

        <p className="text-sm text-zinc-500">
          What customers have sent to this store&apos;s WhatsApp number. Replies
          are not sent from the portal — contact the customer directly.
        </p>

        <FilterBar
          action="/messages"
          stores={stores}
          selectedStoreId={store.id}
          q={q}
          searchPlaceholder="Search by phone or message"
          allowAllStores={false}
        />

        <p className="text-xs text-zinc-500">
          {total} message{total === 1 ? '' : 's'}
        </p>

        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Received</th>
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-zinc-500">
                    No messages yet.
                  </td>
                </tr>
              ) : (
                messages.map((m) => {
                  const contact = byPhone.get(m.fromPhone);
                  return (
                    <tr
                      key={m.id}
                      className="border-t border-black/5 align-top dark:border-white/5"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-zinc-500">
                        {formatDateTime(m.receivedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{m.fromPhone}</div>
                        {contact ? (
                          <div className="text-xs text-zinc-500">
                            {contact.name} · {contact.totalEntries}{' '}
                            {contact.totalEntries === 1 ? 'entry' : 'entries'}
                          </div>
                        ) : (
                          <div className="text-xs text-zinc-400">
                            Not a customer of this store
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {m.messageText ? (
                          // whitespace-pre-line keeps the line breaks a
                          // customer typed; React escapes the text itself.
                          <span className="whitespace-pre-line break-words">
                            {m.messageText}
                          </span>
                        ) : (
                          <span className="text-zinc-400">
                            {m.messageType
                              ? `(${m.messageType} — no text)`
                              : '(no text)'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          basePath="/messages"
          params={{ storeId: store.id, q }}
          page={page}
          totalPages={totalPages}
          totalItems={total}
          perPage={PER_PAGE}
        />
      </main>
    </>
  );
}
