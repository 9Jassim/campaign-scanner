import { redirect } from 'next/navigation';
import { getCurrentUserProfile, getUserStores } from '@/lib/auth';
import AppNav from '@/components/app-nav';
import ScannerClient, { type ScannerStore } from './scanner-client';

export const dynamic = 'force-dynamic';

export default async function ScannerPage() {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect('/sign-in');

  const stores = await getUserStores(profile);

  const scannerStores: ScannerStore[] = stores.map((s) => ({
    id: s.id,
    nameEn: s.nameEn,
    nameAr: s.nameAr,
    bdPerEntry: Number(s.bdPerEntry),
  }));

  return (
    <>
      <AppNav profile={profile} current="/scanner" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Scanner</h1>

        {scannerStores.length === 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are not assigned to any store yet. Ask an admin to assign you
            before scanning.
          </div>
        ) : (
          <ScannerClient stores={scannerStores} />
        )}
      </div>
    </>
  );
}
