import type {
  PublicationIntentDetailResponseV1,
  PublicationOutcome,
  PublishingTargetPublicV1,
} from "../src/index";

type Assert<T extends true> = T;
type PublicTargetHidesCredentialRef = Assert<
  "credential_ref" extends keyof PublishingTargetPublicV1 ? false : true
>;

export function publishingOutcomeLabelKey(
  outcome: PublicationOutcome,
): "published" | "exported" | "simulated" | "failed" | "cancelled" | "unknown" {
  switch (outcome) {
    case "published":
    case "exported":
    case "simulated":
    case "failed":
    case "cancelled":
    case "unknown":
      return outcome;
  }
}

export function readPublishingIntentForWeb(
  response: PublicationIntentDetailResponseV1,
): string {
  return response.publication_intent.intent_id;
}

export type WebPublishingContractAssertions = PublicTargetHidesCredentialRef;
