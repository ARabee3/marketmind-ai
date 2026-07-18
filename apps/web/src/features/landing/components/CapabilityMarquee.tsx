import { getTranslations } from 'next-intl/server'
import { Eyebrow, Latin } from './ui/Primitives'

type CapabilityItem = { label: string; latin: string | null }

function Row({ items, direction }: { items: CapabilityItem[]; direction: 'start' | 'end' }) {
  return (
    <div className="edge-fade overflow-hidden py-2">
      <div className={`flex w-max gap-3 ${direction === 'start' ? 'animate-marquee-start' : 'animate-marquee-end'}`}>
        {[...items, ...items].map((item, index) => (
          <span
            key={`${item.label}-${index}`}
            className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-[14px] font-medium text-ink-soft"
          >
            <span>{item.label}</span>
            {item.latin && <Latin>{item.latin}</Latin>}
          </span>
        ))}
      </div>
    </div>
  )
}

export async function CapabilityMarquee() {
  const t = await getTranslations('Landing.capability')
  const row1 = t.raw('row1') as CapabilityItem[]
  const row2 = t.raw('row2') as CapabilityItem[]

  return (
    <section className="w-full overflow-hidden bg-surface py-14 md:py-16">
      <div className="mx-auto mb-6 w-full max-w-content px-4 text-center sm:px-6">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
      </div>
      <div className="flex flex-col gap-3">
        <Row items={row1} direction="start" />
        <Row items={row2} direction="end" />
      </div>
    </section>
  )
}