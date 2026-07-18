import type { CurrentJourneyResponse } from '@marketmind/contracts'

export type DashboardJourneyKind =
  | 'empty'
  | 'active'
  | 'review'
  | 'confirmed'
  | 'unavailable'
  | 'error'

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
}

export function mapCurrentJourney(
  response: CurrentJourneyResponse,
): DashboardJourneyState {
  const base = {
    ownerName: response.owner.full_name,
    businessName: businessName(response),
    businessType: businessType(response),
    location: location(response),
    readinessPercent: readinessPercent(response),
    profileVersion: profileVersion(response),
    primaryActionType: response.primary_action.type,
    primaryHref: response.primary_action.destination,
    strategyLockedReason: response.future_phase.reason,
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
  }
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
  const city =
    response.journey.profile?.city ??
    response.journey.discovery?.business_summary.city ??
    null
  const area =
    response.journey.profile?.area ??
    response.journey.discovery?.business_summary.area ??
    null

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
