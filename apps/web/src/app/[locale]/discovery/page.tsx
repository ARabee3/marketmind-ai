import { getTranslations } from 'next-intl/server'

export default async function DiscoveryPage() {
  const t = await getTranslations('DiscoveryIntake')

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-8">
        <h1 className="text-2xl font-bold text-navy mb-6 text-center">
          {t('title')}
        </h1>

        <p className="text-gray-600 text-center mb-8">
          {t('submit')}
        </p>
      </div>
    </div>
  )
}
