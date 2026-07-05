import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressTimeline } from '../progress-timeline'
import * as HookParams from '../../hooks/use-discovery-progress'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// Mock the hook entirely
vi.mock('../../hooks/use-discovery-progress', () => ({
  useDiscoveryProgress: vi.fn(),
  canOpenInterview: vi.fn(),
}))

describe('ProgressTimeline', () => {
  it('renders loading state when no events exist', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue({
      events: [],
      sessionStatus: 'researching',
      connectionState: 'idle',
      restoredFromStatus: false,
      error: null,
    })
    
    render(<ProgressTimeline sessionId="test" />)
    expect(screen.getByText('Waiting for updates...')).toBeDefined()
  })

  it('renders events in order', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue({
      events: [
        { type: 'progress', seq: 1, stage: 'queued', status: 'complete', message_key: '', message_text: 'Done queued', payload: {}, created_at: '', session_id: 'test' },
        { type: 'progress', seq: 2, stage: 'metadata', status: 'progress', message_key: '', message_text: 'Doing metadata', payload: {}, created_at: '', session_id: 'test' },
      ],
      sessionStatus: 'researching',
      connectionState: 'connected',
      restoredFromStatus: false,
      error: null,
    })

    render(<ProgressTimeline sessionId="test" />)
    
    expect(screen.getByText('Done queued')).toBeDefined()
    expect(screen.getByText('Doing metadata')).toBeDefined()
  })

  it('renders error states and reconnecting status', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue({
      events: [],
      sessionStatus: 'researching',
      connectionState: 'reconnecting',
      restoredFromStatus: false,
      error: 'errorReconnecting',
    })

    render(<ProgressTimeline sessionId="test" />)
    
    expect(screen.getByText('errorReconnecting')).toBeDefined()
    expect(screen.getByText('titleReconnecting')).toBeDefined()
  })

  it('shows continue button when canOpenInterview is true', () => {
    vi.mocked(HookParams.useDiscoveryProgress).mockReturnValue({
      events: [],
      sessionStatus: 'ready_for_chat',
      connectionState: 'connected',
      restoredFromStatus: false,
      error: null,
    })
    
    vi.mocked(HookParams.canOpenInterview).mockReturnValue(true)

    render(<ProgressTimeline sessionId="test" />)
    
    expect(screen.getByRole('button', { name: 'continueToInterview' })).toBeDefined()
  })
})
