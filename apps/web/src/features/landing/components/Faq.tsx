import { getTranslations } from 'next-intl/server'
import { Eyebrow, Section } from './ui/Primitives'

type FaqItem = { q: string; a: string }

export async function Faq() {
  const t = await getTranslations('Landing.faq')
  const items = t.raw('items') as FaqItem[]

  return (
    <Section id="faq" tone="base">
      <div className="mx-auto max-w-[860px]">
        <div className="mb-8 text-center">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2 className="mt-3 text-[clamp(2.3rem,6vw,4.4rem)] font-bold text-navy">{t('title')}</h2>
        </div>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={item.q} className="rounded-card border border-border bg-surface px-[18px] shadow-faq">
              <h3>
                <details open={index === 0}>
                  <summary className="flex min-h-[56px] w-full cursor-pointer list-none items-center justify-between gap-4 rounded text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
                    <span className="text-[16px] font-bold text-navy">{item.q}</span>
                  </summary>
                  <p className="max-w-read pb-5 text-[15px] leading-[1.9] text-ink-soft">{item.a}</p>
                </details>
              </h3>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}