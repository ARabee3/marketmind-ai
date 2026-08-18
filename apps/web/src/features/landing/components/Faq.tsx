import { ChevronDownIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Eyebrow, Section } from './ui/Primitives'

type FaqItem = { q: string; a: string }

export async function Faq() {
  const t = await getTranslations('Landing.faq')
  const items = t.raw('items') as FaqItem[]

  return (
    <Section id="faq" tone="surface">
      <div className="grid gap-10 md:grid-cols-[0.68fr_1.32fr] md:gap-16">
        <div className="md:sticky md:top-28 md:self-start">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2 className="mt-4 text-balance text-[clamp(2.5rem,5vw,4.3rem)] font-bold leading-[1] tracking-[-0.04em] text-navy rtl:leading-[1.18] rtl:tracking-normal">{t('title')}</h2>
          <p className="mt-5 max-w-[430px] text-[14px] leading-[1.8] text-ink-soft rtl:leading-[1.95]">{t('body')}</p>
        </div>
        <div className="space-y-3">
          {items.map((item, index) => (
            <details key={item.q} open={index === 0} className="group rounded-xl border border-border bg-bg px-5 transition-colors open:border-primary/30 open:bg-soft-teal/40 md:px-6">
              <summary className="flex min-h-[68px] w-full cursor-pointer list-none items-center justify-between gap-4 rounded text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
                <span className="text-[16px] font-bold text-navy md:text-[17px]">{item.q}</span>
                <ChevronDownIcon className="faq-chevron h-5 w-5 shrink-0 text-primary" aria-hidden />
              </summary>
              <p className="max-w-read pb-6 text-[14px] leading-[1.85] text-ink-soft rtl:leading-[2]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  )
}
