import { redirect } from 'next/navigation';
import AppNav from '@/components/app-nav';
import { getAnalyticsAccess } from '@/lib/analytics/access';
import { bahrainDayLabels, parseDateRange } from '@/lib/analytics/helpers';
import {
  getDailyScans,
  getDeliveryBreakdown,
  getOverviewStats,
  getPeakHours,
  getTopCustomers,
} from '@/lib/analytics/queries';
import AnalyticsFilters from './components/analytics-filters';
import StatCards from './components/stat-cards';
import DailyScansChart, {
  type ChartSeries,
} from './components/daily-scans-chart';
import DeliveryPieChart from './components/delivery-pie-chart';
import TopCustomersTable from './components/top-customers-table';
import PeakHoursHeatmap from './components/peak-hours-heatmap';

export const dynamic = 'force-dynamic';

/** Distinct, theme-safe hues for per-store lines; combined uses currentColor. */
const STORE_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#9333ea',
  '#dc2626',
  '#0891b2',
];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: {
    range?: string;
    from?: string;
    to?: string;
    store?: string;
  };
}) {
  const access = await getAnalyticsAccess();
  // Cashiers (and signed-out users) never reach analytics.
  if (!access) redirect('/scanner?error=unauthorized');

  const { profile, isAdmin, stores } = access;

  if (stores.length === 0) {
    return (
      <>
        <AppNav profile={profile} current="/analytics" />
        <main className="mx-auto w-full max-w-6xl flex-1 p-6">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are not assigned to any store.
          </p>
        </main>
      </>
    );
  }

  const range = parseDateRange(searchParams);
  const accessibleIds = stores.map((s) => s.id);

  // Only admins may narrow to a single store; a manager always sees the
  // combined view of their own stores, so their store param is ignored.
  const wantedStore =
    isAdmin && searchParams.store && accessibleIds.includes(searchParams.store)
      ? searchParams.store
      : '';
  const activeStoreIds = wantedStore ? [wantedStore] : accessibleIds;

  const [overview, previous, dailyPoints, delivery, topCustomers, peakHours] =
    await Promise.all([
      getOverviewStats(activeStoreIds, range.start, range.end),
      getOverviewStats(activeStoreIds, range.previousStart, range.previousEnd),
      getDailyScans(activeStoreIds, range.start, range.end),
      getDeliveryBreakdown(activeStoreIds, range.start, range.end),
      getTopCustomers(activeStoreIds, isAdmin),
      getPeakHours(activeStoreIds, range.start, range.end),
    ]);

  // --- Build the line-chart series aligned to a fixed day axis. ---
  const days = bahrainDayLabels(range.start, range.end);
  const activeStores = stores.filter((s) => activeStoreIds.includes(s.id));

  const byStore = new Map<string, Map<string, number>>();
  for (const p of dailyPoints) {
    const m = byStore.get(p.storeId) ?? new Map<string, number>();
    m.set(p.day, p.count);
    byStore.set(p.storeId, m);
  }

  let series: ChartSeries[];
  if (activeStores.length <= 1) {
    const target = activeStores[0];
    const m = target ? (byStore.get(target.id) ?? new Map()) : new Map();
    series = [
      {
        key: target?.id ?? 'scans',
        name: target?.nameEn ?? 'Scans',
        color: STORE_PALETTE[0],
        counts: days.map((d) => m.get(d) ?? 0),
      },
    ];
  } else {
    series = activeStores.map((s, i) => {
      const m = byStore.get(s.id) ?? new Map();
      return {
        key: s.id,
        name: s.nameEn,
        color: STORE_PALETTE[i % STORE_PALETTE.length],
        counts: days.map((d) => m.get(d) ?? 0),
      };
    });
    // Bold combined line on top.
    series.push({
      key: 'combined',
      name: 'Combined',
      color: 'currentColor',
      emphasis: true,
      counts: days.map((_, i) => series.reduce((sum, s) => sum + s.counts[i], 0)),
    });
  }

  return (
    <>
      <AppNav profile={profile} current="/analytics" />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <span className="text-sm text-zinc-500">
            {range.label}
            {wantedStore
              ? ` · ${activeStores[0]?.nameEn}`
              : stores.length > 1
                ? ' · all stores'
                : ` · ${stores[0]?.nameEn}`}
          </span>
        </div>

        <AnalyticsFilters
          preset={range.preset}
          store={wantedStore}
          from={searchParams.from}
          to={searchParams.to}
          isAdmin={isAdmin}
          stores={stores}
        />

        <StatCards current={overview} previous={previous} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DailyScansChart days={days} series={series} />
          <DeliveryPieChart data={delivery} />
        </div>

        <TopCustomersTable
          rows={topCustomers}
          canReveal={isAdmin}
          showStore={activeStores.length > 1}
        />

        <PeakHoursHeatmap data={peakHours} />
      </main>
    </>
  );
}
