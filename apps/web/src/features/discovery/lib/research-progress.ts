import type {
  DiscoveryProgressEvent,
  DiscoveryProgressStage,
  DiscoverySessionStatus,
} from '@marketmind/contracts'

export const RESEARCH_STAGES = [
  'queued',
  'query_planning',
  'metadata',
  'competitor_searching',
  'search',
  'filtering',
  'persisting',
  'ai_start',
  'ready',
] as const satisfies readonly Exclude<DiscoveryProgressStage, 'failed'>[]

const STAGE_PROGRESS: Record<Exclude<DiscoveryProgressStage, 'failed'>, readonly [number, number]> = {
  queued: [4, 8],
  query_planning: [10, 20],
  metadata: [22, 34],
  competitor_searching: [36, 51],
  search: [53, 68],
  filtering: [70, 79],
  persisting: [81, 89],
  ai_start: [91, 97],
  ready: [100, 100],
}

const STAGE_ESTIMATE_MINUTES: Record<Exclude<DiscoveryProgressStage, 'failed'>, number> = {
  queued: 3,
  query_planning: 3,
  metadata: 2,
  competitor_searching: 2,
  search: 1,
  filtering: 1,
  persisting: 1,
  ai_start: 0,
  ready: 0,
}

const READY_STATUSES = new Set<DiscoverySessionStatus>([
  'partial_ready',
  'ready_for_chat',
  'in_progress',
  'summary_ready',
  'confirmed',
  'research_failed',
])

export type ResearchProgress = {
  readonly currentStage: Exclude<DiscoveryProgressStage, 'failed'>
  readonly progressPercent: number
  readonly estimatedMinutes: number
  readonly complete: boolean
}

export function getResearchProgress(
  events: readonly DiscoveryProgressEvent[],
  sessionStatus: DiscoverySessionStatus | null,
): ResearchProgress {
  if (sessionStatus && READY_STATUSES.has(sessionStatus)) {
    return { currentStage: 'ready', progressPercent: 100, estimatedMinutes: 0, complete: true }
  }

  const latest = [...events]
    .sort((first, second) => second.seq - first.seq)
    .find((event) => event.stage !== 'failed' && !isResearchProgressWrapperEvent(event))
  const currentStage = latest?.stage === 'failed' || latest?.stage === undefined
    ? 'queued'
    : latest.stage
  const [started, completed] = STAGE_PROGRESS[currentStage]
  const progressPercent = latest?.status === 'complete' ? completed : started

  return {
    currentStage,
    progressPercent,
    estimatedMinutes: STAGE_ESTIMATE_MINUTES[currentStage],
    complete: false,
  }
}

export function getStageState(
  stage: Exclude<DiscoveryProgressStage, 'failed'>,
  events: readonly DiscoveryProgressEvent[],
  currentStage: Exclude<DiscoveryProgressStage, 'failed'>,
): 'complete' | 'current' | 'failed' | 'pending' {
  const stageEvents = events.filter((event) => event.stage === stage && !isResearchProgressWrapperEvent(event))
  if (stageEvents.some((event) => event.status === 'failed')) return 'failed'
  if (stageEvents.some((event) => event.status === 'complete')) return 'complete'
  if (stage === currentStage) return 'current'
  return 'pending'
}

export function isResearchProgressWrapperEvent(event: DiscoveryProgressEvent): boolean {
  return event.message_key === 'discovery.intelligence.started'
    || event.message_key === 'discovery.intelligence.completed'
}
