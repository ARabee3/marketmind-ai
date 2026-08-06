'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { Calendar, Clock, Globe } from 'lucide-react'
import type { ContentPackWorkspaceItem } from '../types/review.types'
import { AssetPreview } from './AssetPreview'
import { CaptionVariants } from './CaptionVariants'
import { CreativeBriefPanel } from './CreativeBriefPanel'

type SelectedItemProofProps = {
  item: ContentPackWorkspaceItem
}

export function SelectedItemProof({ item }: SelectedItemProofProps) {
  const t = useTranslations('ContentReview.proof')
  const tAgenda = useTranslations('ContentReview.agenda')
  const format = useFormatter()
  const { current_version, assets } = item

  const currentAsset = assets.find(
    (a) => a.content_item_version_id === current_version.id,
  )

  const startDate = new Date(current_version.recommended_publish_window.starts_at)
  const endDate = new Date(current_version.recommended_publish_window.ends_at)

  const startTimeStr = format.dateTime(startDate, {
    hour: '2-digit',
    minute: '2-digit',
  })
  const endTimeStr = format.dateTime(endDate, {
    hour: '2-digit',
    minute: '2-digit',
  })

  const dayStr = format.dateTime(startDate, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })

  const channelLabel =
    tAgenda.has(`channel.${current_version.channel}`) &&
    (tAgenda.raw(`channel.${current_version.channel}`) as string)
  const formatLabel =
    tAgenda.has(`format.${current_version.format}`) &&
    (tAgenda.raw(`format.${current_version.format}`) as string)

  return (
    <article
      id={`item-proof-${item.item.id}`}
      aria-labelledby={`item-heading-${item.item.id}`}
      className="space-y-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6 shadow-xs"
    >
      {/* Proof Header */}
      <header className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block rounded bg-teal-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-teal-900 border border-teal-300">
                {channelLabel ?? current_version.channel}
              </span>
              <span className="inline-block rounded bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
                {formatLabel ?? current_version.format.replace(/_/g, ' ')}
              </span>
            </div>

            <h2
              id={`item-heading-${item.item.id}`}
              tabIndex={-1}
              className="text-xl font-bold text-[var(--color-navy)] mt-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
            >
              {dayStr} · {current_version.strategy_trace.objective}
            </h2>
          </div>

          <div className="text-end">
            <span className="inline-block rounded-md bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-800 border border-slate-200">
              {t('versionLabel', {
                version: current_version.version,
                checksum: current_version.version_checksum.slice(0, 8),
              })}
            </span>
          </div>
        </div>

        {/* Recommended Cairo Window */}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-200">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-[var(--color-primary)]" />
            <span>{dayStr}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-[var(--color-primary)]" />
            <span>{t('cairoTime', { startsAt: startTimeStr, endsAt: endTimeStr })}</span>
          </div>
          <div className="flex items-center gap-1.5 ms-auto">
            <Globe className="h-4 w-4 text-slate-500" />
            <span>{t('languageMode', { mode: current_version.language_mode })}</span>
          </div>
        </div>
      </header>

      {/* Asset Preview Section */}
      <section aria-label={t('title')}>
        <AssetPreview
          asset={currentAsset}
          assetRequired={current_version.asset_required}
          altText={current_version.alt_text}
        />
      </section>

      {/* Caption & Copy Section */}
      <section aria-label={t('captionArabic')}>
        <CaptionVariants
          variants={current_version.caption_variants}
          cta={current_version.cta}
          hashtags={current_version.hashtags}
        />
      </section>

      {/* Creative Brief & Script Section */}
      <section aria-label={t('creativeBrief')}>
        <CreativeBriefPanel
          creativeBrief={current_version.creative_brief}
          altText={current_version.alt_text}
          videoScript={current_version.short_video_script}
        />
      </section>
    </article>
  )
}
