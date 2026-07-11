'use client'

import { useTranslations, useFormatter } from 'next-intl'
import { ProgressTimeline } from './progress-timeline'
import { ConversationPanel } from './conversation-panel'
import { ReadinessLedger } from './readiness-ledger'
import { FinishDialog } from './finish-dialog'
import { DraftReview } from './draft-review'
import { ConfirmationSuccess } from './confirmation-success'
import { canOpenInterview } from '@/features/discovery/hooks/use-discovery-progress'
import { useDiscoverySession } from '@/features/discovery/hooks/use-discovery-session'
import { Button, buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import type { TranslationKey } from '@/i18n/types'

function renderKeyedMessage(
  t: ReturnType<typeof useTranslations<'DiscoveryProgress'>>,
  tErrors: ReturnType<typeof useTranslations<'Errors'>>,
  key: TranslationKey,
): string {
  if (key.startsWith('Errors.')) {
    return tErrors(key.slice(7) as Parameters<typeof tErrors>[0])
  }
  if (key.startsWith('DiscoveryProgress.')) {
    return t(key.slice(18) as Parameters<typeof t>[0])
  }
  return key
}

function ActionErrorBanner({
  error,
  errorTranslationKey,
  pending,
  onRetry,
  t,
  tErrors,
}: {
  error: string | null
  errorTranslationKey: TranslationKey | null
  pending: boolean
  onRetry: () => void
  t: ReturnType<typeof useTranslations<'DiscoveryProgress'>>
  tErrors: ReturnType<typeof useTranslations<'Errors'>>
}) {
  if (!error) return null
  return (
    <div
      className="p-3 rounded-md text-sm bg-destructive/10 text-destructive border border-destructive/20 mb-4"
      role="alert"
      aria-live="assertive"
    >
      <p className="font-medium">
        {errorTranslationKey ? renderKeyedMessage(t, tErrors, errorTranslationKey) : error}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 h-auto px-2 py-1 text-xs"
        onClick={onRetry}
        disabled={pending}
      >
        {t('retry')}
      </Button>
    </div>
  )
}

export function DiscoverySession({
  sessionId,
}: {
  sessionId: string
}) {
  const tProgress = useTranslations('DiscoveryProgress')
  const tInterview = useTranslations('DiscoveryInterview')
  const tErrors = useTranslations('Errors')
  const fmt = useFormatter()

  const session = useDiscoverySession({ sessionId })

  const status = session.status
  const phase = session.phase
  const pending = session.pending

  // Loading state before first hydration
  if (phase === 'loading' && !status) {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground">{tProgress('waitingForUpdates')}</p>
      </div>
    )
  }

  // Researching phase — show progress timeline with single authoritative status
  if (phase === 'researching') {
    return (
      <div className="py-8">
        <ProgressTimeline
          sessionId={sessionId}
          onContinueToInterview={async () => {
            await session.refresh()
          }}
        />
      </div>
    )
  }

  // Interview/review/confirmed/failed
  if (!status) {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground">{tErrors('generic')}</p>
        <Button onClick={session.retryLoad} className="mt-4">
          {tProgress('retry')}
        </Button>
      </div>
    )
  }

  // Terminal failed/cancelled
  if (phase === 'failed') {
    return (
      <div className="py-8 max-w-2xl mx-auto">
        <div className="p-6 rounded-xl bg-destructive/10 text-destructive border border-destructive/20 text-center">
          <h2 className="text-lg font-semibold">{tInterview('terminalFailedTitle')}</h2>
          <p className="text-sm mt-2">{tInterview('terminalFailedDescription')}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={session.retryLoad} variant="outline">
              {tProgress('retry')}
            </Button>
            <Link href="/discovery" className={buttonVariants()}>
              {tInterview('backToDiscovery')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Load error with retry
  if (phase === 'load_error') {
    return (
      <div className="py-8 text-center">
        <p className="text-muted-foreground">
          {session.errorTranslationKey ? renderKeyedMessage(tProgress, tErrors, session.errorTranslationKey) : session.error}
        </p>
        <Button onClick={session.retryLoad} className="mt-4">
          {tProgress('retry')}
        </Button>
      </div>
    )
  }

  // Review phase
  if (phase === 'review' && status.profile_draft) {
    return (
      <div className="py-8 max-w-3xl mx-auto">
        <ActionErrorBanner
          error={session.error}
          errorTranslationKey={session.errorTranslationKey}
          pending={pending}
          onRetry={session.refresh}
          t={tProgress}
          tErrors={tErrors}
        />
        <DraftReview
          status={status}
          draft={status.profile_draft}
          pending={pending}
          disabled={pending}
          onConfirm={(acknowledgeIncomplete) => {
            session.confirm({
              profile_draft_id: status.profile_draft!.id,
              owner_confirmation: true,
              acknowledge_incomplete: acknowledgeIncomplete ? true : undefined,
            })
          }}
        />
      </div>
    )
  }

  // Confirmed phase
  if (phase === 'confirmed' && status.profile_draft) {
    return (
      <div className="py-8 max-w-3xl mx-auto">
        <ActionErrorBanner
          error={session.error}
          errorTranslationKey={session.errorTranslationKey}
          pending={pending}
          onRetry={session.refresh}
          t={tProgress}
          tErrors={tErrors}
        />
        <ConfirmationSuccess draft={status.profile_draft} onRefresh={session.refresh} />
      </div>
    )
  }

  // Interview phase (default for partial_ready, ready_for_chat, research_failed, in_progress)
  const readiness = status.profile_state.readiness
  const showFinish = canOpenInterview(status.status)
  const uncertainties = status.profile_state.uncertainties

  return (
    <div className="py-6">
      {/* Title + lifecycle status */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy">{tInterview('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {status.intelligence?.status === 'partial' && (
              <span className="text-warning">{tProgress('errorPartialResearch')}</span>
            )}
            {status.intelligence?.status === 'failed' && (
              <span className="text-warning">{tProgress('errorResearchFailed')}</span>
            )}
          </p>
        </div>
        {showFinish && (
          <div className="hidden sm:block w-48">
            <FinishDialog
              readiness={readiness}
              pending={pending}
              disabled={pending}
              onConfirm={() => {
                if (readiness.ready) {
                  session.summarize({})
                } else {
                  session.summarize({ finish_anyway: true })
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Mobile readiness summary */}
      <div className="md:hidden mb-4">
        <div className="p-3 rounded-lg bg-surface border border-border text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{tInterview('overallReadiness')}</span>
            <span className="font-semibold text-navy">{fmt.number(readiness.profile_readiness, { style: 'percent' })}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-muted-foreground">{tInterview('turnCountLabel')}</span>
            <span className="tabular-nums">{fmt.number(readiness.owner_turn_count)} / {fmt.number(readiness.max_owner_turns)}</span>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Conversation */}
        <div className="flex-1 min-w-0">
          <ConversationPanel
            messages={status.messages ?? []}
            currentQuestion={status.current_question}
            pending={pending}
            error={session.error}
            errorTranslationKey={session.errorTranslationKey}
            onSubmit={session.respond}
            onRetryStatus={session.refresh}
            disabled={pending}
          />
          {/* Mobile finish */}
          {showFinish && (
            <div className="mt-4 sm:hidden">
              <FinishDialog
                readiness={readiness}
                pending={pending}
                disabled={pending}
                onConfirm={() => {
                  if (readiness.ready) {
                    session.summarize({})
                  } else {
                    session.summarize({ finish_anyway: true })
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* Readiness ledger (desktop) */}
        <div className="hidden md:block w-80 shrink-0">
          <ReadinessLedger
            readiness={readiness}
            uncertainties={uncertainties}
          />
        </div>
      </div>
    </div>
  )
}
