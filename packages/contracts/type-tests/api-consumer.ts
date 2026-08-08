import {
  reducePublicationCandidateEventV1,
  validatePublicationCallbackContext,
  validatePublicationDispatchContext,
  validateRetrievedPublicationAssetsV1,
  type ApprovePublicationIntentRequestV1,
  type IngestPublicationCandidateEventRequestV1,
  type PublicationCandidateRecordV1,
  type PublicationIntentMutationRequestV1,
  type SignedPublicationCallbackEnvelopeV1,
  type SignedPublicationDispatchEnvelopeV1,
  type ContractVersion,
  type StrategyPlan,
  type StrategyPlanV2,
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
type CandidateRecordStoresCompleteStatus = Assert<
  PublicationCandidateRecordV1["source_status"]["state_version"] extends number
    ? true
    : false
>;

// #135: versioned Strategy contract — v2 plans are discriminated by
// contract_version and stay assignable to the widened union, while v1 keeps
// its exact literal.
type V2PlanIsStrategyV2 = Assert<
  StrategyPlanV2["contract_version"] extends "strategy-v2" ? true : false
>;
type V2PlanIsInUnion = Assert<
  StrategyPlanV2 extends StrategyPlan | StrategyPlanV2 ? true : false
>;
type VersionUnionIncludesV2 = Assert<
  "strategy-v2" extends ContractVersion ? true : false
>;
type VersionUnionKeepsV1 = Assert<
  "strategy-v1" extends ContractVersion ? true : false
>;

export function acceptCandidateEventForApi(
  record: PublicationCandidateRecordV1 | null,
  event: IngestPublicationCandidateEventRequestV1,
  receivedAt: string,
): void {
  void reducePublicationCandidateEventV1(record, event, receivedAt);
  void validateRetrievedPublicationAssetsV1;
}

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
  | ApprovalIsRealOnly
  | CandidateRecordStoresCompleteStatus;
