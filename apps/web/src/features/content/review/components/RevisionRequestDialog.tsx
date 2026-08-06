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

  // Focus the dialog on open, close on Escape, and restore focus on close.
  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    closeButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl space-y-4">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-amber-700" />
            <div>
              <h2
                id="revision-dialog-title"
                className="text-lg font-bold text-[var(--color-navy)]"
              >
                {t('title')}
              </h2>
              <p id="revision-dialog-description" className="text-xs text-slate-500">
                {t('subtitle')}
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">{t('cancel')}</span>
          </button>
        </div>

        {/* Current Version Indicator */}
        <div className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-200">
          {t('currentVersionPreview', { version: versionNumber })}
        </div>

        {/* Revision Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="revision-notes-input"
              className="block text-sm font-semibold text-[var(--color-navy)] mb-1"
            >
              {t('notesLabel')}{' '}
              <span className="text-[var(--color-danger)]">*</span>
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
              className="w-full rounded-md border border-[var(--color-border)] p-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] placeholder:text-slate-400"
            />
            {validationError && (
              <div
                role="alert"
                className="flex items-center gap-1.5 mt-1 text-xs font-semibold text-[var(--color-danger)]"
              >
                <AlertCircle className="h-4 w-4" />
                <span>{validationError}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {t('cancel')}
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
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
