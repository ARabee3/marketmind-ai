'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { getCurrentJourney } from '@/lib/api/journey'
import { getStrategy, getStrategyProgress, toStrategyResource } from '@/lib/api/strategy'
import type { CurrentJourneyResponse, StrategyProgressEvent, StrategyResource } from '@marketmind/contracts'
import {
  getReadinessItems,
  ownerProgressLabel,
} from '../lib/strategy-state'
import { StrategyProfileSummary } from './strategy-profile-summary'
import { StrategyProgress } from './strategy-progress'
import { StrategyReadiness } from './strategy-readiness'

type PageState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'no_strategy'; journey: CurrentJourneyResponse }
  | {
      phase: 'ready'
      journey: CurrentJourneyResponse
      resource: StrategyResource
      progress: readonly StrategyProgressEvent[]
    }

async function loadJourney(): Promise<PageState> {
  try {
    const journey = await getCurrentJourney()
    const fc = journey.future_phase
    if (fc.availability === 'available' && fc.strategy_id) {
      const [api, progress] = await Promise.all([
        getStrategy(fc.strategy_id),
        getStrategyProgress(fc.strategy_id),
      ])
      return { phase: 'ready', journey, resource: toStrategyResource(api), progress }
    }
    return { phase: 'no_strategy', journey }
  } catch {
    return { phase: 'error' }
  }
}

export function StrategyHome() {
  const t = useTranslations('Strategy')
  const tc = useTranslations('Common')
  const [state, setState] = useState<PageState>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const nextState = await loadJourney()
      if (!cancelled) setState(nextState)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function retryJourney() {
    setState({ phase: 'loading' })
    setState(await loadJourney())
  }

  if (state.phase === 'loading') {
    return (
      <section className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-muted-foreground">{tc('loading')}</p>
      </section>
    )
  }

  if (state.phase === 'error') {
    return (
      <section className="flex min-h-40 items-center justify-center">
        <div className="grid max-w-md gap-3 text-center" role="alert">
          <p className="text-sm text-warning">{t('home.loadError')}</p>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void retryJourney()}
            >
              {t('home.retry')}
            </Button>
          </div>
        </div>
      </section>
    )
  }

  const journey = state.journey
  const isConfirmed = journey.journey.state === 'discovery_confirmed'
  const profile = isConfirmed && journey.journey.profile
    ? {
        businessName: journey.journey.profile.business_name,
        businessType: journey.journey.profile.business_type,
        location: [journey.journey.profile.city, journey.journey.profile.area].filter(Boolean).join(', '),
        confirmedAt: journey.journey.profile.confirmed_at,
        version: journey.journey.profile.version,
      }
    : null

  if (state.phase === 'no_strategy') {
    return (
      <section className="grid gap-5">
        <header className="relative overflow-hidden rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
          <div className="pointer-events-none absolute -top-20 end-8 size-56 rounded-full bg-primary/30 blur-3xl" />
          <div className="relative grid gap-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
                  {t('home.eyebrow')}
                </p>
                <h1 className="mt-3 max-w-3xl text-3xl leading-tight font-bold md:text-5xl">
                  {t('home.title')}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">{t('home.subtitle')}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/strategy/new" className={buttonVariants({ size: 'lg', className: 'shadow-tactile' })}>
                  {t('home.start')}
                </Link>
              </div>
            </div>
          </div>
        </header>
        {profile ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <StrategyProfileSummary profile={profile} />
          </div>
        ) : null}
      </section>
    )
  }

  const { resource } = state
  const readiness = getReadinessItems(resource, profile !== null)
  const statusLabel = ownerProgressLabel(resource.status)

  return (
    <section className="grid gap-5">
      <header className="relative overflow-hidden rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <div className="pointer-events-none absolute -top-20 end-8 size-56 rounded-full bg-primary/30 blur-3xl" />
        <div className="relative grid gap-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
                {t('home.eyebrow')}
              </p>
              <h1 className="mt-3 max-w-3xl text-3xl leading-tight font-bold md:text-5xl">
                {t('home.title')}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">{t('home.subtitle')}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href={`/strategy/${resource.strategy_id}/review`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40">
                {t('home.review')}
                <ArrowUpRight className="size-4 rtl:scale-x-[-1]" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid gap-5">
          <StrategyProfileSummary profile={profile} />
          <StrategyProgress status={resource.status} progress={state.progress} />
        </div>
        <aside className="grid gap-5 lg:sticky lg:top-24">
          <StrategyReadiness resource={resource} readiness={readiness} />
          <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
            <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
              {t('home.currentLabel')}
            </p>
            <h2 className="mt-2 text-xl font-bold text-navy">{t(`progress.labels.${statusLabel}`)}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('home.currentBody')}</p>
          </section>
        </aside>
      </div>
    </section>
  )
}
