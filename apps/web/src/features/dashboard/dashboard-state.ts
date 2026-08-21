import type {
  CurrentJourneyResponse,
  CurrentJourneyStrategyBusinessSnapshot,
  StrategyStatus,
} from '@marketmind/contracts'

export type DashboardJourneyKind =
  | 'empty'
  | 'active'
  | 'review'
  | 'confirmed'
  | 'unavailable'
  | 'strategy_preparing'
  | 'strategy_draft'
  | 'strategy_approved'
  | 'strategy_rejected'
  | 'error'

export type DashboardContentStatus = 'locked' | 'active' | 'done'

export type DashboardPrimaryActionType =
  CurrentJourneyResponse['primary_action']['type']

export type DashboardStrategyLockedReason =
  CurrentJourneyResponse['future_phase']['reason']

export type DashboardJourneyState = {
  readonly kind: DashboardJourneyKind
  readonly ownerName: string | null
  readonly businessName: string | null
  readonly businessType: string | null
  readonly location: string | null
  readonly readinessPercent: number | null
  readonly profileVersion: number | null
  readonly primaryActionType: DashboardPrimaryActionType
  readonly primaryHref: string | null
  readonly strategyLockedReason: DashboardStrategyLockedReason
  readonly strategyStatus: StrategyStatus | null
  readonly contentStatus: DashboardContentStatus
}

export function mapCurrentJourney(
  response: CurrentJourneyResponse,
): DashboardJourneyState {
  // When an active Strategy exists, journey.currentAction routes the owner
  // to "view_strategy". The dashboard view model must follow that precedence
  // so a user with a saved Strategy draft never lands on an empty/discovery
  // state that ignores their progress. See issue #114.
  const strategyBusiness = strategyBusinessSnapshot(response)

  const base = {
    ownerName: response.owner.full_name,
    businessName: strategyBusiness?.business_name ?? businessName(response),
    businessType: strategyBusiness?.business_type ?? businessType(response),
    location: strategyBusiness
      ? formattedLocation(strategyBusiness.city, strategyBusiness.area)
      : location(response),
    readinessPercent: readinessPercent(response),
    profileVersion: strategyBusiness?.profile_version ?? profileVersion(response),
    primaryActionType: response.primary_action.type,
    primaryHref: response.primary_action.destination,
    strategyLockedReason: response.future_phase.reason,
    strategyStatus: response.future_phase.status,
    contentStatus: contentStatus(response),
  }

  if (response.future_phase.availability === 'available') {
    return {
      ...base,
      kind: strategyJourneyKind(response.future_phase.status),
    }
  }

  switch (response.journey.state) {
    case 'no_journey':
      return { ...base, kind: 'empty' }
    case 'discovery_active':
      return { ...base, kind: 'active' }
    case 'discovery_summary_review':
      return { ...base, kind: 'review' }
    case 'discovery_confirmed':
      return { ...base, kind: 'confirmed' }
    case 'discovery_unavailable':
      return { ...base, kind: 'unavailable' }
  }
}

/**
 * Retryable failure state shown when the journey endpoint could not be reached
 * or returned a server/network error. Intentionally exposes NO Start
 * Discovery action — a failed dashboard load must not be presented as the
 * journey being unavailable. The only recovery is Retry.
 */
export function errorDashboardState(): DashboardJourneyState {
  return {
    kind: 'error',
    ownerName: null,
    businessName: null,
    businessType: null,
    location: null,
    readinessPercent: null,
    profileVersion: null,
    primaryActionType: 'none',
    primaryHref: null,
    strategyLockedReason: 'discovery_required',
    strategyStatus: null,
    contentStatus: 'locked',
  }
}

function contentStatus(response: CurrentJourneyResponse): DashboardContentStatus {
  if (response.content?.pack?.status === 'approved') return 'done'
  if (response.content?.ready) return 'active'
  return 'locked'
}

function strategyJourneyKind(
  status: Extract<
    CurrentJourneyResponse['future_phase'],
    { availability: 'available' }
  >['status'],
): DashboardJourneyKind {
  switch (status) {
    case 'ready':
    case 'retrieving':
    case 'queued':
    case 'generating':
    case 'validating':
      return 'strategy_preparing'
    case 'draft':
      return 'strategy_draft'
    case 'approved':
      return 'strategy_approved'
    case 'rejected':
      return 'strategy_rejected'
  }
}

function strategyBusinessSnapshot(
  response: CurrentJourneyResponse,
): CurrentJourneyStrategyBusinessSnapshot | null {
  if (response.future_phase.availability === 'available') {
    return response.future_phase.business
  }
  return null
}

function businessName(response: CurrentJourneyResponse): string | null {
  return (
    response.journey.profile?.business_name ??
    response.journey.discovery?.business_summary.business_name ??
    null
  )
}

function businessType(response: CurrentJourneyResponse): string | null {
  return (
    response.journey.profile?.business_type ??
    response.journey.discovery?.business_summary.business_type ??
    null
  )
}

function location(response: CurrentJourneyResponse): string | null {
  return formattedLocation(
    response.journey.profile?.city ?? response.journey.discovery?.business_summary.city ?? null,
    response.journey.profile?.area ?? response.journey.discovery?.business_summary.area ?? null,
  )
}

function formattedLocation(city: string | null, area: string | null): string | null {
  if (!city) return null
  if (!area) return city
  return `${area}, ${city}`
}

function readinessPercent(response: CurrentJourneyResponse): number | null {
  const readiness = response.journey.discovery?.readiness.profile_readiness
  if (readiness === undefined) return null
  return Math.round(readiness * 100)
}

function profileVersion(response: CurrentJourneyResponse): number | null {
  return response.journey.profile?.version ?? null
}
