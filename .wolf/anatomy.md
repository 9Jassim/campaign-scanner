# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-07-16T14:50:03.088Z
> Files: 79 tracked | Anatomy hits: 0 | Misses: 0

## ../../../AppData/Local/Temp/claude/C--Users-jassi-Desktop-Projects-campaign-scanner/b16e8983-9f22-48a3-81fa-a4622be5aa24/scratchpad/

- `commitmsg.txt` (~354 tok)
- `fixmsg.txt` (~280 tok)
- `multiapp.txt` (~291 tok)

## ./

- `.eslintrc.json` (~12 tok)
- `.gitignore` — Git ignore rules (~132 tok)
- `auth.config.ts` — Edge-safe base config shared by the middleware and the full Node config. (~396 tok)
- `auth.ts` — Thrown when the email or IP is locked out. NextAuth puts `code` on the (~637 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `drizzle.config.ts` (~134 tok)
- `middleware.ts` — The middleware uses only the edge-safe config (no DB, no bcrypt). Route (~143 tok)
- `next.config.mjs` — Declares nextConfig (~33 tok)
- `package.json` — Node.js package manifest (~333 tok)
- `prisma.config.ts` — Load .env.local (Next.js convention) for local development. In hosted (~274 tok)
- `README.md` — Project documentation (~1690 tok)
- `vercel.json` (~44 tok)

## .claude/

- `launch.json` (~57 tok)
- `settings.json` (~441 tok)
- `settings.local.json` (~58 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## app/

- `globals.css` — Styles: 4 rules, 9 vars (~378 tok)
- `layout.tsx` — inter (~166 tok)
- `page.tsx` — Home (~359 tok)
- `sign-out-button.tsx` — SignOutButton — renders form (~145 tok)

## app/admin/users/

- `actions.ts` — API routes: GET (10 endpoints) (~1024 tok)
- `page.tsx` — dynamic — renders form (~3514 tok)

## app/api/auth/[...nextauth]/

- `route.ts` — Next.js API route (~22 tok)

## app/api/cron/backup/

- `route.ts` — Weekly backup: replace each store's Google Sheet with a full snapshot. (~1551 tok)

## app/api/export/

- `route.ts` — Next.js API route: GET (~1389 tok)

## app/api/scan/

- `route.ts` — 409 = already scanned; 503 = the store's lock was busy, retrying may work. (~740 tok)

## app/api/webhook/

- `route.ts` — Meta WhatsApp webhook. (~2916 tok)

## app/contacts/

- `page.tsx` — Cap invoices shown per contact — a six-month campaign can rack them up. (~2568 tok)

## app/raffle/

- `page.tsx` — dynamic — renders table (~1500 tok)

## app/receipts/

- `page.tsx` — dynamic — renders table (~2009 tok)

## app/scanner/

- `page.tsx` — dynamic (~364 tok)
- `scanner-client.tsx` — The scan is already saved at this point — this only reports what happened to (~2633 tok)

## app/settings/

- `actions.ts` — API routes: GET (1 endpoints) (~648 tok)
- `page.tsx` — A write-only secret input: never renders the stored value, only whether one (~2234 tok)

## app/sign-in/

- `page.tsx` — SignInPage (~168 tok)
- `sign-in-form.tsx` — SignInForm — renders form (~668 tok)

## app/sign-in/[[...sign-in]]/

- `page.tsx` — SignInPage (~55 tok)

## app/sign-up/[[...sign-up]]/

- `page.tsx` — SignUpPage (~55 tok)

## components/

- `app-nav.tsx` — LINKS (~590 tok)
- `auto-submit-select.tsx` — A <select> that submits its enclosing form as soon as the value changes, (~163 tok)
- `export-button.tsx` — Download link to the CSV export endpoint, carrying the current filters. (~245 tok)
- `filter-bar.tsx` — A GET-form filter bar: store selector + free-text search, plus any extra (~658 tok)
- `pagination.tsx` — URL-based pager. Keeps the current filters in the links so paging never (~718 tok)
- `sign-out-button.tsx` — SignOutButton — renders form (~145 tok)
- `status-badge.tsx` — WhatsApp message status pill. Hover shows the underlying Meta error, which (~321 tok)

## db/

- `index.ts` — Exports db (~88 tok)
- `schema.ts` — Exports stores, userProfiles, storeUsers, contacts + 5 more (~1524 tok)

## lib/

- `auth.ts` — Per-user permission overrides stored in `user_profiles.permissions` (jsonb). (~1242 tok)
- `backup.test.ts` — Declares dec (~1312 tok)
- `backup.ts` — Weekly backup snapshot for a store's Google Sheet. (~1210 tok)
- `barcode.test.ts` — Declares result (~671 tok)
- `barcode.ts` — Barcode parsing for receipt barcodes. (~673 tok)
- `crypto.test.ts` — Declares KEY (~498 tok)
- `crypto.ts` — AES-256-GCM encryption for secrets stored at rest (e.g. Meta access tokens). (~538 tok)
- `datetime.test.ts` — Bahrain time formatting: +3 offset, midnight rollover, no-DST, CSV format. Passes under any TZ. (~633 tok)
- `datetime.ts` — Renders UTC-stored timestamps in Asia/Bahrain. formatDateTime (UI), formatDateTimeCsv (export), todayInBahrain (filenames). NEVER use toLocaleString/toISOString in pages: they follow the server's zone (UTC on Vercel) and render times 3h early. (~742 tok)
- `db.ts` — Prisma 7 requires a driver adapter at runtime. We use the Neon serverless (~220 tok)
- `google-sheets.test.ts` — Declares EMAIL (~1128 tok)
- `google-sheets.ts` — Minimal Google Sheets client. (~1632 tok)
- `login-attempts.ts` — Persistence for sign-in throttling — reads and writes `login_attempts`. (~667 tok)
- `login-throttle.test.ts` — Replay `count` consecutive failures, all at T0 unless a clock is given. (~1765 tok)
- `login-throttle.ts` — Sign-in throttling policy. (~1453 tok)
- `password.test.ts` — Declares hash (~520 tok)
- `password.ts` — Password hashing and verification. (~395 tok)
- `scan.ts` — Outcome of the WhatsApp send attempt for this scan. (~3486 tok)
- `store-lock.test.ts` — Declares MORSLON (~418 tok)
- `store-lock.ts` — Per-store locking for the scan flow. (~329 tok)
- `webhook.test.ts` — Declares secret (~2007 tok)
- `webhook.ts` — Pure helpers for the Meta WhatsApp webhook. (~1389 tok)
- `whatsapp.test.ts` — Declares makeStore (~1209 tok)
- `whatsapp.ts` — WhatsApp sending via the Meta Cloud API. (~1379 tok)

## prisma/

- `schema.prisma` (~1901 tok)
- `seed.ts` — Seed script: creates the two campaign stores, and optionally seeds an admin (~809 tok)

## prisma/migrations/

- `migration_lock.toml` — Please do not edit this file manually (~35 tok)

## prisma/migrations/0000_init/

- `migration.sql` — CreateSchema (~1704 tok)

## types/

- `next-auth.d.ts` — Declares Session (~94 tok)
