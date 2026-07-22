import Link from 'next/link';
import type { UserProfile } from '@prisma/client';
import AdminMenu, { type AdminLink } from './admin-menu';
import SessionGuard from './session-guard';
import SignOutButton from './sign-out-button';
import ThemeToggle from './theme-toggle';

interface NavLink {
  href: string;
  label: string;
  roles: Array<'admin' | 'manager' | 'cashier'>;
}

/** Daily-use pages keep top-level links; admin-only pages live in the menu. */
const LINKS: NavLink[] = [
  { href: '/scanner', label: 'Scanner', roles: ['admin', 'manager', 'cashier'] },
  { href: '/contacts', label: 'Contacts', roles: ['admin', 'manager'] },
  { href: '/receipts', label: 'Receipts', roles: ['admin', 'manager'] },
  { href: '/raffle', label: 'Raffle', roles: ['admin', 'manager'] },
  { href: '/messages', label: 'Messages', roles: ['admin', 'manager'] },
];

const ADMIN_LINKS: AdminLink[] = [
  { href: '/settings', label: 'Settings' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/sheets', label: 'Google Sheets' },
  { href: '/admin/import-failover', label: 'Failover import' },
];

export default function AppNav({
  profile,
  current,
}: {
  profile: UserProfile;
  current: string;
}) {
  const role = profile.role as 'admin' | 'manager' | 'cashier';
  const links = LINKS.filter((l) => l.roles.includes(role));

  return (
    <>
      {/* Lives here because the nav renders on every signed-in page. */}
      <SessionGuard username={profile.username} />
      <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <nav className="flex flex-wrap items-center gap-1">
          {links.map((l) => {
            const active = l.href === current;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  active
                    ? 'rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background'
                    : 'rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.06]'
                }
              >
                {l.label}
              </Link>
            );
          })}
          {role === 'admin' && (
            <AdminMenu links={ADMIN_LINKS} current={current} />
          )}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-500 sm:inline">
            {profile.fullName ?? profile.username} · {profile.role}
          </span>
          <ThemeToggle />
          <SignOutButton />
        </div>
        </div>
      </header>
    </>
  );
}
