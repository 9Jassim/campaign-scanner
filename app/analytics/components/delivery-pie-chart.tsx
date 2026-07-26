import { formatNumber } from '@/lib/analytics/helpers';
import type { DeliveryDatum } from '@/lib/analytics/types';

/**
 * Donut of message-delivery outcomes, drawn with a CSS conic-gradient (no
 * charting dependency). Slice counts and percentages live in the legend; the
 * hole shows the total.
 */

interface StatusMeta {
  label: string;
  color: string;
}

// Order is the drawing order around the donut. Colours are fixed hues (a pie
// needs distinct, meaningful colours rather than the theme's neutrals).
const STATUS_META: Record<string, StatusMeta> = {
  delivered: { label: 'Delivered', color: '#16a34a' },
  read: { label: 'Read', color: '#2563eb' },
  sent: { label: 'Sent', color: '#86efac' },
  'sent-via-failover': { label: 'Via failover', color: '#14b8a6' },
  pending: { label: 'Pending', color: '#a1a1aa' },
  failed: { label: 'Failed', color: '#dc2626' },
  skipped: { label: 'Skipped', color: '#eab308' },
};

const ORDER = Object.keys(STATUS_META);
const FALLBACK: StatusMeta = { label: 'Other', color: '#71717a' };

export default function DeliveryPieChart({ data }: { data: DeliveryDatum[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  const slices = [...data]
    .filter((d) => d.count > 0)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h2 className="text-sm font-semibold">Message delivery</h2>

      {total === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          No messages in this range.
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <Donut slices={slices} total={total} />
          <ul className="flex-1 space-y-1.5 text-sm">
            {slices.map((s) => {
              const meta = STATUS_META[s.status] ?? FALLBACK;
              const pct = Math.round((s.count / total) * 100);
              return (
                <li key={s.status} className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: meta.color }}
                  />
                  <span className="flex-1">{meta.label}</span>
                  <span className="tabular-nums text-zinc-500">
                    {formatNumber(s.count)} · {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Donut({
  slices,
  total,
}: {
  slices: DeliveryDatum[];
  total: number;
}) {
  // Build the conic-gradient stop list, walking the ring slice by slice.
  const stops: string[] = [];
  let acc = 0;
  for (const s of slices) {
    const meta = STATUS_META[s.status] ?? FALLBACK;
    const from = (acc / total) * 100;
    acc += s.count;
    const to = (acc / total) * 100;
    stops.push(`${meta.color} ${from}% ${to}%`);
  }

  return (
    <div
      className="relative h-40 w-40 shrink-0 rounded-full"
      style={{ background: `conic-gradient(${stops.join(', ')})` }}
      role="img"
      aria-label="Message delivery breakdown"
    >
      <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-background text-center">
        <span className="text-xl font-semibold tabular-nums">
          {formatNumber(total)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          messages
        </span>
      </div>
    </div>
  );
}
