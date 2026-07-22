import { NextResponse } from 'next/server';
import { getCurrentUserProfile } from '@/lib/auth';
import { previewImport, runImport } from '@/lib/failover-sync';

export const runtime = 'nodejs';

/**
 * Preview or run a failover-sheet import. One POST endpoint; `mode` in the body
 * chooses between a dry run (preview) and the real import (confirm).
 *
 * Admin only — this writes to a company's raffle. Guarded here rather than in
 * edge middleware because the role check needs the database.
 */

interface Body {
  storeId?: string;
  sheetId?: string;
  mode?: string;
}

export async function POST(request: Request) {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const storeId = (body.storeId ?? '').trim();
  const sheetId = (body.sheetId ?? '').trim();
  const mode = body.mode;

  if (!storeId) {
    return NextResponse.json({ error: 'storeId is required' }, { status: 400 });
  }
  if (mode !== 'preview' && mode !== 'confirm') {
    return NextResponse.json(
      { error: 'mode must be "preview" or "confirm"' },
      { status: 400 },
    );
  }

  try {
    const result =
      mode === 'preview'
        ? await previewImport(storeId, sheetId)
        : await runImport(storeId, sheetId, profile.id);

    // Both helpers return `{ ok: false, error }` for a clean, expected failure
    // (sheet not shared, bad header, unknown store); surface it as a 400.
    if ('ok' in result && result.ok === false) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('Failover import failed:', err);
    return NextResponse.json(
      { error: 'Something went wrong during the import.' },
      { status: 500 },
    );
  }
}
