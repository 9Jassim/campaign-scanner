/**
 * Download link to the CSV export endpoint, carrying the current filters.
 * Rendered only for users who may export (caller checks `canExport`).
 * A plain anchor (not next/link) so the browser handles the file download.
 */
export default function ExportButton({
  type,
  storeId,
  q,
  status,
}: {
  type: 'contacts' | 'receipts' | 'raffle';
  storeId: string;
  q?: string;
  status?: string;
}) {
  const params = new URLSearchParams({ type, storeId });
  if (q) params.set('q', q);
  if (status) params.set('status', status);

  return (
    <a
      href={`/api/export?${params.toString()}`}
      className="flex h-9 items-center justify-center gap-1.5 rounded-full border border-black/10 px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
    >
      Export CSV
    </a>
  );
}
