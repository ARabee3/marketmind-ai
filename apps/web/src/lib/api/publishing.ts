import type {
  CurrentJourneyResponse,
  PublicationApprovalSnapshotV1,
  PublicationAttemptV1,
  PublicationCandidateSummaryV1,
  PublicationCandidateV1,
  PublicationExportManifestV1,
  PublicationIntentV1,
  PublicationResultV1,
  PublishingMode,
  PublishingTargetPublicV1,
  MetaPerformanceCapabilityV1,
} from "@marketmind/contracts";
import { apiRequest, type ApiRequestOptions } from "./client";
import { getConnectionFingerprint } from "@/features/publishing/lib/publishing-state";

export type PublishingApiError = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};

export type PublishingApprovalView = Omit<
  PublicationApprovalSnapshotV1,
  "mode"
> & {
  readonly mode: "real";
  readonly decision: "approved" | "rejected";
  readonly notes: string | null;
};

export type PublishingIntentDetailView = {
  readonly publication_intent: PublicationIntentV1;
  readonly approval: PublishingApprovalView | null;
  readonly target: PublishingTargetPublicV1 | null;
  readonly attempts: readonly PublicationAttemptV1[];
  readonly results: readonly PublicationResultV1[];
};

export type PublishingExportState =
  | {
      readonly status: "pending";
      readonly artifactId: string | null;
      readonly checksum: string | null;
      readonly expiresAt: string | null;
      readonly manifest: null;
      readonly downloadUrl: null;
    }
  | {
      readonly status: "ready";
      readonly artifactId: string;
      readonly checksum: string | null;
      readonly expiresAt: string | null;
      readonly manifest: PublicationExportManifestV1 | null;
      readonly downloadUrl: string | null;
    }
  | {
      readonly status: "failed";
      readonly artifactId: string | null;
      readonly checksum: string | null;
      readonly expiresAt: string | null;
      readonly manifest: null;
      readonly downloadUrl: null;
    };

export type PublicationMutationResult<T> = {
  readonly value: T;
  readonly replayed?: boolean;
};

type RawRecord = Record<string, unknown>;

async function request<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const response = await apiRequest(path, init);

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<PublishingApiError> {
  let code = "api_error";
  let message = response.statusText || "Publishing request failed.";

  try {
    const body = (await response.json()) as RawRecord;
    const nested = isRecord(body.error) ? body.error : null;
    code = stringValue(body.code) ?? stringValue(nested?.code) ?? code;
    message =
      stringValue(body.message) ?? stringValue(nested?.message) ?? message;
  } catch {
    // Keep the status-backed fallback when the API does not return JSON.
  }

  return { status: response.status, code, message };
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value.length > 0 ? value : null;
}

function lower(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function valueFrom(record: RawRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function asRecord(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function unwrap(value: unknown, ...keys: string[]): unknown {
  const record = asRecord(value);
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return value;
}

function arrayValue(value: unknown, ...keys: string[]): readonly unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function normalizeMode(value: unknown): PublishingMode {
  const mode = lower(value);
  if (mode === "real" || mode === "manual_export" || mode === "simulation") {
    return mode;
  }
  throw new Error("Publishing response contained an unsupported mode.");
}

function normalizeCandidateState(
  value: unknown,
): "active" | "revoked" | "replaced" {
  const state = lower(value);
  if (state === "active" || state === "revoked" || state === "replaced") {
    return state;
  }
  throw new Error(
    "Publishing response contained an unsupported candidate state.",
  );
}

function normalizeCandidatePayload(value: unknown): PublicationCandidateV1 {
  const candidate = unwrap(value, "candidate", "payload");
  if (!isRecord(candidate)) {
    throw new Error(
      "Publishing candidate response did not contain a candidate payload.",
    );
  }
  return candidate as unknown as PublicationCandidateV1;
}

export function toPublishingCandidate(
  value: unknown,
): PublicationCandidateSummaryV1 {
  const record = asRecord(value);
  const candidate = normalizeCandidatePayload(value);
  const sourceStatus = asRecord(
    valueFrom(record, "sourceStatus", "source_status"),
  );

  return {
    candidate,
    source_state: normalizeCandidateState(
      valueFrom(record, "sourceState", "source_state", "status") ??
        valueFrom(sourceStatus, "candidate_state"),
    ),
    source_state_version: numberValue(
      valueFrom(record, "sourceStateVersion", "source_state_version") ??
        valueFrom(sourceStatus, "state_version"),
      1,
    ),
    active_intent_id: nullableString(
      valueFrom(record, "activeIntentId", "active_intent_id"),
    ),
    received_at:
      dateValue(valueFrom(record, "receivedAt", "received_at")) ??
      candidate.created_at,
  };
}

export function toPublishingTarget(value: unknown): PublishingTargetPublicV1 {
  const raw = asRecord(value);
  const targetId = requiredTargetString(
    valueFrom(raw, "target_id", "targetId", "id"),
    "target id",
  );
  if (lower(raw.provider) !== "meta") {
    throw new Error(
      "Publishing target response contained an unsupported provider.",
    );
  }
  const businessId = requiredTargetString(
    valueFrom(raw, "business_id", "businessId"),
    "business id",
  );
  const channel = normalizeTargetChannel(raw.channel);
  const externalAccountId = requiredTargetString(
    valueFrom(raw, "external_account_id", "externalAccountId"),
    "external account id",
  );
  const displayName = requiredTargetString(
    valueFrom(raw, "display_name", "displayName"),
    "display name",
  );
  return {
    contract_version: "publishing-target-v1",
    target_id: targetId,
    version: numberValue(raw.version, 1),
    business_id: businessId,
    provider: "meta",
    channel,
    external_account_id: externalAccountId,
    display_name: displayName,
    connection_state: normalizeTargetState(
      valueFrom(raw, "connection_state", "connectionState"),
    ),
    capabilities: normalizeCapabilities(raw.capabilities),
    last_verified_at: dateValue(
      valueFrom(raw, "last_verified_at", "lastVerifiedAt"),
    ),
  };
}

function normalizeTargetState(
  value: unknown,
): "connected" | "expired" | "revoked" | "error" {
  const state = lower(value);
  if (
    state === "connected" ||
    state === "expired" ||
    state === "revoked" ||
    state === "error"
  ) {
    return state;
  }
  throw new Error("Publishing target response contained an unsupported state.");
}

function normalizeTargetChannel(value: unknown): "facebook" | "instagram" {
  const channel = lower(value);
  if (channel === "facebook" || channel === "instagram") return channel;
  throw new Error(
    "Publishing target response contained an unsupported channel.",
  );
}

function requiredTargetString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error(`Publishing target response is missing ${label}.`);
}

function normalizeCapabilities(
  value: unknown,
): PublishingTargetPublicV1["capabilities"] {
  const capabilities = Array.isArray(value)
    ? value.filter(
        (entry): entry is "static_image" | "text" =>
          entry === "static_image" || entry === "text",
      )
    : [];
  if (capabilities.length === 0) {
    throw new Error(
      "Publishing target response does not advertise a supported capability.",
    );
  }
  return [...new Set(capabilities)];
}

export function toPublishingIntent(value: unknown): PublicationIntentV1 {
  const raw = asRecord(
    unwrap(value, "publication_intent", "publicationIntent"),
  );
  const candidate = asRecord(valueFrom(raw, "candidate"));
  const scheduledUtc = dateValue(
    valueFrom(raw, "scheduled_utc", "scheduledUtcAt"),
  );
  const scheduledLocal = nullableString(
    valueFrom(
      raw,
      "scheduled_local",
      "scheduledLocalAt",
      "scheduledLocalDisplay",
    ),
  );

  return {
    contract_version: "publication-intent-v1",
    intent_id: String(valueFrom(raw, "intent_id", "intentId", "id") ?? ""),
    version: numberValue(raw.version, 1),
    business_id: String(valueFrom(raw, "business_id", "businessId") ?? ""),
    candidate_id: String(valueFrom(raw, "candidate_id", "candidateId") ?? ""),
    candidate_checksum: String(
      valueFrom(raw, "candidate_checksum", "candidateChecksum") ??
        valueFrom(candidate, "candidate_checksum", "candidateChecksum") ??
        "",
    ),
    mode: normalizeMode(raw.mode),
    target_id: nullableString(valueFrom(raw, "target_id", "targetId")),
    scheduled_local: scheduledLocal,
    time_zone: normalizeTimeZone(valueFrom(raw, "time_zone", "timezone")),
    scheduled_utc: scheduledUtc,
    state: normalizeIntentState(valueFrom(raw, "state", "status")),
    approved_decision_id: nullableString(
      valueFrom(raw, "approved_decision_id", "approvedDecisionId"),
    ),
    created_by_user_id: String(
      valueFrom(raw, "created_by_user_id", "createdByUserId") ?? "",
    ),
    created_at:
      dateValue(valueFrom(raw, "created_at", "createdAt")) ??
      new Date(0).toISOString(),
    updated_at:
      dateValue(valueFrom(raw, "updated_at", "updatedAt")) ??
      new Date(0).toISOString(),
  };
}

function normalizeTimeZone(value: unknown): "Africa/Cairo" | null {
  return value === "Africa/Cairo" ? value : null;
}

function normalizeIntentState(value: unknown): PublicationIntentV1["state"] {
  const state = lower(value);
  if (
    state === "draft" ||
    state === "awaiting_approval" ||
    state === "scheduled" ||
    state === "dispatching" ||
    state === "succeeded" ||
    state === "failed" ||
    state === "action_required" ||
    state === "cancelled"
  ) {
    return state;
  }
  throw new Error("Publishing response contained an unsupported intent state.");
}

export function toPublishingApproval(
  value: unknown,
  intent: PublicationIntentV1,
): PublishingApprovalView | null {
  if (!value) return null;
  const raw = asRecord(value);
  const decision = lower(valueFrom(raw, "decision"));
  return {
    contract_version: "publication-approval-v1",
    decision_id: String(
      valueFrom(raw, "decision_id", "decisionId", "id") ?? "",
    ),
    intent_id: String(
      valueFrom(raw, "intent_id", "intentId") ?? intent.intent_id,
    ),
    intent_version: numberValue(
      valueFrom(raw, "intent_version", "intentVersionAtDecision"),
      intent.version,
    ),
    candidate_id: String(
      valueFrom(raw, "candidate_id", "candidateId") ?? intent.candidate_id,
    ),
    candidate_checksum: String(
      valueFrom(raw, "candidate_checksum", "candidateChecksum") ??
        intent.candidate_checksum,
    ),
    mode: "real",
    target_id: String(
      valueFrom(raw, "target_id", "targetId") ?? intent.target_id ?? "",
    ),
    scheduled_local: String(
      valueFrom(raw, "scheduled_local", "scheduledLocalAt") ??
        intent.scheduled_local ??
        "",
    ),
    time_zone:
      normalizeTimeZone(valueFrom(raw, "time_zone", "timezone")) ??
      "Africa/Cairo",
    scheduled_utc:
      dateValue(valueFrom(raw, "scheduled_utc", "scheduledUtcAt")) ??
      intent.scheduled_utc ??
      new Date(0).toISOString(),
    decided_by_user_id: String(
      valueFrom(raw, "decided_by_user_id", "decidedByUserId") ?? "",
    ),
    decided_at:
      dateValue(valueFrom(raw, "decided_at", "decidedAt")) ??
      new Date(0).toISOString(),
    approval_fingerprint: String(
      valueFrom(raw, "approval_fingerprint", "approvalFingerprint") ?? "",
    ),
    decision: decision === "rejected" ? "rejected" : "approved",
    notes: nullableString(raw.notes),
  };
}

export function toPublishingAttempt(value: unknown): PublicationAttemptV1 {
  const raw = asRecord(value);
  return {
    contract_version: "publication-attempt-v1",
    attempt_id: String(valueFrom(raw, "attempt_id", "attemptId", "id") ?? ""),
    intent_id: String(valueFrom(raw, "intent_id", "intentId") ?? ""),
    intent_version: numberValue(
      valueFrom(raw, "intent_version", "intentVersion"),
      1,
    ),
    attempt_number: numberValue(
      valueFrom(raw, "attempt_number", "attemptSequence"),
      1,
    ),
    idempotency_key: String(
      valueFrom(raw, "idempotency_key", "idempotencyKey") ?? "",
    ),
    workflow_version: String(
      valueFrom(raw, "workflow_version", "workflowVersion") ?? "unknown",
    ),
    request_fingerprint: String(
      valueFrom(raw, "request_fingerprint", "providerRequestFingerprint") ?? "",
    ),
    state: normalizeAttemptState(valueFrom(raw, "state", "status")),
    started_at: dateValue(valueFrom(raw, "started_at", "startedAt")),
    finished_at: dateValue(valueFrom(raw, "finished_at", "finishedAt")),
    created_at:
      dateValue(valueFrom(raw, "created_at", "createdAt")) ??
      new Date(0).toISOString(),
  };
}

function normalizeAttemptState(value: unknown): PublicationAttemptV1["state"] {
  const state = lower(value);
  if (
    state === "running" ||
    state === "succeeded" ||
    state === "failed" ||
    state === "unknown" ||
    state === "cancelled"
  ) {
    return state;
  }
  return "queued";
}

export function toPublishingResult(value: unknown): PublicationResultV1 {
  const raw = asRecord(value);
  const mode = normalizeMode(raw.mode);
  const outcome = normalizeOutcome(raw.outcome);
  const base = {
    contract_version: "publication-result-v1" as const,
    result_id: String(valueFrom(raw, "result_id", "resultId", "id") ?? ""),
    attempt_id: String(valueFrom(raw, "attempt_id", "attemptId") ?? ""),
    intent_id: String(valueFrom(raw, "intent_id", "intentId") ?? ""),
    intent_version: numberValue(
      valueFrom(raw, "intent_version", "intentVersion"),
      1,
    ),
    occurred_at:
      dateValue(valueFrom(raw, "occurred_at", "occurredAt")) ??
      new Date(0).toISOString(),
  };

  if (outcome === "published") {
    return {
      ...base,
      mode: "real",
      outcome,
      provider: "meta",
      remote_publication_id: String(
        valueFrom(raw, "remote_publication_id", "remotePublicationId") ?? "",
      ),
      remote_url: nullableString(valueFrom(raw, "remote_url", "remoteUrl")),
      export_artifact_id: null,
      simulation_reference_id: null,
      simulation_label: null,
      error_code: null,
      retryable: false,
      reconciliation_required: false,
    };
  }

  if (outcome === "exported") {
    return {
      ...base,
      mode: "manual_export",
      outcome,
      provider: null,
      remote_publication_id: null,
      remote_url: null,
      export_artifact_id: String(
        valueFrom(raw, "export_artifact_id", "exportArtifactId") ?? "",
      ),
      simulation_reference_id: null,
      simulation_label: null,
      error_code: null,
      retryable: false,
      reconciliation_required: false,
    };
  }

  if (outcome === "simulated") {
    return {
      ...base,
      mode: "simulation",
      outcome,
      provider: null,
      remote_publication_id: null,
      remote_url: null,
      export_artifact_id: null,
      simulation_reference_id: String(
        valueFrom(raw, "simulation_reference_id", "simulationReferenceId") ??
          "",
      ),
      simulation_label: "SIMULATION",
      error_code: null,
      retryable: false,
      reconciliation_required: false,
    };
  }

  if (outcome === "unknown") {
    return {
      ...base,
      mode: "real",
      outcome,
      provider: "meta",
      remote_publication_id: null,
      remote_url: null,
      export_artifact_id: null,
      simulation_reference_id: null,
      simulation_label: null,
      error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
      retryable: false,
      reconciliation_required: true,
    };
  }

  if (outcome === "cancelled") {
    return {
      ...base,
      mode,
      outcome,
      provider: null,
      remote_publication_id: null,
      remote_url: null,
      export_artifact_id: null,
      simulation_reference_id: null,
      simulation_label: mode === "simulation" ? "SIMULATION" : null,
      error_code: null,
      retryable: false,
      reconciliation_required: false,
    };
  }

  return {
    ...base,
    mode,
    outcome,
    provider: mode === "real" ? "meta" : null,
    remote_publication_id: null,
    remote_url: null,
    export_artifact_id: null,
    simulation_reference_id: null,
    simulation_label: mode === "simulation" ? "SIMULATION" : null,
    error_code: (nullableString(valueFrom(raw, "error_code", "errorCode")) ??
      "PUBLISHING_PROVIDER_FAILURE") as Exclude<
      PublicationResultV1["error_code"],
      null | "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN"
    >,
    retryable: raw.retryable === true,
    reconciliation_required: false,
  };
}

function normalizeOutcome(value: unknown): PublicationResultV1["outcome"] {
  const outcome = lower(value);
  if (
    outcome === "published" ||
    outcome === "exported" ||
    outcome === "simulated" ||
    outcome === "failed" ||
    outcome === "cancelled" ||
    outcome === "unknown"
  ) {
    return outcome;
  }
  return "failed";
}

export function toPublishingIntentDetail(
  value: unknown,
): PublishingIntentDetailView {
  const raw = asRecord(value);
  const intent = toPublishingIntent(value);
  const approvalSource =
    valueFrom(raw, "approval") ??
    (Array.isArray(raw.approvals) ? raw.approvals[0] : null);
  const targetSource = valueFrom(raw, "target") ?? null;
  const attemptsSource = valueFrom(raw, "attempts");
  const resultsSource = valueFrom(raw, "results");

  return {
    publication_intent: intent,
    approval: toPublishingApproval(approvalSource, intent),
    target: targetSource ? toPublishingTarget(targetSource) : null,
    attempts: Array.isArray(attemptsSource)
      ? attemptsSource.map(toPublishingAttempt)
      : [],
    results: Array.isArray(resultsSource)
      ? resultsSource.map(toPublishingResult)
      : [],
  };
}

export function toPublishingExportState(value: unknown): PublishingExportState {
  const raw = asRecord(value);
  const manifest = asRecord(valueFrom(raw, "manifest"));
  const status = lower(valueFrom(raw, "status", "state"));
  const exportType = lower(valueFrom(raw, "exportType", "export_type"));
  const ready =
    status === "ready" ||
    exportType === "completed" ||
    Boolean(raw.download_url);
  const failed = status === "failed" || exportType === "failed";
  const artifactId = nullableString(
    valueFrom(raw, "artifact_id", "artifactId"),
  );
  const checksum = nullableString(raw.checksum);
  const expiresAt = dateValue(
    valueFrom(
      raw,
      "download_expires_at",
      "downloadExpiresAt",
      "expires_at",
      "expiresAt",
    ),
  );

  if (ready) {
    return {
      status: "ready",
      artifactId: artifactId ?? "",
      checksum,
      expiresAt,
      manifest:
        Object.keys(manifest).length > 0
          ? (manifest as unknown as PublicationExportManifestV1)
          : null,
      downloadUrl: nullableString(
        valueFrom(raw, "download_url", "downloadUrl"),
      ),
    };
  }

  if (failed) {
    return {
      status: "failed",
      artifactId,
      checksum,
      expiresAt,
      manifest: null,
      downloadUrl: null,
    };
  }

  return {
    status: "pending",
    artifactId,
    checksum,
    expiresAt,
    manifest: null,
    downloadUrl: null,
  };
}

export async function listPublishingCandidates(): Promise<
  readonly PublicationCandidateSummaryV1[]
> {
  const response = await request<unknown>("/publication-candidates");
  const values = arrayValue(response, "candidates");
  return values.map(toPublishingCandidate);
}

export async function getPublishingCandidate(
  candidateId: string,
): Promise<PublicationCandidateSummaryV1> {
  return toPublishingCandidate(
    await request(`/publication-candidates/${candidateId}`),
  );
}

export async function listPublishingIntents(): Promise<
  readonly PublicationIntentV1[]
> {
  const response = await request<unknown>("/publication-intents");
  const values = arrayValue(
    response,
    "publication_intents",
    "publicationIntents",
  );
  return values.map(toPublishingIntent);
}

export async function getPublishingIntent(
  intentId: string,
): Promise<PublishingIntentDetailView> {
  const [intentResponse, attemptsResponse] = await Promise.all([
    request(`/publication-intents/${intentId}`),
    request<unknown>(`/publication-intents/${intentId}/attempts`).catch(
      () => null,
    ),
  ]);
  const detail = toPublishingIntentDetail(intentResponse);
  if (!attemptsResponse) return detail;
  const attempts = arrayValue(attemptsResponse, "attempts");
  const results = Array.isArray(attemptsResponse)
    ? []
    : arrayValue(attemptsResponse, "results");
  return {
    ...detail,
    attempts: attempts.map(toPublishingAttempt),
    results:
      results.length > 0 ? results.map(toPublishingResult) : detail.results,
  };
}

export async function listPublishingTargets(): Promise<
  readonly PublishingTargetPublicV1[]
> {
  const response = await request<unknown>("/publishing-targets");
  const values = arrayValue(response, "targets");
  return values.map(toPublishingTarget);
}

export type PublishingMetaConnectResponse = {
  readonly contract_version: "meta-connection-v1";
  readonly connection_id: string;
  readonly authorization_url: string;
  readonly expires_at: string;
};

export type PublishingMetaChannelOption = {
  readonly channel: "facebook" | "instagram";
  readonly account_id: string;
  readonly display_name: string;
  readonly capability_status: "supported" | "unsupported";
  readonly blockers: readonly string[];
};

export type PublishingMetaAccountOption = {
  readonly page: PublishingMetaChannelOption;
  readonly instagram: PublishingMetaChannelOption | null;
};

export type PublishingMetaPendingSelection = {
  readonly contract_version: "meta-connection-v1";
  readonly connection_id: string;
  readonly requested_channel: "facebook" | "instagram" | null;
  readonly requested_capability: string;
  readonly expires_at: string | null;
  readonly performance_capability: MetaPerformanceCapabilityV1;
  readonly options: readonly PublishingMetaAccountOption[];
};

/**
 * Issue #175: initiates the Meta OAuth journey. The API returns only a
 * connection id + authorization URL; the browser redirects to Meta and NEVER
 * handles an authorization code, token, credential reference, or ciphertext.
 */
export async function connectMetaPublishingTarget(input: {
  channel: "facebook" | "instagram";
  locale?: string;
  returnPath?: string;
  fingerprint?: string;
}): Promise<PublishingMetaConnectResponse> {
  return request("/publishing-targets/meta/connect", {
    method: "POST",
    body: {
      provider: "META",
      channel: input.channel,
      locale: input.locale,
      return_path: input.returnPath,
      fingerprint: input.fingerprint,
    },
  });
}

/** Safe pending-account selection metadata (display metadata + blockers —
 *  never tokens). */
export async function getMetaPendingSelection(
  connectionId: string,
): Promise<PublishingMetaPendingSelection> {
  return request(`/publishing-targets/meta/pending/${connectionId}`, {
    headers: { "x-connection-fingerprint": getConnectionFingerprint() },
  });
}

/** Creates CONNECTED targets only after live capability verification. */
export async function selectMetaTargets(input: {
  connectionId: string;
  pageId: string;
  includeInstagram: boolean;
}): Promise<readonly PublishingTargetPublicV1[]> {
  const response = await request<unknown>("/publishing-targets/meta/select", {
    method: "POST",
    body: {
      connectionId: input.connectionId,
      pageId: input.pageId,
      includeInstagram: input.includeInstagram,
      fingerprint: getConnectionFingerprint(),
    },
  });
  const values = Array.isArray(response) ? response : [response];
  return values.map(toPublishingTarget);
}

/** Safe disconnect: cancels scheduled real intents + revokes the credential
 *  when unused. */
export async function disconnectPublishingTarget(
  target: PublishingTargetPublicV1,
): Promise<PublishingTargetPublicV1> {
  const response = await request<unknown>(
    `/publishing-targets/${target.target_id}/disconnect`,
    { method: "POST" },
  );
  return toPublishingTarget(response);
}

export async function verifyPublishingTarget(
  target: PublishingTargetPublicV1,
): Promise<PublishingTargetPublicV1> {
  const response = await request<unknown>(
    `/publishing-targets/${target.target_id}/verify`,
    {
      method: "POST",
      body: {
        expectedTargetVersion: target.version,
        idempotencyKey: createIdempotencyKey(),
      },
    },
  );
  return toPublishingTarget(unwrap(response, "target") ?? response);
}

export async function getPublishingExport(
  intentId: string,
): Promise<PublishingExportState> {
  const response = await request<unknown>(
    `/publication-intents/${intentId}/export`,
  );
  const value = Array.isArray(response) ? response.at(-1) : response;
  return toPublishingExportState(value ?? null);
}

export async function fetchPublishingAsset(assetId: string): Promise<Blob> {
  const response = await apiRequest(`/content-assets/${assetId}`);
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

export async function downloadPublishingExport(
  intentId: string,
): Promise<Blob> {
  const response = await apiRequest(
    `/publication-intents/${intentId}/export/download`,
  );
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

export function createPublishingIntent(
  candidateId: string,
  mode: PublishingMode,
): Promise<PublicationIntentV1> {
  return request("/publication-intents", {
    method: "POST",
    body: {
      candidateId,
      mode: mode.toUpperCase(),
      idempotencyKey: createIdempotencyKey(),
    },
  }).then(toPublishingIntent);
}

export function schedulePublishingIntent(
  intent: PublicationIntentV1,
  targetId: string,
  scheduledLocalAt: string,
): Promise<PublicationIntentV1> {
  return request(`/publication-intents/${intent.intent_id}/schedule`, {
    method: "PUT",
    body: {
      targetId,
      scheduledLocalAt,
      timezone: "Africa/Cairo",
      currentVersion: intent.version,
      idempotencyKey: createIdempotencyKey(),
    },
  }).then((value) =>
    toPublishingIntent(
      unwrap(value, "publication_intent", "publicationIntent"),
    ),
  );
}

export function reschedulePublishingIntent(
  intent: PublicationIntentV1,
  targetId: string,
  scheduledLocalAt: string,
): Promise<PublicationIntentV1> {
  return request(`/publication-intents/${intent.intent_id}/reschedule`, {
    method: "POST",
    body: {
      targetId,
      scheduledLocalAt,
      timezone: "Africa/Cairo",
      currentVersion: intent.version,
      idempotencyKey: createIdempotencyKey(),
    },
  }).then((value) =>
    toPublishingIntent(
      unwrap(value, "publication_intent", "publicationIntent"),
    ),
  );
}

export function approvePublishingIntent(
  intent: PublicationIntentV1,
): Promise<PublicationIntentV1> {
  return request(`/publication-intents/${intent.intent_id}/decisions`, {
    method: "POST",
    body: {
      decision: "APPROVED",
      currentVersion: intent.version,
      candidateChecksum: intent.candidate_checksum,
      idempotencyKey: createIdempotencyKey(),
    },
  }).then((value) => {
    const raw = asRecord(value);
    return toPublishingIntent(
      unwrap(raw, "intent", "publication_intent", "publicationIntent"),
    );
  });
}

export function cancelPublishingIntent(
  intent: PublicationIntentV1,
): Promise<PublicationIntentV1> {
  return request(`/publication-intents/${intent.intent_id}/cancel`, {
    method: "POST",
    body: {
      currentVersion: intent.version,
      idempotencyKey: createIdempotencyKey(),
    },
  }).then((value) =>
    toPublishingIntent(
      unwrap(value, "publication_intent", "publicationIntent"),
    ),
  );
}

export function retryPublishingIntent(
  intent: PublicationIntentV1,
  expectedLastAttemptNumber: number,
): Promise<PublicationIntentV1> {
  return request(`/publication-intents/${intent.intent_id}/retry`, {
    method: "POST",
    body: {
      currentVersion: intent.version,
      expectedLastAttemptNumber,
      idempotencyKey: createIdempotencyKey(),
    },
  }).then((value) =>
    toPublishingIntent(
      unwrap(value, "intent", "publication_intent", "publicationIntent"),
    ),
  );
}

export function dispatchPublishingLocalAction(
  intent: PublicationIntentV1,
): Promise<PublicationIntentV1> {
  const action =
    intent.mode === "manual_export" ? "dispatch-export" : "dispatch-simulation";
  return request(`/publication-intents/${intent.intent_id}/${action}`, {
    method: "POST",
    body: { idempotencyKey: createIdempotencyKey() },
  }).then((value) =>
    toPublishingIntent(
      unwrap(value, "intent", "publication_intent", "publicationIntent"),
    ),
  );
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `publishing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getPublishingJourney(): Promise<CurrentJourneyResponse> {
  return request<CurrentJourneyResponse>("/journey/current");
}
