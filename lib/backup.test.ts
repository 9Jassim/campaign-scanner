import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  contactsValues,
  logValues,
  raffleValues,
  isSafeToOverwrite,
  CONTACTS_HEADER,
  LOG_HEADER,
  RAFFLE_HEADER,
} from './backup';

const dec = (n: string) => new Prisma.Decimal(n);
const AT = new Date('2026-07-15T11:35:11.897Z'); // 14:35 in Bahrain

const contact = {
  name: 'Hassan Mahmood',
  phone: '+97333959565',
  totalBd: dec('45.5'),
  totalEntries: 4,
  lastSeen: AT,
  invoiceCount: 2,
  invoiceIds: ['SI-100008', 'SI-100009'],
};

describe('Contacts tab', () => {
  it('matches the columns the existing sheet already has', () => {
    expect(contactsValues([])[0]).toEqual(CONTACTS_HEADER);
  });

  it('writes a contact row', () => {
    expect(contactsValues([contact])[1]).toEqual([
      'Hassan Mahmood',
      "'+97333959565",
      '45.500',
      '4',
      '2026-07-15 14:35:11',
      '2',
      'SI-100008, SI-100009',
    ]);
  });

  it('keeps the + on a phone number', () => {
    // Without the apostrophe Sheets reads +973... as a formula and mangles it.
    expect(contactsValues([contact])[1][1]).toBe("'+97333959565");
  });

  it('dates in Bahrain time, not the server zone', () => {
    // 11:35 UTC is 14:35 at the till.
    expect(contactsValues([contact])[1][4]).toBe('2026-07-15 14:35:11');
  });

  it('is header-only when the store has no contacts', () => {
    expect(contactsValues([])).toHaveLength(1);
  });
});

describe('Log tab', () => {
  const receipt = {
    createdAt: AT,
    invoiceId: 'SI-100008',
    amount: dec('45.5'),
    entries: 4,
    totalEntriesAtTime: 4,
    messageStatus: 'delivered',
    messageError: null,
    wamid: 'wamid.ABC',
    cashierNote: null,
    contact: { name: 'Hassan Mahmood', phone: '+97333959565' },
  };

  it('matches the columns the existing sheet already has', () => {
    expect(logValues([])[0]).toEqual(LOG_HEADER);
  });

  it('records the message id when the message went out', () => {
    expect(logValues([receipt])[1]).toEqual([
      '2026-07-15 14:35:11',
      'SI-100008',
      'Hassan Mahmood',
      "'+97333959565",
      '45.500',
      '4',
      '4',
      'delivered',
      'wamid.ABC',
      '',
    ]);
  });

  it('records the reason instead when the message failed', () => {
    const failed = {
      ...receipt,
      messageStatus: 'failed',
      messageError: '131049: Message undeliverable',
    };
    const row = logValues([failed])[1];
    expect(row[7]).toBe('failed');
    expect(row[8]).toBe('131049: Message undeliverable');
  });
});

describe('Raffle tab', () => {
  it('matches the columns the existing sheet already has', () => {
    expect(raffleValues([])[0]).toEqual(RAFFLE_HEADER);
  });

  it('writes an entry row', () => {
    expect(
      raffleValues([
        { entryNumber: 7, name: 'Hassan', phone: '+97333959565', invoiceId: 'SI-1', createdAt: AT },
      ])[1],
    ).toEqual(['7', 'Hassan', "'+97333959565", 'SI-1', '2026-07-15 14:35:11']);
  });
});

describe('formula injection', () => {
  it('defuses a formula typed into a customer name', () => {
    // A cashier types the name at the till and it lands in a spreadsheet, so
    // this would otherwise execute when someone opens the backup.
    const evil = { ...contact, name: '=HYPERLINK("http://evil","clickme")' };
    expect(contactsValues([evil])[1][0]).toBe(
      '\'=HYPERLINK("http://evil","clickme")',
    );
  });

  it('defuses every leading character Sheets treats as a formula', () => {
    for (const prefix of ['=', '+', '-', '@']) {
      const evil = { ...contact, name: `${prefix}cmd` };
      expect(contactsValues([evil])[1][0]).toBe(`'${prefix}cmd`);
    }
  });

  it('leaves an ordinary name alone', () => {
    expect(contactsValues([contact])[1][0]).toBe('Hassan Mahmood');
  });
});

describe('never shrink a tab', () => {
  it('allows a snapshot that grows or stays level', () => {
    expect(isSafeToOverwrite(100, 120)).toBe(true);
    expect(isSafeToOverwrite(100, 100)).toBe(true);
  });

  it('refuses a snapshot that would delete rows', () => {
    // This is what makes the overwrite safe whenever the sheet's own Apps
    // Script backup runs: a half-built snapshot can never destroy good rows
    // for the archive to then preserve.
    expect(isSafeToOverwrite(100, 99)).toBe(false);
    expect(isSafeToOverwrite(100, 1)).toBe(false); // header only = catastrophic
    expect(isSafeToOverwrite(100, 0)).toBe(false);
  });

  it('allows the very first write into an empty tab', () => {
    expect(isSafeToOverwrite(0, 1)).toBe(true);
  });
});
