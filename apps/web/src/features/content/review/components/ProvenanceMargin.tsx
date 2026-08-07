'use client'

import { useFormatter, useTranslations } from 'next-intl'
import {
  Target,
  User,
  CheckCircle2,
  PenLine,
  AlertTriangle,
  OctagonAlert,
} from 'lucide-react'
import type { ContentItemVersion, ContentWeekContext } from '@marketmind/contracts'
import { Tooltip } from '@/components/ui/tooltip'

type ProvenanceMarginProps = {
  version: ContentItemVersion
  weekContext: ContentWeekContext
}

export function ProvenanceMargin({
  version,
  weekContext,
}: ProvenanceMarginProps) {
  const t = useTranslations('ContentReview.provenance')
  const tErr = useTranslations('ContentReview.errors')
  const tTooltips = useTranslations('ContentReview.tooltips')
  const format = useFormatter()

  const { strategy_trace, claim_sources, warnings, blockers } = version

  const localizeError = (code: string): string =>
    tErr(code as Parameters<typeof tErr>[0]) || code

  const focusText =
    weekContext.promotion?.text ||
    (weekContext.must_include && weekContext.must_include.length > 0
      ? weekContext.must_include.join(', ')
      : t('focusFallback'))

  return (
    <aside
      aria-label={t('title')}
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-6"
    >
      <div>
        <h3 className="text-sm font-bold text-[var(--color-navy)] uppercase tracking-wider">
          {t('title')}
        </h3>
        <p className="text-xs text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {/* 1. Strategy Trace */}
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2 text-teal-800">
          <Target className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">
            {t('strategyTrace')}
          </h4>
        </div>

        <div className="space-y-1.5 text-xs text-slate-700 bg-teal-50/50 p-3 rounded border border-teal-200">
          <div>
            <span className="font-semibold text-teal-950 inline-flex items-center">
              {t('objectiveLabel')}
            </span>{' '}
            {strategy_trace.objective}
          </div>
          <div>
            <span className="font-semibold text-teal-950 inline-flex items-center">
              {t('pillar')}
              <Tooltip content={tTooltips('pillar')} />
            </span>{' '}
            {strategy_trace.content_purpose}
          </div>
          <div>
            <span className="font-semibold text-teal-950 inline-flex items-center">
              {t('funnelStage')}
              <Tooltip content={tTooltips('funnelStage')} />
            </span>{' '}
            <span className="capitalize">{strategy_trace.funnel_stage}</span>
          </div>
        </div>
      </section>

      {/* 2. Week Context */}
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2 text-sky-800">
          <User className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">
            {t('weekContext')}
          </h4>
        </div>

        <div className="space-y-1 text-xs text-slate-700 bg-sky-50/50 p-3 rounded border border-sky-200">
          <div className="font-semibold text-sky-950">
            {t('focusOffer', { offer: focusText })}
          </div>
          {weekContext.must_avoid && weekContext.must_avoid.length > 0 && (
            <p className="text-slate-600 mt-1">
              {t('mustAvoidList', { list: weekContext.must_avoid.join(', ') })}
            </p>
          )}
        </div>
      </section>

      {/* 3. Profile Claim Sources */}
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2 text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">
            {t('profileFact')}
          </h4>
        </div>

        {claim_sources.length > 0 ? (
          <ul className="space-y-1.5 text-xs">
            {claim_sources.map((claim, idx) => (
              <li
                key={idx}
                className="flex items-start justify-between gap-2 p-2 rounded border border-emerald-200 bg-emerald-50/50"
              >
                <div>
                  <span className="font-semibold text-emerald-950 capitalize">
                    {claim.claim_type.replace(/_/g, ' ')}
                  </span>
                  <p className="text-[11px] text-slate-600 font-mono mt-0.5">
                    {claim.source_path}
                  </p>
                </div>
                <span
                  className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                    claim.approved
                      ? 'bg-emerald-200 text-emerald-900'
                      : 'bg-amber-200 text-amber-900'
                  }`}
                >
                  {claim.approved ? t('factApproved') : t('factUnapproved')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500 italic bg-slate-50 p-2.5 rounded border border-slate-200">
            {t('noClaims')}
          </p>
        )}
      </section>

      {/* 4. Model Copy Provenance */}
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2 text-slate-700">
          <PenLine className="h-4 w-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider inline-flex items-center">
            {t('modelCopy')}
            <Tooltip content={tTooltips('modelCopy')} />
          </h4>
        </div>

        <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded border border-slate-200 space-y-1">
          <div>
            <span className="font-semibold text-slate-800">{t('providerLabel')}</span>{' '}
            {version.generation_provenance.provider_name} (
            {version.generation_provenance.provider_model})
          </div>
          <div>
            <span className="font-semibold text-slate-800">{t('generatedLabel')}</span>{' '}
            {format.dateTime(new Date(version.generation_provenance.generated_at), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </div>
        </div>
      </section>

      {/* 5. Warnings */}
      {warnings.length > 0 && (
        <section className="space-y-2 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            <h4 className="text-xs font-bold uppercase tracking-wider">
              {t('warnings')}
            </h4>
          </div>
          <ul className="space-y-1">
            {warnings.map((w, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 p-2 rounded text-xs border bg-amber-100 text-amber-900 border-amber-400"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">{localizeError(w)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. Blockers */}
      {blockers.length > 0 && (
        <section className="space-y-2 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2 text-red-800">
            <OctagonAlert className="h-4 w-4 text-red-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider">
              {t('blockers')}
            </h4>
          </div>
          <ul className="space-y-1.5">
            {blockers.map((b, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 p-2.5 rounded text-xs font-bold border bg-red-100 text-red-900 border-red-400"
              >
                <OctagonAlert className="h-4 w-4 shrink-0 text-red-600" />
                <span>{localizeError(b)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
