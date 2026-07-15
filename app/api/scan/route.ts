import { NextResponse } from 'next/server';
import { getCurrentUserProfile, assertStoreAccess } from '@/lib/auth';
import { processScan, ScanError, type ScanInput } from '@/lib/scan';

export const runtime = 'nodejs';

interface ScanRequestBody extends Partial<ScanInput> {
  storeId?: string;
}

export async function POST(request: Request) {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ScanRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { storeId, invoiceId, name, phone, amount, note } = body;

  if (!storeId) {
    return NextResponse.json({ error: 'storeId is required' }, { status: 400 });
  }
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return NextResponse.json(
      { error: 'amount must be a number' },
      { status: 400 },
    );
  }

  // Enforce multi-store isolation: the cashier must be assigned to this store.
  let store;
  try {
    store = await assertStoreAccess(profile, storeId);
  } catch {
    return NextResponse.json(
      { error: 'You do not have access to this store' },
      { status: 403 },
    );
  }

  try {
    const result = await processScan(store, profile, {
      invoiceId: invoiceId ?? '',
      name: name ?? '',
      phone: phone ?? '',
      amount,
      note: note ?? null,
    });

    return NextResponse.json({
      success: true,
      receiptId: result.receipt.id,
      entries: result.entries,
      totalEntries: result.contact.totalEntries,
      contact: {
        name: result.contact.name,
        phone: result.contact.phone,
        totalBd: result.contact.totalBd.toString(),
        totalEntries: result.contact.totalEntries,
      },
      message: {
        status: result.message.status,
        error: result.message.error,
        queuedForRetry: result.message.queuedForRetry ?? false,
      },
    });
  } catch (err) {
    if (err instanceof ScanError) {
      const status = err.code === 'duplicate' ? 409 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    console.error('Scan failed:', err);
    return NextResponse.json(
      { error: 'Something went wrong while logging the scan' },
      { status: 500 },
    );
  }
}
