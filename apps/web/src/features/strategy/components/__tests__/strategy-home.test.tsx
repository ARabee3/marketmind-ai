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
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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

    expect(await screen.findByText('Start strategy choices')).toBeTruthy()
    expect(journeyMock).toHaveBeenCalledTimes(2)
  })

  it('shows the no-strategy start CTA when discovery is not confirmed', async () => {
    journeyMock.mockResolvedValueOnce(noStrategyJourney)

    render(<StrategyHome />)

    expect(await screen.findByText('Start strategy choices')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
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
