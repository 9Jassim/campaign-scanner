import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe base config shared by the middleware and the full Node config.
 * Must NOT import the database, bcrypt, or any Node-only module — the
 * middleware runs on the edge runtime.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
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
        pathname.startsWith('/api/webhook'); // Meta webhook: own token, not auth

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
