import Link from 'next/link';

/**
 * A clickable column header that sorts a list page via URL params (`sort`,
 * `dir`). Server-rendered like the rest of the list pages: clicking navigates,
 * so sort state lives in the URL and survives refresh and sharing.
 *
 * Clicking the active column flips direction; clicking a new column starts at
 * its natural default. Sorting always returns to page 1.
 */

export type SortDir = 'asc' | 'desc';

export default function SortHeader({
  label,
  column,
  currentSort,
  currentDir,
  basePath,
  params,
  defaultDir = 'desc',
  className = '',
}: {
  label: string;
  column: string;
  currentSort: string;
  currentDir: SortDir;
  basePath: string;
  /** Query params to preserve (store, search, status, …). `page` is dropped. */
  params: Record<string, string | undefined>;
  defaultDir?: SortDir;
  className?: string;
}) {
  const active = currentSort === column;
  const nextDir: SortDir = active
    ? currentDir === 'asc'
      ? 'desc'
      : 'asc'
    : defaultDir;

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  sp.set('sort', column);
  sp.set('dir', nextDir);

  const arrow = active ? (currentDir === 'asc' ? '▲' : '▼') : '↕';

  return (
    <Link
      href={`${basePath}?${sp.toString()}`}
      className={`inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground ${
        active ? 'text-foreground' : ''
      } ${className}`}
    >
      {label}
      <span className="text-[9px] text-zinc-400">{arrow}</span>
    </Link>
  );
}

/**
 * Validate raw `sort`/`dir` params against the columns a page allows, falling
 * back when they're missing or unknown.
 */
export function parseSort<T extends string>(
  rawSort: string | undefined,
  rawDir: string | undefined,
  allowed: readonly T[],
  fallback: { sort: T; dir: SortDir },
): { sort: T; dir: SortDir } {
  const sort = (allowed as readonly string[]).includes(rawSort ?? '')
    ? (rawSort as T)
    : fallback.sort;
  const dir: SortDir =
    rawDir === 'asc' || rawDir === 'desc' ? rawDir : fallback.dir;
  return { sort, dir };
}
