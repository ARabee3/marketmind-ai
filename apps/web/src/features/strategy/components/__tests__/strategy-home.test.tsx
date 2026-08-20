import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrategyHome } from '../strategy-home'

const journeyMock = vi.hoisted(() => vi.fn())
const getStrategyMock = vi.hoisted(() => vi.fn())
const getProgressMock = vi.hoisted(() => vi.fn())

const messages: Record<string, string> = {
  'Common.loading': 'Loading…',
  'Common.error': 'Error',
  'home.eyebrow': 'Strategy workspace',
  'home.title': 'Turn the confirmed business profile into a 12-week marketing plan.',
  'home.subtitle': 'Choose the goal, budget approach, and team capacity first.',
  'home.start': 'Start strategy choices',
  'home.review': 'Review sample draft',
  'home.viewApproved': 'View approved plan',
  'home.currentLabel': 'Current plan state',
  'home.currentBody': 'This preview shows the owner journey.',
  'home.currentBodyApproved': 'The approved plan is saved.',
  'home.discoveryRequired.title': 'Complete your business profile first',
  'home.discoveryRequired.body': 'Strategy planning starts only after your business profile is confirmed through Discovery.',
  'home.discoveryRequired.startDiscovery': 'Start business discovery',
  'home.discoveryRequired.continueDiscovery': 'Continue discovery',
  'home.discoveryRequired.reviewProfile': 'Review & confirm business profile',
  'home.discoveryRequired.viewDiscovery': 'View discovery',
  'progress.labels.ready': 'The draft is ready for review.',
  'progress.labels.approved': 'The plan is approved.',
  'home.loadError': 'We could not load your Strategy workspace. Please try again.',
  'home.retry': 'Try again',
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => messages[key] ?? key,
  useLocale: () => 'en',
  useFormatter: () => ({
    dateTime: () => 'Jul 1, 2026',
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: journeyMock,
}))

vi.mock('@/lib/api/strategy', () => ({
  getStrategy: getStrategyMock,
  getStrategyProgress: getProgressMock,
  toStrategyResource: (api: unknown) => api,
}))

vi.mock('../strategy-review', () => ({
  StrategyReview: ({
    resource,
    readOnly,
  }: {
    resource: { status: string }
    readOnly?: boolean
  }) => (
    <div data-testid="approved-strategy" data-read-only={readOnly ? 'true' : 'false'}>
      {resource.status}
    </div>
  ),
}))

const noStrategyJourney = {
  owner: { email: 'owner@example.com', email_verified: true },
  journey: { state: 'discovery_not_started', profile: null },
  future_phase: { availability: 'unavailable', strategy_id: null },
  primary_action: { type: 'start_discovery', destination: '/discovery/new' },
}

const profileNoStrategyJourney = {
  owner: { email: 'owner@example.com', email_verified: true },
  journey: {
    state: 'discovery_confirmed',
    profile: {
      business_name: 'Example Cafe',
      business_type: 'retail',
      city: 'Cairo',
      area: 'Maadi',
      confirmed_at: '2026-07-01T00:00:00.000Z',
      version: 1,
    },
  },
  future_phase: { availability: 'unavailable', strategy_id: null },
  primary_action: {
    type: 'view_discovery',
    session_id: 'session-1',
    destination: '/discovery/session-1',
  },
}

const readyJourney = {
  owner: { email: 'owner@example.com', email_verified: true },
  journey: {
    state: 'discovery_confirmed',
    profile: {
      business_name: 'Example Cafe',
      business_type: 'retail',
      city: 'Cairo',
      area: 'Maadi',
      confirmed_at: '2026-07-01T00:00:00.000Z',
      version: 1,
    },
  },
  future_phase: { availability: 'available', strategy_id: 'strat-1' },
}

describe('StrategyHome', () => {
  beforeEach(() => {
    journeyMock.mockReset()
    getStrategyMock.mockReset()
    getProgressMock.mockReset()
  })

  it('renders a friendly error with retry when the journey fails to load', async () => {
    journeyMock.mockRejectedValueOnce(new Error('network down'))

    render(<StrategyHome />)

    expect(await screen.findByText('We could not load your Strategy workspace. Please try again.')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/can't access/i)).toBeNull()
  })

  it('retries the journey load when the user clicks Try again', async () => {
    journeyMock
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce(noStrategyJourney)

    render(<StrategyHome />)

    const retryButton = await screen.findByRole('button', { name: 'Try again' })
    fireEvent.click(retryButton)

    expect(await screen.findByText('Complete your business profile first')).toBeTruthy()
    expect(journeyMock).toHaveBeenCalledTimes(2)
  })

  it('guides a user without a confirmed profile to discovery instead of strategy choices', async () => {
    journeyMock.mockResolvedValueOnce(noStrategyJourney)

    render(<StrategyHome />)

    expect(
      await screen.findByRole('heading', { name: 'Complete your business profile first' }),
    ).toBeTruthy()
    expect(screen.queryByText('Start strategy choices')).toBeNull()
    const discoveryLink = screen.getByRole('link', { name: 'Start business discovery' })
    expect(discoveryLink.getAttribute('href')).toBe('/discovery/new')
  })

  it('routes the discovery card to the active discovery session', async () => {
    journeyMock.mockResolvedValueOnce({
      ...noStrategyJourney,
      journey: { state: 'discovery_active', profile: null },
      primary_action: {
        type: 'continue_discovery',
        session_id: 'session-1',
        destination: '/discovery/session-1',
      },
    })

    render(<StrategyHome />)

    expect(
      await screen.findByRole('heading', { name: 'Complete your business profile first' }),
    ).toBeTruthy()
    const discoveryLink = screen.getByRole('link', { name: 'Continue discovery' })
    expect(discoveryLink.getAttribute('href')).toBe('/discovery/session-1')
  })

  it('keeps the strategy start CTA once the profile is confirmed', async () => {
    journeyMock.mockResolvedValueOnce(profileNoStrategyJourney)

    render(<StrategyHome />)

    expect(await screen.findByText('Start strategy choices')).toBeTruthy()
    expect(screen.queryByText('Complete your business profile first')).toBeNull()
  })

  it('renders the workspace when a strategy is available', async () => {
    journeyMock.mockResolvedValueOnce(readyJourney)
    getStrategyMock.mockResolvedValueOnce({ strategy_id: 'strat-1', status: 'ready', brief: null, latest_plan: null })
    getProgressMock.mockResolvedValueOnce([])

    render(<StrategyHome />)

    expect(await screen.findByText('Review sample draft')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows the approved strategy once it is approved', async () => {
    journeyMock.mockResolvedValueOnce(readyJourney)
    getStrategyMock.mockResolvedValueOnce({ strategy_id: 'strat-1', status: 'approved', brief: null, latest_plan: null })

    render(<StrategyHome />)

    const approvedStrategy = await screen.findByTestId('approved-strategy')
    expect(approvedStrategy.textContent).toBe('approved')
    expect(approvedStrategy.getAttribute('data-read-only')).toBe('true')
    expect(screen.queryByText('Review sample draft')).toBeNull()
    expect(screen.queryByText('The plan is approved.')).toBeNull()
  })

  it('renders an approved strategy without waiting for progress history', async () => {
    journeyMock.mockResolvedValueOnce(readyJourney)
    getStrategyMock.mockResolvedValueOnce({ strategy_id: 'strat-1', status: 'approved', brief: null, latest_plan: null })
    getProgressMock.mockReturnValueOnce(new Promise<never>(() => undefined))

    render(<StrategyHome />)

    expect((await screen.findByTestId('approved-strategy')).textContent).toBe('approved')
    expect(getProgressMock).not.toHaveBeenCalled()
  })

  it('never crashes on a null journey after a failed load', async () => {
    journeyMock.mockRejectedValueOnce(new Error('boom'))

    render(<StrategyHome />)

    await waitFor(() => {
      expect(screen.getByText('We could not load your Strategy workspace. Please try again.')).toBeTruthy()
    })
  })
})
