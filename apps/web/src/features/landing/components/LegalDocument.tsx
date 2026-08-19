import { getTranslations } from 'next-intl/server'

export type LegalSection = {
  readonly id: string
  readonly heading: string
  readonly paragraphs?: readonly string[]
  readonly items?: readonly string[]
}

type LegalNamespace = 'Legal.privacy' | 'Legal.terms'

type Props = {
  /** Translation namespace that holds meta, title, updated, and sections */
  namespace: LegalNamespace
}

/**
 * Renders a long-form legal document (Privacy Policy / Terms of Use) from
 * structured translations. Content is bilingual and lives entirely in
 * messages/{ar,en}.json — this component only renders it with semantic HTML.
 */
export async function LegalDocument({ namespace }: Props) {
  const t = await getTranslations(namespace)
  const sections = t.raw('sections') as readonly LegalSection[]

  return (
    <article className="mx-auto w-full max-w-content px-4 py-14 sm:px-6 md:py-20">
      <header className="border-b border-primary/15 pb-8">
        <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-balance text-3xl leading-tight font-bold text-navy md:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-[13px] text-muted">{t('updated')}</p>
      </header>

      <div className="mt-10 space-y-10">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`legal-${section.id}`}>
            <h2
              id={`legal-${section.id}`}
              className="text-lg leading-snug font-bold text-navy"
            >
              {section.heading}
            </h2>
            {section.paragraphs?.map((paragraph, index) => (
              <p
                key={index}
                className="mt-3 text-pretty text-[15px] leading-7 text-ink-soft"
              >
                {paragraph}
              </p>
            ))}
            {section.items && section.items.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {section.items.map((item, index) => (
                  <li
                    key={index}
                    className="flex gap-2 text-pretty text-[15px] leading-7 text-ink-soft"
                  >
                    <span
                      aria-hidden
                      className="mt-[11px] size-1.5 shrink-0 rounded-full bg-primary/60"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  )
}
