import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import { SearchQueryIntent, SearchProviderHint } from "./query-plan.types";

export type EvidenceClassification =
  | "own_business"
  | "competitor"
  | "market_context"
  | "social_signal"
  | "directory"
  | "irrelevant";

export type EvidenceTier =
  | "confirmed_signal"
  | "needs_confirmation"
  | "discarded";

export type EvidenceTriageCandidate = {
  readonly index: number;
  readonly intent: SearchQueryIntent;
  readonly provider: SearchProviderHint;
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
  readonly query: string;
  readonly rank: number;
  readonly provider_confidence: number;
  readonly metadata: Record<string, string | number | boolean>;
};

export type EvidenceTriageRequest = Pick<
  StartDiscoveryDto,
  "language_mode" | "intake"
> & {
  readonly candidates: readonly EvidenceTriageCandidate[];
};

export type EvidenceTriageDecision = {
  readonly index: number;
  readonly classification: EvidenceClassification;
  readonly evidence_tier: EvidenceTier;
  readonly confidence: number;
  readonly reason: string;
  readonly candidate_facts: Record<string, string>;
  readonly suggested_owner_question?: string;
  readonly synthesized_observation?: string;
};

export type EvidenceTriageResult = {
  readonly source: "llm";
  readonly decisions: readonly EvidenceTriageDecision[];
  readonly warnings?: readonly string[];
};
