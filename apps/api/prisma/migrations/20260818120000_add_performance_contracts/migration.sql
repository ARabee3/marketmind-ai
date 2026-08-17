-- Performance v1: Facebook-only recoverable collection windows and immutable
-- normalized metric snapshots. No provider calls or queue workers are added.

CREATE TABLE "performance_sync_windows" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "publishing_result_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'facebook',
    "window" VARCHAR(3) NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "lease_owner" VARCHAR(128),
    "lease_expires_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_sync_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "performance_sync_windows_provider_check" CHECK ("provider" = 'facebook'),
    CONSTRAINT "performance_sync_windows_window_check" CHECK ("window" IN ('24h', '72h', '7d')),
    CONSTRAINT "performance_sync_windows_state_check" CHECK ("state" IN ('queued', 'leased', 'succeeded', 'retryable', 'terminal')),
    CONSTRAINT "performance_sync_windows_attempt_count_check" CHECK ("attempt_count" >= 0),
    CONSTRAINT "performance_sync_windows_error_code_check" CHECK (
      "last_error_code" IS NULL OR "last_error_code" IN (
        'PERFORMANCE_NOT_ELIGIBLE',
        'PERFORMANCE_PERMISSION_REQUIRED',
        'PERFORMANCE_PROVIDER_RATE_LIMITED',
        'PERFORMANCE_PROVIDER_UNAVAILABLE',
        'PERFORMANCE_INVALID_PROVIDER_DATA',
        'PERFORMANCE_SNAPSHOT_CONFLICT',
        'PERFORMANCE_SYNC_WINDOW_CONFLICT',
        'PERFORMANCE_SNAPSHOT_IMMUTABLE',
        'PERFORMANCE_SYNC_TERMINAL'
      )
    )
);

CREATE TABLE "metric_snapshots" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "publishing_result_id" UUID NOT NULL,
    "publishing_attempt_id" UUID NOT NULL,
    "publishing_intent_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "candidate_checksum" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'facebook',
    "provider_object_id" TEXT NOT NULL,
    "window" VARCHAR(3) NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "observed_at" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "graph_version" VARCHAR(32) NOT NULL,
    "metric_schema_version" VARCHAR(64) NOT NULL DEFAULT 'facebook-insights-v1',
    "metrics" JSONB NOT NULL,
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "metric_snapshots_provider_check" CHECK ("provider" = 'facebook'),
    CONSTRAINT "metric_snapshots_window_check" CHECK ("window" IN ('24h', '72h', '7d')),
    CONSTRAINT "metric_snapshots_schema_check" CHECK ("metric_schema_version" = 'facebook-insights-v1'),
    CONSTRAINT "metric_snapshots_metrics_object_check" CHECK (jsonb_typeof("metrics") = 'object'),
    CONSTRAINT "metric_snapshots_provider_metadata_object_check" CHECK (jsonb_typeof("provider_metadata") = 'object')
);

CREATE UNIQUE INDEX "performance_sync_windows_publishing_result_id_window_key"
    ON "performance_sync_windows"("publishing_result_id", "window");
CREATE INDEX "performance_sync_windows_business_id_state_due_at_idx"
    ON "performance_sync_windows"("business_id", "state", "due_at");
CREATE INDEX "performance_sync_windows_state_next_attempt_at_idx"
    ON "performance_sync_windows"("state", "next_attempt_at");
CREATE INDEX "performance_sync_windows_lease_expires_at_idx"
    ON "performance_sync_windows"("lease_expires_at");
CREATE INDEX "performance_sync_windows_publishing_result_id_idx"
    ON "performance_sync_windows"("publishing_result_id");

CREATE UNIQUE INDEX "metric_snapshots_publishing_result_id_window_key"
    ON "metric_snapshots"("publishing_result_id", "window");
CREATE INDEX "metric_snapshots_business_id_published_at_idx"
    ON "metric_snapshots"("business_id", "published_at");
CREATE INDEX "metric_snapshots_business_id_window_fetched_at_idx"
    ON "metric_snapshots"("business_id", "window", "fetched_at");
CREATE INDEX "metric_snapshots_candidate_id_published_at_idx"
    ON "metric_snapshots"("candidate_id", "published_at");
CREATE INDEX "metric_snapshots_publishing_intent_id_idx"
    ON "metric_snapshots"("publishing_intent_id");
CREATE INDEX "metric_snapshots_publishing_attempt_id_idx"
    ON "metric_snapshots"("publishing_attempt_id");

ALTER TABLE "performance_sync_windows"
    ADD CONSTRAINT "performance_sync_windows_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_sync_windows"
    ADD CONSTRAINT "performance_sync_windows_publishing_result_id_fkey"
    FOREIGN KEY ("publishing_result_id") REFERENCES "publishing_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "metric_snapshots"
    ADD CONSTRAINT "metric_snapshots_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_snapshots"
    ADD CONSTRAINT "metric_snapshots_publishing_result_id_fkey"
    FOREIGN KEY ("publishing_result_id") REFERENCES "publishing_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_snapshots"
    ADD CONSTRAINT "metric_snapshots_publishing_attempt_id_fkey"
    FOREIGN KEY ("publishing_attempt_id") REFERENCES "publishing_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_snapshots"
    ADD CONSTRAINT "metric_snapshots_publishing_intent_id_fkey"
    FOREIGN KEY ("publishing_intent_id") REFERENCES "publishing_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_snapshots"
    ADD CONSTRAINT "metric_snapshots_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "publishing_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Metric snapshots are historical evidence. Application code has no update or
-- delete path, and this database trigger is the final backstop against a
-- mutable replay overwriting previously observed data.
CREATE OR REPLACE FUNCTION "prevent_metric_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'metric_snapshots are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "metric_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "metric_snapshots"
FOR EACH ROW EXECUTE FUNCTION "prevent_metric_snapshot_mutation"();
