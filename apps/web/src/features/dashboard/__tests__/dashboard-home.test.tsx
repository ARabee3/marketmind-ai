import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ActiveDiscoveryStatus,
  CurrentJourneyDiscoverySummary,
  CurrentJourneyResponse,
  UnavailableDiscoveryStatus,
} from '@marketmind/contracts'
import { getCurrentJourney } from '@/lib/api/journey'
import { DashboardHome } from '../dashboard-home'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'titleWithName') return `titleWithName:${values?.name ?? ''}`
    if (key === 'readinessValue') return `readinessValue:${values?.value ?? ''}`
    if (key === 'profileVersionValue') return `profileVersionValue:${values?.value ?? ''}`
    return key
  },
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: vi.fn(),
}))

vi.mock('@/features/auth/session-provider', () => ({
  useSession: () => ({
    user: { id: 'owner-id', email: 'owner@example.com', fullName: 'Ahmed Hassan' },
  }),
}))

const mockedGetCurrentJourney = vi.mocked(getCurrentJourney)

describe('DashboardHome', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [responseWithNoJourney(), 'state.empty.title', 'actions.start_discovery', '/discovery/new'],
    [
      responseWithActiveDiscovery('researching'),
      'state.active.title',
      'actions.continue_discovery',
      '/discovery/session-id',
    ],
    [
      responseWithActiveDiscovery('ready_for_chat'),
      'state.active.title',
      'actions.continue_discovery',
      '/discovery/session-id',
    ],
    [
      responseWithSummaryReview(),
      'state.review.title',
      'actions.review_profile',
      '/discovery/session-id',
    ],
    [
      responseWithConfirmedProfile(),
      'state.confirmed.title',
      'actions.view_discovery',
      '/discovery/session-id',
    ],
    [
      responseWithUnavailableDiscovery('failed'),
      'state.unavailable.title',
      'actions.start_discovery',
      '/discovery/new',
    ],
  ])(
    'renders the primary dashboard action for %s',
    async (response, title, action, href) => {
      mockedGetCurrentJourney.mockResolvedValue(response)

      render(<DashboardHome />)

      expect(await screen.findByRole('heading', { name: title })).not.toBeNull()
      expect(screen.getByRole('link', { name: action }).getAttribute('href')).toBe(href)
    },
  )

  it('renders real business understanding fields from the current journey', async () => {
    mockedGetCurrentJourney.mockResolvedValue(responseWithConfirmedProfile())

    render(<DashboardHome />)

    expect(await screen.findByText('Nile Sweets')).not.toBeNull()
    expect(screen.getByText('dessert shop')).not.toBeNull()
    expect(screen.getByText('Assiut City, Assiut')).not.toBeNull()
    expect(screen.getByText('profileVersionValue:2')).not.toBeNull()
  })

  it('shows recovery copy and retries after the journey endpoint fails', async () => {
    mockedGetCurrentJourney
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(responseWithNoJourney())

    render(<DashboardHome />)

    expect(await screen.findByText('loadError')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    await waitFor(() => {
      expect(mockedGetCurrentJourney).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByRole('heading', { name: 'state.empty.title' })).not.toBeNull()
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

function owner(): CurrentJourneyResponse['owner'] {
  return {
    user_id: 'owner-id',
    full_name: 'Ahmed Hassan',
    email: 'owner@example.com',
    email_verified: true,
  }
}

function discovery<
  TStatus extends ActiveDiscoveryStatus | UnavailableDiscoveryStatus | 'summary_ready' | 'confirmed',
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
