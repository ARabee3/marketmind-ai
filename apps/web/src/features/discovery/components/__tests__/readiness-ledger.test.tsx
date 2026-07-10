import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadinessLedger } from '../readiness-ledger'
import type { DiscoveryReadiness, UncertaintyInput } from '@marketmind/contracts'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (value: number, opts?: { style?: string }) => {
      if (opts?.style === 'percent') return `${Math.round(value * 100)}%`
      return String(value)
    },
  }),
}))

function makeReadiness(overrides: Partial<DiscoveryReadiness> = {}): DiscoveryReadiness {
  return {
    ready: false,
    llm_recommended: false,
    profile_readiness: 0.62,
    domain_scores: {
      identity: 1,
      offer: 0.65,
      customers: 0.75,
      differentiation: 0.35,
      current_marketing: 0.55,
      goals_and_constraints: 0.6,
      market_context: 0.45,
      research_confidence: 0.45,
      profile_readiness: 0.62,
    },
    blocking_domains: ['differentiation', 'current_marketing', 'goals_and_constraints'],
    owner_turn_count: 3,
    max_owner_turns: 15,
    ...overrides,
  }
}

describe('ReadinessLedger', () => {
  it('renders overall readiness and research confidence', () => {
    render(<ReadinessLedger readiness={makeReadiness()} uncertainties={[]} />)
    expect(screen.getByText('62%')).toBeDefined()
    expect(screen.getByLabelText('researchConfidence')).toBeDefined()
  })

  it('renders all domain scores with blocking styling', () => {
    render(<ReadinessLedger readiness={makeReadiness()} uncertainties={[]} />)

    expect(screen.getByText('domainIdentity')).toBeDefined()
    expect(screen.getByText('domainOffer')).toBeDefined()
    expect(screen.getByText('domainCustomers')).toBeDefined()
    expect(screen.getByText('domainDifferentiation')).toBeDefined()
    expect(screen.getByText('domainCurrentMarketing')).toBeDefined()
    expect(screen.getByText('domainGoals')).toBeDefined()
    expect(screen.getByText('domainMarketContext')).toBeDefined()
  })

  it('shows turn count', () => {
    render(<ReadinessLedger readiness={makeReadiness()} uncertainties={[]} />)
    expect(screen.getByText('3 / 15')).toBeDefined()
  })

  it('shows uncertainties grouped by severity', () => {
    const uncertainties: UncertaintyInput[] = [
      {
        field_key: 'f1',
        domain: 'offer',
        description: 'Missing best sellers',
        severity: 'high',
        category: 'missing_information',
        source: 'owner_unknown',
      },
      {
        field_key: 'f2',
        domain: 'customers',
        description: 'Unclear peak times',
        severity: 'medium',
        category: 'missing_information',
        source: 'owner_unknown',
      },
      {
        field_key: 'f3',
        domain: 'identity',
        description: 'Resolved issue',
        severity: 'low',
        category: 'missing_information',
        source: 'owner_unknown',
      },
    ]

    render(<ReadinessLedger readiness={makeReadiness()} uncertainties={uncertainties} />)

    expect(screen.getByText((t) => t.includes('Missing best sellers'))).toBeDefined()
    expect(screen.getByText((t) => t.includes('Unclear peak times'))).toBeDefined()
    expect(screen.getByText((t) => t.includes('Resolved issue'))).toBeDefined()
  })

  it('hides uncertainty section when empty', () => {
    render(<ReadinessLedger readiness={makeReadiness()} uncertainties={[]} />)
    expect(screen.queryByText('uncertaintiesTitle')).toBeNull()
  })
})
