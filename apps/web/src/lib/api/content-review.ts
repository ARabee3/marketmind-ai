import type {
  ContentDecisionResponse,
} from '@marketmind/contracts'
import { apiRequest } from './client'
import type {
  BulkDecisionRequest,
  BulkDecisionResponse,
  ContentPackWorkspace,
  SingleDecisionRequest,
} from '@/features/content/review/types/review.types'

export async function getPackWorkspace(
  packId: string,
): Promise<ContentPackWorkspace> {
  const response = await apiRequest(`/content-packs/${packId}/workspace`)
  if (!response.ok) {
    const err = new Error(
      `Aggregate pack workspace endpoint returned ${response.status}`,
    ) as Error & { status?: number }
    err.status = response.status
    throw err
  }
  return (await response.json()) as ContentPackWorkspace
}

export async function submitItemDecision(
  packId: string,
  itemId: string,
  request: SingleDecisionRequest,
): Promise<ContentDecisionResponse> {
  const mappedDecision =
    request.decision === 'approve'
      ? 'approved'
      : request.decision === 'reject'
        ? 'rejected'
        : 'revision_requested'

  const response = await apiRequest(
    `/content-packs/${packId}/items/${itemId}/decisions`,
    {
      method: 'POST',
      body: {
        content_item_id: request.item_id,
        content_item_version_id: request.version_id,
        content_item_version_checksum: request.checksum,
        decision: mappedDecision,
        revision_notes: request.notes ?? null,
        idempotency_key: request.idempotency_key,
      },
    },
  )

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      code?: string
      message?: string
      latest_version_id?: string
    }
    const err = new Error(
      errorBody.message || `Decision failed with status ${response.status}`,
    ) as Error & { code?: string; latestVersionId?: string; status?: number }
    err.code = errorBody.code || 'CONTENT_APPROVAL_BLOCKED'
    err.latestVersionId = errorBody.latest_version_id
    err.status = response.status
    throw err
  }

  return (await response.json()) as ContentDecisionResponse
}

export async function submitBulkDecisions(
  packId: string,
  request: BulkDecisionRequest,
): Promise<BulkDecisionResponse> {
  const response = await apiRequest(`/content-packs/${packId}/decisions/bulk`, {
    method: 'POST',
    body: request,
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      code?: string
      message?: string
    }
    const err = new Error(
      errorBody.message || `Bulk decision failed with status ${response.status}`,
    ) as Error & { code?: string }
    err.code = errorBody.code || 'CONTENT_APPROVAL_BLOCKED'
    throw err
  }

  return (await response.json()) as BulkDecisionResponse
}

export async function fetchAuthenticatedAssetBlob(
  assetId: string,
): Promise<Blob> {
  const response = await apiRequest(`/content-assets/${assetId}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch asset bytes: ${response.status}`)
  }
  return await response.blob()
}
