import { getTranslations } from 'next-intl/server'

export default async function DiscoveryPage() {
  const t = await getTranslations('DiscoveryIntake')

  return (
    <div className="mx-auto w-full max-w-lg">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-navy">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
      </header>
    </div>
  )
}