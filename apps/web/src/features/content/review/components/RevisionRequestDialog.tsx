'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertCircle, Loader2, MessageSquarePlus, X } from 'lucide-react'

type RevisionRequestDialogProps = {
  isOpen: boolean
  versionNumber: number
  isSubmitting: boolean
  onClose: () => void
  onSubmit: (notes: string) => void
}

export function RevisionRequestDialog({
  isOpen,
  versionNumber,
  isSubmitting,
  onClose,
  onSubmit,
}: RevisionRequestDialogProps) {
  const t = useTranslations('ContentReview.revisionDialog')
  const [notes, setNotes] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Focus the dialog on open, close on Escape, trap Tab inside the dialog,
  // lock background body scroll, and restore focus to the trigger on close.
  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    closeButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const container = dialogRef.current
      if (!container) return

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey) {
        if (activeElement === first || !container.contains(activeElement)) {
          event.preventDefault()
          last.focus()
        }
      } else if (activeElement === last || !container.contains(activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!notes.trim()) {
      setValidationError(t('notesRequiredError'))
      return
    }
    setValidationError(null)
    onSubmit(notes.trim())
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="revision-dialog-title"
      aria-describedby="revision-dialog-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/45 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl space-y-4">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-warning" aria-hidden="true" />
            <div>
              <h2
                id="revision-dialog-title"
                className="text-lg font-bold text-navy"
              >
                {t('title')}
              </h2>
              <p id="revision-dialog-description" className="text-xs text-muted-foreground">
                {t('subtitle')}
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded p-1 text-muted-foreground hover:text-navy outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{t('cancel')}</span>
          </button>
        </div>

        {/* Current Version Indicator */}
        <div className="rounded bg-muted px-3 py-2 text-xs font-semibold text-navy border border-border">
          {t('currentVersionPreview', { version: versionNumber })}
        </div>

        {/* Revision Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="revision-notes-input"
              className="block text-sm font-semibold text-navy mb-1"
            >
              {t('notesLabel')}{' '}
              <span className="text-destructive">*</span>
            </label>
            <textarea
              id="revision-notes-input"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                if (validationError) setValidationError(null)
              }}
              disabled={isSubmitting}
              placeholder={t('notesPlaceholder')}
              rows={4}
              className="w-full rounded-md border border-border p-3 text-sm text-navy outline-none focus-visible:ring-2 focus-visible:ring-primary placeholder:text-muted-foreground bg-background"
            />
            {validationError && (
              <div
                role="alert"
                className="flex items-center gap-1.5 mt-1 text-xs font-semibold text-destructive"
              >
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <span>{validationError}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-navy hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('cancel')}
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-md bg-warning px-4 py-2 text-sm font-bold text-white hover:bg-warning/90 outline-none focus-visible:ring-2 focus-visible:ring-warning focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{t('submitting')}</span>
                </>
              ) : (
                <span>{t('submit')}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
