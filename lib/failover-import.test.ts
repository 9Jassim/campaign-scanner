import { describe, it, expect } from 'vitest';
import {
  FAILOVER_LOG_HEADER,
  parseFailoverLog,
  parseLogRow,
  validateHeader,
} from './failover-import';

const BD_PER_ENTRY = 10;

/** A well-formed Log row: [timestamp, invoice, name, phone, amount, ...]. */
function row(
  invoice: string,
  name: string,
  phone: string,
  amount: string,
  extra: string[] = [],
): string[] {
  return ['2026-07-22 13:00', invoice, name, phone, amount, ...extra];
}

describe('validateHeader', () => {
  it('accepts the canonical failover Log header', () => {
    expect(validateHeader(FAILOVER_LOG_HEADER).ok).toBe(true);
  });

  it('accepts a header with different casing and extra trailing columns', () => {
    const header = [
      'TIMESTAMP',
      'invoice id',
      ' Name ',
      'Phone Number',
      'Amount (BD)',
      'Something Extra',
    ];
    expect(validateHeader(header).ok).toBe(true);
  });

  it('rejects a header whose leading columns are wrong', () => {
    const result = validateHeader(['A', 'B', 'C', 'D', 'E']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unexpected column layout');
  });
});

describe('parseLogRow', () => {
  it('parses a valid row and computes entries from the amount', () => {
    const result = parseLogRow(
      row('SI-100', 'Hassan', '+97337110807', '45,500'),
      2,
      BD_PER_ENTRY,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed).toMatchObject({
        row: 2,
        invoiceId: 'SI-100',
        name: 'Hassan',
        phone: '+97337110807',
        amount: 45.5,
        entries: 4, // floor(45.5 / 10)
        wamid: null,
        note: null,
      });
    }
  });

  it('recomputes entries rather than trusting the sheet column', () => {
    // Sheet claims 999 entries; the portal ignores it and uses amount/bdPerEntry.
    const result = parseLogRow(
      row('SI-101', 'Ali', '37110807', '100', ['999', '999', 'yes', '', '']),
      3,
      BD_PER_ENTRY,
    );
    expect(result.ok && result.parsed.entries).toBe(10);
  });

  it('normalizes a local Bahraini phone number', () => {
    const result = parseLogRow(
      row('SI-102', 'Sara', '37110807', '20'),
      4,
      BD_PER_ENTRY,
    );
    expect(result.ok && result.parsed.phone).toBe('+97337110807');
  });

  it('keeps a wamid from the message column but drops an error', () => {
    const withId = parseLogRow(
      row('SI-1', 'A', '37110807', '20', ['2', '2', 'yes', 'wamid.HBgABC', '']),
      2,
      BD_PER_ENTRY,
    );
    expect(withId.ok && withId.parsed.wamid).toBe('wamid.HBgABC');

    const withError = parseLogRow(
      row('SI-2', 'B', '37110807', '20', ['2', '2', 'no', 'Rate limited', '']),
      3,
      BD_PER_ENTRY,
    );
    expect(withError.ok && withError.parsed.wamid).toBe(null);
  });

  it('captures the cashier note', () => {
    const result = parseLogRow(
      row('SI-3', 'C', '37110807', '20', ['2', '2', 'yes', 'wamid.X', 'ret']),
      2,
      BD_PER_ENTRY,
    );
    expect(result.ok && result.parsed.note).toBe('ret');
  });

  it('flags a missing invoice ID', () => {
    const result = parseLogRow(
      row('', 'Ali', '37110807', '20'),
      2,
      BD_PER_ENTRY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toMatch(/invoice/i);
  });

  it('flags a missing name', () => {
    const result = parseLogRow(
      row('SI-4', '', '37110807', '20'),
      2,
      BD_PER_ENTRY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toMatch(/name/i);
  });

  it('flags an unusable phone number', () => {
    const result = parseLogRow(row('SI-5', 'Ali', 'abc', '20'), 2, BD_PER_ENTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toMatch(/phone/i);
  });

  it('flags a non-numeric amount', () => {
    const result = parseLogRow(
      row('SI-6', 'Ali', '37110807', 'lots'),
      2,
      BD_PER_ENTRY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toMatch(/amount/i);
  });

  it('flags an amount below the minimum for one entry', () => {
    const result = parseLogRow(
      row('SI-7', 'Ali', '37110807', '5'),
      2,
      BD_PER_ENTRY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toMatch(/no entries/i);
    // The invoice id is still carried on the error so the admin can find it.
    if (!result.ok) expect(result.error.invoiceId).toBe('SI-7');
  });

  it('tolerates short rows (Sheets drops trailing empty cells)', () => {
    const result = parseLogRow(
      ['2026-07-22', 'SI-8', 'Ali', '37110807', '20'], // no columns past amount
      2,
      BD_PER_ENTRY,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.wamid).toBe(null);
      expect(result.parsed.note).toBe(null);
    }
  });
});

describe('parseFailoverLog', () => {
  const header = FAILOVER_LOG_HEADER;

  it('reports an empty grid', () => {
    expect(parseFailoverLog([], BD_PER_ENTRY).headerError).toMatch(/empty/i);
  });

  it('reports a bad header and parses no rows', () => {
    const grid = [['x', 'y', 'z'], row('SI-1', 'A', '37110807', '20')];
    const result = parseFailoverLog(grid, BD_PER_ENTRY);
    expect(result.headerError).toMatch(/unexpected/i);
    expect(result.rows).toHaveLength(0);
  });

  it('parses data rows and numbers them from the sheet (header is row 1)', () => {
    const grid = [
      header,
      row('SI-1', 'A', '37110807', '20'),
      row('SI-2', 'B', '37110807', '30'),
    ];
    const result = parseFailoverLog(grid, BD_PER_ENTRY);
    expect(result.headerError).toBe(null);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].ok && result.rows[0].parsed.row).toBe(2);
    expect(result.rows[1].ok && result.rows[1].parsed.row).toBe(3);
  });

  it('skips blank spacer rows without reporting them as errors', () => {
    const grid = [
      header,
      row('SI-1', 'A', '37110807', '20'),
      ['', '', '', '', ''],
      [],
      row('SI-2', 'B', '37110807', '30'),
    ];
    const result = parseFailoverLog(grid, BD_PER_ENTRY);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.ok)).toBe(true);
  });

  it('mixes valid and invalid rows, preserving row numbers', () => {
    const grid = [
      header,
      row('SI-1', 'A', '37110807', '20'), // row 2 ok
      row('', 'B', '37110807', '30'), // row 3 error
      row('SI-3', 'C', '37110807', '5'), // row 4 below minimum
    ];
    const result = parseFailoverLog(grid, BD_PER_ENTRY);
    expect(result.rows[0].ok).toBe(true);
    expect(result.rows[1].ok).toBe(false);
    if (!result.rows[1].ok) expect(result.rows[1].error.row).toBe(3);
    expect(result.rows[2].ok).toBe(false);
    if (!result.rows[2].ok) expect(result.rows[2].error.row).toBe(4);
  });
});
