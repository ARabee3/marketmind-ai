import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import StrategyReviewPage from '../page'

const refreshWallet = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/features/billing/wallet-context', () => ({
  useWallet: () => ({ refresh: refreshWallet }),
}))

vi.mock('@/features/strategy/hooks/use-strategy', () => ({
  useStrategy: () => ({
    strategy: null,
    loading: true,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock('@/features/strategy/components/strategy-review', () => ({
  StrategyReview: () => null,
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: vi.fn(() => Promise.resolve({ journey: {} })),
}))

vi.mock('@/lib/api/strategy', () => ({
  getStrategyProgress: vi.fn(() => Promise.resolve([])),
  getStrategyRetrieval: vi.fn(() => Promise.resolve(null)),
  toStrategyResource: vi.fn(),
}))

describe('StrategyReviewPage', () => {
  it('refreshes the shared wallet when the review page opens', async () => {
    await act(async () => {
      render(
        <StrategyReviewPage
          params={Promise.resolve({ strategy_id: 'strategy-1' })}
        />,
      )
    })

    expect(refreshWallet).toHaveBeenCalledTimes(1)
  })
})
