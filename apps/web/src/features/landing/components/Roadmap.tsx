import { ArrowLeftIcon, CheckCircle2Icon, CircleIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Eyebrow, Latin, Section } from './ui/Primitives'
import { Reveal } from './Reveal'

type RoadmapCard = {
  no: string
  title: string
  en: string
  output: string
  desc: string
  status: 'live' | 'planned'
  statusLabel: string
}

function PhaseCard({ card, liveCta }: { readonly card: RoadmapCard; readonly liveCta: string }) {
  const live = card.status === 'live'
  return (
    <div
      className={`roadmap-stack-card relative flex min-h-[340px] flex-col rounded-card border p-7 shadow-[0_14px_34px_rgb(16_42_67_/_8%)] sm:min-h-[380px] md:p-9 ${live ? 'border-primary bg-primary text-white' : 'roadmap-stack-card--planned text-navy'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <span className={`text-[42px] font-bold leading-none ${live ? 'text-white/70' : 'text-navy/20'}`}>
          {card.no}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${live ? 'border-white/35 bg-white/10 text-white' : 'border-border bg-surface text-muted'}`}
        >
          {live ? (
            <CheckCircle2Icon className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <CircleIcon className="h-3.5 w-3.5" aria-hidden />
          )}
          {card.statusLabel}
        </span>
      </div>
      <h3 className="mt-5 text-[clamp(1.7rem,3vw,2.15rem)] font-bold leading-[1.12]">{card.title}</h3>
      <span className={`mt-2 font-latin text-[13px] ${live ? 'text-white/75' : 'text-primary'}`}>
        <Latin>{card.en}</Latin> <span className="text-[11px]">→</span>{' '}
        <Latin>{card.output}</Latin>
      </span>
      <p className={`mt-4 text-[15px] leading-[1.8] ${live ? 'text-white/85' : 'text-ink-soft'}`}>{card.desc}</p>
      {live && (
        <a href="#start" className="cta-secondary mt-auto self-start px-4 py-2 text-[13px] font-bold">
          {liveCta}
          <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden />
        </a>
      )}
    </div>
  )
}

export async function Roadmap() {
  const t = await getTranslations('Landing.roadmap')
  const cards = t.raw('cards') as RoadmapCard[]
  const liveCta = t('liveCta')

  return (
    <Section id="roadmap" tone="surface">
      <div className="mx-auto max-w-[880px] text-center">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 text-[clamp(2.3rem,6vw,4.8rem)] font-bold leading-[1.03] text-navy">{t('title')}</h2>
        <p className="mt-4 text-[1rem] leading-[1.8] text-ink-soft">{t('body')}</p>
      </div>

      <p className="mx-auto mt-8 w-fit rounded-full border border-border bg-bg px-3 py-1.5 text-center text-[12px] font-semibold text-muted">
        {t('hint')}
      </p>

      <ol aria-label={t('aria')} className="roadmap-stack mx-auto mt-8 max-w-[860px] list-none p-0 lg:mt-12">
        {cards.map((card, index) => (
          <li key={card.no} className="roadmap-stack-scene" style={{ zIndex: index + 1 }}>
            <Reveal y={0} delay={index * 0.05} viewportMargin="-18%" className="h-full">
              <PhaseCard card={card} liveCta={liveCta} />
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  )
}