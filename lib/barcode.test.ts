import { describe, it, expect } from 'vitest';
import { normalizePhone, parseAmount, parseBarcode } from './barcode';

describe('normalizePhone', () => {
  it('keeps international numbers starting with +', () => {
    expect(normalizePhone('+97333959565')).toBe('+97333959565');
  });

  it('strips spaces and separators after +', () => {
    expect(normalizePhone('+973 3395 9565')).toBe('+97333959565');
    expect(normalizePhone('+973-3395-9565')).toBe('+97333959565');
  });

  it('prepends +973 for 8-digit local Bahraini numbers', () => {
    expect(normalizePhone('33959565')).toBe('+97333959565');
    expect(normalizePhone(' 33959565 ')).toBe('+97333959565');
  });

  it('prepends + for other lengths without a country code', () => {
    expect(normalizePhone('97333959565')).toBe('+97333959565');
  });
});

describe('parseAmount', () => {
  it('parses comma as the decimal separator (Bahraini)', () => {
    expect(parseAmount('15,000')).toBe(15);
    expect(parseAmount('45,500')).toBe(45.5);
  });

  it('parses period as the decimal separator', () => {
    expect(parseAmount('15.000')).toBe(15);
    expect(parseAmount('45.500')).toBe(45.5);
  });

  it('parses plain integers', () => {
    expect(parseAmount('45')).toBe(45);
  });

  it('returns 0 for empty or non-numeric input', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('   ')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
  });

  it('handles thousands grouping by treating the last separator as decimal', () => {
    expect(parseAmount('1,234.500')).toBe(1234.5);
  });

  // The scanner used to parse hand-typed amounts with
  // `parseFloat(s.replace(',', '.'))`, which only swaps the FIRST separator:
  // "1,200.00" became "1.200.00" and read as 1.2 BD. At 10 BD per entry that
  // silently cost the customer 120 entries, so these are the shapes a cashier
  // is most likely to type.
  it('reads a grouped two-decimal amount, as printed on a large receipt', () => {
    expect(parseAmount('1,200.00')).toBe(1200);
    expect(parseAmount('12,345.67')).toBe(12345.67);
    expect(parseAmount('999,999.99')).toBe(999999.99);
  });

  it('reads the same amounts written the European way round', () => {
    expect(parseAmount('1.200,00')).toBe(1200);
    expect(parseAmount('12.345,67')).toBe(12345.67);
  });

  it('reads a plain two-decimal amount', () => {
    expect(parseAmount('15.00')).toBe(15);
    expect(parseAmount('15,00')).toBe(15);
    expect(parseAmount('9.99')).toBe(9.99);
  });
});

describe('parseBarcode', () => {
  it('parses a full barcode from the brief example', () => {
    const result = parseBarcode('SI-100008 | HASSAN MAHMOOD | +97333959565 | 45,500');
    expect(result).toEqual({
      invoice: 'SI-100008',
      name: 'HASSAN MAHMOOD',
      phone: '+97333959565',
      amount: 45.5,
    });
  });

  it('trims whitespace from each field', () => {
    const result = parseBarcode('  SI-1  |  Ali  |  33959565  |  10,000  ');
    expect(result).toEqual({
      invoice: 'SI-1',
      name: 'Ali',
      phone: '+97333959565',
      amount: 10,
    });
  });

  it('returns null when fewer than 4 fields are present', () => {
    expect(parseBarcode('SI-1 | Ali | 33959565')).toBeNull();
    expect(parseBarcode('')).toBeNull();
  });
});
