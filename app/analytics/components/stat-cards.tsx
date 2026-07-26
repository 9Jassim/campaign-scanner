import { formatBd, formatNumber, percentChange } from '@/lib/analytics/helpers';
import type { OverviewStats } from '@/lib/analytics/types';

/**
 * The four headline totals, each with its change against the previous period
 * of the same length.
 */
export default function StatCards({
  current,
  previous,
}: {
  current: OverviewStats;
  previous: OverviewStats;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        title="Total scans"
        value={formatNumber(current.scans)}
        sub="in selected range"
        current={current.scans}
        previous={previous.scans}
      />
      <Card
        title="Unique customers"
        value={formatNumber(current.customers)}
        sub="with at least 1 scan"
        current={current.customers}
        previous={previous.customers}
      />
      <Card
        title="Total entries"
        value={formatNumber(current.entries)}
        sub="into the draw"
        current={current.entries}
        previous={previous.entries}
      />
      <Card
        title="Total campaign BD"
        value={formatBd(current.totalBd)}
        sub="across all receipts"
        current={current.totalBd}
        previous={previous.totalBd}
      />
    </div>
  );
}

function Card({
  title,
  value,
  sub,
  current,
  previous,
}: {
  title: string;
  value: string;
  sub: string;
  current: number;
  previous: number;
}) {
  const change = percentChange(current, previous);

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xs text-zinc-500">{sub}</span>
        <Delta change={change} />
      </div>
    </div>
  );
}

function Delta({ change }: { change: number | null }) {
  if (change === null) {
    return (
      <span className="text-xs text-zinc-400" title="No activity in the previous period">
        new
      </span>
    );
  }
  const rounded = Math.round(change);
  if (rounded === 0) {
    return <span className="text-xs text-zinc-400">no change</span>;
  }
  const up = rounded > 0;
  return (
    <span
      className={
        up
          ? 'text-xs font-medium text-green-600 dark:text-green-400'
          : 'text-xs font-medium text-red-600 dark:text-red-400'
      }
      title="vs previous period"
    >
      {up ? '▲' : '▼'} {Math.abs(rounded)}%
    </span>
  );
}
