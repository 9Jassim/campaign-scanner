import {
  getCurrentUserProfile,
  canExport,
  resolveActiveStore,
} from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDateTimeCsv, todayInBahrain } from '@/lib/datetime';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A full campaign's raffle entries can take a while to page through.
export const maxDuration = 300;

const TYPES = ['contacts', 'receipts', 'raffle'] as const;
type ExportType = (typeof TYPES)[number];

const STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped'];

/**
 * Rows fetched per query while streaming.
 *
 * There is deliberately no overall cap. This used to `take: 10000` and return
 * whatever fit, silently dropping the rest — which, since the prize draw is run
 * off exported data, meant entries that could never win with nothing on screen
 * to say so. Paging keeps memory flat instead of trading correctness for it.
 */
const PAGE_SIZE = 5_000;

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export async function GET(request: Request) {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!canExport(profile)) {
    return new Response('Forbidden', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') as ExportType | null;
  if (!type || !TYPES.includes(type)) {
    return new Response('Invalid export type', { status: 400 });
  }

  // Export is per-store, matching the on-screen separation.
  const { store } = await resolveActiveStore(
    profile,
    searchParams.get('storeId') ?? undefined,
  );
  if (!store) {
    return new Response('No accessible store', { status: 403 });
  }

  const q = searchParams.get('q')?.trim() ?? '';
  const status = STATUSES.includes(searchParams.get('status') ?? '')
    ? searchParams.get('status')!
    : '';

  const { header, pageFn } = buildExport(type, store.id, q, status);

  // Stream: rows are fetched a page at a time while the browser is already
  // downloading, so a 300,000-entry raffle costs the same memory as a small one.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // UTF-8 BOM so Excel renders Arabic names correctly.
      controller.enqueue(encoder.encode('﻿' + csvRow(header) + '\r\n'));
      try {
        let cursor: string | undefined;
        for (;;) {
          const { lines, nextCursor } = await pageFn(cursor);
          if (lines.length === 0) break;
          controller.enqueue(encoder.encode(lines.join('\r\n') + '\r\n'));
          if (!nextCursor) break;
          cursor = nextCursor;
        }
      } catch (err) {
        // The response has already started, so the status code is long gone.
        // Put the failure in the file itself rather than let it end early and
        // look like a complete export.
        console.error('[export] failed mid-stream:', err);
        controller.enqueue(
          encoder.encode(
            csvRow([
              'EXPORT FAILED — this file is incomplete, do not use it for the draw',
            ]) + '\r\n',
          ),
        );
      }
      controller.close();
    },
  });

  const filename = `${type}-${store.slug}-${todayInBahrain()}.csv`;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Nothing should cache a partially-streamed file.
      'Cache-Control': 'no-store',
    },
  });
}

interface Page {
  lines: string[];
  /** Id to resume from, or undefined when this was the last page. */
  nextCursor?: string;
}

/**
 * Header row plus a function that fetches one page of CSV lines.
 *
 * Paging is by id cursor rather than `skip`, which slows to a crawl once the
 * offset is in the hundreds of thousands. Every ordering ends with `id` so it
 * is total — two rows sharing a timestamp can't shuffle between pages and get
 * duplicated or skipped.
 */
function buildExport(
  type: ExportType,
  storeId: string,
  q: string,
  status: string,
): { header: string[]; pageFn: (cursor?: string) => Promise<Page> } {
  // Explicitly typed: without it the two branches infer as a union of object
  // literals, which does not match Prisma's argument type.
  const page = (
    cursor?: string,
  ): { cursor?: { id: string }; skip?: number } =>
    cursor ? { cursor: { id: cursor }, skip: 1 } : {};

  if (type === 'contacts') {
    const where: Prisma.ContactWhereInput = { storeId };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ];
    }
    return {
      header: [
        'Name',
        'Phone',
        'Total BD',
        'Total Entries',
        'Invoice Count',
        'Last Seen (Bahrain)',
        'Invoice IDs',
      ],
      pageFn: async (cursor) => {
        const rows = await db.contact.findMany({
          where,
          orderBy: [{ lastSeen: 'desc' }, { id: 'asc' }],
          take: PAGE_SIZE,
          ...page(cursor),
        });
        return {
          lines: rows.map((c) =>
            csvRow([
              c.name,
              c.phone,
              Number(c.totalBd).toFixed(3),
              c.totalEntries,
              c.invoiceCount,
              formatDateTimeCsv(c.lastSeen),
              c.invoiceIds.join(' | '),
            ]),
          ),
          nextCursor:
            rows.length === PAGE_SIZE ? rows[rows.length - 1].id : undefined,
        };
      },
    };
  }

  if (type === 'receipts') {
    const where: Prisma.ReceiptWhereInput = { storeId };
    if (status) where.messageStatus = status;
    if (q) {
      where.OR = [
        { invoiceId: { contains: q, mode: 'insensitive' } },
        { contact: { name: { contains: q, mode: 'insensitive' } } },
        { contact: { phone: { contains: q } } },
      ];
    }
    return {
      header: [
        'Timestamp (Bahrain)',
        'Invoice ID',
        'Name',
        'Phone',
        'Amount (BD)',
        'Entries This Receipt',
        'Total Entries At Time',
        'Message Status',
        'Message Error',
        'Cashier',
      ],
      pageFn: async (cursor) => {
        const rows = await db.receipt.findMany({
          where,
          include: { contact: { select: { name: true, phone: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: PAGE_SIZE,
          ...page(cursor),
        });
        return {
          lines: rows.map((r) =>
            csvRow([
              formatDateTimeCsv(r.createdAt),
              r.invoiceId,
              r.contact.name,
              r.contact.phone,
              Number(r.amount).toFixed(3),
              r.entries,
              r.totalEntriesAtTime ?? '',
              r.messageStatus ?? '',
              r.messageError ?? '',
              r.cashierUsername ?? '',
            ]),
          ),
          nextCursor:
            rows.length === PAGE_SIZE ? rows[rows.length - 1].id : undefined,
        };
      },
    };
  }

  const where: Prisma.RaffleEntryWhereInput = { storeId };
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
  return {
    header: ['Entry #', 'Name', 'Phone', 'Invoice ID', 'Timestamp (Bahrain)'],
    pageFn: async (cursor) => {
      const rows = await db.raffleEntry.findMany({
        where,
        orderBy: [{ entryNumber: 'asc' }, { id: 'asc' }],
        take: PAGE_SIZE,
        ...page(cursor),
      });
      return {
        lines: rows.map((e) =>
          csvRow([
            e.entryNumber,
            e.name,
            e.phone,
            e.invoiceId,
            formatDateTimeCsv(e.createdAt),
          ]),
        ),
        nextCursor:
          rows.length === PAGE_SIZE ? rows[rows.length - 1].id : undefined,
      };
    },
  };
}
