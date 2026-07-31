import {
  validatePublicationCallbackContext,
  validatePublicationDispatchContext,
  type ApprovePublicationIntentRequestV1,
  type PublicationIntentMutationRequestV1,
  type SignedPublicationCallbackEnvelopeV1,
  type SignedPublicationDispatchEnvelopeV1,
} from "../src/index";

type Assert<T extends true> = T;
type HasIdempotencyKey<T> = T extends {
  readonly idempotency_key: string;
}
  ? true
  : false;
type MutationHasIdempotency = Assert<
  HasIdempotencyKey<PublicationIntentMutationRequestV1>
>;
type ApprovalIsRealOnly = Assert<
  ApprovePublicationIntentRequestV1["mode"] extends "real" ? true : false
>;

export function acceptPublishingDispatchForApi(
  envelope: SignedPublicationDispatchEnvelopeV1,
): string {
  void validatePublicationDispatchContext;
  return envelope.body.attempt_id;
}

export function acceptPublishingCallbackForApi(
  envelope: SignedPublicationCallbackEnvelopeV1,
): string {
  void validatePublicationCallbackContext;
  return envelope.body.callback_id;
}

export type ApiPublishingContractAssertions =
  | MutationHasIdempotency
  | ApprovalIsRealOnly;
