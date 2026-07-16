import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  resolveStatusUpdate,
  formatStatusError,
  verifySignature,
  findSigner,
  phoneNumberIdsIn,
} from './webhook';

describe('formatStatusError', () => {
  it('returns null when there are no errors', () => {
    expect(formatStatusError(undefined)).toBeNull();
    expect(formatStatusError([])).toBeNull();
  });

  it('combines the code and title', () => {
    expect(
      formatStatusError([{ code: 131049, title: 'Message undeliverable' }]),
    ).toBe('131049: Message undeliverable');
  });

  it('falls back to message when title is absent', () => {
    expect(formatStatusError([{ code: 470, message: 'Outside window' }])).toBe(
      '470: Outside window',
    );
  });
});

describe('resolveStatusUpdate', () => {
  it('advances sent -> delivered', () => {
    expect(resolveStatusUpdate('sent', { status: 'delivered' })).toEqual({
      messageStatus: 'delivered',
      messageError: null,
    });
  });

  it('advances delivered -> read', () => {
    expect(resolveStatusUpdate('delivered', { status: 'read' })).toEqual({
      messageStatus: 'read',
      messageError: null,
    });
  });

  it('advances pending -> sent', () => {
    expect(resolveStatusUpdate('pending', { status: 'sent' })).toEqual({
      messageStatus: 'sent',
      messageError: null,
    });
  });

  // Meta does not guarantee ordering — a late 'sent' must not undo 'read'.
  it('ignores out-of-order events that would move the status backwards', () => {
    expect(resolveStatusUpdate('read', { status: 'delivered' })).toBeNull();
    expect(resolveStatusUpdate('read', { status: 'sent' })).toBeNull();
    expect(resolveStatusUpdate('delivered', { status: 'sent' })).toBeNull();
  });

  // Meta retries the same event; reprocessing must be a no-op.
  it('ignores duplicate events at the same status', () => {
    expect(resolveStatusUpdate('delivered', { status: 'delivered' })).toBeNull();
  });

  it('applies failed at any point, with the error text', () => {
    expect(
      resolveStatusUpdate('delivered', {
        status: 'failed',
        errors: [{ code: 131049, title: 'Message undeliverable' }],
      }),
    ).toEqual({
      messageStatus: 'failed',
      messageError: '131049: Message undeliverable',
    });
  });

  it('applies failed even without error details', () => {
    expect(resolveStatusUpdate('sent', { status: 'failed' })).toEqual({
      messageStatus: 'failed',
      messageError: 'Message failed',
    });
  });

  it('lets a delivery status recover a receipt from failed', () => {
    expect(resolveStatusUpdate('failed', { status: 'delivered' })).toEqual({
      messageStatus: 'delivered',
      messageError: null,
    });
  });

  it('ignores statuses we do not track', () => {
    expect(resolveStatusUpdate('sent', { status: 'deleted' })).toBeNull();
    expect(resolveStatusUpdate('sent', {})).toBeNull();
  });

  it('is case-insensitive on the incoming status', () => {
    expect(resolveStatusUpdate('sent', { status: 'DELIVERED' })).toEqual({
      messageStatus: 'delivered',
      messageError: null,
    });
  });
});

describe('verifySignature', () => {
  const secret = 'app-secret';
  const body = JSON.stringify({ entry: [{ id: '1' }] });
  const valid =
    'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  it('accepts a correct signature', () => {
    expect(verifySignature(body, valid, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySignature(body + ' ', valid, secret)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const bad =
      'sha256=' +
      createHmac('sha256', 'wrong').update(body, 'utf8').digest('hex');
    expect(verifySignature(body, bad, secret)).toBe(false);
  });

  it('rejects missing or malformed headers', () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, 'sha1=abc', secret)).toBe(false);
    expect(verifySignature(body, 'sha256=', secret)).toBe(false);
  });
});

// Each store is a separate company with its own Meta app, so one webhook URL
// receives payloads signed by different app secrets.
describe('findSigner (multi-store Meta apps)', () => {
  const morslon = { store: 'morslon', secret: 'morslon-app-secret' };
  const modern = { store: 'modern-sources', secret: 'modern-app-secret' };
  const both = [morslon, modern];
  const body = JSON.stringify({ entry: [{ id: '1' }] });
  const sign = (s: string) =>
    'sha256=' + createHmac('sha256', s).update(body, 'utf8').digest('hex');

  it('names the store whose app signed the payload', () => {
    // The identity is the point: knowing *that* it was signed is not enough to
    // decide whose receipts the events may touch.
    expect(findSigner(body, sign(morslon.secret), both)).toBe(morslon);
    expect(findSigner(body, sign(modern.secret), both)).toBe(modern);
  });

  it('does not name a store whose secret did not sign it', () => {
    expect(findSigner(body, sign(modern.secret), both)).not.toBe(morslon);
  });

  it('rejects a payload signed by an unknown app', () => {
    expect(findSigner(body, sign('some-other-app'), both)).toBeNull();
  });

  it('rejects an unsigned payload', () => {
    expect(findSigner(body, null, both)).toBeNull();
  });

  it('rejects a tampered body even when the secret is right', () => {
    expect(findSigner(body + 'x', sign(morslon.secret), both)).toBeNull();
  });

  it('rejects everything when no candidate secret is available', () => {
    // The old code treated "no secrets" as "verification off" and accepted
    // anything — so a broken ENCRYPTION_KEY silently opened the endpoint.
    expect(findSigner(body, sign(morslon.secret), [])).toBeNull();
    expect(findSigner(body, null, [])).toBeNull();
  });
});

describe('phoneNumberIdsIn', () => {
  const value = (phoneNumberId: string) => ({
    metadata: { phone_number_id: phoneNumberId, display_phone_number: '973' },
  });

  it('finds the number a payload is addressed to', () => {
    expect(
      phoneNumberIdsIn({ entry: [{ changes: [{ value: value('111') }] }] }),
    ).toEqual(['111']);
  });

  it('finds every number when a payload spans changes', () => {
    // A body naming two stores' numbers can only be signed by one of them —
    // the route checks each change against the signer.
    expect(
      phoneNumberIdsIn({
        entry: [
          { changes: [{ value: value('111') }, { value: value('222') }] },
          { changes: [{ value: value('111') }] },
        ],
      }),
    ).toEqual(['111', '222']);
  });

  it('returns nothing for a payload that names no number', () => {
    expect(phoneNumberIdsIn({})).toEqual([]);
    expect(phoneNumberIdsIn({ entry: [] })).toEqual([]);
    expect(phoneNumberIdsIn({ entry: [{ changes: [{}] }] })).toEqual([]);
    expect(
      phoneNumberIdsIn({ entry: [{ changes: [{ value: { metadata: {} } }] }] }),
    ).toEqual([]);
  });
});
