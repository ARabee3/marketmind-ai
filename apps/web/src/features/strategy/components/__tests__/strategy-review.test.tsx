import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StrategyResource } from '@marketmind/contracts'
import { StrategyReview } from '../strategy-review'

const mockResource = {
  strategy_id: 'strat-1',
  status: 'needs_brief',
  brief: null,
  latest_plan: null,
} satisfies StrategyResource

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'decision.approve') return 'Approve strategy'
    if (key === 'decision.revise') return 'Request revision'
    if (key === 'decision.reject') return 'Reject draft'
    if (key === 'profile.versionValue') return `Version ${values?.version}`
    return key
  },
  useFormatter: () => ({
    dateTime: () => 'Jul 17, 2026',
  }),
}))

describe('StrategyReview', () => {
  it('disables decision controls until ready for approval', () => {
    render(<StrategyReview profile={null} resource={mockResource} />)

    for (const name of ['Approve strategy', 'Request revision', 'Reject draft']) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
    }
  })
})
