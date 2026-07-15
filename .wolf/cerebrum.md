# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-07-14

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

- **ORM:** Prisma, not Drizzle. User switched away from Drizzle mid-bootstrap; use Prisma for all DB work.
- **Next.js version:** Pinned to Next 14 (with React 18) deliberately, even though `create-next-app` now defaults to Next 16. Do not "upgrade" it back.
- **Auth:** NextAuth / Auth.js v5, NOT Clerk. User switched away from Clerk; simple email+password credentials login. Accounts are admin-created (seed script), no public sign-up.

## Key Learnings

- **Project:** campaign-scanner — multi-store WhatsApp campaign scanner. Data isolated by `store_id`. Full spec in `PROJECT_BRIEF.md`.
- **Prisma 7 config:** Connection URLs live in `prisma.config.ts` (via `defineConfig` + `env()` from `prisma/config`), NOT in `schema.prisma`'s datasource block (`url`/`directUrl` were removed). Runtime `PrismaClient` requires a driver adapter — we use `@prisma/adapter-neon` in `lib/db.ts`.
- **Prisma 7 CLI:** `migrate diff` flag `--to-schema-datamodel` was renamed to `--to-schema`. The dotenv banner leaks to stdout, so redirecting `migrate diff --script > file.sql` pollutes line 1 — strip it.
- **Migrations offline:** Generated the initial migration without a live DB using `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`, plus a hand-written `migration_lock.toml`. Pipe through `grep -v '◇ injected env'` to strip the dotenv banner from stdout.
- **NextAuth v5 structure:** Split config into `auth.config.ts` (edge-safe, no DB/bcrypt, has the `authorized` route-protection callback) used by `middleware.ts`, and `auth.ts` (Node runtime, Credentials provider with Prisma+bcrypt). Credentials login requires `session.strategy: 'jwt'` (no DB sessions). Middleware matcher MUST exclude `/api/auth` or login POSTs get redirected. `user_profiles` gained `password_hash` + unique `email` + `@default(cuid())` id.
- **Portal pages pattern:** List pages (`/contacts`, `/receipts`, `/raffle`) are server components gated by `requireManager()` (cashiers → `/scanner`); `/admin/*` uses `requireAdmin()`. Store scoping via `resolveStoreScope(profile, searchParams.storeId)` → `{ stores, selectedStoreId, scopeIds }`; every query filters `storeId: { in: scopeIds }`. Filters use a GET `<form>` (state in URL, stays server-rendered). Settings + admin-users mutate via co-located `'use server'` action files that redirect back with `?saved=1`/`?error=`. Store assignment = `store_users` rows, edited via checkboxes in `/admin/users`. Meta access token encrypted with `lib/crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY` base64 32 bytes).
- **Verified end-to-end (browser + live Neon):** login → scan (SI-100008 → 4 entries) → data appears in receipts/raffle → store filter isolates → created a cashier scoped to one store. All green.
- **Per-store list pages:** Contacts/Receipts/Raffle show ONE store at a time (no combined view). `resolveActiveStore(profile, storeId)` defaults to first accessible store; `FilterBar allowAllStores={false}` hides the "All stores" option. Store name shown in the page heading.
- **Auto-submit dropdowns:** `components/auto-submit-select.tsx` (client) calls `form.requestSubmit()` on change — used for store filter, receipts status filter, settings store switcher. Text search still uses Apply/Enter.
- **WhatsApp send:** `lib/whatsapp.ts` — `hasWhatsAppCredentials(store)`, pure `buildTemplatePayload(store, params)` (exported so the 12 positional vars are unit-testable; Meta matches {{1}}..{{12}} by ARRAY ORDER, so order is load-bearing), and `sendWhatsApp()` which never throws (returns `{wamid|error|rateLimited|skipped}`). Token decrypted per-call from `stores.metaAccessTokenEncrypted`. `to` must be digits-only (no `+`). 15s timeout via `AbortSignal.timeout`. Rate limit = HTTP 429 or codes {4, 80007, 130429, 131048, 131056} → receipt stays `pending` + row added to `retry_queue` (retry cron itself NOT built yet). In `lib/scan.ts`, the send happens AFTER the Serializable txn commits (never hold a txn open across a network call, never fail a committed scan); receipt starts `pending` (or `skipped` with no creds) then updates to sent/failed/pending.
- **Webhook (`/api/webhook`, public — excluded from auth in auth.config.ts):** GET echoes `hub.challenge` as text/plain when `hub.verify_token` === `WEBHOOK_VERIFY_TOKEN`, else 403. POST reads the RAW body first (signature is over exact bytes), optionally verifies `X-Hub-Signature-256` when `META_APP_SECRET` is set. Status logic lives in pure `lib/webhook.ts` `resolveStatusUpdate(current, event)`: MONOTONIC ranking (skipped/pending 0 < sent 1 < delivered 2 < read 3) so out-of-order Meta events never regress; `failed` always applies with formatted error; returns null = no-op (duplicate/stale). Statuses match receipts by `wamid`; inbound messages dedupe on wamid and resolve store via `metadata.phone_number_id` → `stores.metaPhoneNumberId`. Returns 500 on unexpected errors so Meta retries (writes are idempotent), 200 on malformed JSON (retry would never help).
- **Permissions + export:** Roles unchanged (admin = full control per user's call). Per-user `permissions` jsonb on `user_profiles` (migration `0001_add_permissions`, hand-written since Prisma 7 `migrate diff --from-migrations` needs a shadow DB). `canExport(profile)` in lib/auth (admin always true; others need `permissions.canExport`). Admin user form has a "Can export" checkbox. CSV export via `/api/export?type=contacts|receipts|raffle&storeId=&q=&status=` (honors filters + store scope, gated by canExport, UTF-8 BOM for Arabic). Export button on the 3 list pages, shown only when canExport.

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

- [2026-07-14] `create-next-app` defaults to Next 16 + React 19. After pinning to Next 14, three scaffold leftovers break the build: `next.config.ts` (Next 14 needs `.mjs`/`.js`), the flat `eslint.config.mjs` (use `.eslintrc.json` + eslint 8 + eslint-config-next 14), and `Geist`/`Geist_Mono` fonts in `layout.tsx` (not in Next 14's `next/font/google` — use `Inter`).
- [2026-07-14] Browser automation on the scanner: the barcode input is React-controlled, so `form_input` sets the DOM value WITHOUT firing React's onChange — state stays empty and parsing/submit no-ops. Use the `type` action (real keystrokes) after clicking, and reset via the app's own "Clear" button, not `form_input`. Also: the key action name is `Enter` (not `Return`) to trigger onKeyDown. Uncontrolled server-action forms (admin users) are fine with `form_input`.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->

- [2026-07-14] Pinned Next.js to 14 (React 18) per explicit user request, despite `create-next-app` defaulting to 16. Drove Clerk down to v6 (last line supporting Next 14).
- [2026-07-14] Switched ORM from Drizzle to Prisma at user request. Prisma 7 uses the Neon driver adapter (`@prisma/adapter-neon`) for serverless-friendly connections on Vercel.
