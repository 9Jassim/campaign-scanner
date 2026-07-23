import { config } from 'dotenv';
// Local runs read .env.local; on Railway the variables are already injected
// and the file simply doesn't exist.
config({ path: '.env.local' });

/**
 * WhatsApp retry drain — Railway cron entrypoint.
 *
 * Schedule: 0 7 * * * (UTC) = 10:00 Bahrain, ONCE a day. Deliberate: retried
 * confirmations land mid-morning, never at night, and a message is attempted
 * at most once per day (five days, then marked failed). Do not schedule this
 * tighter — a tight retry loop against a throttling API is how you stay
 * throttled, and the owner explicitly chose the daily cadence.
 *
 * No overlap lock is needed at this cadence: a full batch (200 sends paced 1s
 * apart) completes in ~4 minutes against a 24-hour interval.
 *
 * Individual send failures are recorded on their receipts and are not an
 * infra error, so they don't fail the run.
 */
async function main(): Promise<number> {
  console.log(`[${new Date().toISOString()}] message-retry: starting`);

  const { processRetryQueue } = await import('../lib/retry-runner');
  const summary = await processRetryQueue();

  console.log(
    `[message-retry] due=${summary.due} sent=${summary.sent} ` +
      `rateLimited=${summary.rateLimited} failed=${summary.failed} ` +
      `skipped=${summary.skipped} dropped=${summary.dropped}`,
  );
  return 0;
}

main()
  .then(async (code) => {
    const { db } = await import('../lib/db');
    await db.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('[message-retry] run failed:', err);
    try {
      const { db } = await import('../lib/db');
      await db.$disconnect();
    } catch {
      // disconnect is best-effort; the process is exiting either way
    }
    process.exit(1);
  });
