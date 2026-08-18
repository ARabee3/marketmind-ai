import {
  ArrowDownIcon,
  ArrowRightIcon,
  CalendarRangeIcon,
  CheckIcon,
  FileTextIcon,
  Layers3Icon,
  SparklesIcon,
  UserRoundCheckIcon,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils'
import { Link } from '@/i18n/navigation'
import { Reveal } from './Reveal'

export async function Hero() {
  const t = await getTranslations('Landing.hero')
  const weeks = t.raw('preview.weeks') as string[]
  const contentItems = t.raw('preview.contentItems') as string[]

  return (
    <section
      id="top"
      className="hero-workspace hero-grid relative w-full overflow-hidden px-4 pb-12 pt-[108px] scroll-mt-28 sm:px-6 md:pb-16 md:pt-[132px]"
    >
      <div className="relative z-10 mx-auto grid w-full max-w-content items-center gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:gap-14">
        <div className="max-w-[620px] text-start">
          <div className="flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-surface px-3.5 py-1.5 text-primary shadow-[0_4px_16px_rgb(16_42_67_/_6%)]">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            <span className="text-[12px] font-bold">{t('badge')}</span>
          </div>

          <h1 className="mt-5 text-balance text-[clamp(2.5rem,4.5vw,4.25rem)] font-bold leading-[1.02] tracking-[-0.02em] text-navy rtl:leading-[1.2] rtl:tracking-normal">
            {t('title')}
          </h1>
          <p className="mt-5 max-w-[580px] text-pretty text-[clamp(1rem,1.8vw,1.15rem)] leading-[1.75] text-ink-soft rtl:leading-[1.9]">
            {t('body')}
          </p>

          <div className="mt-7 flex flex-col items-stretch gap-3.5 sm:flex-row sm:items-center">
            <Link href="/register" className="cta-solid group w-full gap-2 px-7 py-3 text-[14px] font-bold sm:w-auto">
              {t('primary')}
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:scale-x-[-1] rtl:group-hover:-translate-x-0.5" aria-hidden />
            </Link>
            <a href="#how-it-works" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-bold text-navy underline decoration-border decoration-2 underline-offset-8 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-action">
              {t('secondary')}
              <ArrowDownIcon className="h-4 w-4" aria-hidden />
            </a>
          </div>

          <p className="mt-5 flex max-w-[520px] items-start gap-2 text-[12.5px] leading-[1.65] text-muted rtl:leading-[1.8]">
            <UserRoundCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            {t('note')}
          </p>
        </div>

        <Reveal delay={0.14} className="relative mx-auto w-full max-w-[700px] lg:mx-0">
          <MarketingRunway
            previewLabel={t('preview.previewLabel')}
            status={t('preview.status')}
            progressLabel={t('preview.progressLabel')}
            progressValue={t('preview.progressValue')}
            progressAria={t('preview.progressAria')}
            weeks={weeks}
            weekCompleteLabel={t('preview.weekCompleteLabel')}
            weekCurrentLabel={t('preview.weekCurrentLabel')}
            weekUpcomingLabel={t('preview.weekUpcomingLabel')}
            focusLabel={t('preview.focusLabel')}
            focusText={t('preview.focusText')}
            optimizationLabel={t('preview.optimizationLabel')}
            optimizationText={t('preview.optimizationText')}
            contentLabel={t('preview.contentLabel')}
            contentItems={contentItems}
            actionLabel={t('preview.actionLabel')}
            actionText={t('preview.actionText')}
            readyLabel={t('preview.readyLabel')}
          />
        </Reveal>
      </div>
    </section>
  )
}

type MarketingRunwayProps = {
  readonly previewLabel: string
  readonly status: string
  readonly progressLabel: string
  readonly progressValue: string
  readonly progressAria: string
  readonly weeks: string[]
  readonly weekCompleteLabel: string
  readonly weekCurrentLabel: string
  readonly weekUpcomingLabel: string
  readonly focusLabel: string
  readonly focusText: string
  readonly optimizationLabel: string
  readonly optimizationText: string
  readonly contentLabel: string
  readonly contentItems: string[]
  readonly actionLabel: string
  readonly actionText: string
  readonly readyLabel: string
}

function MarketingRunway({
  previewLabel,
  status,
  progressLabel,
  progressValue,
  progressAria,
  weeks,
  weekCompleteLabel,
  weekCurrentLabel,
  weekUpcomingLabel,
  focusLabel,
  focusText,
  optimizationLabel,
  optimizationText,
  contentLabel,
  contentItems,
  actionLabel,
  actionText,
  readyLabel,
}: MarketingRunwayProps) {
  return (
    <div className="marketing-preview relative overflow-hidden rounded-[1.4rem] border border-navy/15 bg-surface p-3 shadow-[0_28px_80px_rgb(16_42_67_/_18%)] sm:p-5">
      <div className="flex items-center justify-between gap-3 border-b border-border px-2 pb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted rtl:tracking-normal">{previewLabel}</p>
          <p className="mt-1 text-[15px] font-bold text-navy">{status}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-soft-teal text-primary">
          <CalendarRangeIcon className="h-5 w-5" aria-hidden />
        </span>
      </div>

      <div className="p-2 pt-5 sm:p-3 sm:pt-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted rtl:tracking-normal">{progressLabel}</p>
          <p dir="ltr" className="bidi-iso font-latin text-[12px] font-bold text-primary">{progressValue}</p>
        </div>

        <ol aria-label={progressAria} className="mt-3 grid list-none grid-cols-6 gap-1.5 p-0 sm:grid-cols-12">
          {weeks.map((week, index) => {
            const isComplete = index < 3
            const isActive = index === 3
            const stateLabel = isComplete
              ? weekCompleteLabel
              : isActive
                ? weekCurrentLabel
                : weekUpcomingLabel

            return (
              <li
                key={week}
                aria-current={isActive ? 'step' : undefined}
                aria-label={`${week} · ${stateLabel}`}
                className={cn(
                  'relative grid min-h-9 place-items-center rounded-md border font-latin text-[10px] font-bold',
                  isActive && 'marketing-week-active border-primary bg-primary text-white',
                  !isActive && isComplete && 'border-primary/20 bg-soft-teal text-primary',
                  !isActive && !isComplete && 'border-border bg-bg text-muted',
                )}
              >
                {isComplete ? <CheckIcon className="h-3 w-3" aria-hidden /> : week}
              </li>
            )
          })}
        </ol>

        <div className="mt-4 rounded-xl bg-navy p-4 text-white shadow-[0_5px_0_var(--primary)] sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-journey-mint/15 text-journey-mint">
              <Layers3Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-journey-mint rtl:tracking-normal">{focusLabel}</p>
              <p className="mt-1 text-[15px] font-bold leading-[1.5] text-white rtl:leading-[1.75]">{focusText}</p>
            </div>
          </div>
        </div>

        {/* Optimization feedback pill */}
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-primary/25 bg-soft-teal px-3.5 py-2.5 text-navy">
          <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="text-[12px] leading-[1.6]">
            <span className="font-bold text-primary">{optimizationLabel}: </span>
            <span className="font-semibold text-ink-soft">{optimizationText}</span>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-xl border border-border bg-bg p-4">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted rtl:tracking-normal">
              <FileTextIcon className="h-4 w-4 text-action" aria-hidden />
              {contentLabel}
            </p>
            <ul className="mt-3 grid list-none gap-2 p-0">
              {contentItems.map((item) => (
                <li key={item} className="flex items-center gap-2 text-[12px] font-semibold text-navy">
                  <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative rounded-xl border-2 border-primary bg-soft-teal p-4 shadow-[0_4px_0_var(--navy)]">
            <span className="absolute -end-1.5 -top-2.5 rotate-[-2deg] rounded-full border border-primary/35 bg-surface px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-primary rtl:rotate-[2deg] rtl:tracking-normal">
              {readyLabel}
            </span>
            <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-primary rtl:tracking-normal">{actionLabel}</p>
            <p className="mt-2 text-[14px] font-bold leading-[1.55] text-navy rtl:leading-[1.75]">{actionText}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

