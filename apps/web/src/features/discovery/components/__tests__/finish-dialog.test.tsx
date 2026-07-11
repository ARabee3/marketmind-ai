import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FinishDialog } from '../finish-dialog'
import type { DiscoveryReadiness } from '@marketmind/contracts'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

function makeReadiness(overrides: Partial<DiscoveryReadiness> = {}): DiscoveryReadiness {
  return {
    ready: false,
    llm_recommended: false,
    profile_readiness: 0.5,
    domain_scores: {
      identity: 1,
      offer: 0.5,
      customers: 0.5,
      differentiation: 0.5,
      current_marketing: 0.5,
      goals_and_constraints: 0.5,
      market_context: 0.5,
      research_confidence: 0.5,
      profile_readiness: 0.5,
    },
    blocking_domains: ['offer'],
    owner_turn_count: 3,
    max_owner_turns: 15,
    ...overrides,
  }
}

describe('FinishDialog', () => {
  it('opens dialog and lists blocking domains for incomplete draft', async () => {
    const onConfirm = vi.fn()
    render(
      <FinishDialog
        readiness={makeReadiness()}
        pending={false}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'finishInterview' }))

    await waitFor(() => expect(screen.getByText('finishDialogTitle')).toBeDefined())
    expect(screen.getByText('finishDialogIncompleteDescription')).toBeDefined()
    expect(screen.getByText('domainOffer')).toBeDefined()
  })

  it('cancelling dialog sends nothing', async () => {
    const onConfirm = vi.fn()
    render(
      <FinishDialog
        readiness={makeReadiness()}
        pending={false}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'finishInterview' }))
    await waitFor(() => expect(screen.getByText('finishDialogTitle')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'cancelFinish' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirming sends finish_anyway for incomplete draft', async () => {
    const onConfirm = vi.fn()
    render(
      <FinishDialog
        readiness={makeReadiness()}
        pending={false}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'finishInterview' }))
    await waitFor(() => expect(screen.getByText('finishDialogTitle')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'confirmFinishLabel' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('shows ready description when readiness is ready', async () => {
    const onConfirm = vi.fn()
    render(
      <FinishDialog
        readiness={makeReadiness({ ready: true })}
        pending={false}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'finishInterview' }))
    await waitFor(() => expect(screen.getByText('finishDialogReadyDescription')).toBeDefined())
  })
})
