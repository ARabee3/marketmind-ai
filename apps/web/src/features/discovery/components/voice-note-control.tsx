'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { transcribeDiscoveryVoiceNote } from '@/lib/api/discovery'
import {
  useVoiceNoteRecorder,
  type VoiceNoteError,
} from '../hooks/use-voice-note-recorder'

export interface VoiceNoteControlProps {
  readonly sessionId: string
  readonly onTranscriptReady: (transcript: string) => void
  readonly onDiscard: () => void
  readonly hasDraft?: boolean
  readonly hasTypedText?: boolean
  readonly disabled?: boolean
  readonly className?: string
}

export function VoiceNoteControl({
  sessionId,
  onTranscriptReady,
  onDiscard,
  hasDraft = false,
  hasTypedText = false,
  disabled = false,
  className,
}: VoiceNoteControlProps) {
  const t = useTranslations('DiscoveryInterview')
  const recorder = useVoiceNoteRecorder(45)
  const [apiError, setApiError] = useState<VoiceNoteError>(null)

  const handleStopAndTranscribe = useCallback(async () => {
    setApiError(null)
    let blob: Blob | null = null

    try {
      blob = await recorder.stopRecording()
    } catch {
      recorder.reset()
      setApiError('failed')
      return
    }

    if (!blob) {
      return
    }

    try {
      const response = await transcribeDiscoveryVoiceNote(sessionId, blob)
      if (response.transcript) {
        recorder.reset()
        onTranscriptReady(response.transcript)
      } else {
        recorder.reset()
        setApiError('failed')
      }
    } catch (err) {
      recorder.reset()
      const status = (err as { status?: number })?.status
      if (status === 503) {
        setApiError('unavailable')
      } else if (status === 413) {
        setApiError('too_long')
      } else {
        setApiError('failed')
      }
    }
  }, [sessionId, recorder, onTranscriptReady])

  const handleDiscard = useCallback(() => {
    setApiError(null)
    recorder.reset()
    onDiscard()
  }, [recorder, onDiscard])

  if (!recorder.isSupported) {
    return null
  }

  const effectiveError = apiError || recorder.error

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 text-xs transition-all duration-200 motion-reduce:transition-none',
        className,
      )}
      role="region"
      aria-label={t('recordVoiceNote')}
    >
      {recorder.state === 'recording' && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleStopAndTranscribe}
            className="h-8 gap-1.5 px-3 text-xs"
            aria-live="polite"
          >
            <span className="h-2 w-2 rounded-full bg-white motion-safe:animate-pulse" />
            <span>{t('recording', { time: recorder.durationSeconds })}</span>
          </Button>
        </div>
      )}

      {recorder.state === 'transcribing' && (
        <div
          className="flex items-center gap-2 text-primary font-medium"
          aria-live="polite"
        >
          <span className="h-2 w-2 rounded-full bg-primary motion-safe:animate-ping" />
          <span>{t('transcribing')}</span>
        </div>
      )}

      {recorder.state === 'idle' && !hasDraft && (
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || hasTypedText}
            onClick={recorder.startRecording}
            className="h-8 gap-1.5 px-3 text-xs border-border hover:bg-muted"
            title={hasTypedText ? t('voiceNoteDisabledWithText') : undefined}
            aria-describedby="discovery-voice-note-explanation"
          >
            <svg
              className="h-3.5 w-3.5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            <span>{t('recordVoiceNote')}</span>
          </Button>
          {hasTypedText && (
            <span className="text-[11px] text-muted-foreground">
              {t('voiceNoteDisabledWithText')}
            </span>
          )}
        </div>
      )}

      {hasDraft && (
        <div className="flex items-center justify-between w-full gap-2 p-2 rounded-md bg-journey-mint/30 border border-primary/20">
          <span className="text-xs font-medium text-navy">
            {t('voiceDraftLabel')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
          >
            {t('discardDraft')}
          </Button>
        </div>
      )}

      {effectiveError && !hasDraft && (
        <div className="text-xs text-destructive font-medium" role="alert">
          {effectiveError === 'mic_denied' && t('voiceNoteErrorMicDenied')}
          {effectiveError === 'unavailable' && t('voiceNoteErrorUnavailable')}
          {effectiveError === 'too_long' && t('voiceNoteErrorTooLong')}
          {effectiveError === 'failed' && t('voiceNoteErrorFailed')}
        </div>
      )}

      <p
        id="discovery-voice-note-explanation"
        className="w-full text-[11px] leading-relaxed text-muted-foreground"
      >
        {t('voiceNoteExplanation')}
      </p>
    </div>
  )
}
