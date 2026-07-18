import { ArrowLeftIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Reveal } from './Reveal'

export async function FinalCta() {
  const t = await getTranslations('Landing.finalCta')

  return (
    <section id="start" className="w-full bg-primary px-4 py-24 sm:px-6 md:pb-[110px] md:pt-[96px]">
      <Reveal className="mx-auto max-w-content text-center">
        <h2 className="text-[clamp(2.3rem,6vw,4.8rem)] font-bold leading-[1.03] text-navy">{t('title')}</h2>
        <p className="mx-auto mt-4 max-w-read text-[16px] leading-[1.9] text-white/80">{t('body')}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link href="/register" className="cta-solid-dark w-full gap-2 px-7 py-3 text-[15px] font-bold sm:w-auto">
            {t('primary')}
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <a href="#sample" className="cta-secondary w-full px-7 py-3 text-[15px] font-bold sm:w-auto">
            {t('secondary')}
          </a>
        </div>
      </Reveal>
    </section>
  )
}