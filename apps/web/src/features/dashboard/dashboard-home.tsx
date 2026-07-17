'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getCurrentJourney } from '@/lib/api/journey'
import { buttonVariants } from '@/components/ui/button'
import { useSession } from '@/features/auth/session-provider'
import {
  mapCurrentJourney,
  unavailableDashboardState,
  type DashboardJourneyState,
} from './dashboard-state'
import { DashboardOnboarding } from './dashboard-onboarding'
import { BusinessSnapshot, DashboardLoading, NextActionPanel } from './dashboard-panels'
import { JourneyRail } from './dashboard-journey-rail'

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly journey: DashboardJourneyState }
  | { readonly status: 'error'; readonly journey: DashboardJourneyState }

export function DashboardHome() {
  const t = useTranslations('Dashboard')
  const { user } = useSession()
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

  const loadJourney = useCallback(async () => {
    setLoadState({ status: 'loading' })
    try {
      const response = await getCurrentJourney()
      setLoadState({
        status: 'ready',
        journey: mapCurrentJourney(response),
      })
    } catch {
      setLoadState({
        status: 'error',
        journey: unavailableDashboardState(),
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadInitialJourney() {
      try {
        const response = await getCurrentJourney()
        if (cancelled) return
        setLoadState({
          status: 'ready',
          journey: mapCurrentJourney(response),
        })
      } catch {
        if (cancelled) return
        setLoadState({
          status: 'error',
          journey: unavailableDashboardState(),
        })
      }
    }

    void loadInitialJourney()

    return () => {
      cancelled = true
    }
  }, [])

  if (loadState.status === 'loading') {
    return <DashboardLoading />
  }

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <header className="relative overflow-hidden rounded-xl bg-navy px-5 py-6 text-primary-foreground shadow-elevated md:px-7 md:py-8">
        <div className="pointer-events-none absolute -top-24 end-6 h-56 w-56 rounded-full bg-primary/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 start-10 h-56 w-56 rounded-full bg-journey-mint/20 blur-3xl" />
        <div className="relative grid gap-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-journey-mint uppercase">
            {t('eyebrow')}
          </p>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-2">
            <h1 className="max-w-3xl text-3xl leading-tight font-bold text-primary-foreground md:text-4xl lg:text-5xl">
              {loadState.journey.ownerName ? (
                <>
                  {t('welcomeBack')}{' '}
                  <bdi>{loadState.journey.ownerName}</bdi>
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
        <NextActionPanel journey={loadState.journey} />
        <BusinessSnapshot journey={loadState.journey} />
      </div>

      <div className="mt-12 md:mt-0">
        <JourneyRail activeKind={loadState.journey.kind} />
      </div>
    </section>
  )
}
