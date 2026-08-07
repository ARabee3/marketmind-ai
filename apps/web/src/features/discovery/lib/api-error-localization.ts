/**
 * Explicit, stable API error-code-to-translation-key map for Discovery-facing
 * requests. Shared contract codes are mapped directly; transport/auth/network
 * and unknown codes fall back to typed generic keys.
 */

import type { ErrorCode } from "@marketmind/contracts";
import type { TranslationKey } from "@/i18n/types";
import type { ApiError } from "@/lib/api/discovery";

const API_ERROR_CODE_TO_TRANSLATION: Record<ErrorCode, TranslationKey> = {
  UNAUTHORIZED: "Errors.unauthorized",
  FORBIDDEN: "Errors.forbidden",
  VALIDATION_FAILED: "Errors.validationError",
  DISCOVERY_SESSION_NOT_FOUND: "Errors.notFound",
  DISCOVERY_SESSION_STATE_CONFLICT: "Errors.generic",
  DISCOVERY_RESEARCH_CAP_EXCEEDED: "Errors.generic",
  DISCOVERY_AI_SERVICE_UNAVAILABLE: "DiscoveryProgress.errorProviderFailure",
  DISCOVERY_AI_BAD_RESPONSE: "DiscoveryProgress.errorGeneric",
  DISCOVERY_TRANSCRIPTION_UNAVAILABLE: "Errors.generic",
  DISCOVERY_TRANSCRIPTION_INVALID_AUDIO: "Errors.validationError",
  DISCOVERY_TRANSCRIPTION_TOO_LARGE: "Errors.validationError",
  DISCOVERY_TRANSCRIPTION_EMPTY: "Errors.validationError",
  DISCOVERY_TRANSCRIPTION_RATE_LIMITED: "Errors.generic",
  DISCOVERY_PROFILE_ALREADY_CONFIRMED: "Errors.discoveryAlreadyConfirmed",
  ACTION_TOKEN_INVALID: "Errors.sessionExpired",
  ACTION_TOKEN_CONSUMED: "Errors.sessionExpired",
  ACTION_TOKEN_EXPIRED: "Errors.sessionExpired",
  AUTH_RATE_LIMITED: "Errors.generic",
  FEDERATED_IDENTITY_CONFLICT: "Errors.generic",
  OAUTH_STATE_MISMATCH: "Errors.generic",
  OAUTH_PROVIDER_ERROR: "Errors.serverError",
  OAUTH_EMAIL_ALREADY_USED_PASSWORD: "Auth.errorEmailExists",
  OAUTH_CONFIGURATION_ERROR: "Errors.serverError",
  STRATEGY_PROFILE_STALE: "Errors.validationError",
  STRATEGY_PROFILE_UNCONFIRMED: "Errors.validationError",
  STRATEGY_KNOWLEDGE_GAP: "Errors.generic",
  STRATEGY_RETRIEVAL_FAILURE: "Errors.serverError",
  STRATEGY_PROVIDER_FAILURE: "Errors.serverError",
  STRATEGY_SCHEMA_FAILURE: "Errors.serverError",
  STRATEGY_INVALID_CITATION: "Errors.validationError",
  STRATEGY_INVALID_BENCHMARK: "Errors.validationError",
  STRATEGY_ARITHMETIC_FAILURE: "Errors.validationError",
  STRATEGY_RULE_VIOLATION: "Errors.validationError",
  STRATEGY_BRIEF_INCOMPLETE: "Errors.validationError",
  STRATEGY_NOT_FOUND: "Errors.notFound",
  STRATEGY_STATE_CONFLICT: "Errors.generic",
  STRATEGY_BRIEF_INVALID: "Errors.validationError",
  STRATEGY_BUDGET_MISMATCH: "Errors.validationError",
  STRATEGY_CHANNEL_LIMIT_EXCEEDED: "Errors.validationError",
  STRATEGY_EVIDENCE_NOT_APPROVED: "Errors.validationError",
  STRATEGY_SCORE_MISMATCH: "Errors.validationError",
  STRATEGY_LANGUAGE_MISMATCH: "Errors.validationError",
  STRATEGY_APPROVAL_BLOCKED: "Errors.generic",
  CONTENT_STRATEGY_NOT_APPROVED: "Errors.validationError",
  CONTENT_PROFILE_STALE: "Errors.validationError",
  CONTENT_CYCLE_PAUSED: "Errors.generic",
  CONTENT_CYCLE_COMPLETED: "Errors.generic",
  CONTENT_WEEK_OUT_OF_RANGE: "Errors.validationError",
  CONTENT_WEEK_ALREADY_CLAIMED: "Errors.generic",
  CONTENT_CHANNEL_MISMATCH: "Errors.validationError",
  CONTENT_UNSUPPORTED_CLAIM: "Errors.validationError",
  CONTENT_OFFER_UNAPPROVED: "Errors.validationError",
  CONTENT_POLICY_VIOLATION: "Errors.validationError",
  CONTENT_ASSET_REQUIRED: "Errors.validationError",
  CONTENT_SCHEMA_FAILURE: "Errors.validationError",
  CONTENT_VERSION_CONFLICT: "Errors.generic",
  CONTENT_APPROVAL_BLOCKED: "Errors.validationError",
  CONTENT_PROVIDER_FAILURE: "Errors.serverError",
  CONTENT_CANDIDATE_TAMPERED: "Errors.validationError",
  CONTENT_CANDIDATE_REVOKED: "Errors.generic",
  PUBLISHING_CONTRACT_UNSUPPORTED: "Errors.validationError",
  PUBLISHING_CANDIDATE_INVALID: "Errors.validationError",
  PUBLISHING_CANDIDATE_TAMPERED: "Errors.validationError",
  PUBLISHING_CANDIDATE_REVOKED: "Errors.generic",
  PUBLISHING_TARGET_NOT_CONNECTED: "Errors.generic",
  PUBLISHING_TARGET_UNAUTHORIZED: "Errors.unauthorized",
  PUBLISHING_FORMAT_UNSUPPORTED: "Errors.validationError",
  PUBLISHING_ASSET_UNAVAILABLE: "Errors.generic",
  PUBLISHING_ASSET_TAMPERED: "Errors.validationError",
  PUBLISHING_SCHEDULE_IN_PAST: "Errors.validationError",
  PUBLISHING_APPROVAL_REQUIRED: "Errors.validationError",
  PUBLISHING_STATE_CONFLICT: "Errors.generic",
  PUBLISHING_IDEMPOTENCY_CONFLICT: "Errors.generic",
  PUBLISHING_DUPLICATE_DISPATCH: "Errors.generic",
  PUBLISHING_WEBHOOK_UNAUTHORIZED: "Errors.unauthorized",
  PUBLISHING_WEBHOOK_TIMESTAMP_INVALID: "Errors.sessionExpired",
  PUBLISHING_WEBHOOK_NONCE_REPLAYED: "Errors.generic",
  PUBLISHING_PROVIDER_RATE_LIMITED: "Errors.serverError",
  PUBLISHING_PROVIDER_FAILURE: "Errors.serverError",
  PUBLISHING_PROVIDER_OUTCOME_UNKNOWN: "Errors.generic",
  PUBLISHING_CALLBACK_INVALID: "Errors.validationError",
  PUBLISHING_CALLBACK_CONFLICT: "Errors.generic",
};

export function isKnownErrorCode(code: string): code is ErrorCode {
  return Object.keys(API_ERROR_CODE_TO_TRANSLATION).includes(code);
}

/**
 * Maps an API error to a typed translation key. Prefer the contract code when
 * present; fall back by HTTP status; otherwise return a generic fallback.
 */
export function getApiErrorTranslationKey(err: ApiError): TranslationKey {
  // S2-5 owns the queue implementation and stable code contract. Supporting
  // its agreed frontend-facing code here keeps the intake error localized
  // without coupling this PR to Redis or BullMQ.
  if (err.code === "DISCOVERY_QUEUE_UNAVAILABLE") {
    return "DiscoveryProgress.errorRedisFailure";
  }

  if (isKnownErrorCode(err.code)) {
    return API_ERROR_CODE_TO_TRANSLATION[err.code];
  }

  if (err.status >= 400 && err.status < 500) {
    if (err.status === 401) return "Errors.unauthorized";
    if (err.status === 403) return "Errors.forbidden";
    if (err.status === 404) return "Errors.notFound";
    if (err.status === 422) return "Errors.validationError";
    return "Errors.generic";
  }

  if (err.status >= 500) {
    return "Errors.serverError";
  }

  return "Errors.networkError";
}
