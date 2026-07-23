# Campaign Scanner Portal

A multi-store WhatsApp campaign scanner portal for retail prize giveaways.
One instance serves multiple legally-separate stores, with all data isolated
by `store_id`.

## Tech Stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** Tailwind CSS v4
- **Auth:** NextAuth / Auth.js v5 (username + password credentials, 2-hour idle sessions)
- **Database:** Neon Postgres (serverless)
- **ORM:** Prisma 7 (with the Neon driver adapter)
- **Hosting:** Railway (web service + cron services)

## Prerequisites

- Node.js 18.18+ (Node 20 LTS recommended)
- A [Neon](https://neon.tech) project

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in real values:

```bash
cp .env.example .env.local
```

- **Neon:** Create a project, then copy the **pooled** connection string into
  `DATABASE_URL` and the **direct** (unpooled) string into `DIRECT_URL`.
- **`AUTH_SECRET`:** Secret used to sign session tokens. Generate one with
  `npx auth secret` (or `openssl rand -base64 33`).
- **`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`:** The first admin login,
  created by the seed script (see step 3a). Staff sign in with a username;
  `SEED_ADMIN_EMAIL` is optional contact detail.
- **`ENCRYPTION_KEY`:** Generate a 32-byte base64 key:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- **`WEBHOOK_VERIFY_TOKEN`:** Any long random string (must match what you
  configure in the Meta webhook settings).

### 3. Run database migrations

The initial migration lives in `prisma/migrations/0000_init`. Apply it to your
Neon database:

```bash
npm run db:deploy      # prisma migrate deploy — applies committed migrations
```

Generate the Prisma client (also runs automatically after install):

```bash
npm run db:generate
```

### 3a. Seed stores and an admin login

Creates the two stores and, if `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` are
set, an admin user you can log in with:

```bash
npm run db:seed
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database Scripts

| Script                | Description                                    |
| --------------------- | ---------------------------------------------- |
| `npm run db:generate` | Generate the Prisma client from the schema     |
| `npm run db:migrate`  | Create + apply a new migration in development  |
| `npm run db:deploy`   | Apply committed migrations (CI / production)   |
| `npm run db:seed`     | Seed the two stores and an optional admin      |
| `npm run db:studio`   | Open Prisma Studio to browse data              |

> **Prisma 7 note:** Connection URLs live in `prisma.config.ts` (not in
> `schema.prisma`). At runtime, `lib/db.ts` instantiates `PrismaClient` with the
> `@prisma/adapter-neon` driver adapter.

## Project Structure

```
app/                      App Router pages & layouts
  layout.tsx              Root layout
  page.tsx                Landing page
  sign-in/                Username + password sign-in form
  scanner/                Cashier scanner page
  api/scan/               POST endpoint for logging a scan
  api/auth/[...nextauth]/ NextAuth route handlers
auth.ts                   NextAuth config (Credentials provider, Node runtime)
auth.config.ts            Edge-safe NextAuth config (used by middleware)
lib/
  auth.ts                 Session → profile + store-scoping helpers
  barcode.ts              Barcode / phone / amount parsing
  scan.ts                 Atomic scan transaction
  db.ts                   Prisma client singleton (Neon adapter)
prisma/
  schema.prisma           Data model
  migrations/             SQL migration files
  seed.ts                 Seed stores + admin
prisma.config.ts          Prisma 7 config (schema path + datasource URL)
middleware.ts             NextAuth route protection
```

## Data Model

The schema (see `prisma/schema.prisma`) defines: `stores`, `user_profiles`,
`store_users`, `contacts`, `receipts`, `raffle_entries`, `customer_messages`,
`audit_log`, and `retry_queue`. Multi-store isolation is enforced by scoping
every query to `store_id`.

## Signing in

Staff sign in with a **username**, not an email — till workers rarely have a
work address, and a short name is faster to type on a shared device. Email is
optional contact detail. Usernames are lowercase and limited to letters,
numbers, dot, dash and underscore (3–32 characters); admins set them in
**Users**.

Sessions last **2 hours and slide**: the clock restarts on every request, so
somebody scanning through a shift is never logged out mid-queue, while a till
left idle for two hours stops being signed in. Nothing has to be done to renew
it — using the portal is enough.

Repeated failures lock an account for a minute, doubling to a 15-minute cap.
The per-IP limit is deliberately much looser, because a shop's tills share one
address and locking the whole store out mid-shift would be worse than the
attack.

## Google Sheets sync

Each store's sheet is a readable **view** of the portal, refreshed nightly by a
Railway cron service that replaces its `Contacts`, `Log` and `Raffle` tabs with
a fresh copy from Postgres, then pushes current contacts into the store's
failover sheet. The sheet's own Apps Script then archives it weekly. Nothing is
ever read back out on this path — the portal is the source of truth.

There is no per-scan dual-write: keeping Google off the scanning path means a
Sheets outage can never hold up a till, and a whole-tab replace sidesteps the
"spreadsheets have no upsert" problem entirely.

Because every sync writes a **full** copy rather than a delta, the weekly Apps
Script archive captures a complete, valid snapshot whenever it runs — the two
schedules can't interleave badly. A sync will also **refuse to shrink** a tab:
if it has fewer rows than the sheet already holds, it writes nothing and reports
a failure, so a half-built sync can't destroy rows for the archive to preserve.
Admins can override that from **Sheets → Sync now (force)** after deliberately
clearing data.

Admins get a **Sheets** page showing each store's last sync, its outcome, and
buttons to run one immediately rather than waiting for the night's job.

Setup (once):

1. In Google Cloud, enable the **Google Sheets API**.
2. Create a **service account** and download its JSON key.
3. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
   (keep the literal `\n` escapes), locally and in Railway.
4. **Share each store's sheet with the service account address as Editor** —
   without this the write fails with a permission error.
5. Paste each sheet's ID (from its URL) into **Settings → Google Sheets** for
   that store. A store with no Sheet ID is skipped.

The schedule is set on the Railway cron service (`0 21 * * *` — 21:00 UTC
nightly, i.e. 00:00 in Bahrain). It deliberately lands ahead of the Apps Script
archive, which runs Sunday 02:00–03:00 (+3), so each weekly archive captures a
copy that is hours old rather than a week old.

To run it from a terminal (admins can also use the **Sheets** page):

```bash
npm run cron:sheet-sync
```

## Deploying to Railway

The app runs as one long-running web service plus one Railway service per cron
job, all built from this repo.

1. Push the repo to GitHub and create a Railway project from it. `railway.json`
   sets the builder (Nixpacks) and start command (`npm start`).
2. Add all environment variables from `.env.example` in the service's
   **Variables** tab. Don't set `PORT` — Railway provides it and `next start`
   picks it up.
3. Ensure `db:deploy` has been run against the production Neon database
   (manually, or as a release step) before the first deploy of any new
   migration.
4. Keep the deploy region next to the database: Neon is in `eu-west-2`
   (London), so pick Railway's **EU West** region. A scan's round trips then
   cost ~2ms rather than crossing an ocean; moving one without the other would
   slow every scan and lengthen the per-store lock it holds.
5. Point the Meta webhook at `https://<your-domain>/api/webhook` (Meta
   Developer Console → WhatsApp → Configuration; same verify token).

Cron jobs are separate Railway services on the same repo and the same
variables, each with a start command and a **cron schedule** in its settings
(the service runs to completion and exits):

| Service           | Start command             | Schedule     | Bahrain time |
| ----------------- | ------------------------- | ------------ | ------------ |
| `cron-sheet-sync` | `npm run cron:sheet-sync` | `0 21 * * *` | 00:00        |
| `cron-retry`      | `npm run cron:retry`      | `0 7 * * *`  | 10:00        |

The retry job is **deliberately daily** (mid-morning Bahrain): retried
WhatsApp confirmations must never arrive at night, and a message is attempted
at most once per day, five days, then marked failed. The sheet-sync job writes
the mirror **and** failover sheets in one run — the ordering is load-bearing,
so they are not separate services.

## Roadmap

This bootstrap covers project setup, database schema/migrations, and auth. The
scanner flow, WhatsApp (Meta Cloud API) integration, webhook handler, Google
Sheets dual-write, role enforcement, and admin pages are built on top of this
foundation — see `PROJECT_BRIEF.md` for the full feature spec and build order.
