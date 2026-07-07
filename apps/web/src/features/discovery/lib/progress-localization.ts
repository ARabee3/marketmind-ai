/**
 * Typed mapping from backend Discovery progress message keys to frontend
 * translation keys. Keeps contract-shaped backend strings out of `next-intl`
 * calls and provides deterministic fallbacks for unknown keys.
 */

import type {
  DiscoveryProgressEvent,
  DiscoveryProgressStage,
  DiscoveryProgressStatus,
  DiscoverySessionStatus,
} from '@marketmind/contracts'
import type { TranslationKey } from '@/i18n/types'

export const KNOWN_PROGRESS_MESSAGE_KEYS = [
  'discovery.session.accepted',
  'discovery.intelligence.started',
  'discovery.intelligence.completed',
  'discovery.query_planning.started',
  'discovery.query_planning.completed',
  'discovery.metadata.started',
  'discovery.metadata.completed',
  'discovery.competitor_searching.started',
  'discovery.competitor_searching.completed',
  'discovery.search.started',
  'discovery.search.completed',
  'discovery.search.partial_failure',
  'discovery.filtering.started',
  'discovery.filtering.completed',
  'discovery.persisting.started',
  'discovery.persisting.completed',
  'discovery.ai.started',
  'discovery.ai.completed',
  'discovery.ai.first_question_ready',
  'discovery.ai.provider_unavailable',
  'discovery.ready_for_chat',
  'discovery.background.failed',
] as const

export type KnownProgressMessageKey = (typeof KNOWN_PROGRESS_MESSAGE_KEYS)[number]

const PROGRESS_MESSAGE_TO_TRANSLATION: Record<KnownProgressMessageKey, TranslationKey> = {
  'discovery.session.accepted': 'DiscoveryProgress.stepAccepted',
  'discovery.intelligence.started': 'DiscoveryProgress.stepSearch',
  'discovery.intelligence.completed': 'DiscoveryProgress.stepSearchComplete',
  'discovery.query_planning.started': 'DiscoveryProgress.stepQueryPlanning',
  'discovery.query_planning.completed': 'DiscoveryProgress.stepQueryPlanningComplete',
  'discovery.metadata.started': 'DiscoveryProgress.stepMetadata',
  'discovery.metadata.completed': 'DiscoveryProgress.stepMetadataComplete',
  'discovery.competitor_searching.started': 'DiscoveryProgress.stepCompetitorSearching',
  'discovery.competitor_searching.completed': 'DiscoveryProgress.stepCompetitorSearchingComplete',
  'discovery.search.started': 'DiscoveryProgress.stepSearch',
  'discovery.search.completed': 'DiscoveryProgress.stepSearchComplete',
  'discovery.search.partial_failure': 'DiscoveryProgress.stepSearchPartialFailure',
  'discovery.filtering.started': 'DiscoveryProgress.stepFiltering',
  'discovery.filtering.completed': 'DiscoveryProgress.stepFilteringComplete',
  'discovery.persisting.started': 'DiscoveryProgress.stepPersisting',
  'discovery.persisting.completed': 'DiscoveryProgress.stepPersistingComplete',
  'discovery.ai.started': 'DiscoveryProgress.stepAiStart',
  'discovery.ai.completed': 'DiscoveryProgress.stepAiFirstQuestionReady',
  'discovery.ai.first_question_ready': 'DiscoveryProgress.stepAiFirstQuestionReady',
  'discovery.ai.provider_unavailable': 'DiscoveryProgress.errorProviderFailure',
  'discovery.ready_for_chat': 'DiscoveryProgress.stepReadyForChat',
  'discovery.background.failed': 'DiscoveryProgress.errorResearchFailed',
}

const STAGE_TO_TRANSLATION: Record<DiscoveryProgressStage, TranslationKey> = {
  queued: 'DiscoveryProgress.stageQueued',
  query_planning: 'DiscoveryProgress.stageQueryPlanning',
  metadata: 'DiscoveryProgress.stageMetadata',
  competitor_searching: 'DiscoveryProgress.stageCompetitorSearching',
  search: 'DiscoveryProgress.stageSearch',
  filtering: 'DiscoveryProgress.stageFiltering',
  persisting: 'DiscoveryProgress.stagePersisting',
  ai_start: 'DiscoveryProgress.stageAiStart',
  ready: 'DiscoveryProgress.stageReady',
  failed: 'DiscoveryProgress.stageFailed',
}

const STATUS_TO_TRANSLATION: Record<DiscoveryProgressStatus, TranslationKey> = {
  started: 'DiscoveryProgress.statusStarted',
  progress: 'DiscoveryProgress.statusProgress',
  complete: 'DiscoveryProgress.statusComplete',
  failed: 'DiscoveryProgress.statusFailed',
}

export function isKnownProgressMessageKey(key: string): key is KnownProgressMessageKey {
  return (KNOWN_PROGRESS_MESSAGE_KEYS as readonly string[]).includes(key)
}

/**
 * Returns a typed translation key for the primary message of a progress event.
 * Falls back to a stage/status-based key for unknown backend keys so raw
 * backend text never becomes primary UI copy.
 */
export function getProgressEventMessageKey(event: DiscoveryProgressEvent): TranslationKey {
  if (event.message_key && isKnownProgressMessageKey(event.message_key)) {
    return PROGRESS_MESSAGE_TO_TRANSLATION[event.message_key]
  }
  return STATUS_TO_TRANSLATION[event.status]
}

/**
 * Returns a typed translation key for a progress stage name.
 */
export function getProgressStageKey(stage: DiscoveryProgressStage): TranslationKey {
  return STAGE_TO_TRANSLATION[stage]
}

/**
 * Returns a typed translation key for a progress event status.
 */
export function getProgressStatusKey(status: DiscoveryProgressStatus): TranslationKey {
  return STATUS_TO_TRANSLATION[status]
}

/**
 * Persistent research warnings derived from the authoritative PostgreSQL session
 * status. These must survive transient Socket.IO disconnects.
 */
export function getResearchWarningKey(
  status: DiscoverySessionStatus | null,
): Extract<
  TranslationKey,
  | 'DiscoveryProgress.errorPartialResearch'
  | 'DiscoveryProgress.errorResearchFailed'
> | null {
  if (status === 'partial_ready') return 'DiscoveryProgress.errorPartialResearch'
  if (status === 'research_failed') return 'DiscoveryProgress.errorResearchFailed'
  return null
}
