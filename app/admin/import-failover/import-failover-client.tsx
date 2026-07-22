'use client';

import { useMemo, useState } from 'react';
import type { ImportReport, PreviewReport, RowStatus } from '@/lib/failover-sync';

// `import type` is erased at build, so this client bundle never pulls in the db
// or Sheets code those types live beside.

interface StoreOption {
  id: string;
  nameEn: string;
  failoverSheetId: string | null;
}

const STATUS_STYLES: Record<RowStatus, string> = {
  new: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  duplicate:
    'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
};

export default function ImportFailoverClient({
  stores,
  disabled,
}: {
  stores: StoreOption[];
  disabled: boolean;
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [sheetId, setSheetId] = useState(stores[0]?.failoverSheetId ?? '');
  const [busy, setBusy] = useState<null | 'preview' | 'confirm'>(null);
  const [preview, setPreview] = useState<PreviewReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedStore = stores.find((s) => s.id === storeId);
  const canConfirm =
    !!preview && preview.newCount > 0 && busy === null && !result;

  function onStoreChange(id: string) {
    setStoreId(id);
    setSheetId(stores.find((s) => s.id === id)?.failoverSheetId ?? '');
    // A new store invalidates whatever was previewed against the old one.
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function call(mode: 'preview' | 'confirm') {
    setBusy(mode);
    setError(null);
    if (mode === 'preview') setResult(null);
    try {
      const res = await fetch('/api/admin/import-failover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, sheetId, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (mode === 'preview') {
        setPreview(data as PreviewReport);
      } else {
        setResult(data as ImportReport);
        setPreview(null); // the preview is now stale — the rows have been imported
      }
    } catch {
      setError('Could not reach the server. Check your connection and retry.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Store</span>
          <select
            value={storeId}
            onChange={(e) => onStoreChange(e.target.value)}
            disabled={disabled || busy !== null}
            className="h-10 rounded-lg border border-black/10 bg-background px-3 text-sm dark:border-white/15"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Failover Sheet ID</span>
          <input
            value={sheetId}
            onChange={(e) => {
              setSheetId(e.target.value);
              setPreview(null);
              setResult(null);
            }}
            disabled={disabled || busy !== null}
            placeholder="From the sheet's URL: /spreadsheets/d/<ID>/edit"
            className="h-10 rounded-lg border border-black/10 bg-background px-3 font-mono text-sm dark:border-white/15"
          />
          {selectedStore && !selectedStore.failoverSheetId && (
            <span className="text-xs text-zinc-500">
              No failover sheet is saved for this store — paste the ID above.
            </span>
          )}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => call('preview')}
          disabled={disabled || busy !== null || !storeId || !sheetId.trim()}
          className="flex h-10 items-center justify-center rounded-full border border-black/10 px-5 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/[.06]"
        >
          {busy === 'preview' ? 'Reading sheet…' : 'Preview import'}
        </button>
        <button
          type="button"
          onClick={() => call('confirm')}
          disabled={!canConfirm}
          className="flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
        >
          {busy === 'confirm'
            ? 'Importing…'
            : preview
              ? `Confirm import (${preview.newCount})`
              : 'Confirm import'}
        </button>
        {preview && preview.newCount === 0 && !result && (
          <span className="text-xs text-zinc-500">
            Nothing new to import.
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {result && <ResultPanel result={result} />}
      {preview && !result && <PreviewPanel preview={preview} />}
    </div>
  );
}

function Counts({
  items,
}: {
  items: { label: string; value: number; tone: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {items.map((i) => (
        <span
          key={i.label}
          className={`rounded-full px-3 py-1 font-medium ${i.tone}`}
        >
          {i.value} {i.label}
        </span>
      ))}
    </div>
  );
}

function PreviewPanel({ preview }: { preview: PreviewReport }) {
  return (
    <div className="flex flex-col gap-3">
      <Counts
        items={[
          { label: 'new', value: preview.newCount, tone: STATUS_STYLES.new },
          {
            label: 'duplicate',
            value: preview.duplicateCount,
            tone: STATUS_STYLES.duplicate,
          },
          {
            label: 'error',
            value: preview.errorCount,
            tone: STATUS_STYLES.error,
          },
        ]}
      />
      <p className="text-xs text-zinc-500">
        Preview only — nothing has been written yet.
      </p>
      <RowsTable rows={preview.rows} />
    </div>
  );
}

function RowsTable({
  rows,
}: {
  rows: PreviewReport['rows'];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-black/10 px-3 py-6 text-center text-sm text-zinc-500 dark:border-white/10">
        The Log tab has no data rows.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-black/10 text-xs text-zinc-500 dark:border-white/10">
          <tr>
            <th className="px-3 py-2 font-medium">Invoice</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Phone</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-right font-medium">Entries</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.row}-${r.invoiceId}`}
              className="border-b border-black/5 last:border-b-0 dark:border-white/5"
            >
              <td className="px-3 py-2 font-mono text-xs">
                {r.invoiceId || <span className="text-zinc-400">—</span>}
              </td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.phone}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.amount == null ? '' : r.amount.toFixed(3)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.entries ?? ''}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}
                >
                  {r.status}
                </span>
                {r.error && (
                  <span className="ml-2 text-xs text-red-700 dark:text-red-300">
                    {r.error}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultPanel({ result }: { result: ImportReport }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
        <p className="text-sm font-medium text-green-800 dark:text-green-200">
          Import finished — {result.imported} imported,{' '}
          {result.skippedAsDuplicates} skipped as duplicates
          {result.errors.length > 0 && `, ${result.errors.length} error(s)`}.
        </p>
      </div>

      {result.errors.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-red-200 dark:border-red-900/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-red-200 text-xs text-zinc-500 dark:border-red-900/60">
              <tr>
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {result.errors.map((e) => (
                <tr
                  key={`${e.row}-${e.invoiceId}`}
                  className="border-b border-red-100 last:border-b-0 dark:border-red-900/40"
                >
                  <td className="px-3 py-2 tabular-nums">{e.row}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {e.invoiceId || '—'}
                  </td>
                  <td className="px-3 py-2 text-red-700 dark:text-red-300">
                    {e.error}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-medium">Now reset the failover sheet</p>
        <p className="mt-1 text-amber-800 dark:text-amber-200">
          Once you&apos;ve checked the import above looks right, open the failover
          sheet and delete all rows below the headers in the{' '}
          <strong>Log</strong>, <strong>Contacts</strong> and{' '}
          <strong>Raffle</strong> tabs. It&apos;s then ready for the next outage.
          The portal never clears it for you — that&apos;s deliberate, so nothing
          is lost before you&apos;ve verified.
        </p>
      </div>
    </div>
  );
}
