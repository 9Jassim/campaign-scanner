import { requireAdmin, getPermissions } from '@/lib/auth';
import { db } from '@/lib/db';
import AppNav from '@/components/app-nav';
import AutoSubmitSelect from '@/components/auto-submit-select';
import { createUser, updateUser, deleteUser } from './actions';
import type { Store, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'manager', 'cashier'] as const;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: {
    error?: string;
    created?: string;
    updated?: string;
    deleted?: string;
    q?: string;
    role?: string;
  };
}) {
  const admin = await requireAdmin();

  const q = searchParams.q?.trim() ?? '';
  const roleFilter = ROLES.includes(searchParams.role as (typeof ROLES)[number])
    ? searchParams.role!
    : '';

  const where: Prisma.UserProfileWhereInput = {};
  if (roleFilter) where.role = roleFilter;
  if (q) {
    where.OR = [
      { username: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { fullName: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [stores, users, totalUsers] = await Promise.all([
    db.store.findMany({ orderBy: { nameEn: 'asc' } }),
    db.userProfile.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { storeUsers: { select: { storeId: true } } },
    }),
    db.userProfile.count(),
  ]);

  const notice = searchParams.created
    ? 'User created.'
    : searchParams.updated
      ? 'User updated.'
      : searchParams.deleted
        ? 'User deleted.'
        : null;

  return (
    <>
      <AppNav profile={admin} current="/admin/users" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>

        {searchParams.error && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {searchParams.error}
          </p>
        )}
        {notice && (
          <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
            {notice}
          </p>
        )}

        {/* Create user */}
        <section className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Add user
          </h2>
          <form action={createUser} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                name="username"
                label="Username (used to sign in)"
                required
              />
              <TextInput name="fullName" label="Full name" />
              <TextInput name="email" label="Email (optional)" type="email" />
              <TextInput
                name="password"
                label="Password (min 8 chars)"
                type="password"
                required
              />
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-600 dark:text-zinc-400">
                  Role
                </span>
                <select
                  name="role"
                  defaultValue="cashier"
                  className="rounded-md border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <StorePicker stores={stores} checkedIds={new Set()} />
            <ExportToggle defaultChecked={false} />

            <div>
              <button
                type="submit"
                className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90"
              >
                Create user
              </button>
            </div>
          </form>
        </section>

        {/* Existing users */}
        <section className="flex flex-col gap-4">
          <form
            method="GET"
            action="/admin/users"
            className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10"
          >
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="font-medium text-zinc-500">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search by email or name"
                className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-zinc-500">Role</span>
              <AutoSubmitSelect
                name="role"
                defaultValue={roleFilter}
                className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
              >
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </AutoSubmitSelect>
            </label>

            <button
              type="submit"
              className="flex h-9 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              Apply
            </button>
          </form>

          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {users.length} user{users.length === 1 ? '' : 's'}
            {(q || roleFilter) && ` of ${totalUsers}`}
          </h2>

          {users.length === 0 && (
            <p className="rounded-lg border border-black/10 p-6 text-center text-sm text-zinc-500 dark:border-white/10">
              No users match these filters.
            </p>
          )}

          {users.map((u) => {
            const checkedIds = new Set(u.storeUsers.map((su) => su.storeId));
            const isSelf = u.id === admin.id;
            return (
              <details
                key={u.id}
                className="rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <span className="disclosure-chevron inline-flex text-zinc-400">
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-4 w-4 shrink-0"
                      >
                        <path d="M7 5l6 5-6 5V5z" />
                      </svg>
                    </span>
                    <div>
                      <div className="font-medium">{u.username}</div>
                      {(u.fullName || u.email) && (
                        <div className="text-xs text-zinc-500">
                          {[u.fullName, u.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">
                    {u.role}
                  </span>
                </summary>

                <form
                  action={updateUser}
                  className="mt-3 flex flex-col gap-3 border-t border-black/5 pt-3 dark:border-white/5"
                >
                  <input type="hidden" name="userId" value={u.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium text-zinc-600 dark:text-zinc-400">
                        Role
                      </span>
                      <select
                        name="role"
                        defaultValue={u.role}
                        className="rounded-md border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TextInput
                      name="password"
                      label="Reset password (optional)"
                      type="password"
                    />
                  </div>

                  <StorePicker stores={stores} checkedIds={checkedIds} />
                  <ExportToggle
                    defaultChecked={getPermissions(u).canExport === true}
                    roleNote={u.role === 'admin'}
                  />

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex h-9 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:opacity-90"
                    >
                      Save
                    </button>
                  </div>
                </form>

                <form action={deleteUser} className="mt-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <button
                    type="submit"
                    disabled={isSelf}
                    title={isSelf ? 'You cannot delete your own account' : undefined}
                    className="flex h-9 items-center justify-center rounded-full border border-red-300 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    Delete user
                  </button>
                </form>
              </details>
            );
          })}
        </section>
      </main>
    </>
  );
}

function ExportToggle({
  defaultChecked,
  roleNote,
}: {
  defaultChecked: boolean;
  roleNote?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="canExport" defaultChecked={defaultChecked} />
      <span className="font-medium text-zinc-600 dark:text-zinc-400">
        Can export data
      </span>
      {roleNote && (
        <span className="text-xs text-zinc-400">
          (admins can always export)
        </span>
      )}
    </label>
  );
}

function StorePicker({
  stores,
  checkedIds,
}: {
  stores: Store[];
  checkedIds: Set<string>;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        Store access
      </legend>
      <p className="text-xs text-zinc-400">
        Applies to managers and cashiers. Admins can access all stores.
      </p>
      <div className="flex flex-wrap gap-3">
        {stores.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-2 rounded-md border border-black/10 px-3 py-1.5 text-sm dark:border-white/15"
          >
            <input
              type="checkbox"
              name="storeIds"
              value={s.id}
              defaultChecked={checkedIds.has(s.id)}
            />
            {s.nameEn}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TextInput({
  name,
  label,
  type = 'text',
  required,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete="off"
        className="rounded-md border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
      />
    </label>
  );
}
