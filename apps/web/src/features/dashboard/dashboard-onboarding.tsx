'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

const STORAGE_PREFIX = 'marketmind.dashboardOnboarding.v1'
const DISMISSED_VALUE = 'dismissed'
const STEPS = ['control', 'profile', 'evidence', 'confirm'] as const

export function dashboardOnboardingStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}`
}

export function DashboardOnboarding({ userId }: { readonly userId: string | null }) {
  const t = useTranslations('Dashboard.onboarding')
  const [open, setOpen] = useState(() => shouldOpenOnboarding(userId))
  const [stepIndex, setStepIndex] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const step = STEPS[stepIndex]
  const isLastStep = stepIndex === STEPS.length - 1

  useEffect(() => {
    if (!userId) return
    if (isOnboardingDismissed(userId)) return
    if (open) return

    const timeoutId = window.setTimeout(() => {
      setOpen(true)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [open, userId])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const firstFocusable = getFocusableElements(dialogRef.current)[0]
    firstFocusable?.focus()

    return () => {
      previousFocusRef.current?.focus()
    }
  }, [open])

  const dismiss = useCallback(() => {
    if (userId) markOnboardingDismissed(userId)
    setOpen(false)
    setStepIndex(0)
  }, [userId])

  const replay = useCallback(() => {
    setStepIndex(0)
    setOpen(true)
  }, [])

  return (
    <>
      <Button type="button" size="lg" className="shadow-tactile" onClick={replay}>
        {t('replay')}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-navy/45 p-3 md:place-items-center">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-onboarding-title"
            aria-describedby="dashboard-onboarding-body"
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="w-full max-w-xl overscroll-contain rounded-lg border border-border bg-surface p-4 shadow-xl md:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-2">
                <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
                  {t('eyebrow', { current: stepIndex + 1, total: STEPS.length })}
                </p>
                <h2 id="dashboard-onboarding-title" className="text-2xl font-bold text-navy">
                  {t(`steps.${step}.title`)}
                </h2>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={dismiss}>
                {t('skip')}
              </Button>
            </div>

            <p
              id="dashboard-onboarding-body"
              className="mt-4 text-sm leading-7 text-muted-foreground md:text-base"
            >
              {t(`steps.${step}.body`)}
            </p>

            <ol className="mt-5 grid grid-cols-4 gap-2" aria-label={t('progressLabel')}>
              {STEPS.map((item, index) => (
                <li
                  key={item}
                  className={
                    index <= stepIndex
                      ? 'h-1.5 rounded-full bg-primary'
                      : 'h-1.5 rounded-full bg-muted'
                  }
                />
              ))}
            </ol>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="secondary"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              >
                {t('back')}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={dismiss}>
                  {t('skip')}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (isLastStep) {
                      dismiss()
                      return
                    }
                    setStepIndex((current) => Math.min(STEPS.length - 1, current + 1))
                  }}
                >
                  {isLastStep ? t('start') : t('next')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function isOnboardingDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(dashboardOnboardingStorageKey(userId)) === DISMISSED_VALUE
  } catch {
    return false
  }
}

function shouldOpenOnboarding(userId: string | null): boolean {
  if (!userId) return false
  return !isOnboardingDismissed(userId)
}

function markOnboardingDismissed(userId: string): void {
  try {
    localStorage.setItem(dashboardOnboardingStorageKey(userId), DISMISSED_VALUE)
  } catch {
    return
  }
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return

  const focusable = getFocusableElements(event.currentTarget)
  if (focusable.length === 0) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
    return
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  )
}
