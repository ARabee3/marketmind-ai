'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { DiscoveryMessage } from '@marketmind/contracts'
import type { TranslationKey } from '@/i18n/types'
import { cn } from '@/lib/utils'

function MessageBubble({
  message,
  label,
  isOwner,
}: {
  message: DiscoveryMessage
  label: string
  isOwner: boolean
}) {
  return (
    <div
      className={cn('flex', isOwner ? 'justify-end' : 'justify-start')}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-4 py-3 text-sm min-w-0',
          isOwner
            ? 'bg-primary text-primary-foreground rounded-se-none'
            : 'bg-muted text-foreground rounded-ss-none',
        )}
      >
        <span className="sr-only">{label}</span>
        <p className="whitespace-pre-wrap break-words" dir="auto">
          <bdi>{message.content}</bdi>
        </p>
      </div>
    </div>
  )
}

function CurrentQuestionBubble({
  content,
  label,
}: {
  content: string
  label: string
}) {
  return (
    <div className="flex justify-start" data-testid="message-assistant">
      <div className="max-w-[85%] rounded-xl px-4 py-3 text-sm min-w-0 bg-muted text-foreground rounded-ss-none">
        <span className="sr-only">{label}</span>
        <p className="whitespace-pre-wrap break-words" dir="auto">
          <bdi>{content}</bdi>
        </p>
      </div>
    </div>
  )
}

export function ConversationPanel({
  messages,
  currentQuestion,
  suggestedAnswers,
  pending,
  error,
  errorTranslationKey,
  onSubmit,
  onRetryStatus,
  disabled,
}: {
  messages: DiscoveryMessage[]
  currentQuestion?: string
  suggestedAnswers?: readonly string[]
  pending: boolean
  error: string | null
  errorTranslationKey: TranslationKey | null
  onSubmit: (message: string) => Promise<{ accepted: boolean }> | { accepted: boolean }
  onRetryStatus: () => void
  disabled?: boolean
}) {
  const t = useTranslations('DiscoveryInterview')
  const tErrors = useTranslations('Errors')
  const tProgress = useTranslations('DiscoveryProgress')
  const [input, setInput] = useState('')

  function renderKeyedMessage(key: TranslationKey): string {
    if (key.startsWith('Errors.')) {
      return tErrors(key.slice(7) as Parameters<typeof tErrors>[0])
    }
    if (key.startsWith('DiscoveryProgress.')) {
      return tProgress(key.slice(18) as Parameters<typeof tProgress>[0])
    }
    return key
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const lastMessageCountRef = useRef(messages.length)
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')
  const latestAssistantSuggestions =
    latestAssistantMessage && (!currentQuestion || latestAssistantMessage.content === currentQuestion)
      ? latestAssistantMessage.suggested_answers
      : undefined
  const activeSuggestedAnswers =
    suggestedAnswers ??
    latestAssistantSuggestions ??
    []

  // Scroll to bottom when new assistant message arrives
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current && logRef.current) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        logRef.current.scrollTo({ top: logRef.current.scrollHeight, behavior: prefersReduced ? 'auto' : 'smooth' })
      }
    }
    lastMessageCountRef.current = messages.length
  }, [messages])

  const handleSubmit = useCallback(async () => {
    if (disabled || pending || input.trim().length === 0) return
    const text = input
    const result = await onSubmit(text)
    if (result.accepted) {
      setInput('')
    }
  }, [disabled, pending, input, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const chooseSuggestedAnswer = useCallback((answer: string) => {
    setInput(answer)
    textareaRef.current?.focus()
  }, [])

  const isLastAssistantSameAsCurrent =
    currentQuestion &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].content === currentQuestion

  return (
    <Card className="border-border shadow-sm flex flex-col h-full">
      <CardHeader>
        <CardTitle className="text-base text-navy">{t('conversationTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 gap-4 min-h-0">
        {/* Conversation log */}
        <div
          ref={logRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={t('conversationLabel')}
          className="flex-1 overflow-y-auto space-y-3 min-h-0 pe-1"
        >
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              label={
                msg.role === 'owner'
                  ? t('ownerLabel')
                  : msg.role === 'system'
                    ? t('systemLabel')
                    : t('assistantLabel')
              }
              isOwner={msg.role === 'owner'}
            />
          ))}
          {currentQuestion && !isLastAssistantSameAsCurrent && (
            <CurrentQuestionBubble
              content={currentQuestion}
              label={t('assistantLabel')}
            />
          )}
          {messages.length === 0 && !currentQuestion && (
            <p className="text-sm text-muted-foreground italic text-center py-8">
              {t('emptyConversation')}
            </p>
          )}
        </div>

        {/* Error / recovery */}
        {error && (
          <div
            className="p-3 rounded-md text-sm bg-destructive/10 text-destructive border border-destructive/20"
            role="alert"
            aria-live="assertive"
          >
            <p className="font-medium">{errorTranslationKey ? renderKeyedMessage(errorTranslationKey) : error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-auto px-2 py-1 text-xs"
              onClick={onRetryStatus}
              disabled={pending}
            >
              {t('retryStatus')}
            </Button>
          </div>
        )}

        {/* Composer */}
        <div className="space-y-2 pt-2 border-t border-border">
          {activeSuggestedAnswers.length > 0 && (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t('suggestedAnswersLabel')}
            >
              {activeSuggestedAnswers.map((answer) => (
                <button
                  key={answer}
                  type="button"
                  onClick={() => chooseSuggestedAnswer(answer)}
                  disabled={disabled || pending}
                  className={cn(
                    'min-h-9 max-w-full rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors',
                    'hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <span className="break-words" dir="auto">
                    <bdi>{answer}</bdi>
                  </span>
                </button>
              ))}
            </div>
          )}
          <Label htmlFor="discovery-answer" className="text-sm font-medium">
            {t('composerLabel')}
          </Label>
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              id="discovery-answer"
              name="discovery-answer"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || pending}
              placeholder={t('answerPlaceholder')}
              rows={3}
              className={cn(
                'flex-1 min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none resize-none',
                'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50',
              )}
            />
            <Button
              onClick={handleSubmit}
              disabled={disabled || pending || input.trim().length === 0}
              aria-label={pending ? t('submittingLabel') : t('submitLabel')}
              className="self-end"
            >
              {pending ? t('submittingLabel') : t('submitLabel')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('composerHint')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
