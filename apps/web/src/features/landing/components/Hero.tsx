import { ArrowDownIcon, MessageCircleIcon, SearchIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Latin } from './ui/Primitives'
import { Reveal } from './Reveal'

type PreviewStep = { step: string; title: string; mono: string; text: string }
type PreviewStepKind = 'source' | 'result' | 'question'

const STEP_STYLES: Record<PreviewStepKind, string> = {
  source: 'border-dashed border-border bg-surface text-ink-soft',
  result: 'border-primary/15 bg-soft-teal text-primary',
  question: 'border-action/15 bg-action-soft text-action',
}

const STEP_KINDS: PreviewStepKind[] = ['source', 'source', 'result', 'question']

export async function Hero() {
  const t = await getTranslations('Landing.hero')
  const steps = t.raw('preview.steps') as PreviewStep[]

  return (
    <section id="top" className="hero-workspace hero-grid relative w-full overflow-hidden px-4 pb-9 pt-[104px] sm:px-6 md:pb-[54px] md:pt-[120px]">
      <div className="relative z-10 mx-auto w-full max-w-content">
        <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-surface px-4 py-1.5 text-primary">
          <span className="relative flex h-2.5 w-2.5">
            <span className="relative h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <span className="text-[13px] font-bold">{t('badge')}</span>
        </div>

        <h1 className="mx-auto mt-[22px] max-w-[920px] text-center text-[clamp(2.9rem,11vw,7.5rem)] font-bold leading-[0.95] text-navy">
          {t('title')}
        </h1>
        <p className="mx-auto mt-5 max-w-read text-center text-[clamp(1.05rem,2vw,1.25rem)] leading-[1.9] text-ink-soft">
          {t('body')}
        </p>
        <p className="mx-auto mt-4 max-w-read text-center text-[13px] leading-[1.8] text-muted">
          {t('note')}{' '}
          <a href="#roadmap" className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline">
            {t('noteLink')}
            <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />
          </a>
        </p>

        <Reveal delay={0.2} className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link href="/register" className="cta-solid w-full px-7 py-3 text-[15px] font-bold sm:w-auto">
            {t('primary')}
          </Link>
          <a href="#roadmap" className="cta-secondary w-full px-7 py-3 text-[15px] font-bold sm:w-auto">
            {t('secondary')}
          </a>
        </Reveal>

        <Reveal delay={0.32} y={24} className="relative mx-auto mt-[38px] max-w-[720px]">
          <div className="pointer-events-none absolute -right-3 -top-7 z-20 hidden md:block">
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-primary/35" />
              <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-surface">
                <SearchIcon className="h-5 w-5 text-primary" aria-hidden />
              </div>
            </div>
          </div>
          <div className="grid gap-3 rounded-card border border-border bg-surface p-5 shadow-elevated md:grid-cols-4 md:gap-4">
            {steps.map((step, index) => (
              <PreviewStepCard key={step.step} step={step} kind={STEP_KINDS[index] ?? 'source'} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function PreviewStepCard({ step, kind }: { readonly step: PreviewStep; readonly kind: PreviewStepKind }) {
  const isQuestion = kind === 'question'
  return (
    <div className={`rounded-card border p-3 ${STEP_STYLES[kind]}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface/80 text-[11px] font-bold text-navy">
          {step.step}
        </span>
        {isQuestion && <MessageCircleIcon className="h-4 w-4" aria-hidden />}
      </div>
      <p className="text-[13px] font-bold text-navy">{step.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed">{step.text}</p>
      <p className="mt-2 font-latin text-[10px] opacity-70">
        <Latin>{step.mono}</Latin>
      </p>
    </div>
  )
}
