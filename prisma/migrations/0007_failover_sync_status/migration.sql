-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "last_failover_sync_at" TIMESTAMP(3),
ADD COLUMN     "last_failover_sync_detail" TEXT,
ADD COLUMN     "last_failover_sync_status" TEXT;
