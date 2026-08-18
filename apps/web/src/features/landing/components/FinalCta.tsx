import { ArrowRightIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Reveal } from './Reveal'

export async function FinalCta() {
  const t = await getTranslations('Landing.finalCta')

  return (
    <section id="start" className="final-cta relative w-full overflow-hidden bg-primary px-4 py-24 sm:px-6 md:py-[124px]">
      <Reveal className="relative mx-auto grid max-w-content gap-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/80 rtl:tracking-normal">{t('eyebrow')}</p>
          <h2 className="mt-4 max-w-[900px] text-balance text-[clamp(2.7rem,6vw,5.5rem)] font-bold leading-[0.96] tracking-[-0.02em] text-white rtl:leading-[1.18] rtl:tracking-normal">{t('title')}</h2>
          <p className="mt-5 max-w-read text-[16px] leading-[1.85] text-white/90 rtl:leading-[2]">{t('body')}</p>
        </div>
        <div className="flex flex-col items-stretch gap-4 sm:flex-row md:flex-col">
          <Link href="/register" className="cta-secondary group w-full gap-2 px-7 py-3 text-[15px] font-bold sm:w-auto">
            {t('primary')}
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:scale-x-[-1] rtl:group-hover:-translate-x-0.5" aria-hidden />
          </Link>
          <a href="#sample" className="cta-ghost-inverse w-full px-7 py-3 text-[15px] font-bold sm:w-auto">
            {t('secondary')}
          </a>
        </div>
      </Reveal>
    </section>
  )
}
