-- Issue #135: strategy-v2 briefs replace the free-text team_capacity with the
-- plain-language weekly_capacity preset. Legacy strategy-v1 briefs always set
-- team_capacity; v2 briefs leave it null. Drop the NOT NULL constraint so v2
-- brief persistence does not fail on the legacy column.

ALTER TABLE "strategy_briefs" ALTER COLUMN "team_capacity" DROP NOT NULL;
