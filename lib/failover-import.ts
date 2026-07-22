import { LOG_HEADER } from './backup';
import { normalizePhone, parseAmount } from './barcode';

/**
 * Pure parsing for the failover-sheet import.
 *
 * Every store has a standalone Google Sheets + Apps Script scanner kept for
 * outages: if the portal is unreachable, cashiers scan there instead and the
 * script sends WhatsApp itself. When the portal recovers an admin pulls those
 * scans back in so the database — the source of truth — stays complete.
 *
 * The failover sheet's Log tab has the same columns the portal's mirror writes
 * (see LOG_HEADER in `lib/backup.ts`), so that constant is the canonical shape
 * here. This module is pure and unit-tested; the database + Sheets side lives in
 * `lib/failover-sync.ts`, mirroring the backup.ts / sheets-sync.ts split.
 */

/** The tab the failover scanner logs each scan to. */
export const FAILOVER_LOG_TAB = 'Log';

/** Expected Log-tab header, shared with the portal's own mirror. */
export const FAILOVER_LOG_HEADER = LOG_HEADER;

/** Column positions within a Log row. */
const COL = {
  timestamp: 0,
  invoiceId: 1,
  name: 2,
  phone: 3,
  amount: 4,
  entries: 5,
  totalEntries: 6,
  messageSent: 7,
  messageIdOrError: 8,
  cashierNote: 9,
} as const;

/** How many leading columns must match for the layout to be accepted. */
const REQUIRED_COLS = 5;

export interface ParsedRow {
  /** 1-based sheet row (header is row 1), for pointing the admin at a problem. */
  row: number;
  invoiceId: string;
  name: string;
  phone: string;
  amount: number;
  /** Recomputed from amount here — the portal, not the sheet, owns entry counts. */
  entries: number;
  /** The Meta message id if the sheet holds one; an error string is dropped. */
  wamid: string | null;
  note: string | null;
}

export interface RowError {
  row: number;
  invoiceId: string;
  error: string;
}

export type RowParse =
  | { ok: true; parsed: ParsedRow }
  | { ok: false; error: RowError };

export interface ParsedLog {
  /** Set when the header is wrong; when set, `rows` is empty. */
  headerError: string | null;
  /** One entry per non-blank data row, in sheet order. */
  rows: RowParse[];
}

/**
 * Whether the header row looks like a failover Log tab.
 *
 * Only the leading columns that the import actually reads are checked, so a
 * sheet that adds trailing columns still imports. Comparison is trimmed and
 * case-insensitive because the sheet is maintained by hand.
 */
export function validateHeader(
  header: string[],
): { ok: true } | { ok: false; error: string } {
  const norm = (s: string) => (s ?? '').trim().toLowerCase();
  const expected = FAILOVER_LOG_HEADER.slice(0, REQUIRED_COLS).map(norm);
  const got = header.slice(0, REQUIRED_COLS).map(norm);
  const matches = expected.every((h, i) => got[i] === h);
  if (matches) return { ok: true };
  return {
    ok: false,
    error:
      `Unexpected column layout. The Log tab should start with: ` +
      `${FAILOVER_LOG_HEADER.slice(0, REQUIRED_COLS).join(' | ')}. ` +
      `Found: ${header.join(' | ') || '(empty)'}`,
  };
}

/**
 * Parse one Log data row. `bdPerEntry` comes from the store, so entries are
 * recomputed the same way a live scan would — the sheet's own entry column is
 * informational and ignored.
 */
export function parseLogRow(
  cells: string[],
  rowNumber: number,
  bdPerEntry: number,
): RowParse {
  const get = (i: number) => (cells[i] ?? '').trim();
  const invoiceId = get(COL.invoiceId);
  const name = get(COL.name);
  const rawPhone = get(COL.phone);
  const rawAmount = get(COL.amount);

  const fail = (error: string): RowParse => ({
    ok: false,
    error: { row: rowNumber, invoiceId, error },
  });

  if (!invoiceId) return fail('Missing invoice ID');
  if (!name) return fail('Missing customer name');

  const phone = normalizePhone(rawPhone);
  // normalizePhone always yields "+<digits>"; a real number has several digits.
  if (!/^\+\d{6,}$/.test(phone)) {
    return fail(`Invalid phone number: "${rawPhone}"`);
  }

  const amount = parseAmount(rawAmount);
  if (!(amount > 0)) return fail(`Invalid amount: "${rawAmount}"`);

  const entries = Math.floor(amount / bdPerEntry);
  if (entries < 1) {
    return fail(
      `Amount ${amount} BD earns no entries (minimum ${bdPerEntry} BD)`,
    );
  }

  // The "Message ID / Error" column holds a wamid when the send worked and an
  // error otherwise; keep it only when it looks like a Meta id.
  const idOrError = get(COL.messageIdOrError);
  const wamid = idOrError.startsWith('wamid.') ? idOrError : null;
  const note = get(COL.cashierNote) || null;

  return {
    ok: true,
    parsed: { row: rowNumber, invoiceId, name, phone, amount, entries, wamid, note },
  };
}

/**
 * Parse a whole Log grid (as returned by the Sheets API — header first, trailing
 * empty cells dropped). Blank spacer rows are skipped, not reported as errors.
 */
export function parseFailoverLog(
  grid: string[][],
  bdPerEntry: number,
): ParsedLog {
  if (grid.length === 0) {
    return { headerError: 'The Log tab is empty.', rows: [] };
  }

  const header = validateHeader(grid[0]);
  if (!header.ok) return { headerError: header.error, rows: [] };

  const rows: RowParse[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.every((c) => (c ?? '').trim() === '')) continue; // blank row
    rows.push(parseLogRow(cells, i + 1, bdPerEntry));
  }
  return { headerError: null, rows };
}
