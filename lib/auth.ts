import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from './db';
import type { Store, UserProfile } from '@prisma/client';

export type Role = 'admin' | 'manager' | 'cashier';

/** Per-user permission overrides stored in `user_profiles.permissions` (jsonb). */
export interface UserPermissions {
  canExport?: boolean;
}

export function getPermissions(profile: UserProfile): UserPermissions {
  return (profile.permissions as UserPermissions | null) ?? {};
}

/**
 * Whether the user may export data. Admins have full control and can always
 * export; other roles need an explicit `canExport` grant.
 */
export function canExport(profile: UserProfile): boolean {
  if (profile.role === 'admin') return true;
  return getPermissions(profile).canExport === true;
}

/**
 * Load the `user_profiles` row for the currently authenticated user.
 * Returns null if there is no authenticated user (or the profile was deleted).
 *
 * Accounts are created by an admin (with a password), so there is no
 * just-in-time profile creation here — see the seed script / admin UI.
 */
export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  return db.userProfile.findUnique({ where: { id: userId } });
}

/**
 * Stores the given user may access.
 * - Admins can access every store.
 * - Managers/cashiers can access only stores assigned via `store_users`.
 */
export async function getUserStores(profile: UserProfile): Promise<Store[]> {
  if (profile.role === 'admin') {
    return db.store.findMany({ orderBy: { nameEn: 'asc' } });
  }

  const assignments = await db.storeUser.findMany({
    where: { userId: profile.id },
    include: { store: true },
  });
  return assignments
    .map((a) => a.store)
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}

/**
 * Resolve a single active store for the user, validating that they may access
 * it. If `preferredStoreId` is given it must be one of the user's stores;
 * otherwise the first accessible store is returned. Null if the user has no
 * accessible store (or the requested one isn't allowed).
 */
export async function getUserActiveStore(
  profile: UserProfile,
  preferredStoreId?: string,
): Promise<Store | null> {
  const stores = await getUserStores(profile);
  if (stores.length === 0) return null;

  if (preferredStoreId) {
    return stores.find((s) => s.id === preferredStoreId) ?? null;
  }
  return stores[0];
}

/**
 * Assert the user may access `storeId`. Throws if not — use in write paths.
 */
export async function assertStoreAccess(
  profile: UserProfile,
  storeId: string,
): Promise<Store> {
  const store = await getUserActiveStore(profile, storeId);
  if (!store) {
    throw new Error('You do not have access to this store');
  }
  return store;
}

/**
 * Page guard for the management portal (contacts/receipts/raffle/messages).
 * Redirects unauthenticated users to sign-in and cashiers to the scanner
 * (cashiers are scanner-only). Returns the profile for allowed users.
 */
export async function requireManager(): Promise<UserProfile> {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect('/sign-in');
  if (profile.role !== 'admin' && profile.role !== 'manager') {
    redirect('/scanner');
  }
  return profile;
}

/**
 * Page guard for admin-only pages. Redirects non-admins away.
 */
export async function requireAdmin(): Promise<UserProfile> {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect('/sign-in');
  if (profile.role !== 'admin') redirect('/scanner');
  return profile;
}

/**
 * Resolve a single active store for a list page. List pages always show one
 * store at a time (never a combined view), defaulting to the first accessible
 * store. Returns the accessible stores and the resolved active store (null when
 * the user has no accessible stores).
 */
export async function resolveActiveStore(
  profile: UserProfile,
  requestedStoreId?: string,
): Promise<{ stores: Store[]; store: Store | null }> {
  const stores = await getUserStores(profile);
  if (stores.length === 0) return { stores, store: null };
  const store =
    (requestedStoreId && stores.find((s) => s.id === requestedStoreId)) ||
    stores[0];
  return { stores, store };
}
