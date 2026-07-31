import type {
  IsoDateTime,
  PublishingMode,
  PublicationIntentState,
  UUID,
} from "./publishing-types";
import { computePublishingSha256 } from "./publishing-canonical";

export type PublishingTargetV1 = {
  readonly contract_version: "publishing-target-v1";
  readonly target_id: UUID;
  readonly version: number;
  readonly business_id: UUID;
  readonly provider: "meta";
  readonly channel: "facebook" | "instagram";
  readonly external_account_id: string;
  readonly display_name: string;
  readonly connection_state: "connected" | "expired" | "revoked" | "error";
  readonly credential_ref: string;
  readonly capabilities: readonly ["static_image"];
  readonly last_verified_at: IsoDateTime | null;
};

export type PublishingTargetPublicV1 = Omit<
  PublishingTargetV1,
  "credential_ref"
>;

export type PublicationIntentV1 = {
  readonly contract_version: "publication-intent-v1";
  readonly intent_id: UUID;
  readonly version: number;
  readonly business_id: UUID;
  readonly candidate_id: UUID;
  readonly candidate_checksum: string;
  readonly mode: PublishingMode;
  readonly target_id: UUID | null;
  readonly scheduled_local: string | null;
  readonly time_zone: "Africa/Cairo" | null;
  readonly scheduled_utc: IsoDateTime | null;
  readonly state: PublicationIntentState;
  readonly approved_decision_id: UUID | null;
  readonly created_by_user_id: UUID;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export type PublicationApprovalSnapshotV1 = {
  readonly contract_version: "publication-approval-v1";
  readonly decision_id: UUID;
  readonly intent_id: UUID;
  readonly intent_version: number;
  readonly candidate_id: UUID;
  readonly candidate_checksum: string;
  readonly mode: "real";
  readonly target_id: UUID;
  readonly scheduled_local: string;
  readonly time_zone: "Africa/Cairo";
  readonly scheduled_utc: IsoDateTime;
  readonly decided_by_user_id: UUID;
  readonly decided_at: IsoDateTime;
  readonly approval_fingerprint: string;
};

export type PublicationApprovalFingerprintInput = Omit<
  PublicationApprovalSnapshotV1,
  "approval_fingerprint"
>;

export function computePublicationApprovalFingerprint(
  approval: PublicationApprovalFingerprintInput,
): string {
  return computePublishingSha256(approval);
}

export function isPublicationApprovalFingerprintValid(
  approval: PublicationApprovalSnapshotV1,
): boolean {
  const { approval_fingerprint: _excluded, ...payload } = approval;
  return (
    computePublicationApprovalFingerprint(payload) ===
    approval.approval_fingerprint
  );
}

export const PUBLICATION_INTENT_ALLOWED_TRANSITIONS: Record<
  PublicationIntentState,
  readonly PublicationIntentState[]
> = {
  draft: ["awaiting_approval", "dispatching", "cancelled"],
  awaiting_approval: ["scheduled", "cancelled"],
  scheduled: ["awaiting_approval", "dispatching", "cancelled"],
  dispatching: ["succeeded", "failed", "action_required"],
  succeeded: [],
  failed: ["dispatching", "cancelled"],
  action_required: ["dispatching", "cancelled"],
  cancelled: [],
};

export function canTransitionPublicationIntent(
  from: PublicationIntentState,
  to: PublicationIntentState,
): boolean {
  return PUBLICATION_INTENT_ALLOWED_TRANSITIONS[from].includes(to);
}

export type CreatePublicationIntentRequestV1 = {
  readonly contract_version: "publishing-v1";
  readonly candidate_id: UUID;
  readonly candidate_checksum: string;
  readonly mode: PublishingMode;
  readonly idempotency_key: string;
};

export type UpdatePublicationScheduleRequestV1 = {
  readonly contract_version: "publishing-v1";
  readonly expected_intent_version: number;
  readonly target_id: UUID;
  readonly scheduled_local: string;
  readonly time_zone: "Africa/Cairo";
  readonly scheduled_utc: IsoDateTime;
  readonly idempotency_key: string;
};

export type ApprovePublicationIntentRequestV1 = {
  readonly contract_version: "publishing-v1";
  readonly expected_intent_version: number;
  readonly candidate_id: UUID;
  readonly candidate_checksum: string;
  readonly mode: "real";
  readonly target_id: UUID;
  readonly scheduled_local: string;
  readonly time_zone: "Africa/Cairo";
  readonly scheduled_utc: IsoDateTime;
  readonly idempotency_key: string;
};

export type CancelPublicationIntentRequestV1 = {
  readonly contract_version: "publishing-v1";
  readonly expected_intent_version: number;
  readonly reason: string;
  readonly idempotency_key: string;
};

export type RetryPublicationIntentRequestV1 = {
  readonly contract_version: "publishing-v1";
  readonly expected_intent_version: number;
  readonly expected_last_attempt_number: number;
  readonly idempotency_key: string;
};
