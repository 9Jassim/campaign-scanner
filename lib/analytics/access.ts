import type { UserProfile } from '@prisma/client';
import { getCurrentUserProfile, getUserStores } from '@/lib/auth';
import type { StoreOption } from './types';

/**
 * Who may see analytics, and for which stores.
 *
 * Built on the existing auth layer (`getUserStores` already encodes "admins see
 * every store, managers see their assignments"). Cashiers get nothing — the
 * page turns a null result into a redirect.
 */
export interface AnalyticsAccess {
  profile: UserProfile;
  isAdmin: boolean;
  /** Stores the user may view, for the filter and default scope. */
  stores: StoreOption[];
}

export async function getAnalyticsAccess(): Promise<AnalyticsAccess | null> {
  const profile = await getCurrentUserProfile();
  if (!profile) return null;
  // Cashiers are scanner-only.
  if (profile.role !== 'admin' && profile.role !== 'manager') return null;

  const stores = await getUserStores(profile);
  return {
    profile,
    isAdmin: profile.role === 'admin',
    stores: stores.map((s) => ({ id: s.id, nameEn: s.nameEn })),
  };
}
