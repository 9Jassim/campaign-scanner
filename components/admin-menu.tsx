'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export interface AdminLink {
  href: string;
  label: string;
}

/**
 * The admin-only pages folded into one dropdown, so the nav stays short.
 * They are occasional-use (user management, sheet syncs, outage imports) —
 * the daily pages keep their own top-level links.
 */
export default function AdminMenu({
  links,
  current,
}: {
  links: AdminLink[];
  current: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = links.some((l) => l.href === current);

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          active
            ? 'flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background'
            : 'flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.06]'
        }
      >
        Admin
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="M5.5 7.5L10 12l4.5-4.5H5.5z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-lg border border-black/10 bg-background p-1 shadow-lg dark:border-white/15"
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={
                l.href === current
                  ? 'block rounded-md bg-black/[.06] px-3 py-1.5 text-sm font-medium dark:bg-white/[.1]'
                  : 'block rounded-md px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]'
              }
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
