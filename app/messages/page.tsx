import { requireManager, resolveActiveStore } from '@/lib/auth';
import { db } from '@/lib/db';
import AppNav from '@/components/app-nav';
import FilterBar from '@/components/filter-bar';
import Pagination, { parsePageParam } from '@/components/pagination';
import { formatDateTime } from '@/lib/datetime';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** Conversations per page — one row per person who has written in. */
const PER_PAGE = 25;
/** Most recent messages shown inside a thread, so one chatty customer can't
 *  drag the whole page down. */
const MESSAGES_PER_THREAD = 50;

interface ThreadMessage {
  id: string;
  messageText: string | null;
  messageType: string | null;
  receivedAt: Date | null;
}

/**
 * Messages customers have sent to the store's WhatsApp number, grouped into a
 * conversation per sender.
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

  // One group per sender, most recently active first. Searching matches on any
  // message, and the whole thread is then shown — a reply reads oddly without
  // the message it answers.
  const groups = await db.customerMessage.groupBy({
    by: ['fromPhone'],
    where,
    _count: { _all: true },
    _max: { receivedAt: true },
    orderBy: { _max: { receivedAt: 'desc' } },
  });

  const totalConversations = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalConversations / PER_PAGE));
  const page = Math.min(parsePageParam(searchParams.page), totalPages);
  const pageGroups = groups.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const phones = pageGroups.map((g) => g.fromPhone);

  // Fetch every message for the senders on this page — not just the ones that
  // matched the search — so each thread reads in full.
  const messages = phones.length
    ? await db.customerMessage.findMany({
        where: { storeId: store.id, fromPhone: { in: phones } },
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true,
          fromPhone: true,
          messageText: true,
          messageType: true,
          receivedAt: true,
        },
      })
    : [];

  const threads = new Map<string, ThreadMessage[]>();
  for (const m of messages) {
    const thread = threads.get(m.fromPhone) ?? [];
    // Newest first from the query; keep the newest N, then flip to chat order.
    if (thread.length < MESSAGES_PER_THREAD) thread.push(m);
    threads.set(m.fromPhone, thread);
  }

  // Who wrote in — looked up ONLY within this store. The same person can shop
  // at both stores and hold a separate entry count at each, so a manager must
  // see their own store's figures and nothing of the other company's.
  const contacts = phones.length
    ? await db.contact.findMany({
        where: { storeId: store.id, phone: { in: phones } },
        select: { phone: true, name: true, totalEntries: true },
      })
    : [];
  const byPhone = new Map(contacts.map((c) => [c.phone, c]));

  const totalMessages = groups.reduce((sum, g) => sum + g._count._all, 0);

  return (
    <>
      <AppNav profile={profile} current="/messages" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
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
          {totalConversations} conversation{totalConversations === 1 ? '' : 's'}
          {totalConversations > 0 &&
            ` · ${totalMessages} message${totalMessages === 1 ? '' : 's'} · click to read`}
        </p>

        <div className="rounded-lg border border-black/10 dark:border-white/10">
          {pageGroups.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              No messages yet.
            </p>
          ) : (
            pageGroups.map((group) => {
              const contact = byPhone.get(group.fromPhone);
              const thread = threads.get(group.fromPhone) ?? [];
              const latest = thread[0]; // still newest-first here
              return (
                <details
                  key={group.fromPhone}
                  className="border-b border-black/5 last:border-b-0 dark:border-white/5"
                >
                  <summary className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-black/[.03] dark:hover:bg-white/[.04] [&::-webkit-details-marker]:hidden">
                    <span className="disclosure-chevron mt-0.5 inline-flex shrink-0 text-zinc-400">
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path d="M7 5l6 5-6 5V5z" />
                      </svg>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">
                          {contact?.name ?? group.fromPhone}
                        </span>
                        {contact && (
                          <span className="font-mono text-xs text-zinc-500">
                            {group.fromPhone}
                          </span>
                        )}
                        <span className="text-xs text-zinc-400">
                          {contact
                            ? `${contact.totalEntries} ${contact.totalEntries === 1 ? 'entry' : 'entries'}`
                            : 'Not a customer of this store'}
                        </span>
                      </span>
                      {latest && (
                        <span className="mt-0.5 block truncate text-sm text-zinc-500">
                          {latest.messageText ??
                            `(${latest.messageType ?? 'no text'})`}
                        </span>
                      )}
                    </span>

                    <span className="shrink-0 text-right text-xs text-zinc-400">
                      <span className="block whitespace-nowrap">
                        {formatDateTime(group._max.receivedAt)}
                      </span>
                      <span className="block">
                        {group._count._all}{' '}
                        {group._count._all === 1 ? 'message' : 'messages'}
                      </span>
                    </span>
                  </summary>

                  <Thread
                    messages={thread}
                    total={group._count._all}
                  />
                </details>
              );
            })
          )}
        </div>

        <Pagination
          basePath="/messages"
          params={{ storeId: store.id, q }}
          page={page}
          totalPages={totalPages}
          totalItems={totalConversations}
          perPage={PER_PAGE}
        />
      </main>
    </>
  );
}

/** One conversation, oldest message first so it reads like a chat. */
function Thread({
  messages,
  total,
}: {
  messages: ThreadMessage[];
  total: number;
}) {
  const inOrder = [...messages].reverse();

  return (
    <div className="bg-zinc-50 px-3 pb-4 pl-10 pt-1 dark:bg-zinc-900/40">
      {total > messages.length && (
        <p className="pb-2 text-xs text-zinc-400">
          Showing the {messages.length} most recent of {total} messages.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {inOrder.map((m) => (
          <li key={m.id} className="flex flex-col gap-0.5">
            <div className="max-w-[85%] rounded-lg rounded-tl-sm border border-black/5 bg-background px-3 py-2 text-sm dark:border-white/10">
              {m.messageText ? (
                // whitespace-pre-line keeps the line breaks a customer typed;
                // React escapes the text itself.
                <span className="whitespace-pre-line break-words">
                  {m.messageText}
                </span>
              ) : (
                <span className="text-zinc-400">
                  {m.messageType ? `(${m.messageType} — no text)` : '(no text)'}
                </span>
              )}
            </div>
            <time className="pl-1 text-xs text-zinc-400">
              {formatDateTime(m.receivedAt)}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}
