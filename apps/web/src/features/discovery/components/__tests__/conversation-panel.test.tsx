import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConversationPanel } from '../conversation-panel'
import type { DiscoveryMessage } from '@marketmind/contracts'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (value: number, opts?: { style?: string }) => {
      if (opts?.style === 'percent') return `${Math.round(value * 100)}%`
      return String(value)
    },
  }),
}))

function makeMessage(overrides: Partial<DiscoveryMessage> = {}): DiscoveryMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello',
    language: 'en',
    source: 'chat',
    created_at: '2026-06-25T10:00:00Z',
    ...overrides,
  }
}

describe('ConversationPanel', () => {
  it('renders empty state when no messages', () => {
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )
    expect(screen.getByText('emptyConversation')).toBeDefined()
  })

  it('renders owner and assistant messages with role-based alignment', () => {
    const messages: DiscoveryMessage[] = [
      makeMessage({ id: '1', role: 'assistant', content: 'What is your name?' }),
      makeMessage({ id: '2', role: 'owner', content: 'My name is Test.' }),
    ]

    render(
      <ConversationPanel
        messages={messages}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )

    expect(screen.getByText('What is your name?')).toBeDefined()
    expect(screen.getByText('My name is Test.')).toBeDefined()
    expect(screen.getAllByTestId('message-assistant')).toHaveLength(1)
    expect(screen.getAllByTestId('message-owner')).toHaveLength(1)
  })

  it('preserves mixed-language content exactly', () => {
    const messages: DiscoveryMessage[] = [
      makeMessage({ id: '1', role: 'assistant', content: 'مرحبا! What is your name?' }),
    ]

    render(
      <ConversationPanel
        messages={messages}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )

    expect(screen.getByText('مرحبا! What is your name?')).toBeDefined()
  })

  it('does not duplicate current_question when it matches last assistant message', () => {
    const messages: DiscoveryMessage[] = [
      makeMessage({ id: '1', role: 'assistant', content: 'Same question?' }),
    ]

    render(
      <ConversationPanel
        messages={messages}
        currentQuestion="Same question?"
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('message-assistant')).toHaveLength(1)
  })

  it('shows current_question when it differs from last assistant message', () => {
    const messages: DiscoveryMessage[] = [
      makeMessage({ id: '1', role: 'assistant', content: 'Old question?' }),
    ]

    render(
      <ConversationPanel
        messages={messages}
        currentQuestion="New question?"
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )

    expect(screen.getByText('New question?')).toBeDefined()
    expect(screen.getAllByTestId('message-assistant')).toHaveLength(2)
  })

  it('submits on Enter and allows Shift+Enter for newline', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ accepted: true }))
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={onSubmit}
        onRetryStatus={vi.fn()}
      />,
    )

    const textarea = screen.getByPlaceholderText('answerPlaceholder')
    fireEvent.change(textarea, { target: { value: 'my answer' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('my answer'))
  })

  it('fills the composer from a suggested answer and submits normally', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ accepted: true }))
    render(
      <ConversationPanel
        messages={[]}
        currentQuestion="Who buys most often?"
        suggestedAnswers={['Families', 'Office workers']}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={onSubmit}
        onRetryStatus={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Families' }))
    const textarea = screen.getByPlaceholderText('answerPlaceholder') as HTMLTextAreaElement
    expect(textarea.value).toBe('Families')

    fireEvent.click(screen.getByRole('button', { name: 'submitLabel' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Families'))
  })

  it('uses assistant message suggestions when status suggestions are absent', () => {
    render(
      <ConversationPanel
        messages={[
          makeMessage({
            id: '1',
            role: 'assistant',
            content: 'Who buys most often?',
            suggested_answers: ['شباب وعائلات'],
          }),
        ]}
        currentQuestion="Who buys most often?"
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'شباب وعائلات' })).toBeDefined()
  })

  it('does not submit on Shift+Enter', () => {
    const onSubmit = vi.fn(() => Promise.resolve({ accepted: true }))
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={onSubmit}
        onRetryStatus={vi.fn()}
      />,
    )

    const textarea = screen.getByPlaceholderText('answerPlaceholder')
    fireEvent.change(textarea, { target: { value: 'line 1\nline 2' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects whitespace-only submission', () => {
    const onSubmit = vi.fn(() => Promise.resolve({ accepted: true }))
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={onSubmit}
        onRetryStatus={vi.fn()}
      />,
    )

    const textarea = screen.getByPlaceholderText('answerPlaceholder')
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'submitLabel' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables controls while pending', () => {
    render(
      <ConversationPanel
        messages={[]}
        pending={true}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByPlaceholderText('answerPlaceholder') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('shows error with retry button', () => {
    const onRetryStatus = vi.fn()
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error="Something failed"
        errorTranslationKey="Errors.networkError"
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={onRetryStatus}
      />,
    )

    expect(screen.getByRole('alert')).toBeDefined()
    fireEvent.click(screen.getByText('retryStatus'))
    expect(onRetryStatus).toHaveBeenCalled()
  })

  it('renders DiscoveryProgress namespace error keys correctly', () => {
    const onRetryStatus = vi.fn()
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error="Provider down"
        errorTranslationKey="DiscoveryProgress.errorProviderFailure"
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={onRetryStatus}
      />,
    )

    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('errorProviderFailure')).toBeDefined()
  })

  it('clears input after accepted submit', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ accepted: true }))
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={onSubmit}
        onRetryStatus={vi.fn()}
      />,
    )

    const textarea = screen.getByPlaceholderText('answerPlaceholder') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'my answer' } })
    fireEvent.click(screen.getByRole('button', { name: 'submitLabel' }))

    await waitFor(() => expect(textarea.value).toBe(''))
  })

  it('retains input after rejected submit', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ accepted: false }))
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={onSubmit}
        onRetryStatus={vi.fn()}
      />,
    )

    const textarea = screen.getByPlaceholderText('answerPlaceholder') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'my answer' } })
    fireEvent.click(screen.getByRole('button', { name: 'submitLabel' }))

    await waitFor(() => expect(textarea.value).toBe('my answer'))
  })

  it('has name and autocomplete attributes on textarea', () => {
    render(
      <ConversationPanel
        messages={[]}
        pending={false}
        error={null}
        errorTranslationKey={null}
        onSubmit={vi.fn(() => Promise.resolve({ accepted: true }))}
        onRetryStatus={vi.fn()}
      />,
    )

    const textarea = screen.getByPlaceholderText('answerPlaceholder') as HTMLTextAreaElement
    expect(textarea.getAttribute('name')).toBe('discovery-answer')
    expect(textarea.getAttribute('autocomplete')).toBe('off')
  })
})
