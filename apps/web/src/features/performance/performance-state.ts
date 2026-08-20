import type {
  CurrentJourneyResponse,
  PerformanceMetricName,
  PerformanceMetricValueV1,
  PerformancePostProjectionV1,
  PerformanceWindow,
} from '@marketmind/contracts'

export const PERFORMANCE_STAGE_ORDER = ['published', '24h', '72h', '7d'] as const
export type PerformanceStage = (typeof PERFORMANCE_STAGE_ORDER)[number]

/** The first journey milestone the owner still needs before performance
 *  monitoring is meaningful: a confirmed business profile, an available
 *  content strategy, or a content cycle producing approved posts. */
export type PerformanceSetupRequirement = 'profile' | 'strategy' | 'content'

/** Next-step guidance shown before the owner has a publishable setup. */
export type PerformanceSetupAction = {
  readonly requirement: PerformanceSetupRequirement
  readonly destination: string
  readonly labelKey:
    | 'startDiscovery'
    | 'continueDiscovery'
    | 'reviewProfile'
    | 'viewDiscovery'
    | 'goStrategy'
    | 'goContent'
}

/** Performance monitoring needs a confirmed business profile, an available
 *  strategy, and a content cycle. Until the journey provides all three, route
 *  the owner back to the exact next step instead of treating the missing setup
 *  as a failure. Returns null when the owner is ready to load evidence. */
export function performanceSetupAction(
  journey: CurrentJourneyResponse,
): PerformanceSetupAction | null {
  if (journey.journey.profile === null) {
    const action = journey.primary_action
    switch (action.type) {
      case 'start_discovery':
        return {
          requirement: 'profile',
          destination: action.destination,
          labelKey: 'startDiscovery',
        }
      case 'continue_discovery':
        return {
          requirement: 'profile',
          destination: action.destination,
          labelKey: 'continueDiscovery',
        }
      case 'review_profile':
        return {
          requirement: 'profile',
          destination: action.destination,
          labelKey: 'reviewProfile',
        }
      case 'view_discovery':
        return {
          requirement: 'profile',
          destination: action.destination,
          labelKey: 'viewDiscovery',
        }
      case 'view_strategy':
        return {
          requirement: 'strategy',
          destination: action.destination,
          labelKey: 'goStrategy',
        }
      case 'none':
        return {
          requirement: 'profile',
          destination: '/discovery/new',
          labelKey: 'startDiscovery',
        }
    }
  }

  if (journey.future_phase.availability !== 'available') {
    return {
      requirement: 'strategy',
      destination: '/strategy',
      labelKey: 'goStrategy',
    }
  }

  if (journey.content?.ready !== true) {
    return {
      requirement: 'content',
      destination: '/content',
      labelKey: 'goContent',
    }
  }

  return null
}

export type PerformanceStageStatus =
  | 'scheduled'
  | 'collecting'
  | 'retrying'
  | 'blocked'
  | 'unavailable'
  | 'complete'

export const PERFORMANCE_METRIC_ORDER: readonly PerformanceMetricName[] = [
  'post_media_view',
  'post_total_media_view_unique',
  'post_clicks',
]

const WINDOW_STAGES: readonly PerformanceWindow[] = ['24h', '72h', '7d']

export function stageStatus(
  post: PerformancePostProjectionV1,
  stage: PerformanceStage,
  now = new Date(),
): PerformanceStageStatus {
  if (stage === 'published') return 'complete'

  const snapshot = snapshotForWindow(post, stage)
  if (snapshot) return 'complete'

  const window = syncWindowForStage(post, stage)
  if (!window) return 'scheduled'

  if (window.state === 'retryable') return 'retrying'
  if (window.state === 'queued' || window.state === 'leased') {
    return new Date(window.due_at).getTime() > now.getTime()
      ? 'scheduled'
      : 'collecting'
  }
  if (window.state === 'succeeded') return 'unavailable'

  if (window.last_error_code === 'PERFORMANCE_PERMISSION_REQUIRED') {
    return 'blocked'
  }
  return 'unavailable'
}

export function snapshotForWindow(
  post: PerformancePostProjectionV1,
  window: PerformanceStage,
) {
  if (!WINDOW_STAGES.includes(window as PerformanceWindow)) return null
  return post.snapshots.find((snapshot) => snapshot.window === window) ?? null
}

export function syncWindowForStage(
  post: PerformancePostProjectionV1,
  window: PerformanceWindow,
) {
  return post.sync_windows?.find((entry) => entry.window === window) ?? null
}

export function metricValueFor(
  post: PerformancePostProjectionV1,
  window: PerformanceWindow,
  metric: PerformanceMetricName,
): PerformanceMetricValueV1 {
  return (
    snapshotForWindow(post, window)?.metrics[metric] ?? {
      status: 'unavailable',
      reason: 'not_yet_observed',
    }
  )
}

export function baselineProgress(
  observed: number,
  required: number,
): number {
  if (required <= 0) return 0
  return Math.min(100, Math.round((observed / required) * 100))
}
