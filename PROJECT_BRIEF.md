# Campaign Scanner Portal — Project Brief

Build a web-based multi-store WhatsApp campaign scanner portal for two independent retail businesses running a 6-month prize giveaway campaign in Bahrain. The portal replaces our current Google Sheets + Apps Script implementation but continues to write to the Sheets as a redundant backup during the transition period.

## Business Context

**Client:** Two retail businesses in Bahrain running a 6-month prize giveaway campaign.

**How the campaign works:**
1. Customer makes a purchase at a physical store.
2. Receipt is printed with a QR/barcode containing the customer's info + purchase amount.
3. Cashier scans the barcode → system parses the data.
4. Every 10 BD spent = 1 raffle entry (configurable per store).
5. Customer receives an automated bilingual WhatsApp confirmation (Arabic + English) with their entry count.
6. At the end of the campaign, a winner is drawn from all raffle entries.

**Two independent businesses use this system:**
- **Morslon Electronics** (Store A)
- **Modern Sources** (Store B)

They are legally separate companies with different Commercial Registrations, so they each have their own Meta Business Portfolio and their own WhatsApp Business Account (WABA). **One portal instance serves both** — data is isolated by `store_id`.

## Tech Stack

- **Framework:** Next.js 14+ (App Router, TypeScript)
- **Styling:** Tailwind CSS
- **Auth:** Clerk (fastest setup) — alternative: NextAuth.js if self-hosting is preferred
- **Database:** Neon Postgres (serverless)
- **ORM:** Drizzle ORM (fast, type-safe, works great with Neon)
- **Realtime:** Pusher (for live scan-status updates) — optional at MVP
- **Storage:** Cloudflare R2 (for weekly CSV backups) — optional at MVP
- **Google Sheets integration:** `googleapis` npm package (for dual-write)
- **Hosting:** Vercel

**Env vars required:**
```
DATABASE_URL=<neon-postgres-connection-string>
DIRECT_URL=<neon-direct-connection-string>  # for migrations

CLERK_SECRET_KEY=<clerk-secret>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<clerk-publishable>

# Google Sheets dual-write
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<service-account-private-key>

# Webhook for Meta
WEBHOOK_VERIFY_TOKEN=<random-string-shared-with-meta>

# Encryption for Meta access tokens stored in DB
ENCRYPTION_KEY=<32-byte-key-base64>

# Optional: realtime
PUSHER_APP_ID=<optional>
PUSHER_KEY=<optional>
PUSHER_SECRET=<optional>
```

## Barcode Format

Receipts contain plain-text barcodes with 4 pipe-separated fields:

```
INVOICE_ID | CUSTOMER_NAME | PHONE | AMOUNT
```

**Example:** `SI-100008 | HASSAN MAHMOOD | +97333959565 | 45,500`

**Parsing rules:**
- Split on `|` and trim whitespace from each part.
- Amount uses **comma as decimal separator** (Bahraini format) — `15,000` means 15.000 BD (fifteen dinars). Replace comma with period before `parseFloat`.
- Also handle period as decimal separator for flexibility (both `15,000` and `15.000` should parse as `15.000`).
- Phone number:
  - If it starts with `+` → keep as-is (just strip non-digits after the `+`).
  - If it's an 8-digit local Bahraini number without country code → prepend `+973`.
  - Otherwise → prepend `+`.
- Invoice ID format is store-specific (e.g., `SI-100008` for one store, could differ for another) — just store as-is.

**TypeScript implementation:**

```typescript
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 8) return `+973${digits}`; // Bahraini local
  return `+${digits}`;
}

export function parseBarcode(raw: string) {
  const parts = raw.trim().split('|');
  if (parts.length < 4) return null;

  const invoice = parts[0].trim();
  const name = parts[1].trim();
  const phone = normalizePhone(parts[2].trim());
  const amountStr = parts[3].trim().replace(',', '.'); // Bahraini decimal
  const amount = parseFloat(amountStr) || 0;

  return { invoice, name, phone, amount };
}
```

## Core Features

### 1. Multi-store data isolation
Each store has its own set of contacts, receipts, and raffle entries. A cashier at Morslon should never see Modern Sources data and vice versa. Enforce this both in Drizzle query filters and via a helper `getUserStores(userId)` function that scopes every query.

### 2. Scanner interface (primary use)
- A cashier logs in via Clerk → auto-scoped to their assigned store(s).
- Barcode input at the top (autofocus, listens for scanner keyboard input — most scanners emit text + Enter).
- Auto-parses barcode into fields (invoice, name, phone, amount) as user scans or pastes.
- Shows entries earned this receipt (`Math.floor(amount / bd_per_entry)`).
- Cashier reviews → clicks "Confirm and log".
- System: creates receipt record, upserts contact, adds raffle entries, sends WhatsApp, writes to Google Sheet.
- Shows result inline (success/failure with detail); if realtime is set up, message status updates live via Pusher.

### 3. Contact upsert
- Match customer by normalized phone (`+<digits>`).
- Same customer scanning again → UPDATE their existing row, not create a new one.
- Track: total BD spent, total entries, last seen timestamp, invoice count, list of invoice IDs (as text array).

### 4. Duplicate invoice protection
- If the same invoice ID (for the same store) is scanned twice, reject with clear error.
- Enforce with `UNIQUE (store_id, invoice_id)` constraint.

### 5. Raffle entries
- One row per entry (not per receipt).
- If a receipt earns 4 entries, create 4 raffle rows.
- Sequential entry number per store (Entry #1, #2, #3, #4… across all receipts in that store).
- Timestamped.

### 6. WhatsApp integration (Meta Cloud API)
See "WhatsApp Setup" section below for full details.

### 7. Webhook for delivery tracking
- Meta sends webhook events when a message is sent, delivered, read, or fails.
- Update the receipt row's `message_status` and `message_error` accordingly.
- If Pusher is configured, publish an event so the cashier UI updates live.

### 8. Settings (per store, admin-only)
- Store name (Arabic + English)
- Campaign name (Arabic + English)
- Prize (Arabic + English)
- BD per entry (numeric, decimal supported — e.g., 10)
- Meta credentials: `meta_phone_number_id`, `meta_access_token` (encrypted at rest), `meta_template_name`, `meta_template_lang`
- Google Sheet ID for dual-write (optional per store)

### 9. Roles
- **Admin** — full access to all stores, can create/edit stores, manage users, view/edit all settings and data.
- **Manager** — access to one or more assigned stores, can view all data and edit settings for their stores.
- **Cashier** — access to one assigned store, can only use the scanner (no editing, no viewing other cashiers' scans).

Role is stored in `user_profiles.role` (synced from Clerk metadata or as a separate table).

### 10. Weekly backup
- Automated weekly CSV export of `contacts`, `receipts`, `raffle_entries` for each store.
- Save to Cloudflare R2 (or Vercel Blob).
- Retain 26 weeks (6 months).
- Trigger via Vercel Cron.

### 11. Bilingual UI
- English + Arabic switchable.
- Store names, campaign names, prizes all bilingual in the DB.
- RTL support for Arabic (`dir="rtl"` where appropriate).
- Consider `next-intl` or similar for i18n.

## WhatsApp Setup (Meta Cloud API)

Each store has its own WABA and its own credentials.

**API:** Meta WhatsApp Cloud API (`https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`)

**Message template** (already approved on both stores' WABAs):
- Template name: `campaign_entry_confirmation`
- Language code: `ar`
- Category: Marketing
- Uses positional variables `{{1}}` through `{{12}}`

**Template body (Arabic + English combined):**
```
مرحباً {{1}}،
شكراً لتسوقك من {{2}}.
يسرّنا إبلاغك بأنه تمت إضافة {{3}} فرص جديدة إلى مشاركتك في فعالية {{4}}.
إجمالي فرصك الآن: {{5}}.
نتمنى لك كل التوفيق للفوز بالجائزة الكبرى: {{6}}!
ــــــــــــــــــــ
Hi {{7}} 👋
Thank you for shopping at {{8}}.
🎉 You've earned {{9}} new entries in the {{10}} prize draw, increasing your chances of winning.
📌 Your total entries are now: {{11}}.
We wish you the best of luck, and we hope you win the grand prize:
🏆 {{12}}
```

**Variable mapping (must be in this exact order in the API call):**

| # | Meaning | Source |
|---|---|---|
| 1 | Customer name | scanned name |
| 2 | Store name (Arabic) | store.name_ar |
| 3 | Entries this receipt | calculated |
| 4 | Campaign name (Arabic) | store.campaign_name_ar |
| 5 | Total entries | contact.total_entries |
| 6 | Prize (Arabic) | store.prize_ar |
| 7 | Customer name (repeat) | scanned name |
| 8 | Store name (English) | store.name_en |
| 9 | Entries this receipt (repeat) | calculated |
| 10 | Campaign name (English) | store.campaign_name_en |
| 11 | Total entries (repeat) | contact.total_entries |
| 12 | Prize (English) | store.prize_en |

**API call structure:**
```
POST https://graph.facebook.com/v21.0/{META_PHONE_NUMBER_ID}/messages
Authorization: Bearer {META_ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "97312345678",  // digits only, no +
  "type": "template",
  "template": {
    "name": "campaign_entry_confirmation",
    "language": { "code": "ar" },
    "components": [{
      "type": "body",
      "parameters": [
        { "type": "text", "text": <name> },
        { "type": "text", "text": <store_name_ar> },
        { "type": "text", "text": <entries_string> },
        { "type": "text", "text": <campaign_name_ar> },
        { "type": "text", "text": <total_entries_string> },
        { "type": "text", "text": <prize_ar> },
        { "type": "text", "text": <name> },
        { "type": "text", "text": <store_name_en> },
        { "type": "text", "text": <entries_string> },
        { "type": "text", "text": <campaign_name_en> },
        { "type": "text", "text": <total_entries_string> },
        { "type": "text", "text": <prize_en> }
      ]
    }]
  }
}
```

**Success response:** `{ messages: [{ id: "wamid.xxx" }] }` — save the wamid as `receipts.wamid`.
**Error response:** `{ error: { message: "..." } }` — save as `receipts.message_error`.

**Rate limits:**
- New numbers start at Tier 0: 250 conversations per rolling 24 hours.
- Grows to 1,000 / 10,000 / 100,000 / unlimited based on quality signals over ~7 days.
- Handle 429/rate-limit errors gracefully — save to a retry queue table and process later via a cron.

## Webhook Setup

Configure Meta to POST to `/api/webhook` on your deployed portal.

**Verify token flow (GET request):**
Meta sends a GET with `hub.mode`, `hub.verify_token`, `hub.challenge` query params. Echo back the challenge as plain text if the verify token matches `process.env.WEBHOOK_VERIFY_TOKEN`.

```typescript
// app/api/webhook/route.ts (GET)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}
```

**Event flow (POST request):**
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "statuses": [
          {
            "id": "wamid.xxx",
            "status": "delivered",
            "timestamp": "...",
            "errors": [{ "code": ..., "message": "..." }]
          }
        ],
        "messages": [
          // customer replies (optional to handle)
        ]
      }
    }]
  }]
}
```

Update the matching receipt's `message_status` field. If `failed`, save the error message too. For incoming customer messages, log them to a `customer_messages` table so support can review. Respond 200 OK within 20 seconds or Meta will retry.

## Google Sheets Dual-Write

We want the portal to write to both Neon Postgres AND Google Sheets during a transition period. Sheets act as a human-readable backup and continue to support existing manual workflows.

**Existing sheets have these tabs:**
- `Contacts` — columns: Name, Phone Number, Total BD Spent, Total Entries, Last Seen, Invoice Count, Invoice IDs
- `Log` — columns: Timestamp, Invoice ID, Name, Phone Number, Amount (BD), Entries This Receipt, Total Entries, Message Sent, Message ID / Error, Cashier Note
- `Raffle` — columns: Entry #, Name, Phone Number, Invoice ID, Timestamp

**Setup:**
1. Enable Google Sheets API in Google Cloud Console.
2. Create a Service Account, download the JSON key.
3. Share each store's Google Sheet with the service account email as Editor.
4. Store the sheet ID (from the URL) in `stores.google_sheet_id`.

**Helper:**
```typescript
// lib/googleSheets.ts
import { google } from 'googleapis';

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

export async function appendToSheet(
  sheetId: string,
  sheetName: string,
  values: any[][]
) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}
```

**Dual-write in the scan flow (fire-and-forget for Sheets):**
```typescript
// After DB writes succeed:
if (store.google_sheet_id) {
  writeToSheets(store, receipt, contact, raffleEntries).catch(err => {
    // Log but don't fail the scan
    console.error('Sheets write failed:', err);
  });
}
```

Contacts upsert to Sheets is trickier — since Sheets don't have a native upsert, either:
- Search for the phone in column B, then update that row OR append if not found.
- OR use batch updates via `values.update` when the row index is known.

**Sheet API quotas:**
- 300 requests per minute per project.
- 60 per minute per user.
- Fine for expected volume, but batch writes if possible.

## Database Schema (Drizzle ORM + Neon Postgres)

```typescript
// db/schema.ts
import { pgTable, uuid, text, timestamp, integer, numeric, boolean, jsonb, primaryKey, unique, index } from 'drizzle-orm/pg-core';

export const stores = pgTable('stores', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),  // e.g. 'morslon', 'modern-sources'
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  campaignNameEn: text('campaign_name_en'),
  campaignNameAr: text('campaign_name_ar'),
  prizeEn: text('prize_en'),
  prizeAr: text('prize_ar'),
  bdPerEntry: numeric('bd_per_entry', { precision: 10, scale: 3 }).notNull().default('10'),
  metaPhoneNumberId: text('meta_phone_number_id'),
  metaAccessTokenEncrypted: text('meta_access_token_encrypted'),  // encrypted at rest
  metaTemplateName: text('meta_template_name').default('campaign_entry_confirmation'),
  metaTemplateLang: text('meta_template_lang').default('ar'),
  googleSheetId: text('google_sheet_id'),  // optional per-store sheet for dual-write
  createdAt: timestamp('created_at').defaultNow(),
});

export const userProfiles = pgTable('user_profiles', {
  id: text('id').primaryKey(),  // Clerk user ID
  email: text('email').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull(),  // 'admin' | 'manager' | 'cashier'
  createdAt: timestamp('created_at').defaultNow(),
});

export const storeUsers = pgTable('store_users', {
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.storeId, table.userId] }),
}));

export const contacts = pgTable('contacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),  // normalized: +<digits>
  totalBd: numeric('total_bd', { precision: 12, scale: 3 }).notNull().default('0'),
  totalEntries: integer('total_entries').notNull().default(0),
  invoiceCount: integer('invoice_count').notNull().default(0),
  invoiceIds: text('invoice_ids').array().default([]),
  lastSeen: timestamp('last_seen').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  uniqPhone: unique().on(table.storeId, table.phone),
}));

export const receipts = pgTable('receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  invoiceId: text('invoice_id').notNull(),
  amount: numeric('amount', { precision: 12, scale: 3 }).notNull(),
  entries: integer('entries').notNull(),
  totalEntriesAtTime: integer('total_entries_at_time'),
  cashierNote: text('cashier_note'),
  cashierUserId: text('cashier_user_id').references(() => userProfiles.id),
  cashierEmail: text('cashier_email'),
  wamid: text('wamid'),
  messageStatus: text('message_status').default('pending'),  // pending, sent, delivered, read, failed, skipped
  messageError: text('message_error'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  uniqInvoice: unique().on(table.storeId, table.invoiceId),
  wamidIdx: index('idx_receipts_wamid').on(table.wamid),
  storeCreatedIdx: index('idx_receipts_store_created').on(table.storeId, table.createdAt),
}));

export const raffleEntries = pgTable('raffle_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  receiptId: uuid('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  entryNumber: integer('entry_number').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  invoiceId: text('invoice_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  uniqNumber: unique().on(table.storeId, table.entryNumber),
  storeNumberIdx: index('idx_raffle_store_number').on(table.storeId, table.entryNumber),
}));

export const customerMessages = pgTable('customer_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id),
  fromPhone: text('from_phone').notNull(),
  messageText: text('message_text'),
  messageType: text('message_type'),
  wamid: text('wamid'),
  receivedAt: timestamp('received_at').defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => userProfiles.id),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  changes: jsonb('changes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Optional: for rate-limit retry queue
export const retryQueue = pgTable('retry_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  receiptId: uuid('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  nextRetryAt: timestamp('next_retry_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

## Business Logic

### Scan flow (`POST /api/scan`)

Use a Drizzle transaction to keep contact upsert, receipt creation, and raffle entries atomic.

```typescript
import { db } from '@/db';
import { contacts, receipts, raffleEntries } from '@/db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

async function processScan({ invoiceId, name, phone, amount, note, cashierUser }) {
  const store = await getUserActiveStore(cashierUser);
  if (!store) throw new Error('No store assigned');

  // Validate
  if (!invoiceId || !name || !phone || amount <= 0) {
    throw new Error('Missing required fields');
  }
  const normalizedPhone = normalizePhone(phone);
  const entries = Math.floor(amount / Number(store.bdPerEntry));
  if (entries < 1) {
    throw new Error(`Minimum ${store.bdPerEntry} BD for 1 entry`);
  }

  // DB transaction
  const result = await db.transaction(async (tx) => {
    // Duplicate check (relies on unique constraint too, but check first for clean error)
    const existing = await tx.select().from(receipts).where(
      and(eq(receipts.storeId, store.id), eq(receipts.invoiceId, invoiceId))
    ).limit(1);
    if (existing.length > 0) {
      throw new Error(`Invoice ${invoiceId} already scanned`);
    }

    // Upsert contact
    const existingContact = await tx.select().from(contacts).where(
      and(eq(contacts.storeId, store.id), eq(contacts.phone, normalizedPhone))
    ).limit(1);

    let contact;
    if (existingContact.length > 0) {
      const c = existingContact[0];
      const [updated] = await tx.update(contacts)
        .set({
          name,  // update name in case of typo correction
          totalBd: sql`${contacts.totalBd} + ${amount}`,
          totalEntries: c.totalEntries + entries,
          invoiceCount: c.invoiceCount + 1,
          invoiceIds: sql`array_append(${contacts.invoiceIds}, ${invoiceId})`,
          lastSeen: new Date(),
        })
        .where(eq(contacts.id, c.id))
        .returning();
      contact = updated;
    } else {
      const [created] = await tx.insert(contacts).values({
        storeId: store.id,
        name,
        phone: normalizedPhone,
        totalBd: String(amount),
        totalEntries: entries,
        invoiceCount: 1,
        invoiceIds: [invoiceId],
      }).returning();
      contact = created;
    }

    // Create receipt
    const [receipt] = await tx.insert(receipts).values({
      storeId: store.id,
      contactId: contact.id,
      invoiceId,
      amount: String(amount),
      entries,
      totalEntriesAtTime: contact.totalEntries,
      cashierNote: note,
      cashierUserId: cashierUser.id,
      cashierEmail: cashierUser.email,
      messageStatus: 'pending',
    }).returning();

    // Get next entry number for this store
    const [maxRow] = await tx.select({ max: sql<number>`MAX(${raffleEntries.entryNumber})` })
      .from(raffleEntries)
      .where(eq(raffleEntries.storeId, store.id));
    const startNumber = (maxRow.max || 0) + 1;

    // Create raffle entries
    const raffleRows = Array.from({ length: entries }, (_, i) => ({
      storeId: store.id,
      receiptId: receipt.id,
      contactId: contact.id,
      entryNumber: startNumber + i,
      name,
      phone: normalizedPhone,
      invoiceId,
    }));
    await tx.insert(raffleEntries).values(raffleRows);

    return { receipt, contact, entries };
  });

  // Send WhatsApp (outside transaction — don't fail scan if this fails)
  const msgResult = await sendWhatsApp(store, result.contact, result.entries);
  await db.update(receipts)
    .set({
      wamid: msgResult.wamid,
      messageStatus: msgResult.wamid ? 'sent' : 'failed',
      messageError: msgResult.error,
    })
    .where(eq(receipts.id, result.receipt.id));

  // Fire-and-forget Google Sheets write (don't await, don't fail on error)
  if (store.googleSheetId) {
    writeToSheets(store, result.receipt, result.contact, msgResult).catch(err => {
      console.error('Sheets write failed:', err);
    });
  }

  return { success: true, ...result, msgResult };
}
```

## Pages / Routes

```
/sign-in                     — Clerk auth UI
/scanner                     — Cashier scanner (default landing for cashiers)
/dashboard                   — Overview stats (managers/admins)
/contacts                    — Contact list with search
/receipts                    — Receipt log with filters
/raffle                      — Raffle entries list, draw winner action
/settings                    — Store settings (admins/managers)
/admin/stores                — Manage stores (admin only)
/admin/users                 — Manage users and store assignments (admin only)
/api/scan                    — POST endpoint for scan submission
/api/webhook                 — GET (verify) + POST (events) from Meta
/api/backup                  — Cron endpoint for weekly backup (Vercel cron)
/api/retry-queue             — Cron endpoint to retry rate-limited messages
```

## Migration from Google Sheets (One-Time Import)

Provide a script `scripts/import-from-sheets.ts` that reads CSV exports of the existing Google Sheets and populates the DB:

- `Contacts.csv` → `contacts` table
- `Log.csv` → `receipts` table (map columns; message_status parsed from "Yes/Failed/Skipped")
- `Raffle.csv` → `raffle_entries` table

Match by phone number to link raffle entries to contacts.

Runs as:
```bash
npx tsx scripts/import-from-sheets.ts \
  --store-slug=morslon \
  --contacts=./exports/morslon-contacts.csv \
  --log=./exports/morslon-log.csv \
  --raffle=./exports/morslon-raffle.csv
```

## MVP Priority Order

Build in this order to get to launch fast:

1. **Project bootstrap** — Next.js, Tailwind, Clerk auth working with a login page.
2. **Neon DB + Drizzle** — schema migrations, seed 2 stores manually, seed self as admin.
3. **Scanner page** — barcode input, parse, preview, save to DB (skip WhatsApp initially).
4. **WhatsApp send** — Meta Cloud API call, update `wamid`/status on receipt.
5. **Contact list + receipt log pages** — read-only tables with search/filter.
6. **Settings page** — edit store fields (admin/manager only).
7. **Google Sheets dual-write** — write to existing sheets on every scan.
8. **Webhook endpoint** — receive delivery statuses, update receipt `message_status`.
9. **Role enforcement** — middleware to restrict cashiers, admins, managers appropriately.
10. **User management page** — admin invites cashiers, assigns to stores.
11. **Weekly backup cron** — export to R2/Vercel Blob.
12. **Data migration script** — import old Sheets data.
13. **Polish** — bilingual UI, mobile/tablet responsiveness, error handling, empty states.

## Notes / Gotchas Learned From the Sheets Version

1. **Bahraini phone numbers** — some POS systems output local 8-digit, others output full international. Handle both.
2. **Amount comma vs period** — Bahrain uses comma as decimal (`15,000` = 15 BD). Handle both formats.
3. **Concurrent cashier scans** — the DB transaction handles this in Postgres cleanly. No app-level locking needed.
4. **Meta tier ramp-up** — new production numbers start at 250 msgs/day. Handle 429 rate limit gracefully by queuing to `retry_queue`.
5. **Marketing category** — the template is Marketing (not Utility), meaning higher cost per message but freer content.
6. **Test recipients** — during testing with a test number, messages only send to pre-verified phone numbers in Meta's console. Production numbers can send to anyone.
7. **wamid returned doesn't mean delivered** — Meta accepts the API call, but delivery can still fail silently. That's why webhooks matter.
8. **Payment method required** — even with valid token and template, messages fail silently if no payment method is attached to the WABA.
9. **Access tokens must be encrypted** — never store `meta_access_token` in plaintext in the DB. Use AES-256-GCM with `ENCRYPTION_KEY`.
10. **Google Sheets API quotas** — 60 requests/minute per user. Batch writes when possible.

## Deliverables

- Full Next.js codebase (TypeScript, App Router)
- Drizzle schema + migration files
- README with setup instructions:
  - Create Neon project, get connection strings
  - Create Clerk app, get keys
  - Set up Google Cloud service account, share sheets
  - Set env vars in Vercel
  - Run migrations
  - Seed initial stores + admin user
  - Deploy to Vercel
  - Configure Meta webhook URL
- Data import script (CSV → DB)
- Basic tests for scan flow, phone normalization, barcode parsing

## Testing Scenarios

Cover these edge cases:

- Scan with local 8-digit phone → normalized to +973...
- Scan with comma decimal → parsed correctly
- Same invoice scanned twice → rejected with clear error
- Same customer scanning again → contact updated (not duplicated)
- Amount below `bd_per_entry` → rejected
- WhatsApp send fails (invalid token) → receipt still saved, marked failed
- Rate limit hit (429) → queued for retry
- Webhook receives delivered status → receipt updated to `delivered`
- Webhook receives failed status → receipt updated to `failed` with error
- Cashier tries to view Modern Sources data while assigned to Morslon → denied
- Admin views all stores → succeeds
