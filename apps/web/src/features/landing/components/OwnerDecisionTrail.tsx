import { ArrowDownIcon, CheckIcon, FileSearchIcon, Layers3Icon, Repeat2Icon, SendIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Eyebrow } from './ui/Primitives'

type JourneyStep = {
  no: string
  title: string
  body: string
  proof: string
}

const ICONS = [FileSearchIcon, CheckIcon, Layers3Icon, SendIcon]

export async function OwnerDecisionTrail() {
  const t = await getTranslations('Landing.journey')
  const steps = t.raw('steps') as JourneyStep[]

  return (
    <section id="discovery" className="journey-stage relative overflow-hidden bg-navy px-4 py-[84px] scroll-mt-24 text-white sm:px-6 md:py-[118px]">
      <div className="mx-auto w-full max-w-content">
        <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-[760px]">
            <Eyebrow inverse>{t('eyebrow')}</Eyebrow>
            <h2 className="mt-4 text-balance text-[clamp(2.5rem,6vw,5.25rem)] font-bold leading-[0.98] tracking-[-0.04em] text-white rtl:leading-[1.18] rtl:tracking-normal">
              {t('title')}
            </h2>
            <p className="mt-5 max-w-[650px] text-[1rem] leading-[1.85] text-white/90 rtl:leading-[1.95]">{t('body')}</p>
          </div>
          <div className="owner-seal hidden h-36 w-36 rotate-[5deg] place-items-center rounded-full border border-journey-mint/50 text-center text-[12px] font-bold leading-[1.45] text-journey-mint md:grid rtl:rotate-[-5deg]">
            <span className="grid h-[7.2rem] w-[7.2rem] place-items-center rounded-full border border-dashed border-journey-mint/60 px-4">
              {t('seal')}
            </span>
          </div>
        </div>

        <ol aria-label={t('aria')} className="decision-trail mt-14 grid list-none gap-3 p-0 lg:grid-cols-4 lg:gap-0">
          {steps.map((step, index) => {
            const Icon = ICONS[index] ?? CheckIcon

            return (
              <li key={step.no} className="decision-trail-step relative min-w-0">
                <article className="group relative h-full border border-white/15 bg-white/[0.055] p-5 transition-colors duration-300 hover:bg-white/[0.09] lg:min-h-[285px] lg:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <span dir="ltr" className="bidi-iso text-[3rem] font-bold leading-none text-white/16">{step.no}</span>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-journey-mint/35 bg-journey-mint/10 text-journey-mint">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                  </div>
                  <h3 className="mt-9 text-[clamp(1.55rem,3vw,2rem)] font-bold leading-[1.12] text-white rtl:leading-[1.3]">{step.title}</h3>
                  <p className="mt-3 text-[14px] leading-[1.75] text-white/85 rtl:leading-[1.9]">{step.body}</p>
                  <p className="mt-6 border-t border-white/15 pt-4 text-[12px] font-semibold leading-[1.6] text-journey-mint">
                    {step.proof}
                  </p>
                </article>
                {index < steps.length - 1 ? (
                  <span className="decision-trail-connector pointer-events-none absolute z-10 flex h-8 w-8 items-center justify-center rounded-full border border-journey-mint/40 bg-navy text-journey-mint" aria-hidden>
                    <ArrowDownIcon className="h-4 w-4 lg:-rotate-90 rtl:lg:rotate-90" />
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>

        <div className="mt-10 flex flex-col items-start justify-between gap-5 border-t border-white/15 pt-7 sm:flex-row sm:items-center">
          <div className="flex max-w-[720px] items-start gap-4 rounded-xl border border-journey-mint/25 bg-journey-mint/[0.08] p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-journey-mint text-navy">
              <Repeat2Icon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-[12px] font-bold text-journey-mint">{t('completeLabel')}</p>
              <p className="mt-1 text-[14px] leading-[1.75] text-white/85 rtl:leading-[1.9]">{t('footnote')}</p>
            </div>
          </div>
          <Link href="/register" className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-journey-mint px-6 py-3 text-[14px] font-bold text-navy outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white">
            {t('cta')}
          </Link>
        </div>
      </div>
    </section>
  )
}
