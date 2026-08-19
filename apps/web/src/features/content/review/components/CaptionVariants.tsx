'use client'

import { useTranslations } from 'next-intl'
import type { ContentCaptionVariant } from '@marketmind/contracts'
import { Tooltip } from '@/components/ui/tooltip'

type CaptionVariantsProps = {
  variants: readonly ContentCaptionVariant[]
  cta?: string | null
  hashtags?: readonly string[]
}

export function CaptionVariants({
  variants,
  cta,
  hashtags,
}: CaptionVariantsProps) {
  const t = useTranslations('ContentReview.proof')
  const tTooltips = useTranslations('ContentReview.tooltips')

  const arabicVariant = variants.find((v) => v.locale === 'ar') ?? variants[0]
  const englishVariant = variants.find((v) => v.locale === 'en')

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-sm font-bold text-navy uppercase tracking-wider">
        {t('captionArabic')}
      </h3>

      {/* Primary Arabic Caption */}
      {arabicVariant && (
        <div
          dir="rtl"
          className="rounded-md border border-border bg-muted/40 p-4 font-sans text-base leading-relaxed text-navy text-start"
        >
          <p className="whitespace-pre-wrap">{arabicVariant.caption}</p>
          <div className="mt-2 text-xs font-semibold text-primary">
            {t('dialect', { dialect: arabicVariant.dialect })}
          </div>
        </div>
      )}

      {/* Optional English Caption */}
      {englishVariant && (
        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
            {t('captionEnglish')}
          </h4>
          <div
            dir="ltr"
            className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed text-navy text-start"
          >
            <p className="whitespace-pre-wrap">{englishVariant.caption}</p>
          </div>
        </div>
      )}

      {/* CTA & Hashtags */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border text-xs">
        <div>
          <span className="font-semibold text-muted-foreground inline-flex items-center mb-1">
            {t('cta')}
            <Tooltip content={tTooltips('cta')} />
          </span>
          <span className="inline-block rounded bg-soft-teal px-2.5 py-1 font-medium text-primary border border-primary/20">
            {cta || arabicVariant?.cta || '—'}
          </span>
        </div>

        <div>
          <span className="font-semibold text-muted-foreground block mb-1">
            {t('hashtags')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(hashtags ?? arabicVariant?.hashtags ?? []).map((tag, idx) => (
              <span
                key={idx}
                className="inline-block rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground border border-border"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
