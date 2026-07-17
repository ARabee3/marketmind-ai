export const SUGGESTED_ANSWERS_METADATA_KEY = "suggested_answers";
const MAX_SUGGESTED_ANSWERS = 4;

export function metadataForSuggestedAnswers(
  answers: readonly string[] | undefined,
): Record<string, unknown> | undefined {
  const cleaned = cleanSuggestedAnswers(answers);
  return cleaned
    ? { [SUGGESTED_ANSWERS_METADATA_KEY]: cleaned }
    : undefined;
}

export function suggestedAnswersFromMetadata(
  metadata: unknown,
): string[] | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }
  const value = metadata[SUGGESTED_ANSWERS_METADATA_KEY];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return cleanSuggestedAnswers(value);
}

function cleanSuggestedAnswers(
  answers: readonly string[] | undefined,
): string[] | undefined {
  if (!answers) {
    return undefined;
  }
  const unique: string[] = [];
  for (const answer of answers) {
    const cleaned = answer.trim();
    if (cleaned && !unique.includes(cleaned)) {
      unique.push(cleaned);
    }
  }
  const limited = unique.slice(0, MAX_SUGGESTED_ANSWERS);
  return limited.length ? limited : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
