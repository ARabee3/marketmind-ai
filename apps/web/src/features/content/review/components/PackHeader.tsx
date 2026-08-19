'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { ContentPack, ContentWeekContext } from '@marketmind/contracts'

type PackHeaderProps = {
  pack: ContentPack
  weekContext: ContentWeekContext
}

export function PackHeader({ pack, weekContext }: PackHeaderProps) {
  const t = useTranslations('ContentReview.header')
  const format = useFormatter()

  const cycleUrl = `/content/${pack.content_cycle_id}/weeks/${pack.week_number}`

  // A week runs from its start date through six following days, in Cairo time.
  const startDate = new Date(`${weekContext.week_start_date}T00:00:00.000Z`)
  const endDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000)
  const startDateStr = format.dateTime(startDate, {
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Cairo',
  })
  const endDateStr = format.dateTime(endDate, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  })

  return (
    <header className="border-b border-border bg-surface py-5 px-4 sm:px-6 mb-6">
      <div className="mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {t('eyebrow', { week: pack.week_number })}
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-navy mt-1">
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('subtitle', { startsAt: startDateStr, endsAt: endDateStr })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground border border-border">
            {t('strategyVersion', { version: pack.strategy_version })}
          </span>
          <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground border border-border">
            {t('profileVersion', { id: pack.profile_version_id.slice(0, 8) })}
          </span>
          <span className="inline-flex items-center rounded-md bg-soft-teal px-2.5 py-1 text-xs font-medium text-primary border border-primary/20">
            {t('status', { status: pack.status })}
          </span>
          <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground border border-border">
            {t('itemCount', { count: pack.item_ids.length })}
          </span>

          <Link
            href={cycleUrl}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline ms-auto sm:ms-0 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-sm"
          >
            <ArrowLeft className="h-4 w-4 rtl:hidden" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 ltr:hidden" aria-hidden="true" />
            <span>{t('backToCycle')}</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
