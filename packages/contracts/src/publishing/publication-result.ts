import type {
  IsoDateTime,
  PublicationAttemptState,
  PublicationIntentState,
  PublicationOutcome,
  PublishingErrorCode,
  PublishingMode,
  UUID,
} from "./publishing-types";

export type PublicationAttemptV1 = {
  readonly contract_version: "publication-attempt-v1";
  readonly attempt_id: UUID;
  readonly intent_id: UUID;
  readonly intent_version: number;
  readonly attempt_number: number;
  readonly idempotency_key: string;
  readonly workflow_version: string;
  readonly request_fingerprint: string;
  readonly state: PublicationAttemptState;
  readonly started_at: IsoDateTime | null;
  readonly finished_at: IsoDateTime | null;
  readonly created_at: IsoDateTime;
};

type PublicationResultBaseV1 = {
  readonly contract_version: "publication-result-v1";
  readonly result_id: UUID;
  readonly attempt_id: UUID;
  readonly intent_id: UUID;
  readonly intent_version: number;
  readonly occurred_at: IsoDateTime;
};

export type PublicationResultV1 = PublicationResultBaseV1 &
  (
    | {
        readonly mode: "real";
        readonly outcome: "published";
        readonly provider: "meta";
        readonly remote_publication_id: string;
        readonly remote_url: string | null;
        readonly export_artifact_id: null;
        readonly simulation_reference_id: null;
        readonly simulation_label: null;
        readonly error_code: null;
        readonly retryable: false;
        readonly reconciliation_required: false;
      }
    | {
        readonly mode: "manual_export";
        readonly outcome: "exported";
        readonly provider: null;
        readonly remote_publication_id: null;
        readonly remote_url: null;
        readonly export_artifact_id: UUID;
        readonly simulation_reference_id: null;
        readonly simulation_label: null;
        readonly error_code: null;
        readonly retryable: false;
        readonly reconciliation_required: false;
      }
    | {
        readonly mode: "simulation";
        readonly outcome: "simulated";
        readonly provider: null;
        readonly remote_publication_id: null;
        readonly remote_url: null;
        readonly export_artifact_id: null;
        readonly simulation_reference_id: string;
        readonly simulation_label: "SIMULATION";
        readonly error_code: null;
        readonly retryable: false;
        readonly reconciliation_required: false;
      }
    | {
        readonly mode: PublishingMode;
        readonly outcome: "failed";
        readonly provider: "meta" | null;
        readonly remote_publication_id: null;
        readonly remote_url: null;
        readonly export_artifact_id: null;
        readonly simulation_reference_id: null;
        readonly simulation_label: "SIMULATION" | null;
        readonly error_code: Exclude<
          PublishingErrorCode,
          "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN"
        >;
        readonly retryable: boolean;
        readonly reconciliation_required: false;
      }
    | {
        readonly mode: PublishingMode;
        readonly outcome: "cancelled";
        readonly provider: null;
        readonly remote_publication_id: null;
        readonly remote_url: null;
        readonly export_artifact_id: null;
        readonly simulation_reference_id: null;
        readonly simulation_label: "SIMULATION" | null;
        readonly error_code: null;
        readonly retryable: false;
        readonly reconciliation_required: false;
      }
    | {
        readonly mode: "real";
        readonly outcome: "unknown";
        readonly provider: "meta";
        readonly remote_publication_id: null;
        readonly remote_url: null;
        readonly export_artifact_id: null;
        readonly simulation_reference_id: null;
        readonly simulation_label: null;
        readonly error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN";
        readonly retryable: false;
        readonly reconciliation_required: true;
      }
  );

export function publicationAttemptStateForOutcome(
  outcome: PublicationOutcome,
): Extract<
  PublicationAttemptState,
  "succeeded" | "failed" | "unknown" | "cancelled"
> {
  switch (outcome) {
    case "published":
    case "exported":
    case "simulated":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "unknown":
      return "unknown";
  }
}

export function publicationIntentStateForOutcome(
  outcome: PublicationOutcome,
): Extract<
  PublicationIntentState,
  "succeeded" | "failed" | "action_required" | "cancelled"
> {
  switch (outcome) {
    case "published":
    case "exported":
    case "simulated":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "unknown":
      return "action_required";
  }
}
