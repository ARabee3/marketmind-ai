import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { DiscoveryStatusResponse } from '@marketmind/contracts'
import { DiscoverySession } from '../discovery-session'
import { useDiscoverySession } from '@/features/discovery/hooks/use-discovery-session'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (value: number, opts?: { style?: string }) => {
      if (opts?.style === 'percent') return `${Math.round(value * 100)}%`
      return String(value)
    },
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/features/discovery/hooks/use-discovery-progress', () => ({
  canOpenInterview: () => true,
}))

const mockRetryInterview = vi.fn()

vi.mock('@/features/discovery/hooks/use-discovery-session', () => ({
  useDiscoverySession: vi.fn(),
}))

vi.mock('../progress-timeline', () => ({
  ProgressTimeline: () => <div>PROGRESS_TIMELINE_RENDERED</div>,
}))

vi.mock('../conversation-panel', () => ({
  ConversationPanel: () => <div>CONVERSATION_PANEL_RENDERED</div>,
}))

vi.mock('../readiness-ledger', () => ({
  ReadinessLedger: () => <div>READINESS_LEDGER_RENDERED</div>,
}))

vi.mock('../finish-dialog', () => ({
  FinishDialog: () => <div>FINISH_DIALOG_RENDERED</div>,
}))

vi.mock('../draft-review', () => ({
  DraftReview: () => <div>DRAFT_REVIEW_RENDERED</div>,
}))

function makeStatus(overrides: Partial<DiscoveryStatusResponse> = {}): DiscoveryStatusResponse {
  return {
    session_id: 'test-session',
    status: 'partial_ready',
    language_mode: 'en',
    intake_summary: { business_name: 'Test', business_type: 'Cafe', city: 'Cairo' },
    intelligence: {
      status: 'complete',
      search_mode: 'free_search',
      source_refs: [],
      research_observations: [],
      conversation_hooks: [],
      knowledge_gaps: [],
    },
    messages: [],
    profile_state: {
      known_facts: {
        identity: { business_name: 'Test', business_type: 'Cafe', city: 'Cairo' },
        offer: { core_offerings: [], best_sellers: [], purchase_occasions: [] },
        customers: { primary_segments: [], visit_or_order_occasions: [], peak_periods: [], customer_needs: [] },
        differentiation: { owner_claimed_strengths: [], customer_choice_reasons: [], proof_points: [] },
        current_marketing: { active_channels: [], current_activities: [], delivery_platforms: [], available_assets: [] },
        goals_and_constraints: { growth_goals: [], operational_constraints: [] },
      },
      uncertainties: [],
      readiness: {
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
        owner_turn_count: 2,
        max_owner_turns: 15,
      },
    },
    progress_events: [],
    strategy_locked: true,
    ...overrides,
  }
}

type SessionReturn = ReturnType<typeof useDiscoverySession>

function sessionMock(overrides: Partial<SessionReturn> = {}): SessionReturn {
  return {
    status: null,
    phase: 'loading',
    pending: false,
    isThinking: false,
    streamingText: '',
    error: null,
    errorTranslationKey: null,
    respond: vi.fn(),
    summarize: vi.fn(),
    confirm: vi.fn(),
    retryInterview: mockRetryInterview,
    retryLoad: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

describe('DiscoverySession stuck-interview recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDiscoverySession).mockReturnValue(sessionMock())
  })

  it('renders the recovery card when interview is stuck with no messages and no question', () => {
    const status = makeStatus({ status: 'partial_ready' })
    vi.mocked(useDiscoverySession).mockReturnValue(
      sessionMock({ status, phase: 'interview' }),
    )

    render(<DiscoverySession sessionId="test-session" />)

    expect(screen.getByText('interviewStuckTitle')).toBeDefined()
    expect(screen.getByText('interviewStuckDescription')).toBeDefined()
    expect(screen.getByRole('button', { name: 'interviewStuckRetry' })).toBeDefined()
    expect(screen.queryByText('CONVERSATION_PANEL_RENDERED')).toBeNull()
  })

  it('triggers retryInterview when the recovery button is clicked', () => {
    const status = makeStatus({ status: 'partial_ready' })
    vi.mocked(useDiscoverySession).mockReturnValue(
      sessionMock({ status, phase: 'interview' }),
    )

    render(<DiscoverySession sessionId="test-session" />)

    fireEvent.click(screen.getByRole('button', { name: 'interviewStuckRetry' }))
    expect(mockRetryInterview).toHaveBeenCalledTimes(1)
  })

  it('shows the retrying label and disables the button while pending', () => {
    const status = makeStatus({ status: 'partial_ready' })
    vi.mocked(useDiscoverySession).mockReturnValue(
      sessionMock({ status, phase: 'interview', pending: true }),
    )

    render(<DiscoverySession sessionId="test-session" />)

    const button = screen.getByRole('button', { name: 'interviewStuckRetrying' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('does not show the recovery card once the conversation has started', () => {
    const status = makeStatus({
      status: 'in_progress',
      messages: [
        { id: 'msg-1', role: 'assistant', content: 'Who are your customers?', language: 'en', source: 'chat', created_at: '2026-06-25T10:00:00Z' },
      ],
      current_question: 'Who are your customers?',
    })
    vi.mocked(useDiscoverySession).mockReturnValue(
      sessionMock({ status, phase: 'interview' }),
    )

    render(<DiscoverySession sessionId="test-session" />)

    expect(screen.queryByText('interviewStuckTitle')).toBeNull()
    expect(screen.getByText('CONVERSATION_PANEL_RENDERED')).toBeDefined()
  })
})