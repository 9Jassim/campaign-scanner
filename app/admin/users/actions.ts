'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';

const ROLES = ['admin', 'manager', 'cashier'] as const;
type Role = (typeof ROLES)[number];

function backWithError(msg: string): never {
  redirect(`/admin/users?error=${encodeURIComponent(msg)}`);
}

function normalizeRole(raw: FormDataEntryValue | null): Role {
  return ROLES.includes(raw as Role) ? (raw as Role) : 'cashier';
}

/**
 * Usernames are typed at a till, often on a phone keyboard, so they are stored
 * lowercase and restricted to characters that survive that: no spaces, no
 * accidental capitals, nothing that looks like something else.
 */
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

function normalizeUsername(raw: FormDataEntryValue | null): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim();
}

export async function createUser(formData: FormData) {
  await requireAdmin();

  const username = normalizeUsername(formData.get('username'));
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();
  const fullName = String(formData.get('fullName') ?? '').trim() || null;
  const password = String(formData.get('password') ?? '');
  const role = normalizeRole(formData.get('role'));
  const storeIds = formData.getAll('storeIds').map(String);
  const canExport = formData.get('canExport') === 'on';

  if (!username || !password) {
    backWithError('Username and password are required.');
  }
  if (!USERNAME_PATTERN.test(username)) {
    backWithError(
      'Username must be 3–32 characters, using only lowercase letters, numbers, dot, dash or underscore.',
    );
  }
  if (password.length < 8) {
    backWithError('Password must be at least 8 characters.');
  }
  // Non-admins must be scoped to at least one store.
  if (role !== 'admin' && storeIds.length === 0) {
    backWithError('Select at least one store for a manager or cashier.');
  }

  const existing = await db.userProfile.findUnique({ where: { username } });
  if (existing) {
    backWithError(`The username ${username} is already taken.`);
  }
  if (email && (await db.userProfile.findUnique({ where: { email } }))) {
    backWithError(`A user with email ${email} already exists.`);
  }

  const passwordHash = await hashPassword(password);

  await db.userProfile.create({
    data: {
      username,
      // Optional: staff at a till often have no work address.
      email: email || null,
      fullName,
      role,
      passwordHash,
      permissions: { canExport },
      storeUsers: {
        create: storeIds.map((storeId) => ({ storeId })),
      },
    },
  });

  revalidatePath('/admin/users');
  redirect('/admin/users?created=1');
}

export async function updateUser(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get('userId') ?? '');
  if (!userId) backWithError('Missing user.');

  const role = normalizeRole(formData.get('role'));
  const storeIds = formData.getAll('storeIds').map(String);
  const newPassword = String(formData.get('password') ?? '');
  const canExport = formData.get('canExport') === 'on';

  if (role !== 'admin' && storeIds.length === 0) {
    backWithError('Select at least one store for a manager or cashier.');
  }

  const data: {
    role: Role;
    permissions: { canExport: boolean };
    passwordHash?: string;
  } = { role, permissions: { canExport } };
  if (newPassword) {
    if (newPassword.length < 8) {
      backWithError('Password must be at least 8 characters.');
    }
    data.passwordHash = await hashPassword(newPassword);
  }

  // Replace store assignments atomically.
  await db.$transaction([
    db.userProfile.update({ where: { id: userId }, data }),
    db.storeUser.deleteMany({ where: { userId } }),
    db.storeUser.createMany({
      data: storeIds.map((storeId) => ({ storeId, userId })),
    }),
  ]);

  revalidatePath('/admin/users');
  redirect('/admin/users?updated=1');
}

export async function deleteUser(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');

  if (!userId) backWithError('Missing user.');
  if (userId === admin.id) {
    backWithError('You cannot delete your own account.');
  }

  await db.userProfile.delete({ where: { id: userId } });

  revalidatePath('/admin/users');
  redirect('/admin/users?deleted=1');
}
