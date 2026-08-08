-- Issue #135: owner-first strategy-v2 contract.
-- New strategies default to v2; legacy rows keep strategy-v1 so they are never
-- reinterpreted. The brief gains v2-only fields (channel choices, weekly
-- capacity preset); v1 fields stay intact for legacy briefs.

ALTER TABLE "strategies" ADD COLUMN "contract_version" TEXT NOT NULL DEFAULT 'strategy-v1';

ALTER TABLE "strategy_briefs" ADD COLUMN "weekly_capacity" TEXT;
ALTER TABLE "strategy_briefs" ADD COLUMN "weekly_capacity_note" TEXT;
ALTER TABLE "strategy_briefs" ADD COLUMN "channel_choices" JSONB;
