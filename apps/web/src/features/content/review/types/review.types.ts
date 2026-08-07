import type {
  ContentAsset,
  ContentDecision,
  ContentErrorCode,
  ContentItem,
  ContentItemVersion,
  ContentPack,
  ContentWeekContext,
  PublicationCandidateV1,
  UUID,
} from '@marketmind/contracts'

export type ContentPackWorkspaceItem = {
  item: ContentItem
  current_version: ContentItemVersion
  version_history: readonly ContentItemVersion[]
  assets: readonly ContentAsset[]
  decisions: readonly ContentDecision[]
  eligibility: {
    eligible_for_approval: boolean
    blockers: readonly ContentErrorCode[]
    warnings: readonly ContentErrorCode[]
  }
  publication_candidate: PublicationCandidateV1 | null
}

export type ContentPackWorkspace = {
  pack: ContentPack
  week_context: ContentWeekContext
  items: readonly ContentPackWorkspaceItem[]
}

export type SingleDecisionRequest = {
  item_id: UUID
  version_id: UUID
  checksum: string
  decision: 'approve' | 'reject' | 'revise'
  notes?: string | null
  idempotency_key: string
}

export type BulkDecisionRequestItem = {
  content_item_id: UUID
  content_item_version_id: UUID
  content_item_version_checksum: string
  decision: 'approved' | 'rejected' | 'revision_requested'
  revision_notes: string | null
  idempotency_key: string
}

export type BulkDecisionRequest = {
  decisions: readonly BulkDecisionRequestItem[]
}

export type BulkDecisionResultItem = {
  item_id: UUID
  status: 'approved' | 'rejected' | 'revision_requested' | 'ineligible'
  error?: {
    code: ContentErrorCode | string
    message: string
  }
}

export type BulkDecisionResponse = readonly BulkDecisionResultItem[]

export type DecisionRequestState =
  | { status: 'idle' }
  | { status: 'submitting'; decision: 'approve' | 'reject' | 'revise' }
  | { status: 'success' }
  | { status: 'error'; code: ContentErrorCode | string; message?: string }
  | { status: 'refreshing'; decision: 'approve' | 'reject' | 'revise' }
  | {
      status: 'conflict'
      latestVersionId?: string | null
      latestVersion?: ContentItemVersion
    }
