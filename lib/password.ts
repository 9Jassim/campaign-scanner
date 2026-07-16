import bcrypt from 'bcryptjs';

/**
 * Password hashing and verification.
 *
 * Kept free of database imports so the constants stay unit-testable.
 */

/** bcrypt cost factor. Every hash in the system is created at this cost. */
export const BCRYPT_COST = 10;

/**
 * A bcrypt hash of a random value that was never recorded, so no input can
 * match it. Compared against when an email is unknown: otherwise an unknown
 * email returns immediately while a real one spends ~70ms hashing, and that
 * gap alone enumerates the staff list.
 *
 * Hard-coded rather than computed at import, because this loads on every server
 * route and hashing on each cold start would tax pages that never sign in.
 * `password.test.ts` guards that its cost still matches BCRYPT_COST.
 */
export const ABSENT_USER_HASH =
  '$2b$10$Dj58TY1fgo4v2wRAJttKBusiDR5qcRlhphSf6wz1AXzs3C8ghQGWa';

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Check a password against a stored hash. Pass `null` for an account that does
 * not exist (or has no password set) — the comparison still runs, against
 * ABSENT_USER_HASH, and returns false in constant-ish time.
 */
export function verifyPassword(
  plaintext: string,
  hash: string | null | undefined,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash ?? ABSENT_USER_HASH);
}
