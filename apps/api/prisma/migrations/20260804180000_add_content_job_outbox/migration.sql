CREATE TABLE "content_job_outbox" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_job_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_job_outbox_job_id_key"
  ON "content_job_outbox"("job_id");
CREATE INDEX "content_job_outbox_state_next_attempt_at_idx"
  ON "content_job_outbox"("state", "next_attempt_at");
CREATE INDEX "content_job_outbox_lease_expires_at_idx"
  ON "content_job_outbox"("lease_expires_at");
