import { Injectable } from "@nestjs/common";
import { LanguageModeDto } from "../dto/start-discovery.dto";
import {
  IntelligenceResult,
  ResearchObservation,
  ResearchObservationKind,
  SourceRef,
  SourceType,
} from "../discovery-state";
import {
  IntelligenceMappingInput,
  IntelligenceObservationCandidate,
  IntelligenceSourceCandidate,
} from "./intelligence.types";

const CONTRACT_SOURCE_TYPES = new Set<SourceType>([
  "owner_link",
  "metadata",
  "search_result",
  "manual_owner_answer",
]);

@Injectable()
export class IntelligenceContractMapper {
  toIntelligenceResult(input: IntelligenceMappingInput): IntelligenceResult {
    const sourceRefs = input.source_refs.map((source, index) =>
      this.toSourceRef(source, index),
    );
    const observations = (input.research_observations ?? []).map(
      (observation, index) =>
        this.toObservation(observation, index, sourceRefs),
    );

    return {
      status: input.status,
      search_mode: this.searchMode(sourceRefs, input.safe_error),
      source_refs: sourceRefs,
      research_observations: observations,
      conversation_hooks: (input.conversation_hooks ?? []).map(
        (hook, index) => ({
          id: `hook_${index + 1}`,
          source_observation_id:
            hook.source_observation_index === undefined
              ? undefined
              : observations[hook.source_observation_index]?.id,
          hook_text: hook.hook_text,
          language: hook.language ?? LanguageModeDto.Mixed,
          status: hook.status ?? "active",
        }),
      ),
      knowledge_gaps: (input.knowledge_gaps ?? []).map((gap, index) => ({
        id: `knowledge_gap_${index + 1}`,
        field_key: gap.field_key,
        question_hint: gap.question_hint,
        priority: gap.priority,
        status: gap.status ?? "open",
      })),
      safe_error: input.safe_error,
    };
  }

  private toSourceRef(
    source: IntelligenceSourceCandidate,
    index: number,
  ): SourceRef {
    const sourceType = this.sourceType(source.source_type);
    const provider =
      sourceType === "search_result" &&
      !CONTRACT_SOURCE_TYPES.has(source.source_type as SourceType)
        ? source.source_type
        : undefined;

    return {
      id: `source_ref_${index + 1}`,
      source_type: sourceType,
      platform: source.platform,
      url: source.url,
      title: source.title,
      snippet: source.snippet,
      fetched_at: source.fetched_at,
      confidence: source.confidence,
      metadata: {
        ...(source.metadata ?? {}),
        ...(provider ? { provider } : {}),
      },
    };
  }

  private toObservation(
    observation: IntelligenceObservationCandidate,
    index: number,
    sourceRefs: readonly SourceRef[],
  ): ResearchObservation {
    const sourceRef = this.sourceFor(observation.source_index, sourceRefs);
    const discarded =
      observation.status === "discarded" || observation.kind === "discarded";

    return {
      id: `observation_${index + 1}`,
      source_ref_id: sourceRef?.id,
      kind: this.observationKind(observation.kind),
      statement: observation.statement,
      confidence: observation.confidence,
      visibility: observation.visibility ?? "internal",
      status: discarded ? "discarded" : "accepted",
      discard_reason: discarded ? observation.discard_reason : undefined,
      metadata: {
        ...(observation.metadata ?? {}),
        ...(observation.kind === "discarded"
          ? { original_kind: "discarded" }
          : {}),
      },
    };
  }

  private sourceType(sourceType: string): SourceType {
    return CONTRACT_SOURCE_TYPES.has(sourceType as SourceType)
      ? (sourceType as SourceType)
      : "search_result";
  }

  private observationKind(
    kind: ResearchObservationKind | "discarded",
  ): ResearchObservationKind {
    return kind === "discarded" ? "metadata" : kind;
  }

  private sourceFor(
    sourceIndex: number | undefined,
    sourceRefs: readonly SourceRef[],
  ): SourceRef | undefined {
    return sourceIndex === undefined ? undefined : sourceRefs[sourceIndex];
  }

  private searchMode(
    sourceRefs: readonly SourceRef[],
    safeError: IntelligenceResult["safe_error"],
  ): IntelligenceResult["search_mode"] {
    if (sourceRefs.some((source) => source.source_type === "search_result")) {
      return "free_search";
    }

    return safeError ? "provider_later" : "metadata_only";
  }
}
