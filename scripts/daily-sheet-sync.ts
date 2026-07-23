import { config } from 'dotenv';
// Local runs read .env.local; on Railway the variables are already injected
// and the file simply doesn't exist.
config({ path: '.env.local' });

/**
 * Nightly Google Sheets sync — Railway cron entrypoint.
 *
 * Schedule: 0 21 * * * (UTC) = 00:00 Bahrain. Deliberately about an hour
 * before each sheet's own Apps Script archive (Sunday ~02:00 Bahrain), so the
 * weekly archive always captures a fresh snapshot.
 *
 * One run does BOTH sheets per store, in order: the mirror (Contacts/Log/
 * Raffle) and then the failover sheet's Contacts tab. They are intentionally
 * not separate cron services — the failover push belongs right after the
 * mirror, and it refuses to run while un-imported outage scans sit in the
 * failover sheet.
 *
 * Exits non-zero when any store's write failed or was refused, so the run
 * shows red in Railway's logs instead of looking like a quiet success.
 */
async function main(): Promise<number> {
  console.log(`[${new Date().toISOString()}] sheets-sync: starting`);

  const { syncAllStores } = await import('../lib/sheets-sync');
  const results = await syncAllStores();

  for (const r of results) {
    console.log(
      `[sheets-sync] ${r.store}: mirror ${r.status} (${r.detail}) · ` +
        `failover ${r.failoverStatus} (${r.failoverDetail})`,
    );
  }

  const bad = (s: string) => s === 'failed' || s === 'refused';
  return results.some((r) => bad(r.status) || bad(r.failoverStatus)) ? 1 : 0;
}

main()
  .then(async (code) => {
    const { db } = await import('../lib/db');
    await db.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('[sheets-sync] run failed:', err);
    try {
      const { db } = await import('../lib/db');
      await db.$disconnect();
    } catch {
      // disconnect is best-effort; the process is exiting either way
    }
    process.exit(1);
  });
