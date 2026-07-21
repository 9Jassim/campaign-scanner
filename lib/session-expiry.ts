/**
 * Signalling for "your session has ended, sign in again".
 *
 * Sessions are short and sliding (2h idle), so a till left alone over a quiet
 * spell will lapse. The cost of handling that badly is high: a cashier can scan
 * a code, correct a name, and only discover the problem when they press
 * Confirm — at which point navigating them to the sign-in page throws the work
 * away and the customer is standing there.
 *
 * So expiry raises a signal instead, and `SessionGuard` puts a sign-in dialog
 * over the page. Nothing is unmounted, so every field they filled is still
 * there when they get back.
 *
 * A DOM event rather than a context: the scanner needs to raise this from
 * inside a fetch handler, and a plain event avoids threading a callback
 * through every component that talks to the API.
 */

export const SESSION_EXPIRED_EVENT = 'campaign-scanner:session-expired';

/** Raise the "signed out" signal. Safe to call more than once. */
export function notifySessionExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/**
 * Whether a response means the session has gone.
 *
 * API routes answer 401 for themselves. A 307 to the sign-in page would mean
 * the middleware intercepted the call — it is not supposed to for `/api/`
 * routes any more, but a redirected response is unambiguous evidence of a lost
 * session, so treat it as one rather than report a network error.
 */
export function isSignedOutResponse(res: Response): boolean {
  return res.status === 401 || (res.redirected && res.url.includes('/sign-in'));
}
