import type { Prisma } from '@prisma/client';
import { formatDateTimeCsv } from './datetime';

/**
 * Weekly backup snapshot for a store's Google Sheet.
 *
 * The sheet is a backup, not a live mirror: the portal writes a full snapshot
 * once a week and the sheet's own Apps Script archives it on its own schedule.
 * There is deliberately no per-scan dual-write — it would put a Google outage
 * next to the till, and the "upsert a contact into a spreadsheet" problem goes
 * away entirely once each sync simply replaces the tab.
 *
 * Row building lives here, apart from the API calls, so the exact columns are
 * unit-testable.
 */

/** Tab names and column headers, matching the sheets that already exist. */
export const CONTACTS_TAB = 'Contacts';
export const LOG_TAB = 'Log';
export const RAFFLE_TAB = 'Raffle';

export const CONTACTS_HEADER = [
  'Name',
  'Phone Number',
  'Total BD Spent',
  'Total Entries',
  'Last Seen',
  'Invoice Count',
  'Invoice IDs',
];

export const LOG_HEADER = [
  'Timestamp',
  'Invoice ID',
  'Name',
  'Phone Number',
  'Amount (BD)',
  'Entries This Receipt',
  'Total Entries',
  'Message Sent',
  'Message ID / Error',
  'Cashier Note',
];

export const RAFFLE_HEADER = [
  'Entry #',
  'Name',
  'Phone Number',
  'Invoice ID',
  'Timestamp',
];

export interface ContactRow {
  name: string;
  phone: string;
  totalBd: Prisma.Decimal;
  totalEntries: number;
  lastSeen: Date | null;
  invoiceCount: number;
  invoiceIds: string[];
}

export interface ReceiptRow {
  createdAt: Date | null;
  invoiceId: string;
  amount: Prisma.Decimal;
  entries: number;
  totalEntriesAtTime: number | null;
  messageStatus: string | null;
  messageError: string | null;
  wamid: string | null;
  cashierNote: string | null;
  contact: { name: string; phone: string };
}

export interface RaffleRow {
  entryNumber: number;
  name: string;
  phone: string;
  invoiceId: string;
  createdAt: Date | null;
}

/**
 * A leading apostrophe stops Sheets reading a value as a formula.
 *
 * A customer name is typed by a cashier and lands in a spreadsheet, so
 * `=HYPERLINK(...)` in the name field would otherwise become live. Sheets shows
 * the text and hides the apostrophe.
 */
function text(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Phone numbers keep their leading +, which Sheets would otherwise eat. */
function phone(value: string): string {
  return `'${value}`;
}

export function contactsValues(contacts: ContactRow[]): string[][] {
  return [
    CONTACTS_HEADER,
    ...contacts.map((c) => [
      text(c.name),
      phone(c.phone),
      Number(c.totalBd).toFixed(3),
      String(c.totalEntries),
      formatDateTimeCsv(c.lastSeen),
      String(c.invoiceCount),
      text(c.invoiceIds.join(', ')),
    ]),
  ];
}

export function logValues(receipts: ReceiptRow[]): string[][] {
  return [
    LOG_HEADER,
    ...receipts.map((r) => [
      formatDateTimeCsv(r.createdAt),
      text(r.invoiceId),
      text(r.contact.name),
      phone(r.contact.phone),
      Number(r.amount).toFixed(3),
      String(r.entries),
      r.totalEntriesAtTime == null ? '' : String(r.totalEntriesAtTime),
      text(r.messageStatus ?? ''),
      // Whichever we have: the id proves it went, the error says why it didn't.
      text(r.messageError ?? r.wamid ?? ''),
      text(r.cashierNote ?? ''),
    ]),
  ];
}

export function raffleValues(entries: RaffleRow[]): string[][] {
  return [
    RAFFLE_HEADER,
    ...entries.map((e) => [
      String(e.entryNumber),
      text(e.name),
      phone(e.phone),
      text(e.invoiceId),
      formatDateTimeCsv(e.createdAt),
    ]),
  ];
}

/**
 * Whether it is safe to replace a tab holding `existingRows` with `nextRows`.
 *
 * The snapshot only ever grows, so a smaller one means something is wrong —
 * a half-built snapshot, or the wrong store's data. Refusing to shrink is what
 * makes an overwrite safe regardless of when the sheet's own backup script
 * runs: a bad sync can never destroy good rows for the archive to preserve.
 */
export function isSafeToOverwrite(
  existingRows: number,
  nextRows: number,
): boolean {
  return nextRows >= existingRows;
}
