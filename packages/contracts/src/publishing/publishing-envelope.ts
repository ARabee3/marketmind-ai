import type {
  PublicationCandidateStatusV1,
  PublicationCandidateV1,
} from "../content/publication-candidate";
import {
  computePublishingSha256,
  computePublishingSignature,
  type PublishingSignatureInput,
} from "./publishing-canonical";
import type {
  PublicationApprovalSnapshotV1,
  PublishingTargetV1,
} from "./publication-intent";
import type { PublicationResultV1 } from "./publication-result";
import type {
  IsoDateTime,
  PublishingMode,
  PublishingOperation,
  UUID,
} from "./publishing-types";

export type PublicationDispatchAssetV1 = {
  readonly asset_id: UUID;
  readonly checksum: string;
  readonly mime_type: string;
  readonly retrieval_url: string;
  readonly retrieval_expires_at: IsoDateTime;
};

type PublicationDispatchBodyBaseV1 = {
  readonly contract_version: "publication-dispatch-v1";
  readonly attempt_id: UUID;
  readonly intent_id: UUID;
  readonly intent_version: number;
  readonly business_id: UUID;
  readonly correlation_id: UUID;
  readonly idempotency_key: string;
  readonly workflow_version: string;
  readonly candidate: PublicationCandidateV1;
  readonly candidate_status: PublicationCandidateStatusV1 & {
    readonly candidate_state: "active";
  };
  readonly assets: readonly PublicationDispatchAssetV1[];
  readonly callback_url: string;
};

export type PublicationDispatchBodyV1 = PublicationDispatchBodyBaseV1 &
  (
    | {
        readonly mode: "real";
        readonly operation: "meta.publish_static_image" | "meta.publish_text";
        readonly target: PublishingTargetV1;
        readonly approval: PublicationApprovalSnapshotV1;
        readonly scheduled_utc: IsoDateTime;
      }
    | {
        readonly mode: "manual_export";
        readonly operation: "manual_export.build";
        readonly target: null;
        readonly approval: null;
        readonly scheduled_utc: null;
      }
    | {
        readonly mode: "simulation";
        readonly operation: "simulation.run";
        readonly target: null;
        readonly approval: null;
        readonly scheduled_utc: null;
      }
  );

export type PublicationCallbackBodyV1 = {
  readonly contract_version: "publication-callback-v1";
  readonly callback_id: UUID;
  readonly attempt_id: UUID;
  readonly intent_id: UUID;
  readonly intent_version: number;
  readonly request_fingerprint: string;
  readonly workflow_version: string;
  readonly result: PublicationResultV1;
};

type SignedPublishingEnvelopeBaseV1 = {
  readonly message_id: UUID;
  readonly sent_at: IsoDateTime;
  readonly nonce: string;
  readonly key_id: string;
  readonly signature_algorithm: "hmac-sha256";
  readonly body_sha256: string;
  readonly signature: string;
};

export type SignedPublicationDispatchEnvelopeV1 =
  SignedPublishingEnvelopeBaseV1 & {
    readonly contract_version: "publishing-dispatch-envelope-v1";
    readonly body: PublicationDispatchBodyV1;
  };

export type SignedPublicationCallbackEnvelopeV1 =
  SignedPublishingEnvelopeBaseV1 & {
    readonly contract_version: "publishing-callback-envelope-v1";
    readonly body: PublicationCallbackBodyV1;
  };

export function publicationOperationForMode(
  mode: PublishingMode,
  contentFormat?: PublicationCandidateV1["content_format"],
): PublishingOperation {
  switch (mode) {
    case "real":
      return contentFormat === "text_post"
        ? "meta.publish_text"
        : "meta.publish_static_image";
    case "manual_export":
      return "manual_export.build";
    case "simulation":
      return "simulation.run";
  }
}

type UnsignedEnvelope<TContract extends string, TBody> = {
  readonly contract_version: TContract;
  readonly message_id: UUID;
  readonly sent_at: IsoDateTime;
  readonly nonce: string;
  readonly key_id: string;
  readonly body: TBody;
};

function signPublishingEnvelope<TContract extends string, TBody>(
  envelope: UnsignedEnvelope<TContract, TBody>,
  secret: string,
): UnsignedEnvelope<TContract, TBody> & SignedPublishingEnvelopeBaseV1 {
  const bodySha256 = computePublishingSha256(envelope.body);
  const signatureInput: PublishingSignatureInput = {
    contract_version: envelope.contract_version,
    sent_at: envelope.sent_at,
    nonce: envelope.nonce,
    body_sha256: bodySha256,
  };
  return {
    ...envelope,
    signature_algorithm: "hmac-sha256",
    body_sha256: bodySha256,
    signature: computePublishingSignature(signatureInput, secret),
  };
}

export function signPublicationDispatchEnvelope(
  envelope: UnsignedEnvelope<
    "publishing-dispatch-envelope-v1",
    PublicationDispatchBodyV1
  >,
  secret: string,
): SignedPublicationDispatchEnvelopeV1 {
  return signPublishingEnvelope(envelope, secret);
}

export function signPublicationCallbackEnvelope(
  envelope: UnsignedEnvelope<
    "publishing-callback-envelope-v1",
    PublicationCallbackBodyV1
  >,
  secret: string,
): SignedPublicationCallbackEnvelopeV1 {
  return signPublishingEnvelope(envelope, secret);
}
