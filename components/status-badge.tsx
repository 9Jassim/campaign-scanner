const STATUS_STYLES: Record<string, string> = {
  delivered:
    'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  read: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  sent: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  pending:
    'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  skipped: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

const FALLBACK = 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';

/**
 * WhatsApp message status pill. Hover shows the underlying Meta error, which
 * is where the real reason for a failure lives (e.g. 131049).
 */
export default function StatusBadge({
  status,
  error,
}: {
  status: string | null;
  error?: string | null;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status ?? ''] ?? FALLBACK
      }`}
      title={error ?? undefined}
    >
      {status ?? '—'}
    </span>
  );
}
