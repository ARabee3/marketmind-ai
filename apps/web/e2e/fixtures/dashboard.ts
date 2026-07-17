import type { Page } from '@playwright/test'
import type {
  ActiveDiscoveryStatus,
  CurrentJourneyDiscoverySummary,
  CurrentJourneyResponse,
} from '@marketmind/contracts'
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from './auth'

export async function authAndJourney(page: Page, response: CurrentJourneyResponse) {
  await mockAuthRefresh(page, mockAccessToken)
  await mockAuthMe(page)
  await page.route('**/journey/current', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    })
  })
}

export function responseWithNoJourney(): CurrentJourneyResponse {
  return {
    owner: owner(),
    journey: { state: 'no_journey', discovery: null, profile: null },
    future_phase: futurePhase('discovery_required'),
    primary_action: { type: 'start_discovery', destination: '/discovery/new' },
    generated_at: '2026-07-17T10:00:00.000Z',
  }
}

export function responseWithActiveDiscovery(
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

export function responseWithSummaryReview(): CurrentJourneyResponse {
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

export function responseWithConfirmedProfile(): CurrentJourneyResponse {
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
  TStatus extends ActiveDiscoveryStatus | 'summary_ready' | 'confirmed',
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
