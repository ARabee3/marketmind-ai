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
      className="rounded-xl border border-border bg-surface p-5 space-y-6"
    >
      <div>
        <h3 className="text-sm font-bold text-navy uppercase tracking-wider">
          {t('title')}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {/* 1. Strategy Trace */}
      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-primary">
          <Target className="h-4 w-4" aria-hidden="true" />
          <h4 className="text-xs font-bold uppercase tracking-wider">
            {t('strategyTrace')}
          </h4>
        </div>

        <div className="space-y-1.5 text-xs text-navy bg-soft-teal/70 p-3 rounded border border-primary/20">
          <div>
            <span className="font-semibold text-navy inline-flex items-center">
              {t('objectiveLabel')}
            </span>{' '}
            {strategy_trace.objective}
          </div>
          <div>
            <span className="font-semibold text-navy inline-flex items-center">
              {t('pillar')}
              <Tooltip content={tTooltips('pillar')} />
            </span>{' '}
            {strategy_trace.content_purpose}
          </div>
          <div>
            <span className="font-semibold text-navy inline-flex items-center">
              {t('funnelStage')}
              <Tooltip content={tTooltips('funnelStage')} />
            </span>{' '}
            <span className="capitalize">{strategy_trace.funnel_stage}</span>
          </div>
        </div>
      </section>

      {/* 2. Week Context */}
      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-action">
          <User className="h-4 w-4" aria-hidden="true" />
          <h4 className="text-xs font-bold uppercase tracking-wider">
            {t('weekContext')}
          </h4>
        </div>

        <div className="space-y-1 text-xs text-navy bg-action/10 p-3 rounded border border-action/20">
          <div className="font-semibold text-navy">
            {t('focusOffer', { offer: focusText })}
          </div>
          {weekContext.must_avoid && weekContext.must_avoid.length > 0 && (
            <p className="text-muted-foreground mt-1">
              {t('mustAvoidList', { list: weekContext.must_avoid.join(', ') })}
            </p>
          )}
        </div>
      </section>

      {/* 3. Profile Claim Sources */}
      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-primary">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <h4 className="text-xs font-bold uppercase tracking-wider">
            {t('profileFact')}
          </h4>
        </div>

        {claim_sources.length > 0 ? (
          <ul className="space-y-1.5 text-xs">
            {claim_sources.map((claim, idx) => (
              <li
                key={idx}
                className="flex items-start justify-between gap-2 p-2 rounded border border-primary/30 bg-primary/10"
              >
                <div>
                  <span className="font-semibold text-navy capitalize">
                    {claim.claim_type.replace(/_/g, ' ')}
                  </span>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    {claim.source_path}
                  </p>
                </div>
                <span
                  className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                    claim.approved
                      ? 'bg-primary/20 text-primary'
                      : 'bg-warning/20 text-warning'
                  }`}
                >
                  {claim.approved ? t('factApproved') : t('factUnapproved')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground italic bg-muted/40 p-2.5 rounded border border-border">
            {t('noClaims')}
          </p>
        )}
      </section>

      {/* 4. Model Copy Provenance */}
      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-navy">
          <PenLine className="h-4 w-4" aria-hidden="true" />
          <h4 className="text-xs font-bold uppercase tracking-wider inline-flex items-center">
            {t('modelCopy')}
            <Tooltip content={tTooltips('modelCopy')} />
          </h4>
        </div>

        <div className="text-xs text-navy bg-muted/40 p-3 rounded border border-border space-y-1">
          <div>
            <span className="font-semibold text-navy">{t('providerLabel')}</span>{' '}
            {version.generation_provenance.provider_name} (
            {version.generation_provenance.provider_model})
          </div>
          <div>
            <span className="font-semibold text-navy">{t('generatedLabel')}</span>{' '}
            {format.dateTime(new Date(version.generation_provenance.generated_at), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </div>
        </div>
      </section>

      {/* 5. Warnings */}
      {warnings.length > 0 && (
        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <h4 className="text-xs font-bold uppercase tracking-wider">
              {t('warnings')}
            </h4>
          </div>
          <ul className="space-y-1">
            {warnings.map((w, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 p-2 rounded text-xs border bg-warning/15 text-warning border-warning/30"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="font-semibold">{localizeError(w)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. Blockers */}
      {blockers.length > 0 && (
        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-danger">
            <OctagonAlert className="h-4 w-4 text-danger" aria-hidden="true" />
            <h4 className="text-xs font-bold uppercase tracking-wider">
              {t('blockers')}
            </h4>
          </div>
          <ul className="space-y-1.5">
            {blockers.map((b, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 p-2.5 rounded text-xs font-bold border bg-danger/15 text-danger border-danger/30"
              >
                <OctagonAlert className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                <span>{localizeError(b)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
