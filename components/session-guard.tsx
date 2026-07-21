'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { signInErrorMessage } from '@/lib/login-throttle';
import { SESSION_EXPIRED_EVENT } from '@/lib/session-expiry';

/** How often to check the session while the page sits open. */
const POLL_MS = 60_000;

/**
 * Watches for the session ending and asks the user to sign in again, over the
 * page rather than instead of it.
 *
 * Two ways in: a background check that notices a lapsed session while the page
 * is idle, and `notifySessionExpired()`, which the scanner raises the moment an
 * API call comes back unauthorised. The second is the one that saves a
 * half-typed scan.
 *
 * Nothing here unmounts the page underneath, so whatever the cashier had
 * filled in is still there — they sign in and press Confirm again.
 */
export default function SessionGuard({ username }: { username: string }) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Ask the server whether we are still signed in. Cheap, and the only
  // authority on it — the client cannot read the httpOnly session cookie.
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      const session = await res.json();
      if (!session?.user) setExpired(true);
    } catch {
      // Offline or the server is down: not the same as being signed out, and
      // a shop's wifi drops. Stay quiet rather than demand a password.
    }
  }, []);

  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    const interval = setInterval(() => {
      if (!document.hidden) void checkSession();
    }, POLL_MS);

    // Coming back to the tab is the likeliest moment for the session to have
    // lapsed — a till ignored over a quiet hour is exactly the 2h idle case.
    const onVisible = () => {
      if (!document.hidden) void checkSession();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [checkSession]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await signIn('credentials', {
      username,
      password,
      redirect: false,
    });

    setSubmitting(false);

    if (res?.error) {
      setError(signInErrorMessage(res.code));
      return;
    }

    setPassword('');
    setExpired(false);
    // Refresh server components so anything rendered against the old session
    // is rebuilt — without touching client state on the page.
    router.refresh();
  }

  if (!expired) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-lg border border-black/10 bg-background p-6 shadow-xl dark:border-white/15">
        <h2
          id="session-expired-title"
          className="text-lg font-semibold tracking-tight"
        >
          Signed out
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Your session ended after a period of inactivity. Sign in to carry on —
          anything you have already entered is still on the page.
        </p>

        <form onSubmit={handleSignIn} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">
              Username
            </span>
            <input
              type="text"
              value={username}
              readOnly
              className="rounded-md border border-black/10 bg-black/[.03] px-3 py-2 text-zinc-500 dark:border-white/15 dark:bg-white/[.04]"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              autoComplete="current-password"
              className="rounded-md border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? 'Signing in…' : 'Sign in and continue'}
          </button>
        </form>

        {/* Escape hatch: a different person may be taking over the till. This
            does lose the page's contents, so it is worded plainly. */}
        <a
          href="/sign-in"
          className="mt-3 block text-center text-xs text-zinc-500 underline underline-offset-2 hover:no-underline"
        >
          Sign in as someone else (clears this page)
        </a>
      </div>
    </div>
  );
}
