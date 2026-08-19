import { apiRequest } from "./client"

export type PublishingAdminResultRow = {
  id: string
  outcome: string
  provider: string | null
  remotePublicationId: string | null
  remoteUrl: string | null
  errorCode: string | null
  retryable: boolean
  sanitizedError: string | null
  occurredAt: string
  createdAt: string
  attempt: {
    id: string
    status: string
    attemptSequence: number
    sanitizedError: string | null
    startedAt: string | null
    finishedAt: string | null
  }
  intent: {
    id: string
    status: string
    mode: string
    scheduledUtcAt: string | null
    version: number
    businessId: string
    business: { id: string; displayName: string } | null
    candidate: {
      id: string
      channel: string
      format: string
      locale: string
    } | null
    target: {
      id: string
      provider: string
      channel: string
      displayName: string
    } | null
  }
}

export type PublishingAdminListParams = {
  outcome?: string
  page?: number
  pageSize?: number
}

export type PublishingAdminListResponse = {
  items: PublishingAdminResultRow[]
  total: number
  page: number
  pageSize: number
}

export type ResolveResultPayload = {
  resolution: "PUBLISHED" | "FAILED"
  reason: string
  remotePublicationId?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, init)
  if (!response.ok) {
    throw Object.assign(new Error("Publishing admin request failed"), {
      status: response.status,
    })
  }
  return (await response.json()) as T
}

export async function listPublishingAdminResults(
  params: PublishingAdminListParams = {},
): Promise<PublishingAdminListResponse> {
  const searchParams = new URLSearchParams()
  if (params.outcome) searchParams.set("outcome", params.outcome)
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))

  const qs = searchParams.toString()
  return request(`/publishing/admin/results${qs ? `?${qs}` : ""}`)
}

export function resolvePublishingAdminResult(
  resultId: string,
  payload: ResolveResultPayload,
): Promise<PublishingAdminResultRow> {
  return request(`/publishing/admin/results/${resultId}/resolve`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export type ResyncResponse = {
  queued: boolean
  reason: string
}

export function resyncPublishingAdminIntent(
  intentId: string,
): Promise<ResyncResponse> {
  return request(`/publishing/admin/intents/${intentId}/resync-schedule`, {
    method: "POST",
  })
}

export type SweepResponse = {
  ok: boolean
  message: string
}

export function triggerPublishingAdminSweep(): Promise<SweepResponse> {
  return request("/publishing/admin/sweep", { method: "POST" })
}