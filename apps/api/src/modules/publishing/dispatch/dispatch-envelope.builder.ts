import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import {
  computePublicationApprovalFingerprint,
  computeDispatchRequestFingerprint,
  publicationOperationForMode,
  signPublicationDispatchEnvelope,
  type PublicationApprovalSnapshotV1,
  type PublicationCandidateStatusV1,
  type PublicationCandidateV1,
  type PublicationDispatchAssetV1,
  type PublicationDispatchBodyV1,
  type PublishingTargetV1,
  type SignedPublicationDispatchEnvelopeV1,
} from "@marketmind/contracts";

/** Shape the builder needs from the dispatch processor's revalidation tx. */
export interface DispatchAssemblyInput {
  attemptId: string;
  intentId: string;
  intentVersion: number;
  businessId: string;
  idempotencyKey: string;
  /** Frozen candidate bytes (publishing_candidates.payload). */
  candidate: PublicationCandidateV1;
  /** Frozen active status snapshot (publishing_candidates.source_status). */
  candidateStatus: PublicationCandidateStatusV1;
  /** Raw target row (includes credentialRef). */
  target: {
    id: string;
    businessId: string;
    provider: "META";
    channel: string;
    externalAccountId: string;
    displayName: string;
    connectionState: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
    credentialRef: string;
    capabilities: unknown;
    lastVerifiedAt: Date | null;
    version: number;
  };
  /** Latest approval row for this intent version (decision === APPROVED). */
  approval: {
    id: string;
    candidateChecksum: string;
    decidedByUserId: string;
    decidedAt: Date;
  };
  scheduledUtcAt: Date;
  scheduledLocalAt: Date | null;
  timezone: string | null;
}

/** Far-future (1h) retrieval expiry used while the signed-URL asset boundary
 *  (#121) lands. The retrieval_url points at the frozen internal asset route,
 *  which #121 serves with provider provenance. */
const ASSET_RETRIEVAL_TTL_MS = 60 * 60 * 1000;

/**
 * Builds the frozen `SignedPublicationDispatchEnvelopeV1` (#120 boundary).
 *
 * P1 (#119 review): the API must send the frozen
 * `SignedPublicationDispatchEnvelopeV1` — NOT a custom camelCase body — so the
 * runner can validate candidate bytes/status, assets, the immutable target
 * snapshot, approval evidence, operation, message id, and the canonical body
 * hash. The attempt's `provider_request_fingerprint` MUST equal the envelope
 * `body_sha256` (`computeDispatchRequestFingerprint(body)`) and is what the
 * signed callback binds back to.
 */
@Injectable()
export class DispatchEnvelopeBuilder {
  private readonly logger = new Logger(DispatchEnvelopeBuilder.name);
  private readonly callbackBaseUrl: string;
  private readonly signingKeyId: string;
  private readonly workflowVersion: string;

  constructor(config: ConfigService) {
    this.callbackBaseUrl = config.get<string>("publishing.callbackBaseUrl", "");
    this.signingKeyId = config.get<string>("publishing.n8nSigningKeyId", "");
    this.workflowVersion = config.get<string>(
      "publishing.workflowVersion",
      "v1",
    );
  }

  /** Assemble the frozen dispatch body + its canonical request fingerprint. */
  buildDispatchBody(input: DispatchAssemblyInput): {
    body: PublicationDispatchBodyV1;
    requestFingerprint: string;
  } {
    const operation = publicationOperationForMode(
      "real",
    ) as "meta.publish_static_image";

    // Approval snapshot — canonical fingerprint over every material field
    // (mirrors publication-approval-v1). Computed by the frozen contract helper
    // so the runner can reproduce it exactly.
    const approvalSnapshot: Omit<
      PublicationApprovalSnapshotV1,
      "approval_fingerprint"
    > = {
      contract_version: "publication-approval-v1",
      decision_id: input.approval.id,
      intent_id: input.intentId,
      intent_version: input.intentVersion,
      candidate_id: input.candidate.candidate_id,
      candidate_checksum: input.approval.candidateChecksum,
      mode: "real",
      target_id: input.target.id,
      scheduled_local: this.toNaiveLocal(input),
      time_zone: this.cairoZone(input.timezone),
      scheduled_utc: input.scheduledUtcAt.toISOString(),
      decided_by_user_id: input.approval.decidedByUserId,
      decided_at: input.approval.decidedAt.toISOString(),
    };
    const approvalFingerprint =
      computePublicationApprovalFingerprint(approvalSnapshot);
    const approval: PublicationApprovalSnapshotV1 = {
      ...approvalSnapshot,
      approval_fingerprint: approvalFingerprint,
    };

    // Immutable target snapshot (lowercase connection_state to match the
    // frozen enum). credentialRef travels in the body so n8n resolves the
    // secret from its own store — it is never put on the browser.
    const target: PublishingTargetV1 = {
      contract_version: "publishing-target-v1",
      target_id: input.target.id,
      version: input.target.version,
      business_id: input.target.businessId,
      provider: "meta",
      channel: this.frozenChannel(input.target.channel),
      external_account_id: input.target.externalAccountId,
      display_name: input.target.displayName,
      connection_state: input.target.connectionState.toLowerCase() as
        | "connected"
        | "expired"
        | "revoked"
        | "error",
      credential_ref: input.target.credentialRef,
      capabilities: this.frozenCapabilities(input.target.capabilities),
      last_verified_at: input.target.lastVerifiedAt
        ? input.target.lastVerifiedAt.toISOString()
        : null,
    };

    // Assets with the frozen internal retrieval route (real signed URLs land
    // with #121). The retrieval_expires_at is bounded so a stale URL is never
    // accepted as live.
    const retrievalExpiresAt = new Date(
      Date.now() + ASSET_RETRIEVAL_TTL_MS,
    ).toISOString();
    const assets: PublicationDispatchAssetV1[] = (
      input.candidate.assets ?? []
    ).map((a) => ({
      asset_id: a.asset_id,
      checksum: a.checksum,
      mime_type: a.mime_type,
      retrieval_url: `${this.callbackBaseUrl}/internal/v1/publishing/assets/${a.asset_id}`,
      retrieval_expires_at: retrievalExpiresAt,
    }));

    const body: PublicationDispatchBodyV1 = {
      contract_version: "publication-dispatch-v1",
      attempt_id: input.attemptId,
      intent_id: input.intentId,
      intent_version: input.intentVersion,
      business_id: input.businessId,
      correlation_id: input.intentId, // stable UUID for replay determinism
      idempotency_key: input.idempotencyKey,
      workflow_version: this.workflowVersion,
      candidate: input.candidate,
      candidate_status:
        input.candidateStatus as PublicationCandidateStatusV1 & {
          candidate_state: "active";
          replacement_candidate_id: null;
        },
      assets,
      callback_url: `${this.callbackBaseUrl}/internal/v1/publishing/dispatch/${input.attemptId}/callback`,
      mode: "real",
      operation,
      target,
      approval,
      scheduled_utc: input.scheduledUtcAt.toISOString(),
    };

    const requestFingerprint = computeDispatchRequestFingerprint(body);
    return { body, requestFingerprint };
  }

  /** Wrap a frozen body in the signed envelope (fresh message_id/nonce/sent_at
   *  per send — these are envelope-level and do NOT affect the body hash, so a
   *  replay still resolves to the same attempt by request_fingerprint). */
  signEnvelope(
    body: PublicationDispatchBodyV1,
    signingSecret: string,
  ): SignedPublicationDispatchEnvelopeV1 {
    return signPublicationDispatchEnvelope(
      {
        contract_version: "publishing-dispatch-envelope-v1",
        message_id: crypto.randomUUID(),
        sent_at: new Date().toISOString(),
        nonce: crypto.randomUUID(),
        key_id: this.signingKeyId,
        body,
      },
      signingSecret,
    );
  }

  private toNaiveLocal(input: DispatchAssemblyInput): string {
    // The contract's scheduled_local is a naive "YYYY-MM-DDTHH:mm:ss" string
    // with no offset. The intent stores the UTC instant + timezone; we render
    // the naive local form deterministically from UTC.
    const d = input.scheduledUtcAt;
    const tz = this.cairoZone(input.timezone);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    const h = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}:${get("second")}`;
  }

  private cairoZone(tz: string | null): "Africa/Cairo" {
    // The frozen contract currently restricts scheduling to Africa/Cairo.
    return tz === "Africa/Cairo" ? "Africa/Cairo" : "Africa/Cairo";
  }

  private frozenChannel(channel: string): "facebook" | "instagram" {
    if (channel === "instagram") return "instagram";
    return "facebook"; // default;META channel is facebook in the frozen contract
  }

  private frozenCapabilities(raw: unknown): readonly ["static_image"] {
    // The dispatch body's PublishingTargetV1.capabilities is the frozen
    // readonly ["static_image"] tuple for this MVP contract version.
    return ["static_image"] as const;
  }
}
