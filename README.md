# Campaign Scanner Portal

A multi-store WhatsApp campaign scanner portal for retail prize giveaways.
One instance serves multiple legally-separate stores, with all data isolated
by `store_id`.

## Tech Stack

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** Tailwind CSS v4
- **Auth:** NextAuth / Auth.js v5 (email + password credentials)
- **Database:** Neon Postgres (serverless)
- **ORM:** Prisma 7 (with the Neon driver adapter)
- **Hosting:** Vercel

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
- **`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`:** The first admin login, created
  by the seed script (see step 3a).
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

Creates the two stores and, if `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are
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
  sign-in/                Email + password sign-in form
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

## Deploying to Vercel

1. Push the repo to GitHub and import it into Vercel.
2. Add all environment variables from `.env.example` in the Vercel project
   settings.
3. Vercel runs `npm run build` — ensure `db:deploy` has been run against your
   production Neon database (either manually or as a release step).

## Roadmap

This bootstrap covers project setup, database schema/migrations, and auth. The
scanner flow, WhatsApp (Meta Cloud API) integration, webhook handler, Google
Sheets dual-write, role enforcement, and admin pages are built on top of this
foundation — see `PROJECT_BRIEF.md` for the full feature spec and build order.
