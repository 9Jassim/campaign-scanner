import { describe, it, expect } from 'vitest';
import type { Store } from '@prisma/client';
import { buildTemplatePayload, hasWhatsAppCredentials } from './whatsapp';

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: 'store-1',
    slug: 'morslon',
    nameEn: 'Morslon Electronics',
    nameAr: 'مرسلون للإلكترونيات',
    campaignNameEn: 'Summer Draw',
    campaignNameAr: 'سحب الصيف',
    prizeEn: 'A new car',
    prizeAr: 'سيارة جديدة',
    bdPerEntry: '10' as unknown as Store['bdPerEntry'],
    metaPhoneNumberId: '123456',
    metaAccessTokenEncrypted: 'encrypted-token',
    metaTemplateName: 'campaign_entry_confirmation',
    metaTemplateLang: 'ar',
    googleSheetId: null,
    createdAt: new Date(),
    ...overrides,
  } as Store;
}

const params = {
  name: 'HASSAN MAHMOOD',
  phone: '+97333959565',
  entries: 4,
  totalEntries: 12,
};

describe('hasWhatsAppCredentials', () => {
  it('is true only when both phone number ID and token are set', () => {
    expect(hasWhatsAppCredentials(makeStore())).toBe(true);
    expect(
      hasWhatsAppCredentials(makeStore({ metaPhoneNumberId: null })),
    ).toBe(false);
    expect(
      hasWhatsAppCredentials(makeStore({ metaAccessTokenEncrypted: null })),
    ).toBe(false);
  });
});

describe('buildTemplatePayload', () => {
  it('sends the phone as digits only, without a +', () => {
    const payload = buildTemplatePayload(makeStore(), params);
    expect(payload.to).toBe('97333959565');
  });

  it('uses the store template name and language', () => {
    const payload = buildTemplatePayload(makeStore(), params);
    expect(payload.template.name).toBe('campaign_entry_confirmation');
    expect(payload.template.language).toEqual({ code: 'ar' });
  });

  it('falls back to defaults when template name/lang are unset', () => {
    const payload = buildTemplatePayload(
      makeStore({ metaTemplateName: null, metaTemplateLang: null }),
      params,
    );
    expect(payload.template.name).toBe('campaign_entry_confirmation');
    expect(payload.template.language).toEqual({ code: 'ar' });
  });

  // Meta matches {{1}}..{{12}} purely by array order, so this order is
  // load-bearing — see the mapping table in PROJECT_BRIEF.md.
  it('maps the 12 positional variables in the exact documented order', () => {
    const payload = buildTemplatePayload(makeStore(), params);
    const values = payload.template.components[0].parameters.map((p) => p.text);

    expect(values).toEqual([
      'HASSAN MAHMOOD', // 1  customer name
      'مرسلون للإلكترونيات', // 2  store name (AR)
      '4', // 3  entries this receipt
      'سحب الصيف', // 4  campaign name (AR)
      '12', // 5  total entries
      'سيارة جديدة', // 6  prize (AR)
      'HASSAN MAHMOOD', // 7  customer name (repeat)
      'Morslon Electronics', // 8  store name (EN)
      '4', // 9  entries this receipt (repeat)
      'Summer Draw', // 10 campaign name (EN)
      '12', // 11 total entries (repeat)
      'A new car', // 12 prize (EN)
    ]);
  });

  it('sends exactly 12 body parameters, all of type text', () => {
    const payload = buildTemplatePayload(makeStore(), params);
    const body = payload.template.components[0];
    expect(body.type).toBe('body');
    expect(body.parameters).toHaveLength(12);
    expect(body.parameters.every((p) => p.type === 'text')).toBe(true);
  });

  it('substitutes empty strings for unset optional campaign/prize fields', () => {
    const payload = buildTemplatePayload(
      makeStore({
        campaignNameAr: null,
        campaignNameEn: null,
        prizeAr: null,
        prizeEn: null,
      }),
      params,
    );
    const values = payload.template.components[0].parameters.map((p) => p.text);
    // Positions 4, 6, 10, 12 are the optional ones.
    expect(values[3]).toBe('');
    expect(values[5]).toBe('');
    expect(values[9]).toBe('');
    expect(values[11]).toBe('');
    // Still 12 params — Meta rejects a mismatched count.
    expect(values).toHaveLength(12);
  });

  it('is a whatsapp template message', () => {
    const payload = buildTemplatePayload(makeStore(), params);
    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.type).toBe('template');
  });
});
