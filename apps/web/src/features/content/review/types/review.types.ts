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
  item_id: UUID
  version_id: UUID
  checksum: string
}

export type BulkDecisionRequest = {
  items: readonly BulkDecisionRequestItem[]
  idempotency_key: string
}

export type BulkDecisionResultItem = {
  item_id: UUID
  version_id: UUID
  success: boolean
  decision_id?: UUID
  publication_candidate_id?: UUID
  error_code?: ContentErrorCode
  message?: string
}

export type BulkDecisionResponse = {
  results: readonly BulkDecisionResultItem[]
}

export type DecisionRequestState =
  | { status: 'idle' }
  | { status: 'submitting'; decision: 'approve' | 'reject' | 'revise' }
  | { status: 'success' }
  | { status: 'error'; code: ContentErrorCode | string; message?: string }
  | { status: 'conflict'; latestVersionId: UUID; latestVersion?: ContentItemVersion }
