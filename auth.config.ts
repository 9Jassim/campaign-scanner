import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe base config shared by the middleware and the full Node config.
 * Must NOT import the database, bcrypt, or any Node-only module — the
 * middleware runs on the edge runtime.
 */
/** Idle timeout. A till left unattended stops being signed in. */
const SESSION_MAX_AGE_SECONDS = 2 * 60 * 60;

export const authConfig = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    // Sliding, not absolute: the clock restarts on every request, so someone
    // scanning all shift is never logged out mid-queue, while a till idle for
    // two hours is.
    maxAge: SESSION_MAX_AGE_SECONDS,
    // How often an active session is rewritten to push its expiry out. Without
    // this the token is only refreshed once a day and the sliding window would
    // not actually slide.
    updateAge: 5 * 60,
  },
  pages: {
    signIn: '/sign-in',
  },
  providers: [], // real providers are added in auth.ts (Node runtime)
  callbacks: {
    // Route protection for the middleware. Return true to allow, false to
    // redirect to the sign-in page.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      const isPublic =
        pathname === '/' ||
        pathname.startsWith('/sign-in') ||
        pathname.startsWith('/api/webhook') || // Meta webhook: own token, not auth
        pathname.startsWith('/api/cron'); // Vercel Cron: CRON_SECRET, not a session

      if (isPublic) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
