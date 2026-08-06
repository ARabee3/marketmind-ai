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
    <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <h3 className="text-sm font-bold text-[var(--color-navy)] uppercase tracking-wider">
        {t('captionArabic')}
      </h3>

      {/* Primary Arabic Caption */}
      {arabicVariant && (
        <div
          dir="rtl"
          className="rounded-md border border-slate-200 bg-slate-50 p-4 font-sans text-base leading-relaxed text-slate-900 text-start"
        >
          <p className="whitespace-pre-wrap">{arabicVariant.caption}</p>
          <div className="mt-2 text-xs font-semibold text-teal-800">
            {t('dialect', { dialect: arabicVariant.dialect })}
          </div>
        </div>
      )}

      {/* Optional English Caption */}
      {englishVariant && (
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
            {t('captionEnglish')}
          </h4>
          <div
            dir="ltr"
            className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800 text-start"
          >
            <p className="whitespace-pre-wrap">{englishVariant.caption}</p>
          </div>
        </div>
      )}

      {/* CTA & Hashtags */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
        <div>
          <span className="font-semibold text-slate-500 inline-flex items-center mb-1">
            {t('cta')}
            <Tooltip content={tTooltips('cta')} />
          </span>
          <span className="inline-block rounded bg-teal-50 px-2.5 py-1 font-medium text-teal-900 border border-teal-200">
            {cta || arabicVariant?.cta || '—'}
          </span>
        </div>

        <div>
          <span className="font-semibold text-slate-500 block mb-1">
            {t('hashtags')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(hashtags ?? arabicVariant?.hashtags ?? []).map((tag, idx) => (
              <span
                key={idx}
                className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 border border-slate-200"
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
