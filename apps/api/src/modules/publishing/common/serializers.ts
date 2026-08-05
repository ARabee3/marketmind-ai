import type {
  PublicationAttemptV1,
  PublicationResultV1,
} from "@marketmind/contracts";

/** Maps a stored `publishing_attempts` row to the frozen
 *  `PublicationAttemptV1` shape the contract validator binds against. The DB
 *  `DISPATCHING`/`RUNNING` statuses both project to the frozen `running`
 *  state (the runner is in flight, awaiting a callback). */
export function toPublicationAttemptV1(attempt: {
  id: string;
  intentId: string;
  intentVersion: number;
  attemptSequence: number;
  status: string;
  workflowVersion: string | null;
  providerRequestFingerprint: string | null;
  idempotencyKey: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): PublicationAttemptV1 {
  return {
    contract_version: "publication-attempt-v1",
    attempt_id: attempt.id,
    intent_id: attempt.intentId,
    intent_version: attempt.intentVersion,
    attempt_number: attempt.attemptSequence,
    idempotency_key: attempt.idempotencyKey,
    workflow_version: attempt.workflowVersion ?? "",
    request_fingerprint: attempt.providerRequestFingerprint ?? "",
    state: toFrozenAttemptState(attempt.status),
    started_at: attempt.startedAt ? attempt.startedAt.toISOString() : null,
    finished_at: attempt.finishedAt ? attempt.finishedAt.toISOString() : null,
    created_at: attempt.createdAt.toISOString(),
  };
}

export function toFrozenAttemptState(
  dbStatus: string,
): PublicationAttemptV1["state"] {
  switch (dbStatus) {
    case "QUEUED":
      return "queued";
    case "RUNNING":
    case "DISPATCHING":
      return "running";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "UNKNOWN":
      return "unknown";
    case "CANCELLED":
      return "cancelled";
    default:
      return "queued";
  }
}

/** Maps a stored `publishing_results` row + its attempt context to the frozen
 *  `PublicationResultV1` union. The result row does not denormalize `mode` or
 *  `simulation_reference_id`; both are derived (the reference is the stable
 *  attempt-derived identifier). The only provider in the system is Meta, and
 *  the DB stores it as configured ("META"). */
export function toPublicationResultV1(
  result: {
    id: string;
    attemptId: string;
    intentId: string;
    outcome: string;
    provider: string | null;
    remotePublicationId: string | null;
    remoteUrl: string | null;
    exportArtifactId: string | null;
    simulationLabel: string | null;
    errorCode: string | null;
    retryable: boolean;
    occurredAt: Date;
  },
  attempt: { intentVersion: number },
): PublicationResultV1 {
  const base = {
    contract_version: "publication-result-v1" as const,
    result_id: result.id,
    attempt_id: result.attemptId,
    intent_id: result.intentId,
    intent_version: attempt.intentVersion,
    occurred_at: result.occurredAt.toISOString(),
  };
  const mode = result.simulationLabel ? "simulation" : "real";
  const simulationLabel = result.simulationLabel as "SIMULATION" | null;

  switch (result.outcome) {
    case "PUBLISHED":
      return {
        ...base,
        mode: "real",
        outcome: "published",
        provider: "meta",
        remote_publication_id: result.remotePublicationId ?? "",
        remote_url: result.remoteUrl,
        export_artifact_id: null,
        simulation_reference_id: null,
        simulation_label: null,
        error_code: null,
        retryable: false,
        reconciliation_required: false,
      };
    case "EXPORTED":
      return {
        ...base,
        mode: "manual_export",
        outcome: "exported",
        provider: null,
        remote_publication_id: null,
        remote_url: null,
        export_artifact_id: result.exportArtifactId ?? result.id,
        simulation_reference_id: null,
        simulation_label: null,
        error_code: null,
        retryable: false,
        reconciliation_required: false,
      };
    case "SIMULATED":
      return {
        ...base,
        mode: "simulation",
        outcome: "simulated",
        provider: null,
        remote_publication_id: null,
        remote_url: null,
        export_artifact_id: null,
        simulation_reference_id: `simulation:${result.attemptId}`,
        simulation_label: "SIMULATION",
        error_code: null,
        retryable: false,
        reconciliation_required: false,
      };
    case "UNKNOWN":
      return {
        ...base,
        mode: "real",
        outcome: "unknown",
        provider: "meta",
        remote_publication_id: null,
        remote_url: null,
        export_artifact_id: null,
        simulation_reference_id: null,
        simulation_label: null,
        error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
        retryable: false,
        reconciliation_required: true,
      };
    case "CANCELLED":
      return {
        ...base,
        mode,
        outcome: "cancelled",
        provider: null,
        remote_publication_id: null,
        remote_url: null,
        export_artifact_id: null,
        simulation_reference_id: null,
        simulation_label: simulationLabel,
        error_code: null,
        retryable: false,
        reconciliation_required: false,
      };
    case "FAILED":
    default:
      return {
        ...base,
        mode,
        outcome: "failed",
        provider: result.provider ? "meta" : null,
        remote_publication_id: null,
        remote_url: null,
        export_artifact_id: null,
        simulation_reference_id: null,
        simulation_label: simulationLabel,
        error_code: (result.errorCode ??
          "PUBLISHING_DISPATCH_FAILED") as Exclude<
          PublicationResultV1["error_code"],
          "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN"
        >,
        retryable: result.retryable,
        reconciliation_required: false,
      };
  }
}
