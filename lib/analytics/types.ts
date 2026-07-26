/** Shared types for the analytics dashboard. */

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom';

export interface DateRange {
  preset: RangePreset;
  /** Inclusive start (UTC instant of the Bahrain range start). */
  start: Date;
  /** Inclusive end (usually "now"). */
  end: Date;
  /** Same-length window immediately before `start`, for % change. */
  previousStart: Date;
  previousEnd: Date;
  label: string;
}

export interface OverviewStats {
  scans: number;
  customers: number;
  entries: number;
  totalBd: number;
}

export interface DailyScanPoint {
  /** Bahrain calendar day, "YYYY-MM-DD". */
  day: string;
  storeId: string;
  count: number;
}

export interface DeliveryDatum {
  status: string;
  count: number;
}

export interface TopCustomerRow {
  name: string;
  /** Which store this contact belongs to (shown when viewing all stores). */
  storeName: string;
  phoneMasked: string;
  /** Only present when the viewer is an admin (may reveal full numbers). */
  phoneFull?: string;
  totalEntries: number;
  totalBd: number;
  invoiceCount: number;
  lastSeen: string | null; // ISO
}

export interface PeakHourCell {
  /** 0 = Sunday … 6 = Saturday (Postgres DOW, Bahrain time). */
  dayOfWeek: number;
  hour: number;
  count: number;
}

export interface StoreOption {
  id: string;
  nameEn: string;
}
