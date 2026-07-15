import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load .env.local (Next.js convention) for local development. In hosted
// environments (e.g. Vercel) there is no .env.local and the vars come from the
// platform, so a missing file here is expected and harmless.
config({ path: '.env.local' });

// Read via process.env rather than prisma's env() helper: env() THROWS on a
// missing variable, which would break `prisma generate` during a build that
// only needs codegen (and defeats the DIRECT_URL -> DATABASE_URL fallback).
// DIRECT_URL is preferred for migrations (unpooled); DATABASE_URL is the
// fallback. Empty is tolerated so `generate`, which needs no database, works.
const datasourceUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || '';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: datasourceUrl,
  },
});
