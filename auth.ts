import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { clientIp, lockoutCode, throttleKeys } from '@/lib/login-throttle';
import {
  clearFailures,
  recordFailure,
  retryAfterSeconds,
} from '@/lib/login-attempts';

/**
 * Thrown when the email or IP is locked out. NextAuth puts `code` on the
 * client's `signIn()` result, where the sign-in form turns it into a message.
 */
class TooManyAttemptsError extends CredentialsSignin {
  code: string;
  constructor(retryAfterSec: number) {
    super();
    this.code = lockoutCode(retryAfterSec);
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const email = String(credentials?.email ?? '')
          .toLowerCase()
          .trim();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        const keys = throttleKeys(email, clientIp(request));

        const retryAfter = await retryAfterSeconds(keys);
        if (retryAfter > 0) {
          throw new TooManyAttemptsError(retryAfter);
        }

        const user = await db.userProfile.findUnique({ where: { email } });

        // Runs a real comparison even when there is no such user, so the
        // response time cannot be used to tell which emails exist.
        const valid = await verifyPassword(password, user?.passwordHash);

        if (!user?.passwordHash || !valid) {
          await recordFailure(keys);
          // Otherwise nothing anywhere records that guessing is happening.
          console.warn(`[auth] failed sign-in for ${email}`);
          return null;
        }

        await clearFailures(keys);

        return {
          id: user.id,
          email: user.email,
          name: user.fullName ?? undefined,
          role: user.role,
        };
      },
    }),
  ],
});
