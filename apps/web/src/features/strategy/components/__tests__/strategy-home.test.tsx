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
  'home.currentLabel': 'Current plan state',
  'home.currentBody': 'This preview shows the owner journey.',
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
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: journeyMock,
}))

vi.mock('@/lib/api/strategy', () => ({
  getStrategy: getStrategyMock,
  getStrategyProgress: getProgressMock,
  toStrategyResource: (api: unknown) => api,
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

  it('never crashes on a null journey after a failed load', async () => {
    journeyMock.mockRejectedValueOnce(new Error('boom'))

    render(<StrategyHome />)

    await waitFor(() => {
      expect(screen.getByText('We could not load your Strategy workspace. Please try again.')).toBeTruthy()
    })
  })
})
