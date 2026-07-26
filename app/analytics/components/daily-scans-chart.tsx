'use client';

import { useRef, useState } from 'react';

/**
 * Scans per day, hand-drawn as an SVG line chart (no charting dependency).
 * One line per store when more than one is in view, plus a bold "combined"
 * line; a single store shows just its own line. Hovering reveals a guideline
 * and a tooltip with each series' value for that day.
 */

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  /** Aligned 1:1 with `days`. */
  counts: number[];
  /** The bold total line. */
  emphasis?: boolean;
}

const VIEW_W = 800;
const VIEW_H = 300;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 40;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

export default function DailyScansChart({
  days,
  series,
}: {
  days: string[];
  series: ChartSeries[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = days.length;
  const maxY = Math.max(1, ...series.flatMap((s) => s.counts));
  const niceMax = niceCeil(maxY);

  const x = (i: number) =>
    n <= 1 ? PAD_L + PLOT_W / 2 : PAD_L + (i / (n - 1)) * PLOT_W;
  const y = (v: number) => PAD_T + PLOT_H - (v / niceMax) * PLOT_H;

  const hasData = series.some((s) => s.counts.some((c) => c > 0));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || n === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const vx = frac * VIEW_W;
    const i = Math.round(((vx - PAD_L) / PLOT_W) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const yTicks = [0, niceMax / 2, niceMax];

  // Aim for ~8 date labels regardless of range length. The last day is always
  // shown, and any regular label sitting too close to it is dropped so they
  // don't print on top of each other at the right edge.
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const lastIdx = n - 1;
  const xLabelIdx = new Set<number>();
  for (let i = 0; i < n; i += labelStep) xLabelIdx.add(i);
  for (const idx of Array.from(xLabelIdx)) {
    if (lastIdx - idx > 0 && lastIdx - idx < labelStep * 0.6) xLabelIdx.delete(idx);
  }
  xLabelIdx.add(lastIdx);

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Daily scans</h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span className={s.emphasis ? 'font-medium' : ''}>{s.name}</span>
            </li>
          ))}
        </ul>
      </div>

      {!hasData ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          No scans in this range.
        </p>
      ) : (
        <div className="relative mt-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full"
            style={{ height: 'auto' }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label="Daily scans line chart"
          >
            {/* Y grid + labels */}
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD_L}
                  x2={VIEW_W - PAD_R}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="currentColor"
                  strokeOpacity={0.1}
                />
                <text
                  x={PAD_L - 8}
                  y={y(t) + 5}
                  textAnchor="end"
                  className="fill-current text-[15px] text-zinc-500"
                >
                  {Math.round(t)}
                </text>
              </g>
            ))}

            {/* X labels */}
            {days.map((d, i) =>
              xLabelIdx.has(i) ? (
                <text
                  key={d}
                  x={x(i)}
                  y={VIEW_H - 12}
                  textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}
                  className="fill-current text-[14px] text-zinc-500"
                >
                  {d.slice(5)}
                </text>
              ) : null,
            )}

            {/* Hover guideline */}
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD_T}
                y2={PAD_T + PLOT_H}
                stroke="currentColor"
                strokeOpacity={0.25}
              />
            )}

            {/* Series */}
            {series.map((s) => (
              <g key={s.key}>
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.emphasis ? 2.5 : 1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={s.counts.map((c, i) => `${x(i)},${y(c)}`).join(' ')}
                />
                {hover !== null && (
                  <circle
                    cx={x(hover)}
                    cy={y(s.counts[hover] ?? 0)}
                    r={s.emphasis ? 3.5 : 2.5}
                    fill={s.color}
                  />
                )}
              </g>
            ))}
          </svg>

          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-black/10 bg-background px-2 py-1 text-xs shadow-md dark:border-white/15"
              style={{ left: `${(x(hover) / VIEW_W) * 100}%` }}
            >
              <div className="font-medium">{days[hover]}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-zinc-500">{s.name}</span>
                  <span className="ml-auto tabular-nums font-medium">
                    {s.counts[hover] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Round a max up to a friendly axis top (1, 2, 5 × 10ⁿ). */
function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}
