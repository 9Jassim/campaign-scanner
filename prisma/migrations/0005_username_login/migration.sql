-- Staff sign in with a username instead of an email: till workers rarely have
-- a work email, and the email becomes optional contact detail.

-- Add nullable first, backfill, and only then enforce NOT NULL — adding a
-- NOT NULL column to a table with rows in it would fail outright.
ALTER TABLE "user_profiles" ADD COLUMN "username" TEXT;

-- Existing accounts take the local part of their email (admin@morslon.com ->
-- admin). lower() and the character strip keep it a usable login; the unique
-- index below is the guard if two addresses ever collapse to the same name.
UPDATE "user_profiles"
SET "username" = regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._-]', '', 'g')
WHERE "username" IS NULL;

-- Anything that stripped down to nothing falls back to a stable, unique value.
UPDATE "user_profiles"
SET "username" = 'user_' || substr("id", 1, 8)
WHERE "username" IS NULL OR "username" = '';

ALTER TABLE "user_profiles" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "user_profiles_username_key" ON "user_profiles"("username");

-- Email is now optional. Its unique index stays: Postgres allows many NULLs in
-- a unique index, so accounts without an email do not collide.
ALTER TABLE "user_profiles" ALTER COLUMN "email" DROP NOT NULL;

-- Receipts record who rang the sale up. Rename rather than drop so the existing
-- rows keep their attribution.
ALTER TABLE "receipts" RENAME COLUMN "cashier_email" TO "cashier_username";
