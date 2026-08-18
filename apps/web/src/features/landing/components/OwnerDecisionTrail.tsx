import {
  ArrowDownIcon,
  BarChart3Icon,
  CalendarRangeIcon,
  CheckIcon,
  FileSearchIcon,
  PenToolIcon,
  Repeat2Icon,
  SendIcon,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Eyebrow } from './ui/Primitives'

type JourneyStep = {
  no: string
  title: string
  body: string
  proof: string
}

const ICONS = [FileSearchIcon, CalendarRangeIcon, PenToolIcon, SendIcon, BarChart3Icon]

export async function OwnerDecisionTrail() {
  const t = await getTranslations('Landing.journey')
  const steps = t.raw('steps') as JourneyStep[]

  return (
    <section id="how-it-works" className="journey-stage relative overflow-hidden bg-navy px-4 py-16 scroll-mt-24 text-white sm:px-6 md:py-20">
      <div className="mx-auto w-full max-w-content">
        <div className="grid items-end gap-6 md:grid-cols-[1fr_auto]">
          <div className="max-w-[760px]">
            <Eyebrow inverse>{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3.5 text-balance text-[clamp(2.3rem,5.2vw,4.5rem)] font-bold leading-[1.02] tracking-[-0.03em] text-white rtl:leading-[1.2] rtl:tracking-normal">
              {t('title')}
            </h2>
            <p className="mt-4 max-w-[650px] text-[15px] leading-[1.8] text-white/90 rtl:leading-[1.9]">{t('body')}</p>
          </div>
          <div className="owner-seal hidden h-32 w-32 rotate-[5deg] place-items-center rounded-full border border-journey-mint/50 text-center text-[11px] font-bold leading-[1.4] text-journey-mint md:grid rtl:rotate-[-5deg]">
            <span className="grid h-[6.5rem] w-[6.5rem] place-items-center rounded-full border border-dashed border-journey-mint/60 px-3">
              {t('seal')}
            </span>
          </div>
        </div>

        <ol aria-label={t('aria')} className="decision-trail mt-10 grid list-none gap-3 p-0 lg:grid-cols-5 lg:gap-0">
          {steps.map((step, index) => {
            const Icon = ICONS[index] ?? CheckIcon

            return (
              <li key={step.no} className="decision-trail-step relative min-w-0">
                <article className="group relative h-full rounded-2xl border border-white/15 bg-white/[0.055] p-5 transition-colors duration-300 hover:bg-white/[0.09] lg:min-h-[275px] lg:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span dir="ltr" className="bidi-iso text-[2.5rem] font-bold leading-none text-white/20">{step.no}</span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-journey-mint/35 bg-journey-mint/10 text-journey-mint">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                  </div>
                  <h3 className="mt-5 text-[17px] font-bold leading-[1.25] text-white rtl:leading-[1.35]">{step.title}</h3>
                  <p className="mt-2.5 text-[13px] leading-[1.7] text-white/80 rtl:leading-[1.85]">{step.body}</p>
                  <p className="mt-4 border-t border-white/15 pt-3 text-[11px] font-semibold leading-[1.6] text-journey-mint">
                    {step.proof}
                  </p>
                </article>
                {index < steps.length - 1 ? (
                  <span className="decision-trail-connector pointer-events-none absolute z-10 flex h-7 w-7 items-center justify-center rounded-full border border-journey-mint/40 bg-navy text-journey-mint" aria-hidden>
                    <ArrowDownIcon className="h-3.5 w-3.5 lg:-rotate-90 rtl:lg:rotate-90" />
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>

        <div className="mt-8 flex flex-col items-start justify-between gap-4 border-t border-white/15 pt-6 sm:flex-row sm:items-center">
          <div className="flex max-w-[720px] items-start gap-3.5 rounded-xl border border-journey-mint/25 bg-journey-mint/[0.08] p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-journey-mint text-navy">
              <Repeat2Icon className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-[11px] font-bold text-journey-mint">{t('completeLabel')}</p>
              <p className="mt-0.5 text-[13px] leading-[1.7] text-white/85 rtl:leading-[1.85]">{t('footnote')}</p>
            </div>
          </div>
          <Link href="/register" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-journey-mint px-6 py-2.5 text-[13px] font-bold text-navy outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white">
            {t('cta')}
          </Link>
        </div>
      </div>
    </section>
  )
}

