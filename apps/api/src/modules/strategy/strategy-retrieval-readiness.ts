type RetrievalRunReadinessInput = {
  readonly status: string;
  readonly items: readonly unknown[];
  readonly gaps: readonly { readonly severity: string }[];
};

export function strategyRetrievalRunIsUsable(
  run: RetrievalRunReadinessInput | null | undefined,
): boolean {
  return Boolean(
    run &&
    run.status === "completed" &&
    run.items.length > 0 &&
    !run.gaps.some((gap) => gap.severity === "blocking"),
  );
}

export class StrategyKnowledgeUnavailableError extends Error {
  readonly code = "STRATEGY_KNOWLEDGE_UNAVAILABLE";
  readonly retryable = true;

  constructor() {
    super(
      "Trusted marketing guidance is temporarily unavailable for this Strategy.",
    );
  }
}
