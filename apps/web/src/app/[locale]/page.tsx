import { getTranslations } from 'next-intl/server'

export default async function HomePage() {
  const t = await getTranslations('Common')

  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <h1 className="text-3xl font-bold text-navy">{t('appName')}</h1>
      <p className="max-w-xl text-lg text-muted-foreground">{t('heroSubtitle')}</p>
      <footer className="mt-8 text-sm text-muted-foreground">
        {t('footer', { year: new Date().getFullYear() })}
      </footer>
    </section>
  )
}