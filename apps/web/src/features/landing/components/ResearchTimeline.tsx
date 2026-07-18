import { CheckIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Eyebrow, Section } from './ui/Primitives'
import { Reveal } from './Reveal'

type ResearchStage = { label: string; detail: string }

export async function ResearchTimeline() {
  const t = await getTranslations('Landing.research')
  const stages = t.raw('stages') as ResearchStage[]

  return (
    <Section tone="journey" className="pt-8 md:pt-10">
      <div className="grid gap-10 md:grid-cols-[1fr,1.4fr] md:gap-16">
        <Reveal className="min-w-0 block">
          <Eyebrow inverse>{t('eyebrow')}</Eyebrow>
          <h2 className="mt-4 text-[clamp(2.3rem,6vw,4.4rem)] font-bold leading-[1.03] text-white">{t('title')}</h2>
          <p className="mt-4 max-w-read text-[1rem] leading-[1.85] text-white/75">{t('body')}</p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-journey-mint/40 bg-white/[0.06] px-3 py-1.5 text-[12px] font-bold text-journey-mint">
            <span className="h-2 w-2 rounded-full bg-journey-mint" aria-hidden />
            {t('status')}
          </div>
        </Reveal>

        <ol className="relative min-w-0 ps-6 pe-2 list-none p-0">
          <span
            className="absolute bottom-2 top-2 w-px bg-white/20"
            style={{ insetInlineEnd: 'auto', insetInlineStart: '7px' }}
            aria-hidden
          />
          {stages.map((stage, index) => (
            <li key={stage.label} className="relative mb-4 list-none last:mb-0" style={{ paddingInlineStart: '1.5rem' }}>
              <span
                className="absolute flex h-4 w-4 items-center justify-center rounded-full border border-white/35 bg-navy"
                style={{ insetInlineStart: '-1.5px', top: '4px' }}
                aria-hidden
              >
                <CheckIcon className="h-2.5 w-2.5 text-navy" aria-hidden />
              </span>
              <Reveal delay={index * 0.04} y={12} viewportMargin="-15%" className="rounded-card border border-white/[0.14] bg-white/[0.06] p-3">
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-journey-mint">
                    <span className="text-[14px] font-semibold text-white">{stage.label}</span>
                  </summary>
                  <p className="pt-2 text-[12px] leading-relaxed text-white/65">{stage.detail}</p>
                </details>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  )
}
