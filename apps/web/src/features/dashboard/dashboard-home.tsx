'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { getCurrentJourney, type JourneyApiError } from '@/lib/api/journey'
import { buttonVariants } from '@/components/ui/button'
import { useSession } from '@/features/auth/session-provider'
import { LogoutButton } from '@/features/auth/logout-button'
import { ResendVerificationForm } from '@/features/auth/resend-verification-form'
import {
  errorDashboardState,
  mapCurrentJourney,
  type DashboardJourneyState,
} from './dashboard-state'
import { DashboardOnboarding } from './dashboard-onboarding'
import { BusinessSnapshot, DashboardLoading, NextActionPanel } from './dashboard-panels'
import { JourneyRail } from './dashboard-journey-rail'

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly journey: DashboardJourneyState }
  | { readonly status: 'verification_required'; readonly ownerEmail: string }
  | { readonly status: 'error' }

export function DashboardHome() {
  const t = useTranslations('Dashboard')
  const { user, logout } = useSession()
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

  // Capture logout/router/userEmail in refs so the error resolver stays
  // identity-stable; otherwise the initial-load effect would re-fire whenever
  // the navigation router or session value changes identity across renders.
  const logoutRef = useRef(logout)
  const routerRef = useRef(router)
  const userEmailRef = useRef(user?.email ?? '')
  useEffect(() => {
    logoutRef.current = logout
    routerRef.current = router
    userEmailRef.current = user?.email ?? ''
  })

  const resolveLoadError = useCallback(
    async (error: unknown): Promise<LoadState> => {
      const status = (error as JourneyApiError | null)?.status

      if (status === 401) {
        // Refresh already failed inside apiRequest's single retry. Clear the
        // stale in-memory session and return the user to localized login
        // instead of leaving an authenticated shell visible.
        await logoutRef.current()
        routerRef.current.replace('/login')
        return { status: 'loading' }
      }

      if (status === 403) {
        // Forbidden — treat as an unverified owner and show verification
        // guidance. No journey CTA is exposed.
        return {
          status: 'verification_required',
          ownerEmail: userEmailRef.current,
        }
      }

      // 5xx, network failure, or any other non-auth error: retryable, no
      // Start Discovery action, no "journey unavailable" claim.
      return { status: 'error' }
    },
    [],
  )

  const loadJourney = useCallback(async () => {
    setLoadState({ status: 'loading' })
    try {
      const response = await getCurrentJourney()
      if (!response.owner.email_verified) {
        setLoadState({
          status: 'verification_required',
          ownerEmail: response.owner.email,
        })
        return
      }
      setLoadState({
        status: 'ready',
        journey: mapCurrentJourney(response),
      })
    } catch (error) {
      const next = await resolveLoadError(error)
      setLoadState(next)
    }
  }, [resolveLoadError])

  useEffect(() => {
    let cancelled = false

    async function loadInitialJourney() {
      try {
        const response = await getCurrentJourney()
        if (cancelled) return
        if (!response.owner.email_verified) {
          setLoadState({
            status: 'verification_required',
            ownerEmail: response.owner.email,
          })
          return
        }
        setLoadState({
          status: 'ready',
          journey: mapCurrentJourney(response),
        })
      } catch (error) {
        if (cancelled) return
        const next = await resolveLoadError(error)
        if (cancelled) return
        setLoadState(next)
      }
    }

    void loadInitialJourney()

    return () => {
      cancelled = true
    }
  }, [resolveLoadError])

  if (loadState.status === 'loading') {
    return <DashboardLoading />
  }

  if (loadState.status === 'verification_required') {
    return <VerificationPanel ownerEmail={loadState.ownerEmail} />
  }

  const journey: DashboardJourneyState =
    loadState.status === 'error' ? errorDashboardState() : loadState.journey

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <header className="relative overflow-hidden rounded-xl bg-navy px-5 py-6 text-primary-foreground shadow-elevated md:px-7 md:py-8">
        <div className="pointer-events-none absolute -top-24 end-6 h-56 w-56 rounded-full bg-primary/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 start-10 h-56 w-56 rounded-full bg-journey-mint/20 blur-3xl" />
        <div className="relative grid gap-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-journey-mint uppercase">
            {t('eyebrow')}
          </p>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr) auto] md:items-end">
            <div className="grid gap-2">
              <h1 className="max-w-3xl text-3xl leading-tight font-bold text-primary-foreground md:text-4xl lg:text-5xl">
                {journey.ownerName ? (
                  <>
                    {t('welcomeBack')} <bdi>{journey.ownerName}</bdi>
                  </>
                ) : (
                  t('title')
                )}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-primary-foreground/75 md:text-base">
                {t('subtitle')}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row md:justify-end">
              <DashboardOnboarding userId={user?.id ?? null} />
              {loadState.status === 'error' ? (
                <button
                  type="button"
                  onClick={loadJourney}
                  className={buttonVariants({ variant: 'outline', size: 'lg' })}
                >
                  {t('retry')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {loadState.status === 'error' ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('loadError')}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <NextActionPanel journey={journey} />
        <BusinessSnapshot journey={journey} />
      </div>

      <div className="mt-12 md:mt-0">
        <JourneyRail activeKind={journey.kind} />
      </div>
    </section>
  )
}

function VerificationPanel({ ownerEmail }: { readonly ownerEmail: string }) {
  const t = useTranslations('Dashboard.verification')

  return (
    <section className="grid gap-5">
      <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
        <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            {t('title')}
          </p>
        </div>
        <div className="grid gap-5 p-4 md:p-5">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t('body')}</p>
          <div className="rounded-card border border-border bg-bg p-4">
            <p className="mb-3 text-xs font-semibold text-muted">{t('resendPrompt')}</p>
            <ResendVerificationForm mode="inline" defaultEmail={ownerEmail} />
          </div>
          <div className="flex flex-wrap gap-3">
            <LogoutButton />
          </div>
        </div>
      </article>
    </section>
  )
}