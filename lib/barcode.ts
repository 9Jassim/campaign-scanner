/**
 * Barcode parsing for receipt barcodes.
 *
 * Receipts contain plain-text barcodes with 4 pipe-separated fields:
 *   INVOICE_ID | CUSTOMER_NAME | PHONE | AMOUNT
 * e.g. `SI-100008 | HASSAN MAHMOOD | +97333959565 | 45,500`
 */

export interface ParsedBarcode {
  invoice: string;
  name: string;
  phone: string;
  amount: number;
}

/**
 * Normalize a phone number to `+<digits>` form.
 * - Starts with `+` → keep the `+`, strip other non-digits.
 * - 8-digit local Bahraini number → prepend `+973`.
 * - Otherwise → prepend `+`.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 8) return `+973${digits}`; // Bahraini local
  return `+${digits}`;
}

/**
 * Parse a Bahraini-format amount string into a number.
 * Bahrain uses comma as the decimal separator (`15,000` = 15.000 BD).
 * We also accept period as the decimal separator for flexibility, so both
 * `15,000` and `15.000` parse to 15.
 *
 * If the string contains both separators (e.g. a thousands grouping like
 * `1,234.500`), the last separator is treated as the decimal point and the
 * others are stripped as grouping.
 */
export function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  const lastComma = trimmed.lastIndexOf(',');
  const lastPeriod = trimmed.lastIndexOf('.');
  const decimalPos = Math.max(lastComma, lastPeriod);

  let normalized: string;
  if (decimalPos === -1) {
    normalized = trimmed.replace(/[^\d-]/g, '');
  } else {
    const intPart = trimmed.slice(0, decimalPos).replace(/[^\d-]/g, '');
    const fracPart = trimmed.slice(decimalPos + 1).replace(/\D/g, '');
    normalized = `${intPart}.${fracPart}`;
  }

  const amount = parseFloat(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * Parse a full barcode string. Returns null if it doesn't have the 4
 * pipe-separated fields.
 */
export function parseBarcode(raw: string): ParsedBarcode | null {
  const parts = raw.trim().split('|');
  if (parts.length < 4) return null;

  const invoice = parts[0].trim();
  const name = parts[1].trim();
  const phone = normalizePhone(parts[2].trim());
  const amount = parseAmount(parts[3]);

  return { invoice, name, phone, amount };
}
