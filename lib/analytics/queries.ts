import { unstable_cache } from 'next/cache';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { maskPhone } from './helpers';
import type {
  DailyScanPoint,
  DeliveryDatum,
  OverviewStats,
  PeakHourCell,
  TopCustomerRow,
} from './types';

/**
 * All analytics database access.
 *
 * Results are wrapped in `unstable_cache` with a 5-minute TTL, keyed by the
 * store set and date window, so repeatedly loading the dashboard doesn't re-run
 * the aggregates. Each function returns plain JSON-serialisable data (Decimals
 * converted to numbers) so it caches cleanly.
 *
 * Day/hour bucketing converts the naive-UTC `created_at` to Bahrain the right
 * way round: `AT TIME ZONE 'UTC'` reads the stored value as UTC, then
 * `AT TIME ZONE 'Asia/Bahrain'` shifts it to local wall-clock. Skipping the
 * first step would treat a UTC timestamp as if it were already local and
 * mislabel everything by three hours.
 */

const TTL = 300; // seconds

function keyOf(base: string, storeIds: string[], ...rest: string[]): string[] {
  return [base, [...storeIds].sort().join(','), ...rest];
}

/** Postgres `uuid[]` literal for the store filter. */
function storeArray(storeIds: string[]): Prisma.Sql {
  return Prisma.sql`ARRAY[${Prisma.join(storeIds)}]::uuid[]`;
}

const EMPTY_OVERVIEW: OverviewStats = {
  scans: 0,
  customers: 0,
  entries: 0,
  totalBd: 0,
};

export function getOverviewStats(
  storeIds: string[],
  start: Date,
  end: Date,
): Promise<OverviewStats> {
  if (storeIds.length === 0) return Promise.resolve(EMPTY_OVERVIEW);
  return unstable_cache(
    async () => {
      const where = {
        storeId: { in: storeIds },
        createdAt: { gte: start, lte: end },
      };
      const [scans, customerGroups, entries, totalBd] = await Promise.all([
        db.receipt.count({ where }),
        // Customers with at least one scan in the window (distinct contacts).
        db.receipt.groupBy({ by: ['contactId'], where }),
        db.raffleEntry.count({ where }),
        db.receipt.aggregate({ where, _sum: { amount: true } }),
      ]);
      return {
        scans,
        customers: customerGroups.length,
        entries,
        totalBd: Number(totalBd._sum.amount ?? 0),
      };
    },
    keyOf('overview', storeIds, start.toISOString(), end.toISOString()),
    { revalidate: TTL, tags: ['analytics'] },
  )();
}

export function getDailyScans(
  storeIds: string[],
  start: Date,
  end: Date,
): Promise<DailyScanPoint[]> {
  if (storeIds.length === 0) return Promise.resolve([]);
  return unstable_cache(
    async () => {
      const rows = await db.$queryRaw<
        { day: string; store_id: string; count: number }[]
      >`
        SELECT
          to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bahrain')::date, 'YYYY-MM-DD') AS day,
          store_id::text AS store_id,
          COUNT(*)::int AS count
        FROM receipts
        WHERE store_id = ANY(${storeArray(storeIds)})
          AND created_at >= ${start}
          AND created_at <= ${end}
        GROUP BY (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bahrain')::date, store_id
        ORDER BY day
      `;
      return rows.map((r) => ({
        day: r.day,
        storeId: r.store_id,
        count: Number(r.count),
      }));
    },
    keyOf('daily', storeIds, start.toISOString(), end.toISOString()),
    { revalidate: TTL, tags: ['analytics'] },
  )();
}

export function getDeliveryBreakdown(
  storeIds: string[],
  start: Date,
  end: Date,
): Promise<DeliveryDatum[]> {
  if (storeIds.length === 0) return Promise.resolve([]);
  return unstable_cache(
    async () => {
      const rows = await db.receipt.groupBy({
        by: ['messageStatus'],
        where: {
          storeId: { in: storeIds },
          createdAt: { gte: start, lte: end },
        },
        _count: { _all: true },
      });
      return rows.map((r) => ({
        // A null status is a receipt that never left "pending".
        status: r.messageStatus ?? 'pending',
        count: r._count._all,
      }));
    },
    keyOf('delivery', storeIds, start.toISOString(), end.toISOString()),
    { revalidate: TTL, tags: ['analytics'] },
  )();
}

export function getTopCustomers(
  storeIds: string[],
  canReveal: boolean,
  limit = 100,
): Promise<TopCustomerRow[]> {
  if (storeIds.length === 0) return Promise.resolve([]);
  return unstable_cache(
    async () => {
      const rows = await db.contact.findMany({
        where: { storeId: { in: storeIds } },
        orderBy: [{ totalEntries: 'desc' }, { totalBd: 'desc' }],
        take: limit,
        select: {
          name: true,
          phone: true,
          totalEntries: true,
          totalBd: true,
          invoiceCount: true,
          lastSeen: true,
          store: { select: { nameEn: true } },
        },
      });
      return rows.map((c) => ({
        name: c.name,
        storeName: c.store.nameEn,
        phoneMasked: maskPhone(c.phone),
        // Full number only leaves the server for admins.
        phoneFull: canReveal ? c.phone : undefined,
        totalEntries: c.totalEntries,
        totalBd: Number(c.totalBd),
        invoiceCount: c.invoiceCount,
        lastSeen: c.lastSeen ? c.lastSeen.toISOString() : null,
      }));
    },
    keyOf('top', storeIds, String(canReveal), String(limit)),
    { revalidate: TTL, tags: ['analytics'] },
  )();
}

export function getPeakHours(
  storeIds: string[],
  start: Date,
  end: Date,
): Promise<PeakHourCell[]> {
  if (storeIds.length === 0) return Promise.resolve([]);
  return unstable_cache(
    async () => {
      const rows = await db.$queryRaw<
        { day_of_week: number; hour: number; count: number }[]
      >`
        SELECT
          EXTRACT(DOW FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bahrain'))::int AS day_of_week,
          EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bahrain'))::int AS hour,
          COUNT(*)::int AS count
        FROM receipts
        WHERE store_id = ANY(${storeArray(storeIds)})
          AND created_at >= ${start}
          AND created_at <= ${end}
        GROUP BY day_of_week, hour
        ORDER BY day_of_week, hour
      `;
      return rows.map((r) => ({
        dayOfWeek: Number(r.day_of_week),
        hour: Number(r.hour),
        count: Number(r.count),
      }));
    },
    keyOf('peak', storeIds, start.toISOString(), end.toISOString()),
    { revalidate: TTL, tags: ['analytics'] },
  )();
}
