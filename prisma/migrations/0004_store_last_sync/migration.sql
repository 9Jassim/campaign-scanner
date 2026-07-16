-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "last_sync_at" TIMESTAMP(3),
ADD COLUMN     "last_sync_detail" TEXT,
ADD COLUMN     "last_sync_status" TEXT;

