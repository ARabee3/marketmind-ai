-- Content v2 is the only active cycle creation contract.
-- Existing content-v1 rows are intentionally preserved as historical data.
ALTER TABLE "content_cycles"
  ALTER COLUMN "contract_version" SET DEFAULT 'content-v2';
