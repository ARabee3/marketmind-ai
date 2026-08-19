'use client'

import { useTranslations } from 'next-intl'
import { CheckCircle2, ArrowRight, ShieldCheck } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { PublicationCandidateV1 } from '@marketmind/contracts'
import { Tooltip } from '@/components/ui/tooltip'

type PublicationHandoffBannerProps = {
  candidate?: PublicationCandidateV1 | null
}

export function PublicationHandoffBanner({
  candidate,
}: PublicationHandoffBannerProps) {
  const t = useTranslations('ContentReview.handoff')
  const tTooltips = useTranslations('ContentReview.tooltips')

  if (!candidate) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span>{t('statusNone')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-soft-teal p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-navy font-bold text-sm sm:text-base">
          <CheckCircle2 className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
          <span>{t('statusActive')}</span>
          <Tooltip content={tTooltips('candidate')} iconClassName="h-3.5 w-3.5 text-primary hover:text-primary/80 transition-colors" />
        </div>
        <p className="text-xs text-navy leading-relaxed max-w-xl">
          {t('description')}
        </p>
        <div className="font-mono text-[11px] text-muted-foreground pt-1 inline-flex items-center gap-1">
          {t('candidateId', { id: candidate.candidate_id.slice(0, 8) })} ·{' '}
          {t('checksum', { checksum: candidate.content_item_version_checksum.slice(0, 8) })}
          <Tooltip content={tTooltips('checksum')} iconClassName="h-3 w-3 text-primary hover:text-primary/80 transition-colors" />
        </div>
      </div>

      <Link
        href={{ pathname: '/publishing', query: { candidate: candidate.candidate_id } }}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 shrink-0"
      >
        <span>{t('openPublishing')}</span>
        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </Link>
    </div>
  )
}
