import {
  ArrowDownIcon,
  BarChart3Icon,
  FileTextIcon,
  Layers3Icon,
  TargetIcon,
  UserRoundCheckIcon,
} from 'lucide-react'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils'
import { Eyebrow, StatusBadge } from './ui/Primitives'

const SHOP_IMG = '/63d36b5c-0e3c-405d-a588-dfb4af2f657c.jpg'

export async function SampleResult() {
  const t = await getTranslations('Landing.sample')
  const status = await getTranslations('Landing.status')

  return (
    <section id="sample" className="relative overflow-hidden bg-bg px-4 py-16 scroll-mt-24 sm:px-6 md:py-20">
      <div className="mx-auto w-full max-w-content">
        <div className="grid items-end gap-5 md:grid-cols-[1fr_auto]">
          <div className="max-w-[760px]">
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3.5 text-balance text-[clamp(2.3rem,5.2vw,4.3rem)] font-bold leading-[1.02] tracking-[-0.03em] text-navy rtl:leading-[1.2] rtl:tracking-normal">
              {t('title')}
            </h2>
          </div>
          <p className="max-w-[390px] text-[14px] leading-[1.75] text-ink-soft md:text-end">{t('body')}</p>
        </div>

        <div className="sample-board mt-8 overflow-hidden rounded-[1.35rem] border border-border bg-surface shadow-elevated">
          <header className="flex flex-col gap-3 border-b border-border bg-surface/95 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-7">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-soft-teal text-primary">
                <FileTextIcon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted rtl:tracking-normal">{t('caseLabel')}</p>
                <p className="mt-0.5 text-[13px] font-bold text-navy">{t('name')}</p>
              </div>
            </div>
            <span className="w-fit rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-[11px] font-bold text-warning">
              {t('exampleLabel')}
            </span>
          </header>

          <div className="grid lg:grid-cols-[0.76fr_1.24fr]">
            <div className="relative min-h-[260px] overflow-hidden border-b border-border lg:min-h-[560px] lg:border-b-0 lg:border-e">
              <Image
                src={SHOP_IMG}
                alt={t('imageAlt')}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 38vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/10 to-transparent" aria-hidden />
              <div className="absolute inset-x-0 bottom-0 p-5 text-white md:p-7">
                <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-journey-mint rtl:tracking-normal">{t('sourceType')}</p>
                <p className="mt-1.5 max-w-[430px] text-[14px] font-medium leading-[1.7] text-white/90">{t('sourceCaption')}</p>
              </div>
            </div>

            <div className="bg-surface p-5 md:p-7">
              <div aria-label={t('aria')} className="grid gap-3">
                <DecisionStep icon={TargetIcon} label={t('sourceTitle')} tone="neutral">
                  {t('sourceText')}
                </DecisionStep>
                <FlowArrow label={t('researchTransition')} />
                <DecisionStep
                  icon={Layers3Icon}
                  label={t('suggestionTitle')}
                  tone="action"
                  badge={<StatusBadge kind="inference" label={status('inference')} />}
                >
                  {t('suggestionText')}
                </DecisionStep>
                <FlowArrow label={t('ownerTransition')} />
                <DecisionStep
                  icon={UserRoundCheckIcon}
                  label={t('ownerTitle')}
                  tone="owner"
                  badge={<span className="rounded-full border border-primary/30 bg-surface px-2.5 py-1 text-[10px] font-bold text-primary">{t('ownerBadge')}</span>}
                >
                  {t('ownerText')}
                </DecisionStep>
                <FlowArrow label={t('resultTransition')} />
                <DecisionStep
                  icon={FileTextIcon}
                  label={t('outcomeTitle')}
                  tone="confirmed"
                  badge={<StatusBadge kind="accepted" label={status('accepted')} />}
                >
                  {t('outcomeText')}
                </DecisionStep>
                <FlowArrow label={t('optTransition')} />
                <DecisionStep
                  icon={BarChart3Icon}
                  label={t('optimizationTitle')}
                  tone="action"
                  badge={<span className="rounded-full border border-primary/35 bg-soft-teal px-2.5 py-1 text-[10px] font-bold text-primary">{t('optimizationBadge')}</span>}
                >
                  {t('optimizationText')}
                </DecisionStep>
              </div>

              <p className="mt-6 border-t border-border pt-4 text-[12px] leading-[1.7] text-muted">{t('optimizationNote')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FlowArrow({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 text-[11px] font-semibold text-muted">
      <ArrowDownIcon className="h-4 w-4 text-primary" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

function DecisionStep({
  icon: Icon,
  label,
  tone,
  badge,
  children,
}: {
  readonly icon: typeof FileTextIcon
  readonly label: string
  readonly tone: 'neutral' | 'action' | 'owner' | 'confirmed'
  readonly badge?: React.ReactNode
  readonly children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4 md:p-4.5',
        tone === 'neutral' && 'border-border bg-bg',
        tone === 'action' && 'border-action/25 bg-action-soft',
        tone === 'owner' && 'border-2 border-primary bg-soft-teal shadow-[0_5px_0_var(--navy)]',
        tone === 'confirmed' && 'border-primary/25 bg-surface',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-primary shadow-[0_0_0_1px_var(--border)]">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-[13px] font-bold text-navy">{label}</h3>
            <p className="mt-1 text-[13px] leading-[1.7] text-ink-soft">{children}</p>
          </div>
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
    </div>
  )
}

