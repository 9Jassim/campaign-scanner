import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

// The middleware uses only the edge-safe config (no DB, no bcrypt). Route
// protection is handled by the `authorized` callback in auth.config.ts.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Skip NextAuth's own routes, Next.js internals, and static files.
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$).*)',
  ],
};
