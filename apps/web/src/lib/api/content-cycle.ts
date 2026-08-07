import type {
  ContentCycle,
  ContentPack,
  ContentProgressEvent,
  ContentWeekContext,
  CreateContentCycleRequest,
  ContentCycleResponse,
  ContentWeekListResponse,
  UpdateContentWeekContextRequest,
  GenerateContentPackRequest,
} from "@marketmind/contracts";
import { apiRequest, type ApiRequestOptions } from "@/lib/api/client";

export type ContentCycleApiError = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};

/**
 * Transport response returned by POST /content-cycles/:id/weeks/:week/generate
 * and POST /content-packs/:id/retry in NestJS controller.
 * Note: Shared contracts define GenerateContentWeekResponse, but HTTP endpoint
 * returns this queue-oriented payload.
 */
export type QueuedContentPackResponse = {
  readonly content_pack: ContentPack;
  readonly status: "queued";
  readonly correlation_id: string;
};

async function request<T>(
  path: string,
  init?: ApiRequestOptions,
): Promise<T> {
  const res = await apiRequest(path, init);

  if (!res.ok) {
    let code = "api_error";
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.code ?? body?.error?.code ?? code;
      message = body?.message ?? body?.error?.message ?? message;
    } catch {
      // ignore JSON parse failure
    }
    const err: ContentCycleApiError = { status: res.status, code, message };
    throw err;
  }

  return res.json() as Promise<T>;
}

export function createContentCycle(
  payload: CreateContentCycleRequest,
  signal?: AbortSignal,
): Promise<ContentCycleResponse> {
  return request<ContentCycleResponse>("/content-cycles", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function getContentCycle(
  cycleId: string,
  signal?: AbortSignal,
): Promise<ContentCycle> {
  return request<ContentCycle>(`/content-cycles/${encodeURIComponent(cycleId)}`, {
    signal,
  });
}

export function listContentWeeks(
  cycleId: string,
  signal?: AbortSignal,
): Promise<ContentWeekListResponse> {
  return request<ContentWeekListResponse>(
    `/content-cycles/${encodeURIComponent(cycleId)}/weeks`,
    { signal },
  );
}

export function updateContentWeekContext(
  cycleId: string,
  weekNumber: number,
  payload: UpdateContentWeekContextRequest,
  signal?: AbortSignal,
): Promise<ContentWeekContext> {
  return request<ContentWeekContext>(
    `/content-cycles/${encodeURIComponent(cycleId)}/weeks/${weekNumber}/context`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export function generateContentWeek(
  cycleId: string,
  weekNumber: number,
  payload: GenerateContentPackRequest,
  signal?: AbortSignal,
): Promise<QueuedContentPackResponse> {
  return request<QueuedContentPackResponse>(
    `/content-cycles/${encodeURIComponent(cycleId)}/weeks/${weekNumber}/generate`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export function getContentPack(
  packId: string,
  signal?: AbortSignal,
): Promise<ContentPack> {
  return request<ContentPack>(`/content-packs/${encodeURIComponent(packId)}`, {
    signal,
  });
}

export function getContentPackProgress(
  packId: string,
  signal?: AbortSignal,
): Promise<readonly ContentProgressEvent[]> {
  return request<readonly ContentProgressEvent[]>(
    `/content-packs/${encodeURIComponent(packId)}/progress`,
    { signal },
  );
}

export function retryContentPack(
  packId: string,
  signal?: AbortSignal,
): Promise<QueuedContentPackResponse> {
  return request<QueuedContentPackResponse>(
    `/content-packs/${encodeURIComponent(packId)}/retry`,
    {
      method: "POST",
      signal,
    },
  );
}
