import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  resolveStatusUpdate,
  formatStatusError,
  verifySignature,
  verifySignatureAgainstAny,
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
describe('verifySignatureAgainstAny (multi-store Meta apps)', () => {
  const secretA = 'morslon-app-secret';
  const secretB = 'modern-sources-app-secret';
  const body = JSON.stringify({ entry: [{ id: '1' }] });
  const sign = (s: string) =>
    'sha256=' + createHmac('sha256', s).update(body, 'utf8').digest('hex');

  it('accepts a payload signed by the first store app', () => {
    expect(verifySignatureAgainstAny(body, sign(secretA), [secretA, secretB])).toBe(
      true,
    );
  });

  it('accepts a payload signed by the second store app', () => {
    expect(verifySignatureAgainstAny(body, sign(secretB), [secretA, secretB])).toBe(
      true,
    );
  });

  it('rejects a payload signed by an unknown app', () => {
    expect(
      verifySignatureAgainstAny(body, sign('some-other-app'), [secretA, secretB]),
    ).toBe(false);
  });

  it('rejects an unsigned payload when secrets are configured', () => {
    expect(verifySignatureAgainstAny(body, null, [secretA, secretB])).toBe(false);
  });

  it('accepts everything when no secrets are configured (verification off)', () => {
    expect(verifySignatureAgainstAny(body, null, [])).toBe(true);
  });

  it('rejects a tampered body even with valid secrets', () => {
    expect(
      verifySignatureAgainstAny(body + 'x', sign(secretA), [secretA, secretB]),
    ).toBe(false);
  });
});
