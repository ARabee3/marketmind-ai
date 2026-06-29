import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { postExternalJson } from "../../../common/http/external-http-client";
import {
  AiDiscoveryResult,
  BusinessProfileDraft,
  DiscoveryMessage,
  IntelligenceResult,
  ProfileUncertainty,
} from "../discovery-state";
import {
  LanguageModeDto,
  PreparedDiscoveryIntakeDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";

export type AiDiscoveryStartResult = {
  readonly action:
    | "ask_next_question"
    | "ask_clarification"
    | "produce_profile_draft"
    | "safe_failure";
  readonly next_question?: string;
};

@Injectable()
export class AiDiscoveryClient {
  async start(
    sessionId: string,
    dto: StartDiscoveryDto,
    intelligence: IntelligenceResult,
  ): Promise<AiDiscoveryResult> {
    return this.postDiscovery("/start", {
      session_id: sessionId,
      language_mode: dto.language_mode ?? LanguageModeDto.Mixed,
      intake: dto.intake,
      intelligence,
    });
  }

  async respond(
    sessionId: string,
    languageMode: LanguageModeDto,
    intake: PreparedDiscoveryIntakeDto,
    intelligence: IntelligenceResult,
    messages: readonly DiscoveryMessage[],
    ownerMessage: DiscoveryMessage,
  ): Promise<AiDiscoveryResult> {
    return this.postDiscovery("/respond", {
      session_id: sessionId,
      language_mode: languageMode,
      intake,
      intelligence,
      messages,
      owner_message: ownerMessage,
    });
  }

  async summarize(
    sessionId: string,
    languageMode: LanguageModeDto,
    intake: PreparedDiscoveryIntakeDto,
    intelligence: IntelligenceResult,
    messages: readonly DiscoveryMessage[],
  ): Promise<AiDiscoveryResult> {
    return this.postDiscovery("/summarize", {
      session_id: sessionId,
      language_mode: languageMode,
      intake,
      intelligence,
      messages,
    });
  }

  private async postDiscovery(
    path: "/start" | "/respond" | "/summarize",
    payload: Record<string, unknown>,
  ): Promise<AiDiscoveryResult> {
    const config = externalProviderConfig();

    if (!config.aiServiceBaseUrl) {
      throw new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      );
    }

    try {
      const response = await postExternalJson<unknown>(
        `${config.aiServiceBaseUrl}/internal/v1/ai/discovery${path}`,
        payload,
        { timeoutMs: config.discoverySearchTimeoutMs },
      );

      return parseAiDiscoveryResult(response);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      throw new ProviderError(
        "AI_DISCOVERY_PROVIDER_ERROR",
        error instanceof Error
          ? error.message
          : "AI discovery provider failed.",
        true,
      );
    }
  }
}

function parseAiDiscoveryResult(value: unknown): AiDiscoveryResult {
  if (typeof value !== "object" || value === null) {
    throw invalidOutput();
  }

  const candidate = value as {
    readonly action?: unknown;
    readonly next_question?: unknown;
    readonly updated_known_facts?: unknown;
    readonly updated_uncertainties?: unknown;
    readonly research_observations?: unknown;
    readonly source_refs?: unknown;
    readonly domain_scores?: unknown;
    readonly profile_draft?: unknown;
    readonly safe_error?: unknown;
  };

  if (!isAction(candidate.action)) {
    throw invalidOutput();
  }

  return {
    action: candidate.action,
    next_question:
      typeof candidate.next_question === "string"
        ? candidate.next_question
        : undefined,
    updated_known_facts: objectRecord(candidate.updated_known_facts),
    updated_uncertainties: uncertainties(candidate.updated_uncertainties),
    research_observations: [],
    source_refs: [],
    domain_scores: numberRecord(candidate.domain_scores),
    profile_draft: profileDraft(candidate.profile_draft),
    safe_error: safeError(candidate.safe_error),
  };
}

function isAction(value: unknown): value is AiDiscoveryStartResult["action"] {
  return (
    value === "ask_next_question" ||
    value === "ask_clarification" ||
    value === "produce_profile_draft" ||
    value === "safe_failure"
  );
}

function invalidOutput(): ProviderError {
  return new ProviderError(
    "AI_DISCOVERY_INVALID_OUTPUT",
    "AI discovery returned invalid output.",
    true,
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function numberRecord(value: unknown): Record<string, number> {
  const record = objectRecord(value);

  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => {
      return typeof entry[1] === "number";
    }),
  );
}

function uncertainties(value: unknown): readonly ProfileUncertainty[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isProfileUncertainty);
}

function profileDraft(value: unknown): BusinessProfileDraft | undefined {
  if (!isProfileDraft(value)) {
    return undefined;
  }

  return value;
}

function safeError(value: unknown): AiDiscoveryResult["safe_error"] {
  const record = objectRecord(value);
  if (
    typeof record["code"] !== "string" ||
    typeof record["message"] !== "string" ||
    typeof record["retryable"] !== "boolean"
  ) {
    return undefined;
  }

  return {
    code: record["code"],
    message: record["message"],
    retryable: record["retryable"],
  };
}

function isProfileUncertainty(value: unknown): value is ProfileUncertainty {
  const record = objectRecord(value);

  return (
    typeof record["field_key"] === "string" &&
    typeof record["description"] === "string" &&
    isSeverity(record["severity"])
  );
}

function isProfileDraft(value: unknown): value is BusinessProfileDraft {
  const record = objectRecord(value);

  return (
    typeof record["id"] === "string" &&
    typeof record["session_id"] === "string" &&
    typeof record["version"] === "number" &&
    typeof record["confirmed_facts"] === "object" &&
    Array.isArray(record["research_observations"]) &&
    Array.isArray(record["uncertainties"]) &&
    Array.isArray(record["owner_goals"]) &&
    Array.isArray(record["strategy_relevant_notes"]) &&
    typeof record["raw_ai_output"] === "object"
  );
}

function isSeverity(value: unknown): value is ProfileUncertainty["severity"] {
  return value === "low" || value === "medium" || value === "high";
}
