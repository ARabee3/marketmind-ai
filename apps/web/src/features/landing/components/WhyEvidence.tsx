import { CheckIcon, MessageSquareTextIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Eyebrow, Section, StatusBadge } from './ui/Primitives'
import { Reveal } from './Reveal'

export async function WhyEvidence() {
  const t = await getTranslations('Landing.why')
  const status = await getTranslations('Landing.status')

  return (
    <Section tone="soft">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <Reveal className="block">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2 className="mt-4 max-w-read text-[clamp(2.3rem,6vw,4.4rem)] font-bold leading-[1.03] text-navy">
            {t('title')}
          </h2>
          <p className="mt-4 max-w-read text-[1rem] leading-[1.85] text-ink-soft">
            {t('body')}
          </p>
        </Reveal>

        <Reveal delay={0.1} className="rounded-card border border-border bg-surface p-5">
          <div className="space-y-4">
            <div className="rounded-card border border-action/20 bg-action-soft p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-navy">{t('before')}</span>
                <StatusBadge kind="inference" label={status('inference')} />
              </div>
              <p className="flex items-center gap-2 text-[14px] text-action">
                <MessageSquareTextIcon className="h-4 w-4 shrink-0" aria-hidden />
                {t('beforeText')}
              </p>
            </div>
            <div className="text-center text-[12px] text-muted">{t('transition')}</div>
            <div className="rounded-card border border-primary/20 bg-soft-teal p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-navy">{t('after')}</span>
                <StatusBadge kind="accepted" label={status('accepted')} />
              </div>
              <p className="flex items-center gap-2 text-[14px] font-semibold text-primary">
                <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />
                {t('afterText')}
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  )
}