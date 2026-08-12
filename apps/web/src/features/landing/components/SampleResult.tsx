import { ArrowDownIcon, FileTextIcon, Layers3Icon, TargetIcon, UserRoundCheckIcon } from 'lucide-react'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Eyebrow, StatusBadge } from './ui/Primitives'

const SHOP_IMG = '/63d36b5c-0e3c-405d-a588-dfb4af2f657c.jpg'

export async function SampleResult() {
  const t = await getTranslations('Landing.sample')
  const status = await getTranslations('Landing.status')

  return (
    <section id="sample" className="relative overflow-hidden bg-bg px-4 py-[84px] scroll-mt-24 sm:px-6 md:py-[118px]">
      <div className="mx-auto w-full max-w-content">
        <div className="grid items-end gap-6 md:grid-cols-[1fr_auto]">
          <div className="max-w-[760px]">
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2 className="mt-4 text-balance text-[clamp(2.5rem,6vw,5rem)] font-bold leading-[0.98] tracking-[-0.04em] text-navy rtl:leading-[1.18] rtl:tracking-normal">
              {t('title')}
            </h2>
          </div>
          <p className="max-w-[390px] text-[14px] leading-[1.8] text-ink-soft md:text-end">{t('body')}</p>
        </div>

        <div className="sample-board mt-10 overflow-hidden rounded-[1.35rem] border border-border bg-surface shadow-elevated">
          <header className="flex flex-col gap-3 border-b border-border bg-surface/95 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-soft-teal text-primary">
                <FileTextIcon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted rtl:tracking-normal">{t('caseLabel')}</p>
                <p className="mt-0.5 text-[14px] font-bold text-navy">{t('name')}</p>
              </div>
            </div>
            <span className="w-fit rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-[11px] font-bold text-warning">
              {t('exampleLabel')}
            </span>
          </header>

          <div className="grid lg:grid-cols-[0.76fr_1.24fr]">
            <div className="relative min-h-[300px] overflow-hidden border-b border-border lg:min-h-[620px] lg:border-b-0 lg:border-e">
              <Image
                src={SHOP_IMG}
                alt={t('imageAlt')}
                fill
                loading="lazy"
                sizes="(max-width: 1024px) 100vw, 38vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/10 to-transparent" aria-hidden />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white md:p-8">
                <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-journey-mint rtl:tracking-normal">{t('sourceType')}</p>
                <p className="mt-2 max-w-[430px] text-[15px] font-medium leading-[1.75] text-white/90">{t('sourceCaption')}</p>
              </div>
            </div>

            <div className="bg-surface p-5 md:p-8 lg:p-10">
              <ol aria-label={t('aria')} className="grid list-none gap-3 p-0">
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
              </ol>

              <p className="mt-7 border-t border-border pt-5 text-[12px] leading-[1.7] text-muted">{t('outcomeNote')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FlowArrow({ label }: { readonly label: string }) {
  return (
    <li className="flex items-center gap-3 px-4 text-[11px] font-semibold text-muted">
      <ArrowDownIcon className="h-4 w-4 text-primary" aria-hidden />
      <span>{label}</span>
    </li>
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
  const classes = {
    neutral: 'border-border bg-bg',
    action: 'border-action/25 bg-action-soft',
    owner: 'border-2 border-primary bg-soft-teal shadow-[0_5px_0_var(--navy)]',
    confirmed: 'border-primary/25 bg-surface',
  }

  return (
    <li className={`rounded-xl border p-4 md:p-5 ${classes[tone]}`}>
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
    </li>
  )
}
