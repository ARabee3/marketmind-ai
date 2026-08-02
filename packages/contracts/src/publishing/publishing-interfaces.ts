import type {
  PublicationCandidateCreatedEventV1,
  PublicationCandidateStateChangedEventV1,
  PublicationCandidateStatusV1,
  PublicationCandidateV1,
} from "../content/publication-candidate";
import type {
  ApprovePublicationIntentRequestV1,
  CancelPublicationIntentRequestV1,
  CreatePublicationIntentRequestV1,
  PublicationApprovalSnapshotV1,
  PublicationIntentV1,
  PublishingTargetPublicV1,
  RetryPublicationIntentRequestV1,
  UpdatePublicationScheduleRequestV1,
} from "./publication-intent";
import type {
  PublicationAttemptV1,
  PublicationResultV1,
} from "./publication-result";
import type {
  IsoDateTime,
  PublishingMode,
  PublicationIntentState,
  UUID,
} from "./publishing-types";

export type PublicationCandidateRecordV1 = {
  readonly contract_version: "publishing-candidate-record-v1";
  readonly candidate_id: UUID;
  readonly event_id: UUID;
  readonly business_id: UUID;
  readonly candidate_checksum: string;
  readonly event_fingerprint: string;
  readonly source_state: "active" | "revoked" | "replaced";
  readonly source_state_version: number;
  readonly source_status: PublicationCandidateStatusV1;
  readonly received_at: IsoDateTime;
  readonly payload: PublicationCandidateCreatedEventV1["payload"];
};

export type IngestPublicationCandidateEventRequestV1 =
  | PublicationCandidateCreatedEventV1
  | PublicationCandidateStateChangedEventV1;

export type PublicationCandidateSummaryV1 = {
  readonly candidate: PublicationCandidateV1;
  readonly source_state: "active" | "revoked" | "replaced";
  readonly source_state_version: number;
  readonly active_intent_id: UUID | null;
  readonly received_at: IsoDateTime;
};

export type PublicationCandidateListResponseV1 = {
  readonly candidates: readonly PublicationCandidateSummaryV1[];
};

export type PublicationCandidateDetailResponseV1 =
  PublicationCandidateSummaryV1;

export type ConnectMetaPublishingTargetRequestV1 = {
  readonly contract_version: "publishing-v1";
  readonly channel: "facebook" | "instagram";
  readonly return_url: string;
  readonly idempotency_key: string;
};

export type ConnectMetaPublishingTargetResponseV1 = {
  readonly connection_id: UUID;
  readonly authorization_url: string;
  readonly expires_at: IsoDateTime;
};

export type VerifyPublishingTargetRequestV1 = {
  readonly contract_version: "publishing-v1";
  readonly expected_target_version: number;
  readonly idempotency_key: string;
};

export type DisconnectPublishingTargetRequestV1 =
  VerifyPublishingTargetRequestV1;

export type PublishingTargetListResponseV1 = {
  readonly targets: readonly PublishingTargetPublicV1[];
};

export type PublishingTargetMutationResponseV1 = {
  readonly target: PublishingTargetPublicV1;
};

export type CreatePublicationIntentResponseV1 = {
  readonly publication_intent: PublicationIntentV1;
};

export type UpdatePublicationScheduleResponseV1 = {
  readonly publication_intent: PublicationIntentV1;
  readonly invalidated_approval_decision_id: UUID | null;
  readonly replaced_job_key: string | null;
};

export type ApprovePublicationIntentResponseV1 = {
  readonly publication_intent: PublicationIntentV1;
  readonly approval: PublicationApprovalSnapshotV1;
  readonly delayed_job_key: string;
};

export type CancelPublicationIntentResponseV1 = {
  readonly publication_intent: PublicationIntentV1;
  readonly cancelled_job_key: string | null;
};

export type RetryPublicationIntentResponseV1 = {
  readonly publication_intent: PublicationIntentV1;
  readonly attempt: PublicationAttemptV1;
};

export type PublicationIntentDetailResponseV1 = {
  readonly publication_intent: PublicationIntentV1;
  readonly approval: PublicationApprovalSnapshotV1 | null;
  readonly target: PublishingTargetPublicV1 | null;
  readonly attempts: readonly PublicationAttemptV1[];
  readonly results: readonly PublicationResultV1[];
};

export type PublicationIntentListQueryV1 = {
  readonly state?: PublicationIntentState;
  readonly mode?: PublishingMode;
  readonly candidate_id?: UUID;
};

export type PublicationIntentListResponseV1 = {
  readonly publication_intents: readonly PublicationIntentV1[];
};

export type PublicationAttemptListResponseV1 = {
  readonly attempts: readonly PublicationAttemptV1[];
  readonly results: readonly PublicationResultV1[];
};

export type PublicationExportManifestV1 = {
  readonly contract_version: "publication-export-manifest-v1";
  readonly artifact_id: UUID;
  readonly candidate_id: UUID;
  readonly candidate_checksum: string;
  readonly content_item_id: UUID;
  readonly content_item_version_id: UUID;
  readonly content_item_version: number;
  readonly target_channel: "facebook" | "instagram";
  readonly content_format:
    | "static_image_post"
    | "short_video_script"
    | "carousel_brief"
    | "text_post";
  readonly selected_locale: "ar" | "en";
  readonly generated_at: IsoDateTime;
  readonly label: "EXPORTED_NOT_PUBLISHED";
  readonly assets: readonly {
    readonly asset_id: UUID;
    readonly checksum: string;
    readonly archive_path: string;
  }[];
};

export type PublicationExportResponseV1 = {
  readonly artifact_id: UUID;
  readonly manifest: PublicationExportManifestV1;
  readonly download_url: string;
  readonly download_expires_at: IsoDateTime;
};

export type InternalPublishingAssetResponseV1 = {
  readonly asset_id: UUID;
  readonly checksum: string;
  readonly mime_type: string;
  readonly retrieval_url: string;
  readonly retrieval_expires_at: IsoDateTime;
};

export type PublicationIntentMutationRequestV1 =
  | CreatePublicationIntentRequestV1
  | UpdatePublicationScheduleRequestV1
  | ApprovePublicationIntentRequestV1
  | CancelPublicationIntentRequestV1
  | RetryPublicationIntentRequestV1;
