'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUserProfile, assertStoreAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import type { Prisma } from '@prisma/client';

function field(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export async function saveStoreSettings(formData: FormData) {
  const profile = await getCurrentUserProfile();
  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    throw new Error('Forbidden');
  }

  const storeId = String(formData.get('storeId') ?? '');
  await assertStoreAccess(profile, storeId); // enforces store scoping

  const nameEn = field(formData, 'nameEn');
  const nameAr = field(formData, 'nameAr');
  if (!nameEn || !nameAr) {
    throw new Error('Store name (English and Arabic) is required');
  }

  const bdPerEntry = field(formData, 'bdPerEntry') ?? '10';

  const data: Prisma.StoreUpdateInput = {
    nameEn,
    nameAr,
    campaignNameEn: field(formData, 'campaignNameEn'),
    campaignNameAr: field(formData, 'campaignNameAr'),
    prizeEn: field(formData, 'prizeEn'),
    prizeAr: field(formData, 'prizeAr'),
    bdPerEntry,
    metaPhoneNumberId: field(formData, 'metaPhoneNumberId'),
    metaTemplateName: field(formData, 'metaTemplateName'),
    metaTemplateLang: field(formData, 'metaTemplateLang'),
    googleSheetId: field(formData, 'googleSheetId'),
    failoverSheetId: field(formData, 'failoverSheetId'),
  };

  // Secrets are write-only: only overwrite when a new value is entered, and
  // always store them encrypted.
  const token = field(formData, 'metaAccessToken');
  if (token) {
    data.metaAccessTokenEncrypted = encrypt(token);
  }

  // Per-store app secret: each store is a separate company with its own Meta
  // app, so webhook signatures are verified per-store rather than globally.
  const appSecret = field(formData, 'metaAppSecret');
  if (appSecret) {
    data.metaAppSecretEncrypted = encrypt(appSecret);
  }

  await db.store.update({ where: { id: storeId }, data });

  revalidatePath('/settings');
  redirect(`/settings?storeId=${storeId}&saved=1`);
}
