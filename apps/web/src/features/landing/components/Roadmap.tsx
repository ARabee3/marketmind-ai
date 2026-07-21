import { ArrowRightIcon, CheckCircle2Icon, CircleIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
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
    <article
      className={`grid gap-5 rounded-card border p-5 md:grid-cols-[5rem_minmax(0,1fr)_auto] md:items-center md:p-6 ${
        live
          ? 'border-primary/40 bg-soft-teal shadow-[0_14px_34px_rgb(16_42_67_/_10%)]'
          : 'border-border bg-bg'
      }`}
    >
      <span className={`text-[38px] font-bold leading-none ${live ? 'text-primary' : 'text-navy/25'}`}>
        {card.no}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[clamp(1.45rem,3vw,1.9rem)] font-bold leading-[1.12] text-navy">
            {card.title}
          </h3>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${
              live
                ? 'border-primary/30 bg-surface text-primary'
                : 'border-border bg-surface text-muted'
            }`}
          >
            {live ? (
              <CheckCircle2Icon className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <CircleIcon className="h-3.5 w-3.5" aria-hidden />
            )}
            {card.statusLabel}
          </span>
        </div>
        <span
          dir="ltr"
          className="mt-2 inline-flex items-center gap-1.5 font-latin text-[13px] text-primary"
        >
          <Latin>{card.en}</Latin>
          <span className="text-[11px]" aria-hidden>
            →
          </span>
          <Latin>{card.output}</Latin>
        </span>
        <p className="mt-3 max-w-[680px] text-[15px] leading-[1.75] text-ink-soft">
          {card.desc}
        </p>
      </div>

      {live && (
        <Link
          href="/register"
          className="cta-solid w-full gap-2 self-start px-4 py-2 text-[13px] font-bold md:w-auto md:self-center"
        >
          {liveCta}
          <ArrowRightIcon className="h-4 w-4 rtl:scale-x-[-1]" aria-hidden />
        </Link>
      )}
    </article>
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

      <ol
        aria-label={t('aria')}
        className="mx-auto mt-8 grid max-w-[940px] list-none gap-3 border-s-2 border-primary/20 ps-4 lg:mt-10 lg:ps-6"
      >
        {cards.map((card, index) => (
          <li key={card.no}>
            <Reveal y={12} delay={index * 0.04} viewportMargin="-12%">
              <PhaseCard card={card} liveCta={liveCta} />
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  )
}
