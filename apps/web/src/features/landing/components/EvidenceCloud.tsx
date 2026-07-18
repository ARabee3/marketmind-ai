import { getTranslations } from 'next-intl/server'
import { Latin } from './ui/Primitives'
import { Reveal } from './Reveal'

type EvidenceTag = { label: string; latin?: string; type: 'provider' | 'known' | 'review' }

function tagClass(type: EvidenceTag['type']) {
  if (type === 'known') return 'border-primary/25 bg-soft-teal text-primary'
  if (type === 'review') return 'border-warning/25 bg-warning/10 text-warning'
  return 'border-border bg-surface text-ink-soft'
}

export async function EvidenceCloud() {
  const t = await getTranslations('Landing.evidence')
  const tags = t.raw('tags') as EvidenceTag[]

  return (
    <section className="relative flex min-h-[58vh] w-full items-center overflow-hidden bg-bg px-4 py-16 sm:px-6 md:min-h-[74vh] md:py-[82px]">
      <div className="mx-auto w-full max-w-content text-center">
        <Reveal y={24} className="mx-auto block">
          <h2 className="mx-auto max-w-5xl text-[clamp(2.3rem,12vw,5.6rem)] font-bold leading-[1.03] text-navy">
            {t('title')}
          </h2>
        </Reveal>
        <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-3">
          {tags.map((tag, index) => (
            <Reveal key={tag.label} delay={0.04 * index} y={10} viewportMargin="-10%" className="inline-flex">
              <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[14px] font-semibold ${tagClass(tag.type)}`}>
                {tag.label}
                {tag.latin && <Latin>{`(${tag.latin})`}</Latin>}
              </span>
            </Reveal>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-read text-[15px] leading-[1.8] text-ink-soft">
          {t('body')}
        </p>
      </div>
    </section>
  )
}