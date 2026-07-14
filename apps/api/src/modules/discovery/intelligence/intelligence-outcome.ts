import { ProviderError } from "../../../common/errors/provider-error";
import { safeError } from "../../../common/errors/safe-error";
import type { IntelligenceMappingInput } from "./intelligence.types";
import type { ConsolidatedIntelligence } from "./intelligence-source.consolidator";
import type { SearchProviderWarning } from "./search-result.types";

export function completedIntelligenceInput(
  intelligence: ConsolidatedIntelligence,
  warnings: readonly SearchProviderWarning[],
): IntelligenceMappingInput {
  const firstWarning = warnings[0];
  const acceptedSourceCount = intelligence.source_refs.filter(
    (source) => source.status !== "discarded",
  ).length;

  return {
    status:
      acceptedSourceCount > 0
        ? firstWarning
          ? "partial"
          : "complete"
        : firstWarning
          ? "failed"
          : "partial",
    ...intelligence,
    safe_error: firstWarning
      ? safeError(
          firstWarning.code,
          firstWarning.message,
          firstWarning.retryable,
        )
      : undefined,
    knowledge_gaps:
      acceptedSourceCount > 0 || firstWarning
        ? []
        : [
            {
              field_key: "search_sources",
              question_hint:
                "I could not find enough public search data. Which links or competitors should I check?",
              priority: 2,
            },
          ],
  };
}

export function failedIntelligenceInput(
  intelligence: ConsolidatedIntelligence,
  error: ProviderError,
  triageProviderFailed: boolean,
): IntelligenceMappingInput {
  return {
    status:
      triageProviderFailed || intelligence.source_refs.length > 0
        ? "partial"
        : "failed",
    ...intelligence,
    safe_error: safeError(error.code, error.message, error.retryable),
  };
}
