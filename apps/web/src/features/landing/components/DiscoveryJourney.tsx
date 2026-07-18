import { getTranslations } from 'next-intl/server'
import { Chip, Eyebrow, Section } from './ui/Primitives'
import { Reveal } from './Reveal'

type DiscoveryStep = { no: string; label: string; desc: string; chips: string[] }

export async function DiscoveryJourney() {
  const t = await getTranslations('Landing.discovery')
  const steps = t.raw('steps') as DiscoveryStep[]

  return (
    <Section id="discovery" tone="journey" className="pb-10">
      <div className="mb-10 max-w-read md:mb-14">
        <Eyebrow inverse>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-4 text-[clamp(2.3rem,6vw,4.8rem)] font-bold leading-[1.03] text-white">{t('title')}</h2>
        <p className="mt-4 text-[1rem] leading-[1.85] text-white/75">{t('body')}</p>
      </div>

      <div className="discovery-stepper" aria-label={t('aria')}>
        <svg
          className="discovery-stepper-line"
          viewBox="0 0 100 520"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M50 8 C20 110 82 150 50 240 C18 330 78 390 50 512" />
        </svg>

        <div className="discovery-stepper-list">
          {steps.map((step, index) => (
            <Reveal key={step.no} delay={index * 0.08} y={18} viewportMargin="-15%" className="discovery-step-wrapper">
              <article className="discovery-step">
                <span className="discovery-step-number is-active">{step.no}</span>
                <div className="discovery-step-card">
                  <h3 className="text-[clamp(1.7rem,3vw,2.15rem)] font-bold leading-[1.12] text-white">{step.label}</h3>
                  <p className="mt-3 text-[15px] leading-[1.8] text-white/75">{step.desc}</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {step.chips.map((chip) => (
                      <Chip
                        key={chip}
                        tone="signal"
                        className="border-journey-mint/45 bg-journey-mint/10 text-journey-mint"
                      >
                        {chip}
                      </Chip>
                    ))}
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  )
}