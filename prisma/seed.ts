/**
 * Seed script: creates the two campaign stores, and optionally seeds an admin
 * user (with a hashed password) assigned to both.
 *
 * Usage:
 *   npm run db:seed
 *
 * To also seed an admin you can log in with, set these env vars (in .env.local
 * or inline):
 *
 *   SEED_ADMIN_EMAIL=you@example.com
 *   SEED_ADMIN_PASSWORD=some-strong-password
 *   SEED_ADMIN_NAME="Your Name"   # optional
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import bcrypt from 'bcryptjs';

config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaNeon({ connectionString });
const db = new PrismaClient({ adapter });

const STORES = [
  {
    slug: 'morslon',
    nameEn: 'Morslon Electronics',
    nameAr: 'مرسلون للإلكترونيات',
    bdPerEntry: '10',
  },
  {
    slug: 'modern-sources',
    nameEn: 'Modern Sources',
    nameAr: 'مصادر حديثة',
    bdPerEntry: '10',
  },
];

async function main() {
  const stores = [];
  for (const s of STORES) {
    const store = await db.store.upsert({
      where: { slug: s.slug },
      create: {
        slug: s.slug,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        bdPerEntry: s.bdPerEntry,
      },
      update: { nameEn: s.nameEn, nameAr: s.nameAr },
    });
    stores.push(store);
    console.log(`✔ Store ready: ${store.nameEn} (${store.slug})`);
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.toLowerCase().trim();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const admin = await db.userProfile.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        fullName: process.env.SEED_ADMIN_NAME ?? null,
        passwordHash,
        role: 'admin',
      },
      update: { passwordHash, role: 'admin' },
    });
    console.log(`✔ Admin ready: ${admin.email} (${admin.id})`);

    // Admins can access all stores implicitly, but we still record explicit
    // assignments so they show up in store-scoped listings.
    for (const store of stores) {
      await db.storeUser.upsert({
        where: { storeId_userId: { storeId: store.id, userId: admin.id } },
        create: { storeId: store.id, userId: admin.id },
        update: {},
      });
    }
    console.log('✔ Admin assigned to all stores');
  } else {
    console.log(
      '\nℹ No admin seeded. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to seed an admin login.',
    );
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
