import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressTimeline } from '../progress-timeline'
import * as HookParams from '../../hooks/use-discovery-progress'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ number: (value: number) => `${Math.round(value * 100)}%` }),
}))

// Mock the hook entirely
vi.mock('../../hooks/use-discovery-progress', () => ({
  useDiscoveryProgress: vi.fn(),
  canOpenInterview: vi.fn(),
}))

function baseState(
  overrides: Partial<HookParams.ProgressState> = {},
): HookParams.ProgressState {
  return {
    events: [],
    sessionStatus: 'researching',
    connectionState: 'idle',
    restoredFromStatus: false,
    connectionError: null,
    researchWarning: null,
    ...overrides,
  }
}

describe('ProgressTimeline', () => {
  it('renders a queued research state when no events exist', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue(baseState())
    vi.mocked(HookParams.canOpenInterview).mockReturnValue(false)

    render(<ProgressTimeline sessionId="test" />)
    expect(screen.getAllByText('stageQueued').length).toBeGreaterThan(0)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4')
  })

  it('renders events in order using real backend keys', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue(
      baseState({
        events: [
          { type: 'progress', seq: 1, stage: 'queued', status: 'complete', message_key: 'discovery.session.accepted', message_text: 'Done queued', payload: {}, created_at: '', session_id: 'test' },
          { type: 'progress', seq: 2, stage: 'metadata', status: 'progress', message_key: 'discovery.metadata.started', message_text: 'Doing metadata', payload: {}, created_at: '', session_id: 'test' },
          { type: 'progress', seq: 3, stage: 'metadata', status: 'complete', message_key: 'discovery.metadata.completed', message_text: 'Metadata done', payload: {}, created_at: '', session_id: 'test' },
        ],
        connectionState: 'connected',
      }),
    )

    render(<ProgressTimeline sessionId="test" />)

    expect(screen.getByText('stepAccepted')).toBeDefined()
    expect(screen.getByText('stepMetadata')).toBeDefined()
    expect(screen.getByText('stepMetadataComplete')).toBeDefined()
  })

  it('renders connection states and localized reconnecting status', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue(
      baseState({
        connectionState: 'reconnecting',
        connectionError: null,
      }),
    )

    render(<ProgressTimeline sessionId="test" />)

    expect(screen.getAllByText('connectionReconnecting').length).toBeGreaterThan(0)
    expect(screen.getByText('titleReconnecting')).toBeDefined()
  })

  it('shows continue button when callback is provided and interview is open', () => {
    const onContinue = vi.fn()
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue(
      baseState({
        sessionStatus: 'ready_for_chat',
        connectionState: 'connected',
      }),
    )
    vi.mocked(HookParams.canOpenInterview).mockReturnValue(true)

    render(<ProgressTimeline sessionId="test" onContinueToInterview={onContinue} />)

    expect(screen.getByRole('button', { name: 'continueToInterview' })).toBeDefined()
  })

  it('does not render a fake action when no callback is provided', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue(
      baseState({
        sessionStatus: 'ready_for_chat',
        connectionState: 'connected',
      }),
    )
    vi.mocked(HookParams.canOpenInterview).mockReturnValue(true)

    render(<ProgressTimeline sessionId="test" />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('estimateComplete')).toBeDefined()
  })

  it('keeps research warning visible while reconnecting', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue(
      baseState({
        sessionStatus: 'partial_ready',
        connectionState: 'reconnecting',
        connectionError: null,
        researchWarning: 'DiscoveryProgress.errorPartialResearch',
      }),
    )

    render(<ProgressTimeline sessionId="test" />)

    expect(screen.getByText('errorPartialResearch')).toBeDefined()
    expect(screen.getAllByText('connectionReconnecting').length).toBeGreaterThan(0)
  })
})
