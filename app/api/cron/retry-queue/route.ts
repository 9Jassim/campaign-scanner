import { timingSafeEqual } from 'node:crypto';
import { processRetryQueue } from '@/lib/retry-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Up to BATCH_LIMIT sends paced a second apart; well past the default 10s.
export const maxDuration = 300;

/**
 * Daily WhatsApp retry drain (see vercel.json — 07:00 UTC = 10:00 Bahrain, so
 * a day-late confirmation lands mid-morning, not at midnight).
 *
 * Public route — no session — so it authenticates with CRON_SECRET, the same
 * pattern as /api/cron/sheets-sync.
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
    console.error('[retry-queue] refused: bad or missing CRON_SECRET');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const summary = await processRetryQueue();
    // Individual send failures are recorded on their receipts and are not an
    // infra problem — the run itself succeeded, so the cron stays green.
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[retry-queue] could not run: ${error}`);
    return Response.json({ ok: false, error }, { status: 503 });
  }
}
