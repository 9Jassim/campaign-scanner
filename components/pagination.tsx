import Link from 'next/link';

/**
 * URL-based pager. Keeps the current filters in the links so paging never
 * silently drops a search or store selection.
 *
 * The filter forms deliberately do not submit a `page` field, so changing a
 * filter resets you to page 1 rather than stranding you on an out-of-range page.
 */
export default function Pagination({
  basePath,
  params,
  page,
  totalPages,
  totalItems,
  perPage,
}: {
  basePath: string;
  /** Current filter params to preserve (e.g. storeId, q, status). */
  params: Record<string, string | undefined>;
  page: number;
  totalPages: number;
  totalItems: number;
  perPage: number;
}) {
  if (totalPages <= 1) return null;

  const hrefFor = (target: number) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) sp.set(key, value);
    }
    sp.set('page', String(target));
    return `${basePath}?${sp.toString()}`;
  };

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, totalItems);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span className="text-xs text-zinc-500">
        Showing {first}–{last} of {totalItems} · Page {page} of {totalPages}
      </span>

      <div className="flex items-center gap-2">
        <PageLink href={hrefFor(page - 1)} disabled={page <= 1}>
          ← Previous
        </PageLink>
        <PageLink href={hrefFor(page + 1)} disabled={page >= totalPages}>
          Next →
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const base =
    'flex h-9 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors';

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} cursor-not-allowed border-black/5 text-zinc-400 dark:border-white/5 dark:text-zinc-600`}
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`${base} border-black/10 hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]`}
    >
      {children}
    </Link>
  );
}

/** Parse a `page` query param into a sane 1-based page number. */
export function parsePageParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
