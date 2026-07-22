import { timingSafeEqual } from 'node:crypto';
import { syncAllStores } from '@/lib/sheets-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Three tabs for every store; well past the default 10s.
export const maxDuration = 300;

/**
 * Nightly Google Sheets sync (see vercel.json).
 *
 * Public route — no session — so it authenticates with CRON_SECRET, which
 * Vercel sends as a bearer token. Admins can also run it from /admin/sheets.
 */

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unset = refuse, never run unauthenticated

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    console.error('[sheets-sync] refused: bad or missing CRON_SECRET');
    return new Response('Unauthorized', { status: 401 });
  }

  let results;
  try {
    results = await syncAllStores();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[sheets-sync] could not run: ${error}`);
    return Response.json({ ok: false, error }, { status: 503 });
  }

  // A failover-sheet problem never blocks the mirror write, but it must not
  // pass silently either — a red cron run is how the admin finds out the
  // outage scanner would send stale totals.
  const bad = (s: string) => s === 'failed' || s === 'refused';
  const failed = results.some(
    (r) => bad(r.status) || bad(r.failoverStatus),
  );
  console.log(
    `[sheets-sync] done: ${results
      .map((r) => `${r.store}=${r.status}/failover=${r.failoverStatus}`)
      .join(' ')}`,
  );
  // 500 makes a broken sync show up red in Vercel's cron history rather than
  // looking like a success that quietly wrote nothing.
  return Response.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
}
