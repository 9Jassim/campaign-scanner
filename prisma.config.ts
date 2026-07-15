import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Load .env.local (Next.js convention) before reading connection strings.
config({ path: '.env.local' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // DIRECT_URL is preferred for migrations (unpooled); falls back to DATABASE_URL.
    url: env('DIRECT_URL') ?? env('DATABASE_URL'),
  },
});
