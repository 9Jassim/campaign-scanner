-- Speeds up the top-customers query (ORDER BY total_entries within a store).
-- The receipts (store_id, created_at) index the analytics range queries use
-- already exists as idx_receipts_store_created.
CREATE INDEX IF NOT EXISTS "idx_contacts_store_entries"
  ON "contacts" ("store_id", "total_entries" DESC);
