import { apiRequest } from "./client"

export type KnowledgeLibraryEntryRow = {
  entry: {
    id: string
    slug: string
    latestVersion: number
    createdAt: string
  }
  latest: {
    id: string
    version: number
    kind: string
    title: string
    summary: string
    locale: string
    reviewStatus: string
    evidenceTier: string
    effectiveAt: string
    expiresAt: string | null
    reviewer: string | null
    reviewedAt: string | null
  } | null
  versionCount: number
}

export type KnowledgeLibraryListParams = {
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export type KnowledgeLibraryListResponse = {
  items: KnowledgeLibraryEntryRow[]
  total: number
  page: number
  pageSize: number
}

export type IngestionRunRow = {
  id: string
  status: string
  actor: string
  commitSha: string | null
  enteredCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, init)
  if (!response.ok) {
    throw Object.assign(new Error("Knowledge library admin request failed"), {
      status: response.status,
    })
  }
  return (await response.json()) as T
}

export async function listKnowledgeLibraryEntries(
  params: KnowledgeLibraryListParams = {},
): Promise<KnowledgeLibraryListResponse> {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set("status", params.status)
  if (params.search) searchParams.set("search", params.search)
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))

  const qs = searchParams.toString()
  return request(`/admin/library/entries${qs ? `?${qs}` : ""}`)
}

export function approveKnowledgeLibraryEntry(
  slug: string,
): Promise<{ reviewStatus: string; version: number }> {
  return request(`/admin/library/entries/${slug}/approve`, {
    method: "POST",
  })
}

export function rejectKnowledgeLibraryEntry(
  slug: string,
): Promise<{ reviewStatus: string; version: number }> {
  return request(`/admin/library/entries/${slug}/reject`, {
    method: "POST",
  })
}

export type IngestTriggerResponse = {
  id: string
  status: string
  actor: string
  startedAt: string
}

export function triggerKnowledgeLibraryIngest(): Promise<IngestTriggerResponse> {
  return request("/admin/library/ingest", { method: "POST" })
}

export type IngestionRunListResponse = {
  items: IngestionRunRow[]
  total: number
  page: number
  pageSize: number
}

export async function listKnowledgeLibraryIngestionRuns(
  params: { page?: number; pageSize?: number } = {},
): Promise<IngestionRunListResponse> {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))

  const qs = searchParams.toString()
  return request(`/admin/library/ingestion-runs${qs ? `?${qs}` : ""}`)
}