'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseBarcode } from '@/lib/barcode';

export interface ScannerStore {
  id: string;
  nameEn: string;
  nameAr: string;
  bdPerEntry: number;
}

interface ScanFields {
  invoice: string;
  name: string;
  phone: string;
  amount: string; // kept as string for the input; parsed on submit
}

interface ScanSuccess {
  ok: true;
  entries: number;
  totalEntries: number;
  name: string;
  message: {
    status: 'sent' | 'failed' | 'skipped' | 'pending';
    error?: string;
    queuedForRetry?: boolean;
  };
}
interface ScanFailure {
  ok: false;
  error: string;
}
type ScanOutcome = ScanSuccess | ScanFailure;

const EMPTY: ScanFields = { invoice: '', name: '', phone: '', amount: '' };

export default function ScannerClient({ stores }: { stores: ScannerStore[] }) {
  const [storeId, setStoreId] = useState(stores[0].id);
  const [barcode, setBarcode] = useState('');
  const [fields, setFields] = useState<ScanFields>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const store = useMemo(
    () => stores.find((s) => s.id === storeId)!,
    [stores, storeId],
  );

  const amountNum = parseFloat(fields.amount.replace(',', '.'));
  const entries =
    Number.isFinite(amountNum) && amountNum > 0
      ? Math.floor(amountNum / store.bdPerEntry)
      : 0;

  // Keep focus on the barcode input, ready for the next scan.
  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  function applyBarcode(raw: string) {
    const parsed = parseBarcode(raw);
    if (parsed) {
      setFields({
        invoice: parsed.invoice,
        name: parsed.name,
        phone: parsed.phone,
        amount: String(parsed.amount),
      });
      setOutcome(null);
    }
  }

  function handleBarcodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Most scanners emit the text followed by Enter.
    if (e.key === 'Enter') {
      e.preventDefault();
      applyBarcode(barcode);
    }
  }

  function resetForNext() {
    setBarcode('');
    setFields(EMPTY);
    barcodeRef.current?.focus();
  }

  async function handleConfirm() {
    setSubmitting(true);
    setOutcome(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          invoiceId: fields.invoice,
          name: fields.name,
          phone: fields.phone,
          amount: Number.isFinite(amountNum) ? amountNum : 0,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setOutcome({
          ok: true,
          entries: data.entries,
          totalEntries: data.totalEntries,
          name: data.contact?.name ?? fields.name,
          message: data.message ?? { status: 'skipped' },
        });
        setBarcode('');
        setFields(EMPTY);
        barcodeRef.current?.focus();
      } else {
        setOutcome({ ok: false, error: data.error ?? 'Scan failed' });
      }
    } catch {
      setOutcome({ ok: false, error: 'Network error — please try again' });
    } finally {
      setSubmitting(false);
    }
  }

  const canConfirm =
    !!fields.invoice && !!fields.name && !!fields.phone && entries >= 1;

  return (
    <div className="flex flex-col gap-5">
      {stores.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-600 dark:text-zinc-400">
            Store
          </span>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="rounded-md border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn} — {s.nameAr}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">
          Scan or paste barcode
        </span>
        <input
          ref={barcodeRef}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={handleBarcodeKeyDown}
          placeholder="SI-100008 | HASSAN MAHMOOD | +97333959565 | 45,500"
          autoComplete="off"
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 font-mono text-sm dark:border-white/15"
        />
        <span className="text-xs text-zinc-400">
          Press Enter to parse. Fields below are editable before you confirm.
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Invoice ID"
          value={fields.invoice}
          onChange={(v) => setFields((f) => ({ ...f, invoice: v }))}
        />
        <Field
          label="Customer name"
          value={fields.name}
          onChange={(v) => setFields((f) => ({ ...f, name: v }))}
        />
        <Field
          label="Phone"
          value={fields.phone}
          onChange={(v) => setFields((f) => ({ ...f, phone: v }))}
        />
        <Field
          label="Amount (BD)"
          value={fields.amount}
          onChange={(v) => setFields((f) => ({ ...f, amount: v }))}
          inputMode="decimal"
        />
      </div>

      <div className="flex items-center justify-between rounded-md bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
        <span className="text-zinc-600 dark:text-zinc-400">
          Entries this receipt
        </span>
        <span className="text-lg font-semibold tabular-nums">{entries}</span>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleConfirm}
          disabled={!canConfirm || submitting}
          className="flex h-11 flex-1 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Logging…' : 'Confirm and log'}
        </button>
        <button
          onClick={resetForNext}
          disabled={submitting}
          className="flex h-11 items-center justify-center rounded-full border border-black/10 px-5 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/[.06]"
        >
          Clear
        </button>
      </div>

      {outcome && (
        <div
          role="status"
          className={
            outcome.ok
              ? 'rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200'
              : 'rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
          }
        >
          {outcome.ok ? (
            <>
              <div>
                Logged <strong>{outcome.entries}</strong>{' '}
                {outcome.entries === 1 ? 'entry' : 'entries'} for{' '}
                <strong>{outcome.name}</strong>. Total entries now{' '}
                <strong>{outcome.totalEntries}</strong>.
              </div>
              <WhatsAppNote message={outcome.message} />
            </>
          ) : (
            outcome.error
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The scan is already saved at this point — this only reports what happened to
 * the WhatsApp confirmation, so a failure here is a warning, not an error.
 */
function WhatsAppNote({ message }: { message: ScanSuccess['message'] }) {
  if (message.status === 'sent') {
    return <div className="mt-1 text-xs opacity-80">WhatsApp confirmation sent.</div>;
  }
  if (message.status === 'skipped') {
    return (
      <div className="mt-1 text-xs opacity-80">
        WhatsApp not configured for this store — nothing sent.
      </div>
    );
  }
  if (message.status === 'pending') {
    return (
      <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
        WhatsApp rate-limited — queued for retry.
        {message.error ? ` (${message.error})` : ''}
      </div>
    );
  }
  return (
    <div className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">
      WhatsApp failed{message.error ? `: ${message.error}` : ''}. The scan was
      still saved.
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'decimal';
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="rounded-md border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
      />
    </label>
  );
}
