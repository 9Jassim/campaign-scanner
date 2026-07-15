import {
  getCurrentUserProfile,
  canExport,
  resolveActiveStore,
} from '@/lib/auth';
import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

const TYPES = ['contacts', 'receipts', 'raffle'] as const;
type ExportType = (typeof TYPES)[number];

const STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped'];
const MAX_ROWS = 10000;

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString() : '';
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

  let rows: string[] = [];
  let header: string[] = [];

  if (type === 'contacts') {
    const where: Prisma.ContactWhereInput = { storeId: store.id };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ];
    }
    const contacts = await db.contact.findMany({
      where,
      orderBy: { lastSeen: 'desc' },
      take: MAX_ROWS,
    });
    header = [
      'Name',
      'Phone',
      'Total BD',
      'Total Entries',
      'Invoice Count',
      'Last Seen',
      'Invoice IDs',
    ];
    rows = contacts.map((c) =>
      csvRow([
        c.name,
        c.phone,
        Number(c.totalBd).toFixed(3),
        c.totalEntries,
        c.invoiceCount,
        fmtDate(c.lastSeen),
        c.invoiceIds.join(' | '),
      ]),
    );
  } else if (type === 'receipts') {
    const status = STATUSES.includes(searchParams.get('status') ?? '')
      ? searchParams.get('status')!
      : '';
    const where: Prisma.ReceiptWhereInput = { storeId: store.id };
    if (status) where.messageStatus = status;
    if (q) {
      where.OR = [
        { invoiceId: { contains: q, mode: 'insensitive' } },
        { contact: { name: { contains: q, mode: 'insensitive' } } },
        { contact: { phone: { contains: q } } },
      ];
    }
    const receipts = await db.receipt.findMany({
      where,
      include: { contact: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    header = [
      'Timestamp',
      'Invoice ID',
      'Name',
      'Phone',
      'Amount (BD)',
      'Entries This Receipt',
      'Total Entries At Time',
      'Message Status',
      'Message Error',
      'Cashier Email',
    ];
    rows = receipts.map((r) =>
      csvRow([
        fmtDate(r.createdAt),
        r.invoiceId,
        r.contact.name,
        r.contact.phone,
        Number(r.amount).toFixed(3),
        r.entries,
        r.totalEntriesAtTime ?? '',
        r.messageStatus ?? '',
        r.messageError ?? '',
        r.cashierEmail ?? '',
      ]),
    );
  } else {
    // raffle
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
    const entries = await db.raffleEntry.findMany({
      where,
      orderBy: { entryNumber: 'asc' },
      take: MAX_ROWS,
    });
    header = ['Entry #', 'Name', 'Phone', 'Invoice ID', 'Timestamp'];
    rows = entries.map((e) =>
      csvRow([e.entryNumber, e.name, e.phone, e.invoiceId, fmtDate(e.createdAt)]),
    );
  }

  // Prepend a UTF-8 BOM so Excel renders Arabic names correctly.
  const csv = '﻿' + [csvRow(header), ...rows].join('\r\n');
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${type}-${store.slug}-${date}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
