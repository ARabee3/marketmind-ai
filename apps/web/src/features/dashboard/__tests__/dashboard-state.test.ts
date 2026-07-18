// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type {
  ActiveDiscoveryStatus,
  CurrentJourneyDiscoverySummary,
  CurrentJourneyResponse,
  UnavailableDiscoveryStatus,
} from '@marketmind/contracts'
import { mapCurrentJourney, errorDashboardState } from '../dashboard-state'

describe('mapCurrentJourney', () => {
  it('maps no journey to the discovery start action', () => {
    const state = mapCurrentJourney(responseWithNoJourney())

    expect(state.kind).toBe('empty')
    expect(state.primaryHref).toBe('/discovery/new')
    expect(state.strategyLockedReason).toBe('discovery_required')
  })

  it.each([
    'researching',
    'partial_ready',
    'ready_for_chat',
    'research_failed',
    'in_progress',
  ] satisfies ActiveDiscoveryStatus[])(
    'maps %s to an active resume state',
    (status) => {
      const state = mapCurrentJourney(responseWithActiveDiscovery(status))

      expect(state.kind).toBe('active')
      expect(state.primaryHref).toBe('/discovery/session-id')
      expect(state.businessName).toBe('Nile Sweets')
    },
  )

  it('maps summary_ready to profile review', () => {
    const state = mapCurrentJourney(responseWithSummaryReview())

    expect(state.kind).toBe('review')
    expect(state.primaryActionType).toBe('review_profile')
    expect(state.strategyLockedReason).toBe('profile_review_required')
  })

  it('maps confirmed discovery to confirmed dashboard context', () => {
    const state = mapCurrentJourney(responseWithConfirmedProfile())

    expect(state.kind).toBe('confirmed')
    expect(state.businessName).toBe('Nile Sweets')
    expect(state.profileVersion).toBe(2)
    expect(state.strategyLockedReason).toBe('strategy_not_active')
  })

  it.each(['failed', 'cancelled'] satisfies UnavailableDiscoveryStatus[])(
    'maps %s to an unavailable recovery state',
    (status) => {
      const state = mapCurrentJourney(responseWithUnavailableDiscovery(status))

      expect(state.kind).toBe('unavailable')
      expect(state.primaryHref).toBe('/discovery/new')
    },
  )

  it('returns a retryable error state with no Start Discovery action for failed API loading', () => {
    const state = errorDashboardState()

    expect(state.kind).toBe('error')
    expect(state.primaryActionType).toBe('none')
    expect(state.primaryHref).toBeNull()
  })
})

function responseWithNoJourney(): CurrentJourneyResponse {
  return {
    owner: owner(),
    journey: { state: 'no_journey', discovery: null, profile: null },
    future_phase: futurePhase('discovery_required'),
    primary_action: { type: 'start_discovery', destination: '/discovery/new' },
    generated_at: '2026-07-17T10:00:00.000Z',
  }
}

function responseWithActiveDiscovery(
  status: ActiveDiscoveryStatus,
): CurrentJourneyResponse {
  return {
    owner: owner(),
    journey: {
      state: 'discovery_active',
      discovery: discovery(status),
      profile: null,
    },
    future_phase: futurePhase('discovery_required'),
    primary_action: {
      type: 'continue_discovery',
      session_id: 'session-id',
      destination: '/discovery/session-id',
    },
    generated_at: '2026-07-17T10:00:00.000Z',
  }
}

function responseWithSummaryReview(): CurrentJourneyResponse {
  return {
    owner: owner(),
    journey: {
      state: 'discovery_summary_review',
      discovery: discovery('summary_ready'),
      profile: null,
    },
    future_phase: futurePhase('profile_review_required'),
    primary_action: {
      type: 'review_profile',
      session_id: 'session-id',
      destination: '/discovery/session-id',
    },
    generated_at: '2026-07-17T10:00:00.000Z',
  }
}

function responseWithUnavailableDiscovery(
  status: UnavailableDiscoveryStatus,
): CurrentJourneyResponse {
  return {
    owner: owner(),
    journey: {
      state: 'discovery_unavailable',
      discovery: discovery(status),
      profile: null,
    },
    future_phase: futurePhase('discovery_required'),
    primary_action: { type: 'start_discovery', destination: '/discovery/new' },
    generated_at: '2026-07-17T10:00:00.000Z',
  }
}

function responseWithConfirmedProfile(): CurrentJourneyResponse {
  return {
    owner: owner(),
    journey: {
      state: 'discovery_confirmed',
      discovery: discovery('confirmed'),
      profile: {
        business_profile_version_id: 'profile-version-id',
        business_id: 'business-id',
        version: 2,
        business_name: 'Nile Sweets',
        business_type: 'dessert shop',
        city: 'Assiut',
        area: 'Assiut City',
        confirmed_at: '2026-07-17T10:05:00.000Z',
      },
    },
    future_phase: futurePhase('strategy_not_active'),
    primary_action: {
      type: 'view_discovery',
      session_id: 'session-id',
      destination: '/discovery/session-id',
    },
    generated_at: '2026-07-17T10:00:00.000Z',
  }
}

function owner(): CurrentJourneyResponse['owner'] {
  return {
    user_id: 'owner-id',
    full_name: 'Ahmed Hassan',
    email: 'owner@example.com',
    email_verified: true,
  }
}

function discovery<
  TStatus extends
    | ActiveDiscoveryStatus
    | 'summary_ready'
    | 'confirmed'
    | UnavailableDiscoveryStatus,
>(status: TStatus): CurrentJourneyDiscoverySummary<TStatus> {
  return {
    session_id: 'session-id',
    status,
    language_mode: 'ar-EG',
    business_summary: {
      business_name: 'Nile Sweets',
      business_type: 'dessert shop',
      city: 'Assiut',
      area: 'Assiut City',
    },
    readiness: {
      ready: false,
      profile_readiness: 0.5,
      owner_turn_count: 3,
      max_owner_turns: 15,
    },
    profile_draft_id: null,
    confirmed_profile_version_id: null,
    updated_at: '2026-07-17T10:00:00.000Z',
    completed_at: null,
  }
}

function futurePhase(
  reason: CurrentJourneyResponse['future_phase']['reason'],
): CurrentJourneyResponse['future_phase'] {
  return {
    phase: 'strategy',
    availability: reason === 'strategy_not_active' ? 'unavailable' : 'locked',
    status: 'needs_brief',
    reason,
    destination: null,
  }
}
