import type { PeakHourCell } from '@/lib/analytics/types';

/**
 * Scan volume by hour × day of week (Bahrain time), as a coloured grid — darker
 * means busier. Server-rendered: the only interactivity is the native tooltip
 * on each cell, so no client JS is needed.
 */

// Postgres DOW: 0 = Sunday. Bahrain's week starts Sunday, so this order is it.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function PeakHoursHeatmap({ data }: { data: PeakHourCell[] }) {
  const counts = new Map<string, number>();
  let max = 0;
  for (const c of data) {
    counts.set(`${c.dayOfWeek}-${c.hour}`, c.count);
    if (c.count > max) max = c.count;
  }

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Peak scanning hours</h2>
        <Legend max={max} />
      </div>

      {max === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          No scans in this range.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[640px]">
            {/* Hour labels, every third hour to stay readable. */}
            <div className="mb-1 grid grid-cols-[2.5rem_repeat(24,1fr)] gap-0.5">
              <span />
              {HOURS.map((h) => (
                <span
                  key={h}
                  className="text-center text-[10px] tabular-nums text-zinc-400"
                >
                  {h % 3 === 0 ? h : ''}
                </span>
              ))}
            </div>

            {DAYS.map((day, dow) => (
              <div
                key={day}
                className="mb-0.5 grid grid-cols-[2.5rem_repeat(24,1fr)] items-center gap-0.5"
              >
                <span className="text-xs font-medium text-zinc-500">{day}</span>
                {HOURS.map((h) => {
                  const count = counts.get(`${dow}-${h}`) ?? 0;
                  return (
                    <div
                      key={h}
                      title={`${day} ${String(h).padStart(2, '0')}:00 — ${count} scan${count === 1 ? '' : 's'}`}
                      className="aspect-square rounded-[3px] border border-black/[.04] dark:border-white/[.04]"
                      style={{ backgroundColor: cellColor(count, max) }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Emerald with alpha scaled to intensity; empty cells stay faintly neutral. */
function cellColor(count: number, max: number): string {
  if (count === 0) return 'rgba(113,113,122,0.08)';
  const alpha = 0.15 + 0.85 * (count / max);
  return `rgba(16,185,129,${alpha.toFixed(3)})`;
}

function Legend({ max }: { max: number }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-zinc-400">
      <span>0</span>
      <span
        className="h-2 w-24 rounded-full"
        style={{
          background:
            'linear-gradient(to right, rgba(113,113,122,0.08), rgba(16,185,129,1))',
        }}
      />
      <span className="tabular-nums">{max}</span>
    </div>
  );
}
